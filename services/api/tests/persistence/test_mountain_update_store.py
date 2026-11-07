import pytest
from django.db import connection, transaction

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import PublicationRejected, SlugTaken
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import UPDATED_AT, catalog_mountain, catalog_seed
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db

PATH = region_path("Test Chain", "Test Range")
TARGET = catalog_mountain("target-peak", region=PATH)
OTHER = catalog_mountain("other-peak", region=PATH)
UPDATED_COLUMNS = {
    "slug",
    "name_en",
    "elevation_meters",
    "continent_id",
    "region_id",
    "summary_en",
    "osm_node_id",
    "wikidata_id",
    "updated_at",
}


def update_of(**overrides):
    mountain = TARGET.mountain
    fields = {
        "slug": mountain.slug,
        "name": mountain.name.en,
        "elevation_meters": mountain.elevation_meters,
        "continent_code": mountain.continent.code,
        "country_codes": ("AR",),
        "region_id": MountainRecord.objects.get(pk=mountain.id).region_id,
        "summary": mountain.summary.en,
        "osm_node_id": mountain.osm_node_id,
        "wikidata_id": mountain.wikidata_id,
    }
    fields.update(overrides)

    return MountainUpdate(**fields)


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_seed(TARGET, OTHER))
    return DjangoMountainUpdateStore()


def save(store, **overrides):
    return store.update(TARGET.mountain.id, update_of(**overrides), public_edit_violations)


def row(entry):
    return MountainRecord.objects.filter(pk=entry.mountain.id).values().get()


def table_counts():
    return (
        MountainRecord.objects.count(),
        MountainImageRecord.objects.count(),
        MountainCountryRecord.objects.count(),
    )


def test_an_update_changes_only_the_content_columns_and_leaves_the_rest_of_the_row(store):
    before = row(TARGET)
    seeded = MountainRecord.objects.get(pk=TARGET.mountain.id)
    seeded.name_es = "Pico"
    seeded.summary_pt = "Resumo."
    seeded.save(update_fields=["name_es", "summary_pt"])
    before = row(TARGET)

    save(
        store,
        slug="renamed-peak",
        name="Renamed Peak",
        elevation_meters=7000,
        continent_code="EU",
        region_id=None,
        summary="A new summary.",
        osm_node_id=None,
        wikidata_id="Q1",
    )

    after = row(TARGET)
    changed = {column for column in after if after[column] != before[column]}
    assert changed == UPDATED_COLUMNS
    assert after["updated_at"] > before["updated_at"]
    assert (after["name_es"], after["summary_pt"]) == ("Pico", "Resumo.")
    assert after["created_at"] == before["created_at"]
    assert row(OTHER) == {**row(OTHER)}


def test_the_photograph_row_and_the_other_mountain_are_untouched(store):
    image_before = MountainImageRecord.objects.filter(pk=TARGET.mountain.id).values().get()
    other_before = row(OTHER)

    save(store, name="Changed", country_codes=("CL",))

    assert MountainImageRecord.objects.filter(pk=TARGET.mountain.id).values().get() == image_before
    assert row(OTHER) == other_before


def test_an_update_equal_to_the_stored_state_writes_nothing(store):
    before = row(TARGET)

    save(store)

    assert row(TARGET) == before
    assert before["updated_at"] == UPDATED_AT


def test_a_change_of_countries_alone_is_a_change_of_the_mountain(store):
    before = row(TARGET)

    save(store, country_codes=("AR", "CL"))

    assert row(TARGET)["updated_at"] > before["updated_at"]
    assert sorted(
        MountainCountryRecord.objects.filter(mountain_id=TARGET.mountain.id).values_list(
            "country_id", flat=True
        )
    ) == ["AR", "CL"]


def test_only_the_links_that_differ_are_written(store):
    link = MountainCountryRecord.objects.get(mountain_id=TARGET.mountain.id, country_id="AR")

    save(store, country_codes=("AR", "CL"))

    assert (
        MountainCountryRecord.objects.get(mountain_id=TARGET.mountain.id, country_id="AR") == link
    )


def test_a_full_update_is_a_lock_a_link_read_two_updates_a_check_and_three_reads(
    store, django_assert_num_queries
):
    update = update_of(name="Changed", country_codes=("CL", "BO"))

    with django_assert_num_queries(15) as captured:
        store.update(TARGET.mountain.id, update, public_edit_violations)

    statements = [query["sql"] for query in captured.captured_queries]
    assert sum(sql.startswith("UPDATE") for sql in statements) == 2
    assert sum(sql.startswith("DELETE") for sql in statements) == 1
    assert sum(sql.startswith("INSERT") for sql in statements) == 1
    assert [sql for sql in statements if sql.startswith("SET CONSTRAINTS")] == [
        "SET CONSTRAINTS ALL IMMEDIATE",
        "SET CONSTRAINTS ALL DEFERRED",
    ]
    assert "FOR NO KEY UPDATE" in next(sql for sql in statements if "FOR NO KEY" in sql)


def test_an_update_that_changes_nothing_costs_the_reads_and_the_check_only(
    store, django_assert_num_queries
):
    update = update_of()

    with django_assert_num_queries(11) as captured:
        store.update(TARGET.mountain.id, update, public_edit_violations)

    statements = [query["sql"] for query in captured.captured_queries]
    assert not any(sql.startswith(("UPDATE", "INSERT", "DELETE")) for sql in statements)


def test_a_refusal_adds_at_most_the_reads_that_explain_it(store, django_assert_max_num_queries):
    update = update_of(slug="other-peak", name="Changed", country_codes=("CL",))

    with django_assert_max_num_queries(14):
        with pytest.raises(SlugTaken):
            store.update(TARGET.mountain.id, update, public_edit_violations)


def test_a_refusal_writes_nothing_in_any_table(store):
    before = (table_counts(), row(TARGET))

    with pytest.raises(SlugTaken):
        save(store, slug="other-peak", name="Changed", country_codes=("CL",))

    assert (table_counts(), row(TARGET)) == before
    assert list(
        MountainCountryRecord.objects.filter(mountain_id=TARGET.mountain.id).values_list(
            "country_id", flat=True
        )
    ) == ["AR"]


def test_a_rejected_publication_rolls_back_the_columns_and_the_links(store):
    before = (table_counts(), row(TARGET))

    with pytest.raises(PublicationRejected) as rejected:
        store.update(
            TARGET.mountain.id,
            update_of(name="Changed", country_codes=("CL",)),
            lambda prospective: (PublicationViolation.CAMERA_MISSING,),
        )

    assert rejected.value.violations == (PublicationViolation.CAMERA_MISSING,)
    assert (table_counts(), row(TARGET)) == before


def test_a_refusal_rolls_back_only_the_update_inside_a_callers_transaction(store):
    with transaction.atomic():
        save(store, name="Kept", country_codes=("CL",))
        with pytest.raises(SlugTaken):
            save(store, slug="other-peak", name="Lost")

    assert row(TARGET)["name_en"] == "Kept"
    assert row(TARGET)["slug"] == "target-peak"


def test_a_summary_that_breaks_the_rule_is_rejected_on_a_public_mountain(store):
    with pytest.raises(PublicationRejected) as rejected:
        save(store, summary="not a sentence")

    assert rejected.value.violations == (PublicationViolation.SUMMARY_INVALID,)
    assert row(TARGET)["summary_en"] == TARGET.mountain.summary.en


def test_a_draft_keeps_its_status_and_may_break_the_publication_rules():
    draft = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)
    DjangoCatalogStore().load(catalog_seed(draft))

    DjangoMountainUpdateStore().update(
        draft.mountain.id,
        MountainUpdate(
            slug="draft-peak",
            name="Draft Peak",
            elevation_meters=100,
            continent_code="SA",
            summary="x",
        ),
        public_edit_violations,
    )

    record = MountainRecord.objects.get(pk=draft.mountain.id)
    assert (record.status, record.summary_en) == ("draft", "x")


def test_a_database_refusal_that_is_no_reference_is_an_infrastructure_error(store):
    with pytest.raises(InfrastructureError):
        save(store, name="   ")

    assert row(TARGET)["name_en"] == TARGET.mountain.name.en


def test_the_connection_is_usable_after_a_refusal(store):
    with pytest.raises(SlugTaken):
        save(store, slug="other-peak")

    assert not connection.needs_rollback
    assert save(store, name="After").name.en == "After"
