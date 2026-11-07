from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from tests.support.catalog import catalog_mountain

ADMIN_ROOT = "/admin/"
CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)


def test_the_index_lists_users_mountain_records_and_daily_discovery_records(editor_client):
    html = editor_client.get(ADMIN_ROOT).content.decode()

    assert "Users" in html
    assert "Mountain records" in html
    assert "Daily discovery records" in html
    assert "Groups" not in html
    assert "Authentication and Authorization" not in html


def test_a_viewer_does_not_see_the_users_section(viewer_client):
    html = viewer_client.get(ADMIN_ROOT).content.decode()

    assert "Mountain records" in html
    assert "Users" not in html


def test_there_are_no_group_pages(editor_client):
    assert editor_client.get("/admin/auth/group/").status_code == 404
    assert editor_client.get("/admin/auth/group/add/").status_code == 404


def test_there_is_no_auth_user_page(editor_client):
    assert editor_client.get("/admin/auth/user/").status_code == 404


def test_the_sidebar_has_no_visible_filter_but_keeps_the_element_the_script_needs(
    editor_client,
):
    html = editor_client.get(CHANGELIST_URL).content.decode()

    assert "Start typing to filter" not in html
    assert 'id="nav-filter"' in html
    filter_tag = html[html.index("<input", html.index('id="nav-sidebar"')) :].split(">")[0]
    assert "hidden" in filter_tag


def test_filter_counts_are_shown_without_a_toggle(editor_client, load_catalog):
    load_catalog(DRAFT)

    html = editor_client.get(CHANGELIST_URL).content.decode()

    assert "Show counts" not in html
    assert "Hide counts" not in html
    assert "Draft" in html
    assert "(1)" in html


def test_the_summary_is_a_multiline_textarea(editor_client, load_catalog):
    load_catalog(DRAFT)
    url = reverse("admin:catalog_mountainrecord_change", args=[DRAFT.mountain.id])

    page = editor_client.get(url)

    html = page.content.decode()
    assert '<textarea name="summary_en"' in html
    assert 'rows="3"' in html
    assert "serendipeak/admin/editorial.css" in html
