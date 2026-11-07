import pytest
from django.db import IntegrityError, connection, transaction

from tests.support.catalog import load_seed_document
from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import load_committed_catalog_at

BEFORE = ("catalog", "0010_renditions_share_version")
AFTER = ("catalog", "0011_minimal_photograph")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def raw_images():
    return {raw["slug"]: raw["image"] for raw in load_seed_document()["content"]["mountains"]}


def image_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "mountain_image")

    return {column.name: column.null_ok for column in description}


def migrated_images():
    migrate_to(AFTER)

    return {
        image.mountain.slug: image
        for image in historical_model(AFTER, "MountainImageRecord").objects.select_related(
            "mountain"
        )
    }


def test_the_credit_of_each_of_the_73_photographs_becomes_its_author():
    load_committed_catalog_at(BEFORE, with_media=True)

    images = migrated_images()

    raw = raw_images()
    assert len(images) == 73
    assert {slug: image.author for slug, image in images.items()} == {
        slug: image["attribution"] for slug, image in raw.items()
    }


def test_the_other_credits_of_the_73_photographs_and_their_files_are_kept():
    load_committed_catalog_at(BEFORE, with_media=True)

    images = migrated_images()

    raw = raw_images()
    for slug, image in images.items():
        assert image.source_page_url == raw[slug]["source_page_url"]
        assert image.license_name == raw[slug]["license_name"]
        assert image.license_url == raw[slug]["license_url"]
        assert (image.width, image.height) == (raw[slug]["width"], raw[slug]["height"])
        assert image.original_sha256 is not None


def test_the_photograph_row_keeps_only_what_visitors_and_editors_use():
    load_committed_catalog_at(BEFORE, with_media=True)

    migrate_to(AFTER)

    columns = image_columns()
    assert set(columns) == {
        "mountain_id",
        "original_key",
        "original_sha256",
        "page_key",
        "viewer_key",
        "width",
        "height",
        "author",
        "license_name",
        "license_url",
        "source_page_url",
    }
    assert columns["source_page_url"] is True
    assert columns["author"] is False


def test_a_photograph_needs_neither_a_source_page_nor_a_license_but_a_license_url_needs_its_name():
    load_committed_catalog_at(BEFORE, with_media=True)
    migrate_to(AFTER)
    model = historical_model(AFTER, "MountainImageRecord")

    model.objects.filter(mountain__slug="aconcagua").update(
        source_page_url=None, license_name=None, license_url=None
    )

    with pytest.raises(IntegrityError, match="license_url_requires_license_name"):
        with transaction.atomic():
            model.objects.filter(mountain__slug="aconcagua").update(
                license_url="https://creativecommons.org/licenses/by/4.0/"
            )
    with pytest.raises(IntegrityError, match="author_not_blank"):
        with transaction.atomic():
            model.objects.filter(mountain__slug="aconcagua").update(author=" ")


def test_reversing_restores_the_credit_and_leaves_the_dropped_records_empty():
    load_committed_catalog_at(BEFORE, with_media=True)
    migrate_to(AFTER)

    migrate_to(BEFORE)

    assert applied_head() == BEFORE[1]
    images = historical_model(BEFORE, "MountainImageRecord").objects.select_related("mountain")
    raw = raw_images()
    assert {image.mountain.slug: image.attribution for image in images} == {
        slug: image["attribution"] for slug, image in raw.items()
    }
    assert {image.legacy_file_url for image in images} == {None}


def test_reversing_fails_and_changes_nothing_while_a_photograph_has_no_source_page():
    load_committed_catalog_at(BEFORE, with_media=True)
    migrate_to(AFTER)
    model = historical_model(AFTER, "MountainImageRecord")
    model.objects.filter(mountain__slug="aconcagua").update(source_page_url=None)

    with pytest.raises(IntegrityError), transaction.atomic():
        migrate_to(BEFORE)

    assert applied_head() == AFTER[1]
