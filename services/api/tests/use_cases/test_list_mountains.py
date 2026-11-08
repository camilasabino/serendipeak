from dataclasses import replace

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.list_mountains import SEARCH_MAX_LENGTH, ListMountains
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.publication import PublicationViolation
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainCatalogReader

MONT_BLANC = mountain(
    "mont-blanc",
    name=LocalizedText(en="Mont Blanc", es="Montblanc", pt="Monte Branco"),
)
MONCH = mountain("monch", name="Mönch")
OLD_PEAK = mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None)
READY_DRAFT = mountain("ready-draft", status=MountainStatus.DRAFT)
CATALOG = (OLD_PEAK, MONT_BLANC, DRAFT, MONCH, READY_DRAFT)


def list_mountains(**criteria):
    return ListMountains(InMemoryMountainCatalogReader(CATALOG)).execute(**criteria)


def slugs(listing):
    return [entry.mountain.slug for entry in listing.entries]


def test_lists_every_mountain_by_english_name_then_slug():
    assert slugs(list_mountains()) == [
        "draft-peak",
        "monch",
        "mont-blanc",
        "old-peak",
        "ready-draft",
    ]


def test_counts_each_status_and_the_total():
    listing = list_mountains()

    assert listing.counts == {
        MountainStatus.DRAFT: 2,
        MountainStatus.ACTIVE: 2,
        MountainStatus.INACTIVE: 1,
    }
    assert listing.total == 5


@pytest.mark.parametrize("status", list(MountainStatus))
def test_a_status_filter_keeps_only_that_status_but_not_the_counts(status):
    listing = list_mountains(status=status)

    assert {entry.mountain.status for entry in listing.entries} == {status}
    assert listing.total == 5


@pytest.mark.parametrize(
    ("search", "expected"),
    [
        ("blanc", ["mont-blanc"]),
        ("BLANC", ["mont-blanc"]),
        ("  blanc  ", ["mont-blanc"]),
        ("monte branco", ["mont-blanc"]),
        ("montblanc", ["mont-blanc"]),
        ("monch", ["monch"]),
        ("mönch", ["monch"]),
        ("old-p", ["old-peak"]),
        ("peak", ["draft-peak", "old-peak"]),
        ("no such mountain", []),
    ],
)
def test_search_matches_a_name_in_any_language_or_the_slug_ignoring_case_and_accents(
    search, expected
):
    assert slugs(list_mountains(search=search)) == expected


def test_counts_follow_the_search_so_a_chip_agrees_with_its_rows():
    listing = list_mountains(search="peak")

    assert listing.counts == {
        MountainStatus.DRAFT: 1,
        MountainStatus.ACTIVE: 0,
        MountainStatus.INACTIVE: 1,
    }
    assert listing.total == 2


def test_only_drafts_are_judged_for_readiness():
    entries = {entry.mountain.slug: entry for entry in list_mountains().entries}

    assert entries["draft-peak"].violations == (
        PublicationViolation.CAMERA_MISSING,
        PublicationViolation.PRIMARY_IMAGE_MISSING,
    )
    assert entries["ready-draft"].violations == ()
    assert entries["old-peak"].violations == ()


def test_a_public_mountain_that_breaks_a_rule_is_not_judged_in_the_list():
    broken = replace(OLD_PEAK, camera=None)

    listing = ListMountains(InMemoryMountainCatalogReader([broken])).execute()

    assert listing.entries[0].violations == ()


def test_an_empty_catalog_lists_nothing():
    listing = ListMountains(InMemoryMountainCatalogReader()).execute()

    assert listing.entries == ()
    assert listing.total == 0


def test_an_oversized_search_is_cut_instead_of_scanned():
    listing = list_mountains(search="blanc" + "x" * SEARCH_MAX_LENGTH)

    assert listing.entries == ()
