import pytest

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import CandidateMountain, Coordinates, MountainStatus
from serendipeak.catalog.localization import LocalizedText
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    index_entry_of,
    primary_image,
)
from tests.support.fakes import InMemoryMountainRepository
from tests.support.geography import continent, countries
from tests.support.regions import region_path

ACONCAGUA = catalog_mountain("aconcagua")
WITHOUT_DIMENSIONS = catalog_mountain(
    "mont-blanc", primary_image=primary_image(dimensions=None, media=None)
)
INACTIVE_WITHOUT_IMAGE = catalog_mountain(
    "old-peak",
    status=MountainStatus.INACTIVE,
    coordinates=Coordinates(latitude=-90.0, longitude=180.0),
    primary_image=None,
)
BARE = CatalogMountain(
    mountain=bare_mountain(),
    created_at=CREATED_AT,
    updated_at=UPDATED_AT,
)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, primary_image=None)
CATALOG = (ACONCAGUA, WITHOUT_DIMENSIONS, INACTIVE_WITHOUT_IMAGE, BARE, DRAFT)


@pytest.fixture(params=["in-memory", "django"])
def repository_holding(request):
    if request.param == "in-memory":
        return lambda *entries: InMemoryMountainRepository(entry.mountain for entry in entries)

    request.getfixturevalue("db")

    def arrange(*entries):
        DjangoCatalogStore().load(catalog_of(*entries))
        return DjangoMountainRepository()

    return arrange


@pytest.mark.parametrize(
    "entry",
    [ACONCAGUA, WITHOUT_DIMENSIONS, INACTIVE_WITHOUT_IMAGE, BARE],
    ids=lambda entry: entry.mountain.slug,
)
def test_finds_an_active_or_inactive_mountain_with_every_field(repository_holding, entry):
    repository = repository_holding(*CATALOG)

    assert repository.find_public_by_slug(entry.mountain.slug) == entry.mountain


def test_finds_every_committed_mountain_exactly(repository_holding):
    mountains = [entry.mountain for entry in fixture_catalog().mountains]
    repository = repository_holding(*fixture_catalog().mountains)

    assert [repository.find_public_by_slug(entity.slug) for entity in mountains] == mountains


def test_a_draft_mountain_is_not_found(repository_holding):
    assert repository_holding(*CATALOG).find_public_by_slug("draft-peak") is None


@pytest.mark.parametrize("slug", ["unknown-peak", "Aconcagua", "aconcagua ", "aconc", "a" * 10_000])
def test_only_an_exact_case_sensitive_match_is_found(repository_holding, slug):
    assert repository_holding(*CATALOG).find_public_by_slug(slug) is None


def test_an_empty_catalog_finds_nothing(repository_holding):
    assert repository_holding().find_public_by_slug("aconcagua") is None


def test_active_candidates_are_the_active_mountains_in_code_point_order(repository_holding):
    entries = (
        catalog_mountain("mountain"),
        catalog_mountain("mount9"),
        catalog_mountain("mount-fuji"),
        *CATALOG,
    )

    candidates = repository_holding(*entries).list_active_candidates()

    assert candidates == tuple(
        CandidateMountain(id=entry.mountain.id, slug=entry.mountain.slug)
        for entry in (
            ACONCAGUA,
            WITHOUT_DIMENSIONS,
            entries[2],
            entries[1],
            entries[0],
        )
    )


def test_every_committed_active_mountain_is_a_candidate(repository_holding):
    entries = fixture_catalog().mountains

    candidates = repository_holding(*entries).list_active_candidates()

    assert [candidate.slug for candidate in candidates] == sorted(
        entry.mountain.slug for entry in entries if entry.mountain.status is MountainStatus.ACTIVE
    )


@pytest.mark.parametrize(
    "entries",
    [(INACTIVE_WITHOUT_IMAGE, BARE, DRAFT), ()],
    ids=["no-active", "empty"],
)
def test_no_active_mountain_gives_no_candidates(repository_holding, entries):
    assert repository_holding(*entries).list_active_candidates() == ()


GEOGRAPHY = [
    # The continent is stored on its own: nothing derives it from the countries.
    catalog_mountain("alpine-islet", continent=continent("AF"), countries=countries("CH")),
    catalog_mountain("pacific-cone", continent=continent("OC"), countries=countries("US")),
    catalog_mountain("ice-dome", continent=continent("AN"), countries=countries("AQ")),
    catalog_mountain(
        "border-spire", continent=continent("AS"), countries=countries("NP", "CN", "IN")
    ),
    catalog_mountain("unclaimed-rock", continent=continent("EU"), countries=()),
]


@pytest.mark.parametrize("entry", GEOGRAPHY, ids=lambda entry: entry.mountain.slug)
def test_the_continent_and_countries_come_back_as_stored(repository_holding, entry):
    repository = repository_holding(*GEOGRAPHY)

    found = repository.find_public_by_slug(entry.mountain.slug)

    assert found.continent == entry.mountain.continent
    assert found.countries == entry.mountain.countries


def test_countries_are_ordered_by_english_name_then_code(repository_holding):
    repository = repository_holding(*GEOGRAPHY)

    found = repository.find_public_by_slug("border-spire")

    assert [country.name.en for country in found.countries] == ["China", "India", "Nepal"]
    assert [country.code for country in found.countries] == ["CN", "IN", "NP"]


def test_a_mountain_keeps_a_continent_that_differs_from_its_countries(repository_holding):
    repository = repository_holding(*GEOGRAPHY)

    islet = repository.find_public_by_slug("alpine-islet")

    assert islet.continent.code == "AF"
    assert [country.continent_code for country in islet.countries] == ["EU"]


@pytest.mark.parametrize("names", [("Alpha Chain",), ("Alpha Chain", "Beta Range", "Gamma Ridge")])
def test_a_region_comes_back_with_its_ancestors_root_first(repository_holding, names):
    entry = catalog_mountain("ridge-peak", region=region_path(*names))

    found = repository_holding(entry).find_public_by_slug("ridge-peak")

    assert found.region == region_path(*names)


def test_a_mountain_without_a_region_has_none(repository_holding):
    assert repository_holding(BARE).find_public_by_slug("bare-peak").region is None


def test_the_index_holds_the_active_mountains_in_code_point_order(repository_holding):
    entries = (catalog_mountain("mountain"), catalog_mountain("mount9"), *CATALOG)

    index = repository_holding(*entries).list_active_index()

    assert index == tuple(
        index_entry_of(entry.mountain)
        for entry in (ACONCAGUA, WITHOUT_DIMENSIONS, entries[1], entries[0])
    )


def test_the_index_leaves_out_draft_and_inactive_mountains(repository_holding):
    index = repository_holding(*CATALOG).list_active_index()

    assert {entry.slug for entry in index} == {"aconcagua", "mont-blanc"}


def test_every_committed_active_mountain_is_in_the_index_exactly(repository_holding):
    entries = fixture_catalog().mountains

    index = repository_holding(*entries).list_active_index()

    assert index == tuple(
        index_entry_of(entry.mountain)
        for entry in sorted(entries, key=lambda entry: entry.mountain.slug)
        if entry.mountain.status is MountainStatus.ACTIVE
    )


def test_the_index_keeps_geography_and_regions_as_stored(repository_holding):
    with_region = catalog_mountain("ridge-peak", region=region_path("Alpha", "Beta", "Gamma"))
    without_region = catalog_mountain("plain-peak", region=None, countries=())
    shared_ancestor = catalog_mountain("sister-peak", region=region_path("Alpha", "Delta"))

    repository = repository_holding(*GEOGRAPHY, with_region, without_region, shared_ancestor)

    assert repository.list_active_index() == tuple(
        index_entry_of(entry.mountain)
        for entry in sorted(
            (*GEOGRAPHY, with_region, without_region, shared_ancestor),
            key=lambda entry: entry.mountain.slug,
        )
    )


def test_the_index_keeps_the_localized_names(repository_holding):
    named = catalog_mountain(
        "cerro-peak", name=LocalizedText(en="Cerro Peak", es="Cerro Pico", pt=None)
    )

    [entry] = repository_holding(named).list_active_index()

    assert entry.name == LocalizedText(en="Cerro Peak", es="Cerro Pico", pt=None)


@pytest.mark.parametrize(
    "entries",
    [(INACTIVE_WITHOUT_IMAGE, BARE, DRAFT), ()],
    ids=["no-active", "empty"],
)
def test_no_active_mountain_gives_an_empty_index(repository_holding, entries):
    assert repository_holding(*entries).list_active_index() == ()


@pytest.mark.django_db
def test_the_index_is_three_queries_however_many_mountains(django_assert_num_queries):
    DjangoCatalogStore().load(fixture_catalog())

    with django_assert_num_queries(3):
        index = DjangoMountainRepository().list_active_index()

    assert len(index) == sum(
        entry.mountain.status is MountainStatus.ACTIVE for entry in fixture_catalog().mountains
    )


@pytest.mark.django_db
def test_the_index_skips_the_region_query_when_no_mountain_has_a_region(
    django_assert_num_queries,
):
    DjangoCatalogStore().load(catalog_of(catalog_mountain("plain-peak", region=None)))

    with django_assert_num_queries(2):
        DjangoMountainRepository().list_active_index()


@pytest.mark.django_db
def test_an_empty_index_is_one_query(django_assert_num_queries):
    with django_assert_num_queries(1):
        assert DjangoMountainRepository().list_active_index() == ()
