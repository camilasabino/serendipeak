import datetime
from dataclasses import replace

from serendipeak.catalog.bootstrap.ports import ImageProvenance
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_seed,
    frozen_mountain,
    photograph_media,
    with_mountain,
)
from tests.support.fakes import InMemoryCatalogStore

DAY = datetime.date(2026, 10, 3)
ACONCAGUA = catalog_mountain("aconcagua")
MONT_BLANC = catalog_mountain("mont-blanc")
SEED = catalog_seed(ACONCAGUA, MONT_BLANC, discoveries=[catalog_discovery(DAY, ACONCAGUA)])
FROZEN = [frozen_mountain(ACONCAGUA), frozen_mountain(MONT_BLANC)]


def verify(stored):
    store = InMemoryCatalogStore()
    store.load(stored)
    return VerifyCatalog(store).execute(SEED, FROZEN)


def test_a_catalog_equal_to_the_seed_is_consistent():
    report = verify(SEED)

    assert report.seed_mismatches == ()
    assert report.frozen.mismatches == ()
    assert report.is_consistent


def test_an_empty_catalog_reports_every_seed_row_as_missing():
    report = VerifyCatalog(InMemoryCatalogStore()).execute(SEED, FROZEN)

    assert (report.mountains, report.images, report.discoveries) == (0, 0, 0)
    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) is missing",
        f"mountain mont-blanc ({MONT_BLANC.mountain.id}) is missing",
        "daily discovery 2026-10-03 is missing",
    )
    assert report.frozen.matched == 0
    assert not report.is_consistent


def test_differing_fields_are_named():
    changed = replace(
        with_mountain(ACONCAGUA, summary="Changed.", countries=("Argentina", "Chile")),
        image_provenance=ImageProvenance("Public domain", None, None),
    )

    report = verify(catalog_seed(changed, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) differs in"
        " countries, summary, image_provenance",
    )
    assert report.frozen.mismatches == ()


def test_materialized_media_is_not_compared_with_the_seed():
    image = ACONCAGUA.mountain.primary_image
    materialized = with_mountain(ACONCAGUA, primary_image=replace(image, media=photograph_media()))

    report = verify(catalog_seed(materialized, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.is_consistent


def test_other_image_differences_are_still_reported_next_to_media():
    image = replace(ACONCAGUA.mountain.primary_image, media=photograph_media(), creator="Other")
    changed = with_mountain(ACONCAGUA, primary_image=image)

    report = verify(catalog_seed(changed, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) differs in primary_image",
    )


def test_rows_that_are_not_in_the_seed_are_reported():
    extra = catalog_mountain("monte-rosa")
    stored = catalog_seed(
        ACONCAGUA,
        MONT_BLANC,
        extra,
        discoveries=[
            catalog_discovery(DAY, ACONCAGUA),
            catalog_discovery(DAY + datetime.timedelta(days=1), extra),
        ],
    )

    report = verify(stored)

    assert report.seed_mismatches == (
        f"mountain monte-rosa ({extra.mountain.id}) is not in the seed",
        "daily discovery 2026-10-04 is not in the seed",
    )
    assert report.frozen.mismatches == ("monte-rosa: public mountain not in the frozen catalog",)


def test_a_discovery_of_another_mountain_is_reported():
    stored = catalog_seed(ACONCAGUA, MONT_BLANC, discoveries=[catalog_discovery(DAY, MONT_BLANC)])

    assert verify(stored).seed_mismatches == ("daily discovery 2026-10-03 differs from the seed",)
