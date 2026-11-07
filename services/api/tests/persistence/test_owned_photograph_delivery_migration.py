import pytest
from django.db import IntegrityError, connection, transaction

from serendipeak.persistence.mapping import mountain_record as mountain_record_of
from tests.support.catalog import committed_seed, load_seed_document, media_of
from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import (
    columns_at_schema,
    legacy_country_names,
    pre_minimal_photograph_columns,
)

BEFORE = ("catalog", "0006_photograph_media")
AFTER = ("catalog", "0007_owned_photograph_delivery")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def image_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "mountain_image")

    return {column.name for column in description}


def raw_images():
    return {raw["slug"]: raw["image"] for raw in load_seed_document()["content"]["mountains"]}


def load_committed_catalog_before_the_migration(*, with_media):
    mountain_model = historical_model(BEFORE, "MountainRecord")
    image_model = historical_model(BEFORE, "MountainImageRecord")
    raw = raw_images()
    entries = committed_seed().mountains

    mountain_model.objects.bulk_create(
        mountain_model(
            **columns_at_schema(
                mountain_record_of(entry), mountain_model, countries=legacy_country_names(entry)
            )
        )
        for entry in entries
    )
    images = []
    for entry in entries:
        slug = entry.mountain.slug
        columns = pre_minimal_photograph_columns(entry, raw[slug], image_model)
        columns.update(url=raw[slug]["url"], thumbnail_url=raw[slug]["thumbnail_url"])
        if with_media:
            media = media_of(slug)
            columns.update(
                original_key=media.original_key,
                original_sha256=media.original_sha256,
                page_key=media.page_key,
                viewer_key=media.viewer_key,
            )
        images.append(image_model(**columns))
    image_model.objects.bulk_create(images)


def test_the_73_photographs_keep_the_seed_url_as_their_legacy_file_url_and_lose_the_thumbnail():
    migrate_to(BEFORE)
    load_committed_catalog_before_the_migration(with_media=False)

    migrate_to(AFTER)

    migrated = historical_model(AFTER, "MountainImageRecord").objects.select_related("mountain")
    stored = {image.mountain.slug: image.legacy_file_url for image in migrated}
    assert stored == {slug: image["url"] for slug, image in raw_images().items()}
    assert len(stored) == 73
    assert {"legacy_file_url"} <= image_columns()
    assert not {"url", "thumbnail_url"} & image_columns()


def test_materialized_media_survives_the_migration():
    migrate_to(BEFORE)
    load_committed_catalog_before_the_migration(with_media=True)

    migrate_to(AFTER)

    images = historical_model(AFTER, "MountainImageRecord").objects.select_related("mountain")
    assert {image.mountain.slug: image.viewer_key for image in images} == {
        slug: media_of(slug).viewer_key for slug in raw_images()
    }


def test_media_keys_that_do_not_follow_their_checksum_block_the_migration():
    migrate_to(BEFORE)
    load_committed_catalog_before_the_migration(with_media=True)
    image_model = historical_model(BEFORE, "MountainImageRecord")
    image_model.objects.filter(mountain__slug="aconcagua").update(
        page_key=media_of("fuji").page_key
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        migrate_to(AFTER)

    assert applied_head() == BEFORE[1]
    image_model.objects.filter(mountain__slug="aconcagua").update(
        page_key=media_of("aconcagua").page_key
    )


def test_reversing_restores_the_url_and_an_empty_thumbnail():
    migrate_to(BEFORE)
    load_committed_catalog_before_the_migration(with_media=False)
    migrate_to(AFTER)

    migrate_to(BEFORE)

    images = historical_model(BEFORE, "MountainImageRecord").objects.select_related("mountain")
    assert {image.mountain.slug: image.url for image in images} == {
        slug: image["url"] for slug, image in raw_images().items()
    }
    assert {image.thumbnail_url for image in images} == {None}
