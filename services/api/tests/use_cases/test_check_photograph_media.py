import hashlib
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.check_photograph_media import (
    CheckPhotographMedia,
    MediaProblem,
)
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.errors import InfrastructureError
from tests.support.catalog import (
    catalog_mountain,
    catalog_of,
    mountain_without_media,
    photograph_media,
    with_mountain,
)
from tests.support.fakes import FakeMediaStore, InMemoryCatalogStore

ORIGINAL = b"original bytes"
DIGEST = hashlib.sha256(ORIGINAL).hexdigest()


def with_media(slug, media):
    entry = catalog_mountain(slug)
    return with_mountain(entry, primary_image=replace(entry.mountain.primary_image, media=media))


ATTACHED = with_media("aconcagua", photograph_media(DIGEST))
UNATTACHED = mountain_without_media("fuji")
BARE = catalog_mountain("bare-peak", primary_image=None)


class Arrangement:
    def __init__(self, *entries):
        self.catalog = InMemoryCatalogStore()
        self.catalog.load(catalog_of(*entries))
        self.media_store = FakeMediaStore()
        self.use_case = CheckPhotographMedia(self.catalog, self.media_store)

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


def test_a_photograph_is_checked_the_same_whoever_uploaded_it():
    arranged = Arrangement(ATTACHED, with_media("fuji", photograph_media("c" * 64)))

    assert arranged.use_case.execute().problems == ()
    assert [problem.slug for problem in arranged.use_case.execute(deep=True).problems] == [
        "aconcagua",
        "aconcagua",
        "aconcagua",
        "fuji",
        "fuji",
        "fuji",
    ]
