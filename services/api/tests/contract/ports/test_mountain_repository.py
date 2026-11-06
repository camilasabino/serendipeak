import pytest

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import CandidateMountain, Coordinates, MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_seed,
    committed_seed,
    primary_image,
)
from tests.support.fakes import InMemoryMountainRepository

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
        DjangoCatalogStore().load(catalog_seed(*entries))
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
    mountains = [entry.mountain for entry in committed_seed().mountains]
    repository = repository_holding(*committed_seed().mountains)

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
    entries = committed_seed().mountains

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
