from serendipeak.catalog.bootstrap.ports import GeographyDraftReader
from serendipeak.catalog.country_aliases import codes_of_legacy_names
from serendipeak.catalog.geography_input import GEOGRAPHY_FORMAT, GEOGRAPHY_FORMAT_VERSION


class PrepareGeographyInput:
    def __init__(self, reader: GeographyDraftReader):
        self._reader = reader

    def execute(self) -> dict[str, object]:
        """A draft of the geography input, to be completed and frozen by hand.

        It lists every stored mountain with its countries (from the v1 names through the alias
        table while the catalog still holds them) and leaves the continents empty and the
        checksum unset, so a draft can never be applied.
        """
        mountains = [
            {
                "id": str(mountain.id),
                "slug": mountain.slug,
                "continent": None,
                "countries": sorted(
                    mountain.country_codes
                    if mountain.legacy_country_names is None
                    else codes_of_legacy_names(mountain.legacy_country_names)
                ),
            }
            for mountain in self._reader.read_mountains()
        ]

        return {
            "format": GEOGRAPHY_FORMAT,
            "version": GEOGRAPHY_FORMAT_VERSION,
            "content_sha256": None,
            "mountains": mountains,
        }
