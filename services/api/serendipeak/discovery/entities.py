from dataclasses import dataclass
from datetime import date

from serendipeak.catalog.entities import Mountain


@dataclass(frozen=True, slots=True)
class DailyMountain:
    date: date
    mountain: Mountain


@dataclass(frozen=True, slots=True)
class RecentDiscovery:
    date: date
    slug: str
