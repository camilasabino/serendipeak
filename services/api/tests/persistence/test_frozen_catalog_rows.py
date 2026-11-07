import datetime

import pytest
from django.contrib.gis.geos import Point

from serendipeak.persistence.models import MountainRecord
from tests.support.contract_fixtures import load_fixture, load_frozen_catalog
from tests.support.records import mountain_record

FIXTURE_FILES = ["mountain-complete.json", "mountain-sparse.json", "mountain-minimal.json"]


def frozen_row(mountain):
    pose = mountain["camera"]
    osm_type, osm_id = mountain["sources"]["osm"].rsplit("/", 2)[-2:]
    assert osm_type == "node"
    return MountainRecord(
        slug=mountain["slug"],
        name=mountain["name"],
        location=Point(
            mountain["coordinates"]["longitude"], mountain["coordinates"]["latitude"], srid=4326
        ),
        elevation_meters=mountain["elevationMeters"],
        camera_heading_degrees=pose["headingDegrees"],
        camera_pitch_degrees=pose["pitchDegrees"],
        camera_range_meters=pose["rangeMeters"],
        camera_framing_x=pose["framing"]["x"],
        camera_framing_y=pose["framing"]["y"],
        osm_node_id=int(osm_id),
        wikidata_id=mountain["sources"]["wikidata"].rsplit("/", 1)[-1],
        status="active",
    )


@pytest.mark.django_db
def test_every_frozen_catalog_mountain_is_a_valid_active_row():
    catalog = load_frozen_catalog()

    MountainRecord.objects.bulk_create([frozen_row(mountain) for mountain in catalog])

    stored = {record.slug: record for record in MountainRecord.objects.all()}
    assert len(stored) == len(catalog) == 73
    for mountain in catalog:
        record = stored[mountain["slug"]]
        assert (record.location.y, record.location.x) == (
            mountain["coordinates"]["latitude"],
            mountain["coordinates"]["longitude"],
        )
        assert (
            record.camera_heading_degrees,
            record.camera_pitch_degrees,
            record.camera_range_meters,
            record.camera_framing_x,
            record.camera_framing_y,
        ) == (
            mountain["camera"]["headingDegrees"],
            mountain["camera"]["pitchDegrees"],
            mountain["camera"]["rangeMeters"],
            mountain["camera"]["framing"]["x"],
            mountain["camera"]["framing"]["y"],
        )


@pytest.mark.django_db
@pytest.mark.parametrize("fixture", FIXTURE_FILES)
def test_fixture_coordinates_round_trip_exactly(fixture):
    coordinates = load_fixture(fixture)["coordinates"]
    mountain_record(
        location=Point(coordinates["longitude"], coordinates["latitude"], srid=4326)
    ).save()

    location = MountainRecord.objects.get().location

    assert (location.y, location.x) == (coordinates["latitude"], coordinates["longitude"])


@pytest.mark.django_db
def test_explicit_timestamps_are_preserved():
    created = datetime.datetime(2026, 9, 1, 12, 0, tzinfo=datetime.UTC)
    updated = datetime.datetime(2026, 10, 7, 8, 30, tzinfo=datetime.UTC)
    mountain_record(created_at=created, updated_at=updated).save()

    stored = MountainRecord.objects.get()

    assert (stored.created_at, stored.updated_at) == (created, updated)
