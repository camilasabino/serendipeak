import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import IntegrityError, connection, transaction

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import (
    MountainRegionUpdate,
    NewMountainRegion,
    RegionInUse,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.regions import MountainRegion, UnknownRegion
from serendipeak.errors import ApplicationError
from serendipeak.persistence.mapping import region_record
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from serendipeak.persistence.mountain_region_store import DjangoMountainRegionStore
from tests.support.concurrency import (
    WAIT_SECONDS,
    a_backend_is_waiting_for_a_row_lock,
    run_while_a_change_holds_the_lock,
    wait_until,
)
from tests.support.records import mountain_record
from tests.support.region_taxonomy import TAXONOMY, id_of, region

pytestmark = pytest.mark.django_db(transaction=True)

STORE = DjangoMountainRegionStore()


@pytest.fixture(autouse=True)
def taxonomy():
    for entry in (*TAXONOMY, region("zeta-range"), region("eta-range")):
        region_record(entry).save(force_insert=True)
    mountain_record(slug="glacier-peak", region_id=id_of("glacier-group")).save()


def attempt(action):
    """The refusal the action raises, or what it returns. Used for the request that waits."""
    try:
        return action()
    except ApplicationError as refusal:
        return refusal


def parents():
    return dict(MountainRegionRecord.objects.values_list("slug", "parent__slug"))


def new(slug, name=None, parent=None):
    return NewMountainRegion(
        slug=slug,
        name=LocalizedText(en=name or slug.replace("-", " ").title()),
        parent_id=None if parent is None else id_of(parent),
    )


class TestMovesAndCycles:
    def test_two_moves_that_would_form_a_cycle_let_exactly_one_succeed(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.move(id_of("zeta-range"), id_of("eta-range")),
            lambda: attempt(lambda: STORE.move(id_of("eta-range"), id_of("zeta-range"))),
        )

        assert isinstance(refusal, RegionWouldDescendFromItself)
        assert (refusal.region_id, refusal.parent_id) == (id_of("eta-range"), id_of("zeta-range"))
        assert parents()["zeta-range"] == "eta-range"
        assert parents()["eta-range"] is None

    def test_a_move_into_the_subtree_the_holder_just_attached_is_refused(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.move(id_of("zeta-range"), id_of("lone-range")),
            lambda: attempt(lambda: STORE.move(id_of("lone-range"), id_of("zeta-range"))),
        )

        assert isinstance(refusal, RegionWouldDescendFromItself)
        assert parents()["lone-range"] is None

    def test_a_move_to_the_target_the_holder_deleted_is_refused_as_unknown(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.delete(id_of("zeta-range")),
            lambda: attempt(lambda: STORE.move(id_of("eta-range"), id_of("zeta-range"))),
        )

        assert isinstance(refusal, UnknownRegion)
        assert refusal.region_id == id_of("zeta-range")
        assert parents()["eta-range"] is None

    def test_a_delete_of_the_target_the_holder_just_moved_into_is_refused_as_in_use(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.move(id_of("eta-range"), id_of("zeta-range")),
            lambda: attempt(lambda: STORE.delete(id_of("zeta-range"))),
        )

        assert isinstance(refusal, RegionInUse)
        assert refusal.child_count == 1
        assert parents()["eta-range"] == "zeta-range"

    def test_a_move_into_a_sibling_name_the_holder_just_took_is_refused(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.update(
                id_of("annapurna"), MountainRegionUpdate(name=LocalizedText(en="Cordillera Blanca"))
            ),
            lambda: attempt(lambda: STORE.move(id_of("cordillera-blanca"), id_of("himalayas"))),
        )

        assert isinstance(refusal, RegionNameTaken)
        assert parents()["cordillera-blanca"] == "andes"


class TestCreates:
    def test_two_creations_of_the_same_slug_let_exactly_one_succeed(self):
        created = []

        refusal = run_while_a_change_holds_the_lock(
            lambda: created.append(STORE.create(new("karakoram"))),
            lambda: attempt(lambda: STORE.create(new("karakoram", "Another name"))),
        )

        assert isinstance(refusal, RegionSlugTaken)
        assert MountainRegionRecord.objects.filter(slug="karakoram").count() == 1
        assert MountainRegionRecord.objects.get(slug="karakoram").name_en == "Karakoram"

    def test_a_creation_under_a_parent_the_holder_deleted_is_refused_as_unknown(self):
        refusal = run_while_a_change_holds_the_lock(
            lambda: STORE.delete(id_of("zeta-range")),
            lambda: attempt(lambda: STORE.create(new("karakoram", parent="zeta-range"))),
        )

        assert isinstance(refusal, UnknownRegion)
        assert not MountainRegionRecord.objects.filter(slug="karakoram").exists()


class TestDeletionAgainstAssignments:
    def test_a_deletion_waiting_for_a_mountain_assignment_finds_the_mountain_and_refuses(self):
        def assign():
            MountainRecord.objects.update(region_id=id_of("zeta-range"))
            # The foreign keys are deferred; checking them takes the key-share lock on the
            # region row that a mountain store takes before it commits.
            connection.check_constraints()

        refusal = run_while_a_change_holds_the_lock(
            assign, lambda: attempt(lambda: STORE.delete(id_of("zeta-range")))
        )

        assert isinstance(refusal, RegionInUse)
        assert refusal.mountain_count == 1
        assert MountainRegionRecord.objects.filter(slug="zeta-range").exists()

    def test_an_assignment_waiting_for_a_deletion_loses_to_the_foreign_key(self):
        def assign():
            try:
                with transaction.atomic():
                    MountainRecord.objects.update(region_id=id_of("zeta-range"))
                    connection.check_constraints()
            except IntegrityError as error:
                return error

        loser = run_while_a_change_holds_the_lock(lambda: STORE.delete(id_of("zeta-range")), assign)

        assert isinstance(loser, IntegrityError)
        assert MountainRecord.objects.get().region_id == id_of("glacier-group")
        assert not MountainRegionRecord.objects.filter(slug="zeta-range").exists()


WRITES = {
    "update": lambda: STORE.update(
        id_of("annapurna"), MountainRegionUpdate(name=LocalizedText(en="Annapurna Massif"))
    ),
    "move": lambda: STORE.move(id_of("annapurna"), id_of("andes")),
    "delete": lambda: STORE.delete(id_of("annapurna")),
}


@pytest.mark.parametrize("write", list(WRITES))
def test_a_writer_waits_for_the_structure_lock_holding_no_row_lock(write):
    """The holder takes the lock and then wants the row the waiting writer is about to change.
    A writer that had locked the row first would wait for the lock while the holder waited for
    the row: a deadlock the database breaks by failing one of them. Here both finish."""
    holds_the_lock = threading.Event()
    writer_is_waiting = threading.Event()

    def holder():
        try:
            with transaction.atomic():
                STORE.move(id_of("zeta-range"), id_of("eta-range"))
                holds_the_lock.set()
                assert writer_is_waiting.wait(WAIT_SECONDS)
                MountainRegionRecord.objects.select_for_update().get(pk=id_of("annapurna"))
        finally:
            connection.close()

    def writer():
        try:
            return WRITES[write]()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        held = pool.submit(holder)
        assert holds_the_lock.wait(WAIT_SECONDS)
        waiting = pool.submit(writer)
        # Read from this connection: inside a transaction the activity view is a snapshot.
        wait_until(a_backend_is_waiting_for_a_row_lock)
        writer_is_waiting.set()

        held.result(WAIT_SECONDS)
        outcome = waiting.result(WAIT_SECONDS)

    assert parents()["zeta-range"] == "eta-range"
    if write == "delete":
        assert outcome is None
        assert not MountainRegionRecord.objects.filter(slug="annapurna").exists()
    else:
        assert isinstance(outcome, MountainRegion)
