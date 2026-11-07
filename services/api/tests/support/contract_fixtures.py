import copy
import json
from pathlib import Path

from serendipeak.catalog.media.keys import public_url

CONTRACTS_DIR = Path(__file__).resolve().parents[4] / "contracts" / "v1"

# How SerendiPeak's own contract differs from the v1 documents, which are never edited: tests
# turn a v1 document into the one SerendiPeak serves by applying exactly these changes.
#
# Owned photographs: these members hold owned media URLs.
OWNED_MEDIA_MEMBERS = {
    "url": "viewer_key",
    "thumbnailUrl": "page_key",
}
# One author replaces the v1 attribution and creator, which are two credits for one photograph.
RENAMED_IMAGE_MEMBERS = {"attribution": "author"}
# The Commons file title is derivable from a Commons source page and meaningless for any other
# source, and the creator is absorbed into the author.
DROPPED_IMAGE_MEMBERS = ("creator", "sourceIdentifier")
# Nothing renders the prominence, and the Wikipedia link is not served: the Wikidata item is
# the language-independent reference that stays.
DROPPED_MOUNTAIN_MEMBERS = ("prominenceMeters",)
DROPPED_SOURCE_MEMBERS = ("wikipedia",)


def load_fixture(name):
    return json.loads((CONTRACTS_DIR / name).read_text(encoding="utf-8"))


def load_frozen_catalog():
    return load_fixture("catalog.json")["mountains"]


def served_by_serendipeak(document, media_base_url, media_of_slug):
    """A v1 mountain or daily document as SerendiPeak serves it: owned media, one author, and
    neither the prominence nor the Wikipedia link.

    A mountain without a primary image is returned as it is.
    """
    expected = copy.deepcopy(document)
    mountain = expected.get("mountain", expected)
    for member in DROPPED_MOUNTAIN_MEMBERS:
        mountain.pop(member, None)
    sources = mountain.get("sources")
    if sources is not None:
        for member in DROPPED_SOURCE_MEMBERS:
            sources.pop(member, None)
        if not sources:
            del mountain["sources"]

    image = mountain.get("primaryImage")
    if image is not None:
        media = media_of_slug(mountain["slug"])
        for member, key in OWNED_MEDIA_MEMBERS.items():
            image[member] = public_url(media_base_url, getattr(media, key))
        for old, new in RENAMED_IMAGE_MEMBERS.items():
            image[new] = image.pop(old)
        for member in DROPPED_IMAGE_MEMBERS:
            image.pop(member, None)

    return expected
