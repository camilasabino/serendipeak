from dataclasses import dataclass

from serendipeak.catalog.entities import Mountain, MountainStatus
from serendipeak.catalog.folding import fold
from serendipeak.catalog.ports import MountainCatalogReader
from serendipeak.catalog.publication import PublicationViolation, publication_violations

SEARCH_MAX_LENGTH = 100


@dataclass(frozen=True, slots=True)
class MountainListEntry:
    mountain: Mountain
    # Only a draft is judged: a public mountain already passed the same gate.
    violations: tuple[PublicationViolation, ...]


@dataclass(frozen=True, slots=True)
class MountainList:
    entries: tuple[MountainListEntry, ...]
    # Counted over the mountains that match the search, so a chip always agrees with the rows
    # it leads to.
    counts: dict[MountainStatus, int]
    total: int


class ListMountains:
    def __init__(self, reader: MountainCatalogReader):
        self._reader = reader

    def execute(self, *, status: MountainStatus | None = None, search: str = "") -> MountainList:
        needle = fold(search[:SEARCH_MAX_LENGTH])
        matching = [mountain for mountain in self._reader.list_all() if _matches(mountain, needle)]

        counts = dict.fromkeys(MountainStatus, 0)
        for mountain in matching:
            counts[mountain.status] += 1

        shown = sorted(
            (mountain for mountain in matching if status in (None, mountain.status)),
            key=lambda mountain: (fold(mountain.name.en), mountain.slug),
        )

        return MountainList(
            entries=tuple(_entry(mountain) for mountain in shown),
            counts=counts,
            total=len(matching),
        )


def _matches(mountain: Mountain, needle: str) -> bool:
    if not needle:
        return True
    names = (mountain.name.en, mountain.name.es, mountain.name.pt)

    return needle in mountain.slug or any(name and needle in fold(name) for name in names)


def _entry(mountain: Mountain) -> MountainListEntry:
    violations = publication_violations(mountain) if mountain.status is MountainStatus.DRAFT else ()

    return MountainListEntry(mountain=mountain, violations=violations)
