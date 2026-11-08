import pytest

from serendipeak.catalog.get_mountain_region import GetMountainRegion
from serendipeak.catalog.list_mountain_regions import ListMountainRegions
from serendipeak.persistence.mapping import region_record
from serendipeak.persistence.mountain_region_reader import DjangoMountainRegionReader
from tests.support.records import mountain_record
from tests.support.region_taxonomy import id_of, region

pytestmark = pytest.mark.django_db

READER = DjangoMountainRegionReader()


def populate(regions, mountains_per_region=1):
    """A chain of regions, each the child of the one before, with mountains in every one."""
    previous = None
    created = []
    for index in range(regions):
        entry = region(f"level-{index}", f"Level {index}", parent=previous)
        region_record(entry).save(force_insert=True)
        for number in range(mountains_per_region):
            mountain_record(slug=f"peak-{index}-{number}", region_id=entry.id).save()
        previous = entry.slug
        created.append(entry)

    return created


@pytest.mark.parametrize("regions", [0, 1, 40])
def test_reading_the_taxonomy_is_one_statement_however_many_regions_and_mountains_there_are(
    django_assert_num_queries, regions
):
    populate(regions, mountains_per_region=2)

    with django_assert_num_queries(1) as captured:
        counted = READER.read_all()

    assert len(counted) == regions
    assert all(item.direct_mountains == 2 for item in counted)
    if regions:
        assert 'COUNT("mountain"."id")' in captured.captured_queries[0]["sql"]


def test_listing_mountains_is_one_statement_and_no_ids_is_none(django_assert_num_queries):
    populate(5, mountains_per_region=3)
    ids = [id_of(f"level-{index}") for index in range(5)]

    with django_assert_num_queries(1):
        listed = READER.list_mountains(ids)
    with django_assert_num_queries(0):
        assert READER.list_mountains([]) == ()

    assert len(listed) == 15


@pytest.mark.parametrize("depth", [1, 6, 40])
def test_a_region_page_is_two_statements_at_any_depth(django_assert_num_queries, depth):
    populate(depth, mountains_per_region=2)

    with django_assert_num_queries(2):
        detail = GetMountainRegion(READER).execute("level-0")

    assert detail.summary.subtree_mountains == 2 * depth


def test_a_region_page_without_mountains_is_one_statement(django_assert_num_queries):
    populate(3, mountains_per_region=0)

    with django_assert_num_queries(1):
        GetMountainRegion(READER).execute("level-0")


@pytest.mark.parametrize("regions", [1, 60])
def test_the_tree_is_one_statement_whatever_it_holds(django_assert_num_queries, regions):
    populate(regions)

    with django_assert_num_queries(1):
        tree = ListMountainRegions(READER).execute()

    assert len(tree.entries) == regions
