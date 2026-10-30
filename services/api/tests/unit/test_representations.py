import datetime
import json
from dataclasses import replace

import pytest

from serendipeak.catalog.entities import CanonicalCamera, OsmReference, OsmType
from serendipeak.discovery.entities import DailyMountain
from serendipeak.httpapi.renderers import ContractJSONRenderer
from serendipeak.httpapi.representations import represent_daily_mountain, represent_mountain
from tests.support.catalog import (
    bare_mountain,
    committed_mountain,
    mountain,
    primary_image,
)
from tests.support.contract_fixtures import load_fixture


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
def test_the_representation_matches_the_frozen_fixture(entity, fixture):
    assert rendered(represent_mountain(entity)) == load_fixture(fixture)


def test_the_daily_representation_matches_the_frozen_fixture():
    daily = DailyMountain(
        date=datetime.date(2026, 10, 12), mountain=committed_mountain("aconcagua")
    )

    assert rendered(represent_daily_mountain(daily)) == load_fixture("daily-mountain.json")


def test_the_daily_date_is_an_iso_calendar_date():
    daily = DailyMountain(date=datetime.date(2028, 2, 9), mountain=bare_mountain())

    assert represent_daily_mountain(daily)["date"] == "2028-02-09"


def test_members_without_a_value_are_omitted_never_null():
    representation = represent_mountain(bare_mountain())

    assert set(representation) == {
        "id",
        "slug",
        "name",
        "coordinates",
        "elevationMeters",
        "countries",
    }
    assert representation["countries"] == []


def test_a_zero_prominence_is_kept():
    assert represent_mountain(mountain(prominence_meters=0))["prominenceMeters"] == 0


def test_a_camera_without_framing_omits_the_framing():
    camera = CanonicalCamera(
        heading_degrees=0.0, pitch_degrees=-10.0, range_meters=9000.0, framing=None
    )

    assert represent_mountain(mountain(camera=camera))["camera"] == {
        "headingDegrees": 0.0,
        "pitchDegrees": -10.0,
        "rangeMeters": 9000.0,
    }


def test_an_image_without_dimensions_omits_width_and_height():
    image = primary_image(
        dimensions=None, thumbnail_url=None, creator=None, license_name=None, license_url=None
    )

    assert represent_mountain(mountain(primary_image=image))["primaryImage"] == {
        "url": image.url,
        "attribution": image.attribution,
        "sourcePageUrl": image.source_page_url,
        "sourceIdentifier": image.source_identifier,
    }


@pytest.mark.parametrize(
    ("references", "sources"),
    [
        (
            {"osm": OsmReference(type=OsmType.RELATION, id=7), "wikidata_id": None},
            {"osm": "https://www.openstreetmap.org/relation/7"},
        ),
        (
            {"osm": None, "wikidata_id": "Q1"},
            {"wikidata": "https://www.wikidata.org/wiki/Q1"},
        ),
    ],
)
def test_sources_hold_only_the_stored_references(references, sources):
    entity = mountain(wikipedia_url=None, **references)

    assert represent_mountain(entity)["sources"] == sources


def test_sources_are_omitted_without_any_reference():
    entity = mountain(osm=None, wikidata_id=None, wikipedia_url=None)

    assert "sources" not in represent_mountain(entity)


def test_urls_are_served_as_stored():
    url = "https://upload.wikimedia.org/a.jpg?utm_source=commons.wikimedia.org&x=%C3%B8"
    entity = replace(mountain(), primary_image=primary_image(url=url))

    assert represent_mountain(entity)["primaryImage"]["url"] == url
