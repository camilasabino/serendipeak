import pytest
from django.db import connection, transaction

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotDraft, MountainReferenced
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.models import (
    ContinentRecord,
    CountryRecord,
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db

PATH = region_path("Test Chain", "Test Range")
DRAFT = catalog_mountain("draft-peak", region=PATH, status=MountainStatus.DRAFT, camera=None)
OTHER_DRAFT = catalog_mountain("other-draft", region=PATH, status=MountainStatus.DRAFT, camera=None)
ACTIVE = catalog_mountain("active-peak", region=PATH)
ID = DRAFT.mountain.id


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_seed(DRAFT, OTHER_DRAFT, ACTIVE))
    MountainCountryRecord.objects.get_or_create(mountain_id=ID, country_id="CL")

    return DjangoDraftMountainDeletionStore()


def rows_of(mountain_id):
    return (
        MountainRecord.objects.filter(pk=mountain_id).count(),
        MountainImageRecord.objects.filter(pk=mountain_id).count(),
        MountainCountryRecord.objects.filter(mountain_id=mountain_id).count(),
    )


def test_the_mountain_its_photograph_row_and_its_country_links_are_deleted_together(store):
    assert rows_of(ID) == (1, 1, 2)

    store.delete_draft(ID)

    assert rows_of(ID) == (0, 0, 0)


def test_the_other_mountains_their_photographs_and_links_are_kept(store):
    before = [rows_of(entry.mountain.id) for entry in (OTHER_DRAFT, ACTIVE)]

    store.delete_draft(ID)

    assert [rows_of(entry.mountain.id) for entry in (OTHER_DRAFT, ACTIVE)] == before


def test_the_reference_data_is_kept(store):
    regions, countries, continents = (
        MountainRegionRecord.objects.count(),
        CountryRecord.objects.count(),
        ContinentRecord.objects.count(),
    )

    store.delete_draft(ID)

    assert (
        MountainRegionRecord.objects.count(),
        CountryRecord.objects.count(),
        ContinentRecord.objects.count(),
    ) == (regions, countries, continents)


def test_a_public_mountain_is_refused_and_every_row_of_it_is_kept(store):
    before = rows_of(ACTIVE.mountain.id)

    with pytest.raises(MountainNotDraft):
        store.delete_draft(ACTIVE.mountain.id)

    assert rows_of(ACTIVE.mountain.id) == before


def test_a_referenced_draft_keeps_every_row_including_the_ones_deleted_before_the_failure(store):
    DailyDiscoveryRecord.objects.create(date="2026-01-01", mountain_id=ID)

    with pytest.raises(MountainReferenced):
        store.delete_draft(ID)

    assert rows_of(ID) == (1, 1, 2)
    assert DailyDiscoveryRecord.objects.filter(mountain_id=ID).count() == 1


def test_a_refusal_rolls_back_only_the_deletion_inside_a_callers_transaction(store):
    with transaction.atomic():
        store.delete_draft(OTHER_DRAFT.mountain.id)
        with pytest.raises(MountainNotDraft):
            store.delete_draft(ACTIVE.mountain.id)

    assert rows_of(OTHER_DRAFT.mountain.id) == (0, 0, 0)
    assert rows_of(ACTIVE.mountain.id)[0] == 1


def test_a_deletion_is_a_lock_two_dependent_deletes_the_orms_four_protect_reads_and_the_delete(
    store, django_assert_num_queries
):
    with django_assert_num_queries(14) as captured:
        store.delete_draft(ID)

    statements = [query["sql"] for query in captured.captured_queries]
    assert "FOR UPDATE" in next(sql for sql in statements if sql.startswith("SELECT"))
    assert [sql.split(" ")[2] for sql in statements if sql.startswith("DELETE")] == [
        '"mountain_country"',
        '"mountain_image"',
        '"mountain"',
    ]
    assert [sql for sql in statements if sql.startswith("SET CONSTRAINTS")] == [
        "SET CONSTRAINTS ALL IMMEDIATE",
        "SET CONSTRAINTS ALL DEFERRED",
    ]


def test_a_refusal_adds_at_most_the_reads_that_explain_it(store, django_assert_max_num_queries):
    with django_assert_max_num_queries(6):
        with pytest.raises(MountainNotDraft):
            store.delete_draft(ACTIVE.mountain.id)


def test_a_database_failure_that_is_no_reference_is_an_infrastructure_error(store, monkeypatch):
    def failing_check():
        raise InfrastructureError("unexpected")

    monkeypatch.setattr(connection, "check_constraints", failing_check)

    with pytest.raises(InfrastructureError):
        store.delete_draft(ID)

    assert rows_of(ID) == (1, 1, 2)


def test_the_connection_is_usable_after_a_refusal(store):
    with pytest.raises(MountainNotDraft):
        store.delete_draft(ACTIVE.mountain.id)

    assert not connection.needs_rollback
    store.delete_draft(ID)
