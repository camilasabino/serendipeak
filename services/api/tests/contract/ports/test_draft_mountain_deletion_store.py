import uuid

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotDraft, MountainReferenced, UnknownMountain
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.fakes import InMemoryDraftMountainDeletionStore
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db

PATH = region_path("Test Chain", "Test Range")
DRAFT = catalog_mountain("draft-peak", region=PATH, status=MountainStatus.DRAFT, camera=None)
BARE_DRAFT = catalog_mountain(
    "bare-draft", status=MountainStatus.DRAFT, camera=None, primary_image=None, countries=()
)
REFERENCED = catalog_mountain("referenced-draft", status=MountainStatus.DRAFT, camera=None)
ACTIVE = catalog_mountain("active-peak", region=PATH)
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE, camera=None)
ENTRIES = [DRAFT, BARE_DRAFT, REFERENCED, ACTIVE, INACTIVE]


class Arrangement:
    def __init__(self, store, mountain_of):
        self.store = store
        self.mountain_of = mountain_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryDraftMountainDeletionStore(
            [entry.mountain for entry in ENTRIES], referenced_ids=[REFERENCED.mountain.id]
        )
        return Arrangement(store, lambda entry: store.mountain(entry.mountain.id))

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_of(*ENTRIES))
    DailyDiscoveryRecord.objects.create(date="2026-01-01", mountain_id=REFERENCED.mountain.id)

    def mountain_of(entry):
        record = MountainRecord.objects.filter(pk=entry.mountain.id).first()

        return None if record is None else to_mountain(record)

    return Arrangement(DjangoDraftMountainDeletionStore(), mountain_of)


def test_a_draft_is_deleted(arranged):
    assert arranged.store.delete_draft(DRAFT.mountain.id) is None

    assert arranged.mountain_of(DRAFT) is None


def test_a_draft_without_a_photograph_or_countries_is_deleted(arranged):
    arranged.store.delete_draft(BARE_DRAFT.mountain.id)

    assert arranged.mountain_of(BARE_DRAFT) is None


def test_the_other_mountains_are_kept(arranged):
    before = [arranged.mountain_of(entry) for entry in (BARE_DRAFT, ACTIVE, INACTIVE)]

    arranged.store.delete_draft(DRAFT.mountain.id)

    assert [arranged.mountain_of(entry) for entry in (BARE_DRAFT, ACTIVE, INACTIVE)] == before


@pytest.mark.parametrize("entry", [ACTIVE, INACTIVE], ids=["active", "inactive"])
def test_a_public_mountain_is_refused_with_its_status_and_kept(arranged, entry):
    before = arranged.mountain_of(entry)

    with pytest.raises(MountainNotDraft) as refused:
        arranged.store.delete_draft(entry.mountain.id)

    assert (refused.value.mountain_id, refused.value.status) == (
        entry.mountain.id,
        entry.mountain.status,
    )
    assert arranged.mountain_of(entry) == before


def test_an_unknown_mountain_is_refused(arranged):
    with pytest.raises(UnknownMountain) as refused:
        arranged.store.delete_draft(uuid.UUID(int=1))

    assert refused.value.mountain_id == uuid.UUID(int=1)


def test_a_deleted_mountain_is_unknown_the_second_time(arranged):
    arranged.store.delete_draft(DRAFT.mountain.id)

    with pytest.raises(UnknownMountain):
        arranged.store.delete_draft(DRAFT.mountain.id)


def test_a_mountain_a_discovery_refers_to_is_refused_and_kept(arranged):
    before = arranged.mountain_of(REFERENCED)

    with pytest.raises(MountainReferenced) as refused:
        arranged.store.delete_draft(REFERENCED.mountain.id)

    assert refused.value.mountain_id == REFERENCED.mountain.id
    assert arranged.mountain_of(REFERENCED) == before
