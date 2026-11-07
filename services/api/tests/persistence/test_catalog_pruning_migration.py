import pytest
from django.contrib.gis.geos import Point
from django.db import connection

from tests.support.migrations import applied_head, historical_model, migrate_to, migrate_to_latest

BEFORE = ("catalog", "0011_minimal_photograph")
AFTER = ("catalog", "0012_catalog_pruning")
DROPPED_COLUMNS = {"osm_type", "osm_id", "prominence_meters", "wikipedia_url"}

pytestmark = pytest.mark.django_db(transaction=True)


def mountain_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "mountain")

    return {column.name for column in description}


def create_before(model, slug, **overrides):
    return model.objects.create(
        slug=slug,
        name=slug.title(),
        location=Point(8.5, 46.5, srid=4326),
        elevation_meters=3500,
        camera_heading_degrees=66.87,
        camera_pitch_degrees=-19.85,
        camera_range_meters=17132.0,
        camera_framing_x=0.1,
        camera_framing_y=0.2,
        status="active",
        **overrides,
    )


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest()


def test_node_references_become_node_ids_and_the_dropped_columns_disappear():
    migrate_to(BEFORE)
    mountain = historical_model(BEFORE, "MountainRecord")
    create_before(
        mountain,
        "with-node",
        osm_type="node",
        osm_id=1504741757,
        prominence_meters=6962,
        wikipedia_url="https://en.wikipedia.org/wiki/Aconcagua",
    )
    create_before(mountain, "without-reference")

    migrate_to(AFTER)

    migrated = {
        row.slug: row.osm_node_id for row in historical_model(AFTER, "MountainRecord").objects.all()
    }
    assert migrated == {"with-node": 1504741757, "without-reference": None}
    assert DROPPED_COLUMNS.isdisjoint(mountain_columns())


@pytest.mark.parametrize("osm_type", ["way", "relation"])
def test_a_reference_that_is_not_a_node_stops_the_migration_without_changing_anything(osm_type):
    migrate_to(BEFORE)
    mountain = historical_model(BEFORE, "MountainRecord")
    create_before(mountain, "a-node", osm_type="node", osm_id=1)
    create_before(mountain, "a-ridge", osm_type=osm_type, osm_id=2)

    with pytest.raises(RuntimeError, match="a-ridge"):
        migrate_to(AFTER)

    assert applied_head() == BEFORE[1]
    assert DROPPED_COLUMNS <= mountain_columns()
    assert {row.slug for row in mountain.objects.all()} == {"a-node", "a-ridge"}

    mountain.objects.filter(slug="a-ridge").delete()


def test_reversing_restores_the_node_reference_and_leaves_the_dropped_values_empty():
    migrate_to(BEFORE)
    mountain = historical_model(BEFORE, "MountainRecord")
    create_before(
        mountain,
        "with-node",
        osm_type="node",
        osm_id=7,
        prominence_meters=100,
        wikipedia_url="https://en.wikipedia.org/wiki/X",
    )
    migrate_to(AFTER)

    migrate_to(BEFORE)

    restored = historical_model(BEFORE, "MountainRecord").objects.get()
    assert (restored.osm_type, restored.osm_id) == ("node", 7)
    assert (restored.prominence_meters, restored.wikipedia_url) == (None, None)
