import copy
import json
import uuid
from pathlib import Path

import pytest

from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestDifference,
    ManifestPhotograph,
    PhotographManifest,
    manifest_differences,
    parse_photograph_manifest,
    photograph_manifest_document,
)
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import InvalidPhotographManifest
from tests.support.catalog import committed_seed, load_seed_document

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "seed" / "legacy-photographs-v1.json"
PHOTOGRAPH = ManifestPhotograph(
    mountain_id=uuid.UUID("5f0b8f0e-6c1f-4f5e-9a51-3a3f0c3b8d11"),
    slug="aconcagua",
    file_url="https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg",
    sha256="a" * 64,
    bytes=4_120_000,
    dimensions=ImageDimensions(width=4994, height=2758),
)
DOCUMENT = photograph_manifest_document(PhotographManifest([PHOTOGRAPH]))


def committed_manifest():
    return parse_photograph_manifest(json.loads(MANIFEST_PATH.read_text(encoding="utf-8")))


def test_a_document_round_trips():
    assert DOCUMENT["format"] == "serendipeak.legacy-photographs"
    assert DOCUMENT["format_version"] == 1
    assert parse_photograph_manifest(DOCUMENT).photographs == (PHOTOGRAPH,)


def test_photographs_are_looked_up_by_mountain_id():
    manifest = parse_photograph_manifest(DOCUMENT)

    assert manifest.pin_for(PHOTOGRAPH.mountain_id) == PHOTOGRAPH
    assert manifest.pin_for(uuid.uuid4()) is None


def change(path, value):
    document = copy.deepcopy(DOCUMENT)
    target = document
    for key in path[:-1]:
        target = target[key]
    if value is KeyError:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return document


@pytest.mark.parametrize(
    "document",
    [
        [],
        change(["format"], "serendipeak.legacy-catalog"),
        change(["format_version"], 2),
        change(["photographs"], "none"),
        change(["photographs", 0, "sha256"], "A" * 64),
        change(["photographs", 0, "sha256"], "a" * 63),
        change(["photographs", 0, "mountain_id"], "not-a-uuid"),
        change(["photographs", 0, "bytes"], 0),
        change(["photographs", 0, "width"], 10.0),
        change(["photographs", 0, "height"], True),
        change(["photographs", 0, "slug"], ""),
        change(["photographs", 0, "file_url"], None),
        change(["photographs", 0, "extra"], "x"),
        change(["photographs", 0, "source_identifier"], "File:Aconcagua2016.jpg"),
        change(["photographs", 0, "file_url"], KeyError),
        change(["photographs"], DOCUMENT["photographs"] * 2),
    ],
)
def test_a_malformed_manifest_is_refused(document):
    with pytest.raises(InvalidPhotographManifest):
        parse_photograph_manifest(document)


def test_the_committed_manifest_pins_every_photograph_of_the_seed():
    manifest = committed_manifest()
    images = {
        entry.mountain.id: entry
        for entry in committed_seed().mountains
        if entry.mountain.primary_image is not None
    }
    raw_images = {raw["slug"]: raw["image"] for raw in load_seed_document()["content"]["mountains"]}

    assert len(manifest.photographs) == 73
    assert {photograph.mountain_id for photograph in manifest.photographs} == set(images)
    for photograph in manifest.photographs:
        entry = images[photograph.mountain_id]
        assert photograph.slug == entry.mountain.slug
        assert photograph.file_url == raw_images[photograph.slug]["url"]
        assert photograph.dimensions == entry.mountain.primary_image.dimensions


def test_the_seed_keeps_the_rights_evidence_that_the_catalog_does_not():
    raw_images = [raw["image"] for raw in load_seed_document()["content"]["mountains"]]

    approved = [image for image in raw_images if image["approved_on"] is not None]

    assert len(approved) == 27
    assert all(image["license_name"] and image["license_url"] for image in raw_images)


def test_the_committed_manifest_is_in_its_canonical_form():
    text = MANIFEST_PATH.read_text(encoding="utf-8")
    manifest = parse_photograph_manifest(json.loads(text))

    canonical = json.dumps(photograph_manifest_document(manifest), indent=2, ensure_ascii=False)
    assert text == canonical + "\n"


def differences(**overrides):
    facts = {
        "sha256": PHOTOGRAPH.sha256,
        "dimensions": PHOTOGRAPH.dimensions,
    }
    facts.update(overrides)

    return manifest_differences(PHOTOGRAPH, **facts)


def test_a_photograph_that_is_the_pinned_one_has_no_difference():
    assert differences() == ()
    assert differences(size=PHOTOGRAPH.bytes) == ()


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"sha256": "b" * 64}, ManifestDifference.CHECKSUM),
        ({"dimensions": ImageDimensions(10, 10)}, ManifestDifference.DIMENSIONS),
        ({"dimensions": None}, ManifestDifference.DIMENSIONS),
        ({"size": 1}, ManifestDifference.SIZE),
    ],
)
def test_each_pinned_fact_is_compared(overrides, expected):
    assert differences(**overrides) == (expected,)


def test_every_difference_is_reported_in_a_fixed_order():
    assert differences(sha256="b" * 64, dimensions=None, size=1) == (
        ManifestDifference.CHECKSUM,
        ManifestDifference.SIZE,
        ManifestDifference.DIMENSIONS,
    )
