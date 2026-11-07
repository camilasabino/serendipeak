import re

import pytest
from django.conf import settings
from django.test import Client

from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    NEW_PASSWORD,
    PASSWORD,
    PASSWORD_URL,
    sign_in,
)
from tests.support.users import create_user

STUDIO_RESPONSES = {
    "sign-in page": lambda: Client().get(LOGIN_URL),
    "redirect to sign in": lambda: Client().get(LANDING_URL),
    "unknown page": lambda: Client().get("/studio/no-such-page/"),
    "refused sign in": lambda: sign_in(Client(), "nobody", "wrong password!"),
    "csrf failure": lambda: Client(enforce_csrf_checks=True).post(LOGIN_URL, {}),
}


def media_origin():
    scheme, _, rest = settings.MEDIA_PUBLIC_BASE_URL.partition("://")

    return f"{scheme}://{rest.partition('/')[0]}"


@pytest.mark.parametrize("label", sorted(STUDIO_RESPONSES))
def test_every_studio_response_forbids_framing_and_sniffing(db, label):
    response = STUDIO_RESPONSES[label]()

    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"


@pytest.mark.parametrize("label", sorted(STUDIO_RESPONSES))
def test_studio_responses_are_never_cached(db, label):
    cache_control = STUDIO_RESPONSES[label]().headers["Cache-Control"]

    assert "no-store" in cache_control
    assert "private" in cache_control


@pytest.mark.parametrize("label", sorted(STUDIO_RESPONSES))
def test_studio_responses_carry_a_content_security_policy_without_framing(db, label):
    policy = STUDIO_RESPONSES[label]().headers["Content-Security-Policy"]
    directives = dict(part.strip().partition(" ")[::2] for part in policy.split(";"))

    assert directives["default-src"] == "'none'"
    assert directives["frame-ancestors"] == "'none'"
    assert directives["base-uri"] == "'none'"
    assert directives["form-action"] == "'self'"
    assert directives["style-src"] == "'self'"
    assert directives["script-src"] == "'self'"
    assert directives["font-src"] == "'self'"
    assert directives["img-src"] == f"'self' {media_origin()}"
    assert "unsafe" not in policy


def test_a_signed_in_page_carries_the_headers_too(editor_client):
    for path in (LANDING_URL, PASSWORD_URL):
        response = editor_client.get(path)

        assert response.status_code == 200
        assert response.headers["X-Frame-Options"] == "DENY"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_pages_render_without_inline_styles_or_scripts_so_the_policy_holds(editor_client):
    pages = [
        Client().get(LOGIN_URL),
        editor_client.get(LANDING_URL),
        editor_client.get(PASSWORD_URL),
    ]
    pages.append(sign_in(Client(), "nobody", "wrong password!"))

    for page in pages:
        body = page.content.decode()

        assert "<style" not in body
        assert "<script" not in body
        assert not re.search(r"\sstyle=", body)
        assert not re.search(r"\son[a-z]+=", body)
        assert "javascript:" not in body


def test_the_headers_apply_to_the_studio_only(db):
    for path in ("/healthz", "/api/v1/mountains/today", "/api/v1/mountains/random"):
        response = Client().get(path)

        for header in (
            "X-Frame-Options",
            "Content-Security-Policy",
            "Referrer-Policy",
            "X-Robots-Tag",
        ):
            assert header not in response.headers, (path, header)


def test_a_sign_in_that_follows_a_refusal_still_sets_the_headers(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    sign_in(client, password="wrong password!")
    response = sign_in(client)

    assert response.status_code == 302
    assert response.headers["X-Frame-Options"] == "DENY"


def test_the_password_change_redirect_carries_the_headers(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()
    sign_in(client)

    response = client.post(
        PASSWORD_URL,
        {"old_password": PASSWORD, "new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )

    assert response.status_code == 302
    assert response.headers["X-Frame-Options"] == "DENY"
