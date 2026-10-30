from serendipeak.catalog.ports import MountainRepository
from serendipeak.discovery.clock import Clock
from serendipeak.discovery.entities import DailyMountain
from serendipeak.discovery.errors import NoEligibleMountains
from serendipeak.discovery.ports import DailyDiscoveryRepository
from serendipeak.discovery.selection import recent_window, select_daily_slug


class GetTodaysMountain:
    def __init__(
        self,
        mountains: MountainRepository,
        discoveries: DailyDiscoveryRepository,
        clock: Clock,
    ):
        self._mountains = mountains
        self._discoveries = discoveries
        self._clock = clock

    def execute(self) -> DailyMountain:
        day = self._clock.today()

        persisted = self._discoveries.find_by_date(day)
        if persisted is not None:
            return persisted

        candidates = self._mountains.list_active_candidates()
        if not candidates:
            raise NoEligibleMountains()

        first, last = recent_window(day)
        recent = self._discoveries.list_recent(first, last)
        slug = select_daily_slug(day, (candidate.slug for candidate in candidates), recent)
        ids_by_slug = {candidate.slug: candidate.id for candidate in candidates}

        # The winner of a concurrent first request may differ from this proposal; the
        # persisted discovery is the answer.
        return self._discoveries.insert_or_get(day, ids_by_slug[slug])
