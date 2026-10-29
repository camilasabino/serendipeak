import math

import pytest

from config.composition import build_bootstrap_catalog, build_check_catalog
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.support.catalog import committed_seed, frozen_catalog, load_seed_document
from tests.support.contract_fixtures import load_fixture, load_frozen_catalog

COORDINATE_TOLERANCE_DEGREES = 1e-7
CAMERA_TOLERANCE = 1e-9


def close(expected, actual, tolerance):
    return math.isclose(expected, actual, rel_tol=0.0, abs_tol=tolerance)


def served_identity(record):
    image = record.image
    return {
        "slug": record.slug,
        "name": record.name,
        "elevationMeters": record.elevation_meters,
        "sources": {
            "osm": f"https://www.openstreetmap.org/{record.osm_type}/{record.osm_id}",
            "wikidata": f"https://www.wikidata.org/wiki/{record.wikidata_id}",
        },
        "primaryImage": {
            "sourceIdentifier": image.source_identifier,
            "sourcePageUrl": image.source_page_url,
            "width": image.width,
            "height": image.height,
        },
    }


def frozen_identity(mountain):
    return {key: mountain[key] for key in ("slug", "name", "elevationMeters", "sources")} | {
        "primaryImage": mountain["primaryImage"]
    }


def matches_frozen(record, mountain):
    pose = mountain["camera"]
    coordinates = mountain["coordinates"]
    return (
        record.status == "active"
        and served_identity(record) == frozen_identity(mountain)
        and close(coordinates["latitude"], record.location.y, COORDINATE_TOLERANCE_DEGREES)
        and close(coordinates["longitude"], record.location.x, COORDINATE_TOLERANCE_DEGREES)
        and all(
            close(expected, actual, CAMERA_TOLERANCE)
            for expected, actual in [
                (pose["headingDegrees"], record.camera_heading_degrees),
                (pose["pitchDegrees"], record.camera_pitch_degrees),
                (pose["rangeMeters"], record.camera_range_meters),
                (pose["framing"]["x"], record.camera_framing_x),
                (pose["framing"]["y"], record.camera_framing_y),
            ]
        )
    )


@pytest.fixture
def bootstrapped(db):
    return build_bootstrap_catalog().execute(committed_seed(), frozen_catalog())


def test_bootstrap_reports_a_consistent_catalog(bootstrapped):
    assert (bootstrapped.mountains, bootstrapped.images, bootstrapped.discoveries) == (73, 73, 8)
    assert (bootstrapped.frozen.matched, bootstrapped.frozen.total) == (73, 73)
    assert bootstrapped.mismatches == ()


def test_every_frozen_mountain_is_stored_with_its_frozen_values(bootstrapped):
    records = {
        record.slug: record for record in MountainRecord.objects.select_related("image").all()
    }

    frozen = load_frozen_catalog()
    matching = [
        mountain["slug"]
        for mountain in frozen
        if mountain["slug"] in records and matches_frozen(records[mountain["slug"]], mountain)
    ]

    assert len(frozen) == len(records) == len(matching) == 73


def test_mountain_ids_are_the_legacy_ids(bootstrapped):
    exported = {raw["slug"]: raw["id"] for raw in load_seed_document()["content"]["mountains"]}

    stored = {slug: str(id_) for slug, id_ in MountainRecord.objects.values_list("slug", "id")}

    assert stored == exported
    for fixture in ("mountain-complete.json", "mountain-sparse.json", "daily-mountain.json"):
        document = load_fixture(fixture)
        mountain = document.get("mountain", document)
        assert stored[mountain["slug"]] == mountain["id"]


def test_the_eight_daily_discoveries_are_preserved(bootstrapped):
    exported = [
        (raw["date"], raw["mountain_id"], raw["created_at"])
        for raw in load_seed_document()["content"]["daily_discoveries"]
    ]

    stored = [
        (
            record.date.isoformat(),
            str(record.mountain_id),
            record.created_at.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        )
        for record in DailyDiscoveryRecord.objects.order_by("date")
    ]

    assert stored == exported
    assert len(stored) == 8


def test_a_second_bootstrap_refuses_and_changes_nothing(bootstrapped):
    before = list(MountainRecord.objects.order_by("id").values())

    with pytest.raises(CatalogAlreadyPopulated):
        build_bootstrap_catalog().execute(committed_seed(), frozen_catalog())

    assert list(MountainRecord.objects.order_by("id").values()) == before
    assert DailyDiscoveryRecord.objects.count() == 8


def test_the_bootstrapped_catalog_passes_the_catalog_check(bootstrapped):
    report = build_check_catalog().execute()

    assert (report.checked, report.violations) == (73, ())
