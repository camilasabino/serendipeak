import uuid
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.ports import AttachOutcome
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
from tests.support.catalog import (
    catalog_mountain,
    catalog_seed,
    photograph_media,
    seeded_mountain,
    with_mountain,
)
from tests.support.fakes import InMemoryCatalogStore

FUJI = seeded_mountain("fuji")
IMAGE = FUJI.mountain.primary_image
FILE_URL = FUJI.image_provenance.legacy_file_url
ATTACHED = with_mountain(
    catalog_mountain("aconcagua"),
    primary_image=replace(IMAGE, media=photograph_media("a" * 64)),
)
BARE = catalog_mountain("bare-peak", primary_image=None)
MEDIA = photograph_media("b" * 64)


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    seed = catalog_seed(FUJI, ATTACHED, BARE)
    if request.param == "in-memory":
        store = InMemoryCatalogStore()
        store.load(seed)
        return store, store

    request.getfixturevalue("db")
    store = DjangoCatalogStore()
    store.load(seed)

    return DjangoPhotographMediaWriter(), store


def media_of(store, entry):
    by_id = {item.mountain.id: item.mountain for item in store.snapshot().mountains}
    return by_id[entry.mountain.id].primary_image.media


def attach(writer, entry, media=MEDIA, url=None, dimensions=None):
    image = entry.mountain.primary_image
    return writer.attach_media(
        entry.mountain.id,
        url or entry.image_provenance.legacy_file_url,
        dimensions or image.dimensions,
        media,
    )


def test_media_is_attached_to_a_photograph_without_media(arranged):
    writer, store = arranged

    assert attach(writer, FUJI) is AttachOutcome.APPLIED
    assert media_of(store, FUJI) == MEDIA


def test_attaching_the_same_media_again_is_already_attached(arranged):
    writer, store = arranged
    attach(writer, FUJI)

    assert attach(writer, FUJI) is AttachOutcome.ALREADY_ATTACHED
    assert media_of(store, FUJI) == MEDIA


def test_other_media_is_never_replaced(arranged):
    writer, store = arranged

    assert attach(writer, ATTACHED) is AttachOutcome.STALE
    assert media_of(store, ATTACHED) == photograph_media("a" * 64)


@pytest.mark.parametrize(
    "expected",
    [
        {"url": "https://upload.wikimedia.org/wikipedia/commons/other.jpg"},
        {"dimensions": ImageDimensions(width=1, height=1)},
    ],
)
def test_a_photograph_that_differs_from_the_verified_one_is_stale(arranged, expected):
    writer, store = arranged

    assert attach(writer, FUJI, **expected) is AttachOutcome.STALE
    assert media_of(store, FUJI) is None


def test_a_missing_mountain_or_photograph_is_not_found(arranged):
    writer, _ = arranged

    assert (
        writer.attach_media(uuid.uuid4(), FILE_URL, IMAGE.dimensions, MEDIA)
        is AttachOutcome.NOT_FOUND
    )
    assert (
        writer.attach_media(BARE.mountain.id, FILE_URL, IMAGE.dimensions, MEDIA)
        is AttachOutcome.NOT_FOUND
    )
