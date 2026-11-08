import pytest

from serendipeak.catalog.entities import Coordinates, ImageDimensions, MountainStatus
from serendipeak.catalog.errors import SlugTaken, UnknownContinent, UnknownCountries
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.new_mountain import NewMountain, NewPhotograph
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from tests.support.catalog import catalog_mountain, catalog_of, photograph_media, primary_image
from tests.support.fakes import InMemoryMountainCreationStore
from tests.support.geography import continent, countries
from tests.support.regions import region_path, regions_of

pytestmark = pytest.mark.django_db

TAKEN = catalog_mountain("taken-peak")
PATH = region_path("Test Chain", "Test Range")
REGIONS = regions_of(PATH)
LEAF = next(region for region in REGIONS if region.slug == "test-range")
ROOT = next(region for region in REGIONS if region.slug == "test-chain")
ABSENT_REGION_ID = catalog_mountain("elsewhere", region=region_path("Elsewhere")).mountain.id

# Long binary expansions: what is stored has to be exactly what was asked for.
COORDINATES = Coordinates(latitude=-33.123456789012345, longitude=-70.987654321098765)
IMAGE = primary_image(media=photograph_media("c" * 64), dimensions=ImageDimensions(640, 480))
UPLOAD = NewPhotograph(data=b"unused by the store", author="A. Photographer")


def new_mountain(**overrides):
    fields = {
        "slug": "new-peak",
        "name": "New Peak",
        "coordinates": COORDINATES,
        "elevation_meters": 3123,
        "continent_code": "SA",
        "photograph": UPLOAD,
    }
    fields.update(overrides)

    return NewMountain(**fields)


class Arrangement:
    def __init__(self, store, mountain_of):
        self.store = store
        self.mountain_of = mountain_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryMountainCreationStore([TAKEN.mountain], REGIONS)
        return Arrangement(store, store.mountain)

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_of(catalog_mountain("taken-peak", region=PATH)))

    def stored(slug):
        record = MountainRecord.objects.filter(slug=slug).first()

        return None if record is None else to_mountain(record)

    return Arrangement(DjangoMountainCreationStore(), stored)


def test_a_draft_is_stored_with_everything_given_and_returned_as_stored(arranged):
    request = new_mountain(
        country_codes=("CL", "AR"),
        region_id=LEAF.id,
        summary="A fine mountain.",
        osm_node_id=1504741757,
        wikidata_id="Q39739",
    )

    created = arranged.store.create_draft(request, IMAGE)

    assert created.status is MountainStatus.DRAFT
    assert created.name == LocalizedText(en="New Peak")
    assert created.coordinates == COORDINATES
    assert created.elevation_meters == 3123
    assert created.continent == continent("SA")
    assert created.countries == countries("AR", "CL")
    assert created.region == PATH
    assert created.summary == LocalizedText(en="A fine mountain.")
    assert created.camera is None
    assert created.primary_image == IMAGE
    assert (created.osm_node_id, created.wikidata_id) == (1504741757, "Q39739")
    assert arranged.mountain_of("new-peak") == created


def test_a_draft_may_leave_every_optional_value_out(arranged):
    created = arranged.store.create_draft(new_mountain(), IMAGE)

    assert created.countries == ()
    assert created.region is None
    assert created.summary is None
    assert (created.osm_node_id, created.wikidata_id) == (None, None)
    assert arranged.mountain_of("new-peak") == created


def test_a_region_at_any_depth_may_be_chosen(arranged):
    created = arranged.store.create_draft(new_mountain(region_id=ROOT.id), IMAGE)

    assert created.region.region.slug == "test-chain"
    assert created.region.ancestors == ()


def test_a_repeated_country_code_is_one_link(arranged):
    created = arranged.store.create_draft(new_mountain(country_codes=("AR", "AR", "CL")), IMAGE)

    assert created.countries == countries("AR", "CL")


def test_each_creation_gets_its_own_id(arranged):
    first = arranged.store.create_draft(new_mountain(slug="first-peak"), IMAGE)
    second = arranged.store.create_draft(new_mountain(slug="second-peak"), IMAGE)

    assert first.id != second.id


def test_a_taken_slug_is_refused_and_leaves_the_mountain_as_it_was(arranged):
    before = arranged.mountain_of("taken-peak")

    with pytest.raises(SlugTaken) as refused:
        arranged.store.create_draft(
            new_mountain(slug="taken-peak", name="Imposter", country_codes=("AR",)), IMAGE
        )

    assert refused.value.slug == "taken-peak"
    assert arranged.mountain_of("taken-peak") == before


def test_a_store_that_refused_can_still_create(arranged):
    with pytest.raises(UnknownContinent):
        arranged.store.create_draft(new_mountain(continent_code="ZZ"), IMAGE)

    created = arranged.store.create_draft(new_mountain(), IMAGE)

    assert arranged.mountain_of("new-peak") == created


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"continent_code": "ZZ"}, UnknownContinent),
        ({"region_id": ABSENT_REGION_ID}, UnknownRegion),
        ({"country_codes": ("AR", "ZZ")}, UnknownCountries),
    ],
    ids=["continent", "region", "countries"],
)
def test_an_unknown_reference_is_refused_and_nothing_is_stored(arranged, overrides, error):
    with pytest.raises(error):
        arranged.store.create_draft(new_mountain(**overrides), IMAGE)

    assert arranged.mountain_of("new-peak") is None


def test_the_unknown_references_are_named(arranged):
    with pytest.raises(UnknownContinent) as continent_error:
        arranged.store.create_draft(new_mountain(continent_code="ZZ"), IMAGE)
    with pytest.raises(UnknownRegion) as region_error:
        arranged.store.create_draft(new_mountain(region_id=ABSENT_REGION_ID), IMAGE)
    with pytest.raises(UnknownCountries) as countries_error:
        arranged.store.create_draft(new_mountain(country_codes=("QQ", "AR", "ZZ")), IMAGE)

    assert continent_error.value.code == "ZZ"
    assert region_error.value.region_id == ABSENT_REGION_ID
    assert countries_error.value.codes == ("QQ", "ZZ")


def test_the_first_applicable_refusal_in_the_documented_order_is_raised(arranged):
    everything_wrong = new_mountain(
        slug="taken-peak",
        continent_code="ZZ",
        region_id=ABSENT_REGION_ID,
        country_codes=("ZZ",),
    )
    with pytest.raises(SlugTaken):
        arranged.store.create_draft(everything_wrong, IMAGE)

    no_slug_problem = new_mountain(
        continent_code="ZZ", region_id=ABSENT_REGION_ID, country_codes=("ZZ",)
    )
    with pytest.raises(UnknownContinent):
        arranged.store.create_draft(no_slug_problem, IMAGE)

    with pytest.raises(UnknownRegion):
        arranged.store.create_draft(
            new_mountain(region_id=ABSENT_REGION_ID, country_codes=("ZZ",)), IMAGE
        )


def test_a_draft_may_be_stored_without_a_photograph(arranged):
    created = arranged.store.create_draft(new_mountain(photograph=None), None)

    assert created.status is MountainStatus.DRAFT
    assert created.primary_image is None
    assert arranged.mountain_of("new-peak") == created
