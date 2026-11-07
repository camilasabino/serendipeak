import math

import pytest
from django.contrib.gis.geos import Point
from django.db import connection

from serendipeak.persistence.models import MountainRecord
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
    ("mountain_name_en_not_blank", {"name_en": ""}),
    ("mountain_name_en_not_blank", {"name_en": " \t"}),
    ("mountain_name_es_not_blank", {"name_es": ""}),
    ("mountain_name_es_not_blank", {"name_es": " "}),
    ("mountain_name_pt_not_blank", {"name_pt": ""}),
    ("mountain_name_pt_not_blank", {"name_pt": "\n"}),
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
    ("mountain_summary_en_not_blank", {"summary_en": ""}),
    ("mountain_summary_es_not_blank", {"summary_en": "En.", "summary_es": " "}),
    ("mountain_summary_pt_not_blank", {"summary_en": "En.", "summary_pt": ""}),
    ("mountain_summary_translation_requires_english", {"summary_es": "Es."}),
    ("mountain_summary_translation_requires_english", {"summary_pt": "Pt."}),
    (
        "mountain_summary_translation_requires_english",
        {"summary_en": None, "summary_es": "Es.", "summary_pt": "Pt."},
    ),
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
    ("mountain_osm_node_id_positive", {"osm_node_id": 0}),
    ("mountain_osm_node_id_positive", {"osm_node_id": -1}),
    ("mountain_wikidata_id_format", {"wikidata_id": "Q0"}),
    ("mountain_wikidata_id_format", {"wikidata_id": "q39739"}),
    ("mountain_wikidata_id_format", {"wikidata_id": "Q39739a"}),
]

REJECTED_ACTIVE = [
    ("mountain_active_has_camera", NO_CAMERA),
    ("mountain_active_has_camera_framing", {"camera_framing_x": None, "camera_framing_y": None}),
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

    error = insert_error(mountain_record(name_en="Another"))

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
        {"region_id": None, "summary_en": None},
        {"summary_en": "En.", "summary_es": "Es.", "summary_pt": "Pt."},
        {"name_es": "Es", "name_pt": "Pt"},
        {"summary_en": "En.", "summary_es": None, "summary_pt": "Pt."},
        {"osm_node_id": 1},
        {"osm_node_id": None, "wikidata_id": None},
    ],
)
def test_accepts_active_mountains_at_the_bounds(overrides):
    mountain_record(**overrides).save()


@pytest.mark.django_db
@pytest.mark.parametrize("status", ["draft", "inactive"])
def test_unpublished_statuses_need_only_identity_fields(status):
    mountain_record(status=status, osm_node_id=None, wikidata_id=None, **NO_CAMERA).save()


@pytest.mark.django_db
def test_camera_without_framing_is_allowed_outside_active():
    mountain_record(status="inactive", camera_framing_x=None, camera_framing_y=None).save()


@pytest.mark.django_db
def test_the_database_holds_exactly_the_declared_mountain_constraints():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = 'mountain'::regclass AND contype IN ('c', 'u')"
        )
        stored = {name for (name,) in cursor.fetchall()}

    declared = {constraint.name for constraint in MountainRecord._meta.constraints}
    assert stored == declared
    assert {
        "mountain_active_has_osm_reference",
        "mountain_active_has_wikidata_id",
    } & stored == set()


@pytest.mark.django_db
def test_an_active_mountain_may_lack_every_source_reference():
    mountain_record(osm_node_id=None, wikidata_id=None).save()
