import pytest
from django.db import IntegrityError, transaction

from serendipeak.catalog.media import keys
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord
from tests.support.catalog import committed_seed
from tests.support.migrations import applied_head, migrate_to, migrate_to_latest
from tests.support.records import attach_committed_media

BEFORE = ("catalog", "0008_source_agnostic_photograph")
AFTER = ("catalog", "0010_renditions_share_version")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest()


def test_the_73_photographs_published_under_r1_keep_their_keys_in_both_directions():
    DjangoCatalogStore().load(committed_seed())
    attach_committed_media()
    before = set(MountainImageRecord.objects.values_list("page_key", "viewer_key"))

    migrate_to(AFTER)
    assert set(MountainImageRecord.objects.values_list("page_key", "viewer_key")) == before
    assert all("-r1." in key for pair in before for key in pair)

    migrate_to(BEFORE)
    assert applied_head() == BEFORE[1]
    assert set(MountainImageRecord.objects.values_list("page_key", "viewer_key")) == before


def test_reversing_fails_and_changes_nothing_once_a_photograph_has_r2_renditions():
    DjangoCatalogStore().load(committed_seed())
    attach_committed_media()
    image = MountainImageRecord.objects.order_by("mountain__slug").first()
    image.page_key = keys.page_key(image.original_sha256)
    image.viewer_key = keys.viewer_key(image.original_sha256)
    image.save()

    with pytest.raises(IntegrityError), transaction.atomic():
        migrate_to(BEFORE)

    assert applied_head() == AFTER[1]
