import pytest
from django.contrib.auth.models import Permission, User
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChangeOutcome
from serendipeak.catalog.publication import publication_violations
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.admin.support import form_payload
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
CHANGE_URL = reverse("admin:catalog_mountainrecord_change", args=[DRAFT.mountain.id])
DELETE_URL = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


@pytest.fixture
def editor_client():
    DjangoCatalogStore().load(catalog_seed(DRAFT, ACTIVE, INACTIVE))
    editor = User.objects.create_user("editor", password="not-used", is_staff=True)
    editor.user_permissions.set(
        Permission.objects.filter(
            codename__in=[
                "view_mountainrecord",
                "change_mountainrecord",
                "delete_mountainrecord",
            ]
        )
    )
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


def test_an_edit_posted_against_a_draft_is_judged_against_the_publication_it_waited_for(
    editor_client,
):
    payload = form_payload(
        editor_client.get(CHANGE_URL),
        **{"image-0-license_name": "", "image-0-license_url": ""},
    )

    response = run_while_a_publication_holds_the_lock(
        lambda: editor_client.post(CHANGE_URL, payload)
    )

    assert response.status_code == 200
    assert "Not allowed on a published mountain" in response.content.decode()
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "active"
    image = MountainImageRecord.objects.get(pk=DRAFT.mountain.id)
    assert image.license_name == DRAFT.mountain.primary_image.license_name
    assert image.license_url == DRAFT.mountain.primary_image.license_url


def test_a_deletion_posted_against_a_draft_is_refused_once_the_publication_it_waited_for_commits(
    editor_client,
):
    response = run_while_a_publication_holds_the_lock(
        lambda: editor_client.post(DELETE_URL, {"post": "yes"})
    )

    assert response.status_code == 403
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
    assert record.name == "Renamed"


def test_an_edit_is_judged_against_the_camera_committed_while_it_waited(editor_client):
    payload = form_payload(editor_client.get(change_url(INACTIVE)), name="Renamed")
    framing_removal = locked_update(INACTIVE, camera_framing_x=None, camera_framing_y=None)

    response = run_while_a_change_holds_the_lock(
        framing_removal, lambda: editor_client.post(change_url(INACTIVE), payload)
    )

    assert response.status_code == 200
    assert "the camera framing is missing" in response.content.decode()
    assert stored(INACTIVE).name == INACTIVE.mountain.name
