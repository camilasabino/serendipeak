import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotFound
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainRepository

ACTIVE = mountain("aconcagua")
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)


def get_mountain(slug):
    return GetMountainBySlug(InMemoryMountainRepository([ACTIVE, INACTIVE, DRAFT])).execute(slug)


@pytest.mark.parametrize("entity", [ACTIVE, INACTIVE])
def test_returns_a_public_mountain(entity):
    assert get_mountain(entity.slug) == entity


@pytest.mark.parametrize(
    "slug",
    ["draft-peak", "unknown-peak", "Aconcagua", "aconcagua/", "today", "\x00", "a" * 10_000],
)
def test_a_draft_unknown_or_malformed_slug_is_not_found(slug):
    with pytest.raises(MountainNotFound) as raised:
        get_mountain(slug)

    assert raised.value.slug == slug


FORMER_SLUGS = {
    "everest-old": ACTIVE.id,
    "old-peak-former": INACTIVE.id,
    "draft-former": DRAFT.id,
}


def get_by_former_slug(slug):
    repository = InMemoryMountainRepository([ACTIVE, INACTIVE, DRAFT], former_slugs=FORMER_SLUGS)

    return GetMountainBySlug(repository).execute(slug)


@pytest.mark.parametrize(
    ("former_slug", "entity"), [("everest-old", ACTIVE), ("old-peak-former", INACTIVE)]
)
def test_a_former_slug_returns_the_public_mountain_under_its_current_slug(former_slug, entity):
    mountain = get_by_former_slug(former_slug)

    assert mountain == entity
    assert mountain.slug != former_slug


def test_a_current_slug_is_served_without_consulting_former_slugs():
    assert get_by_former_slug("aconcagua") == ACTIVE


def test_a_former_slug_of_a_draft_is_not_found():
    with pytest.raises(MountainNotFound):
        get_by_former_slug("draft-former")


def test_a_malformed_slug_is_not_looked_up_as_a_former_slug():
    class Repository:
        def find_public_by_slug(self, slug):
            raise AssertionError("queried")

        find_public_by_former_slug = find_public_by_slug

    with pytest.raises(MountainNotFound):
        GetMountainBySlug(Repository()).execute("Aconcagua")
