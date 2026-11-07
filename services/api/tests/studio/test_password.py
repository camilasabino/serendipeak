import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext

from serendipeak.accounts.access import Access, access_violation
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from serendipeak.persistence.user_store import DjangoUserStore
from serendipeak.studio.forms import StudioPasswordChangeForm
from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    NEW_PASSWORD,
    PASSWORD,
    PASSWORD_URL,
    sign_in,
    text_of,
)
from tests.support.users import create_user


def change(client, old=PASSWORD, new=NEW_PASSWORD, confirm=None):
    return client.post(
        PASSWORD_URL,
        {
            "old_password": old,
            "new_password1": new,
            "new_password2": new if confirm is None else confirm,
        },
    )


@pytest.fixture
def client_of_user(db):
    user = create_user("camila-sabino", Role.VIEWER, password=PASSWORD)
    client = Client()
    sign_in(client)

    return client, user


@pytest.mark.parametrize("role", list(Role))
def test_any_user_changes_their_own_password_and_stays_signed_in(db, role):
    user = create_user("camila-sabino", role, password=PASSWORD)
    client = Client()
    sign_in(client)

    response = change(client, new=NEW_PASSWORD)

    assert response.status_code == 302
    assert response.headers["Location"] == LANDING_URL
    assert "Your password was changed." in text_of(client.get(LANDING_URL))
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)
    assert not user.check_password(PASSWORD)
    assert sign_in(Client(), password=NEW_PASSWORD).status_code == 302
    assert sign_in(Client(), password=PASSWORD).status_code == 200


def test_changing_the_password_ends_every_other_session_of_the_user(client_of_user):
    client, _ = client_of_user
    other = Client()
    sign_in(other)
    assert other.get(LANDING_URL).status_code == 200

    change(client)

    assert other.get(LANDING_URL).status_code == 302
    assert client.get(LANDING_URL).status_code == 200


def test_the_current_password_must_be_right(client_of_user):
    client, user = client_of_user

    response = change(client, old="not the password")

    assert response.status_code == 200
    assert "password was entered incorrectly" in text_of(response)
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_the_two_new_passwords_must_match(client_of_user):
    client, user = client_of_user

    response = change(client, confirm="something else entirely 7")

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


@pytest.mark.parametrize(
    ("new", "reason"),
    [
        ("short1!", "too short"),
        ("password123", "too common"),
        ("1234567890123", "entirely numeric"),
        ("camila-sabino", "too similar"),
    ],
)
def test_the_password_policy_refuses_weak_passwords(client_of_user, new, reason):
    client, user = client_of_user

    response = change(client, new=new)

    assert response.status_code == 200
    assert reason in text_of(response)
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_eight_characters_are_enough_and_the_policy_is_stated_in_one_line(client_of_user):
    client, user = client_of_user

    page = text_of(client.get(PASSWORD_URL))
    response = change(client, new="tz4k9wqe")

    assert "At least 8 characters. Common passwords are refused." in page
    assert response.status_code == 302
    user.refresh_from_db()
    assert user.check_password("tz4k9wqe")


def test_an_anonymous_visitor_cannot_change_a_password(db):
    user = create_user("camila-sabino", password=PASSWORD)

    response = change(Client())

    assert response.status_code == 302
    assert response.headers["Location"].startswith(LOGIN_URL)
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_the_page_never_echoes_a_password_back(client_of_user):
    client, _ = client_of_user

    response = change(client, old="not the password", new="short")

    assert "not the password" not in text_of(response)
    assert 'value="short"' not in text_of(response)


def test_only_the_password_column_is_written(client_of_user):
    client, _ = client_of_user

    with CaptureQueriesContext(connection) as queries:
        response = change(client)

    assert response.status_code == 302
    statements = [
        query["sql"]
        for query in queries.captured_queries
        if query["sql"].startswith('UPDATE "app_user"') and '"password"' in query["sql"]
    ]
    assert len(statements) == 1
    assert statements[0].startswith('UPDATE "app_user" SET "password" = ')
    assert '"role"' not in statements[0]
    assert '"is_active"' not in statements[0]


def test_a_role_or_active_change_made_meanwhile_is_not_overwritten(db):
    actor = create_user("first-editor")
    target = create_user("second-editor", password=PASSWORD)
    stale = UserRecord.objects.get(pk=target.pk)
    form = StudioPasswordChangeForm(
        stale,
        {
            "old_password": PASSWORD,
            "new_password1": NEW_PASSWORD,
            "new_password2": NEW_PASSWORD,
        },
    )
    assert form.is_valid()
    DjangoUserStore().change_access(
        actor.id, target.id, Access(Role.VIEWER, False), access_violation
    )

    form.save()

    stored = UserRecord.objects.get(pk=target.pk)
    assert (stored.role, stored.is_active) == ("viewer", False)
    assert stored.check_password(NEW_PASSWORD)
