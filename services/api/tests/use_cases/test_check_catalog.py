from serendipeak.catalog.bootstrap.check_catalog import CatalogViolation, CheckCatalog
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.publication import PublicationViolation
from tests.support.catalog import (
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    fixture_catalog_with_media,
    primary_image,
)
from tests.support.fakes import InMemoryCatalogStore


def check(catalog):
    store = InMemoryCatalogStore()
    store.load(catalog)
    return CheckCatalog(store).execute()


def test_the_fixture_catalog_with_media_satisfies_every_publication_invariant():
    report = check(fixture_catalog_with_media())

    assert report.checked == 73
    assert report.violations == ()


def test_the_fixture_catalog_without_media_lacks_it_for_every_photograph():
    report = check(fixture_catalog())

    assert report.checked == 73
    assert {violation.violation for violation in report.violations} == {
        PublicationViolation.IMAGE_MEDIA_MISSING
    }
    assert len(report.violations) == 73


def test_violations_of_active_mountains_are_reported_in_slug_order():
    report = check(
        catalog_of(
            catalog_mountain("mont-blanc", primary_image=None),
            catalog_mountain("aconcagua", camera=None, primary_image=primary_image(media=None)),
        )
    )

    assert report.checked == 2
    assert report.violations == (
        CatalogViolation("aconcagua", PublicationViolation.CAMERA_MISSING),
        CatalogViolation("aconcagua", PublicationViolation.IMAGE_MEDIA_MISSING),
        CatalogViolation("mont-blanc", PublicationViolation.PRIMARY_IMAGE_MISSING),
    )


def test_draft_and_inactive_mountains_are_not_checked():
    report = check(
        catalog_of(
            catalog_mountain("draft-peak", status=MountainStatus.DRAFT, primary_image=None),
            catalog_mountain("old-peak", status=MountainStatus.INACTIVE, camera=None),
        )
    )

    assert (report.checked, report.violations) == (0, ())


def test_an_empty_catalog_has_nothing_to_check():
    assert CheckCatalog(InMemoryCatalogStore()).execute().checked == 0


def test_summaries_over_the_limit_are_listed_for_review_and_are_not_violations():
    report = check(
        catalog_of(
            catalog_mountain("zugspitze", summary=LocalizedText(en="A" * 131)),
            catalog_mountain("aconcagua", summary=LocalizedText(en="A" * 150 + ".")),
            catalog_mountain("mont-blanc", summary=LocalizedText(en="A" * 130)),
            catalog_mountain("old-peak", status=MountainStatus.INACTIVE, summary="A" * 200),
        )
    )

    assert report.violations == ()
    assert report.summaries_over_limit == ("aconcagua", "zugspitze")
