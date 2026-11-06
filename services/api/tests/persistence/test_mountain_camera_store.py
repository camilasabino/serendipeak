import uuid
from dataclasses import replace

import pytest

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.catalog.ports import CameraChange
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from tests.support.catalog import UPDATED_AT, catalog_mountain, catalog_seed

pytestmark = pytest.mark.django_db

ACTIVE = catalog_mountain("aconcagua")
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
NEW_CAMERA = CanonicalCamera(
    heading_degrees=200.5,
    pitch_degrees=-30.25,
    range_meters=12000.0,
    framing=CameraFraming(x=0.25, y=-0.5),
)


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_seed(ACTIVE, CAMERALESS_DRAFT))
    return DjangoMountainCameraStore()


def row(entry):
    return MountainRecord.objects.filter(pk=entry.mountain.id).values().get()


def test_an_applied_change_touches_only_the_camera_and_updated_at(store):
    before = row(ACTIVE)

    store.replace_camera(ACTIVE.mountain.id, NEW_CAMERA, ACTIVE.mountain.camera)

    after = row(ACTIVE)
    changed = {name for name in before if before[name] != after[name]}
    assert changed == {
        "camera_heading_degrees",
        "camera_pitch_degrees",
        "camera_range_meters",
        "camera_framing_x",
        "camera_framing_y",
        "updated_at",
    }
    assert after["updated_at"] > UPDATED_AT
    assert after["status"] == MountainStatus.ACTIVE.value


def test_a_stale_change_leaves_updated_at_alone(store):
    store.replace_camera(ACTIVE.mountain.id, NEW_CAMERA, None)

    assert row(ACTIVE)["updated_at"] == UPDATED_AT


def test_a_change_locks_the_mountain_then_updates_in_one_transaction(
    store, django_assert_num_queries
):
    with django_assert_num_queries(4) as captured:
        store.replace_camera(ACTIVE.mountain.id, NEW_CAMERA, ACTIVE.mountain.camera)

    statements = [query["sql"] for query in captured.captured_queries]
    assert statements[0].startswith("SAVEPOINT")
    assert statements[1].endswith("FOR NO KEY UPDATE")
    assert "mountain_image" not in statements[1]
    assert statements[2].startswith('UPDATE "mountain"')
    assert statements[3].startswith("RELEASE SAVEPOINT")


@pytest.mark.parametrize(
    ("mountain_id", "outcome"),
    [(ACTIVE.mountain.id, CameraChange.STALE), (uuid.UUID(int=1), CameraChange.NOT_FOUND)],
    ids=["stale", "unknown"],
)
def test_a_change_that_writes_nothing_is_only_the_locking_read(
    store, django_assert_num_queries, mountain_id, outcome
):
    with django_assert_num_queries(3) as captured:
        change = store.replace_camera(mountain_id, NEW_CAMERA, None)

    assert change is outcome
    assert not any(query["sql"].startswith("UPDATE") for query in captured.captured_queries)


@pytest.mark.parametrize(
    "camera",
    [
        replace(NEW_CAMERA, heading_degrees=360.0),
        replace(NEW_CAMERA, pitch_degrees=float("nan")),
        replace(NEW_CAMERA, framing=CameraFraming(x=1.5, y=0.0)),
    ],
    ids=["heading", "nan-pitch", "framing"],
)
def test_the_database_still_refuses_an_out_of_bounds_camera(store, camera):
    with pytest.raises(InfrastructureError):
        store.replace_camera(CAMERALESS_DRAFT.mountain.id, camera, None)

    assert row(CAMERALESS_DRAFT)["camera_heading_degrees"] is None


def test_the_database_still_refuses_an_active_mountain_without_framing(store):
    with pytest.raises(InfrastructureError):
        store.replace_camera(
            ACTIVE.mountain.id, replace(NEW_CAMERA, framing=None), ACTIVE.mountain.camera
        )

    assert row(ACTIVE)["camera_framing_x"] == ACTIVE.mountain.camera.framing.x
