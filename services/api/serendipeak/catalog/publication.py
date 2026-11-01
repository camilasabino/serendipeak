from enum import StrEnum

from serendipeak.catalog import camera as camera_bounds
from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import CanonicalCamera, Mountain, PrimaryImage
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.catalog.summary import summary_violations

_PUBLIC_DOMAIN_LICENSE_NAME = "Public domain"


class PublicationViolation(StrEnum):
    SLUG_INVALID = "slug_invalid"
    COORDINATES_OUT_OF_RANGE = "coordinates_out_of_range"
    ELEVATION_NOT_POSITIVE = "elevation_not_positive"
    CAMERA_MISSING = "camera_missing"
    CAMERA_OUT_OF_BOUNDS = "camera_out_of_bounds"
    CAMERA_FRAMING_MISSING = "camera_framing_missing"
    CAMERA_FRAMING_OUT_OF_BOUNDS = "camera_framing_out_of_bounds"
    OSM_REFERENCE_MISSING = "osm_reference_missing"
    WIKIDATA_ID_MISSING = "wikidata_id_missing"
    PRIMARY_IMAGE_MISSING = "primary_image_missing"
    IMAGE_URL_MISSING = "image_url_missing"
    IMAGE_ATTRIBUTION_MISSING = "image_attribution_missing"
    IMAGE_SOURCE_PAGE_URL_MISSING = "image_source_page_url_missing"
    IMAGE_SOURCE_IDENTIFIER_MISSING = "image_source_identifier_missing"
    IMAGE_LICENSE_NAME_MISSING = "image_license_name_missing"
    IMAGE_LICENSE_URL_MISSING = "image_license_url_missing"
    IMAGE_PUBLIC_DOMAIN_CREATOR_MISSING = "image_public_domain_creator_missing"
    IMAGE_DIMENSIONS_MISSING = "image_dimensions_missing"
    SUMMARY_INVALID = "summary_invalid"


def publication_violations(mountain: Mountain) -> tuple[PublicationViolation, ...]:
    violations = []

    if not is_valid_slug(mountain.slug):
        violations.append(PublicationViolation.SLUG_INVALID)
    if not coordinates_in_range(mountain.coordinates.latitude, mountain.coordinates.longitude):
        violations.append(PublicationViolation.COORDINATES_OUT_OF_RANGE)
    if mountain.elevation_meters <= 0:
        violations.append(PublicationViolation.ELEVATION_NOT_POSITIVE)

    violations.extend(_camera_violations(mountain.camera))

    if mountain.osm is None:
        violations.append(PublicationViolation.OSM_REFERENCE_MISSING)
    if _is_blank(mountain.wikidata_id):
        violations.append(PublicationViolation.WIKIDATA_ID_MISSING)

    violations.extend(image_violations(mountain.primary_image))

    if mountain.summary is not None and summary_violations(mountain.summary):
        violations.append(PublicationViolation.SUMMARY_INVALID)

    return tuple(violations)


def _camera_violations(camera: CanonicalCamera | None) -> list[PublicationViolation]:
    if camera is None:
        return [PublicationViolation.CAMERA_MISSING]

    violations = []

    if not (
        camera_bounds.HEADING_MIN_DEGREES
        <= camera.heading_degrees
        < camera_bounds.HEADING_MAX_DEGREES_EXCLUSIVE
        and camera_bounds.PITCH_MIN_DEGREES
        <= camera.pitch_degrees
        <= camera_bounds.PITCH_MAX_DEGREES
        and camera_bounds.RANGE_MIN_METERS <= camera.range_meters <= camera_bounds.RANGE_MAX_METERS
    ):
        violations.append(PublicationViolation.CAMERA_OUT_OF_BOUNDS)

    if camera.framing is None:
        violations.append(PublicationViolation.CAMERA_FRAMING_MISSING)
    elif not (
        camera_bounds.FRAMING_MIN <= camera.framing.x <= camera_bounds.FRAMING_MAX
        and camera_bounds.FRAMING_MIN <= camera.framing.y <= camera_bounds.FRAMING_MAX
    ):
        violations.append(PublicationViolation.CAMERA_FRAMING_OUT_OF_BOUNDS)

    return violations


def image_violations(image: PrimaryImage | None) -> list[PublicationViolation]:
    if image is None:
        return [PublicationViolation.PRIMARY_IMAGE_MISSING]
    required = (
        (image.url, PublicationViolation.IMAGE_URL_MISSING),
        (image.attribution, PublicationViolation.IMAGE_ATTRIBUTION_MISSING),
        (image.source_page_url, PublicationViolation.IMAGE_SOURCE_PAGE_URL_MISSING),
        (image.source_identifier, PublicationViolation.IMAGE_SOURCE_IDENTIFIER_MISSING),
        (image.license_name, PublicationViolation.IMAGE_LICENSE_NAME_MISSING),
    )
    violations = [violation for value, violation in required if _is_blank(value)]

    if not _is_blank(image.license_name) and _is_blank(image.license_url):
        if image.license_name.casefold() != _PUBLIC_DOMAIN_LICENSE_NAME.casefold():
            violations.append(PublicationViolation.IMAGE_LICENSE_URL_MISSING)
        elif _is_blank(image.creator):
            violations.append(PublicationViolation.IMAGE_PUBLIC_DOMAIN_CREATOR_MISSING)

    if image.dimensions is None:
        violations.append(PublicationViolation.IMAGE_DIMENSIONS_MISSING)

    return violations


def _is_blank(value: str | None) -> bool:
    return value is None or not value.strip()
