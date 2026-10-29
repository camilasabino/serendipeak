from dataclasses import dataclass

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import CatalogStore
from serendipeak.catalog.publication import PublicationViolation, publication_violations


@dataclass(frozen=True, slots=True)
class CatalogViolation:
    slug: str
    violation: PublicationViolation


@dataclass(frozen=True, slots=True)
class CatalogCheckReport:
    checked: int
    violations: tuple[CatalogViolation, ...]


class CheckCatalog:
    def __init__(self, store: CatalogStore):
        self._store = store

    def execute(self) -> CatalogCheckReport:
        active = sorted(
            (
                entry.mountain
                for entry in self._store.snapshot().mountains
                if entry.mountain.status is MountainStatus.ACTIVE
            ),
            key=lambda mountain: mountain.slug,
        )
        return CatalogCheckReport(
            checked=len(active),
            violations=tuple(
                CatalogViolation(slug=mountain.slug, violation=violation)
                for mountain in active
                for violation in publication_violations(mountain)
            ),
        )
