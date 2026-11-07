import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChangeOutcome
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.catalog.status_transitions import DEACTIVATE, PUBLISH, REACTIVATE
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.support.catalog import catalog_mountain, catalog_seed, mountain
from tests.support.fakes import InMemoryMountainStatusStore

pytestmark = pytest.mark.django_db

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
INCOMPLETE_DRAFT = catalog_mountain(
    "incomplete-peak",
    status=MountainStatus.DRAFT,
    camera=None,
    primary_image=None,
    osm_node_id=None,
    wikidata_id=None,
)
CATALOG = (DRAFT, ACTIVE, INACTIVE, INCOMPLETE_DRAFT)


class Arrangement:
    def __init__(self, store, status_of):
        self.store = store
        self.status_of = status_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryMountainStatusStore(entry.mountain for entry in CATALOG)
        return Arrangement(store, store.status_of)

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_seed(*CATALOG))

    return Arrangement(
        DjangoMountainStatusStore(),
        lambda mountain_id: MountainStatus(MountainRecord.objects.get(pk=mountain_id).status),
    )


def nothing_to_reject(_):
    return ()


def test_a_transition_from_the_expected_status_is_applied(arranged):
    change = arranged.store.change_status(DRAFT.mountain.id, PUBLISH, nothing_to_reject)

    assert change.outcome is StatusChangeOutcome.APPLIED
    assert change.status is MountainStatus.ACTIVE
    assert arranged.status_of(DRAFT.mountain.id) is MountainStatus.ACTIVE


@pytest.mark.parametrize(
    ("entry", "transition"),
    [(ACTIVE, DEACTIVATE), (INACTIVE, REACTIVATE)],
    ids=["deactivate", "reactivate"],
)
def test_each_transition_moves_between_its_statuses(arranged, entry, transition):
    change = arranged.store.change_status(entry.mountain.id, transition, nothing_to_reject)

    assert change.outcome is StatusChangeOutcome.APPLIED
    assert arranged.status_of(entry.mountain.id) is transition.target


@pytest.mark.parametrize(
    ("entry", "transition"),
    [
        (ACTIVE, PUBLISH),
        (INACTIVE, PUBLISH),
        (DRAFT, DEACTIVATE),
        (INACTIVE, DEACTIVATE),
        (DRAFT, REACTIVATE),
        (ACTIVE, REACTIVATE),
    ],
)
def test_a_mountain_in_another_status_is_left_alone_and_the_gate_is_not_consulted(
    arranged, entry, transition
):
    def forbidden(_):
        raise AssertionError("the gate must not run for a wrong status")

    change = arranged.store.change_status(entry.mountain.id, transition, forbidden)

    assert change.outcome is StatusChangeOutcome.WRONG_STATUS
    assert change.status is entry.mountain.status
    assert arranged.status_of(entry.mountain.id) is entry.mountain.status


def test_a_gate_rejection_changes_nothing_and_is_returned(arranged):
    change = arranged.store.change_status(
        INCOMPLETE_DRAFT.mountain.id, PUBLISH, publication_violations
    )

    assert change.outcome is StatusChangeOutcome.REJECTED
    assert PublicationViolation.CAMERA_MISSING in change.violations
    assert PublicationViolation.PRIMARY_IMAGE_MISSING in change.violations
    assert change.status is MountainStatus.DRAFT
    assert arranged.status_of(INCOMPLETE_DRAFT.mountain.id) is MountainStatus.DRAFT


def test_the_gate_sees_the_stored_mountain_with_its_image(arranged):
    seen = []

    def record(candidate):
        seen.append(candidate)
        return ()

    arranged.store.change_status(DRAFT.mountain.id, PUBLISH, record)

    assert seen == [DRAFT.mountain]


def test_an_unknown_mountain_is_reported(arranged):
    change = arranged.store.change_status(mountain("unknown-peak").id, PUBLISH, nothing_to_reject)

    assert change.outcome is StatusChangeOutcome.NOT_FOUND
    assert change.status is None


def test_a_second_publication_of_the_same_draft_is_a_wrong_status(arranged):
    first = arranged.store.change_status(DRAFT.mountain.id, PUBLISH, nothing_to_reject)
    second = arranged.store.change_status(DRAFT.mountain.id, PUBLISH, nothing_to_reject)

    assert first.outcome is StatusChangeOutcome.APPLIED
    assert second.outcome is StatusChangeOutcome.WRONG_STATUS
    assert second.status is MountainStatus.ACTIVE
