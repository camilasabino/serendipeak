import datetime
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection, transaction
from django.test import Client
from django.urls import reverse
from django.utils.http import urlencode

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, Coordinates, MountainStatus
from serendipeak.catalog.ports import CameraChange, StatusChangeOutcome
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation
from serendipeak.catalog.status_transitions import PUBLISH, REACTIVATE
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.mapping import to_camera, to_coordinates
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from serendipeak.persistence.mountain_location_store import DjangoMountainLocationStore
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.studio.support import form_payload, hidden_inputs
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.concurrency import WAIT_SECONDS, run_while_a_change_holds_the_lock
from tests.support.users import create_user

pytestmark = pytest.mark.django_db(transaction=True)

FRAMED_DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
ACTIVE = catalog_mountain("aconcagua")
MOVED = Coordinates(latitude=-33.25, longitude=-70.75)
PROPOSED = {"heading": "123.45", "pitch": "-12.5", "range": "4321", "fx": "0.125", "fy": "-0.25"}
PROPOSED_CAMERA = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)


def allow(status, stored):
    return judge_relocation(status, stored, MOVED, True)


def relocate(entry):
    return DjangoMountainLocationStore().relocate(entry.mountain.id, MOVED, allow)


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


def camera_url(entry, query=None):
    url = reverse("studio:mountain_camera", args=[entry.mountain.slug])
    if not query:
        return url
    coordinates = entry.mountain.coordinates
    located = {
        "lat": repr(coordinates.latitude),
        "lon": repr(coordinates.longitude),
        "mountain": str(entry.mountain.id),
        **query,
    }

    return f"{url}?{urlencode(located)}"


def change_url(entry):
    return reverse("studio:mountain_edit", args=[entry.mountain.slug])


@pytest.fixture
def editor_client():
    DjangoCatalogStore().load(catalog_seed(ACTIVE, FRAMED_DRAFT, CAMERALESS_DRAFT, INACTIVE))
    client = Client()
    client.force_login(create_user("editor"))

    return client


def moved_and_cleared(entry):
    record = stored(entry)

    return to_coordinates(record) == MOVED and to_camera(record) is None


@pytest.mark.parametrize("entry", [FRAMED_DRAFT, CAMERALESS_DRAFT], ids=["framed", "cameraless"])
def test_a_camera_save_waiting_on_a_move_is_refused_even_when_no_camera_is_involved(
    editor_client, entry
):
    payload = hidden_inputs(editor_client.get(camera_url(entry, PROPOSED)))

    def save():
        return editor_client.post(camera_url(entry), payload)

    response = run_while_a_change_holds_the_lock(lambda: relocate(entry), save)

    assert response.status_code == 409
    assert "Nothing was saved" in response.content.decode()
    assert moved_and_cleared(entry)


def test_a_move_waiting_on_a_camera_save_clears_the_camera_that_was_just_saved(editor_client):
    def save_a_camera():
        change = DjangoMountainCameraStore().replace_camera(
            FRAMED_DRAFT.mountain.id,
            PROPOSED_CAMERA,
            FRAMED_DRAFT.mountain.camera,
            FRAMED_DRAFT.mountain.coordinates,
        )
        assert change is CameraChange.APPLIED

    outcome = run_while_a_change_holds_the_lock(save_a_camera, lambda: relocate(FRAMED_DRAFT))

    assert outcome is RelocationOutcome.APPLIED
    assert moved_and_cleared(FRAMED_DRAFT)


def test_a_publication_waiting_on_a_move_is_judged_without_the_camera(editor_client):
    def publish():
        return DjangoMountainStatusStore().change_status(
            FRAMED_DRAFT.mountain.id, PUBLISH, publication_violations
        )

    publication = run_while_a_change_holds_the_lock(lambda: relocate(FRAMED_DRAFT), publish)

    assert publication.outcome is StatusChangeOutcome.REJECTED
    assert PublicationViolation.CAMERA_MISSING in publication.violations
    assert stored(FRAMED_DRAFT).status == MountainStatus.DRAFT.value


def test_a_move_waiting_on_a_publication_sees_the_mountain_active_and_writes_nothing(
    editor_client,
):
    def publish():
        change = DjangoMountainStatusStore().change_status(
            FRAMED_DRAFT.mountain.id, PUBLISH, publication_violations
        )
        assert change.outcome is StatusChangeOutcome.APPLIED

    outcome = run_while_a_change_holds_the_lock(publish, lambda: relocate(FRAMED_DRAFT))

    assert outcome is RelocationOutcome.ACTIVE_MOUNTAIN
    record = stored(FRAMED_DRAFT)
    assert record.status == MountainStatus.ACTIVE.value
    assert to_coordinates(record) == FRAMED_DRAFT.mountain.coordinates
    assert to_camera(record) == FRAMED_DRAFT.mountain.camera


def test_an_edit_moving_the_coordinates_waiting_on_a_reactivation_is_refused(editor_client):
    page = editor_client.get(change_url(INACTIVE))
    payload = form_payload(
        page,
        latitude=str(MOVED.latitude),
        longitude=str(MOVED.longitude),
        confirm_camera_reset="on",
    )

    def reactivate():
        change = DjangoMountainStatusStore().change_status(
            INACTIVE.mountain.id, REACTIVATE, publication_violations
        )
        assert change.outcome is StatusChangeOutcome.APPLIED

    response = run_while_a_change_holds_the_lock(
        reactivate, lambda: editor_client.post(change_url(INACTIVE), payload)
    )

    assert response.status_code == 302
    assert response["Location"] == change_url(INACTIVE)
    record = stored(INACTIVE)
    assert record.status == MountainStatus.ACTIVE.value
    assert to_coordinates(record) == INACTIVE.mountain.coordinates
    assert to_camera(record) == INACTIVE.mountain.camera


def test_an_edit_moving_the_coordinates_waiting_on_a_camera_save_clears_that_camera(
    editor_client,
):
    payload = form_payload(
        editor_client.get(change_url(FRAMED_DRAFT)),
        latitude=str(MOVED.latitude),
        longitude=str(MOVED.longitude),
        confirm_camera_reset="on",
    )

    def save_a_camera():
        change = DjangoMountainCameraStore().replace_camera(
            FRAMED_DRAFT.mountain.id,
            PROPOSED_CAMERA,
            FRAMED_DRAFT.mountain.camera,
            FRAMED_DRAFT.mountain.coordinates,
        )
        assert change is CameraChange.APPLIED

    response = run_while_a_change_holds_the_lock(
        save_a_camera, lambda: editor_client.post(change_url(FRAMED_DRAFT), payload)
    )

    assert response.status_code == 302
    assert moved_and_cleared(FRAMED_DRAFT)


def test_a_move_in_flight_does_not_block_the_daily_discovery_of_its_mountain(editor_client):
    locked = threading.Event()
    release = threading.Event()
    day = datetime.date(2026, 11, 6)

    def hold_a_move():
        try:
            with transaction.atomic():
                relocate(INACTIVE)
                locked.set()
                assert release.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def discover():
        try:
            return DjangoDailyDiscoveryRepository().insert_or_get(day, INACTIVE.mountain.id)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_a_move)
        assert locked.wait(WAIT_SECONDS)
        try:
            discovery = pool.submit(discover).result(WAIT_SECONDS)
        finally:
            release.set()
        holder.result(WAIT_SECONDS)

    assert discovery.mountain.id == INACTIVE.mountain.id
    assert moved_and_cleared(INACTIVE)
