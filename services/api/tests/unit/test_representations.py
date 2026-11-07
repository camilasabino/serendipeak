import datetime
import json
from dataclasses import replace

import pytest

from serendipeak.catalog.entities import CanonicalCamera
from serendipeak.discovery.entities import DailyMountain
from serendipeak.httpapi.renderers import ContractJSONRenderer
from serendipeak.httpapi.representations import represent_daily_mountain, represent_mountain
from tests.support.catalog import (
    bare_mountain,
    committed_mountain,
    media_of,
    mountain,
    photograph_media,
    primary_image,
)
from tests.support.contract_fixtures import (
    DROPPED_IMAGE_MEMBERS,
    OWNED_MEDIA_MEMBERS,
    RENAMED_IMAGE_MEMBERS,
    load_fixture,
    served_by_serendipeak,
)

MEDIA_BASE_URL = "https://media.example.test"


def with_media_of(entity):
    image = replace(entity.primary_image, media=media_of(entity.slug))

    return replace(entity, primary_image=image)


def rendered(representation):
    return json.loads(ContractJSONRenderer().render(representation))


@pytest.mark.parametrize(
    ("entity", "fixture"),
    [
        (committed_mountain("aconcagua"), "mountain-complete.json"),
        (committed_mountain("mount-olympus"), "mountain-sparse.json"),
        (bare_mountain(), "mountain-minimal.json"),
    ],
)
def test_the_representation_matches_the_frozen_fixture_except_the_approved_divergences(
    entity, fixture
):
    owned = (
        replace(entity, primary_image=None)
        if entity.primary_image is None
        else with_media_of(entity)
    )

    assert rendered(represent_mountain(owned, MEDIA_BASE_URL)) == served_by_serendipeak(
        load_fixture(fixture), MEDIA_BASE_URL, media_of
    )


def test_the_daily_representation_matches_the_frozen_fixture():
    daily = DailyMountain(
        date=datetime.date(2026, 10, 12), mountain=committed_mountain("aconcagua")
    )

    owned = replace(daily, mountain=with_media_of(daily.mountain))

    assert rendered(represent_daily_mountain(owned, MEDIA_BASE_URL)) == served_by_serendipeak(
        load_fixture("daily-mountain.json"), MEDIA_BASE_URL, media_of
    )


def test_the_daily_date_is_an_iso_calendar_date():
    daily = DailyMountain(date=datetime.date(2028, 2, 9), mountain=bare_mountain())

    assert represent_daily_mountain(daily, MEDIA_BASE_URL)["date"] == "2028-02-09"


def test_members_without_a_value_are_omitted_never_null():
    representation = represent_mountain(bare_mountain(), MEDIA_BASE_URL)

    assert set(representation) == {
        "id",
        "slug",
        "name",
        "coordinates",
        "elevationMeters",
        "continent",
        "countries",
    }
    assert representation["countries"] == []


def test_the_dropped_members_are_never_served():
    representation = represent_mountain(mountain(), MEDIA_BASE_URL)

    assert "prominenceMeters" not in representation
    assert "wikipedia" not in representation["sources"]


def test_a_camera_without_framing_omits_the_framing():
    camera = CanonicalCamera(
        heading_degrees=0.0, pitch_degrees=-10.0, range_meters=9000.0, framing=None
    )

    assert represent_mountain(mountain(camera=camera), MEDIA_BASE_URL)["camera"] == {
        "headingDegrees": 0.0,
        "pitchDegrees": -10.0,
        "rangeMeters": 9000.0,
    }


def test_an_image_without_dimensions_omits_width_and_height():
    image = primary_image(dimensions=None, license_name=None, license_url=None)

    assert represent_mountain(mountain(primary_image=image), MEDIA_BASE_URL)["primaryImage"] == {
        "url": f"{MEDIA_BASE_URL}/{image.media.viewer_key}",
        "thumbnailUrl": f"{MEDIA_BASE_URL}/{image.media.page_key}",
        "author": image.author,
        "sourcePageUrl": image.source_page_url,
    }


def test_the_url_is_the_viewer_rendition_and_the_thumbnail_is_the_page_rendition():
    media = photograph_media("ab" * 32)
    entity = mountain(primary_image=primary_image(media=media))

    image = represent_mountain(entity, MEDIA_BASE_URL)["primaryImage"]

    assert image["url"] == f"{MEDIA_BASE_URL}/photographs/{'ab' * 32}/viewer-r1.jpg"
    assert image["thumbnailUrl"] == f"{MEDIA_BASE_URL}/photographs/{'ab' * 32}/page-r1.jpg"


def test_the_delivery_base_is_joined_to_the_key_whatever_its_path():
    entity = mountain()

    image = represent_mountain(entity, "http://localhost:8000/media")["primaryImage"]

    assert image["url"] == f"http://localhost:8000/media/{entity.primary_image.media.viewer_key}"


def test_storage_details_are_never_exposed():
    image = represent_mountain(mountain(), MEDIA_BASE_URL)["primaryImage"]

    assert set(image) == {
        "url",
        "thumbnailUrl",
        "width",
        "height",
        "author",
        "license",
        "licenseUrl",
        "sourcePageUrl",
    }
    assert "/original." not in json.dumps(image)


def test_a_photograph_from_another_source_is_represented_like_any_other():
    image = primary_image(
        author="Sébastien Goldberg",
        license_name="Unsplash License",
        license_url="https://unsplash.com/license",
        source_page_url="https://unsplash.com/photos/a-mountain",
    )

    represented = represent_mountain(mountain(primary_image=image), MEDIA_BASE_URL)["primaryImage"]

    assert represented["sourcePageUrl"] == "https://unsplash.com/photos/a-mountain"
    assert represented["author"] == "Sébastien Goldberg"


def test_a_photograph_without_a_source_page_omits_the_page():
    image = primary_image(
        source_page_url=None, license_name="All rights reserved", license_url=None
    )

    represented = represent_mountain(mountain(primary_image=image), MEDIA_BASE_URL)["primaryImage"]

    assert "sourcePageUrl" not in represented
    assert represented["author"] == image.author
    assert represented["license"] == "All rights reserved"


def test_a_photograph_without_media_is_represented_without_a_primary_image():
    entity = mountain(primary_image=primary_image(media=None))

    assert "primaryImage" not in represent_mountain(entity, MEDIA_BASE_URL)


def test_the_members_that_differ_from_the_v1_fixtures_are_the_ones_serendipeak_owns():
    assert set(OWNED_MEDIA_MEMBERS) == {"url", "thumbnailUrl"}
    assert RENAMED_IMAGE_MEMBERS == {"attribution": "author"}
    assert set(DROPPED_IMAGE_MEMBERS) == {"creator", "sourceIdentifier"}


@pytest.mark.parametrize(
    ("references", "sources"),
    [
        (
            {"osm_node_id": 7, "wikidata_id": None},
            {"osm": "https://www.openstreetmap.org/node/7"},
        ),
        (
            {"osm_node_id": None, "wikidata_id": "Q1"},
            {"wikidata": "https://www.wikidata.org/wiki/Q1"},
        ),
    ],
)
def test_sources_hold_only_the_stored_references(references, sources):
    entity = mountain(**references)

    assert represent_mountain(entity, MEDIA_BASE_URL)["sources"] == sources


def test_sources_are_omitted_without_any_reference():
    entity = mountain(osm_node_id=None, wikidata_id=None)

    assert "sources" not in represent_mountain(entity, MEDIA_BASE_URL)
