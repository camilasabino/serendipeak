from uuid import NAMESPACE_URL, uuid5

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.ports import RegionMountain
from serendipeak.catalog.regions import MountainRegion, region_id_for_slug


def region(slug, name=None, parent=None, wikidata_id=None, **names):
    return MountainRegion(
        id=region_id_for_slug(slug),
        slug=slug,
        name=LocalizedText(en=name or slug.replace("-", " ").title(), **names),
        parent_id=None if parent is None else region_id_for_slug(parent),
        wikidata_id=wikidata_id,
    )


def id_of(slug):
    return region_id_for_slug(slug)


# Parents come before their children. "mountain-ridge" holds a mountain, "andes" holds two
# children, "lone-range" is empty and "himalayas" and "andes" are roots with Wikidata items.
TAXONOMY = (
    region("andes", wikidata_id="Q5456"),
    region("cordillera-blanca", parent="andes"),
    region("patagonian-andes", parent="andes"),
    region("glacier-group", parent="cordillera-blanca"),
    region("himalayas", wikidata_id="Q5451"),
    region("annapurna", parent="himalayas", wikidata_id="Q4756"),
    region("lone-range"),
)
MOUNTAIN_REGION_SLUGS = ("glacier-group",)


def region_mountain(slug, region, name=None, status=MountainStatus.ACTIVE):
    return RegionMountain(
        id=uuid5(NAMESPACE_URL, f"mountain:{slug}"),
        slug=slug,
        name=name or slug.replace("-", " ").title(),
        status=status,
        region_id=id_of(region),
    )
