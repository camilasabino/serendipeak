from dataclasses import dataclass
from datetime import date, datetime

from serendipeak.catalog.entities import Mountain, MountainStatus


@dataclass(frozen=True, slots=True)
class DailyMountain:
    date: date
    mountain: Mountain


@dataclass(frozen=True, slots=True)
class RecentDiscovery:
    date: date
    slug: str


@dataclass(frozen=True, slots=True)
class PruneResult:
    cutoff: date
    deleted: int


@dataclass(frozen=True, slots=True)
class DiscoveryHistoryEntry:
    date: date
    mountain_slug: str
    mountain_name: str
    # The mountain's status now, which can differ from the one it had on its day.
    mountain_status: MountainStatus
    recorded_at: datetime


@dataclass(frozen=True, slots=True)
class DiscoveryHistory:
    today: date
    kept_since: date
    entries: tuple[DiscoveryHistoryEntry, ...]
