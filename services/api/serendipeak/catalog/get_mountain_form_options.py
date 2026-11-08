from dataclasses import dataclass

from serendipeak.catalog.entities import Continent, Country
from serendipeak.catalog.ports import GeographyOptionsReader
from serendipeak.catalog.regions import RegionOption, regions_in_tree_order


@dataclass(frozen=True, slots=True)
class MountainFormOptions:
    continents: tuple[Continent, ...]
    countries: tuple[Country, ...]
    regions: tuple[RegionOption, ...]


class GetMountainFormOptions:
    def __init__(self, reader: GeographyOptionsReader):
        self._reader = reader

    def execute(self) -> MountainFormOptions:
        """The continents and countries by English name and the regions in tree order, each with
        the path that labels it: everything a mountain form offers to choose."""
        options = self._reader.read()

        return MountainFormOptions(
            continents=tuple(sorted(options.continents, key=lambda c: (c.name.en, c.code))),
            countries=tuple(sorted(options.countries, key=lambda c: (c.name.en, c.code))),
            regions=tuple(
                RegionOption(id=region.id, slug=region.slug, label=label)
                for region, label in regions_in_tree_order(options.regions)
            ),
        )
