import pytest

from serendipeak.catalog.change_mountain_location import ChangeMountainLocation
from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.errors import (
    ActiveMountainLocationLocked,
    CameraResetNotConfirmed,
    CoordinatesRejected,
    UnknownMountain,
)
from serendipeak.catalog.relocation import RelocationOutcome
from serendipeak.errors import DomainError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainLocationStore

ACTIVE = mountain("aconcagua")
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE)
CAMERALESS_DRAFT = mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
MOVED = Coordinates(latitude=-33.0, longitude=-70.5)


@pytest.fixture
def store():
    return InMemoryMountainLocationStore([ACTIVE, DRAFT, INACTIVE, CAMERALESS_DRAFT])


@pytest.mark.parametrize("target", [DRAFT, INACTIVE], ids=["draft", "inactive"])
def test_a_confirmed_move_stores_the_location_and_clears_the_whole_camera(store, target):
    outcome = ChangeMountainLocation(store).execute(target.id, MOVED, True)

    after = store.mountain(target.id)
    assert outcome is RelocationOutcome.APPLIED
    assert after.coordinates == MOVED
    assert after.camera is None
    assert after.status is target.status


@pytest.mark.parametrize(
    "moved",
    [
        Coordinates(latitude=MOVED.latitude, longitude=DRAFT.coordinates.longitude),
        Coordinates(latitude=DRAFT.coordinates.latitude, longitude=MOVED.longitude),
    ],
    ids=["latitude-only", "longitude-only"],
)
def test_either_coordinate_alone_moves_the_mountain(store, moved):
    ChangeMountainLocation(store).execute(DRAFT.id, moved, True)

    assert store.mountain(DRAFT.id).coordinates == moved
    assert store.mountain(DRAFT.id).camera is None


@pytest.mark.parametrize("target", [ACTIVE, DRAFT, INACTIVE], ids=["active", "draft", "inactive"])
@pytest.mark.parametrize("confirmed", [False, True])
def test_the_same_coordinates_keep_the_camera(store, target, confirmed):
    outcome = ChangeMountainLocation(store).execute(target.id, target.coordinates, confirmed)

    assert outcome is RelocationOutcome.UNCHANGED
    assert store.mountain(target.id) == target


@pytest.mark.parametrize("target", [DRAFT, INACTIVE], ids=["draft", "inactive"])
def test_a_move_that_was_not_confirmed_is_refused_and_writes_nothing(store, target):
    with pytest.raises(CameraResetNotConfirmed) as raised:
        ChangeMountainLocation(store).execute(target.id, MOVED, False)

    assert isinstance(raised.value, DomainError)
    assert store.mountain(target.id) == target


@pytest.mark.parametrize("confirmed", [False, True])
def test_an_active_mountain_cannot_move(store, confirmed):
    with pytest.raises(ActiveMountainLocationLocked) as raised:
        ChangeMountainLocation(store).execute(ACTIVE.id, MOVED, confirmed)

    assert isinstance(raised.value, DomainError)
    assert store.mountain(ACTIVE.id) == ACTIVE


def test_a_draft_without_a_camera_moves_with_the_same_confirmation(store):
    with pytest.raises(CameraResetNotConfirmed):
        ChangeMountainLocation(store).execute(CAMERALESS_DRAFT.id, MOVED, False)

    ChangeMountainLocation(store).execute(CAMERALESS_DRAFT.id, MOVED, True)

    assert store.mountain(CAMERALESS_DRAFT.id).coordinates == MOVED


@pytest.mark.parametrize(
    "coordinates",
    [
        Coordinates(latitude=90.0001, longitude=0.0),
        Coordinates(latitude=0.0, longitude=-180.5),
        Coordinates(latitude=float("nan"), longitude=0.0),
        Coordinates(latitude=0.0, longitude=float("inf")),
    ],
    ids=["latitude", "longitude", "nan", "infinite"],
)
def test_coordinates_out_of_range_are_rejected_before_the_store_is_asked(store, coordinates):
    with pytest.raises(CoordinatesRejected) as raised:
        ChangeMountainLocation(store).execute(DRAFT.id, coordinates, True)

    assert isinstance(raised.value, DomainError)
    assert store.calls == 0


def test_an_unknown_mountain_is_reported(store):
    with pytest.raises(UnknownMountain):
        ChangeMountainLocation(store).execute(mountain("unknown-peak").id, MOVED, True)
