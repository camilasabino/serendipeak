import time

from django.db import connection

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
