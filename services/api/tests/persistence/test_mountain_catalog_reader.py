import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_catalog_reader import DjangoMountainCatalogReader
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db


def populate(count):
    statuses = list(MountainStatus)
    DjangoCatalogStore().load(
        catalog_seed(
            *(
                catalog_mountain(
                    f"peak-{index}",
                    status=statuses[index % 3],
                    region=region_path("Alpha Chain", f"Range {index % 4}"),
                )
                for index in range(count)
            )
        )
    )


@pytest.mark.parametrize("count", [1, 12])
def test_listing_is_three_queries_however_many_mountains_there_are(
    django_assert_num_queries, count
):
    populate(count)

    with django_assert_num_queries(3) as captured:
        listed = DjangoMountainCatalogReader().list_all()

    assert len(listed) == count
    first, countries, regions = (query["sql"] for query in captured.captured_queries)
    assert 'LEFT OUTER JOIN "mountain_image"' in first
    assert 'INNER JOIN "continent"' in first
    assert 'FROM "mountain_country" INNER JOIN "country"' in countries
    assert "RECURSIVE" in regions


def test_listing_an_empty_catalog_is_one_query(django_assert_num_queries):
    with django_assert_num_queries(1):
        assert DjangoMountainCatalogReader().list_all() == ()


def test_finding_a_mountain_is_three_queries_and_an_unknown_one_is_one(django_assert_num_queries):
    populate(3)

    with django_assert_num_queries(3):
        assert DjangoMountainCatalogReader().find_by_slug("peak-0") is not None

    with django_assert_num_queries(1):
        assert DjangoMountainCatalogReader().find_by_slug("unknown-peak") is None
