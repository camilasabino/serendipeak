import datetime

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.history import ListDailyDiscoveries
from serendipeak.discovery.retention import RETENTION_DAYS
from tests.support.fakes import FixedClock, InMemoryDiscoveryHistoryReader, discovery_entry

TODAY = datetime.date(2026, 11, 8)


def listing(*entries):
    return ListDailyDiscoveries(InMemoryDiscoveryHistoryReader(entries), FixedClock(TODAY))


def days_ago(count):
    return TODAY - datetime.timedelta(days=count)


def test_the_newest_day_comes_first():
    history = listing(
        discovery_entry(days_ago(2)), discovery_entry(TODAY), discovery_entry(days_ago(1))
    ).execute()

    assert [entry.date for entry in history.entries] == [TODAY, days_ago(1), days_ago(2)]


def test_the_window_is_the_retention_policy_with_today_included():
    kept_edge = discovery_entry(days_ago(RETENTION_DAYS))
    expired = discovery_entry(days_ago(RETENTION_DAYS + 1))

    history = listing(expired, kept_edge, discovery_entry(TODAY)).execute()

    assert history.kept_since == days_ago(RETENTION_DAYS)
    assert [entry.date for entry in history.entries] == [TODAY, kept_edge.date]


def test_a_full_window_is_366_days():
    entries = [discovery_entry(days_ago(count)) for count in range(RETENTION_DAYS + 1)]

    assert len(listing(*entries).execute().entries) == 366


def test_an_expired_discovery_the_cleanup_has_not_removed_yet_is_not_shown():
    history = listing(discovery_entry(days_ago(RETENTION_DAYS + 40))).execute()

    assert history.entries == ()


def test_a_mountain_that_is_no_longer_public_is_still_listed_with_its_status_now():
    history = listing(
        discovery_entry(days_ago(3), "retired-peak", MountainStatus.INACTIVE)
    ).execute()

    (entry,) = history.entries
    assert (entry.mountain_slug, entry.mountain_status) == ("retired-peak", MountainStatus.INACTIVE)


def test_it_reports_today_for_the_page_to_mark():
    assert listing().execute().today == TODAY
