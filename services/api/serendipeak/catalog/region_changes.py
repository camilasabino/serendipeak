import re
from dataclasses import dataclass, replace
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.errors import ApplicationError, DomainError

_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)


class MountainRegionViolation(StrEnum):
    SLUG_INVALID = "slug_invalid"
    NAME_EN_BLANK = "name_en_blank"
    NAME_ES_BLANK = "name_es_blank"
    NAME_PT_BLANK = "name_pt_blank"
    WIKIDATA_ID_INVALID = "wikidata_id_invalid"


@dataclass(frozen=True, slots=True)
class NewMountainRegion:
    """What an editor supplies to create a region. The slug is chosen here and never changes;
    a missing parent makes a root. Names that are absent are None, never blank."""

    slug: str
    name: LocalizedText
    parent_id: UUID | None = None
    wikidata_id: str | None = None


@dataclass(frozen=True, slots=True)
class MountainRegionUpdate:
    """The editable state of a region: its names and its Wikidata item. The id, the slug and
    the parent are not part of it, so an update cannot name them."""

    name: LocalizedText
    wikidata_id: str | None = None


class InvalidMountainRegion(DomainError):
    def __init__(self, violations: tuple[MountainRegionViolation, ...]):
        super().__init__(", ".join(violations))
        self.violations = violations


class RegionSlugTaken(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"the region slug {slug!r} is already in use")
        self.slug = slug


class RegionNameTaken(ApplicationError):
    def __init__(self, parent_id: UUID, name: str):
        super().__init__(f"region {parent_id} already has a child named {name!r}")
        self.parent_id = parent_id
        self.name = name


class RegionWikidataTaken(ApplicationError):
    def __init__(self, wikidata_id: str):
        super().__init__(f"another region already has the Wikidata item {wikidata_id}")
        self.wikidata_id = wikidata_id


class RegionWouldDescendFromItself(DomainError):
    def __init__(self, region_id: UUID, parent_id: UUID):
        super().__init__(f"region {region_id} cannot be placed under {parent_id}, inside itself")
        self.region_id = region_id
        self.parent_id = parent_id


class RegionInUse(ApplicationError):
    def __init__(self, region_id: UUID, child_count: int, mountain_count: int):
        super().__init__(
            f"region {region_id} has {child_count} child regions and {mountain_count} mountains"
        )
        self.region_id = region_id
        self.child_count = child_count
        self.mountain_count = mountain_count


def trimmed(name: LocalizedText) -> LocalizedText:
    """The names without the whitespace around them; absent ones stay absent."""
    return LocalizedText(
        en=name.en.strip(),
        es=None if name.es is None else name.es.strip(),
        pt=None if name.pt is None else name.pt.strip(),
    )


def _name_violations(name: LocalizedText) -> list[MountainRegionViolation]:
    violations = []
    if not name.en:
        violations.append(MountainRegionViolation.NAME_EN_BLANK)
    if name.es is not None and not name.es:
        violations.append(MountainRegionViolation.NAME_ES_BLANK)
    if name.pt is not None and not name.pt:
        violations.append(MountainRegionViolation.NAME_PT_BLANK)

    return violations


def _wikidata_violations(wikidata_id: str | None) -> list[MountainRegionViolation]:
    if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
        return [MountainRegionViolation.WIKIDATA_ID_INVALID]

    return []


def normalized_new_region(region: NewMountainRegion) -> NewMountainRegion:
    return replace(region, name=trimmed(region.name))


def normalized_region_update(update: MountainRegionUpdate) -> MountainRegionUpdate:
    return replace(update, name=trimmed(update.name))


def new_region_violations(region: NewMountainRegion) -> tuple[MountainRegionViolation, ...]:
    """Why a region cannot be stored; empty means it can. The names are judged as given, so a
    caller trims them first with normalized_new_region. Whether the parent exists and whether
    the slug, the sibling name and the Wikidata item are free is judged when it is written."""
    violations = []
    if not is_valid_slug(region.slug):
        violations.append(MountainRegionViolation.SLUG_INVALID)
    violations.extend(_name_violations(region.name))
    violations.extend(_wikidata_violations(region.wikidata_id))

    return tuple(violations)


def region_update_violations(update: MountainRegionUpdate) -> tuple[MountainRegionViolation, ...]:
    """Why the new state of a region cannot be stored; empty means it can."""
    return tuple(_name_violations(update.name) + _wikidata_violations(update.wikidata_id))
