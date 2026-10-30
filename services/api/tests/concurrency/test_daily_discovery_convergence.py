import datetime
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import DailyDiscoveryRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.fakes import FixedClock

pytestmark = pytest.mark.django_db(transaction=True)

CALLERS = 16
DAY = datetime.date(2026, 10, 20)
MOUNTAINS = tuple(catalog_mountain(f"peak-{index:02d}") for index in range(CALLERS))


def run_together(call):
    start = threading.Barrier(CALLERS)

    def caller(index):
        try:
            start.wait()
            return call(index)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=CALLERS) as pool:
        return list(pool.map(caller, range(CALLERS)))


@pytest.fixture
def catalog():
    DjangoCatalogStore().load(catalog_seed(*MOUNTAINS))


@pytest.mark.parametrize("attempt", range(3))
def test_concurrent_first_requests_of_a_date_persist_one_discovery(catalog, attempt):
    day = DAY + datetime.timedelta(days=attempt)
    get_todays_mountain = GetTodaysMountain(
        DjangoMountainRepository(),
        DjangoDailyDiscoveryRepository(),
        FixedClock(day),
    )

    results = run_together(lambda index: get_todays_mountain.execute())

    assert len(set(results)) == 1
    assert results[0].date == day
    stored = DailyDiscoveryRecord.objects.filter(date=day)
    assert [record.mountain_id for record in stored] == [results[0].mountain.id]


@pytest.mark.parametrize("attempt", range(3))
def test_concurrent_inserts_of_different_mountains_converge_on_one_winner(catalog, attempt):
    day = DAY + datetime.timedelta(days=attempt)
    repository = DjangoDailyDiscoveryRepository()

    results = run_together(
        lambda index: repository.insert_or_get(day, MOUNTAINS[index].mountain.id)
    )

    assert len(set(results)) == 1
    winner = results[0].mountain
    assert winner in {entry.mountain for entry in MOUNTAINS}
    stored = DailyDiscoveryRecord.objects.filter(date=day)
    assert [record.mountain_id for record in stored] == [winner.id]
