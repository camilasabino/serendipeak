import datetime
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from django.db import connection, transaction
from django.test import Client
from django.urls import reverse
from django.utils.http import urlencode

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.catalog.ports import CameraChange, StatusChangeOutcome
from serendipeak.catalog.publication import publication_violations
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.admin.support import form_payload
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.concurrency import WAIT_SECONDS, run_while_a_change_holds_the_lock
from tests.support.users import create_user

pytestmark = pytest.mark.django_db(transaction=True)

ACTIVE = catalog_mountain("aconcagua")
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
FRAMED_DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
PROPOSED = {"heading": "123.45", "pitch": "-12.5", "range": "4321", "fx": "0.125", "fy": "-0.25"}
PROPOSED_CAMERA = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)
OTHER_CAMERA = replace(PROPOSED_CAMERA, heading_degrees=200.0)


def camera_url(entry, query=None):
    url = reverse("admin:catalog_mountainrecord_camera", args=[entry.mountain.id])
    return f"{url}?{urlencode(query)}" if query else url


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


@pytest.fixture
def editor_client():
    DjangoCatalogStore().load(catalog_seed(ACTIVE, CAMERALESS_DRAFT, FRAMED_DRAFT))
    editor = create_user("editor")
    client = Client()
    client.force_login(editor)

    return client


def confirm(client, entry):
    payload = form_payload(client.get(camera_url(entry, PROPOSED)))

    return lambda: client.post(camera_url(entry), payload)


def an_admin_edit_of(entry, **columns):
    # The lock the Admin change view takes before it reads its forms.
    def change():
        MountainRecord.objects.select_for_update(no_key=True).filter(pk=entry.mountain.id).get()
        MountainRecord.objects.filter(pk=entry.mountain.id).update(**columns)

    return change


def test_a_camera_save_waiting_on_an_admin_edit_applies_afterwards(editor_client):
    save = confirm(editor_client, ACTIVE)

    response = run_while_a_change_holds_the_lock(an_admin_edit_of(ACTIVE, name_en="Renamed"), save)

    assert response.status_code == 302
    record = stored(ACTIVE)
    assert to_camera(record) == PROPOSED_CAMERA
    assert record.name_en == "Renamed"


def test_a_camera_save_waiting_on_a_publication_applies_and_keeps_the_new_status(editor_client):
    save = confirm(editor_client, FRAMED_DRAFT)

    def publish():
        change = DjangoMountainStatusStore().change_status(
            FRAMED_DRAFT.mountain.id, PUBLISH, publication_violations
        )
        assert change.outcome is StatusChangeOutcome.APPLIED

    response = run_while_a_change_holds_the_lock(publish, save)

    assert response.status_code == 302
    record = stored(FRAMED_DRAFT)
    assert record.status == MountainStatus.ACTIVE.value
    assert to_camera(record) == PROPOSED_CAMERA


def test_a_publication_waiting_on_a_camera_save_is_judged_with_the_new_camera(editor_client):
    def give_the_draft_a_camera():
        change = DjangoMountainCameraStore().replace_camera(
            CAMERALESS_DRAFT.mountain.id, PROPOSED_CAMERA, None
        )
        assert change is CameraChange.APPLIED

    def publish():
        return DjangoMountainStatusStore().change_status(
            CAMERALESS_DRAFT.mountain.id, PUBLISH, publication_violations
        )

    publication = run_while_a_change_holds_the_lock(give_the_draft_a_camera, publish)

    assert publication.outcome is StatusChangeOutcome.APPLIED
    assert stored(CAMERALESS_DRAFT).status == MountainStatus.ACTIVE.value


def test_a_camera_save_waiting_on_another_camera_change_is_stale_and_writes_nothing(
    editor_client,
):
    save = confirm(editor_client, ACTIVE)

    def another_camera_change():
        change = DjangoMountainCameraStore().replace_camera(
            ACTIVE.mountain.id, OTHER_CAMERA, ACTIVE.mountain.camera
        )
        assert change is CameraChange.APPLIED

    response = run_while_a_change_holds_the_lock(another_camera_change, save)

    assert response.status_code == 302
    assert response["Location"].startswith(camera_url(ACTIVE) + "?")
    assert to_camera(stored(ACTIVE)) == OTHER_CAMERA


def test_a_camera_change_in_flight_does_not_block_the_daily_discovery_of_its_mountain(
    editor_client,
):
    locked = threading.Event()
    release = threading.Event()
    day = datetime.date(2026, 11, 6)

    def hold_a_camera_change():
        try:
            with transaction.atomic():
                DjangoMountainCameraStore().replace_camera(
                    ACTIVE.mountain.id, PROPOSED_CAMERA, ACTIVE.mountain.camera
                )
                locked.set()
                assert release.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def discover():
        try:
            return DjangoDailyDiscoveryRepository().insert_or_get(day, ACTIVE.mountain.id)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_a_camera_change)
        assert locked.wait(WAIT_SECONDS)
        try:
            discovery = pool.submit(discover).result(WAIT_SECONDS)
        finally:
            release.set()
        holder.result(WAIT_SECONDS)

    assert discovery.mountain.id == ACTIVE.mountain.id
    assert to_camera(stored(ACTIVE)) == PROPOSED_CAMERA
