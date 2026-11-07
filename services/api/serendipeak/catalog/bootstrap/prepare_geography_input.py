from serendipeak.catalog.bootstrap.ports import GeographyDraftReader
from serendipeak.catalog.country_aliases import codes_of_legacy_names
from serendipeak.catalog.errors import InvalidGeographyInput
from serendipeak.catalog.geography_input import GEOGRAPHY_FORMAT, GEOGRAPHY_FORMAT_VERSION
from serendipeak.catalog.regions import derive_region_slug


class PrepareGeographyInput:
    def __init__(self, reader: GeographyDraftReader):
        self._reader = reader

    def execute(self) -> dict[str, object]:
        """A draft of the geography input, to be completed and frozen by hand.

        It lists every stored mountain with its countries (from the v1 names through the alias
        table while the catalog still holds them), leaves the continents empty and the checksum
        unset, so a draft can never be applied, and lists one root region for each distinct range
        name the catalog still holds, with the slug derived from its name. Once the range names
        are gone the draft has no regions. The operator qualifies
        ambiguous slugs, places the regions that have a verified parent and orders parents first.
        Two names that derive the same slug stop the draft.
        """
        mountains = list(self._reader.read_mountains())
        regions = self._draft_regions(mountains)

        return {
            "format": GEOGRAPHY_FORMAT,
            "version": GEOGRAPHY_FORMAT_VERSION,
            "content_sha256": None,
            "mountains": [
                {
                    "id": str(mountain.id),
                    "slug": mountain.slug,
                    "continent": None,
                    "countries": sorted(
                        mountain.country_codes
                        if mountain.legacy_country_names is None
                        else codes_of_legacy_names(mountain.legacy_country_names)
                    ),
                    "region": regions.get(mountain.legacy_range_name),
                }
                for mountain in mountains
            ],
            "regions": [
                {"slug": slug, "name_en": name, "parent": None, "wikidata_id": None}
                for name, slug in regions.items()
            ],
        }

    @staticmethod
    def _draft_regions(mountains) -> dict[str, str]:
        names = sorted({mountain.legacy_range_name for mountain in mountains} - {None})
        regions: dict[str, str] = {}
        taken: dict[str, str] = {}
        for name in names:
            slug = derive_region_slug(name)
            if slug in taken:
                raise InvalidGeographyInput(
                    f"{taken[slug]!r} and {name!r} derive the same slug {slug!r}"
                )
            taken[slug] = name
            regions[name] = slug

        return regions
