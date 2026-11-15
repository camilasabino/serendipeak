import uuid

import pytest
from django.db import IntegrityError, InternalError, connection, transaction
from django.db.models import ProtectedError

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.models import MountainRecord, MountainSlugAliasRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import catalog_mountain, catalog_of

pytestmark = pytest.mark.django_db

ACTIVE = catalog_mountain("aconcagua")
UNLISTED = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)
OTHER = catalog_mountain("other-peak")


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_of(ACTIVE, UNLISTED, DRAFT, OTHER))


def rename(entry, slug):
    MountainRecord.objects.filter(pk=entry.mountain.id).update(slug=slug)


def former_slugs():
    return dict(MountainSlugAliasRecord.objects.values_list("slug", "mountain_id"))


def refused(action):
    with pytest.raises(IntegrityError), transaction.atomic():
        action()


@pytest.mark.parametrize("entry", [ACTIVE, UNLISTED], ids=["active", "inactive"])
def test_any_change_of_the_slug_of_a_public_mountain_keeps_the_old_one(entry):
    rename(entry, "renamed-peak")

    assert former_slugs() == {entry.mountain.slug: entry.mountain.id}


def test_a_save_of_the_whole_record_keeps_the_old_slug_too():
    record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
    record.slug = "renamed-peak"
    record.save()

    assert former_slugs() == {"aconcagua": ACTIVE.mountain.id}


def test_a_draft_that_changes_its_slug_leaves_no_former_slug():
    rename(DRAFT, "renamed-draft")

    assert former_slugs() == {}


def test_a_save_that_keeps_the_slug_leaves_no_former_slug():
    record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
    record.name_en = "Renamed Peak"
    record.save()

    assert former_slugs() == {}


def test_consecutive_renames_keep_every_slug_pointing_at_the_mountain_id():
    rename(ACTIVE, "second-peak")
    rename(ACTIVE, "third-peak")

    assert former_slugs() == {"aconcagua": ACTIVE.mountain.id, "second-peak": ACTIVE.mountain.id}
    assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).slug == "third-peak"


def test_taking_back_a_former_slug_leaves_it_current_and_not_former():
    rename(ACTIVE, "second-peak")
    rename(ACTIVE, "aconcagua")

    assert former_slugs() == {"second-peak": ACTIVE.mountain.id}
    assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).slug == "aconcagua"


def test_a_former_slug_comes_back_when_the_restored_slug_is_changed_again():
    rename(ACTIVE, "second-peak")
    rename(ACTIVE, "aconcagua")
    rename(ACTIVE, "third-peak")

    assert former_slugs() == {"aconcagua": ACTIVE.mountain.id, "second-peak": ACTIVE.mountain.id}


@pytest.mark.parametrize("entry", [OTHER, DRAFT], ids=["public", "draft"])
def test_a_former_slug_cannot_become_the_slug_of_another_mountain(entry):
    rename(ACTIVE, "renamed-peak")

    refused(lambda: rename(entry, "aconcagua"))

    assert MountainRecord.objects.get(pk=entry.mountain.id).slug == entry.mountain.slug
    assert former_slugs() == {"aconcagua": ACTIVE.mountain.id}


def test_a_former_slug_cannot_be_the_slug_of_a_new_mountain():
    rename(ACTIVE, "renamed-peak")
    record = MountainRecord.objects.get(pk=OTHER.mountain.id)
    record.pk = None
    record.id = uuid.UUID(int=12345)
    record.slug = "aconcagua"

    refused(lambda: record.save(force_insert=True))

    assert MountainRecord.objects.count() == 4


def test_the_slug_a_draft_released_can_be_taken_by_another_mountain():
    rename(DRAFT, "renamed-draft")

    rename(OTHER, "draft-peak")

    assert MountainRecord.objects.get(pk=OTHER.mountain.id).slug == "draft-peak"


def test_a_former_slug_cannot_be_recorded_for_the_current_slug_of_another_mountain():
    refused(
        lambda: MountainSlugAliasRecord.objects.create(
            slug="other-peak", mountain_id=ACTIVE.mountain.id
        )
    )

    assert former_slugs() == {}


@pytest.mark.parametrize("slug", ["Bad-Slug", "bad--slug", "", "today", "random"])
def test_a_former_slug_follows_the_slug_rules(slug):
    refused(
        lambda: MountainSlugAliasRecord.objects.create(slug=slug, mountain_id=ACTIVE.mountain.id)
    )


def test_a_rename_rolled_back_leaves_neither_the_slug_nor_a_former_one():
    with pytest.raises(RuntimeError), transaction.atomic():
        rename(ACTIVE, "renamed-peak")
        raise RuntimeError

    assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).slug == "aconcagua"
    assert former_slugs() == {}


def test_a_rename_that_breaks_another_constraint_leaves_no_former_slug():
    refused(
        lambda: MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(
            slug="renamed-peak", name_en=""
        )
    )

    assert former_slugs() == {}


def test_a_mountain_with_a_former_slug_cannot_be_deleted():
    rename(ACTIVE, "renamed-peak")

    with pytest.raises(ProtectedError):
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).delete()


def test_a_draft_that_changed_its_slug_can_still_be_deleted():
    rename(DRAFT, "renamed-draft")

    DjangoDraftMountainDeletionStore().delete_draft(DRAFT.mountain.id)

    assert not MountainRecord.objects.filter(pk=DRAFT.mountain.id).exists()


@pytest.mark.django_db(transaction=True)
def test_a_slug_changes_only_under_read_committed():
    with pytest.raises(InternalError), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        rename(ACTIVE, "renamed-peak")


class TestResolution:
    def test_a_former_slug_resolves_to_the_mountain_under_its_current_slug(self):
        rename(ACTIVE, "second-peak")
        rename(ACTIVE, "third-peak")
        repository = DjangoMountainRepository()

        for former in ("aconcagua", "second-peak"):
            found = repository.find_public_by_former_slug(former)
            assert found is not None
            assert (found.id, found.slug) == (ACTIVE.mountain.id, "third-peak")

        assert repository.find_public_by_slug("third-peak").id == ACTIVE.mountain.id
        assert repository.find_public_by_slug("aconcagua") is None

    def test_a_mountain_that_takes_its_slug_back_is_found_by_it_directly(self):
        rename(ACTIVE, "second-peak")
        rename(ACTIVE, "aconcagua")
        repository = DjangoMountainRepository()

        assert repository.find_public_by_slug("aconcagua").id == ACTIVE.mountain.id
        assert repository.find_public_by_former_slug("aconcagua") is None
        assert repository.find_public_by_former_slug("second-peak").slug == "aconcagua"

    def test_an_unlisted_mountain_still_resolves_but_never_a_draft(self):
        rename(UNLISTED, "renamed-old-peak")
        rename(ACTIVE, "renamed-peak")
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(
            status=MountainStatus.DRAFT.value,
            camera_heading_degrees=None,
            camera_pitch_degrees=None,
            camera_range_meters=None,
            camera_framing_x=None,
            camera_framing_y=None,
        )
        repository = DjangoMountainRepository()

        assert repository.find_public_by_former_slug("old-peak").slug == "renamed-old-peak"
        assert repository.find_public_by_former_slug("aconcagua") is None

    def test_a_lookup_takes_the_queries_of_a_current_slug_lookup(self, django_assert_num_queries):
        rename(ACTIVE, "renamed-peak")
        repository = DjangoMountainRepository()

        with django_assert_num_queries(3):
            assert repository.find_public_by_former_slug("aconcagua") is not None
        with django_assert_num_queries(1):
            assert repository.find_public_by_former_slug("unknown-peak") is None
