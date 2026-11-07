from dataclasses import replace

import pytest
from django.db import transaction

from serendipeak.catalog.entities import ImageDimensions, MountainStatus
from serendipeak.catalog.errors import SlugTaken, UnknownContinent, UnknownCountries
from serendipeak.catalog.new_mountain import NewMountain, NewPhotograph
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from tests.support.catalog import (
    UPDATED_AT,
    catalog_mountain,
    catalog_seed,
    photograph_media,
    primary_image,
)
from tests.support.geography import continent
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db

PATH = region_path("Test Chain", "Test Range")
TAKEN = catalog_mountain("taken-peak", region=PATH)
IMAGE = primary_image(media=photograph_media("c" * 64), dimensions=ImageDimensions(640, 480))
CAMERA_COLUMNS = {
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
}


def new_mountain(**overrides):
    fields = {
        "slug": "new-peak",
        "name": "New Peak",
        "coordinates": TAKEN.mountain.coordinates,
        "elevation_meters": 3123,
        "continent_code": "SA",
        "photograph": NewPhotograph(data=b"unused by the store", author="A. Photographer"),
    }
    fields.update(overrides)

    return NewMountain(**fields)


def table_counts():
    return (
        MountainRecord.objects.count(),
        MountainImageRecord.objects.count(),
        MountainCountryRecord.objects.count(),
    )


@pytest.fixture
def store():
    DjangoCatalogStore().load(catalog_seed(TAKEN))
    return DjangoMountainCreationStore()


def test_a_creation_writes_the_mountain_its_photograph_and_its_links(store):
    created = store.create_draft(new_mountain(country_codes=("CL", "AR")), IMAGE)

    record = MountainRecord.objects.get(pk=created.id)
    assert record.status == MountainStatus.DRAFT.value
    assert all(getattr(record, name) is None for name in CAMERA_COLUMNS)
    assert record.continent_id == continent("SA").code
    assert record.created_at > UPDATED_AT
    assert record.updated_at == record.created_at
    assert (record.name_es, record.name_pt, record.summary_es, record.summary_pt) == (None,) * 4
    assert sorted(record.country_links.values_list("country_id", flat=True)) == ["AR", "CL"]
    image = MountainImageRecord.objects.get(pk=created.id)
    assert (image.page_key, image.author, image.width, image.height) == (
        IMAGE.media.page_key,
        IMAGE.author,
        640,
        480,
    )


def test_a_creation_is_three_inserts_a_constraint_check_and_three_reads(
    store, django_assert_num_queries
):
    request = new_mountain(
        region_id=MountainRecord.objects.get(slug="taken-peak").region_id,
        country_codes=("AR", "CL"),
    )

    with django_assert_num_queries(12) as captured:
        store.create_draft(request, IMAGE)

    statements = [query["sql"] for query in captured.captured_queries]
    assert [sql.split(" (")[0] for sql in statements if sql.startswith("INSERT")] == [
        'INSERT INTO "mountain"',
        'INSERT INTO "mountain_image"',
        'INSERT INTO "mountain_country"',
    ]
    assert [sql for sql in statements if sql.startswith("SET CONSTRAINTS")] == [
        "SET CONSTRAINTS ALL IMMEDIATE",
        "SET CONSTRAINTS ALL DEFERRED",
    ]
    reads = [sql for sql in statements if "SELECT" in sql and not sql.startswith("INSERT")]
    assert len(reads) == 3


def test_a_creation_without_countries_skips_their_insert_and_the_region_read(
    store, django_assert_num_queries
):
    with django_assert_num_queries(10):
        store.create_draft(new_mountain(), IMAGE)


def test_a_refusal_adds_only_the_reads_that_explain_it(store, django_assert_max_num_queries):
    with django_assert_max_num_queries(13):
        with pytest.raises(UnknownCountries):
            store.create_draft(new_mountain(country_codes=("ZZ",)), IMAGE)


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"slug": "taken-peak"}, SlugTaken),
        ({"continent_code": "ZZ"}, UnknownContinent),
        ({"region_id": "00000000-0000-4000-8000-000000000000"}, UnknownRegion),
        ({"country_codes": ("AR", "ZZ")}, UnknownCountries),
    ],
    ids=["slug", "continent", "region", "countries"],
)
def test_a_refusal_writes_no_row_in_any_table(store, overrides, error):
    before = table_counts()

    with pytest.raises(error):
        store.create_draft(new_mountain(**{"country_codes": ("AR",), **overrides}), IMAGE)

    assert table_counts() == before


def test_a_refusal_rolls_back_only_the_creation_inside_a_callers_transaction(store):
    with transaction.atomic():
        store.create_draft(new_mountain(slug="kept-peak"), IMAGE)
        with pytest.raises(SlugTaken):
            store.create_draft(new_mountain(slug="kept-peak"), IMAGE)

    assert MountainRecord.objects.filter(slug="kept-peak").count() == 1
    assert MountainImageRecord.objects.filter(mountain__slug="kept-peak").count() == 1


def test_a_database_refusal_that_is_no_reference_is_an_infrastructure_error(store):
    blank_author = replace(IMAGE, author="   ")

    with pytest.raises(InfrastructureError):
        store.create_draft(new_mountain(), blank_author)

    assert table_counts()[0] == 1


def test_a_creation_without_a_photograph_writes_no_photograph_record(
    store, django_assert_num_queries
):
    with django_assert_num_queries(9) as captured:
        created = store.create_draft(new_mountain(photograph=None), None)

    assert not any(
        query["sql"].startswith('INSERT INTO "mountain_image"')
        for query in captured.captured_queries
    )
    assert not MountainImageRecord.objects.filter(pk=created.id).exists()
