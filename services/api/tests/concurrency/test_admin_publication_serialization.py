import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth.models import Permission, User
from django.db import connection, transaction
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
from tests.support.concurrency import (
    WAIT_SECONDS,
    a_backend_is_waiting_for_a_row_lock,
    wait_until,
)

pytestmark = pytest.mark.django_db(transaction=True)

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
CHANGE_URL = reverse("admin:catalog_mountainrecord_change", args=[DRAFT.mountain.id])
DELETE_URL = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])


@pytest.fixture
def editor_client():
    DjangoCatalogStore().load(catalog_seed(DRAFT))
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


def run_while_a_publication_holds_the_lock(request):
    """Run request in a thread that blocks behind a publication which has not yet committed.

    The publication goes through the real adapter inside an outer transaction, so the row lock
    it takes stays held until the test lets that transaction commit.
    """
    published_but_uncommitted = threading.Event()
    commit_the_publication = threading.Event()

    def publish():
        try:
            with transaction.atomic():
                change = DjangoMountainStatusStore().change_status(
                    DRAFT.mountain.id, PUBLISH, publication_violations
                )
                assert change.outcome is StatusChangeOutcome.APPLIED
                published_but_uncommitted.set()
                assert commit_the_publication.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def send_request():
        try:
            return request()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        publication = pool.submit(publish)
        assert published_but_uncommitted.wait(WAIT_SECONDS)
        stale_request = pool.submit(send_request)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not stale_request.done()
        commit_the_publication.set()

        publication.result(WAIT_SECONDS)

        return stale_request.result(WAIT_SECONDS)


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
