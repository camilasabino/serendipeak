import pytest
from django.contrib.sessions.models import Session
from django.test import Client

from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    LOGOUT_URL,
    NEUTRAL_FAILURE,
    PASSWORD,
    sign_in,
    text_of,
)
from tests.support.users import create_user


@pytest.mark.parametrize("role", list(Role))
def test_a_user_signs_in_with_a_username_and_password_and_lands_on_the_overview(db, role):
    user = create_user("camila-sabino", role, password=PASSWORD)
    client = Client()

    response = sign_in(client)

    assert response.status_code == 302
    assert response.headers["Location"] == LANDING_URL
    assert client.get(LANDING_URL).status_code == 200
    user.refresh_from_db()
    assert user.last_login is not None


@pytest.mark.parametrize("typed", ["CAMILA-SABINO", "Camila-Sabino", " camila-sabino"])
def test_the_username_is_matched_without_regard_to_case(db, typed):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    response = sign_in(client, typed)

    assert response.status_code == 302
    assert client.get(LANDING_URL).status_code == 200


def test_signing_in_replaces_the_session_key_so_a_planted_one_is_useless(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()
    client.get(LOGIN_URL)
    planted = Session.objects.create(
        session_key="plantedsessionkey0000000000000000",
        session_data=Session.objects.encode({}),
        expire_date="2099-01-01T00:00:00Z",
    )
    client.cookies["sessionid"] = planted.session_key

    sign_in(client)

    assert client.cookies["sessionid"].value != planted.session_key
    assert not Session.objects.filter(session_key=planted.session_key).exists()


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("camila-sabino", "wrong password!"),
        ("nobody", PASSWORD),
        ("camila-sabino", ""),
        ("", PASSWORD),
    ],
    ids=["wrong password", "unknown user", "empty password", "empty username"],
)
def test_a_bad_credential_does_not_sign_in(db, username, password):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    response = sign_in(client, username, password)

    assert response.status_code == 200
    assert client.get(LANDING_URL).status_code == 302
    assert UserRecord.objects.get(username="camila-sabino").last_login is None


def test_the_refusal_does_not_reveal_whether_the_account_exists_or_is_active(db):
    create_user("camila-sabino", password=PASSWORD)
    create_user("retired", is_active=False, password=PASSWORD)

    bodies = {
        label: text_of(sign_in(Client(), username, password))
        for label, username, password in [
            ("wrong password", "camila-sabino", "wrong password!"),
            ("unknown user", "nobody", "wrong password!"),
            ("inactive user", "retired", PASSWORD),
        ]
    }

    for body in bodies.values():
        assert NEUTRAL_FAILURE in body
    assert len({body.count(NEUTRAL_FAILURE) for body in bodies.values()}) == 1


@pytest.mark.parametrize("role", list(Role))
def test_an_inactive_user_cannot_sign_in_even_with_the_right_password(db, role):
    create_user("camila-sabino", role, is_active=False, password=PASSWORD)
    client = Client()

    response = sign_in(client)

    assert response.status_code == 200
    assert NEUTRAL_FAILURE in text_of(response)
    assert client.get(LANDING_URL).status_code == 302


def test_a_user_without_a_usable_password_cannot_sign_in(db):
    create_user("camila-sabino")

    assert sign_in(Client(), password="").status_code == 200


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("/studio/password/", "/studio/password/"),
        ("https://evil.example/phish", LANDING_URL),
        ("//evil.example/phish", LANDING_URL),
        ("javascript:alert(1)", LANDING_URL),
    ],
)
def test_sign_in_only_returns_to_a_local_page(db, target, expected):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    response = client.post(
        LOGIN_URL, {"username": "camila-sabino", "password": PASSWORD, "next": target}
    )

    assert response.status_code == 302
    assert response.headers["Location"] == expected


def test_a_signed_in_user_visiting_the_sign_in_page_is_sent_to_the_overview(editor_client):
    response = editor_client.get(LOGIN_URL)

    assert response.status_code == 302
    assert response.headers["Location"] == LANDING_URL


def test_the_sign_in_page_is_public_and_asks_for_a_username_and_a_password(db):
    response = Client().get(LOGIN_URL)
    body = text_of(response)

    assert response.status_code == 200
    assert 'name="username"' in body
    assert 'name="password"' in body
    assert 'type="password"' in body
    assert 'autocomplete="current-password"' in body


def test_an_anonymous_visitor_is_sent_to_sign_in_and_brought_back(db):
    client = Client()

    response = client.get("/studio/password/")

    assert response.status_code == 302
    assert response.headers["Location"] == f"{LOGIN_URL}?next=/studio/password/"


def test_signing_out_ends_the_session_and_returns_to_sign_in_with_a_message(editor_client):
    key = editor_client.cookies["sessionid"].value

    response = editor_client.post(LOGOUT_URL, follow=True)

    assert response.redirect_chain == [(LOGIN_URL, 302)]
    assert "You are signed out." in text_of(response)
    assert not Session.objects.filter(session_key=key).exists()
    assert editor_client.get(LANDING_URL).status_code == 302


def test_signing_out_needs_a_post(editor_client):
    assert editor_client.get(LOGOUT_URL).status_code == 405
    assert editor_client.get(LANDING_URL).status_code == 200


def test_an_anonymous_logout_goes_to_sign_in_without_a_return_address(db):
    response = Client().post(LOGOUT_URL)

    assert response.status_code == 302
    assert response.headers["Location"] == LOGIN_URL


def test_a_user_deactivated_while_signed_in_loses_access_on_the_next_request(editor_client, editor):
    assert editor_client.get(LANDING_URL).status_code == 200

    UserRecord.objects.filter(pk=editor.pk).update(is_active=False)

    response = editor_client.get(LANDING_URL)
    assert response.status_code == 302
    assert response.headers["Location"].startswith(LOGIN_URL)


def test_a_role_change_takes_effect_on_the_next_request(editor_client, editor):
    UserRecord.objects.filter(pk=editor.pk).update(role=Role.VIEWER.value)

    assert "As a Viewer" in text_of(editor_client.get(LANDING_URL))
