from collections.abc import Collection
from dataclasses import dataclass

from serendipeak.catalog.bootstrap.catalog_snapshot import (
    CatalogSummary,
    catalog_from_snapshot_content,
    in_document_order,
    snapshot_document,
    summarize_catalog,
)
from serendipeak.catalog.bootstrap.ports import (
    CatalogSnapshot,
    CatalogStore,
    GeographyReferenceReader,
)
from serendipeak.catalog.errors import InvalidCatalogSnapshot


@dataclass(frozen=True, slots=True)
class SnapshotExport:
    document: dict
    summary: CatalogSummary
    excluded_mountains: tuple[str, ...]
    excluded_regions: tuple[str, ...]
    empty_regions: tuple[str, ...]


class ExportCatalogSnapshot:
    """Reads the catalog and builds its snapshot document. Nothing is written.

    Daily discoveries are left out unless asked for. A mountain or a region is left out only by
    naming its slug, and the export reports what it left out and the regions that end up
    holding no mountain. Before returning, the document is read back against the reference
    data, so a snapshot that could not be loaded is never produced.
    """

    def __init__(self, store: CatalogStore, reference: GeographyReferenceReader):
        self._store = store
        self._reference = reference

    def execute(
        self,
        *,
        exclude_slugs: Collection[str] = (),
        exclude_region_slugs: Collection[str] = (),
        include_discoveries: bool = False,
    ) -> SnapshotExport:
        catalog = self._store.snapshot()
        excluded_mountains = frozenset(exclude_slugs)
        excluded_regions = frozenset(exclude_region_slugs)
        _require_known(excluded_mountains, {e.mountain.slug for e in catalog.mountains}, "mountain")
        _require_known(excluded_regions, {region.slug for region in catalog.regions}, "region")

        mountains = tuple(
            entry for entry in catalog.mountains if entry.mountain.slug not in excluded_mountains
        )
        regions = tuple(region for region in catalog.regions if region.slug not in excluded_regions)
        discoveries = catalog.discoveries if include_discoveries else ()
        _require_closed(mountains, regions, discoveries, catalog)

        exported = CatalogSnapshot(mountains=mountains, discoveries=discoveries, regions=regions)
        document = snapshot_document(exported)

        rebuilt = catalog_from_snapshot_content(document["content"], self._reference.read())
        if rebuilt != in_document_order(exported):
            raise InvalidCatalogSnapshot("the snapshot does not read back as the catalog it holds")

        return SnapshotExport(
            document=document,
            summary=summarize_catalog(exported),
            excluded_mountains=tuple(sorted(excluded_mountains)),
            excluded_regions=tuple(sorted(excluded_regions)),
            empty_regions=_regions_without_mountains(exported),
        )


def _require_known(requested: frozenset[str], known: set[str], kind: str) -> None:
    unknown = sorted(requested - known)
    if unknown:
        raise InvalidCatalogSnapshot(f"no {kind} has these slugs: {', '.join(unknown)}")


def _require_closed(mountains, regions, discoveries, catalog) -> None:
    """Nothing that is kept may point at something that is left out."""
    kept_ids = {entry.mountain.id for entry in mountains}
    for discovery in discoveries:
        if discovery.mountain_id not in kept_ids:
            raise InvalidCatalogSnapshot(
                f"daily discovery {discovery.date} references an excluded mountain"
            )

    kept = {region.slug for region in regions}
    for entry in mountains:
        path = entry.mountain.region
        if path is None:
            continue
        for ref in (*path.ancestors, path.region):
            if ref.slug not in kept:
                raise InvalidCatalogSnapshot(
                    f"mountain {entry.mountain.slug} is in the excluded region {ref.slug}"
                )

    names = {region.id: region.slug for region in catalog.regions}
    for region in regions:
        if region.parent_id is not None and names[region.parent_id] not in kept:
            raise InvalidCatalogSnapshot(
                f"region {region.slug} is under the excluded region {names[region.parent_id]}"
            )


def _regions_without_mountains(catalog: CatalogSnapshot) -> tuple[str, ...]:
    """Regions with no mountain in them, directly or through a descendant."""
    used = set()
    for entry in catalog.mountains:
        path = entry.mountain.region
        if path is not None:
            used.update(ref.slug for ref in (*path.ancestors, path.region))

    return tuple(sorted(region.slug for region in catalog.regions if region.slug not in used))
