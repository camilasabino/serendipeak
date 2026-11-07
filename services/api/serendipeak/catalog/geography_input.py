import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from serendipeak.catalog.canonical_json import content_sha256
from serendipeak.catalog.country_aliases import (
    UnknownLegacyCountry,
    codes_of_legacy_names,
    links_agree_with_legacy_names,
)
from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN
from serendipeak.catalog.errors import GeographyBackfillRejected, InvalidGeographyInput
from serendipeak.catalog.geography import CONTINENT_CODES, is_country_code
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import MountainRegion, region_id_for_slug
from serendipeak.catalog.slug import is_valid_slug

GEOGRAPHY_FORMAT = "serendipeak.geography"
GEOGRAPHY_FORMAT_VERSION = 1

_SHA256 = re.compile(r"[0-9a-f]{64}")
_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)
_DOCUMENT_KEYS = {"format", "version", "content_sha256", "mountains", "regions"}
_MOUNTAIN_KEYS = {"id", "slug", "continent", "countries", "region"}
_REGION_KEYS = {"slug", "name_en", "parent", "wikidata_id"}


@dataclass(frozen=True, slots=True)
class MountainGeography:
    id: UUID
    slug: str
    continent_code: str
    country_codes: tuple[str, ...]
    region_slug: str | None


@dataclass(frozen=True, slots=True)
class GeographyInput:
    """regions is ordered parents first, so a parent always precedes its children."""

    content_sha256: str
    mountains: tuple[MountainGeography, ...]
    regions: tuple[MountainRegion, ...]


@dataclass(frozen=True, slots=True)
class StoredGeography:
    """What the catalog holds for one mountain. legacy_country_names is None once the text
    column that held the v1 names is gone."""

    id: UUID
    slug: str
    legacy_country_names: tuple[str, ...] | None
    continent_code: str | None
    country_codes: tuple[str, ...]
    has_legacy_range_name: bool = False
    legacy_range_name: str | None = None
    region_slug: str | None = None


@dataclass(frozen=True, slots=True)
class GeographyChange:
    slug: str
    continent: tuple[str | None, str] | None
    added_countries: tuple[str, ...]
    removed_countries: tuple[str, ...]
    region: tuple[str | None, str | None] | None = None


@dataclass(frozen=True, slots=True)
class BackfillPlan:
    """new_regions is None while the schema has no region table, which leaves the regions and the
    region of every mountain out of the plan."""

    checked: int
    changes: tuple[GeographyChange, ...]
    new_regions: tuple[str, ...] | None = None

    @property
    def unchanged(self) -> int:
        return self.checked - len(self.changes)


def geography_content_sha256(document: Mapping[str, object]) -> str:
    """The checksum a document must carry: the hash of everything but the checksum itself."""
    return content_sha256(
        {key: value for key, value in document.items() if key != "content_sha256"}
    )


def parse_geography_input(document: object, *, expected_sha256: str) -> GeographyInput:
    if not isinstance(expected_sha256, str) or _SHA256.fullmatch(expected_sha256) is None:
        raise InvalidGeographyInput("the expected checksum is not a lowercase SHA-256")
    fields = _object(document, _DOCUMENT_KEYS, "geography input")
    if fields["format"] != GEOGRAPHY_FORMAT or fields["version"] != GEOGRAPHY_FORMAT_VERSION:
        raise InvalidGeographyInput(
            f"the input is not {GEOGRAPHY_FORMAT} version {GEOGRAPHY_FORMAT_VERSION}"
        )

    try:
        actual = geography_content_sha256(fields)
    except (TypeError, ValueError) as error:
        raise InvalidGeographyInput(f"the input is not canonical JSON: {error}") from error
    if fields["content_sha256"] != actual:
        raise InvalidGeographyInput("content_sha256 does not match the content")
    if actual != expected_sha256:
        raise InvalidGeographyInput("the input does not have the expected checksum")

    entries = fields["mountains"]
    if not isinstance(entries, Sequence) or isinstance(entries, str):
        raise InvalidGeographyInput("mountains must be a list")
    mountains = tuple(
        _mountain(entry, f"mountains[{index}]") for index, entry in enumerate(entries)
    )

    if len({mountain.id for mountain in mountains}) != len(mountains):
        raise InvalidGeographyInput("mountain ids are not unique")
    if len({mountain.slug for mountain in mountains}) != len(mountains):
        raise InvalidGeographyInput("mountain slugs are not unique")

    regions = _regions(fields["regions"])
    _check_region_references(mountains, regions)

    return GeographyInput(content_sha256=actual, mountains=mountains, regions=regions)


def plan_backfill(
    geography: GeographyInput,
    stored: Sequence[StoredGeography],
    known_country_codes: frozenset[str],
    stored_regions: Sequence[MountainRegion] | None = None,
) -> BackfillPlan:
    """Judge the input against the catalog and say what applying it would change.

    Raises GeographyBackfillRejected, naming every problem, unless the input covers every stored
    mountain exactly once, every entry has its mountain, the countries agree with the v1 names
    and the regions with the v1 range names where the catalog still holds them, and the stored
    regions, when the schema has the table, are exactly the input's. stored_regions is None while
    the schema has no region table.
    """
    problems = []
    entries = {entry.id: entry for entry in geography.mountains}
    stored_ids = {mountain.id for mountain in stored}
    region_names = {region.slug: region.name.en for region in geography.regions}

    problems.extend(
        f"entry {entry.slug} ({entry.id}) matches no mountain"
        for entry in geography.mountains
        if entry.id not in stored_ids
    )
    new_regions = None
    if stored_regions is not None:
        region_problems, new_regions = _region_problems(geography.regions, stored_regions)
        problems.extend(region_problems)

    changes = []
    for mountain in sorted(stored, key=lambda item: item.slug):
        entry = entries.get(mountain.id)
        if entry is None:
            problems.append(f"mountain {mountain.slug} ({mountain.id}) has no entry")
            continue
        if entry.slug != mountain.slug:
            problems.append(f"entry {entry.slug} is the entry of mountain {mountain.slug}")
            continue

        entry_problems = _entry_problems(entry, mountain, known_country_codes, region_names)
        problems.extend(entry_problems)
        if not entry_problems:
            change = _change(entry, mountain, with_regions=stored_regions is not None)
            if change is not None:
                changes.append(change)

    if problems:
        raise GeographyBackfillRejected(tuple(problems))

    return BackfillPlan(checked=len(stored), changes=tuple(changes), new_regions=new_regions)


def _region_problems(wanted, stored):
    wanted_by_id = {region.id: region for region in wanted}
    held_by_id = {region.id: region for region in stored}
    problems = []

    for region in stored:
        expected = wanted_by_id.get(region.id)
        if expected is None:
            problems.append(f"region {region.slug} ({region.id}) is not in the input")
        elif expected != region:
            problems.append(f"region {region.slug} differs from the input")

    new = tuple(region.slug for region in wanted if region.id not in held_by_id)

    return problems, new


def _entry_problems(entry, mountain, known_country_codes, region_names):
    problems = [
        f"{entry.slug}: country {code} is not in the reference data"
        for code in entry.country_codes
        if code not in known_country_codes
    ]
    problems.extend(_range_problems(entry, mountain, region_names))
    if mountain.legacy_country_names is None:
        return problems

    try:
        agrees = links_agree_with_legacy_names(entry.country_codes, mountain.legacy_country_names)
    except UnknownLegacyCountry as error:
        problems.append(f"{entry.slug}: {error}")
    else:
        if not agrees:
            problems.append(
                f"{entry.slug}: countries {sorted(entry.country_codes)} do not match the stored"
                f" names {sorted(codes_of_legacy_names(mountain.legacy_country_names))}"
            )

    return problems


def _range_problems(entry, mountain, region_names):
    if not mountain.has_legacy_range_name:
        return []

    wanted = None if entry.region_slug is None else region_names[entry.region_slug]
    if wanted == mountain.legacy_range_name:
        return []

    return [
        f"{entry.slug}: region {wanted!r} does not match the stored range name"
        f" {mountain.legacy_range_name!r}"
    ]


def _change(entry, mountain, *, with_regions):
    wanted = set(entry.country_codes)
    held = set(mountain.country_codes)
    continent = (
        None
        if mountain.continent_code == entry.continent_code
        else (mountain.continent_code, entry.continent_code)
    )
    region = (
        (mountain.region_slug, entry.region_slug)
        if with_regions and mountain.region_slug != entry.region_slug
        else None
    )
    if continent is None and wanted == held and region is None:
        return None

    return GeographyChange(
        slug=entry.slug,
        continent=continent,
        added_countries=tuple(sorted(wanted - held)),
        removed_countries=tuple(sorted(held - wanted)),
        region=region,
    )


def _mountain(raw, label):
    fields = _object(raw, _MOUNTAIN_KEYS, label)
    slug = fields["slug"]
    if not isinstance(slug, str) or not is_valid_slug(slug):
        raise InvalidGeographyInput(f"{label} slug is not a valid slug")
    label = f"mountain {slug!r}"

    continent = fields["continent"]
    if continent not in CONTINENT_CODES:
        raise InvalidGeographyInput(f"{label}: continent {continent!r} is not an approved code")

    countries = fields["countries"]
    if not isinstance(countries, Sequence) or isinstance(countries, str):
        raise InvalidGeographyInput(f"{label}: countries must be a list")
    malformed = [code for code in countries if not is_country_code(code)]
    if malformed:
        raise InvalidGeographyInput(f"{label}: malformed country codes {malformed!r}")
    if len(set(countries)) != len(countries):
        raise InvalidGeographyInput(f"{label}: duplicate country codes")

    try:
        mountain_id = UUID(fields["id"])
    except (TypeError, ValueError, AttributeError) as error:
        raise InvalidGeographyInput(f"{label}: id is not a UUID") from error

    region = fields["region"]
    if region is not None and (not isinstance(region, str) or not is_valid_slug(region)):
        raise InvalidGeographyInput(f"{label}: region is neither null nor a valid slug")

    return MountainGeography(
        id=mountain_id,
        slug=slug,
        continent_code=continent,
        country_codes=tuple(sorted(countries)),
        region_slug=region,
    )


def _regions(raw):
    if not isinstance(raw, Sequence) or isinstance(raw, str):
        raise InvalidGeographyInput("regions must be a list")

    regions: dict[str, MountainRegion] = {}
    wikidata_ids: set[str] = set()
    sibling_names: set[tuple[str, str]] = set()

    for index, entry in enumerate(raw):
        fields = _object(entry, _REGION_KEYS, f"regions[{index}]")
        slug = fields["slug"]
        if not isinstance(slug, str) or not is_valid_slug(slug):
            raise InvalidGeographyInput(f"regions[{index}] slug is not a valid slug")
        label = f"region {slug!r}"
        if slug in regions:
            raise InvalidGeographyInput(f"{label}: the slug is not unique")

        name = fields["name_en"]
        if not isinstance(name, str) or not name.strip():
            raise InvalidGeographyInput(f"{label}: name_en must be a non-blank string")

        parent = fields["parent"]
        if parent is not None and parent not in regions:
            raise InvalidGeographyInput(
                f"{label}: the parent {parent!r} is not an earlier region"
                " (parents come before their children)"
            )
        if parent is not None and (parent, name.lower()) in sibling_names:
            raise InvalidGeographyInput(f"{label}: a sibling already has the name {name!r}")

        wikidata_id = fields["wikidata_id"]
        if wikidata_id is not None:
            if not isinstance(wikidata_id, str) or _WIKIDATA_ID.fullmatch(wikidata_id) is None:
                raise InvalidGeographyInput(f"{label}: wikidata_id is not a Wikidata identifier")
            if wikidata_id in wikidata_ids:
                raise InvalidGeographyInput(f"{label}: wikidata_id {wikidata_id} is not unique")
            wikidata_ids.add(wikidata_id)

        if parent is not None:
            sibling_names.add((parent, name.lower()))
        regions[slug] = MountainRegion(
            id=region_id_for_slug(slug),
            slug=slug,
            name=LocalizedText(en=name),
            parent_id=None if parent is None else regions[parent].id,
            wikidata_id=wikidata_id,
        )

    return tuple(regions.values())


def _check_region_references(mountains, regions):
    by_slug = {region.slug: region for region in regions}
    by_id = {region.id: region for region in regions}
    used: set[str] = set()

    for mountain in mountains:
        slug = mountain.region_slug
        if slug is not None and slug not in by_slug:
            raise InvalidGeographyInput(
                f"mountain {mountain.slug!r}: region {slug!r} is not in regions"
            )
        while slug is not None and slug not in used:
            used.add(slug)
            parent_id = by_slug[slug].parent_id
            slug = None if parent_id is None else by_id[parent_id].slug

    unused = sorted(set(by_slug) - used)
    if unused:
        raise InvalidGeographyInput(
            f"regions that no mountain is in, directly or through a child: {', '.join(unused)}"
        )


def _object(value, keys, label):
    if not isinstance(value, Mapping):
        raise InvalidGeographyInput(f"{label} must be an object")
    if set(value) != keys:
        raise InvalidGeographyInput(
            f"{label}: unexpected keys {sorted(set(value) - keys)},"
            f" missing keys {sorted(keys - set(value))}"
        )

    return value
