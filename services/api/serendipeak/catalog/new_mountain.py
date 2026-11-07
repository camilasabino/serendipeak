import re
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import (
    WIKIDATA_ID_PATTERN,
    Coordinates,
    ImageDimensions,
    PhotographMedia,
    PrimaryImage,
)
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
class PhotographCredit:
    """Who made a photograph and under which terms it is shown. Optional texts are None when
    absent, never blank."""

    author: str
    license_name: str | None = None
    license_url: str | None = None
    source_page_url: str | None = None


@dataclass(frozen=True, slots=True)
class NewPhotograph:
    """The uploaded file and its credit. Optional texts are None when absent, never blank."""

    data: bytes
    author: str
    license_name: str | None = None
    license_url: str | None = None
    source_page_url: str | None = None

    @property
    def credit(self) -> PhotographCredit:
        return PhotographCredit(
            author=self.author,
            license_name=self.license_name,
            license_url=self.license_url,
            source_page_url=self.source_page_url,
        )


@dataclass(frozen=True, slots=True)
class NewMountain:
    """What an editor supplies to create a draft. The name and summary are English only
    (translations are not written before the localization milestone); the status, the camera
    and the timestamps are never supplied. A draft may have no photograph yet; publishing it
    requires one."""

    slug: str
    name: str
    coordinates: Coordinates
    elevation_meters: int
    continent_code: str
    country_codes: tuple[str, ...] = ()
    region_id: UUID | None = None
    summary: str | None = None
    osm_node_id: int | None = None
    wikidata_id: str | None = None
    photograph: NewPhotograph | None = None


_VIOLATION_OF_IMAGE = {
    PublicationViolation.IMAGE_AUTHOR_MISSING: NewMountainViolation.IMAGE_AUTHOR_MISSING,
    PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: (
        NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE
    ),
}


def content_violations(
    *,
    slug: str,
    name: str,
    elevation_meters: int,
    summary: str | None,
    osm_node_id: int | None,
    wikidata_id: str | None,
    coordinates: Coordinates | None = None,
) -> tuple[NewMountainViolation, ...]:
    """The rules the database enforces on the editable content of a mountain, draft or public.

    Shared by the creation and the update of a mountain, which judge the same columns. The
    coordinates are judged only when given: an update never moves the mountain.
    """
    violations = []

    if not is_valid_slug(slug):
        violations.append(NewMountainViolation.SLUG_INVALID)
    if not name.strip():
        violations.append(NewMountainViolation.NAME_BLANK)
    if coordinates is not None and not coordinates_in_range(
        coordinates.latitude, coordinates.longitude
    ):
        violations.append(NewMountainViolation.COORDINATES_OUT_OF_RANGE)
    if elevation_meters <= 0:
        violations.append(NewMountainViolation.ELEVATION_NOT_POSITIVE)
    if summary is not None and summary_violations(summary):
        violations.append(NewMountainViolation.SUMMARY_INVALID)
    if osm_node_id is not None and osm_node_id <= 0:
        violations.append(NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE)
    if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
        violations.append(NewMountainViolation.WIKIDATA_ID_INVALID)

    return tuple(violations)


def new_mountain_violations(mountain: NewMountain) -> tuple[NewMountainViolation, ...]:
    """Why a draft cannot be stored; empty means it can.

    The rules are the ones the database enforces on a draft, stated before any file is decoded
    or stored. Whether the photograph is an acceptable file is judged when it is processed, and
    whether the continent, countries and region exist when the draft is written. Publication
    rules that a draft may still break (camera, image completeness) are not checked here.
    """
    violations = list(
        content_violations(
            slug=mountain.slug,
            name=mountain.name,
            elevation_meters=mountain.elevation_meters,
            summary=mountain.summary,
            osm_node_id=mountain.osm_node_id,
            wikidata_id=mountain.wikidata_id,
            coordinates=mountain.coordinates,
        )
    )

    if mountain.photograph is not None:
        violations.extend(photograph_violations(mountain.photograph))

    return tuple(violations)


def photograph_violations(photograph: NewPhotograph) -> list[NewMountainViolation]:
    """Why the credit of an uploaded photograph cannot be stored; empty means it can.

    The file itself is judged when it is processed.
    """
    return credit_violations(photograph.credit)


def credit_violations(credit: PhotographCredit) -> list[NewMountainViolation]:
    """Why a photograph credit cannot be stored; empty means it can."""
    # The media and its dimensions exist only once the file is processed, so the credit rules
    # are judged on an image without them and only the credit's own violations are kept.
    image = PrimaryImage(
        media=None,
        dimensions=None,
        author=credit.author,
        license_name=credit.license_name,
        license_url=credit.license_url,
        source_page_url=credit.source_page_url,
    )
    violations = [
        _VIOLATION_OF_IMAGE[violation]
        for violation in image_violations(image)
        if violation in _VIOLATION_OF_IMAGE
    ]

    if credit.license_name is not None and not credit.license_name.strip():
        violations.append(NewMountainViolation.IMAGE_LICENSE_NAME_BLANK)
    if credit.license_url is not None and not is_public_link(credit.license_url):
        violations.append(NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK)
    if credit.source_page_url is not None and not is_public_link(credit.source_page_url):
        violations.append(NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK)

    return violations


def stored_photograph(
    photograph: NewPhotograph, media: PhotographMedia, dimensions: ImageDimensions
) -> PrimaryImage:
    """The photograph record for an uploaded file whose objects are already in storage."""
    return PrimaryImage(
        media=media,
        dimensions=dimensions,
        author=photograph.author,
        license_name=photograph.license_name,
        license_url=photograph.license_url,
        source_page_url=photograph.source_page_url,
    )
