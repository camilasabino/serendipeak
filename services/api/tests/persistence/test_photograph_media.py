import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    catalog_mountain,
    catalog_seed,
    committed_seed,
    photograph_media,
    primary_image,
)
from tests.support.records import image_record, insert_error, mountain_record

DIGEST = "5d" * 32
MEDIA = {
    "original_key": f"photographs/{DIGEST}/original.jpg",
    "original_sha256": DIGEST,
    "page_key": f"photographs/{DIGEST}/page-r1.jpg",
    "viewer_key": f"photographs/{DIGEST}/viewer-r1.jpg",
    "width": 4994,
    "height": 2758,
}
REJECTED_MEDIA = [
    ("mountain_image_media_complete", {"page_key": None}),
    ("mountain_image_media_complete", {"original_sha256": None}),
    ("mountain_image_original_key_format", {"original_key": "originals/photo.jpg"}),
    ("mountain_image_original_key_format", {"original_key": f"photographs/{DIGEST}/../x.jpg"}),
    ("mountain_image_original_sha256_format", {"original_sha256": DIGEST.upper()}),
    ("mountain_image_original_sha256_format", {"original_sha256": f"{DIGEST}\n"}),
    ("mountain_image_page_key_format", {"page_key": f"/photographs/{DIGEST}/page-r1.jpg"}),
    ("mountain_image_viewer_key_format", {"viewer_key": f"photographs/{DIGEST}/Viewer.jpg"}),
    ("mountain_image_media_has_dimensions", {"width": None, "height": None}),
]


@pytest.fixture
def mountain(db):
    record = mountain_record()
    record.save()
    return record


@pytest.mark.parametrize(("constraint", "overrides"), REJECTED_MEDIA)
def test_rejects_invalid_photograph_media(mountain, constraint, overrides):
    error = insert_error(image_record(mountain, **{**MEDIA, **overrides}))

    assert error.constraint_name == constraint


def test_accepts_complete_photograph_media(mountain):
    image_record(mountain, **MEDIA).save(force_insert=True)


def test_two_images_may_share_the_same_photograph(mountain, db):
    other = mountain_record(slug="other-peak", name="Other Peak", osm_id=1, wikidata_id="Q1")
    other.save()

    image_record(mountain, **MEDIA).save(force_insert=True)
    image_record(other, **MEDIA).save(force_insert=True)


@pytest.mark.django_db
def test_photograph_media_round_trips_through_the_catalog_store_and_repository():
    media = photograph_media(DIGEST)
    entry = catalog_mountain(primary_image=primary_image(media=media))
    DjangoCatalogStore().load(catalog_seed(entry))

    snapshot = DjangoCatalogStore().snapshot()
    found = DjangoMountainRepository().find_public_by_slug("aconcagua")

    assert snapshot.mountains == (entry,)
    assert found.primary_image.media == media


@pytest.mark.django_db
def test_an_image_without_photograph_media_reads_back_without_it():
    entry = catalog_mountain(status=MountainStatus.ACTIVE)
    DjangoCatalogStore().load(catalog_seed(entry))

    assert DjangoCatalogStore().snapshot().mountains[0].mountain.primary_image.media is None


@pytest.mark.django_db
def test_the_committed_seed_loads_every_image_without_photograph_media():
    DjangoCatalogStore().load(committed_seed())

    images = MountainImageRecord.objects.all()
    assert images.count() == 73
    assert not images.filter(original_key__isnull=False).exists()
    assert not images.filter(original_sha256__isnull=False).exists()
    assert not images.filter(page_key__isnull=False).exists()
    assert not images.filter(viewer_key__isnull=False).exists()
