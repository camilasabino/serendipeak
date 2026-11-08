import pytest

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.geography_options_reader import DjangoGeographyOptionsReader
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.fakes import InMemoryGeographyOptionsReader
from tests.support.geography import reference
from tests.support.regions import region_path, regions_of

PATHS = (region_path("Andes", "Southern Andes"), region_path("Alps"))


@pytest.fixture(params=["in-memory", "django"])
def reader_holding(request):
    if request.param == "in-memory":
        return lambda *paths: InMemoryGeographyOptionsReader(regions_of(*paths))

    request.getfixturevalue("db")

    def arrange(*paths):
        DjangoCatalogStore().load(
            catalog_of(
                *(
                    catalog_mountain(f"peak-{index}", region=path)
                    for index, path in enumerate(paths)
                )
            )
        )

        return DjangoGeographyOptionsReader()

    return arrange


def test_reads_every_continent_and_country_of_the_reference_data(reader_holding):
    options = reader_holding(*PATHS).read()

    assert {continent.code: continent for continent in options.continents} == dict(
        reference().continents
    )
    assert {country.code: country for country in options.countries} == dict(reference().countries)


def test_reads_every_region_with_its_parent(reader_holding):
    options = reader_holding(*PATHS).read()

    by_slug = {region.slug: region for region in options.regions}
    assert set(by_slug) == {"andes", "southern-andes", "alps"}
    assert by_slug["southern-andes"].parent_id == by_slug["andes"].id
    assert by_slug["andes"].parent_id is None


def test_a_taxonomy_without_regions_reads_as_empty(reader_holding):
    assert tuple(reader_holding().read().regions) == ()
