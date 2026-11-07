import datetime

from serendipeak.catalog.bootstrap.ports import CatalogDiscovery
from serendipeak.discovery.entities import PruneResult
from serendipeak.discovery.prune_daily_discoveries import PruneDailyDiscoveries
from tests.support.catalog import CREATED_AT, mountain
from tests.support.fakes import FixedClock, InMemoryDailyDiscoveryRepository

TODAY = datetime.date(2026, 11, 7)
CUTOFF = datetime.date(2025, 11, 7)
ACONCAGUA = mountain("aconcagua")


def days_from_cutoff(count):
    return CUTOFF + datetime.timedelta(days=count)


def repository_holding(*days):
    return InMemoryDailyDiscoveryRepository(
        [ACONCAGUA],
        [
            CatalogDiscovery(date=day, mountain_id=ACONCAGUA.id, created_at=CREATED_AT)
            for day in days
        ],
    )


def prune(repository, today=TODAY):
    return PruneDailyDiscoveries(repository, FixedClock(today)).execute()


def test_deletes_only_the_dates_before_the_cutoff():
    repository = repository_holding(days_from_cutoff(-2), days_from_cutoff(-1), CUTOFF, TODAY)

    result = prune(repository)

    assert result == PruneResult(cutoff=CUTOFF, deleted=2)
    assert repository.find_by_date(days_from_cutoff(-1)) is None
    assert repository.find_by_date(CUTOFF) is not None
    assert repository.find_by_date(TODAY) is not None


def test_the_cutoff_date_itself_is_kept():
    repository = repository_holding(CUTOFF)

    assert prune(repository).deleted == 0
    assert repository.find_by_date(CUTOFF) is not None


def test_the_day_before_the_cutoff_is_deleted():
    repository = repository_holding(days_from_cutoff(-1))

    assert prune(repository).deleted == 1


def test_running_again_deletes_nothing():
    repository = repository_holding(days_from_cutoff(-5), TODAY)

    assert prune(repository).deleted == 1
    assert prune(repository) == PruneResult(cutoff=CUTOFF, deleted=0)
    assert repository.find_by_date(TODAY) is not None


def test_the_cutoff_follows_the_clock():
    repository = repository_holding(CUTOFF)

    result = prune(repository, today=TODAY + datetime.timedelta(days=1))

    assert result == PruneResult(cutoff=days_from_cutoff(1), deleted=1)


def test_an_empty_history_is_a_no_op():
    assert prune(repository_holding()).deleted == 0
