from dataclasses import replace

import pytest

from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_location_store import DjangoMountainLocationStore
from tests.support.catalog import catalog_mountain, catalog_seed, mountain
from tests.support.fakes import InMemoryMountainLocationStore

pytestmark = pytest.mark.django_db

ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
UNFRAMED_DRAFT = catalog_mountain(
    "unframed-peak",
    status=MountainStatus.DRAFT,
    camera=replace(DRAFT.mountain.camera, framing=None),
)
CATALOG = (ACTIVE, INACTIVE, DRAFT, CAMERALESS_DRAFT, UNFRAMED_DRAFT)

# Long binary expansions: what is stored has to be exactly what was asked for.
MOVED = Coordinates(latitude=-33.123456789012345, longitude=-70.987654321098765)


def allow(confirmed=True):
    def rule(status, stored):
        return judge_relocation(status, stored, MOVED, confirmed)

    return rule


class Arrangement:
    def __init__(self, store, mountain_of):
        self.store = store
        self.mountain_of = mountain_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryMountainLocationStore(entry.mountain for entry in CATALOG)
        return Arrangement(store, store.mountain)

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_seed(*CATALOG))

    return Arrangement(
        DjangoMountainLocationStore(),
        lambda mountain_id: to_mountain(MountainRecord.objects.get(pk=mountain_id)),
    )


@pytest.mark.parametrize("entry", CATALOG[1:], ids=lambda entry: entry.mountain.slug)
def test_an_allowed_move_stores_the_location_and_clears_the_camera_in_every_public_or_draft_status(
    arranged, entry
):
    outcome = arranged.store.relocate(entry.mountain.id, MOVED, allow())

    assert outcome is RelocationOutcome.APPLIED
    assert arranged.mountain_of(entry.mountain.id) == replace(
        entry.mountain, coordinates=MOVED, camera=None
    )


def test_the_rule_is_given_the_stored_status_and_coordinates(arranged):
    seen = []

    def rule(status, stored):
        seen.append((status, stored))
        return RelocationOutcome.UNCHANGED

    arranged.store.relocate(INACTIVE.mountain.id, MOVED, rule)

    assert seen == [(MountainStatus.INACTIVE, INACTIVE.mountain.coordinates)]


@pytest.mark.parametrize(
    ("entry", "confirmed", "expected"),
    [
        (ACTIVE, True, RelocationOutcome.ACTIVE_MOUNTAIN),
        (DRAFT, False, RelocationOutcome.CONFIRMATION_REQUIRED),
        (INACTIVE, False, RelocationOutcome.CONFIRMATION_REQUIRED),
    ],
    ids=["active", "draft-unconfirmed", "inactive-unconfirmed"],
)
def test_a_move_the_rule_refuses_writes_nothing(arranged, entry, confirmed, expected):
    outcome = arranged.store.relocate(entry.mountain.id, MOVED, allow(confirmed))

    assert outcome is expected
    assert arranged.mountain_of(entry.mountain.id) == entry.mountain


def test_the_same_coordinates_leave_the_camera_alone(arranged):
    same = DRAFT.mountain.coordinates

    outcome = arranged.store.relocate(
        DRAFT.mountain.id, same, lambda status, stored: judge_relocation(status, stored, same, True)
    )

    assert outcome is RelocationOutcome.UNCHANGED
    assert arranged.mountain_of(DRAFT.mountain.id) == DRAFT.mountain


def test_an_unknown_mountain_is_reported_without_asking_the_rule(arranged):
    def rule(status, stored):
        raise AssertionError("the rule has nothing to judge")

    outcome = arranged.store.relocate(mountain("unknown-peak").id, MOVED, rule)

    assert outcome is RelocationOutcome.NOT_FOUND
