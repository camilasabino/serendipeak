from dataclasses import replace

import pytest

from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    MountainStatus,
)
from serendipeak.catalog.ports import CameraChange
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from tests.support.catalog import catalog_mountain, catalog_seed, mountain
from tests.support.fakes import InMemoryMountainCameraStore

pytestmark = pytest.mark.django_db

ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
UNFRAMED_DRAFT = catalog_mountain(
    "unframed-peak",
    status=MountainStatus.DRAFT,
    camera=replace(ACTIVE.mountain.camera, framing=None),
)
CATALOG = (ACTIVE, INACTIVE, CAMERALESS_DRAFT, UNFRAMED_DRAFT)

# Values with long binary expansions: the comparison has to be exact, not approximate.
NEW_CAMERA = CanonicalCamera(
    heading_degrees=123.456789012345,
    pitch_degrees=-12.34,
    range_meters=4321.0,
    framing=CameraFraming(x=0.1234, y=-0.0001),
)


class Arrangement:
    def __init__(self, store, mountain_of):
        self.store = store
        self.mountain_of = mountain_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryMountainCameraStore(entry.mountain for entry in CATALOG)
        return Arrangement(store, store.mountain)

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_seed(*CATALOG))

    return Arrangement(
        DjangoMountainCameraStore(),
        lambda mountain_id: to_mountain(MountainRecord.objects.get(pk=mountain_id)),
    )


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry.mountain.slug)
def test_a_camera_that_still_equals_the_expected_one_is_replaced_in_every_status(arranged, entry):
    change = arranged.store.replace_camera(
        entry.mountain.id, NEW_CAMERA, entry.mountain.camera, entry.mountain.coordinates
    )

    assert change is CameraChange.APPLIED
    after = arranged.mountain_of(entry.mountain.id)
    assert after.camera == NEW_CAMERA
    assert after == replace(entry.mountain, camera=NEW_CAMERA)


@pytest.mark.parametrize(
    ("entry", "expected"),
    [
        (ACTIVE, replace(ACTIVE.mountain.camera, heading_degrees=66.870000001)),
        (ACTIVE, replace(ACTIVE.mountain.camera, framing=None)),
        (ACTIVE, None),
        (CAMERALESS_DRAFT, ACTIVE.mountain.camera),
        (UNFRAMED_DRAFT, ACTIVE.mountain.camera),
    ],
    ids=["value-differs", "framing-differs", "expected-none", "none-stored", "unframed-stored"],
)
def test_a_camera_that_differs_from_the_expected_one_is_stale_and_left_alone(
    arranged, entry, expected
):
    change = arranged.store.replace_camera(
        entry.mountain.id, NEW_CAMERA, expected, entry.mountain.coordinates
    )

    assert change is CameraChange.STALE
    assert arranged.mountain_of(entry.mountain.id) == entry.mountain


def test_an_unknown_mountain_is_reported(arranged):
    unknown = mountain("unknown-peak")
    change = arranged.store.replace_camera(unknown.id, NEW_CAMERA, None, unknown.coordinates)

    assert change is CameraChange.NOT_FOUND


def test_a_second_change_based_on_the_same_reading_is_stale(arranged):
    original = ACTIVE.mountain.camera
    second = replace(NEW_CAMERA, range_meters=9000.0)

    where = ACTIVE.mountain.coordinates
    first_change = arranged.store.replace_camera(ACTIVE.mountain.id, NEW_CAMERA, original, where)
    second_change = arranged.store.replace_camera(ACTIVE.mountain.id, second, original, where)

    assert first_change is CameraChange.APPLIED
    assert second_change is CameraChange.STALE
    assert arranged.mountain_of(ACTIVE.mountain.id).camera == NEW_CAMERA


MOVED = Coordinates(latitude=-33.0, longitude=-70.5)


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry.mountain.slug)
@pytest.mark.parametrize(
    "composed_on",
    [
        Coordinates(latitude=MOVED.latitude, longitude=ACTIVE.mountain.coordinates.longitude),
        Coordinates(latitude=ACTIVE.mountain.coordinates.latitude, longitude=MOVED.longitude),
        Coordinates(
            latitude=ACTIVE.mountain.coordinates.latitude + 1e-12,
            longitude=ACTIVE.mountain.coordinates.longitude,
        ),
    ],
    ids=["latitude", "longitude", "last-digit"],
)
def test_a_camera_composed_on_other_coordinates_is_refused_and_left_alone(
    arranged, entry, composed_on
):
    change = arranged.store.replace_camera(
        entry.mountain.id, NEW_CAMERA, entry.mountain.camera, composed_on
    )

    assert change is CameraChange.LOCATION_CHANGED
    assert arranged.mountain_of(entry.mountain.id) == entry.mountain


def test_other_coordinates_are_refused_even_when_both_cameras_are_absent(arranged):
    # A move clears the camera, so the stale proposal's expected camera is absent and equals the
    # stored one: only the coordinates tell the two locations apart.
    assert CAMERALESS_DRAFT.mountain.camera is None

    change = arranged.store.replace_camera(CAMERALESS_DRAFT.mountain.id, NEW_CAMERA, None, MOVED)

    assert change is CameraChange.LOCATION_CHANGED
    assert arranged.mountain_of(CAMERALESS_DRAFT.mountain.id) == CAMERALESS_DRAFT.mountain


def test_the_coordinates_are_judged_before_the_camera(arranged):
    stale_camera = replace(ACTIVE.mountain.camera, heading_degrees=1.0)

    change = arranged.store.replace_camera(ACTIVE.mountain.id, NEW_CAMERA, stale_camera, MOVED)

    assert change is CameraChange.LOCATION_CHANGED
