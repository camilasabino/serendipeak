from datetime import UTC, datetime, timedelta

import pytest
from django.db import IntegrityError, transaction

from serendipeak.errors import InfrastructureError
from serendipeak.persistence.login_attempt_log import DjangoLoginAttemptLog
from serendipeak.persistence.models import LoginAttemptRecord

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
KEY = "a" * 64


@pytest.fixture
def log(db):
    return DjangoLoginAttemptLog()


def record(log):
    return log.record(
        username_key=KEY,
        address="203.0.113.7",
        at=NOW,
        window_start=NOW - timedelta(minutes=15),
    )


def test_recording_an_attempt_is_one_delete_one_insert_and_one_count(
    log, django_assert_num_queries
):
    with django_assert_num_queries(3) as captured:
        record(log)

    statements = [query["sql"] for query in captured.captured_queries]
    assert statements[0].startswith('DELETE FROM "login_attempt"')
    assert statements[1].startswith('INSERT INTO "login_attempt"')
    assert statements[2].startswith("SELECT COUNT(")
    assert "COUNT(*) FILTER" in statements[2] or "FILTER (WHERE" in statements[2]


def test_discarding_and_forgetting_are_one_query_each(log, django_assert_num_queries):
    stored = record(log)

    with django_assert_num_queries(1):
        log.discard(stored.attempt_id)
    with django_assert_num_queries(1):
        log.forget_username(KEY)


def test_the_username_is_stored_only_as_a_digest(db):
    with pytest.raises(IntegrityError), transaction.atomic():
        LoginAttemptRecord.objects.create(
            username_key="correct horse battery staple",
            address="203.0.113.7",
            attempted_at=NOW,
        )


def test_a_database_failure_is_translated(log, monkeypatch):
    def fail(*args, **kwargs):
        raise IntegrityError("boom")

    monkeypatch.setattr(LoginAttemptRecord.objects, "create", fail)

    with pytest.raises(InfrastructureError):
        record(log)
