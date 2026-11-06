from dataclasses import replace

import pytest

from serendipeak.catalog.camera import CameraViolation
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.catalog.errors import CameraChanged, CameraRejected, UnknownMountain
from serendipeak.errors import ApplicationError, DomainError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainCameraStore

ACTIVE = mountain("aconcagua")
CAMERALESS_DRAFT = mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
NEW_CAMERA = CanonicalCamera(
    heading_degrees=10.5,
    pitch_degrees=-20.0,
    range_meters=9000.0,
    framing=CameraFraming(x=0.0, y=0.25),
)


@pytest.fixture
def store():
    return InMemoryMountainCameraStore([ACTIVE, CAMERALESS_DRAFT])


@pytest.mark.parametrize("target", [ACTIVE, CAMERALESS_DRAFT], ids=["active", "draft"])
def test_a_valid_camera_replaces_the_expected_one(store, target):
    ChangeMountainCamera(store).execute(target.id, NEW_CAMERA, target.camera)

    assert store.mountain(target.id) == replace(target, camera=NEW_CAMERA)


def test_an_unknown_mountain_is_reported(store):
    with pytest.raises(UnknownMountain):
        ChangeMountainCamera(store).execute(mountain("unknown-peak").id, NEW_CAMERA, None)


@pytest.mark.parametrize(
    ("camera", "violations"),
    [
        (replace(NEW_CAMERA, range_meters=80000.5), (CameraViolation.OUT_OF_BOUNDS,)),
        (replace(NEW_CAMERA, framing=None), (CameraViolation.FRAMING_MISSING,)),
        (
            replace(NEW_CAMERA, heading_degrees=360.0, framing=CameraFraming(x=0.0, y=-1.01)),
            (CameraViolation.OUT_OF_BOUNDS, CameraViolation.FRAMING_OUT_OF_BOUNDS),
        ),
    ],
    ids=["out-of-bounds", "framing-missing", "both"],
)
def test_an_invalid_camera_is_rejected_before_the_store_is_asked(store, camera, violations):
    with pytest.raises(CameraRejected) as raised:
        ChangeMountainCamera(store).execute(ACTIVE.id, camera, ACTIVE.camera)

    assert raised.value.violations == violations
    assert isinstance(raised.value, DomainError)
    assert store.calls == 0
    assert store.mountain(ACTIVE.id) == ACTIVE


def test_a_draft_without_framing_still_gets_a_complete_camera(store):
    # Framing is required for every saved camera, not only for public mountains.
    with pytest.raises(CameraRejected):
        ChangeMountainCamera(store).execute(
            CAMERALESS_DRAFT.id, replace(NEW_CAMERA, framing=None), None
        )


def test_a_stale_expectation_is_refused_and_writes_nothing(store):
    stale = replace(ACTIVE.camera, pitch_degrees=-19.84)

    with pytest.raises(CameraChanged) as raised:
        ChangeMountainCamera(store).execute(ACTIVE.id, NEW_CAMERA, stale)

    assert raised.value.mountain_id == ACTIVE.id
    assert isinstance(raised.value, ApplicationError)
    assert store.mountain(ACTIVE.id) == ACTIVE
