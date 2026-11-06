import math
from dataclasses import replace

import pytest

from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import CameraFraming, Coordinates
from serendipeak.catalog.publication import (
    PublicationViolation,
    PublicLinkField,
    publication_violations,
    unsafe_public_links,
)
from tests.support.catalog import committed_seed, committed_seed_with_media, mountain, primary_image

CAMERA = mountain().camera


def test_a_complete_mountain_is_publishable():
    assert publication_violations(mountain()) == ()


def test_every_materialized_committed_seed_mountain_is_publishable():
    assert [
        (entry.mountain.slug, publication_violations(entry.mountain))
        for entry in committed_seed_with_media().mountains
        if publication_violations(entry.mountain)
    ] == []


def test_a_committed_seed_mountain_only_lacks_the_media_that_materialization_adds():
    assert {publication_violations(entry.mountain) for entry in committed_seed().mountains} == {
        (PublicationViolation.IMAGE_MEDIA_MISSING,)
    }


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
        ({"primary_image": None}, PublicationViolation.PRIMARY_IMAGE_MISSING),
        ({"primary_image": primary_image(media=None)}, PublicationViolation.IMAGE_MEDIA_MISSING),
        (
            {"primary_image": primary_image(author="")},
            PublicationViolation.IMAGE_AUTHOR_MISSING,
        ),
        (
            {"primary_image": primary_image(author="  ")},
            PublicationViolation.IMAGE_AUTHOR_MISSING,
        ),
        (
            {"primary_image": primary_image(license_name=None)},
            PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        ),
        (
            {"primary_image": primary_image(license_name=" ")},
            PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        ),
        (
            {"primary_image": primary_image(dimensions=None)},
            PublicationViolation.IMAGE_DIMENSIONS_MISSING,
        ),
        ({"summary": "highest mountain."}, PublicationViolation.SUMMARY_INVALID),
        ({"summary": "Highest\nmountain."}, PublicationViolation.SUMMARY_INVALID),
        ({"summary": "A" * 201}, PublicationViolation.SUMMARY_INVALID),
    ],
)
def test_each_publication_invariant_is_reported(overrides, violation):
    assert publication_violations(mountain(**overrides)) == (violation,)


def test_a_mountain_without_a_summary_is_publishable():
    assert publication_violations(mountain(summary=None)) == ()


def test_source_metadata_is_optional_for_publication():
    assert publication_violations(mountain(osm=None, wikidata_id=None, wikipedia_url=None)) == ()


@pytest.mark.parametrize(
    "image",
    [
        primary_image(license_name=None, license_url=None),
        primary_image(license_url=None),
        primary_image(license_name="Public domain", license_url=None),
        primary_image(source_page_url=None),
        primary_image(source_page_url=None, license_name=None, license_url=None),
    ],
)
def test_the_license_and_the_source_page_are_optional_and_independent(image):
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


UNSAFE_LINK = "http://example.com/page"


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"wikipedia_url": UNSAFE_LINK}, PublicLinkField.WIKIPEDIA_URL),
        (
            {"primary_image": primary_image(source_page_url="HTTPS://example.com")},
            PublicLinkField.IMAGE_SOURCE_PAGE_URL,
        ),
        (
            {"primary_image": primary_image(license_url="https://user@example.com/license")},
            PublicLinkField.IMAGE_LICENSE_URL,
        ),
    ],
)
def test_an_unsafe_public_link_is_reported_with_the_field_that_carries_it(overrides, field):
    candidate = mountain(**overrides)

    assert publication_violations(candidate) == (PublicationViolation.LINK_NOT_HTTPS,)
    assert unsafe_public_links(candidate) == (field,)


def test_several_unsafe_links_are_one_violation_naming_every_field():
    candidate = mountain(
        wikipedia_url=UNSAFE_LINK,
        primary_image=primary_image(source_page_url=UNSAFE_LINK, license_url=UNSAFE_LINK),
    )

    assert publication_violations(candidate) == (PublicationViolation.LINK_NOT_HTTPS,)
    assert unsafe_public_links(candidate) == (
        PublicLinkField.WIKIPEDIA_URL,
        PublicLinkField.IMAGE_SOURCE_PAGE_URL,
        PublicLinkField.IMAGE_LICENSE_URL,
    )


def test_absent_optional_links_are_not_unsafe():
    candidate = mountain(
        wikipedia_url=None,
        primary_image=primary_image(license_name="Public domain", license_url=None),
    )

    assert unsafe_public_links(candidate) == ()


def test_a_blank_source_page_is_not_an_unsafe_link():
    candidate = mountain(
        primary_image=primary_image(source_page_url=" ", license_name=None, license_url=None)
    )

    assert unsafe_public_links(candidate) == ()
    assert publication_violations(candidate) == ()
