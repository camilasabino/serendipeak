from serendipeak.catalog.bootstrap.check_catalog import CatalogViolation, CheckCatalog
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.publication import PublicationViolation
from tests.support.catalog import catalog_mountain, catalog_seed, committed_seed, primary_image
from tests.support.fakes import InMemoryCatalogStore


def check(seed):
    store = InMemoryCatalogStore()
    store.load(seed)
    return CheckCatalog(store).execute()


def test_the_committed_seed_satisfies_every_publication_invariant():
    report = check(committed_seed())

    assert report.checked == 73
    assert report.violations == ()


def test_violations_of_active_mountains_are_reported_in_slug_order():
    report = check(
        catalog_seed(
            catalog_mountain("mont-blanc", primary_image=None),
            catalog_mountain("aconcagua", camera=None, primary_image=primary_image(url="")),
        )
    )

    assert report.checked == 2
    assert report.violations == (
        CatalogViolation("aconcagua", PublicationViolation.CAMERA_MISSING),
        CatalogViolation("aconcagua", PublicationViolation.IMAGE_URL_MISSING),
        CatalogViolation("mont-blanc", PublicationViolation.PRIMARY_IMAGE_MISSING),
    )


def test_draft_and_inactive_mountains_are_not_checked():
    report = check(
        catalog_seed(
            catalog_mountain("draft-peak", status=MountainStatus.DRAFT, primary_image=None),
            catalog_mountain("old-peak", status=MountainStatus.INACTIVE, camera=None),
        )
    )

    assert (report.checked, report.violations) == (0, ())


def test_an_empty_catalog_has_nothing_to_check():
    assert CheckCatalog(InMemoryCatalogStore()).execute().checked == 0
