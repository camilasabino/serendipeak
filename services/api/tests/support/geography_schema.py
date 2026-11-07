import datetime

from django.contrib.gis.geos import Point
from django.db import connection

from tests.support.geography import invented_id
from tests.support.migrations import historical_model, migrate_to

BEFORE_GEOGRAPHY = ("catalog", "0013_user_record_and_role_permissions")
LOCALIZED = ("catalog", "0014_localized_mountain_text")
CONTINENTS = ("catalog", "0015_continent_reference")
COUNTRIES = ("catalog", "0016_country_reference")
SCHEMA_READY = ("catalog", "0017_mountain_continent")
FINAL = ("catalog", "0018_geography_final_validation")
REGIONS = ("catalog", "0019_mountain_region")
REGIONS_FINAL = ("catalog", "0020_region_final_validation")

CREATED = datetime.datetime(2026, 10, 2, 2, 55, 52, 889902, tzinfo=datetime.UTC)
UPDATED = datetime.datetime(2026, 10, 12, 17, 59, 25, 645765, tzinfo=datetime.UTC)

# The columns a conversion has to leave exactly as they are, under the names of the latest schema.
PRESERVED = (
    "id, slug, name_en, name_es, name_pt, location::text, elevation_meters,"
    " summary_en, summary_es, summary_pt, camera_heading_degrees, camera_pitch_degrees,"
    " camera_range_meters, camera_framing_x, camera_framing_y, osm_node_id, wikidata_id,"
    " status, created_at, updated_at"
)


def mountain_values(slug, legacy_names=(), **overrides):
    values = {
        "id": invented_id(slug),
        "slug": slug,
        "name_en": slug.replace("-", " ").title(),
        "location": Point(8.5, 46.5, srid=4326),
        "elevation_meters": 3500,
        "range_name": None,
        "countries": list(legacy_names),
        "summary_en": "An invented summary.",
        "camera_heading_degrees": 66.87,
        "camera_pitch_degrees": -19.85,
        "camera_range_meters": 17132.0,
        "camera_framing_x": 0.1,
        "camera_framing_y": 0.2,
        "osm_node_id": 1,
        "wikidata_id": "Q1",
        "status": "active",
        "created_at": CREATED,
        "updated_at": UPDATED,
    }
    values.update(overrides)

    return values


def migrate_to_schema_ready():
    migrate_to(SCHEMA_READY)

    return historical_model(SCHEMA_READY, "MountainRecord")


def fingerprints(columns=PRESERVED):
    """One md5 per mountain over the columns a conversion must not change."""
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT id, md5(ROW({columns})::text) FROM mountain ORDER BY id")
        return dict(cursor.fetchall())


def stored_geography():
    with connection.cursor() as cursor:
        cursor.execute("SELECT slug, continent_code FROM mountain ORDER BY slug")
        continents = dict(cursor.fetchall())
        cursor.execute(
            "SELECT m.slug, l.country_code FROM mountain_country l"
            " JOIN mountain m ON m.id = l.mountain_id ORDER BY 1, 2"
        )
        links = {}
        for slug, code in cursor.fetchall():
            links.setdefault(slug, []).append(code)

    return {slug: (continents[slug], links.get(slug, [])) for slug in continents}


def column_names(table="mountain"):
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, table)

    return {column.name for column in description}


def constraint_names(table="mountain"):
    with connection.cursor() as cursor:
        cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid = %s::regclass", [table])
        return {name for (name,) in cursor.fetchall()}


def nothing_is_assigned():
    """True when there are mountains and none has a continent or a country link."""
    assigned = stored_geography()

    return bool(assigned) and all(value == (None, []) for value in assigned.values())
