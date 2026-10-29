import datetime
import json
import os
import uuid

import pytest

from tools.export_legacy_catalog import (
    EXPECTED_LEGACY_COLUMNS,
    LEGACY_SCHEMA_VERSION,
    ExportError,
    build_artifact,
    build_content,
    check_legacy_schema,
    content_sha256,
    parse_media_manifest,
    read_only_snapshot,
    render_artifact,
)

CREATED_AT = datetime.datetime(2026, 10, 2, 2, 55, 52, 889901, tzinfo=datetime.UTC)
MANIFEST = b"""\
media:
  - slug: denali
    commonsFile: MG 4070 (7205909856).jpg
    license:
      reported: Public domain
      elected: CC BY 2.0
      electedUrl: https://creativecommons.org/licenses/by/2.0/
      electionBasisUrl: https://www.flickr.com/photos/denalinps/7205909856/
    creator: Denali National Park and Preserve
    credit: Denali National Park and Preserve
    approvedOn: 2026-10-06
"""


def mountain_row(slug, **overrides):
    return {
        "id": uuid.uuid5(uuid.NAMESPACE_URL, slug),
        "slug": slug,
        "name": slug.title(),
        "latitude": 63.0690765,
        "longitude": -151.0071433,
        "elevation_meters": 6190,
        "prominence_meters": None,
        "range_name": None,
        "countries": ["United States"],
        "summary": None,
        "camera_heading_degrees": 10.5,
        "camera_pitch_degrees": -20.0,
        "camera_range_meters": 30000.0,
        "camera_framing_x": 0.1,
        "camera_framing_y": -0.2,
        "osm_type": "node",
        "osm_id": 1,
        "wikidata_id": "Q130018",
        "wikipedia_url": None,
        "status": "active",
        "created_at": CREATED_AT,
        "updated_at": CREATED_AT,
        **overrides,
    }


def image_row(mountain, file_name, **overrides):
    return {
        "mountain_id": mountain["id"],
        "type": "image",
        "source": "wikimedia_commons",
        "title": file_name.rsplit(".", 1)[0],
        "is_primary": True,
        "source_identifier": f"File:{file_name}",
        "source_page_url": f"https://commons.wikimedia.org/wiki/File:{file_name}",
        "url": "https://upload.wikimedia.org/original.jpg",
        "thumbnail_url": "https://upload.wikimedia.org/thumbnail.jpg",
        "width": 5184,
        "height": 3456,
        "creator": "Denali National Park and Preserve",
        "attribution": "Denali National Park and Preserve",
        "license_name": "CC BY 2.0",
        "license_url": "https://creativecommons.org/licenses/by/2.0/",
        **overrides,
    }


class FakeLegacySchema:
    def __init__(self, migrations=None, columns=None):
        self._migrations = [(LEGACY_SCHEMA_VERSION, False)] if migrations is None else migrations
        self._columns = {
            table: set(names) for table, names in (columns or EXPECTED_LEGACY_COLUMNS).items()
        }

    def schema_migration(self):
        return self._migrations

    def column_names(self, table):
        return self._columns[table]


@pytest.fixture
def denali():
    return mountain_row("denali")


@pytest.fixture
def aconcagua():
    return mountain_row("aconcagua")


@pytest.fixture
def approvals():
    return parse_media_manifest(MANIFEST)


def test_build_content_joins_approval_fields_and_orders_rows(denali, aconcagua, approvals):
    images = [
        image_row(denali, "MG 4070 (7205909856).jpg"),
        image_row(aconcagua, "Aconcagua2016.jpg"),
    ]
    discoveries = [
        {"date": datetime.date(2026, 10, 5), "mountain_id": denali["id"], "created_at": CREATED_AT},
        {"date": datetime.date(2026, 10, 3), "mountain_id": denali["id"], "created_at": CREATED_AT},
    ]

    content = build_content([denali, aconcagua], images, discoveries, approvals)

    assert [mountain["slug"] for mountain in content["mountains"]] == ["aconcagua", "denali"]
    assert [row["date"] for row in content["daily_discoveries"]] == ["2026-10-03", "2026-10-05"]
    assert content["mountains"][0]["image"]["approved_on"] is None
    approved = content["mountains"][1]["image"]
    assert (
        approved["license_reported"],
        approved["license_election_basis_url"],
        approved["approved_on"],
    ) == (
        "Public domain",
        "https://www.flickr.com/photos/denalinps/7205909856/",
        "2026-10-06",
    )
    assert content["mountains"][1]["created_at"] == "2026-10-02T02:55:52.889901Z"
    assert content["daily_discoveries"][0]["mountain_id"] == str(denali["id"])


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"source_identifier": "File:Another.jpg", "title": "Another"}, "source_identifier"),
        ({"license_name": "CC BY-SA 2.0"}, "license_name"),
        ({"attribution": "Someone else"}, "attribution"),
        ({"is_primary": False}, "not a primary Commons image"),
        ({"title": "Edited title"}, "title is not derived"),
    ],
)
def test_build_content_rejects_images_that_disagree(denali, approvals, overrides, message):
    images = [image_row(denali, "MG 4070 (7205909856).jpg", **overrides)]

    with pytest.raises(ExportError, match=message):
        build_content([denali], images, [], approvals)


def test_build_content_rejects_approvals_for_unknown_slugs(aconcagua, approvals):
    with pytest.raises(ExportError, match="unknown slugs"):
        build_content([aconcagua], [image_row(aconcagua, "Aconcagua2016.jpg")], [], approvals)


@pytest.mark.parametrize(
    ("manifest", "message"),
    [
        (MANIFEST.replace(b"media:", b"withdrawn: []\nmedia:"), "only the 'media' list"),
        (MANIFEST + b"    withdrawn: true\n", "unsupported keys"),
        (MANIFEST.replace(b"      elected: CC BY 2.0\n", b""), "incomplete license election"),
        (MANIFEST.replace(b"2026-10-06", b"'2026-10-06'"), "not a date"),
        (MANIFEST + MANIFEST.removeprefix(b"media:\n"), "appears twice"),
    ],
)
def test_parse_media_manifest_rejects_unsupported_entries(manifest, message):
    with pytest.raises(ExportError, match=message):
        parse_media_manifest(manifest)


def test_content_hash_ignores_key_order():
    assert content_sha256({"a": 1, "b": [1.5, "é"]}) == content_sha256({"b": [1.5, "é"], "a": 1})


def test_rendered_artifact_is_reproducible(denali, approvals):
    content = build_content(
        [denali], [image_row(denali, "MG 4070 (7205909856).jpg")], [], approvals
    )
    exported_on = datetime.date(2026, 10, 29)

    first = render_artifact(build_artifact(content, MANIFEST, exported_on))
    second = render_artifact(build_artifact(json.loads(json.dumps(content)), MANIFEST, exported_on))

    assert first == second
    assert first.endswith(b"}\n")
    artifact = json.loads(first)
    assert artifact["content_sha256"] == content_sha256(artifact["content"])
    assert artifact["counts"] == {
        "mountains": 1,
        "mountain_images": 1,
        "media_approvals": 1,
        "daily_discoveries": 0,
    }


def test_snapshot_rejects_writes():
    with (
        pytest.raises(ExportError, match="read-only transaction"),
        read_only_snapshot(os.environ["DATABASE_URL"]) as database,
    ):
        database._connection.execute("CREATE TEMP TABLE export_probe (id integer)")


def test_legacy_schema_check_accepts_the_expected_schema():
    check_legacy_schema(FakeLegacySchema())


def test_legacy_schema_check_rejects_a_dirty_version():
    schema = FakeLegacySchema(migrations=[(LEGACY_SCHEMA_VERSION, True)])

    with pytest.raises(ExportError, match="not at clean version"):
        check_legacy_schema(schema)


def test_legacy_schema_check_rejects_an_unexpected_column():
    columns = {
        **EXPECTED_LEGACY_COLUMNS,
        "mountains": {*EXPECTED_LEGACY_COLUMNS["mountains"], "rating"},
    }

    with pytest.raises(ExportError, match=r"mountains: unexpected columns \['rating'\]"):
        check_legacy_schema(FakeLegacySchema(columns=columns))


def test_legacy_schema_check_rejects_a_missing_column():
    columns = {
        **EXPECTED_LEGACY_COLUMNS,
        "mountain_media": EXPECTED_LEGACY_COLUMNS["mountain_media"] - {"license_url"},
    }

    with pytest.raises(ExportError, match=r"mountain_media: .*missing columns \['license_url'\]"):
        check_legacy_schema(FakeLegacySchema(columns=columns))
