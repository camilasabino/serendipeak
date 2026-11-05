from config.composition import (
    ADMIN_INGESTION_LIMITS,
    LEGACY_SOURCE_INGESTION_LIMITS,
    build_admin_photograph_ingestion,
    build_legacy_photograph_ingestion,
    build_media_store,
)
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
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
    assert ADMIN_INGESTION_LIMITS.max_bytes == 30 * MEBIBYTE
    assert LEGACY_SOURCE_INGESTION_LIMITS.max_bytes == 150 * MEBIBYTE


def test_each_ingestion_is_built_with_its_limit(settings, tmp_path):
    settings.MEDIA_STORE = "filesystem"
    settings.MEDIA_ROOT = tmp_path

    assert build_admin_photograph_ingestion()._limits is ADMIN_INGESTION_LIMITS
    assert build_legacy_photograph_ingestion()._limits is LEGACY_SOURCE_INGESTION_LIMITS
