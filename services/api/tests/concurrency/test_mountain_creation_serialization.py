import pytest

from serendipeak.catalog.entities import Coordinates, ImageDimensions
from serendipeak.catalog.errors import SlugTaken
from serendipeak.catalog.new_mountain import NewMountain, NewPhotograph
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from tests.support.catalog import photograph_media, primary_image
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

IMAGE = primary_image(media=photograph_media("c" * 64), dimensions=ImageDimensions(640, 480))


def new_mountain(**overrides):
    fields = {
        "slug": "new-peak",
        "name": "New Peak",
        "coordinates": Coordinates(latitude=46.5, longitude=8.5),
        "elevation_meters": 3123,
        "continent_code": "EU",
        "photograph": NewPhotograph(data=b"unused by the store", author="A. Photographer"),
        "country_codes": ("CH",),
    }
    fields.update(overrides)

    return NewMountain(**fields)


def create(**overrides):
    return DjangoMountainCreationStore().create_draft(new_mountain(**overrides), IMAGE)


def test_two_creations_of_one_slug_let_exactly_one_succeed_and_leave_no_partial_rows():
    def losing_creation():
        try:
            create(name="Second")
        except SlugTaken as error:
            return error

    refusal = run_while_a_change_holds_the_lock(lambda: create(name="First"), losing_creation)

    assert refusal.slug == "new-peak"
    assert list(MountainRecord.objects.values_list("name_en", flat=True)) == ["First"]
    assert MountainImageRecord.objects.count() == 1
    assert MountainCountryRecord.objects.count() == 1


def test_a_region_deleted_while_a_creation_waits_for_it_is_refused_as_unknown():
    region = MountainRegionRecord.objects.create(slug="doomed-range", name_en="Doomed Range")
    region_id = region.id

    def refused_creation():
        try:
            create(region_id=region_id)
        except UnknownRegion as error:
            return error

    refusal = run_while_a_change_holds_the_lock(region.delete, refused_creation)

    assert refusal.region_id == region_id
    assert not MountainRecord.objects.exists()
    assert not MountainImageRecord.objects.exists()
