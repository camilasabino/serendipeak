import pytest

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_catalog_reader import DjangoMountainCatalogReader
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_of,
    fixture_catalog,
)
from tests.support.fakes import InMemoryMountainCatalogReader
from tests.support.geography import continent, countries
from tests.support.regions import region_path

ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE, primary_image=None)
DRAFT = catalog_mountain(
    "draft-peak",
    status=MountainStatus.DRAFT,
    camera=None,
    primary_image=None,
    region=region_path("Alpha Chain", "Beta Range"),
    continent=continent("AF"),
    countries=countries("CH", "FR"),
)
CATALOG = (ACTIVE, INACTIVE, DRAFT)


@pytest.fixture(params=["in-memory", "django"])
def reader_holding(request):
    if request.param == "in-memory":
        return lambda *entries: InMemoryMountainCatalogReader(entry.mountain for entry in entries)

    request.getfixturevalue("db")

    def arrange(*entries):
        DjangoCatalogStore().load(catalog_of(*entries))
        return DjangoMountainCatalogReader()

    return arrange


def test_lists_every_mountain_of_every_status_with_every_field(reader_holding):
    listed = reader_holding(*CATALOG).list_all()

    assert sorted(listed, key=lambda mountain: mountain.slug) == [
        ACTIVE.mountain,
        DRAFT.mountain,
        INACTIVE.mountain,
    ]


def test_lists_every_committed_mountain_exactly(reader_holding):
    expected = {entry.mountain.slug: entry.mountain for entry in fixture_catalog().mountains}

    listed = reader_holding(*fixture_catalog().mountains).list_all()

    assert {mountain.slug: mountain for mountain in listed} == expected


def test_an_empty_catalog_lists_nothing(reader_holding):
    assert reader_holding().list_all() == ()


@pytest.mark.parametrize("entry", CATALOG, ids=lambda entry: entry.mountain.slug)
def test_finds_a_draft_or_public_mountain_by_slug(reader_holding, entry):
    assert reader_holding(*CATALOG).find_by_slug(entry.mountain.slug) == entry.mountain


def test_a_bare_mountain_has_no_region_or_photograph(reader_holding):
    bare = CatalogMountain(mountain=bare_mountain(), created_at=CREATED_AT, updated_at=UPDATED_AT)

    found = reader_holding(bare).find_by_slug(bare.mountain.slug)

    assert found == bare.mountain
    assert found.region is None
    assert found.primary_image is None


@pytest.mark.parametrize("slug", ["unknown-peak", "Aconcagua", "aconcagua ", "aconc"])
def test_only_an_exact_case_sensitive_match_is_found(reader_holding, slug):
    assert reader_holding(*CATALOG).find_by_slug(slug) is None
