import pytest
from django.db import IntegrityError, connection, transaction

from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import load_fixture_catalog_at

BEFORE = ("catalog", "0007_owned_photograph_delivery")
AFTER = ("catalog", "0008_source_agnostic_photograph")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def nullable_image_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "mountain_image")

    return {column.name for column in description if column.null_ok}


def test_the_73_photographs_with_media_comply_in_both_directions():
    load_fixture_catalog_at(BEFORE, with_media=True)
    assert applied_head() == BEFORE[1]

    migrate_to(AFTER)

    images = historical_model(AFTER, "MountainImageRecord").objects.all()
    assert images.count() == 73
    assert images.filter(legacy_file_url__isnull=True).count() == 0
    assert images.filter(source_identifier__isnull=True).count() == 0
    assert images.filter(creator_url__isnull=False).count() == 0
    assert {"legacy_file_url", "source_identifier", "creator_url"} <= nullable_image_columns()


def test_reversing_fails_and_changes_nothing_once_a_photograph_was_uploaded():
    image_model = load_fixture_catalog_at(BEFORE, with_media=True)
    migrate_to(AFTER)
    image_model = historical_model(AFTER, "MountainImageRecord")
    image_model.objects.filter(mountain__slug="aconcagua").update(
        legacy_file_url=None, source_identifier=None, creator_url="https://unsplash.com/@someone"
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        migrate_to(BEFORE)

    assert applied_head() == AFTER[1]
    assert "creator_url" in nullable_image_columns()
