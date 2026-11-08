import datetime

import pytest

from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    MountainStatus,
)
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    primary_image,
)
from tests.support.fakes import InMemoryCatalogStore

DAY = datetime.date(2026, 10, 3)
ACONCAGUA = catalog_mountain("aconcagua")
UNSOURCED = catalog_mountain(
    "unsourced-peak",
    primary_image=primary_image(source_page_url=None, license_name=None, license_url=None),
)
MONT_BLANC = catalog_mountain(
    "mont-blanc", primary_image=primary_image(dimensions=None, media=None)
)
MONTA = catalog_mountain("monta")
SPARSE_DRAFT = catalog_mountain(
    "draft-peak",
    status=MountainStatus.DRAFT,
    coordinates=Coordinates(latitude=90.0, longitude=-180.0),
    region=None,
    countries=(),
    summary=None,
    camera=None,
    primary_image=None,
    osm_node_id=None,
    wikidata_id=None,
)
INACTIVE_UNFRAMED = catalog_mountain(
    "old-peak",
    status=MountainStatus.INACTIVE,
    camera=CanonicalCamera(
        heading_degrees=0.0, pitch_degrees=15.0, range_meters=80000.0, framing=None
    ),
)


@pytest.fixture(params=["in-memory", "django"])
def store(request):
    if request.param == "in-memory":
        return InMemoryCatalogStore()
    request.getfixturevalue("db")
    return DjangoCatalogStore()


def test_a_new_store_holds_no_catalog(store):
    assert store.snapshot() == CatalogSnapshot(mountains=(), discoveries=())


def test_load_preserves_every_row_and_orders_the_snapshot(store):
    later = DAY + datetime.timedelta(days=1)
    catalog = catalog_of(
        MONTA,
        SPARSE_DRAFT,
        INACTIVE_UNFRAMED,
        MONT_BLANC,
        ACONCAGUA,
        UNSOURCED,
        discoveries=[catalog_discovery(later, MONTA), catalog_discovery(DAY, ACONCAGUA)],
    )

    store.load(catalog)

    snapshot = store.snapshot()
    assert [entry.mountain.slug for entry in snapshot.mountains] == [
        "aconcagua",
        "draft-peak",
        "mont-blanc",
        "monta",
        "old-peak",
        "unsourced-peak",
    ]
    assert set(snapshot.mountains) == set(catalog.mountains)
    assert snapshot.discoveries == (
        catalog_discovery(DAY, ACONCAGUA),
        catalog_discovery(later, MONTA),
    )


def test_load_round_trips_a_full_catalog(store):
    catalog = fixture_catalog()

    store.load(catalog)

    snapshot = store.snapshot()
    assert snapshot.mountains == catalog.mountains
    assert snapshot.discoveries == catalog.discoveries


def test_float_values_round_trip_exactly(store):
    entry = catalog_mountain(
        "precise-peak",
        coordinates=Coordinates(latitude=-32.6531487, longitude=-70.0119607),
        camera=CanonicalCamera(
            heading_degrees=359.99999999999994,
            pitch_degrees=-19.85,
            range_meters=17132.0,
            framing=CameraFraming(x=-0.0587, y=1e-7),
        ),
    )

    store.load(catalog_of(entry))

    assert store.snapshot().mountains == (entry,)


@pytest.mark.parametrize(
    "catalog",
    [
        catalog_of(ACONCAGUA),
        catalog_of(catalog_mountain("mont-blanc", id=ACONCAGUA.mountain.id)),
        catalog_of(catalog_mountain("aconcagua", id=MONTA.mountain.id)),
        catalog_of(MONT_BLANC, discoveries=[catalog_discovery(DAY, MONT_BLANC)]),
        catalog_of(
            MONT_BLANC,
            discoveries=[catalog_discovery(DAY + datetime.timedelta(days=1), MONT_BLANC)],
        ),
    ],
    ids=["same-rows", "same-id", "same-slug", "same-discovery-date", "disjoint-rows"],
)
def test_load_refuses_any_non_empty_store_and_changes_nothing(store, catalog):
    store.load(catalog_of(ACONCAGUA, discoveries=[catalog_discovery(DAY, ACONCAGUA)]))
    before = store.snapshot()

    with pytest.raises(CatalogAlreadyPopulated):
        store.load(catalog)

    assert store.snapshot() == before
