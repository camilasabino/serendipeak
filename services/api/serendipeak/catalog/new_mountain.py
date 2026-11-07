import re
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN, Coordinates, PrimaryImage
from serendipeak.catalog.public_link import is_public_link
from serendipeak.catalog.publication import PublicationViolation, image_violations
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.catalog.summary import summary_violations

_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)


class NewMountainViolation(StrEnum):
    SLUG_INVALID = "slug_invalid"
    NAME_BLANK = "name_blank"
    COORDINATES_OUT_OF_RANGE = "coordinates_out_of_range"
    ELEVATION_NOT_POSITIVE = "elevation_not_positive"
    SUMMARY_INVALID = "summary_invalid"
    OSM_NODE_ID_NOT_POSITIVE = "osm_node_id_not_positive"
    WIKIDATA_ID_INVALID = "wikidata_id_invalid"
    IMAGE_AUTHOR_MISSING = "image_author_missing"
    IMAGE_LICENSE_NAME_BLANK = "image_license_name_blank"
    IMAGE_LICENSE_URL_WITHOUT_LICENSE = "image_license_url_without_license"
    IMAGE_LICENSE_URL_NOT_PUBLIC_LINK = "image_license_url_not_public_link"
    IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK = "image_source_page_url_not_public_link"


@dataclass(frozen=True, slots=True)
class NewPhotograph:
    """The uploaded file and its credit. Optional texts are None when absent, never blank."""

    data: bytes
    author: str
    license_name: str | None = None
    license_url: str | None = None
    source_page_url: str | None = None


@dataclass(frozen=True, slots=True)
class NewMountain:
    """What an editor supplies to create a draft. The name and summary are English only
    (translations are not written before the localization milestone); the status, the camera
    and the timestamps are never supplied."""

    slug: str
    name: str
    coordinates: Coordinates
    elevation_meters: int
    continent_code: str
    photograph: NewPhotograph
    country_codes: tuple[str, ...] = ()
    region_id: UUID | None = None
    summary: str | None = None
    osm_node_id: int | None = None
    wikidata_id: str | None = None


_VIOLATION_OF_IMAGE = {
    PublicationViolation.IMAGE_AUTHOR_MISSING: NewMountainViolation.IMAGE_AUTHOR_MISSING,
    PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: (
        NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE
    ),
}


def new_mountain_violations(mountain: NewMountain) -> tuple[NewMountainViolation, ...]:
    """Why a draft cannot be stored; empty means it can.

    The rules are the ones the database enforces on a draft, stated before any file is decoded
    or stored. Whether the photograph is an acceptable file is judged when it is processed, and
    whether the continent, countries and region exist when the draft is written. Publication
    rules that a draft may still break (camera, image completeness) are not checked here.
    """
    violations = []

    if not is_valid_slug(mountain.slug):
        violations.append(NewMountainViolation.SLUG_INVALID)
    if not mountain.name.strip():
        violations.append(NewMountainViolation.NAME_BLANK)
    if not coordinates_in_range(mountain.coordinates.latitude, mountain.coordinates.longitude):
        violations.append(NewMountainViolation.COORDINATES_OUT_OF_RANGE)
    if mountain.elevation_meters <= 0:
        violations.append(NewMountainViolation.ELEVATION_NOT_POSITIVE)
    if mountain.summary is not None and summary_violations(mountain.summary):
        violations.append(NewMountainViolation.SUMMARY_INVALID)
    if mountain.osm_node_id is not None and mountain.osm_node_id <= 0:
        violations.append(NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE)
    if mountain.wikidata_id is not None and not _WIKIDATA_ID.fullmatch(mountain.wikidata_id):
        violations.append(NewMountainViolation.WIKIDATA_ID_INVALID)

    violations.extend(_photograph_violations(mountain.photograph))

    return tuple(violations)


def _photograph_violations(photograph: NewPhotograph) -> list[NewMountainViolation]:
    # The media and its dimensions exist only once the file is processed, so the credit rules
    # are judged on an image without them and only the credit's own violations are kept.
    credit = PrimaryImage(
        media=None,
        dimensions=None,
        author=photograph.author,
        license_name=photograph.license_name,
        license_url=photograph.license_url,
        source_page_url=photograph.source_page_url,
    )
    violations = [
        _VIOLATION_OF_IMAGE[violation]
        for violation in image_violations(credit)
        if violation in _VIOLATION_OF_IMAGE
    ]

    if photograph.license_name is not None and not photograph.license_name.strip():
        violations.append(NewMountainViolation.IMAGE_LICENSE_NAME_BLANK)
    if photograph.license_url is not None and not is_public_link(photograph.license_url):
        violations.append(NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK)
    if photograph.source_page_url is not None and not is_public_link(photograph.source_page_url):
        violations.append(NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK)

    return violations
