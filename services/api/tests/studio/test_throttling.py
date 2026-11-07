from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone

from serendipeak.accounts.login_throttle import (
    ADDRESS_ATTEMPT_LIMIT,
    LOGIN_ATTEMPT_WINDOW,
    USERNAME_ATTEMPT_LIMIT,
)
from serendipeak.persistence.models import LoginAttemptRecord
from tests.studio.support import LANDING_URL, NEUTRAL_FAILURE, PASSWORD, THROTTLED, sign_in, text_of
from tests.support.users import create_user


@pytest.fixture
def account(db):
    return create_user("camila-sabino", password=PASSWORD)


def fail(client, count, username="camila-sabino", **extra):
    return [sign_in(client, username, "wrong password!", **extra) for _ in range(count)]


def test_failures_up_to_the_limit_get_the_ordinary_refusal(account):
    responses = fail(Client(), USERNAME_ATTEMPT_LIMIT)

    assert [response.status_code for response in responses] == [200] * USERNAME_ATTEMPT_LIMIT
    assert all(NEUTRAL_FAILURE in text_of(response) for response in responses)


def test_the_attempt_after_the_limit_is_throttled_even_with_the_right_password(account):
    client = Client()
    fail(client, USERNAME_ATTEMPT_LIMIT)

    response = sign_in(client)

    assert response.status_code == 429
    assert THROTTLED in text_of(response)
    assert client.get(LANDING_URL).status_code == 302
    account.refresh_from_db()
    assert account.last_login is None


def test_throttling_follows_the_username_whatever_the_address(account):
    fail(Client(), USERNAME_ATTEMPT_LIMIT, REMOTE_ADDR="203.0.113.1")

    response = sign_in(Client(), REMOTE_ADDR="198.51.100.9")

    assert response.status_code == 429


def test_an_unknown_username_is_throttled_the_same_way_as_a_real_one(account):
    real = Client()
    unknown = Client()
    fail(real, USERNAME_ATTEMPT_LIMIT)
    fail(unknown, USERNAME_ATTEMPT_LIMIT, username="nobody")

    real_response = sign_in(real, "camila-sabino", "wrong password!")
    unknown_response = sign_in(unknown, "nobody", "wrong password!")

    assert real_response.status_code == unknown_response.status_code == 429
    assert THROTTLED in text_of(real_response)
    assert THROTTLED in text_of(unknown_response)


def test_the_case_of_the_username_does_not_buy_more_attempts(account):
    client = Client()
    for typed in [
        "camila-sabino",
        "CAMILA-SABINO",
        "Camila-Sabino",
        "camila-sabino",
        " Camila-Sabino ",
    ]:
        sign_in(client, typed, "wrong password!")

    assert sign_in(client, "Camila-Sabino").status_code == 429


def test_another_username_is_not_affected(account):
    create_user("someone-else", password=PASSWORD)
    fail(Client(), USERNAME_ATTEMPT_LIMIT + 1)

    assert sign_in(Client(), "someone-else").status_code == 302


def test_a_successful_sign_in_forgets_the_failures_of_that_username(account):
    client = Client()
    fail(client, USERNAME_ATTEMPT_LIMIT - 1)

    assert sign_in(client).status_code == 302
    client.post("/studio/logout/")
    fail(client, USERNAME_ATTEMPT_LIMIT)

    assert sign_in(client, password="wrong password!").status_code == 429


def test_the_address_is_throttled_across_usernames(db):
    client = Client()
    results = [
        sign_in(client, f"guess-{index}", "wrong password!").status_code
        for index in range(ADDRESS_ATTEMPT_LIMIT + 1)
    ]

    assert results == [200] * ADDRESS_ATTEMPT_LIMIT + [429]


def test_a_throttled_address_cannot_sign_in_to_any_account(account):
    client = Client()
    for index in range(ADDRESS_ATTEMPT_LIMIT):
        sign_in(client, f"guess-{index}", "wrong password!")

    assert sign_in(client).status_code == 429


def test_a_client_chosen_forwarded_address_does_not_evade_the_limit(db):
    client = Client()
    results = [
        sign_in(
            client,
            f"guess-{index}",
            "wrong password!",
            headers={"x-forwarded-for": f"192.0.2.{index}"},
        ).status_code
        for index in range(ADDRESS_ATTEMPT_LIMIT + 1)
    ]

    assert results[-1] == 429


def test_the_lockout_ends_when_the_window_has_passed(account):
    client = Client()
    fail(client, USERNAME_ATTEMPT_LIMIT)
    assert sign_in(client).status_code == 429

    LoginAttemptRecord.objects.update(
        attempted_at=timezone.now() - LOGIN_ATTEMPT_WINDOW - timedelta(seconds=1)
    )

    assert sign_in(client).status_code == 302


def test_retrying_while_locked_out_does_not_extend_the_lockout(account):
    client = Client()
    fail(client, USERNAME_ATTEMPT_LIMIT)
    for _ in range(3):
        assert sign_in(client).status_code == 429

    assert LoginAttemptRecord.objects.count() == USERNAME_ATTEMPT_LIMIT


def test_the_log_keeps_a_digest_of_the_username_and_never_a_password(account):
    sign_in(Client(), "camila-sabino", "a password typed into the username field")
    sign_in(Client(), "a password typed into the username field", "x" * 10)

    rows = list(LoginAttemptRecord.objects.values_list("username_key", "address"))

    assert len(rows) == 2
    for key, _ in rows:
        assert len(key) == 64
        assert "password" not in key
        assert "camila" not in key


def test_an_attempt_without_a_password_cannot_guess_and_is_not_counted(account):
    for _ in range(USERNAME_ATTEMPT_LIMIT + 3):
        sign_in(Client(), "camila-sabino", "")

    assert LoginAttemptRecord.objects.count() == 0
    assert sign_in(Client()).status_code == 302
