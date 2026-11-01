import pytest
from django.contrib.auth.models import Permission, User
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from tests.admin.support import input_names
from tests.support.catalog import catalog_mountain

ADMIN_ROOT = "/admin/"
CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)


@pytest.fixture
def superuser_client(client, db):
    client.force_login(User.objects.create_superuser("root", password="not-used"))

    return client


def test_the_index_lists_users_mountain_records_and_daily_discovery_records(superuser_client):
    html = superuser_client.get(ADMIN_ROOT).content.decode()

    assert ">Users<" in html
    assert "Mountain records" in html
    assert "Daily discovery records" in html
    assert "Groups" not in html
    assert "Authentication and Authorization" not in html
    assert "Accounts" not in html


def test_the_auth_app_keeps_its_label_so_no_migration_is_needed():
    from django.apps import apps

    assert apps.get_app_config("auth").label == "auth"
    assert apps.get_app_config("auth").verbose_name == "Users"


def test_there_are_no_group_pages(superuser_client):
    assert superuser_client.get("/admin/auth/group/").status_code == 404
    assert superuser_client.get("/admin/auth/group/add/").status_code == 404


def test_the_user_form_has_no_groups_input(superuser_client):
    user = User.objects.create_user("someone", password="not-used")

    page = superuser_client.get(reverse("admin:auth_user_change", args=[user.pk]))

    assert page.status_code == 200
    assert "groups" not in input_names(page)
    assert "groups" not in page.content.decode()


def test_the_user_list_has_no_groups_filter(superuser_client):
    html = superuser_client.get(reverse("admin:auth_user_changelist")).content.decode()

    assert "By groups" not in html


def test_user_permissions_offer_only_catalog_permissions(superuser_client):
    user = User.objects.create_user("someone", password="not-used")

    page = superuser_client.get(reverse("admin:auth_user_change", args=[user.pk]))

    form = page.context["adminform"].form
    queryset = form.fields["user_permissions"].queryset
    assert queryset.exists()
    assert set(queryset.values_list("content_type__app_label", flat=True)) == {"catalog"}
    assert Permission.objects.exclude(content_type__app_label="catalog").exists()


def test_the_sidebar_has_no_visible_filter_but_keeps_the_element_the_script_needs(
    superuser_client,
):
    html = superuser_client.get(CHANGELIST_URL).content.decode()

    assert "Start typing to filter" not in html
    assert 'id="nav-filter"' in html
    filter_tag = html[html.index("<input", html.index('id="nav-sidebar"')) :].split(">")[0]
    assert "hidden" in filter_tag


def test_filter_counts_are_shown_without_a_toggle(superuser_client, load_catalog):
    load_catalog(DRAFT)

    html = superuser_client.get(CHANGELIST_URL).content.decode()

    assert "Show counts" not in html
    assert "Hide counts" not in html
    assert "Draft" in html
    assert "(1)" in html


def test_the_summary_is_a_multiline_textarea(publisher_client, load_catalog):
    load_catalog(DRAFT)
    url = reverse("admin:catalog_mountainrecord_change", args=[DRAFT.mountain.id])

    page = publisher_client.get(url)

    html = page.content.decode()
    assert '<textarea name="summary"' in html
    assert 'rows="3"' in html
    assert "serendipeak/admin/editorial.css" in html
