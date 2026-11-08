import importlib

import pytest
from django.db import DatabaseError, connection, transaction
from django.test.utils import CaptureQueriesContext

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import (
    MountainRegionUpdate,
    NewMountainRegion,
    RegionInUse,
    RegionSlugTaken,
)
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.mapping import region_record
from serendipeak.persistence.models import MountainRegionRecord
from serendipeak.persistence.mountain_region_store import (
    STRUCTURE_LOCK_KEY,
    DjangoMountainRegionStore,
)
from tests.support.migrations import applied_head, latest_head, migrate_to, migrate_to_latest
from tests.support.records import mountain_record
from tests.support.region_taxonomy import TAXONOMY, id_of

pytestmark = pytest.mark.django_db(transaction=True)

STORE = DjangoMountainRegionStore()


@pytest.fixture(autouse=True)
def taxonomy():
    for entry in TAXONOMY:
        region_record(entry).save(force_insert=True)
    mountain_record(slug="glacier-peak", region_id=id_of("glacier-group")).save()


def parents():
    return dict(MountainRegionRecord.objects.values_list("slug", "parent__slug"))


def statements(action):
    with CaptureQueriesContext(connection) as captured:
        try:
            action()
        except Exception:  # noqa: BLE001 - the count of a refusal is part of what is measured
            pass

    return [query["sql"] for query in captured.captured_queries]


def new(slug="karakoram", parent=None):
    return NewMountainRegion(
        slug=slug, name=LocalizedText(en=slug.title()), parent_id=parent and id_of(parent)
    )


def named(name):
    return MountainRegionUpdate(name=LocalizedText(en=name))


class TestLockKey:
    def test_the_key_is_the_one_the_cycle_trigger_takes(self):
        for name in (
            "0019_mountain_region",
            "0022_region_cycle_requires_read_committed",
        ):
            migration = importlib.import_module(f"serendipeak.persistence.migrations.{name}")

            assert migration.STRUCTURE_LOCK_KEY == STRUCTURE_LOCK_KEY

    def test_every_write_takes_the_lock_before_it_reads_or_locks_any_region(self):
        runs = {
            "create": lambda: STORE.create(new()),
            "update": lambda: STORE.update(id_of("annapurna"), named("Annapurna Massif")),
            "move": lambda: STORE.move(id_of("annapurna"), None),
            "delete": lambda: STORE.delete(id_of("lone-range")),
        }

        for name, run in runs.items():
            sql = statements(run)
            lock = next(index for index, text in enumerate(sql) if "pg_advisory_xact_lock" in text)
            first_region_access = next(
                index for index, text in enumerate(sql) if "mountain_region" in text
            )

            assert lock < first_region_access, name


class TestQueryCounts:
    """Statements counted include BEGIN, COMMIT, savepoints and the isolation check. None of
    them grows with the size of the tree."""

    def test_create_under_a_parent_takes_eight_statements(self):
        assert len(statements(lambda: STORE.create(new(parent="andes")))) == 8

    def test_update_takes_nine_statements(self):
        assert len(statements(lambda: STORE.update(id_of("annapurna"), named("Massif")))) == 9

    def test_move_takes_eleven_statements(self):
        assert len(statements(lambda: STORE.move(id_of("annapurna"), id_of("andes")))) == 11

    def test_delete_takes_thirteen_statements(self):
        assert len(statements(lambda: STORE.delete(id_of("lone-range")))) == 13

    def test_a_deep_tree_costs_the_same_as_a_shallow_one(self):
        parent = id_of("glacier-group")
        for depth in range(40):
            node = MountainRegionRecord.objects.create(
                slug=f"deep-{depth}", name_en=f"Deep {depth}", parent_id=parent
            )
            parent = node.id
        shallow = len(statements(lambda: STORE.move(id_of("annapurna"), id_of("andes"))))

        deep = len(statements(lambda: STORE.move(id_of("lone-range"), parent)))

        assert deep == shallow


class TestIsolation:
    def stricter(self, level, action):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(f"SET TRANSACTION ISOLATION LEVEL {level}")
            return action()

    @pytest.mark.parametrize("level", ["REPEATABLE READ", "SERIALIZABLE"])
    @pytest.mark.parametrize(
        "write",
        [
            lambda: STORE.create(new()),
            lambda: STORE.update(id_of("annapurna"), named("Massif")),
            lambda: STORE.move(id_of("annapurna"), id_of("andes")),
            lambda: STORE.delete(id_of("lone-range")),
        ],
        ids=["create", "update", "move", "delete"],
    )
    def test_a_structure_write_is_refused_under_a_stricter_level_and_changes_nothing(
        self, level, write
    ):
        before = parents()

        with pytest.raises(InfrastructureError, match="READ COMMITTED"):
            self.stricter(level, write)

        assert parents() == before
        assert MountainRegionRecord.objects.count() == len(TAXONOMY)

    @pytest.mark.parametrize("level", ["REPEATABLE READ", "SERIALIZABLE"])
    def test_the_database_refuses_a_raw_reparenting_under_a_stricter_level(self, level):
        def raw_move():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE mountain_region SET parent_id = %s WHERE id = %s",
                    [id_of("andes"), id_of("annapurna")],
                )

        with pytest.raises(DatabaseError, match="READ COMMITTED") as refused:
            self.stricter(level, raw_move)

        assert refused.value.__cause__.diag.sqlstate == "25000"
        assert parents()["annapurna"] == "himalayas"

    def test_under_the_default_level_a_raw_reparenting_is_still_accepted(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE mountain_region SET parent_id = %s WHERE id = %s",
                [id_of("andes"), id_of("annapurna")],
            )

        assert parents()["annapurna"] == "andes"

    def test_a_raw_cycle_is_still_refused_by_the_trigger(self):
        with pytest.raises(DatabaseError, match="cannot descend from itself"):
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE mountain_region SET parent_id = %s WHERE id = %s",
                    [id_of("glacier-group"), id_of("andes")],
                )

        assert parents()["andes"] is None


class TestMigration:
    def test_reversing_it_restores_the_trigger_without_the_isolation_check(self):
        def definition():
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_get_functiondef('mountain_region_reject_cycle'::regproc)")
                return cursor.fetchone()[0]

        assert "transaction_isolation" in definition()
        try:
            migrate_to(("catalog", "0021_daily_discovery_retention"))
            assert "transaction_isolation" not in definition()
            assert "pg_advisory_xact_lock" in definition()
        finally:
            migrate_to_latest()

        assert applied_head() == latest_head()
        assert "transaction_isolation" in definition()


class TestRollback:
    def test_a_refusal_inside_a_caller_transaction_undoes_only_its_own_writes(self):
        with transaction.atomic():
            kept = STORE.create(new("kept-range"))
            with pytest.raises(RegionSlugTaken):
                STORE.create(new("annapurna"))
            with pytest.raises(RegionInUse):
                STORE.delete(id_of("andes"))

        assert MountainRegionRecord.objects.filter(pk=kept.id).exists()
        assert MountainRegionRecord.objects.count() == len(TAXONOMY) + 1
        assert not MountainRegionRecord.objects.filter(
            slug="annapurna", name_en="Karakoram"
        ).exists()

    def test_a_failure_after_the_write_in_the_caller_transaction_undoes_the_write(self):
        class Failure(Exception):
            pass

        with pytest.raises(Failure):
            with transaction.atomic():
                STORE.move(id_of("annapurna"), id_of("andes"))
                STORE.update(id_of("lone-range"), named("Renamed"))
                raise Failure

        assert parents()["annapurna"] == "himalayas"
        assert MountainRegionRecord.objects.get(slug="lone-range").name_en == "Lone Range"
