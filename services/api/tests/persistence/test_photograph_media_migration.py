import pytest
from django.db import connection

from tests.support.migrations import (
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import columns_at_schema, mountain_record

FILE_URL = "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg"
BEFORE = ("catalog", "0005_optional_provenance")
AFTER = ("catalog", "0006_photograph_media")
MEDIA_COLUMNS = {"original_key", "original_sha256", "page_key", "viewer_key"}

pytestmark = pytest.mark.django_db(transaction=True)


def image_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "mountain_image")

    return {column.name for column in description}


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def test_existing_images_keep_their_urls_and_gain_empty_photograph_media():
    migrate_to(BEFORE)
    historical_mountain = historical_model(BEFORE, "MountainRecord")
    historical_image = historical_model(BEFORE, "MountainImageRecord")
    mountain = mountain_record()
    historical_mountain.objects.create(**columns_at_schema(mountain, historical_mountain))
    historical_image.objects.create(
        mountain_id=mountain.pk,
        attribution="Bjørn Christian Tørrissen",
        source_page_url="https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
        source_identifier="File:Aconcagua2016.jpg",
        url=FILE_URL,
        thumbnail_url="https://upload.wikimedia.org/thumb.jpg",
    )

    migrate_to(AFTER)

    migrated = historical_model(AFTER, "MountainImageRecord").objects.get()
    assert (migrated.url, migrated.thumbnail_url) == (
        FILE_URL,
        "https://upload.wikimedia.org/thumb.jpg",
    )
    assert (
        migrated.original_key,
        migrated.original_sha256,
        migrated.page_key,
        migrated.viewer_key,
    ) == (None, None, None, None)


def test_reversing_drops_the_media_columns_and_reapplying_restores_them():
    migrate_to(BEFORE)
    assert MEDIA_COLUMNS.isdisjoint(image_columns())

    migrate_to(AFTER)
    assert MEDIA_COLUMNS <= image_columns()
