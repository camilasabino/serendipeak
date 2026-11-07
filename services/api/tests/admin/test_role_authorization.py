from datetime import date

import pytest
from django.contrib.admin.models import LogEntry
from django.test import Client
from django.urls import reverse

from serendipeak.accounts.roles import Role
from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.admin.support import form_payload
from tests.support.catalog import catalog_discovery, catalog_mountain
from tests.support.users import create_user

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
NO_IMAGE_DRAFT = catalog_mountain(
    "bare-peak", status=MountainStatus.DRAFT, primary_image=None, countries=()
)
ACTIVE = catalog_mountain("aconcagua")
DAY = date(2026, 1, 15)

LOGIN_URL = reverse("admin:login")


def mountain_url(view, entry=DRAFT, *args):
    return reverse(f"admin:catalog_mountainrecord_{view}", args=[entry.mountain.id, *args])


def transition_url(entry, kind):
    return reverse("admin:catalog_mountainrecord_transition", args=[entry.mountain.id, kind])


READ_PAGES = {
    "index": lambda: reverse("admin:index"),
    "mountain list": lambda: reverse("admin:catalog_mountainrecord_changelist"),
    "mountain page": lambda: mountain_url("change"),
    "camera confirmation": lambda: (
        mountain_url("camera") + "?heading=10&pitch=-20&range=5000&fx=0.1&fy=0.2"
    ),
    "discovery list": lambda: reverse("admin:catalog_dailydiscoveryrecord_changelist"),
}
WRITE_REQUESTS = {
    "add mountain": lambda: ("get", reverse("admin:catalog_mountainrecord_add")),
    "save mountain": lambda: ("post", mountain_url("change")),
    "delete draft page": lambda: ("get", mountain_url("delete")),
    "delete draft": lambda: ("post", mountain_url("delete")),
    "publish": lambda: ("post", transition_url(DRAFT, "publish")),
    "deactivate": lambda: ("post", transition_url(ACTIVE, "deactivate")),
    "save camera": lambda: ("post", mountain_url("camera", ACTIVE)),
    "add discovery": lambda: ("get", reverse("admin:catalog_dailydiscoveryrecord_add")),
}
USER_PAGES = {
    "user list": lambda user: reverse("admin:catalog_userrecord_changelist"),
    "add user": lambda user: reverse("admin:catalog_userrecord_add"),
    "user page": lambda user: reverse("admin:catalog_userrecord_change", args=[user.pk]),
    "user password": lambda user: reverse("admin:auth_user_password_change", args=[user.pk]),
    "delete user": lambda user: reverse("admin:catalog_userrecord_delete", args=[user.pk]),
}


@pytest.fixture(autouse=True)
def catalog(load_catalog):
    load_catalog(DRAFT, NO_IMAGE_DRAFT, ACTIVE, discoveries=[catalog_discovery(DAY, ACTIVE)])


def snapshot():
    return (
        list(MountainRecord.objects.order_by("slug").values()),
        list(MountainImageRecord.objects.order_by("pk").values()),
        LogEntry.objects.count(),
    )


@pytest.fixture(params=["anonymous", "inactive editor", "inactive viewer"])
def without_access(request, db):
    client = Client()
    if request.param != "anonymous":
        role = Role.EDITOR if "editor" in request.param else Role.VIEWER
        client.force_login(create_user("inactive", role, is_active=False))

    return client


class TestWithoutAccess:
    @pytest.mark.parametrize("page", READ_PAGES)
    def test_every_page_sends_the_visitor_to_the_login(self, without_access, page):
        response = without_access.get(READ_PAGES[page]())

        assert response.status_code == 302
        assert response.headers["Location"].startswith(LOGIN_URL)

    @pytest.mark.parametrize("request_name", WRITE_REQUESTS)
    def test_no_write_request_changes_anything(self, without_access, request_name):
        before = snapshot()
        method, url = WRITE_REQUESTS[request_name]()

        response = getattr(without_access, method)(url, {"summary_en": "Changed."})

        assert response.status_code == 302
        assert response.headers["Location"].startswith(LOGIN_URL)
        assert snapshot() == before

    @pytest.mark.parametrize("page", USER_PAGES)
    def test_no_user_page_is_reachable(self, without_access, db, page):
        response = without_access.get(USER_PAGES[page](create_user("someone")))

        assert response.status_code == 302
        assert response.headers["Location"].startswith(LOGIN_URL)


class TestViewer:
    @pytest.mark.parametrize("page", [name for name in READ_PAGES if name != "camera confirmation"])
    def test_a_viewer_reads_the_editorial_pages(self, viewer_client, page):
        assert viewer_client.get(READ_PAGES[page]()).status_code == 200

    @pytest.mark.parametrize("request_name", WRITE_REQUESTS)
    def test_a_viewer_cannot_write_anything(self, viewer_client, request_name):
        before = snapshot()
        method, url = WRITE_REQUESTS[request_name]()

        response = getattr(viewer_client, method)(url, {"summary_en": "Changed."})

        assert response.status_code == 403
        assert snapshot() == before

    def test_a_viewer_gets_a_read_only_mountain_page(self, viewer_client):
        page = viewer_client.get(mountain_url("change"))

        assert page.context["has_change_permission"] is False
        assert page.context["has_delete_permission"] is False
        assert "_save" not in page.content.decode()

    @pytest.mark.parametrize("page", USER_PAGES)
    def test_a_viewer_cannot_open_any_user_page(self, viewer_client, viewer, page):
        assert viewer_client.get(USER_PAGES[page](viewer)).status_code == 403


class TestEditor:
    @pytest.mark.parametrize("page", READ_PAGES)
    def test_an_editor_reads_the_editorial_pages(self, editor_client, page):
        assert editor_client.get(READ_PAGES[page]()).status_code == 200

    def test_an_editor_saves_a_mountain(self, editor_client):
        url = mountain_url("change")
        page = editor_client.get(url)

        response = editor_client.post(url, form_payload(page, summary_en="A new summary."))

        assert response.status_code == 302
        assert MountainRecord.objects.get(pk=DRAFT.mountain.id).summary_en == "A new summary."

    def test_an_editor_changes_the_publication_state(self, editor_client):
        response = editor_client.post(transition_url(ACTIVE, "deactivate"))

        assert response.status_code == 302
        assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).status == "inactive"

    def test_an_editor_deletes_a_draft(self, editor_client):
        response = editor_client.post(mountain_url("delete", NO_IMAGE_DRAFT), {"post": "yes"})

        assert response.status_code == 302
        assert not MountainRecord.objects.filter(pk=NO_IMAGE_DRAFT.mountain.id).exists()

    def test_nobody_edits_the_daily_discoveries(self, editor_client):
        add = reverse("admin:catalog_dailydiscoveryrecord_add")

        assert editor_client.get(add).status_code == 403


class TestSessionsFollowTheCurrentRole:
    def test_deactivating_a_user_ends_the_session_immediately(self, editor_client, editor):
        assert editor_client.get(READ_PAGES["mountain list"]()).status_code == 200

        type(editor).objects.filter(pk=editor.pk).update(is_active=False)

        response = editor_client.get(READ_PAGES["mountain list"]())
        assert response.status_code == 302
        assert response.headers["Location"].startswith(LOGIN_URL)

    def test_a_demoted_editor_loses_write_access_immediately(self, editor_client, editor):
        url = mountain_url("change")
        payload = form_payload(editor_client.get(url), summary_en="Written as editor.")

        type(editor).objects.filter(pk=editor.pk).update(role=Role.VIEWER.value)

        assert editor_client.post(url, payload).status_code == 403
        assert MountainRecord.objects.get(pk=DRAFT.mountain.id).summary_en != "Written as editor."

    def test_a_promoted_viewer_gains_write_access_immediately(self, viewer_client, viewer):
        url = mountain_url("change")
        assert viewer_client.post(url, {"summary_en": "No."}).status_code == 403

        type(viewer).objects.filter(pk=viewer.pk).update(role=Role.EDITOR.value)

        assert viewer_client.get(url).context["has_change_permission"] is True
