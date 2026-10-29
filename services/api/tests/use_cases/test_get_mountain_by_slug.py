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
