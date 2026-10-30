import datetime

import pytest

from serendipeak.catalog.bootstrap.ports import CatalogDiscovery
from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.entities import DailyMountain
from serendipeak.discovery.errors import NoEligibleMountains
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.discovery.selection import select_daily_slug
from tests.support.catalog import CREATED_AT, mountain
from tests.support.fakes import (
    FixedClock,
    InMemoryDailyDiscoveryRepository,
    InMemoryMountainRepository,
)

TODAY = datetime.date(2026, 10, 20)
ACONCAGUA = mountain("aconcagua")
DENALI = mountain("denali")
MOUNT_FUJI = mountain("mount-fuji")
RETIRED = mountain("retired-peak", status=MountainStatus.INACTIVE)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)


def days_ago(count):
    return TODAY - datetime.timedelta(days=count)


def discovery(day, entity):
    return CatalogDiscovery(date=day, mountain_id=entity.id, created_at=CREATED_AT)


def get_todays_mountain(mountains, discoveries):
    return GetTodaysMountain(
        InMemoryMountainRepository(mountains),
        discoveries,
        FixedClock(TODAY),
    )


def history(mountains, *discoveries):
    return InMemoryDailyDiscoveryRepository(mountains, discoveries)


def test_a_persisted_discovery_is_returned_as_is():
    mountains = [ACONCAGUA, DENALI, MOUNT_FUJI]
    discoveries = history(mountains, discovery(TODAY, DENALI))

    daily = get_todays_mountain(mountains, discoveries).execute()

    assert daily == DailyMountain(date=TODAY, mountain=DENALI)


def test_a_persisted_discovery_is_served_after_its_mountain_was_deactivated():
    mountains = [ACONCAGUA, RETIRED]
    discoveries = history(mountains, discovery(TODAY, RETIRED))

    assert get_todays_mountain(mountains, discoveries).execute().mountain == RETIRED


def test_a_new_date_persists_the_selected_active_mountain():
    mountains = [ACONCAGUA, DENALI, MOUNT_FUJI, RETIRED, DRAFT]
    discoveries = history(mountains)
    expected = select_daily_slug(TODAY, ["aconcagua", "denali", "mount-fuji"], [])

    daily = get_todays_mountain(mountains, discoveries).execute()

    assert daily.date == TODAY
    assert daily.mountain.slug == expected
    assert discoveries.find_by_date(TODAY) == daily


def test_a_new_date_skips_the_mountains_of_the_previous_thirty_dates():
    mountains = [ACONCAGUA, DENALI, MOUNT_FUJI]
    discoveries = history(
        mountains,
        discovery(days_ago(1), ACONCAGUA),
        discovery(days_ago(30), MOUNT_FUJI),
    )

    assert get_todays_mountain(mountains, discoveries).execute().mountain == DENALI


def test_history_older_than_the_window_does_not_exclude():
    mountains = [ACONCAGUA, DENALI]
    discoveries = history(mountains, discovery(days_ago(31), ACONCAGUA))
    expected = select_daily_slug(TODAY, ["aconcagua", "denali"], [])

    assert get_todays_mountain(mountains, discoveries).execute().mountain.slug == expected


def test_every_active_mountain_is_eligible_again_when_all_are_recent():
    mountains = [ACONCAGUA, DENALI, MOUNT_FUJI]
    discoveries = history(
        mountains,
        discovery(days_ago(1), ACONCAGUA),
        discovery(days_ago(2), DENALI),
        discovery(days_ago(3), MOUNT_FUJI),
    )
    expected = select_daily_slug(TODAY, ["aconcagua", "denali", "mount-fuji"], [])

    assert get_todays_mountain(mountains, discoveries).execute().mountain.slug == expected


def test_no_active_mountain_raises_and_writes_nothing():
    mountains = [RETIRED, DRAFT]
    discoveries = history(mountains, discovery(days_ago(1), RETIRED))

    with pytest.raises(NoEligibleMountains):
        get_todays_mountain(mountains, discoveries).execute()

    assert discoveries.find_by_date(TODAY) is None


class ConcurrentWinner:
    """Persists another mountain for the date between the miss and the insert."""

    def __init__(self, discoveries: InMemoryDailyDiscoveryRepository, winner):
        self._discoveries = discoveries
        self._winner = winner

    def find_by_date(self, day):
        return self._discoveries.find_by_date(day)

    def list_recent(self, first, last):
        return self._discoveries.list_recent(first, last)

    def insert_or_get(self, day, mountain_id):
        self._discoveries.insert_or_get(day, self._winner.id)
        return self._discoveries.insert_or_get(day, mountain_id)


def test_the_persisted_winner_is_returned_when_it_differs_from_the_proposal():
    mountains = [ACONCAGUA, DENALI, MOUNT_FUJI]
    proposal = select_daily_slug(TODAY, ["aconcagua", "denali", "mount-fuji"], [])
    winner = next(entity for entity in mountains if entity.slug != proposal)
    discoveries = history(mountains)

    daily = get_todays_mountain(mountains, ConcurrentWinner(discoveries, winner)).execute()

    assert daily == DailyMountain(date=TODAY, mountain=winner)
    assert discoveries.find_by_date(TODAY) == daily


def test_the_date_is_read_once_from_the_clock():
    class AdvancingClock:
        def __init__(self):
            self.reads = 0

        def today(self):
            self.reads += 1
            return TODAY + datetime.timedelta(days=self.reads - 1)

    mountains = [ACONCAGUA, DENALI]
    discoveries = history(mountains)
    clock = AdvancingClock()

    daily = GetTodaysMountain(InMemoryMountainRepository(mountains), discoveries, clock).execute()

    assert clock.reads == 1
    assert daily.date == TODAY
