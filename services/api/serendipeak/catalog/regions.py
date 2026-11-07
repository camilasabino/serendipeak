import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from uuid import UUID, uuid5

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.errors import ApplicationError, DomainError

# Region ids are derived from the slug, so loading the same taxonomy twice stores the same ids.
REGION_ID_NAMESPACE = UUID("5c0a6f3e-9d0b-4f1e-8a57-3b6e2d9c1a40")

_NOT_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")


class UnknownRegion(ApplicationError):
    def __init__(self, region_id: UUID):
        super().__init__(f"no region has the id {region_id}")
        self.region_id = region_id


class RegionCycle(DomainError):
    def __init__(self, region_id: UUID):
        super().__init__(f"the parents of region {region_id} form a cycle")
        self.region_id = region_id


@dataclass(frozen=True, slots=True)
class MountainRegion:
    id: UUID
    slug: str
    name: LocalizedText
    parent_id: UUID | None
    wikidata_id: str | None


@dataclass(frozen=True, slots=True)
class RegionRef:
    slug: str
    name: LocalizedText


@dataclass(frozen=True, slots=True)
class RegionPath:
    """The most specific known region of a mountain and its ancestors, root first."""

    region: RegionRef
    ancestors: tuple[RegionRef, ...]


def region_id_for_slug(slug: str) -> UUID:
    return uuid5(REGION_ID_NAMESPACE, slug)


def derive_region_slug(name: str) -> str:
    """The plain slug of a region name: accents dropped, every other run of non-alphanumeric
    characters (spaces, slashes, any kind of dash) one hyphen.

    Raises ValueError when nothing usable is left. A qualified slug for an ambiguous name is
    chosen by hand, not derived.
    """
    folded = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(char for char in folded if not unicodedata.combining(char)).lower()
    slug = _NOT_ALPHANUMERIC.sub("-", ascii_only).strip("-")
    if not is_valid_slug(slug):
        raise ValueError(f"no valid slug can be derived from {name!r}")

    return slug


def build_region_path(region_id: UUID, regions: Mapping[UUID, MountainRegion]) -> RegionPath:
    """Walk from a region to its root and return the path, ancestors ordered root first.

    Raises UnknownRegion for an id, or a parent, that is not in regions and RegionCycle when the
    parents loop back, which the database never allows and a hand-built map could.
    """
    chain: list[MountainRegion] = []
    seen: set[UUID] = set()
    current: UUID | None = region_id

    while current is not None:
        if current in seen:
            raise RegionCycle(current)
        region = regions.get(current)
        if region is None:
            raise UnknownRegion(current)
        seen.add(current)
        chain.append(region)
        current = region.parent_id

    refs = [RegionRef(slug=region.slug, name=region.name) for region in chain]

    return RegionPath(region=refs[0], ancestors=tuple(reversed(refs[1:])))


PATH_SEPARATOR = " › "


def regions_in_tree_order(
    regions: Iterable[MountainRegion],
) -> list[tuple[MountainRegion, str]]:
    """Every region with the label that tells it apart, depth first, siblings by English name
    then slug in code point order, so a region follows its parent and precedes its next sibling.

    The label is the names from the root, joined by PATH_SEPARATOR. A label that two regions
    share carries the slug as well. A region whose parent is not among regions is treated as a
    root, and an unreachable cycle is left out, as the database never holds one.
    """
    by_id = {region.id: region for region in regions}
    children: dict[UUID | None, list[MountainRegion]] = {}
    for region in by_id.values():
        parent = region.parent_id if region.parent_id in by_id else None
        children.setdefault(parent, []).append(region)
    for siblings in children.values():
        siblings.sort(key=lambda region: (region.name.en, region.slug))

    ordered: list[tuple[MountainRegion, tuple[str, ...]]] = []
    pending = [(region, ()) for region in reversed(children.get(None, []))]
    while pending:
        region, above = pending.pop()
        names = (*above, region.name.en)
        ordered.append((region, names))
        pending.extend((child, names) for child in reversed(children.get(region.id, [])))

    labels = [PATH_SEPARATOR.join(names) for _, names in ordered]
    counts = Counter(labels)
    repeated = {label for label, count in counts.items() if count > 1}

    return [
        (region, f"{label} ({region.slug})" if label in repeated else label)
        for (region, _), label in zip(ordered, labels, strict=True)
    ]
