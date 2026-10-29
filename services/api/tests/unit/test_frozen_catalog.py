import copy
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.frozen_catalog import (
    COORDINATE_TOLERANCE_DEGREES,
    compare_with_frozen_catalog,
    parse_frozen_catalog,
)
from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CameraFraming,
    Coordinates,
    MountainStatus,
    OsmReference,
    OsmType,
)
from serendipeak.catalog.errors import InvalidFrozenCatalog
from tests.support.catalog import (
    catalog_mountain,
    committed_seed,
    frozen_catalog,
    frozen_mountain,
    mountain,
    primary_image,
)
from tests.support.contract_fixtures import load_fixture


def test_draft_is_not_a_public_status():
    assert PUBLIC_STATUSES == {MountainStatus.ACTIVE, MountainStatus.INACTIVE}


def test_frozen_catalog_parses_every_mountain():
    frozen = frozen_catalog()

    assert len(frozen) == 73
    aconcagua = next(entry for entry in frozen if entry.slug == "aconcagua")
    assert aconcagua.osm == OsmReference(type=OsmType.NODE, id=1504741757)
    assert aconcagua.wikidata_id == "Q39739"
    assert aconcagua.camera.framing == CameraFraming(x=-0.0587, y=0.3857)


@pytest.mark.parametrize(
    "edit",
    [
        lambda document: document.update(version="v2"),
        lambda document: document["mountains"][0]["sources"].update(osm="https://example.org/1"),
        lambda document: document["mountains"][0].pop("camera"),
    ],
)
def test_malformed_frozen_catalogs_are_rejected(edit):
    document = copy.deepcopy(load_fixture("catalog.json"))
    edit(document)

    with pytest.raises(InvalidFrozenCatalog):
        parse_frozen_catalog(document)


def test_committed_seed_matches_the_frozen_catalog():
    comparison = compare_with_frozen_catalog(
        frozen_catalog(), (entry.mountain for entry in committed_seed().mountains)
    )

    assert (comparison.matched, comparison.total, comparison.mismatches) == (73, 73, ())


def compare(actual, expected=None):
    expected = expected or catalog_mountain()
    return compare_with_frozen_catalog([frozen_mountain(expected)], [actual])


def shifted(coordinates, delta):
    return Coordinates(latitude=coordinates.latitude + delta, longitude=coordinates.longitude)


def test_coordinates_within_the_contract_tolerance_match():
    actual = mountain(coordinates=shifted(mountain().coordinates, COORDINATE_TOLERANCE_DEGREES / 2))

    assert compare(actual).mismatches == ()


def test_camera_within_the_contract_tolerance_matches():
    camera = mountain().camera
    actual = mountain(camera=replace(camera, heading_degrees=camera.heading_degrees + 5e-10))

    assert compare(actual).mismatches == ()


@pytest.mark.parametrize(
    ("overrides", "difference"),
    [
        ({"status": MountainStatus.DRAFT}, "status draft is not public"),
        ({"name": "Cerro Aconcagua"}, "name differs"),
        ({"coordinates": shifted(mountain().coordinates, 2e-7)}, "coordinates differ"),
        ({"elevation_meters": 6962}, "elevation differs"),
        ({"camera": None}, "camera differs"),
        ({"camera": replace(mountain().camera, range_meters=17132.000001)}, "camera differs"),
        ({"camera": replace(mountain().camera, framing=None)}, "camera differs"),
        ({"osm": OsmReference(type=OsmType.WAY, id=1504741757)}, "OpenStreetMap"),
        ({"wikidata_id": "Q1"}, "Wikidata id differs"),
        ({"primary_image": None}, "primary image identity differs"),
        ({"primary_image": primary_image(dimensions=None)}, "primary image identity differs"),
    ],
)
def test_differences_from_the_frozen_catalog_are_reported(overrides, difference):
    comparison = compare(mountain(**overrides))

    assert comparison.matched == 0
    assert len(comparison.mismatches) == 1
    assert comparison.mismatches[0].startswith("aconcagua: ")
    assert difference in comparison.mismatches[0]


def test_inactive_mountains_still_match():
    assert compare(mountain(status=MountainStatus.INACTIVE)).mismatches == ()


def test_missing_and_unexpected_public_mountains_are_reported():
    comparison = compare_with_frozen_catalog(
        [frozen_mountain(catalog_mountain("aconcagua"))],
        [mountain("mont-blanc"), mountain("draft-peak", status=MountainStatus.DRAFT)],
    )

    assert comparison.mismatches == (
        "aconcagua: missing from the catalog",
        "mont-blanc: public mountain not in the frozen catalog",
    )
