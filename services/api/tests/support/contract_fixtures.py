import copy
import json
from pathlib import Path

from serendipeak.catalog.country_aliases import ANTARCTICA_CODE, LEGACY_COUNTRY_CODES
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.regions import derive_region_slug
from tests.support.geography import countries, country, reference

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
# Geography: v1 lists country names as text and has no continent. SerendiPeak serves every
# country as {code, name} with the reference name and every mountain with a continent. The
# new members are derived from the v1 document by this rule, which is for tests only and is
# not editorial: the countries are the v1 names through the alias table (the Antarctic
# mountains, which v1 left without any, get AQ), and the continent is the reference continent
# of the first listed country (AN for AQ). The invented mountain of mountain-minimal.json has no
# country, so its continent is the explicit synthetic value below, from its coordinates (45 N,
# 10 E). Behaviour that depends on a real assignment is tested with invented mountains.
SYNTHETIC_CONTINENT_OF_COUNTRYLESS_MOUNTAIN = {"bare-peak": "EU"}
# Region: v1 names a flat range as text. SerendiPeak serves a region with its ancestors, always
# present and null without one. The member is derived from `rangeName` by a rule for tests only:
# a root region named by the range, whose slug is the plain derivation of its name. A
# hierarchy is tested with synthetic taxonomies, never with the real one.


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

    _serve_geography(mountain)

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


def _serve_geography(mountain):
    range_name = mountain.pop("rangeName", None)
    mountain["region"] = (
        None
        if range_name is None
        else {"slug": derive_region_slug(range_name), "name": range_name, "ancestors": []}
    )

    slug = mountain["slug"]
    names = mountain["countries"]
    if slug in SYNTHETIC_CONTINENT_OF_COUNTRYLESS_MOUNTAIN:
        continent, codes = SYNTHETIC_CONTINENT_OF_COUNTRYLESS_MOUNTAIN[slug], []
    elif names:
        codes = [LEGACY_COUNTRY_CODES[name] for name in names]
        continent = country(codes[0]).continent_code
    else:
        codes = [ANTARCTICA_CODE]
        continent = country(ANTARCTICA_CODE).continent_code

    mountain["continent"] = {
        "code": continent,
        "name": reference().continents[continent].name.en,
    }
    mountain["countries"] = [
        {"code": served.code, "name": served.name.en} for served in countries(*codes)
    ]
