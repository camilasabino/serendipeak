import hashlib
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.check_photograph_media import (
    CheckPhotographMedia,
    MediaProblem,
)
from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestPhotograph,
    PhotographManifest,
)
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.errors import InfrastructureError
from tests.support.catalog import (
    catalog_mountain,
    catalog_seed,
    photograph_media,
    seeded_mountain,
    with_file_url,
    with_mountain,
)
from tests.support.fakes import FakeMediaStore, InMemoryCatalogStore

ORIGINAL = b"original bytes"
DIGEST = hashlib.sha256(ORIGINAL).hexdigest()


def with_media(slug, media):
    entry = catalog_mountain(slug)
    return with_mountain(entry, primary_image=replace(entry.mountain.primary_image, media=media))


ATTACHED = with_media("aconcagua", photograph_media(DIGEST))
UNATTACHED = seeded_mountain("fuji")
BARE = catalog_mountain("bare-peak", primary_image=None)


def pin(entry, sha256=DIGEST, **overrides):
    image = entry.mountain.primary_image
    fields = {
        "mountain_id": entry.mountain.id,
        "slug": entry.mountain.slug,
        "source_identifier": image.source_identifier,
        "file_url": entry.image_provenance.legacy_file_url,
        "sha256": sha256,
        "bytes": len(ORIGINAL),
        "dimensions": image.dimensions,
    }
    fields.update(overrides)

    return ManifestPhotograph(**fields)


class Arrangement:
    def __init__(self, *entries, pinned=None):
        self.catalog = InMemoryCatalogStore()
        self.catalog.load(catalog_seed(*entries))
        self.media_store = FakeMediaStore()
        if pinned is None:
            pinned = [pin(entry) for entry in entries if entry.mountain.primary_image]
        self.use_case = CheckPhotographMedia(
            self.catalog, self.media_store, PhotographManifest(pinned)
        )

    def store_all(self, original=ORIGINAL):
        media = photograph_media(DIGEST)
        self.media_store.put_original(media.original_key, original, "image/jpeg")
        self.media_store.put_public(media.page_key, b"page", "image/jpeg")
        self.media_store.put_public(media.viewer_key, b"viewer", "image/jpeg")
        self.media_store.calls.clear()


def test_the_shallow_check_reads_only_the_catalog():
    arranged = Arrangement(ATTACHED, UNATTACHED, BARE)

    report = arranged.use_case.execute()

    assert report.checked == 2
    assert report.problems == (MediaProblem("fuji", "no media"),)
    assert arranged.media_store.calls == []


def test_media_keys_must_be_derived_from_the_checksum():
    foreign = replace(photograph_media(DIGEST), viewer_key=keys.viewer_key("f" * 64))
    arranged = Arrangement(with_media("aconcagua", foreign))

    report = arranged.use_case.execute()

    assert report.problems == (
        MediaProblem("aconcagua", "the media keys do not match the original checksum"),
    )


@pytest.mark.parametrize(
    ("page", "viewer"),
    [
        (keys.page_keys(DIGEST)[0], keys.viewer_keys(DIGEST)[0]),
        (keys.page_key(DIGEST), keys.viewer_key(DIGEST)),
    ],
)
def test_the_renditions_of_every_published_version_match_the_checksum(page, viewer):
    media = replace(photograph_media(DIGEST), page_key=page, viewer_key=viewer)

    assert Arrangement(with_media("aconcagua", media)).use_case.execute().problems == ()


def test_renditions_of_different_versions_do_not_match_the_checksum():
    mixed = replace(
        photograph_media(DIGEST),
        page_key=keys.page_keys(DIGEST)[0],
        viewer_key=keys.viewer_keys(DIGEST)[1],
    )

    report = Arrangement(with_media("aconcagua", mixed)).use_case.execute()

    assert report.problems == (
        MediaProblem("aconcagua", "the media keys do not match the original checksum"),
    )


def test_a_rendition_of_an_unknown_version_does_not_match_the_checksum():
    unknown = replace(photograph_media(DIGEST), page_key=f"photographs/{DIGEST}/page-r9.jpg")

    report = Arrangement(with_media("aconcagua", unknown)).use_case.execute()

    assert report.problems == (
        MediaProblem("aconcagua", "the media keys do not match the original checksum"),
    )


def test_a_png_original_key_matches_its_checksum():
    media = replace(
        photograph_media(DIGEST), original_key=keys.original_key(DIGEST, PhotographFormat.PNG)
    )

    assert Arrangement(with_media("aconcagua", media)).use_case.execute().problems == ()


def test_the_deep_check_reports_every_missing_object():
    arranged = Arrangement(ATTACHED)

    report = arranged.use_case.execute(deep=True)

    assert [problem.problem for problem in report.problems] == [
        "the original is missing",
        "the page rendition is missing",
        "the viewer rendition is missing",
    ]


def test_the_deep_check_passes_when_every_object_exists_without_reading_any():
    arranged = Arrangement(ATTACHED)
    arranged.store_all()

    report = arranged.use_case.execute(deep=True)

    assert report.problems == ()
    assert all(operation.startswith("has_") for operation, _ in arranged.media_store.calls)


def test_the_checksum_check_rehashes_every_original():
    arranged = Arrangement(ATTACHED)
    arranged.store_all(original=b"another file")

    report = arranged.use_case.execute(checksums=True)

    assert report.problems == (
        MediaProblem("aconcagua", "the original does not match its checksum"),
    )


def test_the_checksum_check_implies_the_deep_check():
    arranged = Arrangement(ATTACHED)

    report = arranged.use_case.execute(checksums=True)

    assert len(report.problems) == 3
    assert ("read_original", photograph_media(DIGEST).original_key) not in (
        arranged.media_store.calls
    )


def test_a_clean_checksum_check_reports_no_problem():
    arranged = Arrangement(ATTACHED)
    arranged.store_all()

    assert arranged.use_case.execute(deep=True, checksums=True).problems == ()


def test_a_storage_failure_stops_the_check():
    arranged = Arrangement(ATTACHED)
    arranged.media_store.failing = True

    with pytest.raises(InfrastructureError):
        arranged.use_case.execute(deep=True)


def test_media_that_is_the_pinned_one_passes_the_manifest():
    assert Arrangement(ATTACHED).use_case.execute().problems == ()


def test_media_of_another_file_than_the_pinned_one_is_reported_even_when_it_is_consistent():
    pinned = pin(ATTACHED, sha256=hashlib.sha256(b"the file the manifest pinned").hexdigest())
    arranged = Arrangement(ATTACHED, pinned=[pinned])
    arranged.store_all()

    report = arranged.use_case.execute(deep=True, checksums=True)

    assert report.problems == (
        MediaProblem("aconcagua", "the stored original is not the one in the manifest"),
    )


@pytest.mark.parametrize(
    ("overrides", "problem"),
    [
        ({"file_url": "https://example.com/other.jpg"}, "the manifest pins another file URL"),
        ({"source_identifier": "File:Other.jpg"}, "the manifest pins another source identifier"),
        ({"dimensions": ImageDimensions(10, 10)}, "the manifest pins other dimensions"),
    ],
)
def test_a_photograph_that_is_not_the_pinned_one_is_reported(overrides, problem):
    arranged = Arrangement(ATTACHED, pinned=[pin(ATTACHED, **overrides)])

    assert arranged.use_case.execute().problems == (MediaProblem("aconcagua", problem),)


def test_every_difference_from_the_manifest_is_reported():
    pinned = pin(ATTACHED, file_url="https://example.com/x.jpg", sha256="b" * 64)

    report = Arrangement(ATTACHED, pinned=[pinned]).use_case.execute()

    assert [problem.problem for problem in report.problems] == [
        "the manifest pins another file URL",
        "the stored original is not the one in the manifest",
    ]


def test_a_pinned_photograph_missing_from_the_catalog_is_reported():
    gone = pin(catalog_mountain("k2"))

    report = Arrangement(ATTACHED, pinned=[pin(ATTACHED), gone]).use_case.execute()

    assert report.checked == 1
    assert report.problems == (MediaProblem("k2", "the manifest photograph is not in the catalog"),)


def test_a_pinned_mountain_without_a_photograph_is_reported():
    report = Arrangement(BARE, pinned=[pin(catalog_mountain("bare-peak"))]).use_case.execute()

    assert report.problems == (
        MediaProblem("bare-peak", "the manifest photograph is not in the catalog"),
    )


def test_a_pinned_photograph_without_media_is_reported_once():
    arranged = Arrangement(UNATTACHED)

    assert arranged.use_case.execute().problems == (MediaProblem("fuji", "no media"),)


def test_a_photograph_outside_the_manifest_is_compared_with_nothing_but_still_checked():
    other = with_media("fuji", photograph_media("c" * 64))
    arranged = Arrangement(ATTACHED, other, pinned=[pin(ATTACHED)])

    assert arranged.use_case.execute().problems == ()
    assert [problem.slug for problem in arranged.use_case.execute(deep=True).problems] == [
        "aconcagua",
        "aconcagua",
        "aconcagua",
        "fuji",
        "fuji",
        "fuji",
    ]


def test_an_uploaded_replacement_of_a_pinned_photograph_is_checked_but_not_against_its_pin():
    replaced = with_file_url(
        with_mountain(
            ATTACHED,
            primary_image=replace(
                ATTACHED.mountain.primary_image,
                media=photograph_media("c" * 64),
                dimensions=ImageDimensions(4000, 3000),
                source_identifier=None,
            ),
        ),
        None,
    )
    arranged = Arrangement(replaced, pinned=[pin(ATTACHED)])

    assert arranged.use_case.execute().problems == ()
    assert arranged.use_case.execute(deep=True).problems == (
        MediaProblem("aconcagua", "the original is missing"),
        MediaProblem("aconcagua", "the page rendition is missing"),
        MediaProblem("aconcagua", "the viewer rendition is missing"),
    )
