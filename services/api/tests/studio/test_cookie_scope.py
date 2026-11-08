import pytest
from django.apps import apps
from django.conf import settings
from django.contrib.sessions.models import Session
from django.test import Client
from django.urls import NoReverseMatch, get_resolver, reverse

from tests.studio.support import LANDING_URL, LOGIN_URL, PASSWORD, sign_in
from tests.support.users import create_user

PUBLIC_PATHS = ["/healthz", "/api/v1/mountains/today", "/api/v1/mountains/random"]


@pytest.fixture
def editor(db):
    return create_user("camila-sabino", password=PASSWORD)


def test_the_session_and_csrf_cookies_are_scoped_to_the_studio():
    assert settings.SESSION_COOKIE_PATH == "/studio/"
    assert settings.CSRF_COOKIE_PATH == "/studio/"


def test_the_cookies_do_not_use_the_names_of_the_earlier_site_wide_ones():
    assert settings.SESSION_COOKIE_NAME not in settings.LEGACY_COOKIE_NAMES
    assert settings.CSRF_COOKIE_NAME not in settings.LEGACY_COOKIE_NAMES


def test_signing_in_sets_a_session_cookie_that_only_the_studio_receives(editor):
    response = sign_in(Client())

    assert response.cookies[settings.SESSION_COOKIE_NAME]["path"] == "/studio/"


def test_the_csrf_cookie_is_set_for_the_studio_path_only(db):
    response = Client().get(LOGIN_URL)

    assert response.cookies[settings.CSRF_COOKIE_NAME]["path"] == "/studio/"


def test_signing_out_expires_the_session_cookie_on_the_path_it_was_set_for(editor):
    client = Client()
    sign_in(client)

    response = client.post(reverse("studio:logout"))

    cookie = response.cookies[settings.SESSION_COOKIE_NAME]
    assert (cookie["path"], cookie["max-age"]) == ("/studio/", 0)


@pytest.mark.parametrize("path", PUBLIC_PATHS)
def test_the_public_paths_never_set_a_cookie_for_a_signed_in_browser(editor, path):
    client = Client()
    sign_in(client)

    response = client.get(path)

    assert not response.cookies


class TestCookiesOfAnEarlierDeployment:
    @pytest.mark.parametrize("name", settings.LEGACY_COOKIE_NAMES)
    def test_the_studio_expires_each_one_on_the_site_wide_path(self, db, name):
        client = Client()
        client.cookies[name] = "stale"

        response = client.get(LOGIN_URL)

        cookie = response.cookies[name]
        assert (cookie["path"], cookie["max-age"]) == ("/", 0)

    def test_nothing_is_expired_when_the_browser_holds_none(self, db):
        response = Client().get(LOGIN_URL)

        assert not [name for name in settings.LEGACY_COOKIE_NAMES if name in response.cookies]

    def test_the_studio_cookies_are_not_touched(self, editor):
        client = Client()
        sign_in(client)
        client.cookies["sessionid"] = "stale"

        response = client.get(LANDING_URL)

        assert settings.SESSION_COOKIE_NAME not in response.cookies

    @pytest.mark.parametrize("path", PUBLIC_PATHS)
    def test_the_public_paths_do_not_expire_them(self, db, path):
        client = Client()
        client.cookies["sessionid"] = "stale"

        assert not client.get(path).cookies

    def test_an_earlier_session_is_not_read_under_the_old_name(self, editor):
        client = Client()
        sign_in(client)
        key = client.cookies[settings.SESSION_COOKIE_NAME].value
        assert Session.objects.filter(session_key=key).exists()

        stale = Client()
        stale.cookies["sessionid"] = key

        response = stale.get(LANDING_URL)

        assert response.status_code == 302
        assert response.headers["Location"].startswith(LOGIN_URL)


class TestNoDjangoAdmin:
    def test_the_admin_app_is_not_installed(self):
        assert not apps.is_installed("django.contrib.admin")
        assert not any("admin" in name.split(".") for name in settings.INSTALLED_APPS)

    @pytest.mark.parametrize(
        "path", ["/admin/", "/admin/login/", "/admin/catalog/mountainrecord/", "/admin"]
    )
    def test_no_admin_route_answers(self, db, path):
        assert Client().get(path).status_code == 404

    def test_an_authenticated_editor_finds_no_admin_either(self, editor):
        client = Client()
        sign_in(client)

        assert client.get("/admin/").status_code == 404

    def test_no_url_pattern_is_in_the_admin_namespace(self):
        assert "admin" not in get_resolver().namespace_dict
        with pytest.raises(NoReverseMatch):
            reverse("admin:index")

    def test_the_user_model_carries_no_admin_contract(self):
        from serendipeak.persistence.models import UserRecord

        assert not hasattr(UserRecord, "is_staff")
        assert not hasattr(UserRecord, "has_perm")
