import datetime
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChangeOutcome
from serendipeak.catalog.publication import publication_violations
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainImageRecord,
    MountainRecord,
)
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.studio.support import form_payload, jpeg, upload, use_fake_media_store
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.concurrency import (
    WAIT_SECONDS,
    run_while_a_change_holds_the_lock,
)
from tests.support.fakes import FakeMediaStore
from tests.support.users import create_user

pytestmark = pytest.mark.django_db(transaction=True)

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
CHANGE_URL = reverse("studio:mountain_edit", args=[DRAFT.mountain.slug])
DELETE_URL = reverse("studio:mountain_delete", args=[DRAFT.mountain.slug])


# A replacement that keeps the previous credit has to say it reviewed it.
REPLACEMENT = {"photograph-credit_reviewed": "on"}


def change_url(entry):
    return reverse("studio:mountain_edit", args=[entry.mountain.slug])


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


@pytest.fixture
def editor_client():
    DjangoCatalogStore().load(catalog_seed(DRAFT, ACTIVE, INACTIVE))
    editor = create_user("editor")
    client = Client()
    client.force_login(editor)

    return client


def publish_the_draft():
    change = DjangoMountainStatusStore().change_status(
        DRAFT.mountain.id, PUBLISH, publication_violations
    )
    assert change.outcome is StatusChangeOutcome.APPLIED


def run_while_a_publication_holds_the_lock(request):
    return run_while_a_change_holds_the_lock(publish_the_draft, request)


def locked_update(entry, **columns):
    def change():
        MountainRecord.objects.select_for_update().filter(pk=entry.mountain.id).get()
        MountainRecord.objects.filter(pk=entry.mountain.id).update(**columns)

    return change


@pytest.fixture
def media_store(monkeypatch):
    return use_fake_media_store(monkeypatch)


def test_a_credit_edit_posted_against_a_draft_is_saved_after_the_publication_it_waited_for(
    editor_client,
):
    payload = form_payload(editor_client.get(CHANGE_URL), **{"photograph-author": "New Author"})

    response = run_while_a_publication_holds_the_lock(
        lambda: editor_client.post(CHANGE_URL, payload)
    )

    assert response.status_code == 302
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "active"
    image = MountainImageRecord.objects.get(pk=DRAFT.mountain.id)
    assert image.author == "New Author"
    assert image.original_sha256 == DRAFT.mountain.primary_image.media.original_sha256


def test_a_replacement_posted_against_a_draft_is_stored_after_the_publication_it_waited_for(
    editor_client, media_store
):
    data = jpeg((1200, 900))
    payload = form_payload(
        editor_client.get(CHANGE_URL), **REPLACEMENT | {"photograph-file": upload(data)}
    )

    response = run_while_a_publication_holds_the_lock(
        lambda: editor_client.post(CHANGE_URL, payload)
    )

    assert response.status_code == 302
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "active"
    image = MountainImageRecord.objects.get(pk=DRAFT.mountain.id)
    assert image.original_sha256 == hashlib.sha256(data).hexdigest()
    assert {image.page_key, image.viewer_key} <= set(media_store.public)


def test_a_replacement_is_judged_against_the_camera_committed_while_it_waited(
    editor_client, media_store
):
    payload = form_payload(
        editor_client.get(change_url(INACTIVE)),
        **REPLACEMENT | {"photograph-file": upload(jpeg())},
    )
    framing_removal = locked_update(INACTIVE, camera_framing_x=None, camera_framing_y=None)

    response = run_while_a_change_holds_the_lock(
        framing_removal, lambda: editor_client.post(change_url(INACTIVE), payload)
    )

    assert response.status_code == 200
    assert "The camera framing is missing." in response.content.decode()
    image = MountainImageRecord.objects.get(pk=INACTIVE.mountain.id)
    assert image.original_sha256 == INACTIVE.mountain.primary_image.media.original_sha256


def test_a_deletion_posted_against_a_draft_is_refused_once_the_publication_it_waited_for_commits(
    editor_client,
):
    response = run_while_a_publication_holds_the_lock(lambda: editor_client.post(DELETE_URL))

    assert response.status_code == 302
    assert response["Location"] != reverse("studio:mountain_list")
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "active"
    assert MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).exists()


def test_a_camera_committed_while_an_edit_waits_survives_the_edit(editor_client):
    payload = form_payload(editor_client.get(change_url(ACTIVE)), name="Renamed")
    camera_change = locked_update(ACTIVE, camera_heading_degrees=10.0, camera_framing_x=0.1)

    response = run_while_a_change_holds_the_lock(
        camera_change, lambda: editor_client.post(change_url(ACTIVE), payload)
    )

    assert response.status_code == 302
    record = stored(ACTIVE)
    assert (record.camera_heading_degrees, record.camera_framing_x) == (10.0, 0.1)
    assert record.name_en == "Renamed"


def test_an_edit_is_judged_against_the_camera_committed_while_it_waited(editor_client):
    payload = form_payload(editor_client.get(change_url(INACTIVE)), name="Renamed")
    framing_removal = locked_update(INACTIVE, camera_framing_x=None, camera_framing_y=None)

    response = run_while_a_change_holds_the_lock(
        framing_removal, lambda: editor_client.post(change_url(INACTIVE), payload)
    )

    assert response.status_code == 200
    assert "The camera framing is missing." in response.content.decode()
    assert stored(INACTIVE).name_en == INACTIVE.mountain.name.en


class StoreHeldOpen(FakeMediaStore):
    """A media store whose first write stays in flight until the test releases it."""

    def __init__(self):
        super().__init__()
        self.write_started = threading.Event()
        self.release = threading.Event()

    def put_original(self, key, data, content_type):
        self.write_started.set()
        assert self.release.wait(WAIT_SECONDS)
        super().put_original(key, data, content_type)


def post_a_replacement_held_in_the_store(pool, client, store):
    payload = form_payload(
        client.get(change_url(ACTIVE)),
        **REPLACEMENT | {"photograph-file": upload(jpeg((1200, 900)))},
    )

    def post():
        try:
            return client.post(change_url(ACTIVE), payload)
        finally:
            connection.close()

    upload_in_flight = pool.submit(post)
    assert store.write_started.wait(WAIT_SECONDS)

    return upload_in_flight


def test_an_upload_in_flight_does_not_block_the_daily_discovery_of_its_mountain(
    editor_client, monkeypatch
):
    store = use_fake_media_store(monkeypatch, StoreHeldOpen())
    day = datetime.date(2026, 11, 6)

    def discover():
        try:
            return DjangoDailyDiscoveryRepository().insert_or_get(day, ACTIVE.mountain.id)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        upload_in_flight = post_a_replacement_held_in_the_store(pool, editor_client, store)
        try:
            discovery = pool.submit(discover).result(WAIT_SECONDS)
        finally:
            store.release.set()

        assert upload_in_flight.result(WAIT_SECONDS).status_code == 302

    assert discovery.mountain.id == ACTIVE.mountain.id
    assert DailyDiscoveryRecord.objects.filter(date=day).count() == 1


def test_a_publication_is_not_held_up_by_an_upload_in_flight_on_the_same_mountain(
    editor_client, monkeypatch
):
    store = use_fake_media_store(monkeypatch, StoreHeldOpen())
    payload = form_payload(
        editor_client.get(CHANGE_URL),
        **REPLACEMENT | {"photograph-file": upload(jpeg((1200, 900)))},
    )

    def post():
        try:
            return editor_client.post(CHANGE_URL, payload)
        finally:
            connection.close()

    def publish():
        try:
            return DjangoMountainStatusStore().change_status(
                DRAFT.mountain.id, PUBLISH, publication_violations
            )
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        upload_in_flight = pool.submit(post)
        assert store.write_started.wait(WAIT_SECONDS)
        try:
            publication = pool.submit(publish).result(WAIT_SECONDS)
        finally:
            store.release.set()

        assert upload_in_flight.result(WAIT_SECONDS).status_code == 302

    assert publication.outcome is StatusChangeOutcome.APPLIED
    image = MountainImageRecord.objects.get(pk=DRAFT.mountain.id)
    assert {image.page_key, image.viewer_key} <= set(store.public)
