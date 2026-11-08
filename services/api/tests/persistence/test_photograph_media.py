import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import (
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    mountain_without_media,
    photograph_media,
    primary_image,
)
from tests.support.records import image_record, insert_error, mountain_record

DIGEST = "5d" * 32
OTHER_DIGEST = "6e" * 32
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
    ("mountain_image_original_key_matches_sha256", {"original_sha256": DIGEST.upper()}),
    ("mountain_image_original_key_matches_sha256", {"original_sha256": f"{DIGEST}\n"}),
    ("mountain_image_original_key_matches_sha256", {"original_sha256": OTHER_DIGEST}),
    ("mountain_image_original_key_matches_sha256", {"original_key": f"photographs/{DIGEST}/x.jpg"}),
    (
        "mountain_image_original_key_matches_sha256",
        {"original_key": f"photographs/{OTHER_DIGEST}/original.jpg"},
    ),
    (
        "mountain_image_page_key_matches_sha256",
        {"page_key": f"photographs/{OTHER_DIGEST}/page-r1.jpg"},
    ),
    ("mountain_image_page_key_matches_sha256", {"page_key": f"photographs/{DIGEST}/page-r3.jpg"}),
    ("mountain_image_page_key_matches_sha256", {"page_key": f"photographs/{DIGEST}/page.jpg"}),
    ("mountain_image_page_key_matches_sha256", {"page_key": f"photographs/{DIGEST}/viewer-r1.jpg"}),
    (
        "mountain_image_viewer_key_matches_sha256",
        {"viewer_key": f"photographs/{DIGEST}/viewer-r3.jpg"},
    ),
    (
        "mountain_image_viewer_key_matches_sha256",
        {"viewer_key": f"photographs/{OTHER_DIGEST}/viewer-r1.jpg"},
    ),
    (
        "mountain_image_viewer_key_matches_sha256",
        {"viewer_key": f"photographs/{DIGEST}/page-r1.jpg"},
    ),
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

    # A malformed viewer key also breaks the shared-version rule, and Postgres reports the
    # first violated constraint by name.
    reported = {constraint, "mountain_image_renditions_share_version"}
    assert error.constraint_name in (reported if "viewer_key" in constraint else {constraint})


def test_accepts_complete_photograph_media(mountain):
    image_record(mountain, **MEDIA).save(force_insert=True)


@pytest.mark.parametrize("photograph_format", list(PhotographFormat))
def test_accepts_the_original_key_of_every_accepted_format(mountain, photograph_format):
    original_key = keys.original_key(DIGEST, photograph_format)

    image_record(mountain, **{**MEDIA, "original_key": original_key}).save(force_insert=True)


@pytest.mark.parametrize(("page", "viewer"), [("r1", "r2"), ("r2", "r1")])
def test_rejects_renditions_of_different_versions(mountain, page, viewer):
    error = insert_error(
        image_record(
            mountain,
            **{
                **MEDIA,
                "page_key": f"photographs/{DIGEST}/page-{page}.jpg",
                "viewer_key": f"photographs/{DIGEST}/viewer-{viewer}.jpg",
            },
        )
    )

    assert error.constraint_name == "mountain_image_renditions_share_version"


@pytest.mark.parametrize("version", keys.RENDITION_VERSIONS)
def test_accepts_the_renditions_of_every_published_version(mountain, version):
    image_record(
        mountain,
        **{
            **MEDIA,
            "page_key": f"photographs/{DIGEST}/page-{version}.jpg",
            "viewer_key": f"photographs/{DIGEST}/viewer-{version}.jpg",
        },
    ).save(force_insert=True)


def test_the_constraints_accept_exactly_the_keys_the_key_builders_derive(mountain):
    image_record(
        mountain,
        **{
            **MEDIA,
            "original_key": keys.original_key(DIGEST, PhotographFormat.JPEG),
            "page_key": keys.page_key(DIGEST),
            "viewer_key": keys.viewer_key(DIGEST),
        },
    ).save(force_insert=True)


def test_two_images_may_share_the_same_photograph(mountain, db):
    other = mountain_record(
        slug="other-peak", name_en="Other Peak", osm_node_id=1, wikidata_id="Q1"
    )
    other.save()

    image_record(mountain, **MEDIA).save(force_insert=True)
    image_record(other, **MEDIA).save(force_insert=True)


@pytest.mark.django_db
def test_photograph_media_round_trips_through_the_catalog_store_and_repository():
    media = photograph_media(DIGEST)
    entry = catalog_mountain(primary_image=primary_image(media=media))
    DjangoCatalogStore().load(catalog_of(entry))

    snapshot = DjangoCatalogStore().snapshot()
    found = DjangoMountainRepository().find_public_by_slug("aconcagua")

    assert snapshot.mountains == (entry,)
    assert found.primary_image.media == media


@pytest.mark.django_db
def test_an_image_without_photograph_media_reads_back_without_it():
    entry = mountain_without_media(status=MountainStatus.ACTIVE)
    DjangoCatalogStore().load(catalog_of(entry))

    assert DjangoCatalogStore().snapshot().mountains[0].mountain.primary_image.media is None


@pytest.mark.django_db
def test_the_committed_seed_loads_every_image_without_photograph_media():
    DjangoCatalogStore().load(fixture_catalog())

    images = MountainImageRecord.objects.all()
    assert images.count() == 73
    assert not images.filter(original_key__isnull=False).exists()
    assert not images.filter(original_sha256__isnull=False).exists()
    assert not images.filter(page_key__isnull=False).exists()
    assert not images.filter(viewer_key__isnull=False).exists()
