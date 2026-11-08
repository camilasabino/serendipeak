import datetime

import pytest

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.discovery_history_reader import DjangoDiscoveryHistoryReader
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_of

pytestmark = pytest.mark.django_db

DAY = datetime.date(2026, 11, 8)
MOUNTAINS = tuple(catalog_mountain(slug) for slug in ("aconcagua", "denali", "kosciuszko"))


def load(count):
    discoveries = tuple(
        catalog_discovery(DAY - datetime.timedelta(days=offset), MOUNTAINS[offset % len(MOUNTAINS)])
        for offset in range(count)
    )
    DjangoCatalogStore().load(catalog_of(*MOUNTAINS, discoveries=discoveries))


@pytest.mark.parametrize("count", [0, 1, 366])
def test_a_full_window_is_read_in_one_query(count, django_assert_num_queries):
    load(count)

    with django_assert_num_queries(1):
        entries = DjangoDiscoveryHistoryReader().list_between(
            DAY - datetime.timedelta(days=365), DAY
        )

    assert len(entries) == count


def test_the_query_reads_only_the_columns_the_list_shows(django_assert_num_queries):
    load(1)

    with django_assert_num_queries(1) as captured:
        DjangoDiscoveryHistoryReader().list_between(DAY, DAY)

    sql = captured.captured_queries[0]["sql"]
    assert '"daily_discovery"."date"' in sql
    assert '"mountain"."summary_en"' not in sql
    assert "JOIN" in sql


def test_the_entry_has_the_recorded_instant_and_the_english_name():
    load(1)

    (entry,) = DjangoDiscoveryHistoryReader().list_between(DAY, DAY)

    assert entry.mountain_name == MOUNTAINS[0].mountain.name.en
    assert entry.recorded_at.tzinfo is not None
    assert entry.recorded_at.date() == DAY
