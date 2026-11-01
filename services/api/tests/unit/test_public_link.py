import pytest

from serendipeak.catalog.public_link import is_public_link
from tests.support.catalog import committed_seed
from tests.support.public_links import PUBLIC_LINK_CASES


@pytest.mark.parametrize(("value", "accepted"), PUBLIC_LINK_CASES)
def test_accepts_only_https_links_with_a_host_and_no_userinfo_or_whitespace(value, accepted):
    assert is_public_link(value) is accepted


def test_rejects_exactly_the_unicode_whitespace_characters_in_the_path():
    mismatched = [
        character
        for character in map(chr, range(0x110000))
        if is_public_link(f"https://example.com/{character}") == character.isspace()
    ]

    assert mismatched == []


def test_every_committed_seed_link_is_a_public_link():
    links = []
    for entry in committed_seed().mountains:
        mountain = entry.mountain
        image = mountain.primary_image
        links.extend(
            [
                mountain.wikipedia_url,
                image.url,
                image.thumbnail_url,
                image.source_page_url,
                image.license_url,
            ]
        )

    assert [link for link in links if link is not None and not is_public_link(link)] == []
