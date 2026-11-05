import copy
import json
from pathlib import Path

from serendipeak.catalog.media.keys import public_url

CONTRACTS_DIR = Path(__file__).resolve().parents[4] / "contracts" / "v1"

# The only approved divergence from the v1 documents: once photographs are owned, these members
# hold owned media URLs. The fixtures are never edited; tests substitute exactly these members.
APPROVED_V1_DIVERGENCES = {
    "url": "viewer_key",
    "thumbnailUrl": "page_key",
}


def load_fixture(name):
    return json.loads((CONTRACTS_DIR / name).read_text(encoding="utf-8"))


def load_frozen_catalog():
    return load_fixture("catalog.json")["mountains"]


def served_with_owned_media(document, media_base_url, media_of_slug):
    """A v1 mountain or daily document with the approved divergent members replaced by owned URLs.

    A mountain without a primary image is returned as it is.
    """
    expected = copy.deepcopy(document)
    mountain = expected.get("mountain", expected)
    image = mountain.get("primaryImage")
    if image is not None:
        media = media_of_slug(mountain["slug"])
        for member, key in APPROVED_V1_DIVERGENCES.items():
            image[member] = public_url(media_base_url, getattr(media, key))

    return expected
