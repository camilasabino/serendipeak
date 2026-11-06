from enum import StrEnum

from serendipeak.catalog import camera as camera_bounds
from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import CanonicalCamera, Mountain, PrimaryImage
from serendipeak.catalog.public_link import is_public_link
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.catalog.summary import summary_violations


class PublicationViolation(StrEnum):
    SLUG_INVALID = "slug_invalid"
    COORDINATES_OUT_OF_RANGE = "coordinates_out_of_range"
    ELEVATION_NOT_POSITIVE = "elevation_not_positive"
    CAMERA_MISSING = "camera_missing"
    CAMERA_OUT_OF_BOUNDS = "camera_out_of_bounds"
    CAMERA_FRAMING_MISSING = "camera_framing_missing"
    CAMERA_FRAMING_OUT_OF_BOUNDS = "camera_framing_out_of_bounds"
    PRIMARY_IMAGE_MISSING = "primary_image_missing"
    IMAGE_MEDIA_MISSING = "image_media_missing"
    IMAGE_AUTHOR_MISSING = "image_author_missing"
    IMAGE_LICENSE_URL_WITHOUT_LICENSE = "image_license_url_without_license"
    IMAGE_DIMENSIONS_MISSING = "image_dimensions_missing"
    SUMMARY_INVALID = "summary_invalid"
    LINK_NOT_HTTPS = "link_not_https"


class PublicLinkField(StrEnum):
    WIKIPEDIA_URL = "wikipedia_url"
    IMAGE_SOURCE_PAGE_URL = "image_source_page_url"
    IMAGE_LICENSE_URL = "image_license_url"


def publication_violations(mountain: Mountain) -> tuple[PublicationViolation, ...]:
    violations = []

    if not is_valid_slug(mountain.slug):
        violations.append(PublicationViolation.SLUG_INVALID)
    if not coordinates_in_range(mountain.coordinates.latitude, mountain.coordinates.longitude):
        violations.append(PublicationViolation.COORDINATES_OUT_OF_RANGE)
    if mountain.elevation_meters <= 0:
        violations.append(PublicationViolation.ELEVATION_NOT_POSITIVE)

    violations.extend(_camera_violations(mountain.camera))

    violations.extend(image_violations(mountain.primary_image))

    if mountain.summary is not None and summary_violations(mountain.summary):
        violations.append(PublicationViolation.SUMMARY_INVALID)

    if unsafe_public_links(mountain):
        violations.append(PublicationViolation.LINK_NOT_HTTPS)

    return tuple(violations)


def unsafe_public_links(mountain: Mountain) -> tuple[PublicLinkField, ...]:
    links = [(PublicLinkField.WIKIPEDIA_URL, mountain.wikipedia_url)]

    image = mountain.primary_image
    if image is not None:
        links.extend(
            [
                (PublicLinkField.IMAGE_SOURCE_PAGE_URL, image.source_page_url),
                (PublicLinkField.IMAGE_LICENSE_URL, image.license_url),
            ]
        )

    # A blank link is reported as missing (or rejected as blank), not as unsafe.
    return tuple(
        field for field, value in links if not _is_blank(value) and not is_public_link(value)
    )


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
    # A photograph is publishable with its file and its author. The page it comes from does not
    # stand in for the rights to use it, so neither the page nor the license is required; a
    # license URL, though, has to say which license it is.
    violations = []
    if _is_blank(image.author):
        violations.append(PublicationViolation.IMAGE_AUTHOR_MISSING)
    if not _is_blank(image.license_url) and _is_blank(image.license_name):
        violations.append(PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE)

    if image.media is None:
        violations.insert(0, PublicationViolation.IMAGE_MEDIA_MISSING)

    if image.dimensions is None:
        violations.append(PublicationViolation.IMAGE_DIMENSIONS_MISSING)

    return violations


def _is_blank(value: str | None) -> bool:
    return value is None or not value.strip()
