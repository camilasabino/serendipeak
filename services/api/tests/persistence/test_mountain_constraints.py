import math

import pytest
from django.contrib.gis.geos import Point

from tests.support.records import insert_error, mountain_record

NO_CAMERA = {
    "camera_heading_degrees": None,
    "camera_pitch_degrees": None,
    "camera_range_meters": None,
    "camera_framing_x": None,
    "camera_framing_y": None,
}

REJECTED_DRAFTS = [
    ("mountain_slug_format", {"slug": ""}),
    ("mountain_slug_format", {"slug": "Mont-Blanc"}),
    ("mountain_slug_format", {"slug": "mont--blanc"}),
    ("mountain_slug_format", {"slug": "-mont"}),
    ("mountain_slug_format", {"slug": "mont-"}),
    ("mountain_slug_format", {"slug": "mont_blanc"}),
    ("mountain_slug_format", {"slug": "monté"}),
    ("mountain_slug_format", {"slug": "mont\n"}),
    ("mountain_slug_not_reserved", {"slug": "today"}),
    ("mountain_slug_not_reserved", {"slug": "random"}),
    ("mountain_name_not_blank", {"name": ""}),
    ("mountain_name_not_blank", {"name": " \t"}),
    ("mountain_location_not_empty", {"location": Point(srid=4326)}),
    ("mountain_longitude_valid", {"location": Point(180.001, 0.0, srid=4326)}),
    ("mountain_longitude_valid", {"location": Point(-180.001, 0.0, srid=4326)}),
    ("mountain_longitude_valid", {"location": Point(190.0, 0.0, srid=4326)}),
    ("mountain_longitude_valid", {"location": Point(math.nan, 0.0, srid=4326)}),
    ("mountain_longitude_valid", {"location": Point(math.inf, 0.0, srid=4326)}),
    ("mountain_latitude_valid", {"location": Point(0.0, 90.001, srid=4326)}),
    ("mountain_latitude_valid", {"location": Point(0.0, -90.001, srid=4326)}),
    ("mountain_latitude_valid", {"location": Point(10.0, 95.0, srid=4326)}),
    ("mountain_latitude_valid", {"location": Point(0.0, math.nan, srid=4326)}),
    ("mountain_latitude_valid", {"location": Point(0.0, -math.inf, srid=4326)}),
    ("mountain_elevation_positive", {"elevation_meters": 0}),
    ("mountain_elevation_positive", {"elevation_meters": -1}),
    ("mountain_range_name_not_blank", {"range_name": " "}),
    ("mountain_summary_not_blank", {"summary": ""}),
    ("mountain_wikipedia_url_not_blank", {"wikipedia_url": " "}),
    ("mountain_status_valid", {"status": "pending_media"}),
    ("mountain_status_valid", {"status": ""}),
    (
        "mountain_camera_complete",
        {"camera_pitch_degrees": None, "camera_framing_x": None, "camera_framing_y": None},
    ),
    ("mountain_camera_heading_valid", {"camera_heading_degrees": -0.001}),
    ("mountain_camera_heading_valid", {"camera_heading_degrees": 360.0}),
    ("mountain_camera_heading_valid", {"camera_heading_degrees": math.nan}),
    ("mountain_camera_pitch_valid", {"camera_pitch_degrees": -60.001}),
    ("mountain_camera_pitch_valid", {"camera_pitch_degrees": 15.001}),
    ("mountain_camera_pitch_valid", {"camera_pitch_degrees": math.nan}),
    ("mountain_camera_range_valid", {"camera_range_meters": 1999.999}),
    ("mountain_camera_range_valid", {"camera_range_meters": 80000.001}),
    ("mountain_camera_range_valid", {"camera_range_meters": math.inf}),
    ("mountain_camera_framing_complete", {"camera_framing_y": None}),
    ("mountain_camera_framing_x_valid", {"camera_framing_x": -1.001}),
    ("mountain_camera_framing_x_valid", {"camera_framing_x": 1.001}),
    ("mountain_camera_framing_y_valid", {"camera_framing_y": -1.001}),
    ("mountain_camera_framing_y_valid", {"camera_framing_y": math.nan}),
    (
        "mountain_camera_framing_requires_camera",
        {**NO_CAMERA, "camera_framing_x": 0.0, "camera_framing_y": 0.0},
    ),
    ("mountain_osm_type_valid", {"osm_type": "area"}),
    ("mountain_osm_id_positive", {"osm_id": 0}),
    ("mountain_osm_reference_complete", {"osm_id": None}),
    ("mountain_osm_reference_complete", {"osm_type": None}),
    ("mountain_wikidata_id_format", {"wikidata_id": "Q0"}),
    ("mountain_wikidata_id_format", {"wikidata_id": "q39739"}),
    ("mountain_wikidata_id_format", {"wikidata_id": "Q39739a"}),
]

REJECTED_ACTIVE = [
    ("mountain_active_has_camera", NO_CAMERA),
    ("mountain_active_has_camera_framing", {"camera_framing_x": None, "camera_framing_y": None}),
    ("mountain_active_has_osm_reference", {"osm_type": None, "osm_id": None}),
    ("mountain_active_has_wikidata_id", {"wikidata_id": None}),
]


@pytest.mark.django_db
@pytest.mark.parametrize(("constraint", "overrides"), REJECTED_DRAFTS)
def test_rejects_invalid_mountain_rows(constraint, overrides):
    error = insert_error(mountain_record(**{"status": "draft", **overrides}))

    assert error.constraint_name == constraint


@pytest.mark.django_db
@pytest.mark.parametrize(("constraint", "overrides"), REJECTED_ACTIVE)
def test_rejects_active_mountains_missing_publication_fields(constraint, overrides):
    error = insert_error(mountain_record(status="active", **overrides))

    assert error.constraint_name == constraint


@pytest.mark.django_db
def test_rejects_a_duplicate_slug():
    mountain_record().save()

    error = insert_error(mountain_record(name="Another"))

    assert error.constraint_name == "mountain_slug_key"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides",
    [
        {"camera_heading_degrees": 0.0, "camera_pitch_degrees": -60.0},
        {"camera_heading_degrees": 359.999, "camera_pitch_degrees": 15.0},
        {"camera_range_meters": 2000.0, "camera_framing_x": -1.0, "camera_framing_y": 1.0},
        {"camera_range_meters": 80000.0, "camera_framing_x": 1.0, "camera_framing_y": -1.0},
        {"location": Point(-180.0, -90.0, srid=4326)},
        {"location": Point(180.0, 90.0, srid=4326)},
        {"prominence_meters": 0},
        {"prominence_meters": None, "range_name": None, "summary": None, "wikipedia_url": None},
    ],
)
def test_accepts_active_mountains_at_the_bounds(overrides):
    mountain_record(**overrides).save()


@pytest.mark.django_db
@pytest.mark.parametrize("status", ["draft", "inactive"])
def test_unpublished_statuses_need_only_identity_fields(status):
    mountain_record(status=status, osm_type=None, osm_id=None, wikidata_id=None, **NO_CAMERA).save()


@pytest.mark.django_db
def test_camera_without_framing_is_allowed_outside_active():
    mountain_record(status="inactive", camera_framing_x=None, camera_framing_y=None).save()
