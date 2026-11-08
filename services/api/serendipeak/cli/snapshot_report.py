from collections.abc import Callable

from serendipeak.catalog.bootstrap.catalog_snapshot import CatalogSummary


def write_summary(write: Callable[[str], object], summary: CatalogSummary) -> None:
    write(
        f"{summary.mountains} mountains ({_counts(summary.by_status)}),"
        f" {summary.mountains_in_a_region} in a region, {summary.country_links} country links."
    )
    write(f"Continents: {_counts(summary.by_continent)}.")
    write(
        f"{summary.regions} regions, {summary.photographs} photographs"
        f" ({summary.photographs_with_media} with media),"
        f" {summary.daily_discoveries} daily discoveries."
    )


def _counts(counts) -> str:
    return ", ".join(f"{name} {count}" for name, count in counts.items()) or "none"
