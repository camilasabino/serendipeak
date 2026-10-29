import math
from dataclasses import replace

import pytest

from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import CameraFraming, Coordinates
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from tests.support.catalog import committed_seed, mountain, primary_image

CAMERA = mountain().camera


def test_a_complete_mountain_is_publishable():
    assert publication_violations(mountain()) == ()


def test_every_committed_seed_mountain_is_publishable():
    assert [
        (entry.mountain.slug, publication_violations(entry.mountain))
        for entry in committed_seed().mountains
        if publication_violations(entry.mountain)
    ] == []


@pytest.mark.parametrize(
    ("overrides", "violation"),
    [
        ({"slug": "today"}, PublicationViolation.SLUG_INVALID),
        ({"slug": "Aconcagua"}, PublicationViolation.SLUG_INVALID),
        ({"coordinates": Coordinates(90.5, 0.0)}, PublicationViolation.COORDINATES_OUT_OF_RANGE),
        ({"coordinates": Coordinates(0.0, 180.5)}, PublicationViolation.COORDINATES_OUT_OF_RANGE),
        ({"elevation_meters": 0}, PublicationViolation.ELEVATION_NOT_POSITIVE),
        ({"camera": None}, PublicationViolation.CAMERA_MISSING),
        (
            {"camera": replace(CAMERA, heading_degrees=360.0)},
            PublicationViolation.CAMERA_OUT_OF_BOUNDS,
        ),
        (
            {"camera": replace(CAMERA, pitch_degrees=15.5)},
            PublicationViolation.CAMERA_OUT_OF_BOUNDS,
        ),
        (
            {"camera": replace(CAMERA, range_meters=1999.0)},
            PublicationViolation.CAMERA_OUT_OF_BOUNDS,
        ),
        ({"camera": replace(CAMERA, framing=None)}, PublicationViolation.CAMERA_FRAMING_MISSING),
        (
            {"camera": replace(CAMERA, framing=CameraFraming(x=1.5, y=0.0))},
            PublicationViolation.CAMERA_FRAMING_OUT_OF_BOUNDS,
        ),
        ({"osm": None}, PublicationViolation.OSM_REFERENCE_MISSING),
        ({"wikidata_id": None}, PublicationViolation.WIKIDATA_ID_MISSING),
        ({"primary_image": None}, PublicationViolation.PRIMARY_IMAGE_MISSING),
        ({"primary_image": primary_image(url=" ")}, PublicationViolation.IMAGE_URL_MISSING),
        (
            {"primary_image": primary_image(attribution="")},
            PublicationViolation.IMAGE_ATTRIBUTION_MISSING,
        ),
        (
            {"primary_image": primary_image(source_page_url="")},
            PublicationViolation.IMAGE_SOURCE_PAGE_URL_MISSING,
        ),
        (
            {"primary_image": primary_image(source_identifier="")},
            PublicationViolation.IMAGE_SOURCE_IDENTIFIER_MISSING,
        ),
        (
            {"primary_image": primary_image(license_name=None, license_url=None)},
            PublicationViolation.IMAGE_LICENSE_NAME_MISSING,
        ),
        (
            {"primary_image": primary_image(license_url=None)},
            PublicationViolation.IMAGE_LICENSE_URL_MISSING,
        ),
        (
            {
                "primary_image": primary_image(
                    license_name="Public domain", license_url=None, creator=None
                )
            },
            PublicationViolation.IMAGE_PUBLIC_DOMAIN_CREATOR_MISSING,
        ),
        (
            {"primary_image": primary_image(dimensions=None)},
            PublicationViolation.IMAGE_DIMENSIONS_MISSING,
        ),
    ],
)
def test_each_publication_invariant_is_reported(overrides, violation):
    assert publication_violations(mountain(**overrides)) == (violation,)


def test_a_public_domain_image_with_a_creator_needs_no_license_url():
    image = primary_image(license_name="public domain", license_url=None)

    assert publication_violations(mountain(primary_image=image)) == ()


def test_camera_bounds_are_inclusive_except_the_heading_maximum():
    edge = replace(
        CAMERA,
        heading_degrees=0.0,
        pitch_degrees=15.0,
        range_meters=80000.0,
        framing=CameraFraming(x=-1.0, y=1.0),
    )

    assert publication_violations(mountain(camera=edge)) == ()


@pytest.mark.parametrize(
    ("latitude", "longitude", "expected"),
    [
        (-90.0, -180.0, True),
        (90.0, 180.0, True),
        (90.0000001, 0.0, False),
        (0.0, -180.0000001, False),
        (math.nan, 0.0, False),
        (0.0, math.inf, False),
    ],
)
def test_coordinates_in_range(latitude, longitude, expected):
    assert coordinates_in_range(latitude, longitude) is expected
