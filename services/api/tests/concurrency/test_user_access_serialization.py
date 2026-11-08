import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection, transaction

from serendipeak.accounts.access import Access, AccessViolation, access_violation
from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.errors import AccessRefused
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
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
INACTIVE_VIEWER = Access(Role.VIEWER, False)


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


NEW_PASSWORD = "another long passphrase 42"


def set_password(actor, target):
    try:
        return DjangoUserStore().set_password(actor.id, target.id, NEW_PASSWORD)
    finally:
        connection.close()


def hold_a_change_then(commit, holds_the_locks, actor, target, desired):
    try:
        with transaction.atomic():
            DjangoUserStore().change_access(actor.id, target.id, desired, access_violation)
            holds_the_locks.set()
            assert commit.wait(WAIT_SECONDS)
    finally:
        connection.close()


def test_a_password_set_by_an_editor_demoted_in_the_meantime_is_refused():
    demoting = create_user("demoting-editor")
    demoted = create_user("demoted-editor")
    target = create_user("viewer", Role.VIEWER)
    before = UserRecord.objects.get(pk=target.pk).password
    holds_the_locks = threading.Event()
    commit = threading.Event()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_a_change_then, commit, holds_the_locks, demoting, demoted, VIEWER)
        assert holds_the_locks.wait(WAIT_SECONDS)
        writer = pool.submit(set_password, demoted, target)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not writer.done()
        commit.set()

        holder.result(WAIT_SECONDS)
        change = writer.result(WAIT_SECONDS)

    assert change.violation is AccessViolation.ACTOR_NOT_EDITOR
    assert UserRecord.objects.get(pk=target.pk).password == before


def test_a_password_set_while_the_target_is_being_deactivated_keeps_both_changes():
    actor = create_user("actor")
    target = create_user("target", Role.VIEWER)
    holds_the_locks = threading.Event()
    commit = threading.Event()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(
            hold_a_change_then, commit, holds_the_locks, actor, target, INACTIVE_VIEWER
        )
        assert holds_the_locks.wait(WAIT_SECONDS)
        writer = pool.submit(set_password, actor, target)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not writer.done()
        commit.set()

        holder.result(WAIT_SECONDS)
        writer.result(WAIT_SECONDS)

    stored = UserRecord.objects.get(pk=target.pk)
    assert stored.is_active is False
    assert stored.check_password(NEW_PASSWORD)


def test_editors_setting_each_others_passwords_while_demoting_never_deadlock():
    first = create_user("first-editor")
    second = create_user("second-editor")
    start = threading.Barrier(2)

    def demote_the_other(actor, target):
        start.wait()
        return change(actor, target, VIEWER)

    def set_the_others_password(actor, target):
        start.wait()
        return set_password(actor, target)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(demote_the_other, first, second),
            pool.submit(set_the_others_password, second, first),
        ]
        for future in futures:
            future.result(WAIT_SECONDS)

    assert active_editors() >= 1
