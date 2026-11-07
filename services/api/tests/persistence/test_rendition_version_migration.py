import pytest
from django.db import IntegrityError, transaction

from serendipeak.catalog.media import keys
from tests.support.migrations import (
    applied_head,
    historical_model,
    migrate_to,
    migrate_to_latest_discarding_catalog,
)
from tests.support.records import load_committed_catalog_at

BEFORE = ("catalog", "0008_source_agnostic_photograph")
AFTER = ("catalog", "0010_renditions_share_version")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest_discarding_catalog()


def stored_keys(target):
    model = historical_model(target, "MountainImageRecord")

    return set(model.objects.values_list("page_key", "viewer_key"))


def test_the_73_photographs_published_under_r1_keep_their_keys_in_both_directions():
    load_committed_catalog_at(BEFORE, with_media=True)
    before = stored_keys(BEFORE)

    migrate_to(AFTER)
    assert stored_keys(AFTER) == before
    assert all("-r1." in key for pair in before for key in pair)

    migrate_to(BEFORE)
    assert applied_head() == BEFORE[1]
    assert stored_keys(BEFORE) == before


def test_reversing_fails_and_changes_nothing_once_a_photograph_has_r2_renditions():
    load_committed_catalog_at(BEFORE, with_media=True)
    migrate_to(AFTER)
    image_model = historical_model(AFTER, "MountainImageRecord")
    image = image_model.objects.order_by("mountain__slug").first()
    image_model.objects.filter(pk=image.pk).update(
        page_key=keys.page_key(image.original_sha256),
        viewer_key=keys.viewer_key(image.original_sha256),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        migrate_to(BEFORE)

    assert applied_head() == AFTER[1]
