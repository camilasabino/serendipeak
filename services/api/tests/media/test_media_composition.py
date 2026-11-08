import json
from urllib.parse import urlsplit

import pytest

from config.composition import (
    LEGACY_SOURCE_INGESTION_LIMITS,
    PHOTOGRAPH_MANIFEST_PATH,
    SOURCE_FETCH_ALLOWED_HOSTS,
    STUDIO_INGESTION_LIMITS,
    build_check_photograph_media,
    build_legacy_photograph_ingestion,
    build_materialize_photographs,
    build_media_store,
    build_source_image_fetcher,
    build_studio_photograph_ingestion,
)
from serendipeak.catalog.bootstrap.check_photograph_media import CheckPhotographMedia
from serendipeak.catalog.bootstrap.materialize_photographs import MaterializePhotographs
from serendipeak.catalog.bootstrap.photograph_manifest import PhotographManifest
from serendipeak.errors import InfrastructureError
from serendipeak.media.caching_source_fetcher import CachingSourceImageFetcher
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
from serendipeak.media.http_source_fetcher import HttpSourceImageFetcher
from serendipeak.media.s3_media_store import S3MediaStore

MEBIBYTE = 1024 * 1024


def test_the_filesystem_store_is_built_under_the_media_root(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    store = build_media_store()
    store.put_public(f"photographs/{'a' * 64}/page-r1.jpg", b"page", "image/jpeg")

    assert isinstance(store, FilesystemMediaStore)
    assert (tmp_path / "public" / "photographs" / ("a" * 64) / "page-r1.jpg").exists()


def test_the_s3_store_is_built_from_its_settings_without_contacting_it(settings):
    settings.MEDIA_STORE = "s3"
    settings.MEDIA_S3_ENDPOINT_URL = "https://account.r2.cloudflarestorage.example"
    settings.MEDIA_S3_ACCESS_KEY_ID = "access-key"
    settings.MEDIA_S3_SECRET_ACCESS_KEY = "secret-key"
    settings.MEDIA_PUBLIC_BUCKET = "photographs-public"
    settings.MEDIA_ORIGINALS_BUCKET = "photographs-originals"

    assert isinstance(build_media_store(), S3MediaStore)


def test_editors_and_the_existing_catalog_have_their_own_byte_limits():
    assert STUDIO_INGESTION_LIMITS.max_bytes == 30 * MEBIBYTE
    assert LEGACY_SOURCE_INGESTION_LIMITS.max_bytes == 150 * MEBIBYTE


def test_each_ingestion_is_built_with_its_limit(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    assert build_studio_photograph_ingestion()._limits is STUDIO_INGESTION_LIMITS
    assert build_legacy_photograph_ingestion()._limits is LEGACY_SOURCE_INGESTION_LIMITS


def test_source_files_are_downloaded_directly_or_through_a_cache(tmp_path):
    assert isinstance(build_source_image_fetcher(), HttpSourceImageFetcher)
    assert isinstance(build_source_image_fetcher(tmp_path), CachingSourceImageFetcher)


def test_the_media_commands_are_built_without_contacting_any_service(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    assert isinstance(build_materialize_photographs(tmp_path), MaterializePhotographs)
    assert isinstance(build_check_photograph_media(PhotographManifest([])), CheckPhotographMedia)


def test_the_source_fetcher_contacts_only_the_authorized_hosts():
    with pytest.raises(InfrastructureError, match="not on an authorized host"):
        build_source_image_fetcher().fetch("https://example.com/photograph.jpg")


def test_every_pinned_file_url_is_on_an_authorized_host():
    document = json.loads(PHOTOGRAPH_MANIFEST_PATH.read_text(encoding="utf-8"))

    hosts = {urlsplit(entry["file_url"]).hostname for entry in document["photographs"]}

    assert hosts <= set(SOURCE_FETCH_ALLOWED_HOSTS)
