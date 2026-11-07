from datetime import UTC, datetime, timedelta

import pytest

from serendipeak.persistence.login_attempt_log import DjangoLoginAttemptLog
from tests.support.fakes import InMemoryLoginAttemptLog

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
WINDOW = timedelta(minutes=15)
KEY = "a" * 64
OTHER_KEY = "b" * 64
ADDRESS = "203.0.113.7"
OTHER_ADDRESS = "198.51.100.1"


@pytest.fixture(params=["in-memory", pytest.param("django", marks=pytest.mark.django_db)])
def log(request):
    return InMemoryLoginAttemptLog() if request.param == "in-memory" else DjangoLoginAttemptLog()


def record(log, *, key=KEY, address=ADDRESS, at=NOW):
    return log.record(username_key=key, address=address, at=at, window_start=at - WINDOW)


def test_counts_include_the_attempt_just_stored(log):
    first = record(log)
    second = record(log)

    assert (first.by_username, first.by_address) == (1, 1)
    assert (second.by_username, second.by_address) == (2, 2)
    assert first.attempt_id != second.attempt_id


def test_username_and_address_are_counted_independently(log):
    record(log, key=KEY, address=ADDRESS)
    record(log, key=OTHER_KEY, address=ADDRESS)
    counted = record(log, key=KEY, address=OTHER_ADDRESS)

    assert (counted.by_username, counted.by_address) == (2, 1)


def test_attempts_older_than_the_window_are_not_counted(log):
    record(log, at=NOW - WINDOW - timedelta(seconds=1))
    record(log, at=NOW - timedelta(minutes=1))

    counted = record(log)

    assert (counted.by_username, counted.by_address) == (2, 2)


def test_an_attempt_exactly_at_the_window_start_is_counted(log):
    record(log, at=NOW - WINDOW)

    counted = record(log)

    assert counted.by_username == 2


def test_a_discarded_attempt_is_no_longer_counted(log):
    stored = record(log)
    log.discard(stored.attempt_id)

    counted = record(log)

    assert (counted.by_username, counted.by_address) == (1, 1)


def test_discarding_an_unknown_attempt_is_harmless(log):
    log.discard(987654321)

    assert record(log).by_username == 1


def test_forgetting_a_username_leaves_the_other_usernames(log):
    record(log, key=KEY)
    record(log, key=OTHER_KEY)

    log.forget_username(KEY)

    counted = record(log, key=OTHER_KEY)
    assert counted.by_username == 2
    assert record(log, key=KEY).by_username == 1
