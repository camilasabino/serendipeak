import secrets
from pathlib import Path

from django.conf import settings

from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.clock import SystemUtcClock as AccountsClock
from serendipeak.accounts.create_user import CreateUser
from serendipeak.accounts.login_throttle import AdmitLoginAttempt, ClearLoginFailures
from serendipeak.accounts.read_users import GetUser, ListUsers
from serendipeak.accounts.set_user_password import SetUserPassword
from serendipeak.catalog.bootstrap.apply_geography_backfill import ApplyGeographyBackfill
from serendipeak.catalog.bootstrap.check_catalog import CheckCatalog
from serendipeak.catalog.bootstrap.check_photograph_media import CheckPhotographMedia
from serendipeak.catalog.bootstrap.export_catalog_snapshot import ExportCatalogSnapshot
from serendipeak.catalog.bootstrap.load_catalog_snapshot import LoadCatalogSnapshot
from serendipeak.catalog.bootstrap.prepare_geography_input import PrepareGeographyInput
from serendipeak.catalog.bootstrap.verify_catalog_snapshot import VerifyCatalogSnapshot
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.change_mountain_location import ChangeMountainLocation
from serendipeak.catalog.create_mountain import CreateMountain
from serendipeak.catalog.create_mountain_region import CreateMountainRegion
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.delete_draft_mountain import DeleteDraftMountain
from serendipeak.catalog.delete_mountain_region import DeleteMountainRegion
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.get_mountain_form_options import GetMountainFormOptions
from serendipeak.catalog.get_mountain_index import GetMountainIndex
from serendipeak.catalog.get_mountain_preview import GetMountainPreview
from serendipeak.catalog.get_mountain_region import GetMountainRegion
from serendipeak.catalog.get_region_directory import GetRegionDirectory
from serendipeak.catalog.issue_preview_token import IssuePreviewToken
from serendipeak.catalog.list_mountain_regions import ListMountainRegions
from serendipeak.catalog.list_mountains import ListMountains
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import MediaStore, PhotographProcessor
from serendipeak.catalog.move_mountain_region import MoveMountainRegion
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.catalog.update_mountain_region import UpdateMountainRegion
from serendipeak.discovery.clock import SystemUtcClock
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.discovery.history import ListDailyDiscoveries
from serendipeak.discovery.prune_daily_discoveries import PruneDailyDiscoveries
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
from serendipeak.media.pillow_processor import PillowPhotographProcessor
from serendipeak.media.s3_media_store import S3MediaStore
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.discovery_history_reader import DjangoDiscoveryHistoryReader
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.geography_backfill_store import (
    DjangoGeographyBackfillStore,
    DjangoGeographyDraftReader,
)
from serendipeak.persistence.geography_options_reader import DjangoGeographyOptionsReader
from serendipeak.persistence.geography_reference import DjangoGeographyReference
from serendipeak.persistence.login_attempt_log import DjangoLoginAttemptLog
from serendipeak.persistence.mountain_camera_store import DjangoMountainCameraStore
from serendipeak.persistence.mountain_catalog_reader import DjangoMountainCatalogReader
from serendipeak.persistence.mountain_creation_store import DjangoMountainCreationStore
from serendipeak.persistence.mountain_location_store import DjangoMountainLocationStore
from serendipeak.persistence.mountain_region_reader import DjangoMountainRegionReader
from serendipeak.persistence.mountain_region_store import DjangoMountainRegionStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from serendipeak.persistence.user_reader import DjangoUserReader
from serendipeak.persistence.user_store import DjangoUserStore
from serendipeak.tokens.signed_preview_tokens import SignedPreviewTokens

SERVICE_ROOT = Path(__file__).resolve().parent.parent

MEBIBYTE = 1024 * 1024
STUDIO_INGESTION_LIMITS = IngestionLimits(max_bytes=30 * MEBIBYTE)


def describe_database() -> str:
    database = settings.DATABASES["default"]
    host = database["HOST"] or "local socket"
    port = database["PORT"] or "default"

    return f"database {database['NAME']} on {host}:{port}"


def build_export_catalog_snapshot() -> ExportCatalogSnapshot:
    return ExportCatalogSnapshot(DjangoCatalogStore(), DjangoGeographyReference())


def build_verify_catalog_snapshot() -> VerifyCatalogSnapshot:
    return VerifyCatalogSnapshot(DjangoCatalogStore(), DjangoGeographyReference())


def build_load_catalog_snapshot() -> LoadCatalogSnapshot:
    store = DjangoCatalogStore()
    reference = DjangoGeographyReference()

    return LoadCatalogSnapshot(store, reference, VerifyCatalogSnapshot(store, reference))


def build_apply_geography_backfill() -> ApplyGeographyBackfill:
    return ApplyGeographyBackfill(DjangoGeographyBackfillStore())


def build_prepare_geography_input() -> PrepareGeographyInput:
    return PrepareGeographyInput(DjangoGeographyDraftReader())


def build_check_catalog() -> CheckCatalog:
    return CheckCatalog(DjangoCatalogStore())


def build_get_mountain_by_slug() -> GetMountainBySlug:
    return GetMountainBySlug(DjangoMountainRepository())


def build_get_mountain_index() -> GetMountainIndex:
    return GetMountainIndex(DjangoMountainRepository())


def build_list_mountains() -> ListMountains:
    return ListMountains(DjangoMountainCatalogReader())


def build_get_mountain_detail() -> GetMountainDetail:
    return GetMountainDetail(DjangoMountainCatalogReader())


def build_get_mountain_form_options() -> GetMountainFormOptions:
    return GetMountainFormOptions(DjangoGeographyOptionsReader())


def build_list_mountain_regions() -> ListMountainRegions:
    return ListMountainRegions(DjangoMountainRegionReader())


def build_get_mountain_region() -> GetMountainRegion:
    return GetMountainRegion(DjangoMountainRegionReader())


def build_get_region_directory() -> GetRegionDirectory:
    return GetRegionDirectory(DjangoMountainRegionReader())


def build_issue_preview_token() -> IssuePreviewToken:
    return IssuePreviewToken(
        DjangoMountainCatalogReader(),
        SignedPreviewTokens(settings.PREVIEW_SIGNING_KEY),
        AccountsClock(),
    )


def build_get_mountain_preview() -> GetMountainPreview:
    return GetMountainPreview(
        DjangoMountainCatalogReader(),
        SignedPreviewTokens(settings.PREVIEW_SIGNING_KEY),
        AccountsClock(),
    )


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
        DjangoMountainCreationStore(), ingestion or build_studio_photograph_ingestion()
    )


def build_update_mountain(ingestion: PhotographIngestion | None = None) -> UpdateMountain:
    return UpdateMountain(
        DjangoMountainUpdateStore(), ingestion or build_studio_photograph_ingestion()
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


def build_set_user_password() -> SetUserPassword:
    return SetUserPassword(DjangoUserStore())


def build_list_users() -> ListUsers:
    return ListUsers(DjangoUserReader())


def build_get_user() -> GetUser:
    return GetUser(DjangoUserReader())


def build_list_daily_discoveries() -> ListDailyDiscoveries:
    return ListDailyDiscoveries(DjangoDiscoveryHistoryReader(), SystemUtcClock())


def build_admit_login_attempt() -> AdmitLoginAttempt:
    return AdmitLoginAttempt(DjangoLoginAttemptLog(), AccountsClock())


def build_clear_login_failures() -> ClearLoginFailures:
    return ClearLoginFailures(DjangoLoginAttemptLog())


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


def build_studio_photograph_ingestion() -> PhotographIngestion:
    return PhotographIngestion(
        build_photograph_processor(),
        build_media_store(),
        STUDIO_INGESTION_LIMITS,
    )


def build_check_photograph_media() -> CheckPhotographMedia:
    return CheckPhotographMedia(DjangoCatalogStore(), build_media_store())
