import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from uuid import UUID

from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSeed,
    ImageProvenance,
)
from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    ImageDimensions,
    Mountain,
    MountainStatus,
    OsmReference,
    OsmType,
    PrimaryImage,
)
from serendipeak.catalog.errors import InvalidCatalogSeed

SEED_FORMAT = "serendipeak.legacy-catalog"
SEED_FORMAT_VERSION = 1
LEGACY_TAG = "v1-behavioral-freeze"
LEGACY_COMMIT = "f9a66deb2c0591a9c574fb4751b938b5863e6a1e"

_LEGACY_STATUSES = {
    "active": MountainStatus.ACTIVE,
    "inactive": MountainStatus.INACTIVE,
    "pending_media": MountainStatus.DRAFT,
}

_SEED_KEYS = {"format", "format_version", "exported_on", "source", "counts", "content_sha256"}
_SOURCE_KEYS = {"tag", "commit", "database_schema_version", "media_manifest"}
_COUNT_KEYS = {"mountains", "mountain_images", "media_approvals", "daily_discoveries"}
_CONTENT_KEYS = {"mountains", "daily_discoveries"}
_MOUNTAIN_KEYS = {
    "id",
    "slug",
    "name",
    "latitude",
    "longitude",
    "elevation_meters",
    "prominence_meters",
    "range_name",
    "countries",
    "summary",
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
    "osm_type",
    "osm_id",
    "wikidata_id",
    "wikipedia_url",
    "status",
    "created_at",
    "updated_at",
    "image",
}
_IMAGE_KEYS = {
    "source_identifier",
    "source_page_url",
    "url",
    "thumbnail_url",
    "width",
    "height",
    "creator",
    "attribution",
    "license_name",
    "license_url",
    "license_reported",
    "license_election_basis_url",
    "approved_on",
}
_DISCOVERY_KEYS = {"date", "mountain_id", "created_at"}


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def content_sha256(content: object) -> str:
    return hashlib.sha256(_canonical_json(content).encode("utf-8")).hexdigest()


def parse_catalog_seed(document: object) -> CatalogSeed:
    seed = _object(document, {*_SEED_KEYS, "content"}, "seed")
    if seed["format"] != SEED_FORMAT or seed["format_version"] != SEED_FORMAT_VERSION:
        raise InvalidCatalogSeed(f"seed is not {SEED_FORMAT} version {SEED_FORMAT_VERSION}")

    _date(seed["exported_on"], "exported_on")

    source = _object(seed["source"], _SOURCE_KEYS, "source")
    if source["tag"] != LEGACY_TAG or source["commit"] != LEGACY_COMMIT:
        raise InvalidCatalogSeed(f"seed was not exported from {LEGACY_TAG} at {LEGACY_COMMIT}")
    content = _object(seed["content"], _CONTENT_KEYS, "content")

    try:
        digest = content_sha256(content)
    except (TypeError, ValueError) as error:
        raise InvalidCatalogSeed(f"content is not canonical JSON: {error}") from error
    if digest != seed["content_sha256"]:
        raise InvalidCatalogSeed(f"content_sha256 does not match the content ({digest})")

    mountains = tuple(
        _mountain(raw, f"content.mountains[{index}]")
        for index, raw in enumerate(_list(content["mountains"], "content.mountains"))
    )
    discoveries = tuple(
        _discovery(raw, f"content.daily_discoveries[{index}]")
        for index, raw in enumerate(
            _list(content["daily_discoveries"], "content.daily_discoveries")
        )
    )

    _check_counts(_object(seed["counts"], _COUNT_KEYS, "counts"), mountains, discoveries)
    _check_references(mountains, discoveries)

    return CatalogSeed(mountains=mountains, discoveries=discoveries)


def _check_counts(counts, mountains, discoveries):
    images = [entry for entry in mountains if entry.image_provenance is not None]
    actual = {
        "mountains": len(mountains),
        "mountain_images": len(images),
        "media_approvals": sum(entry.image_provenance.approved_on is not None for entry in images),
        "daily_discoveries": len(discoveries),
    }

    if dict(counts) != actual:
        raise InvalidCatalogSeed(f"counts {dict(counts)} do not match the content {actual}")


def _check_references(mountains, discoveries):
    ids = {entry.mountain.id for entry in mountains}

    if len(ids) != len(mountains):
        raise InvalidCatalogSeed("mountain ids are not unique")
    if len({entry.mountain.slug for entry in mountains}) != len(mountains):
        raise InvalidCatalogSeed("mountain slugs are not unique")
    if len({discovery.date for discovery in discoveries}) != len(discoveries):
        raise InvalidCatalogSeed("daily discovery dates are not unique")

    for discovery in discoveries:
        if discovery.mountain_id not in ids:
            raise InvalidCatalogSeed(
                f"daily discovery {discovery.date} references unknown mountain"
                f" {discovery.mountain_id}"
            )


def _mountain(raw, label):
    fields = _object(raw, _MOUNTAIN_KEYS, label)
    slug = _text(fields["slug"], f"{label} slug")
    label = f"mountain {slug!r}"

    latitude = _number(fields["latitude"], f"{label} latitude")
    longitude = _number(fields["longitude"], f"{label} longitude")
    if not coordinates_in_range(latitude, longitude):
        raise InvalidCatalogSeed(f"{label}: coordinates ({latitude}, {longitude}) out of range")

    status = _LEGACY_STATUSES.get(_text(fields["status"], f"{label} status"))
    if status is None:
        raise InvalidCatalogSeed(f"{label}: unknown status {fields['status']!r}")

    image, provenance = (None, None) if fields["image"] is None else _image(fields["image"], label)
    mountain = Mountain(
        id=_uuid(fields["id"], f"{label} id"),
        slug=slug,
        name=_text(fields["name"], f"{label} name"),
        status=status,
        coordinates=Coordinates(latitude=latitude, longitude=longitude),
        elevation_meters=_integer(fields["elevation_meters"], f"{label} elevation_meters"),
        prominence_meters=_optional(_integer, fields["prominence_meters"], f"{label} prominence"),
        range_name=_optional(_text, fields["range_name"], f"{label} range_name"),
        countries=tuple(
            _text(country, f"{label} countries")
            for country in _list(fields["countries"], f"{label} countries")
        ),
        summary=_optional(_text, fields["summary"], f"{label} summary"),
        camera=_camera(fields, label),
        primary_image=image,
        osm=_osm(fields, label),
        wikidata_id=_optional(_text, fields["wikidata_id"], f"{label} wikidata_id"),
        wikipedia_url=_optional(_text, fields["wikipedia_url"], f"{label} wikipedia_url"),
    )

    return CatalogMountain(
        mountain=mountain,
        image_provenance=provenance,
        created_at=_timestamp(fields["created_at"], f"{label} created_at"),
        updated_at=_timestamp(fields["updated_at"], f"{label} updated_at"),
    )


def _camera(fields, label):
    pose = [
        fields[f"camera_{name}"] for name in ("heading_degrees", "pitch_degrees", "range_meters")
    ]
    framing = [fields["camera_framing_x"], fields["camera_framing_y"]]

    if all(value is None for value in [*pose, *framing]):
        return None

    if any(value is None for value in pose) or (None in framing and framing != [None, None]):
        raise InvalidCatalogSeed(f"{label}: incomplete camera")

    heading, pitch, range_ = (_number(value, f"{label} camera") for value in pose)

    return CanonicalCamera(
        heading_degrees=heading,
        pitch_degrees=pitch,
        range_meters=range_,
        framing=None
        if framing == [None, None]
        else CameraFraming(
            x=_number(framing[0], f"{label} camera_framing_x"),
            y=_number(framing[1], f"{label} camera_framing_y"),
        ),
    )


def _osm(fields, label):
    osm_type, osm_id = fields["osm_type"], fields["osm_id"]
    if osm_type is None and osm_id is None:
        return None

    if osm_type not in tuple(OsmType):
        raise InvalidCatalogSeed(f"{label}: invalid OpenStreetMap reference")

    return OsmReference(type=OsmType(osm_type), id=_integer(osm_id, f"{label} osm_id"))


def _image(raw, label):
    label = f"{label} image"
    fields = _object(raw, _IMAGE_KEYS, label)

    width, height = fields["width"], fields["height"]
    if (width is None) != (height is None):
        raise InvalidCatalogSeed(f"{label}: incomplete dimensions")

    # The seed's thumbnail is validated like the rest of the document and then dropped:
    # delivery renditions are owned, so nothing consumes a Wikimedia thumbnail.
    _optional(_text, fields["thumbnail_url"], f"{label} thumbnail_url")

    image = PrimaryImage(
        media=None,
        dimensions=None
        if width is None
        else ImageDimensions(
            width=_integer(width, f"{label} width"), height=_integer(height, f"{label} height")
        ),
        creator=_optional(_text, fields["creator"], f"{label} creator"),
        creator_url=None,
        attribution=_text(fields["attribution"], f"{label} attribution"),
        license_name=_optional(_text, fields["license_name"], f"{label} license_name"),
        license_url=_optional(_text, fields["license_url"], f"{label} license_url"),
        source_page_url=_text(fields["source_page_url"], f"{label} source_page_url"),
        source_identifier=_text(fields["source_identifier"], f"{label} source_identifier"),
    )
    provenance = ImageProvenance(
        legacy_file_url=_text(fields["url"], f"{label} url"),
        license_reported=_optional(_text, fields["license_reported"], f"{label} license_reported"),
        license_election_basis_url=_optional(
            _text, fields["license_election_basis_url"], f"{label} license_election_basis_url"
        ),
        approved_on=_optional(_date, fields["approved_on"], f"{label} approved_on"),
    )

    return image, provenance


def _discovery(raw, label):
    fields = _object(raw, _DISCOVERY_KEYS, label)
    return CatalogDiscovery(
        date=_date(fields["date"], f"{label} date"),
        mountain_id=_uuid(fields["mountain_id"], f"{label} mountain_id"),
        created_at=_timestamp(fields["created_at"], f"{label} created_at"),
    )


def _object(value, keys, label):
    if not isinstance(value, Mapping):
        raise InvalidCatalogSeed(f"{label} must be an object")

    if set(value) != keys:
        raise InvalidCatalogSeed(
            f"{label}: unexpected keys {sorted(set(value) - keys)},"
            f" missing keys {sorted(keys - set(value))}"
        )

    return value


def _list(value, label):
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise InvalidCatalogSeed(f"{label} must be a list")
    return value


def _optional(parse, value, label):
    return None if value is None else parse(value, label)


def _text(value, label):
    if not isinstance(value, str):
        raise InvalidCatalogSeed(f"{label} must be a string")
    return value


def _integer(value, label):
    if type(value) is not int:
        raise InvalidCatalogSeed(f"{label} must be an integer")
    return value


def _number(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise InvalidCatalogSeed(f"{label} must be a finite number")
    return float(value)


def _uuid(value, label):
    try:
        return UUID(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSeed(f"{label} is not a UUID") from error


def _date(value, label):
    try:
        return date.fromisoformat(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSeed(f"{label} is not an ISO date") from error


def _timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(_text(value, label))
    except ValueError as error:
        raise InvalidCatalogSeed(f"{label} is not an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise InvalidCatalogSeed(f"{label} has no UTC offset")

    return parsed.astimezone(UTC)
