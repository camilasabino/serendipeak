from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.folding import fold
from serendipeak.catalog.ports import CountedRegion
from serendipeak.catalog.regions import (
    PATH_SEPARATOR,
    MountainRegion,
    RegionOption,
    derive_region_slug,
    regions_in_tree_order,
)
from serendipeak.catalog.slug import is_valid_slug


class MoveRefusal(StrEnum):
    ITSELF = "itself"
    INSIDE = "inside"
    CURRENT_PARENT = "current_parent"
    NAME_TAKEN = "name_taken"


@dataclass(frozen=True, slots=True)
class RegionSummary:
    region: MountainRegion
    # The names from the root; carries the slug as well when another region has the same path.
    label: str
    depth: int
    direct_mountains: int
    # The region's own mountains and those of every region below it.
    subtree_mountains: int
    child_regions: int
    descendant_regions: int

    @property
    def id(self) -> UUID:
        return self.region.id

    @property
    def slug(self) -> str:
        return self.region.slug


@dataclass(frozen=True, slots=True)
class RegionTreeEntry:
    summary: RegionSummary
    matched: bool
    # Children kept by the search; all of them without one.
    shown_children: int


@dataclass(frozen=True, slots=True)
class MoveTarget:
    option: RegionOption
    # None means the region can be moved there.
    refusal: MoveRefusal | None


@dataclass(frozen=True, slots=True)
class MoveChoices:
    # The refusal of "no parent", which only a region that is already a root meets.
    root_refusal: MoveRefusal | None
    targets: tuple[MoveTarget, ...]


@dataclass(frozen=True, slots=True)
class MoveImpact:
    region: RegionSummary
    old_path: tuple[str, ...]
    new_path: tuple[str, ...]


class RegionDirectory:
    """The whole taxonomy in memory: every question the region screens ask about its shape is
    answered here from one read, without a query per node.

    Siblings are ordered by English name then slug. A region whose parent is not in the read is
    a root, and a cycle, which the database never holds, is left out.
    """

    def __init__(self, counted: Iterable[CountedRegion]):
        counted = tuple(counted)
        regions = [item.region for item in counted]
        direct = {item.region.id: item.direct_mountains for item in counted}
        ordered = regions_in_tree_order(regions)

        self._regions = {region.id: region for region, _ in ordered}
        self._labels = {region.id: label for region, label in ordered}
        self._order = tuple(region.id for region, _ in ordered)
        self._parent = {
            region.id: region.parent_id if region.parent_id in self._regions else None
            for region, _ in ordered
        }
        self._by_slug = {region.slug: region for region, _ in ordered}

        self._children: dict[UUID | None, list[UUID]] = {}
        self._depth: dict[UUID, int] = {}
        for region_id in self._order:
            parent = self._parent[region_id]
            self._children.setdefault(parent, []).append(region_id)
            self._depth[region_id] = 0 if parent is None else self._depth[parent] + 1

        # A parent precedes its children in tree order, so walking backwards completes every
        # child before the parent that adds it.
        self._subtree_mountains = {region_id: direct[region_id] for region_id in self._order}
        self._descendants = dict.fromkeys(self._order, 0)
        for region_id in reversed(self._order):
            parent = self._parent[region_id]
            if parent is not None:
                self._subtree_mountains[parent] += self._subtree_mountains[region_id]
                self._descendants[parent] += self._descendants[region_id] + 1
        self._direct = direct
        self._position = {region_id: index for index, region_id in enumerate(self._order)}

    def __len__(self) -> int:
        return len(self._order)

    def find(self, slug: str) -> RegionSummary | None:
        region = self._by_slug.get(slug)

        return None if region is None else self._summary(region.id)

    def summary(self, region_id: UUID) -> RegionSummary | None:
        return self._summary(region_id) if region_id in self._regions else None

    def ancestors(self, region_id: UUID) -> tuple[RegionSummary, ...]:
        """The parents of the region, root first. Empty for a root or an unknown region."""
        chain = []
        current = self._parent.get(region_id)
        while current is not None:
            chain.append(self._summary(current))
            current = self._parent[current]

        return tuple(reversed(chain))

    def children(self, region_id: UUID) -> tuple[RegionSummary, ...]:
        return tuple(self._summary(child) for child in self._children.get(region_id, ()))

    def descendants(self, region_id: UUID) -> tuple[RegionSummary, ...]:
        """Every region below this one, depth first, siblings in order."""
        if region_id not in self._regions:
            return ()
        start = self._position[region_id] + 1

        return tuple(
            self._summary(descendant)
            for descendant in self._order[start : start + self._descendants[region_id]]
        )

    def sibling_count(self, region_id: UUID) -> int:
        """The regions that share this one's parent, itself not counted."""
        if region_id not in self._regions:
            return 0

        return len(self._children[self._parent[region_id]]) - 1

    def relative_path(self, region_id: UUID, below_id: UUID) -> str:
        """The names from just under region_id down to below_id, which must be a descendant."""
        names = []
        current: UUID | None = below_id
        while current is not None and current != region_id:
            names.append(self._regions[current].name.en)
            current = self._parent[current]

        return PATH_SEPARATOR.join(reversed(names))

    def options(self) -> tuple[RegionOption, ...]:
        """Every region in tree order, each with the label that tells it apart."""
        return tuple(self._option(region_id) for region_id in self._order)

    def tree(self, search: str = "") -> tuple[RegionTreeEntry, ...]:
        """The regions in tree order. With a search, only the ones whose English, Spanish or
        Portuguese name or whose slug contains it, and the ancestors that lead to them."""
        needle = fold(search)
        matched = {region_id for region_id in self._order if self._matches(region_id, needle)}
        shown = set(self._order) if not needle else self._with_ancestors(matched)

        return tuple(
            RegionTreeEntry(
                summary=self._summary(region_id),
                matched=bool(needle) and region_id in matched,
                shown_children=sum(
                    1 for child in self._children.get(region_id, ()) if child in shown
                ),
            )
            for region_id in self._order
            if region_id in shown
        )

    def same_name_elsewhere(
        self, name: str, *, excluding: UUID | None = None
    ) -> tuple[RegionOption, ...]:
        """The regions whose English name is this one, ignoring case and accents, wherever they
        sit. They are not an error: they are what an editor weighs before choosing a slug."""
        wanted = fold(name)
        if not wanted:
            return ()

        return tuple(
            self._option(region_id)
            for region_id in self._order
            if region_id != excluding and fold(self._regions[region_id].name.en) == wanted
        )

    def option(self, region_id: UUID) -> RegionOption | None:
        return self._option(region_id) if region_id in self._regions else None

    def slug_owner(self, slug: str) -> RegionOption | None:
        region = self._by_slug.get(slug)

        return None if region is None else self._option(region.id)

    def slug_suggestions(self, name: str, parent_id: UUID | None) -> tuple[str, ...]:
        """Free slugs for a new region, plain first and then qualified by its parent, so a name
        that exists elsewhere can still be told apart. None when the name has no usable slug."""
        try:
            plain = derive_region_slug(name)
        except ValueError:
            return ()
        candidates = [plain]
        parent = self._regions.get(parent_id)
        if parent is not None:
            candidates.append(f"{plain}-{parent.slug}")

        return tuple(
            slug for slug in candidates if is_valid_slug(slug) and slug not in self._by_slug
        )

    def move_choices(self, region_id: UUID) -> MoveChoices:
        """Every possible parent of the region with the reason, if any, it cannot be chosen."""
        region = self._regions[region_id]
        start = self._position[region_id]
        inside = set(self._order[start + 1 : start + 1 + self._descendants[region_id]])
        current_parent = self._parent[region_id]
        taken = Counter(
            (self._parent[other], self._regions[other].name.en.lower())
            for other in self._order
            if other != region_id
        )
        name = region.name.en.lower()

        def refusal(target_id: UUID) -> MoveRefusal | None:
            if target_id == region_id:
                return MoveRefusal.ITSELF
            if target_id in inside:
                return MoveRefusal.INSIDE
            if target_id == current_parent:
                return MoveRefusal.CURRENT_PARENT
            if taken[(target_id, name)]:
                return MoveRefusal.NAME_TAKEN

            return None

        return MoveChoices(
            root_refusal=MoveRefusal.CURRENT_PARENT if current_parent is None else None,
            targets=tuple(
                MoveTarget(self._option(target_id), refusal(target_id)) for target_id in self._order
            ),
        )

    def move_impact(self, region_id: UUID, target_id: UUID | None) -> MoveImpact:
        """What a move changes: the path of the region, and so of everything below it."""
        old_path = tuple(item.region.name.en for item in self.ancestors(region_id))
        target_path = (
            ()
            if target_id is None
            else (
                *(item.region.name.en for item in self.ancestors(target_id)),
                self._regions[target_id].name.en,
            )
        )
        name = self._regions[region_id].name.en

        return MoveImpact(
            region=self._summary(region_id),
            old_path=(*old_path, name),
            new_path=(*target_path, name),
        )

    def _summary(self, region_id: UUID) -> RegionSummary:
        return RegionSummary(
            region=self._regions[region_id],
            label=self._labels[region_id],
            depth=self._depth[region_id],
            direct_mountains=self._direct[region_id],
            subtree_mountains=self._subtree_mountains[region_id],
            child_regions=len(self._children.get(region_id, ())),
            descendant_regions=self._descendants[region_id],
        )

    def _option(self, region_id: UUID) -> RegionOption:
        return RegionOption(
            id=region_id, slug=self._regions[region_id].slug, label=self._labels[region_id]
        )

    def _matches(self, region_id: UUID, needle: str) -> bool:
        if not needle:
            return False
        region = self._regions[region_id]
        names = (region.name.en, region.name.es, region.name.pt)

        return needle in region.slug or any(name and needle in fold(name) for name in names)

    def _with_ancestors(self, matched: set[UUID]) -> set[UUID]:
        shown = set()
        for region_id in matched:
            current: UUID | None = region_id
            while current is not None and current not in shown:
                shown.add(current)
                current = self._parent[current]

        return shown
