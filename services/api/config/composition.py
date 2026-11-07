import secrets
from pathlib import Path

from django.conf import settings

from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.create_user import CreateUser
from serendipeak.catalog.bootstrap.apply_geography_backfill import ApplyGeographyBackfill
from serendipeak.catalog.bootstrap.bootstrap_catalog import BootstrapCatalog
from serendipeak.catalog.bootstrap.check_catalog import CheckCatalog
from serendipeak.catalog.bootstrap.check_photograph_media import CheckPhotographMedia
from serendipeak.catalog.bootstrap.materialize_photographs import MaterializePhotographs
from serendipeak.catalog.bootstrap.photograph_manifest import PhotographManifest
from serendipeak.catalog.bootstrap.prepare_geography_input import PrepareGeographyInput
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.change_mountain_location import ChangeMountainLocation
from serendipeak.catalog.create_mountain import CreateMountain
from serendipeak.catalog.create_mountain_region import CreateMountainRegion
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.delete_draft_mountain import DeleteDraftMountain
from serendipeak.catalog.delete_mountain_region import DeleteMountainRegion
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import MediaStore, PhotographProcessor, SourceImageFetcher
from serendipeak.catalog.move_mountain_region import MoveMountainRegion
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.catalog.update_mountain_region import UpdateMountainRegion
from serendipeak.discovery.clock import SystemUtcClock
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.discovery.prune_daily_discoveries import PruneDailyDiscoveries
from serendipeak.media.caching_source_fetcher import CachingSourceImageFetcher
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
from serendipeak.media.http_source_fetcher import HttpSourceImageFetcher
from serendipeak.media.pillow_processor import PillowPhotographProcessor
from serendipeak.media.s3_media_store import S3MediaStore
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.geography_backfill_store import (
    DjangoGeographyBackfillStore,
    DjangoGeographyDraftReader,
)
from serendipeak.persistence.geography_reference import DjangoGeographyReference
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from serendipeak.persistence.mountain_location_store import DjangoMountainLocationStore
from serendipeak.persistence.mountain_region_store import DjangoMountainRegionStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
from serendipeak.persistence.user_store import DjangoUserStore

SERVICE_ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = SERVICE_ROOT / "seed" / "legacy-catalog-v1.json"
PHOTOGRAPH_MANIFEST_PATH = SERVICE_ROOT / "seed" / "legacy-photographs-v1.json"
FROZEN_CATALOG_PATH = SERVICE_ROOT.parents[1] / "contracts" / "v1" / "catalog.json"

MEBIBYTE = 1024 * 1024
ADMIN_INGESTION_LIMITS = IngestionLimits(max_bytes=30 * MEBIBYTE)
# Photographs of the existing catalog come from their sources at full resolution, some well
# beyond an editor's upload limit, and every one of them must still be stored.
LEGACY_SOURCE_INGESTION_LIMITS = IngestionLimits(max_bytes=150 * MEBIBYTE)
# Wikimedia asks automated clients for a descriptive User-Agent that identifies the project.
SOURCE_FETCH_USER_AGENT = (
    "SerendiPeakPhotographMaterializer/1.0 (https://serendipeak.com) Python-urllib"
)
# Where the seed's photographs are published. A redirect elsewhere is refused.
SOURCE_FETCH_ALLOWED_HOSTS = ("upload.wikimedia.org",)
# Per socket operation: a slow but progressing download of a large original is not cut.
SOURCE_FETCH_TIMEOUT_SECONDS = 60


def build_bootstrap_catalog() -> BootstrapCatalog:
    store = DjangoCatalogStore()
    reference = DjangoGeographyReference()

    return BootstrapCatalog(store, VerifyCatalog(store, reference), reference)


def build_verify_catalog() -> VerifyCatalog:
    return VerifyCatalog(DjangoCatalogStore(), DjangoGeographyReference())


def build_apply_geography_backfill() -> ApplyGeographyBackfill:
    return ApplyGeographyBackfill(DjangoGeographyBackfillStore())


def build_prepare_geography_input() -> PrepareGeographyInput:
    return PrepareGeographyInput(DjangoGeographyDraftReader())


def build_check_catalog() -> CheckCatalog:
    return CheckCatalog(DjangoCatalogStore())


def build_get_mountain_by_slug() -> GetMountainBySlug:
    return GetMountainBySlug(DjangoMountainRepository())


def build_get_todays_mountain() -> GetTodaysMountain:
    return GetTodaysMountain(
        DjangoMountainRepository(),
        DjangoDailyDiscoveryRepository(),
        SystemUtcClock(),
    )


def build_prune_daily_discoveries() -> PruneDailyDiscoveries:
    return PruneDailyDiscoveries(DjangoDailyDiscoveryRepository(), SystemUtcClock())


def build_get_random_mountain() -> GetRandomMountain:
    return GetRandomMountain(DjangoMountainRepository(), secrets.randbelow)


def build_publish_mountain() -> PublishMountain:
    return PublishMountain(DjangoMountainStatusStore())


def build_deactivate_mountain() -> DeactivateMountain:
    return DeactivateMountain(DjangoMountainStatusStore())


def build_reactivate_mountain() -> ReactivateMountain:
    return ReactivateMountain(DjangoMountainStatusStore())


def build_change_mountain_camera() -> ChangeMountainCamera:
    return ChangeMountainCamera(DjangoMountainCameraStore())


def build_change_mountain_location() -> ChangeMountainLocation:
    return ChangeMountainLocation(DjangoMountainLocationStore())


def build_create_mountain(ingestion: PhotographIngestion | None = None) -> CreateMountain:
    return CreateMountain(
        DjangoMountainCreationStore(), ingestion or build_admin_photograph_ingestion()
    )


def build_update_mountain(ingestion: PhotographIngestion | None = None) -> UpdateMountain:
    return UpdateMountain(
        DjangoMountainUpdateStore(), ingestion or build_admin_photograph_ingestion()
    )


def build_delete_draft_mountain() -> DeleteDraftMountain:
    return DeleteDraftMountain(DjangoDraftMountainDeletionStore())


def build_create_mountain_region() -> CreateMountainRegion:
    return CreateMountainRegion(DjangoMountainRegionStore())


def build_update_mountain_region() -> UpdateMountainRegion:
    return UpdateMountainRegion(DjangoMountainRegionStore())


def build_move_mountain_region() -> MoveMountainRegion:
    return MoveMountainRegion(DjangoMountainRegionStore())


def build_delete_mountain_region() -> DeleteMountainRegion:
    return DeleteMountainRegion(DjangoMountainRegionStore())


def build_create_user() -> CreateUser:
    return CreateUser(DjangoUserStore())


def build_change_user_access() -> ChangeUserAccess:
    return ChangeUserAccess(DjangoUserStore())


def build_media_store() -> MediaStore:
    if settings.MEDIA_STORE == "filesystem":
        return FilesystemMediaStore(settings.MEDIA_ROOT)

    return S3MediaStore.connect(
        endpoint_url=settings.MEDIA_S3_ENDPOINT_URL,
        access_key_id=settings.MEDIA_S3_ACCESS_KEY_ID,
        secret_access_key=settings.MEDIA_S3_SECRET_ACCESS_KEY,
        public_bucket=settings.MEDIA_PUBLIC_BUCKET,
        originals_bucket=settings.MEDIA_ORIGINALS_BUCKET,
    )


def build_photograph_processor() -> PhotographProcessor:
    return PillowPhotographProcessor()


def build_admin_photograph_ingestion() -> PhotographIngestion:
    return PhotographIngestion(
        build_photograph_processor(),
        build_media_store(),
        ADMIN_INGESTION_LIMITS,
    )


def build_legacy_photograph_ingestion() -> PhotographIngestion:
    return PhotographIngestion(
        build_photograph_processor(),
        build_media_store(),
        LEGACY_SOURCE_INGESTION_LIMITS,
    )


def build_source_image_fetcher(cache_dir: Path | None = None) -> SourceImageFetcher:
    fetcher = HttpSourceImageFetcher(
        max_bytes=LEGACY_SOURCE_INGESTION_LIMITS.max_bytes,
        user_agent=SOURCE_FETCH_USER_AGENT,
        timeout_seconds=SOURCE_FETCH_TIMEOUT_SECONDS,
        allowed_hosts=SOURCE_FETCH_ALLOWED_HOSTS,
    )
    if cache_dir is None:
        return fetcher

    return CachingSourceImageFetcher(fetcher, cache_dir)


def build_materialize_photographs(cache_dir: Path | None = None) -> MaterializePhotographs:
    return MaterializePhotographs(
        DjangoCatalogStore(),
        build_source_image_fetcher(cache_dir),
        build_legacy_photograph_ingestion(),
        DjangoPhotographMediaWriter(),
    )


def build_check_photograph_media(
    manifest: PhotographManifest | None = None,
) -> CheckPhotographMedia:
    return CheckPhotographMedia(DjangoCatalogStore(), build_media_store(), manifest)
