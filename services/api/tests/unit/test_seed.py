import copy
import datetime
import uuid

import pytest

from serendipeak.catalog.bootstrap.seed import (
    LEGACY_COMMIT,
    LEGACY_TAG,
    SEED_FORMAT,
    SEED_FORMAT_VERSION,
    content_sha256,
    parse_catalog_seed,
)
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import InvalidCatalogSeed
from tests.support.catalog import load_seed_document

COMMITTED_CONTENT_SHA256 = "92c60b009360aa8df4eee3dde46cc209419dcc78bd2152de0a0a0a355891aefc"


def rehashed(document):
    document["content_sha256"] = content_sha256(document["content"])
    return document


def edited(edit):
    document = copy.deepcopy(load_seed_document())
    edit(document)
    return rehashed(document)


def first_mountain(document):
    return document["content"]["mountains"][0]


def test_committed_seed_metadata_and_hash_match_its_content():
    document = load_seed_document()

    assert (document["format"], document["format_version"]) == (SEED_FORMAT, SEED_FORMAT_VERSION)
    assert (document["source"]["tag"], document["source"]["commit"]) == (LEGACY_TAG, LEGACY_COMMIT)
    assert document["content_sha256"] == COMMITTED_CONTENT_SHA256
    assert content_sha256(document["content"]) == COMMITTED_CONTENT_SHA256
    assert document["counts"] == {
        "mountains": 73,
        "mountain_images": 73,
        "media_approvals": 27,
        "daily_discoveries": 8,
    }


def test_committed_seed_parses_into_the_legacy_catalog():
    document = load_seed_document()

    seed = parse_catalog_seed(document)

    assert len(seed.mountains) == 73
    assert [str(entry.mountain.id) for entry in seed.mountains] == [
        raw["id"] for raw in document["content"]["mountains"]
    ]
    assert all(entry.mountain.status is MountainStatus.ACTIVE for entry in seed.mountains)
    assert all(entry.mountain.primary_image is not None for entry in seed.mountains)
    raw_images = [raw["image"] for raw in document["content"]["mountains"]]
    assert sum(image["approved_on"] is not None for image in raw_images) == 27
    assert [discovery.date.isoformat() for discovery in seed.discoveries] == [
        raw["date"] for raw in document["content"]["daily_discoveries"]
    ]


def test_parsed_values_keep_the_exported_precision():
    raw = first_mountain(load_seed_document())

    entry = parse_catalog_seed(load_seed_document()).mountains[0]

    assert (entry.mountain.coordinates.latitude, entry.mountain.coordinates.longitude) == (
        raw["latitude"],
        raw["longitude"],
    )
    assert entry.mountain.camera.range_meters == raw["camera_range_meters"]
    assert entry.created_at == datetime.datetime(
        2026, 10, 2, 2, 55, 52, 889902, tzinfo=datetime.UTC
    )
    assert entry.mountain.id == uuid.UUID(raw["id"])


def test_the_attribution_of_every_photograph_becomes_its_author():
    document = load_seed_document()

    seed = parse_catalog_seed(document)

    assert [entry.mountain.primary_image.author for entry in seed.mountains] == [
        raw["image"]["attribution"] for raw in document["content"]["mountains"]
    ]


def test_the_seed_thumbnail_is_validated_and_not_kept():
    document = edited(lambda document: first_mountain(document)["image"].update(thumbnail_url=7))

    with pytest.raises(InvalidCatalogSeed, match="thumbnail_url must be a string"):
        parse_catalog_seed(document)


def test_content_hash_ignores_key_order():
    assert content_sha256({"a": 1, "b": [1.5, "é"]}) == content_sha256({"b": [1.5, "é"], "a": 1})


@pytest.mark.parametrize(
    ("legacy_status", "status"),
    [
        ("active", MountainStatus.ACTIVE),
        ("inactive", MountainStatus.INACTIVE),
        ("pending_media", MountainStatus.DRAFT),
    ],
)
def test_legacy_statuses_map_to_catalog_statuses(legacy_status, status):
    document = edited(lambda document: first_mountain(document).update(status=legacy_status))

    assert parse_catalog_seed(document).mountains[0].mountain.status is status


def set_count(document, name, value):
    document["counts"][name] = value


def drop_camera(document):
    first_mountain(document).update(
        camera_heading_degrees=None, camera_pitch_degrees=None, camera_range_meters=None
    )


def duplicate_slug(document):
    mountains = document["content"]["mountains"]
    mountains[1]["slug"] = mountains[0]["slug"]


def orphan_discovery(document):
    document["content"]["daily_discoveries"][0]["mountain_id"] = str(uuid.uuid4())


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda document: document.update(format="other"), "is not serendipeak.legacy-catalog"),
        (lambda document: document.update(format_version=2), "version 1"),
        (lambda document: document["source"].update(commit="0" * 40), "was not exported from"),
        (lambda document: document.update(extra=True), r"unexpected keys \['extra'\]"),
        (lambda document: document["source"].pop("tag"), r"missing keys \['tag'\]"),
        (lambda document: set_count(document, "media_approvals", 26), "counts"),
        (lambda document: first_mountain(document).update(status="draft"), "unknown status"),
        (lambda document: first_mountain(document).update(latitude=90.5), "out of range"),
        (lambda document: first_mountain(document).update(longitude=-180.1), "out of range"),
        (lambda document: first_mountain(document).update(camera_pitch_degrees=None), "camera"),
        (drop_camera, "incomplete camera"),
        (lambda document: first_mountain(document).update(camera_framing_y=None), "camera"),
        (lambda document: first_mountain(document).update(osm_type="area"), "OpenStreetMap"),
        (lambda document: first_mountain(document).update(osm_id=None), "osm_id"),
        (lambda document: first_mountain(document).update(elevation_meters=6961.0), "integer"),
        (lambda document: first_mountain(document).update(elevation_meters=True), "integer"),
        (lambda document: first_mountain(document).update(name=None), "name"),
        (lambda document: first_mountain(document).update(id="not-a-uuid"), "UUID"),
        (
            lambda document: first_mountain(document).update(created_at="2026-10-02T02:55:52"),
            "UTC offset",
        ),
        (lambda document: first_mountain(document)["image"].update(width=None), "dimensions"),
        (lambda document: first_mountain(document)["image"].pop("approved_on"), "approved_on"),
        (lambda document: first_mountain(document)["image"].update(approved_on="soon"), "date"),
        (
            lambda document: first_mountain(document)["image"].update(source_identifier=7),
            "source_identifier must be a string",
        ),
        (
            lambda document: first_mountain(document)["image"].update(creator=7),
            "creator must be a string",
        ),
        (duplicate_slug, "slugs are not unique"),
        (orphan_discovery, "references unknown mountain"),
    ],
)
def test_parser_rejects_an_invalid_seed(edit, message):
    with pytest.raises(InvalidCatalogSeed, match=message):
        parse_catalog_seed(edited(edit))


def test_parser_rejects_content_that_does_not_match_its_hash():
    document = copy.deepcopy(load_seed_document())
    first_mountain(document)["name"] = "Aconcagua!"

    with pytest.raises(InvalidCatalogSeed, match="content_sha256 does not match"):
        parse_catalog_seed(document)


def test_parser_rejects_non_finite_numbers():
    document = copy.deepcopy(load_seed_document())
    first_mountain(document)["latitude"] = float("nan")

    with pytest.raises(InvalidCatalogSeed, match="not canonical JSON"):
        parse_catalog_seed(document)


def test_parser_rejects_a_document_that_is_not_an_object():
    with pytest.raises(InvalidCatalogSeed, match="seed must be an object"):
        parse_catalog_seed([])
