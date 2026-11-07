import importlib
import uuid
from functools import cache

from serendipeak.catalog.bootstrap.ports import CatalogSeed
from serendipeak.catalog.country_aliases import ANTARCTICA_CODE, codes_of_legacy_names
from serendipeak.catalog.entities import Continent, Country
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.geography_input import (
    GEOGRAPHY_FORMAT,
    GEOGRAPHY_FORMAT_VERSION,
    GeographyInput,
    geography_content_sha256,
    parse_geography_input,
)
from serendipeak.catalog.localization import LocalizedText

CONTINENT_MIGRATION = "serendipeak.persistence.migrations.0015_continent_reference"
COUNTRY_MIGRATION = "serendipeak.persistence.migrations.0016_country_reference"


@cache
def reference() -> GeographyReference:
    """The reference data as the migrations load it, read from their own constants."""
    continents = importlib.import_module(CONTINENT_MIGRATION).CONTINENTS
    countries = importlib.import_module(COUNTRY_MIGRATION).COUNTRIES

    return GeographyReference(
        continents={
            code: Continent(code=code, name=LocalizedText(en=en, es=es, pt=pt))
            for code, en, es, pt in continents
        },
        countries={
            code: Country(
                code=code, name=LocalizedText(en=en, es=es, pt=pt), continent_code=continent
            )
            for code, en, es, pt, continent in countries
        },
    )


def continent(code):
    return reference().continents[code]


def country(code):
    return reference().countries[code]


def countries(*codes):
    return tuple(
        sorted((country(code) for code in codes), key=lambda item: (item.name.en, item.code))
    )


def restore_reference_data(connection=None):
    """Loads the reference rows a flush removed, the way the migrations load them."""
    from django.db import connection as default_connection

    from serendipeak.persistence.models import ContinentRecord, CountryRecord

    connection = connection or default_connection
    data = reference()
    ContinentRecord.objects.using(connection.alias).bulk_create(
        (
            ContinentRecord(
                code=item.code, name_en=item.name.en, name_es=item.name.es, name_pt=item.name.pt
            )
            for item in data.continents.values()
        ),
        ignore_conflicts=True,
    )
    CountryRecord.objects.using(connection.alias).bulk_create(
        (
            CountryRecord(
                code=item.code,
                name_en=item.name.en,
                name_es=item.name.es,
                name_pt=item.name.pt,
                continent_id=item.continent_code,
            )
            for item in data.countries.values()
        ),
        ignore_conflicts=True,
    )


def geography_document(entries):
    """A geography input document, checksummed. entries: (id, slug, continent, countries)."""
    document = {
        "format": GEOGRAPHY_FORMAT,
        "version": GEOGRAPHY_FORMAT_VERSION,
        "content_sha256": "",
        "mountains": [
            {"id": str(mountain_id), "slug": slug, "continent": continent_code, "countries": codes}
            for mountain_id, slug, continent_code, codes in entries
        ],
    }
    document["content_sha256"] = geography_content_sha256(document)

    return document


def parse_document(document):
    return parse_geography_input(document, expected_sha256=document["content_sha256"])


def synthetic_geography(seed: CatalogSeed) -> GeographyInput:
    """A geography input for a parsed seed, by a rule that is not editorial.

    It exists so tests can load the seed: the countries are the seed's v1 names through the
    alias table (Antarctica when there are none) and the continent is the reference continent
    of the first of them. Real assignments live in the private input and are never tested
    against.
    """
    entries = []
    for entry in seed.mountains:
        mountain = entry.mountain
        names = seed.legacy_country_names[mountain.id]
        codes = sorted(codes_of_legacy_names(names)) or [ANTARCTICA_CODE]
        first = sorted(names)[0] if names else None
        continent_code = (
            "AN"
            if first is None
            else country(sorted(codes_of_legacy_names([first]))[0]).continent_code
        )
        entries.append((mountain.id, mountain.slug, continent_code, codes))

    return parse_document(geography_document(entries))


def invented_id(label):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"invented:{label}")
