import pytest

from serendipeak.catalog.entities import Coordinates, ImageDimensions
from serendipeak.catalog.errors import SlugTaken
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.new_mountain import NewMountain, NewPhotograph
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord, MountainSlugAliasRecord
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import catalog_mountain, catalog_of, photograph_media, primary_image
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

TARGET = catalog_mountain("target-peak")
OTHER = catalog_mountain("other-peak")
IMAGE = primary_image(media=photograph_media("c" * 64), dimensions=ImageDimensions(640, 480))


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_of(TARGET, OTHER))


def save(entry, slug):
    update = MountainUpdate(
        slug=slug,
        name=entry.mountain.name.en,
        elevation_meters=entry.mountain.elevation_meters,
        continent_code="SA",
        country_codes=("AR",),
        summary=entry.mountain.summary.en,
        osm_node_id=entry.mountain.osm_node_id,
        wikidata_id=entry.mountain.wikidata_id,
    )

    return DjangoMountainUpdateStore().update(entry.mountain.id, update, public_edit_violations)


def create(slug):
    mountain = NewMountain(
        slug=slug,
        name="New Peak",
        coordinates=Coordinates(latitude=46.5, longitude=8.5),
        elevation_meters=3123,
        continent_code="EU",
        photograph=NewPhotograph(data=b"unused by the store", author="A. Photographer"),
        country_codes=("CH",),
    )

    return DjangoMountainCreationStore().create_draft(mountain, IMAGE)


def refusal_of(action):
    def attempt():
        try:
            action()
        except SlugTaken as error:
            return error

    return attempt


def slugs():
    return sorted(MountainRecord.objects.values_list("slug", flat=True))


def test_a_creation_waiting_for_a_slug_being_left_is_refused_once_it_becomes_former():
    refusal = run_while_a_change_holds_the_lock(
        lambda: save(TARGET, "renamed-peak"), refusal_of(lambda: create("target-peak"))
    )

    assert refusal.slug == "target-peak"
    assert slugs() == ["other-peak", "renamed-peak"]
    assert list(MountainSlugAliasRecord.objects.values_list("slug", flat=True)) == ["target-peak"]


def test_an_update_waiting_for_a_slug_being_left_is_refused_once_it_becomes_former():
    refusal = run_while_a_change_holds_the_lock(
        lambda: save(TARGET, "renamed-peak"), refusal_of(lambda: save(OTHER, "target-peak"))
    )

    assert refusal.slug == "target-peak"
    assert slugs() == ["other-peak", "renamed-peak"]


def test_a_mountain_taking_back_its_slug_wins_over_a_creation_waiting_for_the_same_one():
    save(TARGET, "renamed-peak")

    refusal = run_while_a_change_holds_the_lock(
        lambda: save(TARGET, "target-peak"), refusal_of(lambda: create("target-peak"))
    )

    assert refusal.slug == "target-peak"
    assert slugs() == ["other-peak", "target-peak"]
    assert list(MountainSlugAliasRecord.objects.values_list("slug", flat=True)) == ["renamed-peak"]
