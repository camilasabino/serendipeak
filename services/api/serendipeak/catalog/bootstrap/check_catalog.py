from dataclasses import dataclass

from serendipeak.catalog.bootstrap.ports import CatalogStore
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH


@dataclass(frozen=True, slots=True)
class CatalogViolation:
    slug: str
    violation: PublicationViolation


@dataclass(frozen=True, slots=True)
class CatalogCheckReport:
    """The violations of the publication invariants, and, apart from them, the slugs of the
    active mountains whose summary exceeds the length limit: a summary saved under a former limit
    stays valid until an editor shortens it, so it is a review list and never a violation."""

    checked: int
    violations: tuple[CatalogViolation, ...]
    summaries_over_limit: tuple[str, ...] = ()


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
            summaries_over_limit=tuple(
                mountain.slug
                for mountain in active
                if mountain.summary is not None and len(mountain.summary.en) > SUMMARY_MAX_LENGTH
            ),
        )
