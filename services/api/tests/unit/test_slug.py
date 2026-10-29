import pytest

from serendipeak.catalog.slug import RESERVED_SLUGS, is_valid_slug
from tests.support.contract_fixtures import load_frozen_catalog


@pytest.mark.parametrize("slug", ["a", "k2", "mont-blanc", "puncak-jaya-2", "0"])
def test_accepts_lowercase_ascii_words_joined_by_single_hyphens(slug):
    assert is_valid_slug(slug)


@pytest.mark.parametrize(
    "slug",
    [
        "",
        "Mont-Blanc",
        "mont_blanc",
        "mont--blanc",
        "-mont",
        "mont-",
        "mont blanc",
        "monté",
        "mont\n",
    ],
)
def test_rejects_malformed_slugs(slug):
    assert not is_valid_slug(slug)


@pytest.mark.parametrize("slug", sorted(RESERVED_SLUGS))
def test_rejects_reserved_route_words(slug):
    assert not is_valid_slug(slug)


def test_reserved_words_are_the_v1_routes():
    assert RESERVED_SLUGS == {"today", "random"}


def test_every_frozen_catalog_slug_is_valid():
    assert all(is_valid_slug(mountain["slug"]) for mountain in load_frozen_catalog())
