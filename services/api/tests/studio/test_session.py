import pytest
from django.contrib.sessions.models import Session
from django.test import Client
from django.utils import timezone

from tests.studio.support import LOGIN_URL, PASSWORD, sign_in
from tests.support.users import create_user

TWELVE_HOURS = 12 * 60 * 60


@pytest.fixture
def signed_in(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()
    response = sign_in(client)

    return client, response


def test_the_session_lasts_twelve_hours_from_sign_in(signed_in):
    client, response = signed_in
    cookie = response.cookies["sessionid"]
    session = Session.objects.get(session_key=cookie.value)

    assert cookie["max-age"] == TWELVE_HOURS
    remaining = (session.expire_date - timezone.now()).total_seconds()
    assert TWELVE_HOURS - 60 < remaining <= TWELVE_HOURS


def test_an_expired_session_no_longer_signs_the_user_in(signed_in):
    client, response = signed_in
    Session.objects.filter(session_key=response.cookies["sessionid"].value).update(
        expire_date=timezone.now()
    )

    result = client.get("/studio/")

    assert result.status_code == 302
    assert result.headers["Location"].startswith(LOGIN_URL)


def test_the_session_cookie_is_http_only_same_site_and_secure_outside_development(signed_in):
    from django.conf import settings

    _, response = signed_in
    cookie = response.cookies["sessionid"]

    assert cookie["httponly"] is True
    assert cookie["samesite"] == "Lax"
    assert bool(cookie["secure"]) is settings.SESSION_COOKIE_SECURE


def test_the_session_is_stored_on_the_server_and_the_cookie_holds_only_its_key(signed_in):
    _, response = signed_in
    value = response.cookies["sessionid"].value

    assert Session.objects.filter(session_key=value).exists()
    assert "camila" not in value


@pytest.mark.parametrize(
    "path", ["/healthz", "/api/v1/mountains/today", "/api/v1/mountains/random"]
)
def test_the_public_endpoints_never_set_cookies_for_a_signed_in_browser(signed_in, path):
    client, _ = signed_in

    response = client.get(path)

    assert not response.cookies
    assert "Set-Cookie" not in response.headers
