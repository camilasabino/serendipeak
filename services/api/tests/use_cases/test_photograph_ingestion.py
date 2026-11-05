import hashlib

import pytest

from serendipeak.catalog.entities import ImageDimensions, PhotographMedia
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import PhotographFormat, ProcessedPhotograph
from serendipeak.errors import InfrastructureError
from tests.support.fakes import FakeMediaStore, FakePhotographProcessor

ORIGINAL = b"original photograph bytes"
DIGEST = hashlib.sha256(ORIGINAL).hexdigest()
ORIGINAL_KEY = f"photographs/{DIGEST}/original.png"
PAGE_KEY = f"photographs/{DIGEST}/page-r1.jpg"
VIEWER_KEY = f"photographs/{DIGEST}/viewer-r1.jpg"
PROCESSED = ProcessedPhotograph(
    format=PhotographFormat.PNG,
    dimensions=ImageDimensions(width=4000, height=3000),
    page_jpeg=b"page rendition",
    viewer_jpeg=b"viewer rendition",
)


def ingestion(store=None, processor=None, max_bytes=1024):
    return PhotographIngestion(
        processor or FakePhotographProcessor(PROCESSED),
        store or FakeMediaStore(),
        IngestionLimits(max_bytes=max_bytes),
    )


def test_prepare_checksums_the_original_bytes_and_derives_the_keys():
    prepared = ingestion().prepare(ORIGINAL)

    assert prepared.original_sha256 == DIGEST
    assert prepared.dimensions == ImageDimensions(width=4000, height=3000)
    assert (prepared.original.key, prepared.original.data, prepared.original.content_type) == (
        ORIGINAL_KEY,
        ORIGINAL,
        "image/png",
    )
    assert (prepared.page.key, prepared.page.data, prepared.page.content_type) == (
        PAGE_KEY,
        b"page rendition",
        "image/jpeg",
    )
    assert (prepared.viewer.key, prepared.viewer.data, prepared.viewer.content_type) == (
        VIEWER_KEY,
        b"viewer rendition",
        "image/jpeg",
    )
    assert prepared.media == PhotographMedia(
        original_key=ORIGINAL_KEY,
        original_sha256=DIGEST,
        page_key=PAGE_KEY,
        viewer_key=VIEWER_KEY,
    )


def test_prepare_never_touches_the_store():
    store = FakeMediaStore()

    ingestion(store).prepare(ORIGINAL)

    assert store.calls == []


def test_the_same_bytes_always_prepare_the_same_media():
    assert ingestion().prepare(ORIGINAL).media == ingestion().prepare(ORIGINAL).media


def test_bytes_over_the_limit_are_rejected_before_processing():
    processor = FakePhotographProcessor(PROCESSED)

    with pytest.raises(PhotographRejected) as rejected:
        ingestion(processor=processor, max_bytes=len(ORIGINAL) - 1).prepare(ORIGINAL)

    assert rejected.value.reason is PhotographRejection.TOO_MANY_BYTES
    assert processor.processed == []


def test_bytes_at_the_limit_are_processed():
    prepared = ingestion(max_bytes=len(ORIGINAL)).prepare(ORIGINAL)

    assert prepared.original_sha256 == DIGEST


def test_a_rejected_photograph_stores_nothing():
    store = FakeMediaStore()
    processor = FakePhotographProcessor(rejection=PhotographRejection.CORRUPT)

    with pytest.raises(PhotographRejected) as rejected:
        ingestion(store, processor).prepare(ORIGINAL)

    assert rejected.value.reason is PhotographRejection.CORRUPT
    assert store.calls == []


def test_store_writes_the_original_first_then_the_page_and_viewer_renditions():
    store = FakeMediaStore()
    photographs = ingestion(store)

    media = photographs.store(photographs.prepare(ORIGINAL))

    assert media.original_key == ORIGINAL_KEY
    assert [call for call in store.calls if call[0].startswith("put")] == [
        ("put_original", ORIGINAL_KEY),
        ("put_public", PAGE_KEY),
        ("put_public", VIEWER_KEY),
    ]
    assert store.originals == {ORIGINAL_KEY: (ORIGINAL, "image/png")}
    assert store.public == {
        PAGE_KEY: (b"page rendition", "image/jpeg"),
        VIEWER_KEY: (b"viewer rendition", "image/jpeg"),
    }


def test_store_checks_each_object_before_writing_it():
    store = FakeMediaStore()
    photographs = ingestion(store)

    photographs.store(photographs.prepare(ORIGINAL))

    assert store.calls == [
        ("has_original", ORIGINAL_KEY),
        ("put_original", ORIGINAL_KEY),
        ("has_public", PAGE_KEY),
        ("put_public", PAGE_KEY),
        ("has_public", VIEWER_KEY),
        ("put_public", VIEWER_KEY),
    ]


def test_storing_again_writes_nothing():
    store = FakeMediaStore()
    photographs = ingestion(store)
    prepared = photographs.prepare(ORIGINAL)
    photographs.store(prepared)
    store.calls.clear()

    assert photographs.store(prepared) == prepared.media
    assert [operation for operation, _ in store.calls] == [
        "has_original",
        "has_public",
        "has_public",
    ]


def test_a_retry_after_a_partial_store_writes_only_the_missing_objects():
    store = FakeMediaStore()
    store.originals[ORIGINAL_KEY] = (ORIGINAL, "image/png")
    store.public[PAGE_KEY] = (b"page rendition", "image/jpeg")
    photographs = ingestion(store)

    photographs.store(photographs.prepare(ORIGINAL))

    assert [call for call in store.calls if call[0].startswith("put")] == [
        ("put_public", VIEWER_KEY),
    ]


def test_store_never_replaces_an_existing_object():
    store = FakeMediaStore()
    store.public[PAGE_KEY] = (b"earlier page rendition", "image/jpeg")
    photographs = ingestion(store)

    photographs.store(photographs.prepare(ORIGINAL))

    assert store.public[PAGE_KEY] == (b"earlier page rendition", "image/jpeg")


def test_a_storage_failure_propagates_as_an_infrastructure_error():
    store = FakeMediaStore()
    photographs = ingestion(store)
    prepared = photographs.prepare(ORIGINAL)
    store.failing = True

    with pytest.raises(InfrastructureError):
        photographs.store(prepared)
