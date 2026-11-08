import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSnapshot,
)
from serendipeak.catalog.canonical_json import content_sha256
from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import (
    WIKIDATA_ID_PATTERN,
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    ImageDimensions,
    Mountain,
    MountainStatus,
    PhotographMedia,
    PrimaryImage,
)
from serendipeak.catalog.errors import InvalidCatalogSnapshot
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import (
    MountainRegion,
    RegionCycle,
    UnknownRegion,
    build_region_path,
)
from serendipeak.catalog.slug import is_valid_slug

SNAPSHOT_FORMAT = "serendipeak.catalog-snapshot"
SNAPSHOT_FORMAT_VERSION = 1

_SHA256 = re.compile(r"[0-9a-f]{64}")
_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)

_DOCUMENT_KEYS = {"format", "version", "content_sha256", "content"}
_CONTENT_KEYS = {"regions", "mountains", "daily_discoveries"}
_REGION_KEYS = {"id", "slug", "parent", "name", "wikidata_id"}
_MOUNTAIN_KEYS = {
    "id",
    "slug",
    "name",
    "status",
    "latitude",
    "longitude",
    "elevation_meters",
    "continent",
    "countries",
    "region",
    "summary",
    "camera",
    "osm_node_id",
    "wikidata_id",
    "image",
    "created_at",
    "updated_at",
}
_TEXT_KEYS = {"en", "es", "pt"}
_CAMERA_KEYS = {"heading_degrees", "pitch_degrees", "range_meters", "framing"}
_FRAMING_KEYS = {"x", "y"}
_IMAGE_KEYS = {
    "media",
    "dimensions",
    "author",
    "license_name",
    "license_url",
    "source_page_url",
}
_MEDIA_KEYS = {"original_key", "original_sha256", "page_key", "viewer_key"}
_DIMENSION_KEYS = {"width", "height"}
_DISCOVERY_KEYS = {"date", "mountain_id", "created_at"}


@dataclass(frozen=True, slots=True)
class CatalogSummary:
    mountains: int
    by_status: Mapping[str, int]
    by_continent: Mapping[str, int]
    country_links: int
    mountains_in_a_region: int
    regions: int
    photographs: int
    photographs_with_media: int
    daily_discoveries: int


def summarize_catalog(catalog: CatalogSnapshot) -> CatalogSummary:
    mountains = [entry.mountain for entry in catalog.mountains]
    images = [mountain.primary_image for mountain in mountains if mountain.primary_image]

    return CatalogSummary(
        mountains=len(mountains),
        by_status=dict(sorted(Counter(mountain.status.value for mountain in mountains).items())),
        by_continent=dict(
            sorted(Counter(mountain.continent.code for mountain in mountains).items())
        ),
        country_links=sum(len(mountain.countries) for mountain in mountains),
        mountains_in_a_region=sum(mountain.region is not None for mountain in mountains),
        regions=len(catalog.regions),
        photographs=len(images),
        photographs_with_media=sum(image.media is not None for image in images),
        daily_discoveries=len(catalog.discoveries),
    )


def in_document_order(catalog: CatalogSnapshot) -> CatalogSnapshot:
    return CatalogSnapshot(
        mountains=tuple(sorted(catalog.mountains, key=lambda entry: entry.mountain.slug)),
        discoveries=tuple(sorted(catalog.discoveries, key=lambda discovery: discovery.date)),
        regions=tuple(sorted(catalog.regions, key=lambda region: region.slug)),
    )


def snapshot_document(catalog: CatalogSnapshot) -> dict:
    """The canonical document of a catalog: every list is in a fixed order, so the same catalog
    always yields the same content and the same checksum."""
    regions = {region.id: region for region in catalog.regions}
    content = {
        "regions": [
            _region_content(region, regions)
            for region in sorted(catalog.regions, key=lambda region: region.slug)
        ],
        "mountains": [
            _mountain_content(entry)
            for entry in sorted(catalog.mountains, key=lambda entry: entry.mountain.slug)
        ],
        "daily_discoveries": [
            {
                "date": discovery.date.isoformat(),
                "mountain_id": str(discovery.mountain_id),
                "created_at": _timestamp_content(discovery.created_at),
            }
            for discovery in sorted(catalog.discoveries, key=lambda discovery: discovery.date)
        ],
    }

    return {
        "format": SNAPSHOT_FORMAT,
        "version": SNAPSHOT_FORMAT_VERSION,
        "content_sha256": content_sha256(content),
        "content": content,
    }


def verified_snapshot_content(document: object, expected_sha256: str) -> Mapping:
    """The content of a document whose checksum is the one expected, and nothing else is read:
    a document that was altered, truncated or is not the one the caller means is refused before
    anything is judged or stored."""
    if not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256):
        raise InvalidCatalogSnapshot("the expected checksum is not a lowercase SHA-256 digest")

    fields = _object(document, _DOCUMENT_KEYS, "snapshot")
    if fields["format"] != SNAPSHOT_FORMAT or fields["version"] != SNAPSHOT_FORMAT_VERSION:
        raise InvalidCatalogSnapshot(
            f"snapshot is not {SNAPSHOT_FORMAT} version {SNAPSHOT_FORMAT_VERSION}"
        )

    content = _object(fields["content"], _CONTENT_KEYS, "content")
    try:
        digest = content_sha256(content)
    except (TypeError, ValueError) as error:
        raise InvalidCatalogSnapshot(f"content is not canonical JSON: {error}") from error
    if digest != fields["content_sha256"]:
        raise InvalidCatalogSnapshot(f"content_sha256 does not match the content ({digest})")
    if digest != expected_sha256:
        raise InvalidCatalogSnapshot(
            f"the snapshot has checksum {digest}, not the expected {expected_sha256}"
        )

    return content


def catalog_from_snapshot_content(
    content: Mapping, reference: GeographyReference
) -> CatalogSnapshot:
    """Resolve the continent and country codes against the reference data, which the snapshot
    does not carry, and build the catalog. A code the reference lacks is refused."""
    regions = _regions(_list(content["regions"], "content.regions"))
    region_ids = {region.slug: region.id for region in regions.values()}
    mountains = tuple(
        _mountain(raw, f"content.mountains[{index}]", reference, regions, region_ids)
        for index, raw in enumerate(_list(content["mountains"], "content.mountains"))
    )
    discoveries = tuple(
        _discovery(raw, f"content.daily_discoveries[{index}]")
        for index, raw in enumerate(
            _list(content["daily_discoveries"], "content.daily_discoveries")
        )
    )
    _check_references(mountains, discoveries)

    return CatalogSnapshot(
        mountains=mountains,
        discoveries=discoveries,
        regions=tuple(sorted(regions.values(), key=lambda region: region.slug)),
    )


def _region_content(region: MountainRegion, regions: Mapping[UUID, MountainRegion]) -> dict:
    return {
        "id": str(region.id),
        "slug": region.slug,
        "parent": None if region.parent_id is None else regions[region.parent_id].slug,
        "name": _text_content(region.name),
        "wikidata_id": region.wikidata_id,
    }


def _mountain_content(entry: CatalogMountain) -> dict:
    mountain = entry.mountain

    return {
        "id": str(mountain.id),
        "slug": mountain.slug,
        "name": _text_content(mountain.name),
        "status": mountain.status.value,
        "latitude": mountain.coordinates.latitude,
        "longitude": mountain.coordinates.longitude,
        "elevation_meters": mountain.elevation_meters,
        "continent": mountain.continent.code,
        "countries": sorted(country.code for country in mountain.countries),
        "region": None if mountain.region is None else mountain.region.region.slug,
        "summary": None if mountain.summary is None else _text_content(mountain.summary),
        "camera": None if mountain.camera is None else _camera_content(mountain.camera),
        "osm_node_id": mountain.osm_node_id,
        "wikidata_id": mountain.wikidata_id,
        "image": None if mountain.primary_image is None else _image_content(mountain.primary_image),
        "created_at": _timestamp_content(entry.created_at),
        "updated_at": _timestamp_content(entry.updated_at),
    }


def _text_content(text: LocalizedText) -> dict:
    return {"en": text.en, "es": text.es, "pt": text.pt}


def _camera_content(camera: CanonicalCamera) -> dict:
    framing = camera.framing

    return {
        "heading_degrees": camera.heading_degrees,
        "pitch_degrees": camera.pitch_degrees,
        "range_meters": camera.range_meters,
        "framing": None if framing is None else {"x": framing.x, "y": framing.y},
    }


def _image_content(image: PrimaryImage) -> dict:
    media = image.media
    dimensions = image.dimensions

    return {
        "media": None
        if media is None
        else {
            "original_key": media.original_key,
            "original_sha256": media.original_sha256,
            "page_key": media.page_key,
            "viewer_key": media.viewer_key,
        },
        "dimensions": None
        if dimensions is None
        else {"width": dimensions.width, "height": dimensions.height},
        "author": image.author,
        "license_name": image.license_name,
        "license_url": image.license_url,
        "source_page_url": image.source_page_url,
    }


def _timestamp_content(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _regions(raw_regions: Sequence) -> dict[UUID, MountainRegion]:
    parsed = [
        (_object(raw, _REGION_KEYS, f"content.regions[{index}]"), f"content.regions[{index}]")
        for index, raw in enumerate(raw_regions)
    ]
    ids = {_uuid(fields["id"], f"{label} id") for fields, label in parsed}
    slugs = {_text(fields["slug"], f"{label} slug") for fields, label in parsed}
    if len(ids) != len(parsed):
        raise InvalidCatalogSnapshot("region ids are not unique")
    if len(slugs) != len(parsed):
        raise InvalidCatalogSnapshot("region slugs are not unique")

    id_of = {_text(fields["slug"], label): _uuid(fields["id"], label) for fields, label in parsed}
    regions = {}
    for fields, label in parsed:
        slug = _text(fields["slug"], f"{label} slug")
        if not is_valid_slug(slug):
            raise InvalidCatalogSnapshot(f"{label}: {slug!r} is not a valid slug")
        parent = _optional(_text, fields["parent"], f"{label} parent")
        if parent is not None and parent not in id_of:
            raise InvalidCatalogSnapshot(f"region {slug!r} has the unknown parent {parent!r}")
        wikidata_id = _wikidata_id(fields["wikidata_id"], f"region {slug!r}")
        region = MountainRegion(
            id=id_of[slug],
            slug=slug,
            name=_localized(fields["name"], f"region {slug!r} name"),
            parent_id=None if parent is None else id_of[parent],
            wikidata_id=wikidata_id,
        )
        regions[region.id] = region

    for region_id in regions:
        try:
            build_region_path(region_id, regions)
        except RegionCycle as error:
            raise InvalidCatalogSnapshot(str(error)) from error

    return regions


def _mountain(raw, label, reference, regions, region_ids):
    fields = _object(raw, _MOUNTAIN_KEYS, label)
    slug = _text(fields["slug"], f"{label} slug")
    if not is_valid_slug(slug):
        raise InvalidCatalogSnapshot(f"{label}: {slug!r} is not a valid slug")
    label = f"mountain {slug!r}"

    latitude = _number(fields["latitude"], f"{label} latitude")
    longitude = _number(fields["longitude"], f"{label} longitude")
    if not coordinates_in_range(latitude, longitude):
        raise InvalidCatalogSnapshot(f"{label}: coordinates ({latitude}, {longitude}) out of range")

    try:
        status = MountainStatus(_text(fields["status"], f"{label} status"))
    except ValueError as error:
        raise InvalidCatalogSnapshot(f"{label}: unknown status {fields['status']!r}") from error

    continent_code = _text(fields["continent"], f"{label} continent")
    continent = reference.continents.get(continent_code)
    if continent is None:
        raise InvalidCatalogSnapshot(
            f"{label}: continent {continent_code!r} is not in the reference"
        )

    country_codes = [
        _text(code, f"{label} countries")
        for code in _list(fields["countries"], f"{label} countries")
    ]
    if len(set(country_codes)) != len(country_codes):
        raise InvalidCatalogSnapshot(f"{label}: countries repeat a code")
    unknown = sorted(set(country_codes) - set(reference.countries))
    if unknown:
        raise InvalidCatalogSnapshot(f"{label}: countries {unknown} are not in the reference")

    region_slug = _optional(_text, fields["region"], f"{label} region")
    region = None
    if region_slug is not None:
        if region_slug not in region_ids:
            raise InvalidCatalogSnapshot(f"{label}: unknown region {region_slug!r}")
        try:
            region = build_region_path(region_ids[region_slug], regions)
        except (RegionCycle, UnknownRegion) as error:
            raise InvalidCatalogSnapshot(str(error)) from error

    mountain = Mountain(
        id=_uuid(fields["id"], f"{label} id"),
        slug=slug,
        name=_localized(fields["name"], f"{label} name"),
        status=status,
        coordinates=Coordinates(latitude=latitude, longitude=longitude),
        elevation_meters=_integer(fields["elevation_meters"], f"{label} elevation_meters"),
        continent=continent,
        countries=tuple(
            sorted(
                (reference.countries[code] for code in country_codes),
                key=lambda country: (country.name.en, country.code),
            )
        ),
        region=region,
        summary=_optional(_localized, fields["summary"], f"{label} summary"),
        camera=_optional(_camera, fields["camera"], f"{label} camera"),
        primary_image=_optional(_image, fields["image"], f"{label} image"),
        osm_node_id=_optional(_integer, fields["osm_node_id"], f"{label} osm_node_id"),
        wikidata_id=_wikidata_id(fields["wikidata_id"], label),
    )

    return CatalogMountain(
        mountain=mountain,
        created_at=_timestamp(fields["created_at"], f"{label} created_at"),
        updated_at=_timestamp(fields["updated_at"], f"{label} updated_at"),
    )


def _localized(raw, label):
    fields = _object(raw, _TEXT_KEYS, label)

    return LocalizedText(
        en=_text(fields["en"], f"{label} en"),
        es=_optional(_text, fields["es"], f"{label} es"),
        pt=_optional(_text, fields["pt"], f"{label} pt"),
    )


def _camera(raw, label):
    fields = _object(raw, _CAMERA_KEYS, label)
    framing = _optional(_framing, fields["framing"], f"{label} framing")

    return CanonicalCamera(
        heading_degrees=_number(fields["heading_degrees"], f"{label} heading_degrees"),
        pitch_degrees=_number(fields["pitch_degrees"], f"{label} pitch_degrees"),
        range_meters=_number(fields["range_meters"], f"{label} range_meters"),
        framing=framing,
    )


def _framing(raw, label):
    fields = _object(raw, _FRAMING_KEYS, label)

    return CameraFraming(x=_number(fields["x"], f"{label} x"), y=_number(fields["y"], f"{label} y"))


def _image(raw, label):
    fields = _object(raw, _IMAGE_KEYS, label)

    return PrimaryImage(
        media=_optional(_media, fields["media"], f"{label} media"),
        dimensions=_optional(_dimensions, fields["dimensions"], f"{label} dimensions"),
        author=_text(fields["author"], f"{label} author"),
        license_name=_optional(_text, fields["license_name"], f"{label} license_name"),
        license_url=_optional(_text, fields["license_url"], f"{label} license_url"),
        source_page_url=_optional(_text, fields["source_page_url"], f"{label} source_page_url"),
    )


def _media(raw, label):
    fields = _object(raw, _MEDIA_KEYS, label)

    return PhotographMedia(
        original_key=_text(fields["original_key"], f"{label} original_key"),
        original_sha256=_text(fields["original_sha256"], f"{label} original_sha256"),
        page_key=_text(fields["page_key"], f"{label} page_key"),
        viewer_key=_text(fields["viewer_key"], f"{label} viewer_key"),
    )


def _dimensions(raw, label):
    fields = _object(raw, _DIMENSION_KEYS, label)

    return ImageDimensions(
        width=_integer(fields["width"], f"{label} width"),
        height=_integer(fields["height"], f"{label} height"),
    )


def _discovery(raw, label):
    fields = _object(raw, _DISCOVERY_KEYS, label)

    return CatalogDiscovery(
        date=_date(fields["date"], f"{label} date"),
        mountain_id=_uuid(fields["mountain_id"], f"{label} mountain_id"),
        created_at=_timestamp(fields["created_at"], f"{label} created_at"),
    )


def _check_references(mountains, discoveries):
    ids = {entry.mountain.id for entry in mountains}

    if len(ids) != len(mountains):
        raise InvalidCatalogSnapshot("mountain ids are not unique")
    if len({entry.mountain.slug for entry in mountains}) != len(mountains):
        raise InvalidCatalogSnapshot("mountain slugs are not unique")
    if len({discovery.date for discovery in discoveries}) != len(discoveries):
        raise InvalidCatalogSnapshot("daily discovery dates are not unique")

    for discovery in discoveries:
        if discovery.mountain_id not in ids:
            raise InvalidCatalogSnapshot(
                f"daily discovery {discovery.date} references unknown mountain"
                f" {discovery.mountain_id}"
            )


def _wikidata_id(value, label):
    wikidata_id = _optional(_text, value, f"{label} wikidata_id")
    if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
        raise InvalidCatalogSnapshot(f"{label}: {wikidata_id!r} is not a Wikidata id")

    return wikidata_id


def _object(value, keys, label):
    if not isinstance(value, Mapping):
        raise InvalidCatalogSnapshot(f"{label} must be an object")

    if set(value) != keys:
        raise InvalidCatalogSnapshot(
            f"{label}: unexpected keys {sorted(set(value) - keys)},"
            f" missing keys {sorted(keys - set(value))}"
        )

    return value


def _list(value, label):
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise InvalidCatalogSnapshot(f"{label} must be a list")
    return value


def _optional(parse, value, label):
    return None if value is None else parse(value, label)


def _text(value, label):
    if not isinstance(value, str):
        raise InvalidCatalogSnapshot(f"{label} must be a string")
    return value


def _integer(value, label):
    if type(value) is not int:
        raise InvalidCatalogSnapshot(f"{label} must be an integer")
    return value


def _number(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise InvalidCatalogSnapshot(f"{label} must be a finite number")
    return float(value)


def _uuid(value, label):
    try:
        return UUID(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSnapshot(f"{label} is not a UUID") from error


def _date(value, label):
    try:
        return date.fromisoformat(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSnapshot(f"{label} is not an ISO date") from error


def _timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSnapshot(f"{label} is not an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise InvalidCatalogSnapshot(f"{label} has no UTC offset")

    return parsed.astimezone(UTC)
