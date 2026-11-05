import hashlib
from dataclasses import replace

import pytest

from serendipeak.catalog.bootstrap.materialize_photographs import (
    MaterializationOutcome,
    MaterializePhotographs,
)
from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestPhotograph,
    PhotographManifest,
)
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection, UnknownPhotographs
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.errors import InfrastructureError
from tests.support.catalog import (
    catalog_mountain,
    catalog_seed,
    photograph_media,
    primary_image,
    with_mountain,
)
from tests.support.fakes import (
    FakeMediaStore,
    FakeSourceImageFetcher,
    InMemoryCatalogStore,
    SyntheticPhotographProcessor,
)

ACONCAGUA_URL = "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg"
FUJI_URL = "https://upload.wikimedia.org/wikipedia/commons/1/1b/Fuji.jpg"
ACONCAGUA = catalog_mountain(
    "aconcagua",
    primary_image=primary_image(url=ACONCAGUA_URL, dimensions=ImageDimensions(4994, 2758)),
)
FUJI = catalog_mountain(
    "fuji",
    primary_image=primary_image(url=FUJI_URL, dimensions=ImageDimensions(3000, 2000)),
)
BARE = catalog_mountain("bare-peak", primary_image=None)
ACONCAGUA_FILE = b"4994x2758:aconcagua"
FUJI_FILE = b"3000x2000:fuji"
FILES = {ACONCAGUA_URL: ACONCAGUA_FILE, FUJI_URL: FUJI_FILE}


KNOWN = (ACONCAGUA, FUJI)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def stored_keys(data):
    digest = sha256(data)
    return {
        keys.original_key(digest, PhotographFormat.JPEG),
        keys.page_key(digest),
        keys.viewer_key(digest),
    }


class Arrangement:
    def __init__(self, *entries, fetcher=None):
        self.catalog = InMemoryCatalogStore()
        self.catalog.load(catalog_seed(*entries))
        self.fetcher = fetcher or FakeSourceImageFetcher(FILES)
        self.media_store = FakeMediaStore()
        self.writer = self.catalog
        self.manifest = manifest_for(
            *(
                (entry, FILES[entry.mountain.primary_image.url])
                for entry in entries
                if entry in KNOWN
            )
        )
        self.use_case = MaterializePhotographs(
            self.catalog,
            self.fetcher,
            PhotographIngestion(
                SyntheticPhotographProcessor(),
                self.media_store,
                IngestionLimits(max_bytes=1000),
            ),
            self,
        )

    def attach_media(self, *arguments):
        return self.writer.attach_media(*arguments)

    def run(self, **options):
        options.setdefault("manifest", self.manifest)
        return self.use_case.execute(**options)

    def stored(self):
        return set(self.media_store.originals) | set(self.media_store.public)

    def outcomes(self, report):
        return {result.slug: result.outcome for result in report.results}


def manifest_for(*pairs):
    return PhotographManifest(
        ManifestPhotograph(
            mountain_id=entry.mountain.id,
            slug=entry.mountain.slug,
            source_identifier=entry.mountain.primary_image.source_identifier,
            file_url=entry.mountain.primary_image.url,
            sha256=sha256(data),
            bytes=len(data),
            dimensions=entry.mountain.primary_image.dimensions,
        )
        for entry, data in pairs
    )


def test_every_photograph_without_media_is_stored_and_attached():
    arranged = Arrangement(ACONCAGUA, FUJI, BARE)

    report = arranged.run()

    assert arranged.outcomes(report) == {
        "aconcagua": MaterializationOutcome.MATERIALIZED,
        "fuji": MaterializationOutcome.MATERIALIZED,
    }
    assert arranged.stored() == stored_keys(ACONCAGUA_FILE) | stored_keys(FUJI_FILE)
    media = arranged.catalog.media_of(ACONCAGUA.mountain.id)
    assert media.original_sha256 == sha256(ACONCAGUA_FILE)
    assert media.viewer_key == keys.viewer_key(sha256(ACONCAGUA_FILE))
    assert report.results[0].source.bytes == len(ACONCAGUA_FILE)
    assert report.failed == ()


def test_a_rerun_skips_attached_photographs_without_downloading_or_storing():
    arranged = Arrangement(ACONCAGUA, FUJI)
    arranged.run()
    arranged.fetcher.fetched.clear()
    arranged.media_store.calls.clear()

    report = arranged.run()

    assert set(arranged.outcomes(report).values()) == {MaterializationOutcome.ALREADY_ATTACHED}
    assert arranged.fetcher.fetched == []
    assert arranged.media_store.calls == []


def test_a_dry_run_verifies_every_file_but_stores_and_attaches_nothing():
    arranged = Arrangement(ACONCAGUA, FUJI)

    report = arranged.run(dry_run=True)

    assert set(arranged.outcomes(report).values()) == {MaterializationOutcome.VERIFIED}
    assert arranged.fetcher.fetched == [ACONCAGUA_URL, FUJI_URL]
    assert arranged.media_store.calls == []
    assert arranged.catalog.media_of(ACONCAGUA.mountain.id) is None


def test_a_failed_download_is_reported_and_the_run_continues():
    fetcher = FakeSourceImageFetcher(
        FILES, failures={ACONCAGUA_URL: InfrastructureError("the source answered HTTP 404")}
    )
    arranged = Arrangement(ACONCAGUA, FUJI, fetcher=fetcher)

    report = arranged.run()

    assert arranged.outcomes(report) == {
        "aconcagua": MaterializationOutcome.FAILED,
        "fuji": MaterializationOutcome.MATERIALIZED,
    }
    assert report.failed[0].detail == "download failed: the source answered HTTP 404"
    assert arranged.stored() == stored_keys(FUJI_FILE)
    assert arranged.catalog.media_of(ACONCAGUA.mountain.id) is None


def test_a_download_over_the_limit_is_reported():
    fetcher = FakeSourceImageFetcher(
        FILES, failures={FUJI_URL: PhotographRejected(PhotographRejection.TOO_MANY_BYTES)}
    )
    arranged = Arrangement(FUJI, fetcher=fetcher)

    report = arranged.run()

    assert report.failed[0].detail == "download refused: too_many_bytes"
    assert arranged.stored() == set()


def test_content_that_is_not_a_photograph_is_rejected_and_nothing_is_stored():
    arranged = Arrangement(FUJI, fetcher=FakeSourceImageFetcher({FUJI_URL: b"<html>"}))

    report = arranged.run()

    assert report.failed[0].detail == "file rejected: not_an_image"
    assert arranged.stored() == set()


def test_a_file_with_other_dimensions_is_rejected_and_nothing_is_stored():
    arranged = Arrangement(FUJI, fetcher=FakeSourceImageFetcher({FUJI_URL: b"3000x2001:fuji"}))

    report = arranged.run()

    assert report.failed[0].detail == (
        "dimensions_differ: the file is 3000x2001, the photograph is 3000x2000"
    )
    assert arranged.stored() == set()
    assert arranged.catalog.media_of(FUJI.mountain.id) is None


def test_a_partial_upload_attaches_nothing_and_a_rerun_uploads_only_what_is_missing():
    arranged = Arrangement(FUJI)
    viewer = keys.viewer_key(sha256(FUJI_FILE))
    arranged.media_store.failing_keys = {viewer}

    first = arranged.run()

    assert first.failed[0].detail == f"storage failed: storing {viewer} failed"
    assert arranged.stored() == stored_keys(FUJI_FILE) - {viewer}
    assert arranged.catalog.media_of(FUJI.mountain.id) is None

    arranged.media_store.failing_keys = set()
    arranged.media_store.calls.clear()
    second = arranged.run()

    assert arranged.outcomes(second) == {"fuji": MaterializationOutcome.MATERIALIZED}
    puts = [call for call in arranged.media_store.calls if call[0].startswith("put")]
    assert puts == [("put_public", viewer)]
    assert arranged.catalog.media_of(FUJI.mountain.id).viewer_key == viewer


def test_a_photograph_changed_during_the_run_is_stale_and_left_alone():
    arranged = Arrangement(FUJI)
    changed = with_mountain(
        FUJI,
        primary_image=replace(FUJI.mountain.primary_image, url="https://example.com/other.jpg"),
    )

    class ChangingFetcher(FakeSourceImageFetcher):
        def fetch(self, url):
            arranged.catalog.replace(changed)
            return super().fetch(url)

    arranged.use_case._fetcher = ChangingFetcher(FILES)

    report = arranged.run()

    assert report.failed[0].detail == ("stored but not attached: the photograph changed meanwhile")
    assert arranged.stored() == stored_keys(FUJI_FILE)
    assert arranged.catalog.media_of(FUJI.mountain.id) is None


def test_a_failed_attachment_leaves_the_stored_objects_for_a_rerun():
    arranged = Arrangement(FUJI)

    class FailingWriter:
        def attach_media(self, *arguments):
            raise InfrastructureError("the database operation failed")

    arranged.writer = FailingWriter()
    first = arranged.run()
    arranged.writer = arranged.catalog
    arranged.media_store.calls.clear()
    second = arranged.run()

    assert first.failed[0].detail == "stored but not attached: the database operation failed"
    assert arranged.outcomes(second) == {"fuji": MaterializationOutcome.MATERIALIZED}
    assert [call for call in arranged.media_store.calls if call[0].startswith("put")] == []


def test_a_photograph_attached_concurrently_is_reported_as_already_attached():
    arranged = Arrangement(FUJI)

    class ConcurrentWriter:
        def attach_media(self, mountain_id, url, dimensions, media):
            arranged.catalog.attach_media(mountain_id, url, dimensions, media)
            return arranged.catalog.attach_media(mountain_id, url, dimensions, media)

    arranged.writer = ConcurrentWriter()

    report = arranged.run()

    assert arranged.outcomes(report) == {"fuji": MaterializationOutcome.ALREADY_ATTACHED}


def test_a_file_override_replaces_the_download_and_is_still_checked():
    arranged = Arrangement(ACONCAGUA, FUJI)

    archived = b"3000x2000:archived revision"

    report = arranged.run(
        files={"fuji": archived},
        manifest=manifest_for((ACONCAGUA, ACONCAGUA_FILE), (FUJI, archived)),
    )

    assert arranged.fetcher.fetched == [ACONCAGUA_URL]
    assert arranged.outcomes(report)["fuji"] is MaterializationOutcome.MATERIALIZED
    media = arranged.catalog.media_of(FUJI.mountain.id)
    assert media.original_sha256 == sha256(b"3000x2000:archived revision")

    rejected = Arrangement(FUJI).run(files={"fuji": b"10x10:another photograph"})
    assert rejected.failed[0].detail.startswith("dimensions_differ")


def test_a_slug_subset_materializes_only_those_photographs():
    arranged = Arrangement(ACONCAGUA, FUJI)

    report = arranged.run(slugs=["fuji"])

    assert arranged.outcomes(report) == {"fuji": MaterializationOutcome.MATERIALIZED}
    assert arranged.fetcher.fetched == [FUJI_URL]


@pytest.mark.parametrize(
    "options",
    [
        {"slugs": ["k2"]},
        {"slugs": ["bare-peak"]},
        {"files": {"k2": b"1x1"}},
        {"slugs": ["fuji"], "files": {"aconcagua": b"1x1"}},
    ],
)
def test_slugs_that_name_no_selected_photograph_are_refused_before_any_work(options):
    arranged = Arrangement(ACONCAGUA, FUJI, BARE)

    with pytest.raises(UnknownPhotographs):
        arranged.run(**options)

    assert arranged.fetcher.fetched == []


def test_files_matching_the_manifest_are_materialized():
    arranged = Arrangement(ACONCAGUA, FUJI)

    report = arranged.run(manifest=manifest_for((ACONCAGUA, ACONCAGUA_FILE), (FUJI, FUJI_FILE)))

    assert report.failed == ()


def test_a_file_whose_checksum_differs_from_the_manifest_is_rejected_and_nothing_is_stored():
    arranged = Arrangement(FUJI, fetcher=FakeSourceImageFetcher({FUJI_URL: b"3000x2000:revised"}))

    report = arranged.run(manifest=manifest_for((FUJI, FUJI_FILE)))

    assert report.failed[0].detail == ("checksum_differs: the file is not the one in the manifest")
    assert arranged.stored() == set()


def test_a_photograph_outside_the_manifest_is_not_downloaded():
    arranged = Arrangement(ACONCAGUA, FUJI)

    report = arranged.run(manifest=manifest_for((FUJI, FUJI_FILE)))

    assert report.failed[0].slug == "aconcagua"
    assert report.failed[0].detail == (
        "the manifest has no photograph for this mountain; pass its file"
    )
    assert arranged.fetcher.fetched == [FUJI_URL]
    assert arranged.stored() == stored_keys(FUJI_FILE)


def test_a_photograph_outside_the_manifest_is_materialized_from_an_explicit_file():
    arranged = Arrangement(ACONCAGUA, FUJI)
    pinned = manifest_for((FUJI, FUJI_FILE))

    report = arranged.run(manifest=pinned, files={"aconcagua": ACONCAGUA_FILE})

    assert arranged.outcomes(report) == {
        "aconcagua": MaterializationOutcome.MATERIALIZED,
        "fuji": MaterializationOutcome.MATERIALIZED,
    }
    assert arranged.fetcher.fetched == [FUJI_URL]


def test_an_explicit_file_for_a_photograph_outside_the_manifest_is_still_checked():
    arranged = Arrangement(ACONCAGUA)

    report = arranged.run(manifest=manifest_for(), files={"aconcagua": b"10x10:another"})

    assert report.failed[0].detail.startswith("dimensions_differ")
    assert arranged.stored() == set()


def test_a_photograph_outside_the_manifest_that_already_has_media_is_left_alone():
    attached = with_mountain(
        FUJI,
        primary_image=replace(FUJI.mountain.primary_image, media=photograph_media("a" * 64)),
    )
    arranged = Arrangement(attached)

    report = arranged.run(manifest=manifest_for())

    assert arranged.outcomes(report) == {"fuji": MaterializationOutcome.ALREADY_ATTACHED}


def test_an_empty_manifest_authorizes_no_download():
    arranged = Arrangement(ACONCAGUA, FUJI)

    report = arranged.run(manifest=manifest_for())

    assert len(report.failed) == 2
    assert arranged.fetcher.fetched == []
    assert arranged.stored() == set()


def test_a_file_url_the_manifest_does_not_pin_is_never_fetched():
    typed = replace(FUJI.mountain.primary_image, url="https://internal.example/fuji.jpg")
    arranged = Arrangement(with_mountain(FUJI, primary_image=typed))

    report = arranged.run(manifest=manifest_for((FUJI, FUJI_FILE)))

    assert report.failed[0].detail == "the manifest pins another file URL"
    assert arranged.fetcher.fetched == []
    assert arranged.stored() == set()


def test_a_manifest_pinning_another_source_identifier_is_reported():
    other = replace(FUJI.mountain.primary_image, source_identifier="File:Other.jpg")
    arranged = Arrangement(with_mountain(FUJI, primary_image=other))

    report = arranged.run(manifest=manifest_for((FUJI, FUJI_FILE)))

    assert report.failed[0].detail == "the manifest pins another source identifier"
    assert arranged.stored() == set()


def test_the_file_of_a_pinned_photograph_is_checked_against_the_manifest():
    arranged = Arrangement(FUJI)

    report = arranged.run(
        manifest=manifest_for((FUJI, FUJI_FILE)), files={"fuji": b"3000x2000:another revision"}
    )

    assert report.failed[0].detail.startswith("checksum_differs")
    assert arranged.stored() == set()


def test_attached_media_is_checked_against_the_manifest_without_downloading():
    attached = with_mountain(
        FUJI,
        primary_image=replace(FUJI.mountain.primary_image, media=photograph_media("a" * 64)),
    )
    arranged = Arrangement(attached)

    report = arranged.run(manifest=manifest_for((FUJI, FUJI_FILE)))

    assert report.failed[0].detail.startswith("checksum_differs")
    assert arranged.fetcher.fetched == []


def test_a_complete_run_yields_the_manifest_of_every_photograph():
    arranged = Arrangement(ACONCAGUA, FUJI)

    manifest = arranged.run(dry_run=True).manifest()

    assert (
        manifest.photographs
        == manifest_for((ACONCAGUA, ACONCAGUA_FILE), (FUJI, FUJI_FILE)).photographs
    )


def test_no_manifest_comes_from_a_subset_a_failure_or_a_rerun():
    arranged = Arrangement(ACONCAGUA, FUJI)
    assert arranged.run(slugs=["fuji"]).manifest() is None
    assert arranged.run().manifest() is None

    failing = FakeSourceImageFetcher(FILES, failures={FUJI_URL: InfrastructureError("down")})
    assert Arrangement(ACONCAGUA, FUJI, fetcher=failing).run().manifest() is None


def test_the_report_names_the_largest_source_file():
    report = Arrangement(ACONCAGUA, FUJI).run(dry_run=True)

    assert report.largest_source.slug == "aconcagua"


def test_a_photograph_without_dimensions_cannot_be_verified():
    undimensioned = with_mountain(
        FUJI, primary_image=replace(FUJI.mountain.primary_image, dimensions=None)
    )
    arranged = Arrangement(undimensioned)

    report = arranged.run()

    assert report.failed[0].detail == "the photograph has no dimensions to verify the file against"
    assert arranged.fetcher.fetched == []


def test_a_catalog_without_photographs_reports_nothing():
    assert Arrangement(BARE).run().results == ()
