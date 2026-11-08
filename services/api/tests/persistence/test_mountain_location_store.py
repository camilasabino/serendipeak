import uuid

import pytest
from django.db import transaction

from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_location_store import DjangoMountainLocationStore
from tests.support.catalog import UPDATED_AT, catalog_mountain, catalog_of

pytestmark = pytest.mark.django_db

ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
MOVED = Coordinates(latitude=-33.0, longitude=-70.5)
CAMERA_COLUMNS = {
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
}


def allow(status, stored):
    return judge_relocation(status, stored, MOVED, True)


def force(status, stored):
    return RelocationOutcome.APPLIED


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_of(ACTIVE, INACTIVE, DRAFT))
    return DjangoMountainLocationStore()


def row(entry):
    return MountainRecord.objects.filter(pk=entry.mountain.id).values().get()


def test_an_applied_move_touches_only_the_location_the_camera_and_updated_at(store):
    before = row(INACTIVE)

    store.relocate(INACTIVE.mountain.id, MOVED, allow)

    after = row(INACTIVE)
    assert {name for name in before if before[name] != after[name]} == {
        "location",
        *CAMERA_COLUMNS,
        "updated_at",
    }
    assert (after["location"].y, after["location"].x) == (MOVED.latitude, MOVED.longitude)
    assert after["location"].srid == 4326
    assert all(after[name] is None for name in CAMERA_COLUMNS)
    assert after["updated_at"] > UPDATED_AT
    assert after["status"] == MountainStatus.INACTIVE.value


def test_a_move_that_is_not_applied_leaves_updated_at_alone(store):
    store.relocate(
        DRAFT.mountain.id,
        MOVED,
        lambda status, stored: judge_relocation(status, stored, MOVED, False),
    )

    assert row(DRAFT)["updated_at"] == UPDATED_AT


def test_a_move_locks_the_mountain_then_updates_in_one_statement(store, django_assert_num_queries):
    with django_assert_num_queries(4) as captured:
        store.relocate(DRAFT.mountain.id, MOVED, allow)

    statements = [query["sql"] for query in captured.captured_queries]
    assert statements[0].startswith("SAVEPOINT")
    assert statements[1].endswith("FOR NO KEY UPDATE")
    assert "mountain_image" not in statements[1]
    assert statements[2].startswith('UPDATE "mountain"')
    assert "camera_framing_x" in statements[2]
    assert statements[3].startswith("RELEASE SAVEPOINT")


@pytest.mark.parametrize(
    ("mountain_id", "outcome"),
    [
        (DRAFT.mountain.id, RelocationOutcome.UNCHANGED),
        (uuid.UUID(int=1), RelocationOutcome.NOT_FOUND),
    ],
    ids=["refused", "unknown"],
)
def test_a_move_that_writes_nothing_is_only_the_locking_read(
    store, django_assert_num_queries, mountain_id, outcome
):
    with django_assert_num_queries(3) as captured:
        result = store.relocate(
            mountain_id, MOVED, lambda status, stored: RelocationOutcome.UNCHANGED
        )

    assert result is outcome
    assert not any(query["sql"].startswith("UPDATE") for query in captured.captured_queries)


def test_the_database_refuses_to_clear_the_camera_of_an_active_mountain_and_keeps_both(store):
    before = row(ACTIVE)

    with pytest.raises(InfrastructureError):
        store.relocate(ACTIVE.mountain.id, MOVED, force)

    assert row(ACTIVE) == before


def test_a_failure_after_the_move_in_the_same_transaction_restores_the_location_and_the_camera(
    store,
):
    before = row(DRAFT)

    with pytest.raises(RuntimeError), transaction.atomic():
        store.relocate(DRAFT.mountain.id, MOVED, allow)
        assert row(DRAFT)["camera_heading_degrees"] is None
        raise RuntimeError("a later step of the same save failed")

    assert row(DRAFT) == before
