import pytest

from serendipeak.catalog.delete_draft_mountain import DeleteDraftMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotDraft, MountainReferenced, UnknownMountain
from serendipeak.errors import DomainError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryDraftMountainDeletionStore

DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)
OTHER_DRAFT = mountain("other-draft", status=MountainStatus.DRAFT, camera=None)
ACTIVE = mountain("active-peak")
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE, camera=None)
REFERENCED = mountain("referenced-draft", status=MountainStatus.DRAFT, camera=None)


@pytest.fixture
def store():
    return InMemoryDraftMountainDeletionStore(
        [DRAFT, OTHER_DRAFT, ACTIVE, INACTIVE, REFERENCED], referenced_ids=[REFERENCED.id]
    )


@pytest.fixture
def delete_draft_mountain(store):
    return DeleteDraftMountain(store)


def test_a_draft_is_deleted_and_the_others_are_kept(delete_draft_mountain, store):
    assert delete_draft_mountain.execute(DRAFT.id) is None

    assert store.mountain(DRAFT.id) is None
    assert store.mountain(OTHER_DRAFT.id) == OTHER_DRAFT
    assert store.mountain(ACTIVE.id) == ACTIVE


@pytest.mark.parametrize("public", [ACTIVE, INACTIVE], ids=["active", "inactive"])
def test_a_public_mountain_is_refused_and_kept(delete_draft_mountain, store, public):
    with pytest.raises(MountainNotDraft) as refused:
        delete_draft_mountain.execute(public.id)

    assert (refused.value.mountain_id, refused.value.status) == (public.id, public.status)
    assert isinstance(refused.value, DomainError)
    assert store.mountain(public.id) == public


def test_an_unknown_mountain_is_refused(delete_draft_mountain):
    missing = DRAFT.id.__class__(int=1)

    with pytest.raises(UnknownMountain) as refused:
        delete_draft_mountain.execute(missing)

    assert refused.value.mountain_id == missing


def test_a_mountain_a_discovery_refers_to_is_refused_and_kept(delete_draft_mountain, store):
    with pytest.raises(MountainReferenced):
        delete_draft_mountain.execute(REFERENCED.id)

    assert store.mountain(REFERENCED.id) == REFERENCED


def test_a_second_deletion_of_the_same_mountain_is_unknown(delete_draft_mountain):
    delete_draft_mountain.execute(DRAFT.id)

    with pytest.raises(UnknownMountain):
        delete_draft_mountain.execute(DRAFT.id)
