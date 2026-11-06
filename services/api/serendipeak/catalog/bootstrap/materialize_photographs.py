from collections.abc import Collection, Mapping
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestDifference,
    ManifestPhotograph,
    PhotographManifest,
    manifest_differences,
)
from serendipeak.catalog.bootstrap.ports import (
    AttachOutcome,
    CatalogMountain,
    CatalogStore,
    PhotographMediaWriter,
)
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.errors import PhotographRejected, PhotographRejection, UnknownPhotographs
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.catalog.media.ports import SourceImageFetcher
from serendipeak.errors import InfrastructureError


class MaterializationOutcome(StrEnum):
    MATERIALIZED = "materialized"
    VERIFIED = "verified"
    ALREADY_ATTACHED = "already attached"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class SourcePhotograph:
    sha256: str
    bytes: int
    dimensions: ImageDimensions


@dataclass(frozen=True, slots=True)
class PhotographResult:
    mountain_id: UUID
    slug: str
    source_identifier: str | None
    file_url: str | None
    outcome: MaterializationOutcome
    detail: str | None = None
    source: SourcePhotograph | None = None


@dataclass(frozen=True, slots=True)
class MaterializationReport:
    results: tuple[PhotographResult, ...]
    covers_the_catalog: bool

    @property
    def failed(self) -> tuple[PhotographResult, ...]:
        return tuple(
            result for result in self.results if result.outcome is MaterializationOutcome.FAILED
        )

    @property
    def largest_source(self) -> PhotographResult | None:
        prepared = [result for result in self.results if result.source is not None]
        return max(prepared, key=lambda result: result.source.bytes, default=None)

    def manifest(self) -> PhotographManifest | None:
        """The manifest pinning every photograph of the catalog, or None when this run did not
        download and verify all of them."""
        complete = self.covers_the_catalog and all(
            result.source is not None
            and result.outcome
            in (MaterializationOutcome.MATERIALIZED, MaterializationOutcome.VERIFIED)
            for result in self.results
        )
        if not complete:
            return None

        return PhotographManifest(
            ManifestPhotograph(
                mountain_id=result.mountain_id,
                slug=result.slug,
                source_identifier=result.source_identifier,
                file_url=result.file_url,
                sha256=result.source.sha256,
                bytes=result.source.bytes,
                dimensions=result.source.dimensions,
            )
            for result in self.results
        )


class MaterializePhotographs:
    """Copies the source file of every photograph without media into owned storage.

    Each photograph is handled on its own and a failure never stops the run. Nothing is
    stored for a photograph that fails a check, and media is attached only after all its
    objects exist, so a rerun resumes where a failed run stopped.

    The manifest decides what is downloaded: only the pinned file URL of a pinned photograph,
    since a draft's file URL is typed by an editor and the operator's network may reach hosts
    the editor cannot. A photograph the manifest does not pin is materialized only from an
    explicit file. An uploaded photograph already has its media and is left alone.
    """

    def __init__(
        self,
        catalog_store: CatalogStore,
        fetcher: SourceImageFetcher,
        ingestion: PhotographIngestion,
        writer: PhotographMediaWriter,
    ):
        self._catalog_store = catalog_store
        self._fetcher = fetcher
        self._ingestion = ingestion
        self._writer = writer

    def execute(
        self,
        *,
        slugs: Collection[str] | None = None,
        dry_run: bool = False,
        files: Mapping[str, bytes] | None = None,
        manifest: PhotographManifest,
    ) -> MaterializationReport:
        files = files or {}
        photographed = [
            entry
            for entry in self._catalog_store.snapshot().mountains
            if entry.mountain.primary_image is not None
        ]
        known = {entry.mountain.slug for entry in photographed}
        selected_slugs = known if slugs is None else set(slugs)

        unknown = sorted((selected_slugs - known) | (set(files) - selected_slugs))
        if unknown:
            raise UnknownPhotographs(tuple(unknown))

        results = tuple(
            self._materialize(entry, files.get(entry.mountain.slug), dry_run, manifest)
            for entry in photographed
            if entry.mountain.slug in selected_slugs
        )

        return MaterializationReport(results=results, covers_the_catalog=slugs is None)

    def _materialize(
        self,
        entry: CatalogMountain,
        file: bytes | None,
        dry_run: bool,
        manifest: PhotographManifest,
    ) -> PhotographResult:
        mountain = entry.mountain
        image = mountain.primary_image
        file_url = entry.image_provenance.legacy_file_url

        def result(outcome, detail=None, source=None):
            return PhotographResult(
                mountain_id=mountain.id,
                slug=mountain.slug,
                source_identifier=image.source_identifier,
                file_url=file_url,
                outcome=outcome,
                detail=detail,
                source=source,
            )

        def failed(detail, source=None):
            return result(MaterializationOutcome.FAILED, detail, source)

        pinned = manifest.pin_for(mountain.id, file_url)

        if image.media is not None:
            if pinned is not None:
                difference = _first_difference(
                    pinned, entry, image.media.original_sha256, image.dimensions, None
                )
                if difference:
                    return failed(difference)
            return result(MaterializationOutcome.ALREADY_ATTACHED)

        if image.dimensions is None:
            return failed("the photograph has no dimensions to verify the file against")

        if file is None:
            if pinned is None:
                return failed("the manifest has no photograph for this mountain; pass its file")
            if pinned.file_url != file_url:
                return failed(ManifestDifference.FILE_URL.value)

        try:
            data = file if file is not None else self._fetcher.fetch(file_url)
        except PhotographRejected as error:
            return failed(f"download refused: {error.reason}")
        except InfrastructureError as error:
            return failed(f"download failed: {_describe(error)}")

        try:
            prepared = self._ingestion.prepare(data)
        except PhotographRejected as error:
            return failed(f"file rejected: {error.reason}")
        except InfrastructureError as error:
            return failed(f"processing failed: {_describe(error)}")

        source = SourcePhotograph(prepared.original_sha256, len(data), prepared.dimensions)
        if prepared.dimensions != image.dimensions:
            return failed(
                f"{PhotographRejection.DIMENSIONS_DIFFER}: the file is"
                f" {_size(prepared.dimensions)}, the photograph is {_size(image.dimensions)}",
                source,
            )

        if pinned is not None:
            difference = _first_difference(
                pinned, entry, source.sha256, source.dimensions, source.bytes
            )
            if difference:
                return failed(difference, source)

        if dry_run:
            return result(MaterializationOutcome.VERIFIED, source=source)

        try:
            media = self._ingestion.store(prepared)
        except InfrastructureError as error:
            return failed(f"storage failed: {_describe(error)}", source)

        try:
            outcome = self._writer.attach_media(mountain.id, file_url, image.dimensions, media)
        except InfrastructureError as error:
            return failed(f"stored but not attached: {_describe(error)}", source)

        match outcome:
            case AttachOutcome.APPLIED:
                return result(MaterializationOutcome.MATERIALIZED, source=source)
            case AttachOutcome.ALREADY_ATTACHED:
                return result(MaterializationOutcome.ALREADY_ATTACHED, source=source)
            case AttachOutcome.STALE:
                return failed("stored but not attached: the photograph changed meanwhile", source)
            case AttachOutcome.NOT_FOUND:
                return failed("stored but not attached: the photograph is gone", source)


def _first_difference(
    pinned: ManifestPhotograph,
    entry: CatalogMountain,
    sha256: str,
    dimensions: ImageDimensions | None,
    size: int | None,
) -> str | None:
    differences = manifest_differences(
        pinned,
        file_url=entry.image_provenance.legacy_file_url,
        source_identifier=entry.mountain.primary_image.source_identifier,
        sha256=sha256,
        dimensions=dimensions,
        size=size,
    )

    return differences[0].value if differences else None


def _size(dimensions: ImageDimensions) -> str:
    return f"{dimensions.width}x{dimensions.height}"


def _describe(error: InfrastructureError) -> str:
    if error.__cause__ is not None:
        return f"{error}: {error.__cause__}"
    return str(error)
