from dataclasses import dataclass

from serendipeak.catalog.get_mountain_region import MountainRegionDetail
from serendipeak.catalog.list_mountain_regions import MountainRegionTree
from serendipeak.catalog.ports import RegionMountain
from serendipeak.catalog.region_directory import MoveImpact, RegionSummary
from serendipeak.catalog.regions import PATH_SEPARATOR
from serendipeak.studio import region_messages as messages
from serendipeak.studio.representations import LANGUAGES, status_presentation


def wikidata_url(wikidata_id: str | None) -> str | None:
    return None if wikidata_id is None else f"https://www.wikidata.org/wiki/{wikidata_id}"


def translations(summary: RegionSummary) -> list[dict]:
    name = summary.region.name

    return [
        {"code": code, "language": language, "text": value}
        for code, language in LANGUAGES
        if (value := getattr(name, code))
    ]


@dataclass(frozen=True, slots=True)
class TreeRow:
    summary: RegionSummary
    matched: bool
    has_children: bool
    # How many open lists this row ends, so a flat sequence of rows renders as nested lists at
    # any depth without recursion.
    closers: range
    translations: list[dict]
    wikidata_url: str | None


def tree_rows(tree: MountainRegionTree) -> list[TreeRow]:
    entries = tree.entries
    rows = []
    for index, entry in enumerate(entries):
        depth = entry.summary.depth
        has_children = entry.shown_children > 0
        next_depth = entries[index + 1].summary.depth if index + 1 < len(entries) else 0
        rows.append(
            TreeRow(
                summary=entry.summary,
                matched=entry.matched,
                has_children=has_children,
                closers=range(0 if has_children else depth - next_depth),
                translations=translations(entry.summary),
                wikidata_url=wikidata_url(entry.summary.region.wikidata_id),
            )
        )

    return rows


def list_context(tree: MountainRegionTree, search: str, can_write: bool) -> dict:
    return {
        "rows": tree_rows(tree),
        "search": search,
        "total": tree.total,
        "matches": tree.matches,
        "can_write": can_write,
    }


@dataclass(frozen=True, slots=True)
class MountainItem:
    mountain: RegionMountain
    status: object


def mountain_items(mountains: tuple[RegionMountain, ...]) -> list[MountainItem]:
    return [MountainItem(mountain, status_presentation(mountain.status)) for mountain in mountains]


def detail_context(detail: MountainRegionDetail, can_write: bool) -> dict:
    summary = detail.summary

    return {
        "summary": summary,
        "region": summary.region,
        "ancestors": detail.ancestors,
        "children": detail.children,
        "sibling_count": detail.sibling_count,
        "translations": translations(summary),
        "wikidata_url": wikidata_url(summary.region.wikidata_id),
        "directly": mountain_items(detail.directly),
        "in_descendants": [
            {
                "region": group.region,
                "path": group.path,
                "mountains": mountain_items(group.mountains),
            }
            for group in detail.in_descendants
        ],
        "path": PATH_SEPARATOR.join(
            [*(item.region.name.en for item in detail.ancestors), summary.region.name.en]
        ),
        "can_write": can_write,
    }


def move_impact_context(impact: MoveImpact) -> dict:
    summary = impact.region

    return {
        "old_path": PATH_SEPARATOR.join(impact.old_path),
        "new_path": PATH_SEPARATOR.join(impact.new_path),
        "moves_to_root": len(impact.new_path) == 1,
        "child_regions": messages.plural(summary.descendant_regions, "region"),
        "mountains": messages.plural(summary.subtree_mountains, "mountain"),
        "descendant_regions": summary.descendant_regions,
        "subtree_mountains": summary.subtree_mountains,
    }
