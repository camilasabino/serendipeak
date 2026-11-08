import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.mapping import region_record
from serendipeak.persistence.mountain_region_reader import DjangoMountainRegionReader
from tests.support.fakes import InMemoryMountainRegionReader
from tests.support.records import mountain_record
from tests.support.region_taxonomy import TAXONOMY, id_of, region_mountain

pytestmark = pytest.mark.django_db

MOUNTAINS = (
    ("peak-a", "glacier-group", MountainStatus.ACTIVE),
    ("peak-b", "glacier-group", MountainStatus.DRAFT),
    ("peak-c", "andes", MountainStatus.INACTIVE),
    ("peak-d", "annapurna", MountainStatus.ACTIVE),
)


@pytest.fixture(params=["in-memory", "django"])
def reader_holding(request):
    def arrange(regions=TAXONOMY, mountains=MOUNTAINS):
        if request.param == "in-memory":
            return InMemoryMountainRegionReader(
                regions,
                [
                    region_mountain(slug, region, name="Aconcagua", status=status)
                    for slug, region, status in mountains
                ],
            )

        request.getfixturevalue("db")
        for entry in regions:
            region_record(entry).save(force_insert=True)
        for slug, region, status in mountains:
            mountain_record(slug=slug, region_id=id_of(region), status=status.value).save()

        return DjangoMountainRegionReader()

    return arrange


def test_every_region_is_read_with_the_mountains_that_point_at_it_of_any_status(reader_holding):
    counted = {item.region.slug: item for item in reader_holding().read_all()}

    assert set(counted) == {entry.slug for entry in TAXONOMY}
    assert {slug: item.direct_mountains for slug, item in counted.items()} == {
        "andes": 1,
        "cordillera-blanca": 0,
        "patagonian-andes": 0,
        "glacier-group": 2,
        "himalayas": 0,
        "annapurna": 1,
        "lone-range": 0,
    }
    assert counted["annapurna"].region.parent_id == id_of("himalayas")
    assert counted["andes"].region.wikidata_id == "Q5456"


def test_a_taxonomy_without_regions_reads_as_empty(reader_holding):
    assert tuple(reader_holding(regions=(), mountains=()).read_all()) == ()


def test_the_mountains_of_some_regions_are_listed_with_their_status(reader_holding):
    reader = reader_holding()

    listed = reader.list_mountains([id_of("glacier-group"), id_of("annapurna")])

    assert sorted((item.slug, item.name, item.status, item.region_id) for item in listed) == [
        ("peak-a", "Aconcagua", MountainStatus.ACTIVE, id_of("glacier-group")),
        ("peak-b", "Aconcagua", MountainStatus.DRAFT, id_of("glacier-group")),
        ("peak-d", "Aconcagua", MountainStatus.ACTIVE, id_of("annapurna")),
    ]


def test_no_ids_and_regions_without_mountains_list_nothing(reader_holding):
    reader = reader_holding()

    assert tuple(reader.list_mountains([])) == ()
    assert tuple(reader.list_mountains([id_of("lone-range")])) == ()
