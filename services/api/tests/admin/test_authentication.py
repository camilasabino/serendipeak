import pytest
from django.contrib.auth.hashers import identify_hasher
from django.contrib.sessions.models import Session
from django.test import Client
from django.urls import reverse

from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from tests.support.users import create_user

LOGIN_URL = reverse("admin:login")
INDEX_URL = reverse("admin:index")
PASSWORD_CHANGE_URL = reverse("admin:password_change")
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "another long passphrase 42"


def sign_in(client, username="camila-sabino", password=PASSWORD):
    return client.post(LOGIN_URL, {"username": username, "password": password, "next": INDEX_URL})


@pytest.mark.parametrize("role", list(Role))
def test_a_user_signs_in_with_their_username_and_password(db, role):
    user = create_user("camila-sabino", role, password=PASSWORD)

    client = Client()
    response = sign_in(client)

    assert response.status_code == 302
    assert response.headers["Location"] == INDEX_URL
    assert client.get(INDEX_URL).status_code == 200
    user.refresh_from_db()
    assert user.last_login is not None


@pytest.mark.parametrize(
    ("username", "password"),
    [
        ("camila-sabino", "wrong password!"),
        ("nobody", PASSWORD),
        ("camila-sabino", ""),
    ],
    ids=["wrong password", "unknown user", "empty password"],
)
def test_a_bad_credential_does_not_sign_in(db, username, password):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    response = sign_in(client, username, password)

    assert response.status_code == 200
    assert client.get(INDEX_URL).status_code == 302
    assert UserRecord.objects.get(username="camila-sabino").last_login is None


@pytest.mark.parametrize("typed", ["CAMILA-SABINO", "Camila-Sabino"])
def test_the_username_is_matched_without_regard_to_case(db, typed):
    user = create_user("camila-sabino", password=PASSWORD)
    client = Client()

    response = sign_in(client, typed)

    assert response.status_code == 302
    assert client.get(INDEX_URL).status_code == 200
    user.refresh_from_db()
    assert user.username == "camila-sabino"
    assert user.last_login is not None


def test_a_wrong_password_is_refused_whatever_the_case_of_the_username(db):
    create_user("camila-sabino", password=PASSWORD)

    assert sign_in(Client(), "CAMILA-SABINO", "wrong password!").status_code == 200


@pytest.mark.parametrize("role", list(Role))
def test_an_inactive_user_cannot_sign_in_even_with_the_right_password(db, role):
    create_user("camila-sabino", role, is_active=False, password=PASSWORD)
    client = Client()

    response = sign_in(client)

    assert response.status_code == 200
    assert client.get(INDEX_URL).status_code == 302


def test_a_user_without_a_usable_password_cannot_sign_in(db):
    create_user("camila-sabino")

    assert sign_in(Client(), "camila-sabino", "").status_code == 200


def test_signing_in_needs_the_csrf_token(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client(enforce_csrf_checks=True)

    response = client.post(LOGIN_URL, {"username": "camila-sabino", "password": PASSWORD})

    assert response.status_code == 403
    assert client.get(INDEX_URL).status_code == 302


def test_signing_out_ends_the_session_and_needs_post(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()
    sign_in(client)

    assert client.get(reverse("admin:logout")).status_code == 405
    assert client.get(INDEX_URL).status_code == 200

    client.post(reverse("admin:logout"))

    assert client.get(INDEX_URL).status_code == 302


def test_the_session_cookie_is_http_only_and_same_site(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()

    sign_in(client)

    cookie = client.cookies["sessionid"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"


def test_a_session_stores_the_user_id_and_never_the_password(db):
    user = create_user("camila-sabino", password=PASSWORD)
    client = Client()
    sign_in(client)

    data = Session.objects.get().get_decoded()

    assert data["_auth_user_id"] == str(user.pk)
    assert PASSWORD not in str(data)
    assert user.password not in str(data)


class TestOwnPasswordChange:
    @pytest.fixture
    def signed_in(self, db):
        user = create_user("camila-sabino", password=PASSWORD)
        client = Client()
        sign_in(client)

        return client, user

    def change(self, client, new=NEW_PASSWORD, old=PASSWORD):
        return client.post(
            PASSWORD_CHANGE_URL,
            {"old_password": old, "new_password1": new, "new_password2": new},
        )

    def test_it_changes_the_password_and_keeps_the_session(self, signed_in):
        client, user = signed_in

        response = self.change(client)

        assert response.status_code == 302
        user.refresh_from_db()
        assert user.check_password(NEW_PASSWORD)
        assert not user.check_password(PASSWORD)
        assert identify_hasher(user.password).algorithm == "pbkdf2_sha256"
        assert client.get(INDEX_URL).status_code == 200

    def test_it_ends_the_other_sessions_of_the_user(self, signed_in):
        client, _ = signed_in
        other = Client()
        sign_in(other)

        self.change(client)

        assert other.get(INDEX_URL).status_code == 302
        assert client.get(INDEX_URL).status_code == 200

    def test_it_needs_the_current_password(self, signed_in):
        client, user = signed_in

        response = self.change(client, old="not the password")

        assert response.status_code == 200
        user.refresh_from_db()
        assert user.check_password(PASSWORD)

    @pytest.mark.parametrize(
        ("new", "reason"),
        [
            ("short-1", "at least 8 characters"),
            ("password1234", "too common"),
            ("987654321098765", "entirely numeric"),
            ("camila-sabino-1", "too similar"),
        ],
    )
    def test_the_policy_applies(self, signed_in, new, reason):
        client, user = signed_in

        response = self.change(client, new=new)

        assert response.status_code == 200
        assert reason in response.content.decode()
        user.refresh_from_db()
        assert user.check_password(PASSWORD)

    def test_it_never_alters_the_role_or_the_active_state(self, signed_in):
        client, user = signed_in

        self.change(client)

        user.refresh_from_db()
        assert (user.role, user.is_active) == ("editor", True)
