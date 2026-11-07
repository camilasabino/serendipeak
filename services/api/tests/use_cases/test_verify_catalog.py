import datetime
from dataclasses import replace

from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.catalog.localization import LocalizedText
from tests.support.catalog import (
    catalog_discovery,
    catalog_seed,
    frozen_mountain,
    photograph_media,
    seeded_mountain,
    split_seed,
    with_mountain,
)
from tests.support.fakes import InMemoryCatalogStore, InMemoryGeographyReference
from tests.support.geography import continent, countries

DAY = datetime.date(2026, 10, 3)
ACONCAGUA = seeded_mountain("aconcagua")
MONT_BLANC = seeded_mountain("mont-blanc")
SEED = catalog_seed(ACONCAGUA, MONT_BLANC, discoveries=[catalog_discovery(DAY, ACONCAGUA)])
FROZEN = [frozen_mountain(ACONCAGUA), frozen_mountain(MONT_BLANC)]
PARSED_SEED, GEOGRAPHY = split_seed(SEED)


def verifier(store):
    return VerifyCatalog(store, InMemoryGeographyReference())


def verify(stored, geography=GEOGRAPHY):
    store = InMemoryCatalogStore()
    store.load(stored)
    return verifier(store).execute(PARSED_SEED, FROZEN, geography)


def test_a_catalog_equal_to_the_seed_is_consistent():
    report = verify(SEED)

    assert report.seed_mismatches == ()
    assert report.frozen.mismatches == ()
    assert report.geography_compared
    assert report.is_consistent


def test_an_empty_catalog_reports_every_seed_row_as_missing():
    report = verifier(InMemoryCatalogStore()).execute(PARSED_SEED, FROZEN, GEOGRAPHY)

    assert (report.mountains, report.images, report.discoveries) == (0, 0, 0)
    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) is missing",
        f"mountain mont-blanc ({MONT_BLANC.mountain.id}) is missing",
        "daily discovery 2026-10-03 is missing",
    )
    assert report.frozen.matched == 0
    assert not report.is_consistent


def test_differing_fields_are_named():
    changed = with_mountain(
        ACONCAGUA,
        summary=LocalizedText(en="Changed."),
        continent=continent("NA"),
        countries=countries("AR", "CL"),
    )

    report = verify(catalog_seed(changed, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) differs in continent, countries, summary",
    )
    assert report.frozen.mismatches == ()


def test_continents_and_countries_are_left_out_when_there_is_no_geography_input():
    changed = with_mountain(
        ACONCAGUA,
        summary=LocalizedText(en="Changed."),
        continent=continent("NA"),
        countries=countries("AR", "CL"),
    )

    report = verify(catalog_seed(changed, MONT_BLANC, discoveries=SEED.discoveries), None)

    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) differs in summary",
    )
    assert not report.geography_compared


def test_a_catalog_equal_to_the_seed_is_consistent_without_a_geography_input():
    report = verify(SEED, None)

    assert (report.is_consistent, report.geography_compared) == (True, False)


def test_materialized_media_is_not_compared_with_the_seed():
    image = ACONCAGUA.mountain.primary_image
    materialized = with_mountain(ACONCAGUA, primary_image=replace(image, media=photograph_media()))

    report = verify(catalog_seed(materialized, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.is_consistent


def test_other_image_differences_are_still_reported_next_to_media():
    image = replace(ACONCAGUA.mountain.primary_image, media=photograph_media(), author="Other")
    changed = with_mountain(ACONCAGUA, primary_image=image)

    report = verify(catalog_seed(changed, MONT_BLANC, discoveries=SEED.discoveries))

    assert report.seed_mismatches == (
        f"mountain aconcagua ({ACONCAGUA.mountain.id}) differs in primary_image",
    )


def test_rows_that_are_not_in_the_seed_are_reported():
    extra = seeded_mountain("monte-rosa")
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
