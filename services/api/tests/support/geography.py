import importlib
import uuid
from functools import cache

from serendipeak.catalog.entities import Continent, Country
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.geography_input import (
    GEOGRAPHY_FORMAT,
    GEOGRAPHY_FORMAT_VERSION,
    geography_content_sha256,
    parse_geography_input,
)
from serendipeak.catalog.localization import LocalizedText
from tests.support.regions import region_documents

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


def geography_document(entries, regions=()):
    """A geography input document, checksummed.

    entries: (id, slug, continent, countries) or (id, slug, continent, countries, region slug).
    regions: the MountainRegion entities of the taxonomy, parents first.
    """
    document = {
        "format": GEOGRAPHY_FORMAT,
        "version": GEOGRAPHY_FORMAT_VERSION,
        "content_sha256": "",
        "mountains": [
            {
                "id": str(mountain_id),
                "slug": slug,
                "continent": continent_code,
                "countries": codes,
                "region": region[0] if region else None,
            }
            for mountain_id, slug, continent_code, codes, *region in entries
        ],
        "regions": region_documents(regions),
    }
    document["content_sha256"] = geography_content_sha256(document)

    return document


def document_of(geography, mountains=None):
    """The document of a parsed input, or of some of its mountains with the regions they use."""
    chosen = geography.mountains if mountains is None else mountains
    used = {entry.region_slug for entry in chosen}
    by_id = {region.id: region for region in geography.regions}
    for slug in list(used):
        region = next((r for r in geography.regions if r.slug == slug), None)
        while region is not None and region.parent_id is not None:
            region = by_id[region.parent_id]
            used.add(region.slug)

    return geography_document(
        [
            (
                entry.id,
                entry.slug,
                entry.continent_code,
                list(entry.country_codes),
                *(() if entry.region_slug is None else (entry.region_slug,)),
            )
            for entry in chosen
        ],
        [region for region in geography.regions if region.slug in used],
    )


def parse_document(document):
    return parse_geography_input(document, expected_sha256=document["content_sha256"])


def invented_id(label):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"invented:{label}")
