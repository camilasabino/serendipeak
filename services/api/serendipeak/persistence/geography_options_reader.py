from serendipeak.catalog.ports import GeographyOptions
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_continent, to_country, to_region
from serendipeak.persistence.models import ContinentRecord, CountryRecord, MountainRegionRecord


class DjangoGeographyOptionsReader:
    def read(self) -> GeographyOptions:
        with translate_database_errors():
            return GeographyOptions(
                continents=tuple(to_continent(record) for record in ContinentRecord.objects.all()),
                countries=tuple(to_country(record) for record in CountryRecord.objects.all()),
                regions=tuple(to_region(record) for record in MountainRegionRecord.objects.all()),
            )
