import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    ImageDimensions,
    Mountain,
    OsmReference,
    OsmType,
)
from serendipeak.catalog.errors import InvalidFrozenCatalog

FROZEN_CATALOG_VERSION = "v1"
COORDINATE_TOLERANCE_DEGREES = 1e-7
CAMERA_TOLERANCE = 1e-9

_OSM_URL = re.compile(r"https://www\.openstreetmap\.org/(node|way|relation)/([1-9][0-9]*)")
_WIKIDATA_URL = re.compile(r"https://www\.wikidata\.org/wiki/(Q[1-9][0-9]*)")


@dataclass(frozen=True, slots=True)
class FrozenImageIdentity:
    source_identifier: str
    source_page_url: str
    dimensions: ImageDimensions


@dataclass(frozen=True, slots=True)
class FrozenMountain:
    slug: str
    name: str
    coordinates: Coordinates
    elevation_meters: int
    camera: CanonicalCamera
    osm: OsmReference
    wikidata_id: str
    image: FrozenImageIdentity


@dataclass(frozen=True, slots=True)
class FrozenComparison:
    total: int
    matched: int
    mismatches: tuple[str, ...]


def parse_frozen_catalog(document: object) -> tuple[FrozenMountain, ...]:
    try:
        if document["version"] != FROZEN_CATALOG_VERSION:
            raise InvalidFrozenCatalog(f"frozen catalog is not {FROZEN_CATALOG_VERSION}")
        return tuple(_frozen_mountain(raw) for raw in document["mountains"])
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidFrozenCatalog(f"frozen catalog is malformed: {error!r}") from error


def compare_with_frozen_catalog(
    frozen: Sequence[FrozenMountain], mountains: Iterable[Mountain]
) -> FrozenComparison:
    by_slug = {mountain.slug: mountain for mountain in mountains}
    mismatches = []
    matched = 0
    for expected in frozen:
        actual = by_slug.get(expected.slug)
        differences = (
            ["missing from the catalog"] if actual is None else _differences(expected, actual)
        )
        if differences:
            mismatches.append(f"{expected.slug}: {', '.join(differences)}")
        else:
            matched += 1
    frozen_slugs = {expected.slug for expected in frozen}
    mismatches.extend(
        f"{slug}: public mountain not in the frozen catalog"
        for slug, mountain in sorted(by_slug.items())
        if slug not in frozen_slugs and mountain.status in PUBLIC_STATUSES
    )
    return FrozenComparison(total=len(frozen), matched=matched, mismatches=tuple(mismatches))


def _differences(expected: FrozenMountain, actual: Mountain) -> list[str]:
    differences = []
    if actual.status not in PUBLIC_STATUSES:
        differences.append(f"status {actual.status} is not public")
    if actual.name != expected.name:
        differences.append("name differs")
    if not _coordinates_match(expected.coordinates, actual.coordinates):
        differences.append("coordinates differ")
    if actual.elevation_meters != expected.elevation_meters:
        differences.append("elevation differs")
    if actual.camera is None or not _camera_matches(expected.camera, actual.camera):
        differences.append("camera differs")
    if actual.osm != expected.osm:
        differences.append("OpenStreetMap reference differs")
    if actual.wikidata_id != expected.wikidata_id:
        differences.append("Wikidata id differs")
    image = actual.primary_image
    if image is None or expected.image != FrozenImageIdentity(
        source_identifier=image.source_identifier,
        source_page_url=image.source_page_url,
        dimensions=image.dimensions,
    ):
        differences.append("primary image identity differs")
    return differences


def _coordinates_match(expected: Coordinates, actual: Coordinates) -> bool:
    return _close(expected.latitude, actual.latitude, COORDINATE_TOLERANCE_DEGREES) and _close(
        expected.longitude, actual.longitude, COORDINATE_TOLERANCE_DEGREES
    )


def _camera_matches(expected: CanonicalCamera, actual: CanonicalCamera) -> bool:
    if actual.framing is None or expected.framing is None:
        return actual.framing == expected.framing
    pairs = (
        (expected.heading_degrees, actual.heading_degrees),
        (expected.pitch_degrees, actual.pitch_degrees),
        (expected.range_meters, actual.range_meters),
        (expected.framing.x, actual.framing.x),
        (expected.framing.y, actual.framing.y),
    )
    return all(_close(want, got, CAMERA_TOLERANCE) for want, got in pairs)


def _close(expected: float, actual: float, tolerance: float) -> bool:
    return math.isclose(expected, actual, rel_tol=0.0, abs_tol=tolerance)


def _frozen_mountain(raw) -> FrozenMountain:
    slug = raw["slug"]
    osm = _OSM_URL.fullmatch(raw["sources"]["osm"])
    wikidata = _WIKIDATA_URL.fullmatch(raw["sources"]["wikidata"])
    if osm is None or wikidata is None:
        raise InvalidFrozenCatalog(f"{slug}: unexpected source URLs")
    pose = raw["camera"]
    image = raw["primaryImage"]
    return FrozenMountain(
        slug=slug,
        name=raw["name"],
        coordinates=Coordinates(
            latitude=float(raw["coordinates"]["latitude"]),
            longitude=float(raw["coordinates"]["longitude"]),
        ),
        elevation_meters=int(raw["elevationMeters"]),
        camera=CanonicalCamera(
            heading_degrees=float(pose["headingDegrees"]),
            pitch_degrees=float(pose["pitchDegrees"]),
            range_meters=float(pose["rangeMeters"]),
            framing=CameraFraming(x=float(pose["framing"]["x"]), y=float(pose["framing"]["y"])),
        ),
        osm=OsmReference(type=OsmType(osm.group(1)), id=int(osm.group(2))),
        wikidata_id=wikidata.group(1),
        image=FrozenImageIdentity(
            source_identifier=image["sourceIdentifier"],
            source_page_url=image["sourcePageUrl"],
            dimensions=ImageDimensions(width=int(image["width"]), height=int(image["height"])),
        ),
    )
