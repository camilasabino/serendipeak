import datetime
import uuid

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.entities import DailyMountain, RecentDiscovery
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_seed
from tests.support.fakes import InMemoryDailyDiscoveryRepository

ACONCAGUA = catalog_mountain("aconcagua")
DENALI = catalog_mountain("denali", primary_image=None)
RETIRED = catalog_mountain("retired-peak", status=MountainStatus.INACTIVE)
CATALOG = (ACONCAGUA, DENALI, RETIRED)
DAY = datetime.date(2026, 10, 20)


def days_ago(count):
    return DAY - datetime.timedelta(days=count)


HISTORY = (
    catalog_discovery(days_ago(31), DENALI),
    catalog_discovery(days_ago(30), ACONCAGUA),
    catalog_discovery(days_ago(2), RETIRED),
    catalog_discovery(days_ago(1), DENALI),
    catalog_discovery(DAY, ACONCAGUA),
)


# The Django variant runs outside a test transaction: insert_or_get commits on its own, and
# the deferred foreign key is only checked at that commit.
@pytest.fixture(
    params=["in-memory", pytest.param("django", marks=pytest.mark.django_db(transaction=True))]
)
def repository_holding(request):
    if request.param == "in-memory":
        return lambda *discoveries: InMemoryDailyDiscoveryRepository(
            (entry.mountain for entry in CATALOG), discoveries
        )

    def arrange(*discoveries):
        DjangoCatalogStore().load(catalog_seed(*CATALOG, discoveries=discoveries))
        return DjangoDailyDiscoveryRepository()

    return arrange


def test_finds_the_discovery_of_a_date_with_its_mountain_and_image(repository_holding):
    repository = repository_holding(*HISTORY)

    assert repository.find_by_date(DAY) == DailyMountain(date=DAY, mountain=ACONCAGUA.mountain)
    assert repository.find_by_date(days_ago(1)).mountain == DENALI.mountain


def test_finds_a_discovery_whose_mountain_is_no_longer_active(repository_holding):
    daily = repository_holding(*HISTORY).find_by_date(days_ago(2))

    assert daily == DailyMountain(date=days_ago(2), mountain=RETIRED.mountain)


@pytest.mark.parametrize("day", [days_ago(3), DAY + datetime.timedelta(days=1)])
def test_a_date_without_a_discovery_finds_nothing(repository_holding, day):
    assert repository_holding(*HISTORY).find_by_date(day) is None


def test_lists_recent_discoveries_inclusively_ordered_by_date(repository_holding):
    recent = repository_holding(*reversed(HISTORY)).list_recent(days_ago(30), days_ago(1))

    assert recent == (
        RecentDiscovery(date=days_ago(30), slug="aconcagua"),
        RecentDiscovery(date=days_ago(2), slug="retired-peak"),
        RecentDiscovery(date=days_ago(1), slug="denali"),
    )


def test_lists_a_single_date_and_an_empty_range(repository_holding):
    repository = repository_holding(*HISTORY)

    assert repository.list_recent(DAY, DAY) == (RecentDiscovery(date=DAY, slug="aconcagua"),)
    assert repository.list_recent(days_ago(29), days_ago(3)) == ()
    assert repository.list_recent(DAY, days_ago(1)) == ()


def test_inserts_the_discovery_of_a_new_date(repository_holding):
    repository = repository_holding(*HISTORY)
    new_day = DAY + datetime.timedelta(days=1)

    daily = repository.insert_or_get(new_day, DENALI.mountain.id)

    assert daily == DailyMountain(date=new_day, mountain=DENALI.mountain)
    assert repository.find_by_date(new_day) == daily


def test_the_first_writer_wins_and_is_returned_to_later_callers(repository_holding):
    repository = repository_holding()

    first = repository.insert_or_get(DAY, ACONCAGUA.mountain.id)
    second = repository.insert_or_get(DAY, DENALI.mountain.id)

    assert first == second == DailyMountain(date=DAY, mountain=ACONCAGUA.mountain)
    assert repository.find_by_date(DAY) == first


def test_an_existing_discovery_is_returned_even_for_an_unknown_mountain(repository_holding):
    repository = repository_holding(*HISTORY)

    daily = repository.insert_or_get(DAY, uuid.uuid4())

    assert daily == DailyMountain(date=DAY, mountain=ACONCAGUA.mountain)


def test_an_unknown_mountain_is_an_infrastructure_error_that_persists_nothing(
    repository_holding,
):
    repository = repository_holding(*HISTORY)
    new_day = DAY + datetime.timedelta(days=1)

    with pytest.raises(InfrastructureError):
        repository.insert_or_get(new_day, uuid.uuid4())

    assert repository.find_by_date(new_day) is None


REAL_TODAY = datetime.datetime.now(datetime.UTC).date()
CUTOFF = REAL_TODAY - datetime.timedelta(days=365)


def kept_on(offset):
    return CUTOFF + datetime.timedelta(days=offset)


def test_deletes_the_discoveries_before_the_cutoff_and_keeps_the_rest(repository_holding):
    repository = repository_holding(
        catalog_discovery(kept_on(-2), ACONCAGUA),
        catalog_discovery(kept_on(-1), RETIRED),
        catalog_discovery(CUTOFF, DENALI),
        catalog_discovery(REAL_TODAY, ACONCAGUA),
    )

    deleted = repository.delete_before(CUTOFF)

    assert deleted == 2
    assert repository.find_by_date(kept_on(-2)) is None
    assert repository.find_by_date(kept_on(-1)) is None
    assert repository.find_by_date(CUTOFF).mountain == DENALI.mountain
    assert repository.find_by_date(REAL_TODAY).mountain == ACONCAGUA.mountain


def test_deleting_before_the_cutoff_twice_deletes_nothing_the_second_time(repository_holding):
    repository = repository_holding(catalog_discovery(kept_on(-1), DENALI))

    assert repository.delete_before(CUTOFF) == 1
    assert repository.delete_before(CUTOFF) == 0


def test_deleting_with_nothing_expired_deletes_nothing(repository_holding):
    repository = repository_holding(*HISTORY)

    assert repository.delete_before(CUTOFF) == 0
    assert repository.find_by_date(DAY) is not None
