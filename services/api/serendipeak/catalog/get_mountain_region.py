from dataclasses import dataclass

from serendipeak.catalog.folding import fold
from serendipeak.catalog.ports import MountainRegionReader, RegionMountain
from serendipeak.catalog.region_directory import RegionDirectory, RegionSummary
from serendipeak.catalog.regions import RegionSlugNotFound
from serendipeak.catalog.slug import is_valid_slug


@dataclass(frozen=True, slots=True)
class DescendantMountains:
    region: RegionSummary
    # The names from just under the viewed region down to this one.
    path: str
    mountains: tuple[RegionMountain, ...]


@dataclass(frozen=True, slots=True)
class MountainRegionDetail:
    summary: RegionSummary
    ancestors: tuple[RegionSummary, ...]
    children: tuple[RegionSummary, ...]
    sibling_count: int
    directly: tuple[RegionMountain, ...]
    in_descendants: tuple[DescendantMountains, ...]


class GetMountainRegion:
    def __init__(self, reader: MountainRegionReader):
        self._reader = reader

    def execute(self, slug: str) -> MountainRegionDetail:
        """The region with its place in the tree and its mountains, split into those that point
        at it and those that point at a region below it.

        Two reads at most, however deep the tree is: the regions, and the mountains of the
        region and its descendants, skipped when none has any. Raises RegionSlugNotFound.
        """
        # No stored slug breaks the slug rule, so a malformed one is unknown without a query;
        # this also keeps NUL characters, which PostgreSQL rejects, off the wire.
        if not is_valid_slug(slug):
            raise RegionSlugNotFound(slug)

        directory = RegionDirectory(self._reader.read_all())
        summary = directory.find(slug)
        if summary is None:
            raise RegionSlugNotFound(slug)

        descendants = directory.descendants(summary.id)
        mountains = (
            self._reader.list_mountains([summary.id, *(item.id for item in descendants)])
            if summary.subtree_mountains
            else ()
        )
        by_region: dict = {}
        for mountain in sorted(mountains, key=lambda item: (fold(item.name), item.slug)):
            by_region.setdefault(mountain.region_id, []).append(mountain)

        return MountainRegionDetail(
            summary=summary,
            ancestors=directory.ancestors(summary.id),
            children=directory.children(summary.id),
            sibling_count=directory.sibling_count(summary.id),
            directly=tuple(by_region.get(summary.id, ())),
            in_descendants=tuple(
                DescendantMountains(
                    region=item,
                    path=directory.relative_path(summary.id, item.id),
                    mountains=tuple(by_region[item.id]),
                )
                for item in descendants
                if item.id in by_region
            ),
        )
