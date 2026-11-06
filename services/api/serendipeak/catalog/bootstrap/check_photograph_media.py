import hashlib
from dataclasses import dataclass

from serendipeak.catalog.bootstrap.photograph_manifest import (
    ManifestDifference,
    PhotographManifest,
    manifest_differences,
)
from serendipeak.catalog.bootstrap.ports import CatalogMountain, CatalogStore
from serendipeak.catalog.entities import PhotographMedia
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import MediaStore


@dataclass(frozen=True, slots=True)
class MediaProblem:
    slug: str
    problem: str


@dataclass(frozen=True, slots=True)
class MediaCheckReport:
    checked: int
    problems: tuple[MediaProblem, ...]


class CheckPhotographMedia:
    """Checks that every photograph of the catalog references complete owned media.

    The shallow check reads only the catalog. deep also asks the store for every object, and
    checksums also rehashes every original, which reads all of them in full. These checks hold
    for any photograph, whoever uploaded it, for as long as the catalog lives.

    With a manifest, the check is also the one that proves the import: every photograph the
    manifest pins must be the pinned one, with its checksum and dimensions, and a pinned
    photograph the catalog no longer has is a problem. The catalog keeps no record of which
    photographs are imported, so a pinned photograph that an editor replaced differs by
    design: the manifest check is for the time between the import and the first replacement.
    """

    def __init__(
        self,
        catalog_store: CatalogStore,
        media_store: MediaStore,
        manifest: PhotographManifest | None = None,
    ):
        self._catalog_store = catalog_store
        self._media_store = media_store
        self._manifest = manifest

    def execute(self, *, deep: bool = False, checksums: bool = False) -> MediaCheckReport:
        photographed = [
            entry
            for entry in self._catalog_store.snapshot().mountains
            if entry.mountain.primary_image is not None
        ]
        problems = [
            MediaProblem(entry.mountain.slug, problem)
            for entry in photographed
            for problem in self._problems(entry, deep or checksums, checksums)
        ]

        if self._manifest is not None:
            present = {entry.mountain.id for entry in photographed}
            problems.extend(
                MediaProblem(pinned.slug, "the manifest photograph is not in the catalog")
                for pinned in self._manifest.photographs
                if pinned.mountain_id not in present
            )

        return MediaCheckReport(checked=len(photographed), problems=tuple(problems))

    def _problems(self, entry: CatalogMountain, deep: bool, checksums: bool) -> list[str]:
        media = entry.mountain.primary_image.media
        if media is None:
            return ["no media"]

        if _keys_do_not_match(media):
            return ["the media keys do not match the original checksum"]

        problems = [] if self._manifest is None else self._manifest_problems(entry)
        if not deep:
            return problems

        has_original = self._media_store.has_original(media.original_key)
        if not has_original:
            problems.append("the original is missing")
        if not self._media_store.has_public(media.page_key):
            problems.append("the page rendition is missing")
        if not self._media_store.has_public(media.viewer_key):
            problems.append("the viewer rendition is missing")

        if checksums and has_original:
            digest = hashlib.sha256(self._media_store.read_original(media.original_key))
            if digest.hexdigest() != media.original_sha256:
                problems.append("the original does not match its checksum")

        return problems

    def _manifest_problems(self, entry: CatalogMountain) -> list[str]:
        pinned = self._manifest.pin_for(entry.mountain.id)
        if pinned is None:
            return []

        image = entry.mountain.primary_image
        differences = manifest_differences(
            pinned, sha256=image.media.original_sha256, dimensions=image.dimensions
        )

        return [
            "the stored original is not the one in the manifest"
            if difference is ManifestDifference.CHECKSUM
            else difference.value
            for difference in differences
        ]


def _keys_do_not_match(media: PhotographMedia) -> bool:
    return not media.original_key.startswith(keys.original_key_prefix(media.original_sha256)) or (
        media.page_key,
        media.viewer_key,
    ) not in zip(
        keys.page_keys(media.original_sha256),
        keys.viewer_keys(media.original_sha256),
        strict=True,
    )
