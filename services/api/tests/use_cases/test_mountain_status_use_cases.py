from dataclasses import replace

import pytest

from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import InvalidStatusTransition, PublicationRejected, UnknownMountain
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.errors import DomainError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainStatusStore

DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = mountain("aconcagua")
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE)
INCOMPLETE_DRAFT = mountain(
    "incomplete-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None
)
ARCHIVED_INCOMPLETE = mountain(
    "archived-peak", status=MountainStatus.INACTIVE, summary="not a sentence", primary_image=None
)


@pytest.fixture
def store():
    return InMemoryMountainStatusStore(
        [DRAFT, ACTIVE, INACTIVE, INCOMPLETE_DRAFT, ARCHIVED_INCOMPLETE]
    )


def test_publishing_a_complete_draft_makes_it_active(store):
    PublishMountain(store).execute(DRAFT.id)

    assert store.status_of(DRAFT.id) is MountainStatus.ACTIVE


def test_publishing_an_incomplete_draft_is_rejected_with_every_violation_and_changes_nothing(
    store,
):
    with pytest.raises(PublicationRejected) as raised:
        PublishMountain(store).execute(INCOMPLETE_DRAFT.id)

    assert set(raised.value.violations) >= {
        PublicationViolation.CAMERA_MISSING,
        PublicationViolation.PRIMARY_IMAGE_MISSING,
    }
    assert store.status_of(INCOMPLETE_DRAFT.id) is MountainStatus.DRAFT


def test_publishing_applies_the_summary_rule(store):
    store.replace(replace(DRAFT, summary="highest mountain."))

    with pytest.raises(PublicationRejected) as raised:
        PublishMountain(store).execute(DRAFT.id)

    assert raised.value.violations == (PublicationViolation.SUMMARY_INVALID,)


@pytest.mark.parametrize("entity", [ACTIVE, INACTIVE])
def test_only_a_draft_can_be_published(store, entity):
    with pytest.raises(InvalidStatusTransition) as raised:
        PublishMountain(store).execute(entity.id)

    assert raised.value.current is entity.status
    assert raised.value.target is MountainStatus.ACTIVE
    assert store.status_of(entity.id) is entity.status


def test_deactivating_an_active_mountain_does_not_need_it_to_be_publishable(store):
    store.replace(replace(ACTIVE, summary="not a sentence"))

    DeactivateMountain(store).execute(ACTIVE.id)

    assert store.status_of(ACTIVE.id) is MountainStatus.INACTIVE


@pytest.mark.parametrize("entity", [DRAFT, INACTIVE])
def test_only_an_active_mountain_can_be_deactivated(store, entity):
    with pytest.raises(InvalidStatusTransition):
        DeactivateMountain(store).execute(entity.id)

    assert store.status_of(entity.id) is entity.status


def test_reactivating_an_inactive_mountain_makes_it_active_again(store):
    ReactivateMountain(store).execute(INACTIVE.id)

    assert store.status_of(INACTIVE.id) is MountainStatus.ACTIVE


def test_reactivation_is_held_to_the_publication_rules(store):
    with pytest.raises(PublicationRejected) as raised:
        ReactivateMountain(store).execute(ARCHIVED_INCOMPLETE.id)

    assert PublicationViolation.PRIMARY_IMAGE_MISSING in raised.value.violations
    assert PublicationViolation.SUMMARY_INVALID in raised.value.violations
    assert store.status_of(ARCHIVED_INCOMPLETE.id) is MountainStatus.INACTIVE


@pytest.mark.parametrize("entity", [DRAFT, ACTIVE])
def test_only_an_inactive_mountain_can_be_reactivated(store, entity):
    with pytest.raises(InvalidStatusTransition):
        ReactivateMountain(store).execute(entity.id)


@pytest.mark.parametrize("use_case", [PublishMountain, DeactivateMountain, ReactivateMountain])
def test_an_unknown_mountain_is_reported(use_case):
    with pytest.raises(UnknownMountain) as raised:
        use_case(InMemoryMountainStatusStore()).execute(DRAFT.id)

    assert raised.value.mountain_id == DRAFT.id


def test_rejections_are_domain_errors():
    assert issubclass(PublicationRejected, DomainError)
    assert issubclass(InvalidStatusTransition, DomainError)
