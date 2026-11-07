import json
import logging

import pytest
from django.test import Client

from config.logging import JsonLineFormatter
from serendipeak.accounts.login_throttle import USERNAME_ATTEMPT_LIMIT
from tests.studio.support import (
    LOGIN_URL,
    LOGOUT_URL,
    NEW_PASSWORD,
    PASSWORD,
    PASSWORD_URL,
    sign_in,
)
from tests.support.users import create_user

LOGGER = "serendipeak.security"
TYPED_USERNAME = "Camila-Sabino"
WRONG_PASSWORD = "wrong password that must never be logged"


@pytest.fixture
def events(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    def read():
        return [
            (record.getMessage(), record.levelname, getattr(record, "fields", {}))
            for record in caplog.records
            if record.name == LOGGER
        ]

    return read


def everything_logged(events):
    return json.dumps(events(), default=str).lower()


@pytest.fixture
def account(db):
    return create_user("camila-sabino", password=PASSWORD)


def test_a_successful_sign_in_logs_the_user_and_role_and_address(account, events):
    sign_in(Client())

    [(event, level, fields)] = events()
    assert (event, level) == ("login_succeeded", "INFO")
    assert fields == {"user_id": str(account.pk), "role": "editor", "address": "127.0.0.1"}


def test_a_failed_sign_in_logs_a_digest_of_the_username_and_no_secret(account, events):
    sign_in(Client(), TYPED_USERNAME, WRONG_PASSWORD)

    [(event, level, fields)] = events()
    assert (event, level) == ("login_failed", "WARNING")
    assert set(fields) == {"username_key", "address"}
    assert len(fields["username_key"]) == 64
    logged = everything_logged(events)
    assert WRONG_PASSWORD.lower() not in logged
    assert TYPED_USERNAME.lower() not in logged
    assert PASSWORD not in logged


def test_a_throttled_attempt_is_logged_separately(account, events):
    client = Client()
    for _ in range(USERNAME_ATTEMPT_LIMIT):
        sign_in(client, "camila-sabino", WRONG_PASSWORD)

    sign_in(client, "camila-sabino", PASSWORD)

    names = [name for name, _, _ in events()]
    assert names == ["login_failed"] * USERNAME_ATTEMPT_LIMIT + ["login_throttled"]
    assert PASSWORD not in everything_logged(events)


def test_signing_out_and_changing_the_password_are_logged_without_passwords(account, events):
    client = Client()
    sign_in(client)
    client.post(
        PASSWORD_URL,
        {"old_password": PASSWORD, "new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
    )
    client.post(LOGOUT_URL)

    assert [name for name, _, _ in events()] == ["login_succeeded", "password_changed", "logout"]
    logged = everything_logged(events)
    assert NEW_PASSWORD not in logged
    assert PASSWORD not in logged


def test_a_refused_password_change_is_logged(account, events):
    client = Client()
    sign_in(client)

    client.post(
        PASSWORD_URL,
        {"old_password": WRONG_PASSWORD, "new_password1": NEW_PASSWORD, "new_password2": "x"},
    )

    assert events()[-1][:2] == ("password_change_refused", "WARNING")
    assert WRONG_PASSWORD.lower() not in everything_logged(events)


def test_a_csrf_failure_is_logged_with_the_path_only(db, events):
    Client(enforce_csrf_checks=True).post(LOGIN_URL, {"username": "a", "password": WRONG_PASSWORD})

    [(event, level, fields)] = events()
    assert (event, level) == ("csrf_failed", "WARNING")
    assert fields == {"path": LOGIN_URL}


def test_a_json_line_carries_the_event_and_its_fields(account, events, caplog):
    sign_in(Client(), "camila-sabino", WRONG_PASSWORD)
    record = next(record for record in caplog.records if record.name == LOGGER)

    entry = json.loads(JsonLineFormatter().format(record))

    assert entry["message"] == "login_failed"
    assert entry["logger"] == LOGGER
    assert entry["fields"]["address"] == "127.0.0.1"
    assert WRONG_PASSWORD not in json.dumps(entry)
