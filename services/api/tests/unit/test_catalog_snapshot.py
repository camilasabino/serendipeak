import copy
import json
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.catalog_snapshot import (
    SNAPSHOT_FORMAT,
    SNAPSHOT_FORMAT_VERSION,
    catalog_from_snapshot_content,
    in_document_order,
    snapshot_document,
    summarize_catalog,
    verified_snapshot_content,
)
from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.canonical_json import content_sha256
from serendipeak.catalog.errors import InvalidCatalogSnapshot
from tests.support.geography import reference
from tests.support.snapshots import varied_catalog


def sealed(content, version=SNAPSHOT_FORMAT_VERSION):
    return {
        "format": SNAPSHOT_FORMAT,
        "version": version,
        "content_sha256": content_sha256(content),
        "content": content,
    }


def parsed(content):
    return catalog_from_snapshot_content(content, reference())


def content_of(catalog=None):
    return copy.deepcopy(snapshot_document(catalog or varied_catalog())["content"])


def test_a_catalog_reads_back_as_itself_after_a_trip_through_json_text():
    catalog = varied_catalog()
    document = snapshot_document(catalog)

    text = json.dumps(document, indent=2, ensure_ascii=False)
    reread = json.loads(text)
    content = verified_snapshot_content(reread, document["content_sha256"])

    assert parsed(content) == in_document_order(catalog)


def test_the_document_does_not_depend_on_the_order_the_catalog_lists_things_in():
    catalog = varied_catalog()
    shuffled = CatalogSnapshot(
        mountains=tuple(reversed(catalog.mountains)),
        discoveries=tuple(reversed(catalog.discoveries)),
        regions=tuple(reversed(catalog.regions)),
    )

    assert snapshot_document(shuffled) == snapshot_document(catalog)


def test_the_document_holds_no_reference_data_and_names_a_region_by_its_slug():
    content = content_of()
    tall = next(raw for raw in content["mountains"] if raw["slug"] == "tall-peak")

    assert tall["continent"] == "SA"
    assert tall["countries"] == ["AR", "CL"]
    assert tall["region"] == "test-range"
    assert {region["slug"]: region["parent"] for region in content["regions"]} == {
        "test-chain": None,
        "test-range": "test-chain",
    }
    assert "Argentina" not in json.dumps(content)


def test_the_summary_counts_what_the_catalog_holds():
    summary = summarize_catalog(varied_catalog())

    assert summary.mountains == 4
    assert dict(summary.by_status) == {"active": 2, "draft": 1, "inactive": 1}
    assert dict(summary.by_continent) == {"EU": 1, "SA": 3}
    assert summary.country_links == 4
    assert summary.mountains_in_a_region == 3
    assert summary.regions == 2
    assert (summary.photographs, summary.photographs_with_media) == (3, 2)
    assert summary.daily_discoveries == 2


def test_the_checksum_must_be_the_one_expected():
    document = snapshot_document(varied_catalog())

    assert verified_snapshot_content(document, document["content_sha256"]) == document["content"]
    with pytest.raises(InvalidCatalogSnapshot, match="not the expected"):
        verified_snapshot_content(document, "0" * 64)


def test_an_altered_content_is_refused_even_with_its_old_checksum():
    document = snapshot_document(varied_catalog())
    checksum = document["content_sha256"]
    document["content"]["mountains"][0]["elevation_meters"] += 1

    with pytest.raises(InvalidCatalogSnapshot, match="does not match the content"):
        verified_snapshot_content(document, checksum)


@pytest.mark.parametrize("expected", ["", "ABC", "0" * 63, None])
def test_the_expected_checksum_must_be_a_lowercase_digest(expected):
    with pytest.raises(InvalidCatalogSnapshot, match="expected checksum"):
        verified_snapshot_content(snapshot_document(varied_catalog()), expected)


@pytest.mark.parametrize(
    "change",
    [
        {"format": "serendipeak.geography"},
        {"version": 0},
        {"version": 3},
        {"version": "2"},
        {"extra": 1},
    ],
)
def test_another_format_or_version_or_extra_member_is_refused(change):
    document = snapshot_document(varied_catalog())
    document.update(change)

    with pytest.raises(InvalidCatalogSnapshot):
        verified_snapshot_content(document, document["content_sha256"])


@pytest.mark.parametrize("document", [None, [], "text", 1])
def test_a_document_that_is_not_an_object_is_refused(document):
    with pytest.raises(InvalidCatalogSnapshot, match="must be an object"):
        verified_snapshot_content(document, "0" * 64)


def mutate(path_to, change):
    content = content_of()
    change(path_to(content))

    return content


@pytest.mark.parametrize(
    ("description", "mutation", "message"),
    [
        (
            "unknown continent",
            lambda content: content["mountains"][0].update(continent="XX"),
            "continent 'XX' is not in the reference",
        ),
        (
            "unknown country",
            lambda content: content["mountains"][0].update(countries=["AR", "ZZ"]),
            r"countries \['ZZ'\] are not in the reference",
        ),
        (
            "repeated country",
            lambda content: content["mountains"][0].update(countries=["AR", "AR"]),
            "repeat a code",
        ),
        (
            "unknown region",
            lambda content: content["mountains"][0].update(region="nowhere"),
            "unknown region 'nowhere'",
        ),
        (
            "unknown status",
            lambda content: content["mountains"][0].update(status="archived"),
            "unknown status",
        ),
        (
            "invalid slug",
            lambda content: content["mountains"][0].update(slug="Not A Slug"),
            "not a valid slug",
        ),
        (
            "reserved slug",
            lambda content: content["mountains"][0].update(slug="today"),
            "not a valid slug",
        ),
        (
            "coordinates out of range",
            lambda content: content["mountains"][0].update(latitude=91.0),
            "out of range",
        ),
        (
            "non-finite number",
            lambda content: content["mountains"][0].update(longitude=float("nan")),
            "finite number",
        ),
        (
            "float elevation",
            lambda content: content["mountains"][0].update(elevation_meters=10.5),
            "must be an integer",
        ),
        (
            "boolean elevation",
            lambda content: content["mountains"][0].update(elevation_meters=True),
            "must be an integer",
        ),
        (
            "naive timestamp",
            lambda content: content["mountains"][0].update(created_at="2026-10-02T02:55:52"),
            "no UTC offset",
        ),
        (
            "malformed timestamp",
            lambda content: content["mountains"][0].update(updated_at="yesterday"),
            "not an ISO timestamp",
        ),
        (
            "malformed id",
            lambda content: content["mountains"][0].update(id="nope"),
            "not a UUID",
        ),
        (
            "malformed Wikidata id",
            lambda content: content["mountains"][0].update(wikidata_id="39739"),
            "not a Wikidata id",
        ),
        (
            "extra mountain member",
            lambda content: content["mountains"][0].update(prominence_meters=1),
            "unexpected keys",
        ),
        (
            "missing mountain member",
            lambda content: content["mountains"][0].pop("camera"),
            "missing keys",
        ),
        (
            "missing description member",
            lambda content: content["mountains"][0].pop("description"),
            "missing keys",
        ),
        (
            "description that is not a text object",
            lambda content: content["mountains"][0].update(description="Plain."),
            "must be an object",
        ),
        (
            "description without English",
            lambda content: content["mountains"][0].update(
                description={"en": None, "es": "Hola.", "pt": None}
            ),
            "must be a string",
        ),
        (
            "duplicate mountain slug",
            lambda content: content["mountains"][1].update(slug=content["mountains"][0]["slug"]),
            "slugs are not unique",
        ),
        (
            "duplicate mountain id",
            lambda content: content["mountains"][1].update(id=content["mountains"][0]["id"]),
            "ids are not unique",
        ),
        (
            "discovery of an unknown mountain",
            lambda content: content["daily_discoveries"][0].update(
                mountain_id="00000000-0000-0000-0000-000000000000"
            ),
            "references unknown mountain",
        ),
        (
            "duplicate discovery date",
            lambda content: content["daily_discoveries"][1].update(
                date=content["daily_discoveries"][0]["date"]
            ),
            "dates are not unique",
        ),
        (
            "region with an unknown parent",
            lambda content: content["regions"][0].update(parent="nowhere"),
            "unknown parent",
        ),
        (
            "regions that loop",
            lambda content: content["regions"][0].update(parent=content["regions"][1]["slug"]),
            "form a cycle",
        ),
        (
            "duplicate region slug",
            lambda content: content["regions"][1].update(slug=content["regions"][0]["slug"]),
            "slugs are not unique",
        ),
        (
            "malformed region Wikidata id",
            lambda content: content["regions"][0].update(wikidata_id="Q0x"),
            "not a Wikidata id",
        ),
        (
            "text that is not an object",
            lambda content: content["mountains"][0].update(name="Tall Peak"),
            "must be an object",
        ),
        (
            "mountains that are not a list",
            lambda content: content.update(mountains={}),
            "must be a list",
        ),
    ],
)
def test_a_content_the_catalog_could_not_hold_is_refused(description, mutation, message):
    content = content_of()
    mutation(content)

    with pytest.raises(InvalidCatalogSnapshot, match=message):
        parsed(content)


def test_a_region_that_is_its_own_parent_is_refused():
    content = content_of()
    content["regions"][0]["parent"] = content["regions"][0]["slug"]

    with pytest.raises(InvalidCatalogSnapshot, match="form a cycle"):
        parsed(content)


def test_an_empty_catalog_is_a_valid_snapshot():
    empty = CatalogSnapshot(mountains=(), discoveries=(), regions=())

    assert parsed(snapshot_document(empty)["content"]) == empty


def test_a_photograph_keeps_every_member_it_has():
    catalog = varied_catalog()
    pending = next(e for e in catalog.mountains if e.mountain.slug == "pending-peak")
    bare = replace(
        pending.mountain.primary_image,
        media=None,
        dimensions=None,
        license_name=None,
        license_url=None,
        source_page_url=None,
    )
    changed = replace(
        catalog,
        mountains=tuple(
            replace(e, mountain=replace(e.mountain, primary_image=bare)) if e is pending else e
            for e in catalog.mountains
        ),
    )

    assert parsed(snapshot_document(changed)["content"]) == in_document_order(changed)


def test_the_document_is_the_current_version_and_carries_every_description():
    document = snapshot_document(varied_catalog())
    mountains = {raw["slug"]: raw for raw in document["content"]["mountains"]}

    assert document["version"] == SNAPSHOT_FORMAT_VERSION == 2
    assert mountains["tall-peak"]["description"] == {
        "en": "The first paragraph.\n\nThe second, with a soft\nbreak.",
        "es": "El primer p\u00e1rrafo.\n\nEl segundo.",
        "pt": None,
    }
    assert mountains["draft-peak"]["description"] is None
    assert set(raw["description"] is None for raw in mountains.values()) == {True, False}


def test_the_paragraph_breaks_of_a_description_survive_a_trip_through_json_text():
    catalog = varied_catalog()
    document = snapshot_document(catalog)

    reread = json.loads(json.dumps(document, ensure_ascii=False))
    content = verified_snapshot_content(reread, document["content_sha256"])
    tall = next(e for e in parsed(content).mountains if e.mountain.slug == "tall-peak")

    assert tall.mountain.description.en == "The first paragraph.\n\nThe second, with a soft\nbreak."
    assert parsed(content) == in_document_order(catalog)


def legacy_document(catalog=None):
    """A document as the exporter wrote it before the description existed."""
    content = content_of(catalog)
    for raw in content["mountains"]:
        del raw["description"]

    return sealed(content, version=1)


def test_a_version_one_snapshot_is_still_readable_and_has_no_descriptions():
    catalog = varied_catalog()
    document = legacy_document(catalog)

    content = verified_snapshot_content(document, document["content_sha256"])
    catalog_read = parsed(content)

    assert all(entry.mountain.description is None for entry in catalog_read.mountains)
    assert catalog_read == in_document_order(
        replace(
            catalog,
            mountains=tuple(
                with_description(entry, None) for entry in in_document_order(catalog).mountains
            ),
        )
    )


def with_description(entry, description):
    return replace(entry, mountain=replace(entry.mountain, description=description))


def test_the_checksum_of_a_version_one_snapshot_is_judged_on_its_own_content():
    document = legacy_document()

    with pytest.raises(InvalidCatalogSnapshot, match="not the expected"):
        verified_snapshot_content(document, "0" * 64)

    document["content"]["mountains"][0]["elevation_meters"] += 1
    with pytest.raises(InvalidCatalogSnapshot, match="does not match the content"):
        verified_snapshot_content(document, document["content_sha256"])


def test_a_version_one_snapshot_with_a_description_is_refused():
    content = content_of()
    document = sealed(content, version=1)

    with pytest.raises(InvalidCatalogSnapshot, match="unexpected keys"):
        verified_snapshot_content(document, document["content_sha256"])


def test_a_version_two_snapshot_without_the_description_member_is_refused():
    document = legacy_document()
    document["version"] = 2

    with pytest.raises(InvalidCatalogSnapshot, match="missing keys"):
        parsed(verified_snapshot_content(document, document["content_sha256"]))
