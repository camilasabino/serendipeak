import pytest
from django.db import connection

from serendipeak.persistence.models import MountainImageRecord
from tests.support.migrations import historical_model, migrate_to, migrate_to_latest
from tests.support.records import image_record, mountain_record

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
    migrate_to_latest()


def stored_fields(record, model):
    names = {field.attname for field in model._meta.concrete_fields}

    return {
        field.attname: getattr(record, field.attname)
        for field in record._meta.concrete_fields
        if field.attname in names
    }


def test_existing_images_keep_their_urls_and_gain_empty_photograph_media():
    migrate_to(BEFORE)
    historical_mountain = historical_model(BEFORE, "MountainRecord")
    historical_image = historical_model(BEFORE, "MountainImageRecord")
    mountain = mountain_record()
    historical_mountain.objects.create(**stored_fields(mountain, historical_mountain))
    image = image_record(mountain, thumbnail_url="https://upload.wikimedia.org/thumb.jpg")
    historical_image.objects.create(**stored_fields(image, historical_image))

    migrate_to(AFTER)

    migrated = MountainImageRecord.objects.get()
    assert (migrated.url, migrated.thumbnail_url) == (image.url, image.thumbnail_url)
    assert (
        migrated.original_key,
        migrated.original_sha256,
        migrated.page_key,
        migrated.viewer_key,
    ) == (None, None, None, None)


def test_reversing_drops_the_media_columns_and_reapplying_restores_them():
    record = mountain_record()
    record.save()
    image_record(record).save(force_insert=True)

    migrate_to(BEFORE)
    assert MEDIA_COLUMNS.isdisjoint(image_columns())

    migrate_to(AFTER)
    assert MEDIA_COLUMNS <= image_columns()
