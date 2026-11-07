from datetime import UTC, datetime, timedelta

import pytest

from serendipeak.accounts.login_throttle import (
    ADDRESS_ATTEMPT_LIMIT,
    LOGIN_ATTEMPT_WINDOW,
    USERNAME_ATTEMPT_LIMIT,
    AdmitLoginAttempt,
    ClearLoginFailures,
    username_key,
)
from tests.support.fakes import InMemoryLoginAttemptLog, ManualClock

START = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


@pytest.fixture
def attempts():
    return InMemoryLoginAttemptLog()


@pytest.fixture
def clock():
    return ManualClock(START)


@pytest.fixture
def admit(attempts, clock):
    return AdmitLoginAttempt(attempts, clock)


def attempt_n_times(admit, count, username="camila", address="203.0.113.7"):
    return [admit.execute(username, address).admitted for _ in range(count)]


def test_the_username_key_ignores_case_and_surrounding_space_and_is_not_the_username():
    assert username_key(" Camila ") == username_key("camila")
    assert username_key("camila") != username_key("camilo")
    assert "camila" not in username_key("camila")
    assert len(username_key("camila")) == 64


def test_attempts_up_to_the_username_limit_are_admitted_and_the_next_is_refused(admit):
    results = attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT + 2)

    assert results == [True] * USERNAME_ATTEMPT_LIMIT + [False] * 2


def test_the_limit_follows_the_username_whatever_the_address(admit):
    for index in range(USERNAME_ATTEMPT_LIMIT):
        assert admit.execute("camila", f"203.0.113.{index}").admitted

    assert not admit.execute("camila", "198.51.100.1").admitted


def test_other_usernames_are_not_affected_by_a_throttled_one(admit):
    attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT + 1)

    assert admit.execute("someone-else", "198.51.100.1").admitted


def test_the_address_limit_applies_across_usernames(admit):
    results = [
        admit.execute(f"user-{index}", "203.0.113.7").admitted
        for index in range(ADDRESS_ATTEMPT_LIMIT + 1)
    ]

    assert results == [True] * ADDRESS_ATTEMPT_LIMIT + [False]


def test_a_throttled_username_is_admitted_again_when_the_window_has_passed(admit, clock):
    attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT + 1)

    clock.advance(LOGIN_ATTEMPT_WINDOW + timedelta(seconds=1))

    assert admit.execute("camila", "203.0.113.7").admitted


def test_refused_attempts_do_not_extend_the_lockout(admit, clock, attempts):
    attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT)
    clock.advance(LOGIN_ATTEMPT_WINDOW - timedelta(minutes=1))

    assert not admit.execute("camila", "203.0.113.7").admitted
    assert attempts.stored() == USERNAME_ATTEMPT_LIMIT
    clock.advance(timedelta(minutes=2))

    assert admit.execute("camila", "203.0.113.7").admitted


def test_clearing_a_username_forgets_its_failures_but_not_the_address_allowance(admit, attempts):
    attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT)

    ClearLoginFailures(attempts).execute("CAMILA")

    assert attempts.stored() == 0
    assert attempt_n_times(admit, USERNAME_ATTEMPT_LIMIT) == [True] * USERNAME_ATTEMPT_LIMIT


def test_clearing_one_username_leaves_the_attempts_of_another(admit, attempts):
    admit.execute("camila", "203.0.113.7")
    admit.execute("other", "203.0.113.7")

    ClearLoginFailures(attempts).execute("camila")

    assert attempts.stored() == 1
