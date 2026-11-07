from serendipeak.catalog.geography import GeographyReference
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_geography_reference
from serendipeak.persistence.models import ContinentRecord, CountryRecord


class DjangoGeographyReference:
    def read(self) -> GeographyReference:
        with translate_database_errors():
            return to_geography_reference(
                list(ContinentRecord.objects.all()), list(CountryRecord.objects.all())
            )
