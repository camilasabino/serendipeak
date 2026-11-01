import uuid

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChangeOutcome
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.support.catalog import UPDATED_AT, catalog_mountain, catalog_seed

pytestmark = pytest.mark.django_db

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INCOMPLETE_DRAFT = catalog_mountain(
    "incomplete-peak", status=MountainStatus.DRAFT, camera=None, osm=None, wikidata_id=None
)


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_seed(DRAFT, ACTIVE, INCOMPLETE_DRAFT))
    return DjangoMountainStatusStore()


def never_rejects(_):
    return ()


def test_an_applied_change_bumps_updated_at(store):
    before = MountainRecord.objects.get(pk=DRAFT.mountain.id)
    assert before.updated_at == UPDATED_AT

    store.change_status(DRAFT.mountain.id, PUBLISH, never_rejects)

    after = MountainRecord.objects.get(pk=DRAFT.mountain.id)
    assert after.updated_at > UPDATED_AT
    assert after.created_at == before.created_at


def test_a_refused_change_leaves_updated_at_alone(store):
    store.change_status(ACTIVE.mountain.id, PUBLISH, never_rejects)

    assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at == UPDATED_AT


def test_a_change_touches_only_the_status_and_updated_at(store):
    before = MountainRecord.objects.filter(pk=DRAFT.mountain.id).values().get()

    store.change_status(DRAFT.mountain.id, PUBLISH, never_rejects)

    after = MountainRecord.objects.filter(pk=DRAFT.mountain.id).values().get()
    changed = {name for name in before if before[name] != after[name]}
    assert changed == {"status", "updated_at"}


def test_the_database_still_refuses_a_gate_that_lets_an_incomplete_draft_through(store):
    with pytest.raises(InfrastructureError):
        store.change_status(INCOMPLETE_DRAFT.mountain.id, PUBLISH, never_rejects)

    record = MountainRecord.objects.get(pk=INCOMPLETE_DRAFT.mountain.id)
    assert record.status == MountainStatus.DRAFT.value


def test_a_change_locks_the_mountain_then_reads_its_image_then_updates_in_one_transaction(
    store, django_assert_num_queries
):
    with django_assert_num_queries(5) as captured:
        store.change_status(DRAFT.mountain.id, PUBLISH, never_rejects)

    statements = [query["sql"] for query in captured.captured_queries]
    assert statements[0].startswith("SAVEPOINT")
    assert statements[1].endswith("FOR UPDATE")
    assert "mountain_image" not in statements[1]
    assert 'FROM "mountain_image"' in statements[2]
    assert statements[3].startswith('UPDATE "mountain"')
    assert statements[4].startswith("RELEASE SAVEPOINT")


@pytest.mark.parametrize(
    "mountain_id",
    [ACTIVE.mountain.id, uuid.UUID(int=1)],
    ids=["wrong-status", "unknown"],
)
def test_a_change_that_writes_nothing_is_only_the_locking_read(
    store, django_assert_num_queries, mountain_id
):
    with django_assert_num_queries(3) as captured:
        change = store.change_status(mountain_id, PUBLISH, never_rejects)

    assert not any(query["sql"].startswith("UPDATE") for query in captured.captured_queries)
    assert change.outcome in {StatusChangeOutcome.WRONG_STATUS, StatusChangeOutcome.NOT_FOUND}


def test_the_update_is_conditional_on_the_source_status_and_rolls_back_when_it_misses(store):
    def moves_the_mountain_away(_):
        MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(status="inactive")
        return ()

    with pytest.raises(InfrastructureError):
        store.change_status(DRAFT.mountain.id, PUBLISH, moves_the_mountain_away)

    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "draft"
