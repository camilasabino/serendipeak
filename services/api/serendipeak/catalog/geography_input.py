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
from serendipeak.catalog.errors import GeographyBackfillRejected, InvalidGeographyInput
from serendipeak.catalog.geography import CONTINENT_CODES, is_country_code
from serendipeak.catalog.slug import is_valid_slug

GEOGRAPHY_FORMAT = "serendipeak.geography"
GEOGRAPHY_FORMAT_VERSION = 1

_SHA256 = re.compile(r"[0-9a-f]{64}")
_DOCUMENT_KEYS = {"format", "version", "content_sha256", "mountains"}
_MOUNTAIN_KEYS = {"id", "slug", "continent", "countries"}


@dataclass(frozen=True, slots=True)
class MountainGeography:
    id: UUID
    slug: str
    continent_code: str
    country_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GeographyInput:
    content_sha256: str
    mountains: tuple[MountainGeography, ...]


@dataclass(frozen=True, slots=True)
class StoredGeography:
    """What the catalog holds for one mountain. legacy_country_names is None once the text
    column that held the v1 names is gone."""

    id: UUID
    slug: str
    legacy_country_names: tuple[str, ...] | None
    continent_code: str | None
    country_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GeographyChange:
    slug: str
    continent: tuple[str | None, str] | None
    added_countries: tuple[str, ...]
    removed_countries: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class BackfillPlan:
    checked: int
    changes: tuple[GeographyChange, ...]

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

    return GeographyInput(content_sha256=actual, mountains=mountains)


def plan_backfill(
    geography: GeographyInput,
    stored: Sequence[StoredGeography],
    known_country_codes: frozenset[str],
) -> BackfillPlan:
    """Judge the input against the catalog and say what applying it would change.

    Raises GeographyBackfillRejected, naming every problem, unless the input covers every stored
    mountain exactly once, every entry has its mountain, and the countries agree with the v1
    names where the catalog still holds them.
    """
    problems = []
    entries = {entry.id: entry for entry in geography.mountains}
    stored_ids = {mountain.id for mountain in stored}

    problems.extend(
        f"entry {entry.slug} ({entry.id}) matches no mountain"
        for entry in geography.mountains
        if entry.id not in stored_ids
    )

    changes = []
    for mountain in sorted(stored, key=lambda item: item.slug):
        entry = entries.get(mountain.id)
        if entry is None:
            problems.append(f"mountain {mountain.slug} ({mountain.id}) has no entry")
            continue
        if entry.slug != mountain.slug:
            problems.append(f"entry {entry.slug} is the entry of mountain {mountain.slug}")
            continue

        entry_problems = _entry_problems(entry, mountain, known_country_codes)
        problems.extend(entry_problems)
        if not entry_problems:
            change = _change(entry, mountain)
            if change is not None:
                changes.append(change)

    if problems:
        raise GeographyBackfillRejected(tuple(problems))

    return BackfillPlan(checked=len(stored), changes=tuple(changes))


def _entry_problems(entry, mountain, known_country_codes):
    problems = [
        f"{entry.slug}: country {code} is not in the reference data"
        for code in entry.country_codes
        if code not in known_country_codes
    ]
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


def _change(entry, mountain):
    wanted = set(entry.country_codes)
    held = set(mountain.country_codes)
    continent = (
        None
        if mountain.continent_code == entry.continent_code
        else (mountain.continent_code, entry.continent_code)
    )
    if continent is None and wanted == held:
        return None

    return GeographyChange(
        slug=entry.slug,
        continent=continent,
        added_countries=tuple(sorted(wanted - held)),
        removed_countries=tuple(sorted(held - wanted)),
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

    return MountainGeography(
        id=mountain_id,
        slug=slug,
        continent_code=continent,
        country_codes=tuple(sorted(countries)),
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
