from dataclasses import replace

import pytest
from django.db import connection, transaction

from serendipeak.catalog.entities import ImageDimensions, MountainStatus
from serendipeak.catalog.errors import PublicationRejected, SlugTaken
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.new_mountain import PhotographCredit
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_primary_image
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import (
    UPDATED_AT,
    catalog_mountain,
    catalog_of,
    photograph_media,
    primary_image,
)
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


NO_CAMERA = {
    "camera_heading_degrees": None,
    "camera_pitch_degrees": None,
    "camera_range_meters": None,
    "camera_framing_x": None,
    "camera_framing_y": None,
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
    DjangoCatalogStore().load(catalog_of(TARGET, OTHER))
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
    DjangoCatalogStore().load(catalog_of(draft))

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


REPLACEMENT = primary_image(
    media=photograph_media("d" * 64),
    dimensions=ImageDimensions(width=640, height=480),
    author="A. Photographer",
    license_name=None,
    license_url=None,
    source_page_url=None,
)


def image_row(entry=TARGET):
    return MountainImageRecord.objects.filter(pk=entry.mountain.id).values().get()


def replace_photograph(store, image=REPLACEMENT, **overrides):
    return store.update(TARGET.mountain.id, update_of(**overrides), public_edit_violations, image)


def test_a_replacement_rewrites_every_photograph_column_and_clears_an_absent_credit(store):
    before = image_row()

    replace_photograph(store)

    after = image_row()
    assert (after["original_sha256"], after["page_key"], after["viewer_key"]) == (
        "d" * 64,
        REPLACEMENT.media.page_key,
        REPLACEMENT.media.viewer_key,
    )
    assert (after["width"], after["height"]) == (640, 480)
    assert after["author"] == "A. Photographer"
    assert (after["license_name"], after["license_url"], after["source_page_url"]) == (
        None,
        None,
        None,
    )
    assert before["license_name"] is not None
    assert set(after) == set(before)


def test_a_replacement_is_a_change_of_the_mountain_and_touches_no_other_column(store):
    before = row(TARGET)
    other = (row(OTHER), image_row(OTHER))

    replace_photograph(store)

    after = row(TARGET)
    assert {column for column in after if after[column] != before[column]} == {"updated_at"}
    assert after["updated_at"] > before["updated_at"]
    assert (row(OTHER), image_row(OTHER)) == other


def test_a_replacement_equal_to_the_stored_photograph_writes_nothing(store):
    stored = to_primary_image(MountainImageRecord.objects.get(pk=TARGET.mountain.id))
    before = (row(TARGET), image_row())

    replace_photograph(store, stored)

    assert (row(TARGET), image_row()) == before


def test_only_the_photograph_columns_that_differ_are_written(store, django_assert_num_queries):
    stored = to_primary_image(MountainImageRecord.objects.get(pk=TARGET.mountain.id))

    update = update_of()

    with django_assert_num_queries(14) as captured:
        store.update(
            TARGET.mountain.id,
            update,
            public_edit_violations,
            replace(stored, author="Another Author"),
        )

    statements = [query["sql"] for query in captured.captured_queries]
    update = next(sql for sql in statements if sql.startswith('UPDATE "mountain_image"'))
    assert '"author"' in update
    assert '"page_key"' not in update
    assert image_row()["author"] == "Another Author"


def test_a_replacement_for_a_mountain_without_a_photograph_row_creates_it(store):
    MountainImageRecord.objects.filter(pk=TARGET.mountain.id).delete()

    replace_photograph(store)

    assert image_row()["original_sha256"] == "d" * 64


def test_a_replacement_costs_one_read_and_one_write_more_than_the_content_alone(
    store, django_assert_num_queries
):
    update = update_of(name="Changed", country_codes=("CL", "BO"))

    with django_assert_num_queries(17) as captured:
        store.update(TARGET.mountain.id, update, public_edit_violations, REPLACEMENT)

    statements = [query["sql"] for query in captured.captured_queries]
    assert sum(sql.startswith("UPDATE") for sql in statements) == 3
    assert sum(sql.startswith("INSERT") for sql in statements) == 1


def test_a_replacement_alone_is_one_image_read_one_image_write_and_the_touch(
    store, django_assert_num_queries
):
    update = update_of()

    with django_assert_num_queries(14) as captured:
        store.update(TARGET.mountain.id, update, public_edit_violations, REPLACEMENT)

    statements = [query["sql"] for query in captured.captured_queries]
    assert sum(sql.startswith("UPDATE") for sql in statements) == 2


def test_a_rejected_publication_restores_the_photograph_and_the_content(store):
    before = (table_counts(), row(TARGET), image_row())

    with pytest.raises(PublicationRejected):
        store.update(
            TARGET.mountain.id,
            update_of(name="Changed", country_codes=("CL",)),
            lambda prospective: (PublicationViolation.IMAGE_AUTHOR_MISSING,),
            REPLACEMENT,
        )

    assert (table_counts(), row(TARGET), image_row()) == before


def test_a_refusal_restores_the_photograph(store):
    before = (table_counts(), row(TARGET), image_row())

    with pytest.raises(SlugTaken):
        replace_photograph(store, slug="other-peak")

    assert (table_counts(), row(TARGET), image_row()) == before


def test_a_refusal_rolls_back_only_the_replacement_inside_a_callers_transaction(store):
    with transaction.atomic():
        replace_photograph(store, name="Kept")
        with pytest.raises(SlugTaken):
            replace_photograph(store, replace(REPLACEMENT, author="Lost"), slug="other-peak")

    assert image_row()["author"] == "A. Photographer"
    assert row(TARGET)["name_en"] == "Kept"


def test_a_photograph_the_database_refuses_is_an_infrastructure_error_and_changes_nothing(store):
    before = (row(TARGET), image_row())

    with pytest.raises(InfrastructureError):
        replace_photograph(store, replace(REPLACEMENT, author="   "))

    assert (row(TARGET), image_row()) == before


def test_a_credit_writes_only_the_credit_columns_that_differ(store, django_assert_num_queries):
    update = update_of(credit=PhotographCredit(author="Another Author"))

    with django_assert_num_queries(14) as captured:
        store.update(TARGET.mountain.id, update, public_edit_violations)

    statements = [query["sql"] for query in captured.captured_queries]
    image_update = next(sql for sql in statements if sql.startswith('UPDATE "mountain_image"'))
    assert '"author"' in image_update
    assert '"page_key"' not in image_update
    assert '"width"' not in image_update
    after = image_row()
    assert (after["author"], after["license_name"], after["source_page_url"]) == (
        "Another Author",
        None,
        None,
    )
    assert after["original_sha256"] == TARGET.mountain.primary_image.media.original_sha256


def test_a_credit_equal_to_the_stored_one_writes_nothing(store):
    stored = to_primary_image(MountainImageRecord.objects.get(pk=TARGET.mountain.id))
    credit = PhotographCredit(
        author=stored.author,
        license_name=stored.license_name,
        license_url=stored.license_url,
        source_page_url=stored.source_page_url,
    )
    before = (row(TARGET), image_row())

    store.update(TARGET.mountain.id, update_of(credit=credit), public_edit_violations)

    assert (row(TARGET), image_row()) == before


def test_a_rejected_credit_restores_it(store):
    before = (table_counts(), row(TARGET), image_row())

    with pytest.raises(PublicationRejected):
        store.update(
            TARGET.mountain.id,
            update_of(name="Changed", credit=PhotographCredit(author="Lost")),
            lambda prospective: (PublicationViolation.IMAGE_AUTHOR_MISSING,),
        )

    assert (table_counts(), row(TARGET), image_row()) == before


def test_removing_the_photograph_deletes_its_record_and_changes_only_the_update_time(store):
    draft = MountainRecord.objects.get(pk=OTHER.mountain.id)
    MountainRecord.objects.filter(pk=draft.pk).update(status="draft", **NO_CAMERA)
    before = row(OTHER)

    store.update(
        OTHER.mountain.id,
        update_of(
            slug="other-peak",
            name=OTHER.mountain.name.en,
            region_id=draft.region_id,
            remove_photograph=True,
        ),
        public_edit_violations,
    )

    after = row(OTHER)
    assert not MountainImageRecord.objects.filter(pk=OTHER.mountain.id).exists()
    assert {column for column in after if after[column] != before[column]} == {"updated_at"}
    assert image_row() is not None


def test_a_rejected_removal_restores_the_photograph(store):
    before = (table_counts(), row(TARGET), image_row())

    with pytest.raises(PublicationRejected):
        save(store, remove_photograph=True)

    assert (table_counts(), row(TARGET), image_row()) == before


def test_removing_a_photograph_that_is_not_there_writes_nothing(store):
    MountainRecord.objects.filter(pk=OTHER.mountain.id).update(status="draft", **NO_CAMERA)
    MountainImageRecord.objects.filter(pk=OTHER.mountain.id).delete()
    before = row(OTHER)

    store.update(
        OTHER.mountain.id,
        update_of(
            slug="other-peak",
            name=OTHER.mountain.name.en,
            region_id=before["region_id"],
            remove_photograph=True,
        ),
        public_edit_violations,
    )

    assert row(OTHER) == before
