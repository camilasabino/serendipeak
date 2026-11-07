from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import (
    MountainRegion,
    RegionPath,
    RegionRef,
    derive_region_slug,
    region_id_for_slug,
)


def region_ref(name):
    return RegionRef(slug=derive_region_slug(name), name=LocalizedText(en=name))


def region_path(*names):
    """The path of the last name, under the others as its ancestors, root first."""
    refs = [region_ref(name) for name in names]

    return RegionPath(region=refs[-1], ancestors=tuple(refs[:-1]))


def regions_of(*paths):
    """The regions the paths describe, parents first, each once. Slugs identify them."""
    regions = {}
    for path in paths:
        if path is None:
            continue
        refs = (*path.ancestors, path.region)
        parent = None
        for ref in refs:
            regions.setdefault(
                ref.slug,
                MountainRegion(
                    id=region_id_for_slug(ref.slug),
                    slug=ref.slug,
                    name=ref.name,
                    parent_id=None if parent is None else region_id_for_slug(parent.slug),
                    wikidata_id=None,
                ),
            )
            parent = ref

    return tuple(regions.values())


def region_documents(regions):
    """The regions section of a geography input document."""
    by_id = {region.id: region for region in regions}

    return [
        {
            "slug": region.slug,
            "name_en": region.name.en,
            "parent": None if region.parent_id is None else by_id[region.parent_id].slug,
            "wikidata_id": region.wikidata_id,
        }
        for region in regions
    ]
