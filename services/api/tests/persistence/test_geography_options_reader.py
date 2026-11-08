import pytest

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.geography_options_reader import DjangoGeographyOptionsReader
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("depth", [0, 1, 4])
def test_reading_is_three_queries_whatever_the_taxonomy_holds(django_assert_num_queries, depth):
    if depth:
        names = [f"Region {level}" for level in range(depth)]
        DjangoCatalogStore().load(
            catalog_of(catalog_mountain("deep-peak", region=region_path(*names)))
        )

    with django_assert_num_queries(3):
        options = DjangoGeographyOptionsReader().read()

    assert len(options.regions) == depth
    assert len(options.continents) == 7
