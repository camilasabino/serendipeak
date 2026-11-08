import re

import pytest
from django.conf import settings
from django.test import Client
from django.urls import get_resolver

from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    LOGOUT_URL,
    NEW_PASSWORD,
    PASSWORD,
    PASSWORD_URL,
    csrf_token_of,
    text_of,
)
from tests.support.users import create_user


def enforcing():
    return Client(enforce_csrf_checks=True)


def signed_in_with_enforcement(user):
    client = Client(enforce_csrf_checks=True)
    client.force_login(user)

    return client


def test_the_sign_in_form_carries_a_token_and_sets_the_cookie(db):
    response = enforcing().get(LOGIN_URL)

    assert re.search(r'name="csrfmiddlewaretoken" value="[^"]{32,}"', text_of(response))
    cookie = response.cookies[settings.CSRF_COOKIE_NAME]
    assert cookie["httponly"] is True
    assert cookie["samesite"] == "Lax"
    assert bool(cookie["secure"]) is settings.CSRF_COOKIE_SECURE


def test_signing_in_without_a_token_is_refused_inside_the_studio_and_creates_no_session(db):
    create_user("camila-sabino", password=PASSWORD)
    client = enforcing()

    response = client.post(LOGIN_URL, {"username": "camila-sabino", "password": PASSWORD})

    assert response.status_code == 403
    assert "This page expired" in text_of(response)
    assert settings.SESSION_COOKIE_NAME not in response.cookies
    assert client.get(LANDING_URL).status_code == 302


def test_signing_in_with_a_token_works(db):
    create_user("camila-sabino", password=PASSWORD)
    client = enforcing()
    token = csrf_token_of(client.get(LOGIN_URL))

    response = client.post(
        LOGIN_URL,
        {"username": "camila-sabino", "password": PASSWORD, "csrfmiddlewaretoken": token},
    )

    assert response.status_code == 302


def test_a_post_from_another_origin_is_refused_even_with_a_valid_token(db):
    create_user("camila-sabino", password=PASSWORD)
    client = enforcing()
    token = csrf_token_of(client.get(LOGIN_URL))

    response = client.post(
        LOGIN_URL,
        {"username": "camila-sabino", "password": PASSWORD, "csrfmiddlewaretoken": token},
        headers={"origin": "https://evil.example"},
    )

    assert response.status_code == 403


def test_signing_out_without_a_token_is_refused_and_keeps_the_session(editor):
    client = signed_in_with_enforcement(editor)

    response = client.post(LOGOUT_URL)

    assert response.status_code == 403
    assert client.get(LANDING_URL).status_code == 200


def test_signing_out_with_a_token_works(editor):
    client = signed_in_with_enforcement(editor)
    token = csrf_token_of(client.get(LANDING_URL))

    response = client.post(LOGOUT_URL, {"csrfmiddlewaretoken": token})

    assert response.status_code == 302


def test_changing_the_password_without_a_token_changes_nothing(db):
    user = create_user("camila-sabino", password=PASSWORD)
    client = signed_in_with_enforcement(user)

    response = client.post(
        PASSWORD_URL,
        {"old_password": PASSWORD, "new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )

    assert response.status_code == 403
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_changing_the_password_with_a_token_works(db):
    user = create_user("camila-sabino", password=PASSWORD)
    client = signed_in_with_enforcement(user)
    token = csrf_token_of(client.get(PASSWORD_URL))

    response = client.post(
        PASSWORD_URL,
        {
            "old_password": PASSWORD,
            "new_password1": NEW_PASSWORD,
            "new_password2": NEW_PASSWORD,
            "csrfmiddlewaretoken": token,
        },
    )

    assert response.status_code == 302
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)


def callbacks_under(patterns, namespace=None):
    for pattern in patterns:
        if hasattr(pattern, "url_patterns"):
            yield from callbacks_under(pattern.url_patterns, pattern.namespace or namespace)
        elif namespace == "studio":
            yield pattern.callback


def test_no_studio_view_is_exempt_from_csrf_protection():
    callbacks = list(callbacks_under(get_resolver().url_patterns))

    assert callbacks
    assert not [callback for callback in callbacks if getattr(callback, "csrf_exempt", False)]


@pytest.mark.parametrize("path", ["/studio/login/", "/studio/password/"])
def test_the_csrf_failure_page_does_not_leak_the_reason(db, path):
    response = enforcing().post(path, {})

    assert response.status_code == 403
    assert "CSRF" not in text_of(response)


def test_a_csrf_failure_outside_the_studio_keeps_the_framework_page(db):
    response = enforcing().post("/healthz", {})

    assert response.status_code == 403
    assert "CSRF verification failed" in text_of(response)
    assert "This page expired" not in text_of(response)
