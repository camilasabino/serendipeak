import datetime

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.discovery_history_reader import DjangoDiscoveryHistoryReader
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_seed
from tests.support.fakes import InMemoryDiscoveryHistoryReader, discovery_entry

ACONCAGUA = catalog_mountain("aconcagua")
RETIRED = catalog_mountain("retired-peak", status=MountainStatus.INACTIVE)
DAY = datetime.date(2026, 10, 20)


def days_ago(count):
    return DAY - datetime.timedelta(days=count)


@pytest.fixture(params=["in-memory", pytest.param("django", marks=pytest.mark.django_db)])
def reader_holding(request):
    if request.param == "in-memory":
        by_slug = {"aconcagua": ACONCAGUA, "retired-peak": RETIRED}

        return lambda *discoveries: InMemoryDiscoveryHistoryReader(
            discovery_entry(day, entry.mountain.slug, entry.mountain.status)
            for day, entry in ((d.date, _entry_of(d, by_slug)) for d in discoveries)
        )

    def arrange(*discoveries):
        DjangoCatalogStore().load(catalog_seed(ACONCAGUA, RETIRED, discoveries=discoveries))

        return DjangoDiscoveryHistoryReader()

    return arrange


def _entry_of(discovery, by_slug):
    return next(e for e in by_slug.values() if e.mountain.id == discovery.mountain_id)


def test_it_lists_the_discoveries_between_two_dates_inclusive(reader_holding):
    reader = reader_holding(
        catalog_discovery(days_ago(3), ACONCAGUA),
        catalog_discovery(days_ago(2), RETIRED),
        catalog_discovery(days_ago(1), ACONCAGUA),
        catalog_discovery(DAY, ACONCAGUA),
    )

    entries = reader.list_between(days_ago(2), days_ago(1))

    assert sorted(entry.date for entry in entries) == [days_ago(2), days_ago(1)]


def test_each_entry_carries_the_mountain_as_it_is_now(reader_holding):
    reader = reader_holding(catalog_discovery(DAY, RETIRED))

    (entry,) = reader.list_between(DAY, DAY)

    assert entry.mountain_slug == "retired-peak"
    assert entry.mountain_status is MountainStatus.INACTIVE


def test_nothing_between_the_dates_gives_an_empty_listing(reader_holding):
    reader = reader_holding(catalog_discovery(days_ago(10), ACONCAGUA))

    assert tuple(reader.list_between(days_ago(3), DAY)) == ()
