import datetime
import importlib

from serendipeak.discovery.retention import RETENTION_DAYS, retention_cutoff
from serendipeak.discovery.selection import RECENT_WINDOW_DAYS


def test_the_cutoff_is_365_days_before_today():
    assert retention_cutoff(datetime.date(2026, 11, 7)) == datetime.date(2025, 11, 7)


def test_the_cutoff_crosses_a_leap_day_by_counting_days_not_years():
    assert retention_cutoff(datetime.date(2028, 12, 31)) == datetime.date(2028, 1, 1)
    assert retention_cutoff(datetime.date(2029, 2, 28)) == datetime.date(2028, 2, 29)


def test_the_recent_selection_window_lies_inside_the_retention_window():
    assert RECENT_WINDOW_DAYS < RETENTION_DAYS


def test_the_migration_mirrors_the_retention_constant():
    migration = importlib.import_module(
        "serendipeak.persistence.migrations.0021_daily_discovery_retention"
    )

    assert migration.RETENTION_DAYS == RETENTION_DAYS
    assert f"- {RETENTION_DAYS}" in migration.AMEND_FUNCTION
