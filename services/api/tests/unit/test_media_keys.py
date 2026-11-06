import pytest

from serendipeak.catalog.media.keys import (
    is_media_key,
    is_sha256,
    original_key,
    page_key,
    page_keys,
    require_media_key,
    viewer_key,
    viewer_keys,
)
from serendipeak.catalog.media.ports import PhotographFormat

DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


def test_accepts_a_lowercase_sha256_digest():
    assert is_sha256(DIGEST)


@pytest.mark.parametrize(
    "value",
    ["", DIGEST.upper(), DIGEST[:-1], f"{DIGEST}0", f"{DIGEST}\n", DIGEST.replace("9", "g", 1)],
)
def test_rejects_anything_but_a_lowercase_sha256_digest(value):
    assert not is_sha256(value)


@pytest.mark.parametrize(
    ("photograph_format", "expected"),
    [
        (PhotographFormat.JPEG, f"photographs/{DIGEST}/original.jpg"),
        (PhotographFormat.PNG, f"photographs/{DIGEST}/original.png"),
        (PhotographFormat.WEBP, f"photographs/{DIGEST}/original.webp"),
    ],
)
def test_the_original_key_takes_its_extension_from_the_decoded_format(photograph_format, expected):
    assert original_key(DIGEST, photograph_format) == expected


def test_rendition_keys_carry_the_digest_and_the_current_rendition_version():
    assert page_key(DIGEST) == f"photographs/{DIGEST}/page-r2.jpg"
    assert viewer_key(DIGEST) == f"photographs/{DIGEST}/viewer-r2.jpg"


def test_the_keys_of_every_published_rendition_version_stay_accepted():
    assert page_keys(DIGEST) == (
        f"photographs/{DIGEST}/page-r1.jpg",
        f"photographs/{DIGEST}/page-r2.jpg",
    )
    assert viewer_keys(DIGEST) == (
        f"photographs/{DIGEST}/viewer-r1.jpg",
        f"photographs/{DIGEST}/viewer-r2.jpg",
    )
    assert page_key(DIGEST) in page_keys(DIGEST)
    assert viewer_key(DIGEST) in viewer_keys(DIGEST)


def test_built_keys_are_deterministic_media_keys():
    built = [original_key(DIGEST, PhotographFormat.PNG), page_key(DIGEST), viewer_key(DIGEST)]

    assert built == [
        original_key(DIGEST, PhotographFormat.PNG),
        page_key(DIGEST),
        viewer_key(DIGEST),
    ]
    assert all(is_media_key(key) for key in built)


@pytest.mark.parametrize("builder", [page_key, viewer_key, page_keys, viewer_keys])
def test_keys_are_only_built_from_a_valid_digest(builder):
    with pytest.raises(ValueError, match="SHA-256"):
        builder(DIGEST.upper())


@pytest.mark.parametrize(
    "key",
    [
        "",
        f"photographs/{DIGEST}",
        f"photographs/{DIGEST}/",
        f"photographs/{DIGEST}/../original.jpg",
        f"photographs/{DIGEST}/.hidden",
        f"photographs/{DIGEST}/a/b.jpg",
        f"photographs/{DIGEST}/Page.jpg",
        f"photographs/{DIGEST[:-1]}/page-r1.jpg",
        f"/photographs/{DIGEST}/page-r1.jpg",
        f"other/{DIGEST}/page-r1.jpg",
        f"photographs/{DIGEST}/page-r1.jpg\n",
    ],
)
def test_rejects_keys_outside_the_media_key_scheme(key):
    assert not is_media_key(key)

    with pytest.raises(ValueError, match="media key"):
        require_media_key(key)
