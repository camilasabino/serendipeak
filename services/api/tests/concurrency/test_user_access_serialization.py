import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection, transaction

from serendipeak.accounts.access import Access, AccessViolation, access_violation
from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.errors import AccessRefused
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from serendipeak.persistence.user_admin import NewPasswordForm
from serendipeak.persistence.user_store import DjangoUserStore
from tests.support.concurrency import (
    WAIT_SECONDS,
    a_backend_is_waiting_for_a_row_lock,
    wait_until,
)
from tests.support.users import create_user

pytestmark = pytest.mark.django_db(transaction=True)

VIEWER = Access(Role.VIEWER, True)
INACTIVE_EDITOR = Access(Role.EDITOR, False)


def active_editors():
    return UserRecord.objects.filter(role="editor", is_active=True).count()


def change(actor, target, desired):
    try:
        return ChangeUserAccess(DjangoUserStore()).execute(
            actor.id, target.id, desired.role, desired.is_active
        )
    except AccessRefused as refused:
        return refused.violation
    finally:
        connection.close()


def test_two_editors_demoting_each_other_at_once_leave_exactly_one_editor():
    first = create_user("first-editor")
    second = create_user("second-editor")
    start = threading.Barrier(2)

    def demote(actor, target):
        start.wait()
        return change(actor, target, VIEWER)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = [
            pool.submit(demote, first, second),
            pool.submit(demote, second, first),
        ]
        results = [outcome.result(WAIT_SECONDS) for outcome in outcomes]

    assert active_editors() == 1
    refusals = [result for result in results if isinstance(result, AccessViolation)]
    assert refusals == [AccessViolation.ACTOR_NOT_EDITOR]


def test_many_editors_deactivating_each_other_never_leave_the_system_without_one():
    editors = [create_user(f"editor-{index}") for index in range(6)]
    start = threading.Barrier(len(editors))

    def deactivate_the_next(index):
        start.wait()
        target = editors[(index + 1) % len(editors)]
        return change(editors[index], target, INACTIVE_EDITOR)

    with ThreadPoolExecutor(max_workers=len(editors)) as pool:
        futures = [pool.submit(deactivate_the_next, index) for index in range(len(editors))]
        for future in futures:
            future.result(WAIT_SECONDS)

    assert active_editors() >= 1


def test_a_change_waits_for_an_access_change_in_flight_and_judges_what_it_committed():
    demoting = create_user("demoting-editor")
    waiting = create_user("waiting-editor")
    target = create_user("viewer", Role.VIEWER)
    holds_the_locks = threading.Event()
    commit = threading.Event()

    def demote_and_hold():
        try:
            with transaction.atomic():
                DjangoUserStore().change_access(demoting.id, waiting.id, VIEWER, access_violation)
                holds_the_locks.set()
                assert commit.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def promote_as_the_demoted_editor():
        return change(waiting, target, Access(Role.EDITOR, True))

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(demote_and_hold)
        assert holds_the_locks.wait(WAIT_SECONDS)
        waiter = pool.submit(promote_as_the_demoted_editor)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not waiter.done()
        commit.set()

        holder.result(WAIT_SECONDS)
        result = waiter.result(WAIT_SECONDS)

    assert result is AccessViolation.ACTOR_NOT_EDITOR
    assert UserRecord.objects.get(pk=target.pk).role == "viewer"


def test_a_password_set_while_a_demotion_is_in_flight_keeps_the_demotion():
    demoting = create_user("demoting-editor")
    target = create_user("second-editor")
    stale = UserRecord.objects.get(pk=target.pk)
    form = NewPasswordForm(
        stale,
        {"password1": "another long passphrase 42", "password2": "another long passphrase 42"},
    )
    assert form.is_valid()
    holds_the_locks = threading.Event()
    commit = threading.Event()

    def demote_and_hold():
        try:
            with transaction.atomic():
                DjangoUserStore().change_access(demoting.id, target.id, VIEWER, access_violation)
                holds_the_locks.set()
                assert commit.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def set_the_password():
        try:
            form.save()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(demote_and_hold)
        assert holds_the_locks.wait(WAIT_SECONDS)
        writer = pool.submit(set_the_password)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not writer.done()
        commit.set()

        holder.result(WAIT_SECONDS)
        writer.result(WAIT_SECONDS)

    stored = UserRecord.objects.get(pk=target.pk)
    assert stored.role == "viewer"
    assert stored.check_password("another long passphrase 42")
    assert active_editors() == 1
