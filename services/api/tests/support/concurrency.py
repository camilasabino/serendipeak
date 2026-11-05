import threading
import time
from concurrent.futures import ThreadPoolExecutor

from django.db import connection, transaction

WAIT_SECONDS = 10


def wait_until(condition):
    deadline = time.monotonic() + WAIT_SECONDS
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def a_backend_is_waiting_for_a_row_lock():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_stat_activity "
            "WHERE datname = current_database() AND wait_event_type = 'Lock'"
        )
        return cursor.fetchone()[0] == 1


def run_while_a_change_holds_the_lock(change, request):
    """Run request in a thread that blocks behind change, which has not yet committed.

    change runs inside an outer transaction and must lock the mountain row, so the lock stays
    held until the test lets that transaction commit.
    """
    changed_but_uncommitted = threading.Event()
    commit_the_change = threading.Event()

    def hold():
        try:
            with transaction.atomic():
                change()
                changed_but_uncommitted.set()
                assert commit_the_change.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def send_request():
        try:
            return request()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold)
        assert changed_but_uncommitted.wait(WAIT_SECONDS)
        stale_request = pool.submit(send_request)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not stale_request.done()
        commit_the_change.set()

        holder.result(WAIT_SECONDS)

        return stale_request.result(WAIT_SECONDS)
