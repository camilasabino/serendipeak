import copy
import datetime
import uuid
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.catalog_snapshot import snapshot_document
from serendipeak.catalog.bootstrap.export_catalog_snapshot import ExportCatalogSnapshot
from serendipeak.catalog.bootstrap.load_catalog_snapshot import LoadCatalogSnapshot
from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.bootstrap.verify_catalog_snapshot import VerifyCatalogSnapshot
from serendipeak.catalog.canonical_json import content_sha256
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import CatalogAlreadyPopulated, InvalidCatalogSnapshot
from tests.support.fakes import InMemoryCatalogStore, InMemoryGeographyReference
from tests.support.snapshots import DAY, varied_catalog


def stored(catalog):
    store = InMemoryCatalogStore()
    store.load(catalog)

    return store


def exporter(store):
    return ExportCatalogSnapshot(store, InMemoryGeographyReference())


def verifier(store):
    return VerifyCatalogSnapshot(store, InMemoryGeographyReference())


def loader(store):
    return LoadCatalogSnapshot(store, InMemoryGeographyReference(), verifier(store))


class UnreadableReference:
    def read(self):
        raise AssertionError("the reference data was read")


def test_export_is_canonical_and_deterministic():
    first = exporter(stored(varied_catalog())).execute(include_discoveries=True)
    second = exporter(stored(varied_catalog())).execute(include_discoveries=True)

    assert first.document == second.document
    assert first.document == snapshot_document(varied_catalog())
    assert first.summary.mountains == 4
    assert first.excluded_mountains == ()
    assert first.excluded_regions == ()
    assert first.empty_regions == ()


def test_discoveries_are_left_out_unless_asked_for():
    store = stored(varied_catalog())

    without = exporter(store).execute()
    with_them = exporter(store).execute(include_discoveries=True)

    assert without.document["content"]["daily_discoveries"] == []
    assert without.summary.daily_discoveries == 0
    assert len(with_them.document["content"]["daily_discoveries"]) == 2
    assert without.document["content_sha256"] != with_them.document["content_sha256"]


def test_a_mountain_is_left_out_only_by_naming_it_and_the_export_reports_it():
    store = stored(varied_catalog())

    export = exporter(store).execute(exclude_slugs=["pending-peak", "draft-peak"])

    slugs = [raw["slug"] for raw in export.document["content"]["mountains"]]
    assert slugs == ["tall-peak", "unframed-peak"]
    assert export.excluded_mountains == ("draft-peak", "pending-peak")
    assert export.summary.mountains == 2


def test_excluding_a_slug_the_catalog_lacks_stops_the_export():
    with pytest.raises(InvalidCatalogSnapshot, match="no mountain has these slugs: missing-peak"):
        exporter(stored(varied_catalog())).execute(exclude_slugs=["missing-peak"])


def test_excluding_mountains_reports_the_regions_that_are_left_without_mountains():
    store = stored(varied_catalog())

    export = exporter(store).execute(exclude_slugs=["tall-peak", "pending-peak"])

    assert export.empty_regions == ("test-range",)


def test_a_region_is_left_out_by_naming_it_and_the_export_reports_it():
    store = stored(varied_catalog())

    export = exporter(store).execute(
        exclude_slugs=["tall-peak", "pending-peak"], exclude_region_slugs=["test-range"]
    )

    assert [raw["slug"] for raw in export.document["content"]["regions"]] == ["test-chain"]
    assert export.excluded_regions == ("test-range",)
    assert export.empty_regions == ()


def test_a_region_that_a_kept_mountain_is_in_cannot_be_left_out():
    store = stored(varied_catalog())

    with pytest.raises(
        InvalidCatalogSnapshot, match="mountain pending-peak is in the excluded region test-range"
    ):
        exporter(store).execute(exclude_region_slugs=["test-range"])


def test_a_region_whose_parent_is_left_out_cannot_be_kept():
    store = stored(varied_catalog())

    with pytest.raises(
        InvalidCatalogSnapshot, match="region test-range is under the excluded region test-chain"
    ):
        exporter(store).execute(
            exclude_slugs=["tall-peak", "pending-peak", "unframed-peak"],
            exclude_region_slugs=["test-chain"],
        )


def test_excluding_a_region_the_catalog_lacks_stops_the_export():
    with pytest.raises(InvalidCatalogSnapshot, match="no region has these slugs: nowhere"):
        exporter(stored(varied_catalog())).execute(exclude_region_slugs=["nowhere"])


def test_a_discovery_of_an_excluded_mountain_stops_the_export_that_includes_discoveries():
    store = stored(varied_catalog())

    with pytest.raises(InvalidCatalogSnapshot, match="references an excluded mountain"):
        exporter(store).execute(exclude_slugs=["tall-peak"], include_discoveries=True)

    assert exporter(store).execute(exclude_slugs=["tall-peak"]).summary.mountains == 3


def test_export_changes_nothing_in_the_store():
    store = stored(varied_catalog())
    before = store.snapshot()

    exporter(store).execute(exclude_slugs=["draft-peak"], include_discoveries=True)

    assert store.snapshot() == before


def test_a_catalog_the_snapshot_cannot_reproduce_is_never_exported():
    catalog = varied_catalog()
    broken = replace(
        catalog.mountains[0],
        mountain=replace(
            catalog.mountains[0].mountain,
            continent=replace(catalog.mountains[0].mountain.continent, code="XX"),
        ),
    )
    store = stored(replace(catalog, mountains=(broken, *catalog.mountains[1:])))

    with pytest.raises(InvalidCatalogSnapshot, match="continent 'XX'"):
        exporter(store).execute()


def test_load_fills_an_empty_store_and_reports_a_consistent_catalog():
    source = exporter(stored(varied_catalog())).execute(include_discoveries=True)
    target = InMemoryCatalogStore()

    verification = loader(target).execute(source.document, source.document["content_sha256"])

    assert verification.is_consistent
    assert verification.discoveries_compared
    assert verification.stored == source.summary
    assert exporter(target).execute(include_discoveries=True).document == source.document


def test_a_round_trip_keeps_the_checksum():
    first = exporter(stored(varied_catalog())).execute()
    target = InMemoryCatalogStore()
    loader(target).execute(first.document, first.document["content_sha256"])

    second = exporter(target).execute()

    assert second.document["content_sha256"] == first.document["content_sha256"]


def test_load_judges_the_checksum_before_it_reads_anything_else():
    source = exporter(stored(varied_catalog())).execute()
    target = InMemoryCatalogStore()
    unread = LoadCatalogSnapshot(
        target, UnreadableReference(), VerifyCatalogSnapshot(target, UnreadableReference())
    )

    with pytest.raises(InvalidCatalogSnapshot, match="not the expected"):
        unread.execute(source.document, "0" * 64)

    assert target.snapshot() == CatalogSnapshot(mountains=(), discoveries=(), regions=())


def test_load_refuses_a_catalog_that_holds_a_mountain_and_changes_nothing():
    source = exporter(stored(varied_catalog())).execute()
    target = stored(CatalogSnapshot(mountains=varied_catalog().mountains[:1], discoveries=()))
    before = target.snapshot()

    with pytest.raises(CatalogAlreadyPopulated):
        loader(target).execute(source.document, source.document["content_sha256"])

    assert target.snapshot() == before


def test_a_snapshot_with_a_code_the_reference_lacks_loads_nothing():
    source = exporter(stored(varied_catalog())).execute()
    document = copy.deepcopy(source.document)
    document["content"]["mountains"][0]["countries"] = ["ZZ"]
    document["content_sha256"] = content_sha256(document["content"])
    target = InMemoryCatalogStore()

    with pytest.raises(
        InvalidCatalogSnapshot, match="countries \\['ZZ'\\] are not in the reference"
    ):
        loader(target).execute(document, document["content_sha256"])

    assert target.snapshot().mountains == ()


def test_verify_is_clean_for_the_catalog_the_snapshot_describes():
    source = exporter(stored(varied_catalog())).execute(include_discoveries=True)

    verification = verifier(stored(varied_catalog())).execute(
        source.document, source.document["content_sha256"]
    )

    assert verification.mismatches == ()


def test_verify_names_every_difference():
    catalog = varied_catalog()
    source = exporter(stored(catalog)).execute(include_discoveries=True)
    first, second, third, fourth = catalog.mountains
    edited = replace(
        first,
        mountain=replace(first.mountain, elevation_meters=first.mountain.elevation_meters + 1),
        updated_at=first.updated_at + datetime.timedelta(seconds=1),
    )
    extra = replace(
        fourth,
        mountain=replace(fourth.mountain, id=uuid.UUID(int=1), slug="extra-peak"),
    )
    drifted = CatalogSnapshot(
        mountains=(edited, second, extra),
        discoveries=(
            replace(
                catalog.discoveries[0],
                created_at=catalog.discoveries[0].created_at + datetime.timedelta(seconds=5),
            ),
        ),
        regions=tuple(replace(region, wikidata_id="Q1") for region in catalog.regions[:1])
        + catalog.regions[1:],
    )

    verification = verifier(stored(drifted)).execute(
        source.document, source.document["content_sha256"]
    )

    assert not verification.is_consistent
    mismatches = "\n".join(verification.mismatches)
    assert "mountain tall-peak" in mismatches
    assert "differs in elevation_meters, updated_at" in mismatches
    assert "mountain pending-peak" in mismatches and "is missing" in mismatches
    assert "mountain extra-peak" in mismatches and "is not in the snapshot" in mismatches
    assert f"daily discovery {DAY} differs from the snapshot" in mismatches
    assert f"daily discovery {DAY + datetime.timedelta(days=1)} is missing" in mismatches
    assert "differs from the snapshot" in mismatches


def test_verify_compares_discoveries_only_when_the_snapshot_carries_them():
    catalog = varied_catalog()
    without = exporter(stored(catalog)).execute()

    verification = verifier(stored(catalog)).execute(
        without.document, without.document["content_sha256"]
    )

    assert verification.mismatches == ()
    assert not verification.discoveries_compared


def test_verify_sees_a_status_change():
    catalog = varied_catalog()
    source = exporter(stored(catalog)).execute()
    first = catalog.mountains[0]
    deactivated = replace(first, mountain=replace(first.mountain, status=MountainStatus.INACTIVE))
    drifted = replace(catalog, mountains=(deactivated, *catalog.mountains[1:]))

    verification = verifier(stored(drifted)).execute(
        source.document, source.document["content_sha256"]
    )

    assert len(verification.mismatches) == 1
    assert "differs in status" in verification.mismatches[0]
