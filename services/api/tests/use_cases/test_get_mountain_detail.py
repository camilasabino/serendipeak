import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainSlugNotFound
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.publication import PublicationViolation
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainCatalogReader

ACTIVE = mountain("aconcagua")
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)


def get_detail(slug):
    return GetMountainDetail(InMemoryMountainCatalogReader([ACTIVE, DRAFT])).execute(slug)


def test_returns_a_mountain_with_no_violations_when_it_meets_the_rules():
    detail = get_detail("aconcagua")

    assert detail.mountain == ACTIVE
    assert detail.violations == ()


def test_a_draft_is_returned_with_what_blocks_its_publication():
    detail = get_detail("draft-peak")

    assert detail.mountain == DRAFT
    assert detail.violations == (PublicationViolation.CAMERA_MISSING,)


@pytest.mark.parametrize("slug", ["unknown-peak", "Aconcagua", "aconcagua/", "\x00", "a" * 10_000])
def test_an_unknown_or_malformed_slug_is_not_found(slug):
    with pytest.raises(MountainSlugNotFound) as raised:
        get_detail(slug)

    assert raised.value.slug == slug
