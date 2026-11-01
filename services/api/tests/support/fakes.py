from dataclasses import dataclass, replace
from datetime import date

from serendipeak.catalog.bootstrap.ports import CatalogSeed, CatalogSnapshot
from serendipeak.catalog.entities import PUBLIC_STATUSES, CandidateMountain, MountainStatus
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.catalog.ports import StatusChange, StatusChangeOutcome
from serendipeak.discovery.entities import DailyMountain, RecentDiscovery
from serendipeak.errors import InfrastructureError


class InMemoryCatalogStore:
    def __init__(self):
        self._mountains = {}
        self._discoveries = {}

    def load(self, seed: CatalogSeed):
        if self._mountains:
            raise CatalogAlreadyPopulated()

        self._mountains.update((entry.mountain.id, entry) for entry in seed.mountains)
        self._discoveries.update((discovery.date, discovery) for discovery in seed.discoveries)

    def snapshot(self):
        return CatalogSnapshot(
            mountains=tuple(
                sorted(self._mountains.values(), key=lambda entry: entry.mountain.slug)
            ),
            discoveries=tuple(sorted(self._discoveries.values(), key=lambda item: item.date)),
        )


class InMemoryMountainRepository:
    def __init__(self, mountains=()):
        self._mountains = {mountain.slug: mountain for mountain in mountains}

    def find_public_by_slug(self, slug):
        mountain = self._mountains.get(slug)
        if mountain is None or mountain.status not in PUBLIC_STATUSES:
            return None

        return mountain

    def list_active_candidates(self):
        return tuple(
            CandidateMountain(id=mountain.id, slug=mountain.slug)
            for slug, mountain in sorted(self._mountains.items())
            if mountain.status is MountainStatus.ACTIVE
        )


class InMemoryMountainStatusStore:
    def __init__(self, mountains=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}

    def change_status(self, mountain_id, transition, gate):
        mountain = self._mountains.get(mountain_id)
        if mountain is None:
            return StatusChange(StatusChangeOutcome.NOT_FOUND, None)
        if mountain.status is not transition.source:
            return StatusChange(StatusChangeOutcome.WRONG_STATUS, mountain.status)

        violations = tuple(gate(mountain))
        if violations:
            return StatusChange(StatusChangeOutcome.REJECTED, mountain.status, violations)

        self._mountains[mountain_id] = replace(mountain, status=transition.target)

        return StatusChange(StatusChangeOutcome.APPLIED, transition.target)

    def replace(self, mountain):
        self._mountains[mountain.id] = mountain

    def status_of(self, mountain_id):
        return self._mountains[mountain_id].status


class InMemoryDailyDiscoveryRepository:
    def __init__(self, mountains=(), discoveries=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self._mountain_ids = {discovery.date: discovery.mountain_id for discovery in discoveries}

    def find_by_date(self, day):
        mountain_id = self._mountain_ids.get(day)
        if mountain_id is None:
            return None

        return DailyMountain(date=day, mountain=self._mountains[mountain_id])

    def list_recent(self, first, last):
        return tuple(
            RecentDiscovery(date=day, slug=self._mountains[mountain_id].slug)
            for day, mountain_id in sorted(self._mountain_ids.items())
            if first <= day <= last
        )

    def insert_or_get(self, day, mountain_id):
        if day not in self._mountain_ids:
            if mountain_id not in self._mountains:
                raise InfrastructureError(f"no mountain has the id {mountain_id}")
            self._mountain_ids[day] = mountain_id

        return self.find_by_date(day)


@dataclass
class FixedClock:
    day: date

    def today(self):
        return self.day


class RecordingPickIndex:
    def __init__(self, *indexes):
        self._indexes = list(indexes)
        self.counts = []

    def __call__(self, count):
        self.counts.append(count)

        return self._indexes.pop(0)
