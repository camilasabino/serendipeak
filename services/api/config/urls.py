from pathlib import Path

from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from config.composition import (
    STUDIO_INGESTION_LIMITS,
    build_admit_login_attempt,
    build_change_mountain_camera,
    build_change_mountain_location,
    build_change_user_access,
    build_clear_login_failures,
    build_create_mountain,
    build_create_mountain_region,
    build_deactivate_mountain,
    build_delete_draft_mountain,
    build_delete_mountain_region,
    build_get_mountain_by_slug,
    build_get_mountain_detail,
    build_get_mountain_form_options,
    build_get_mountain_preview,
    build_get_mountain_region,
    build_get_random_mountain,
    build_get_region_directory,
    build_get_todays_mountain,
    build_get_user,
    build_issue_preview_token,
    build_list_daily_discoveries,
    build_list_mountain_regions,
    build_list_mountains,
    build_list_users,
    build_move_mountain_region,
    build_publish_mountain,
    build_reactivate_mountain,
    build_set_user_password,
    build_update_mountain,
    build_update_mountain_region,
)
from config.health import healthz
from serendipeak.httpapi.urls import mountain_urlpatterns
from serendipeak.media.filesystem_media_store import PUBLIC_DIRECTORY
from serendipeak.studio.access import STUDIO_PATH_PREFIX
from serendipeak.studio.mountain_views import MountainWrites
from serendipeak.studio.region_views import RegionAdministration
from serendipeak.studio.urls import studio_urlpatterns
from serendipeak.studio.user_views import UserAdministration


def development_media_urlpatterns(*, debug: bool, media_store: str, media_root: Path):
    """Serve public renditions from the filesystem store during local development only.

    Originals live beside them under the media root and are never routed.
    """
    if not debug or media_store != "filesystem":
        return []

    return [
        re_path(
            r"^media/(?P<path>.+)$",
            serve,
            {"document_root": media_root / PUBLIC_DIRECTORY},
        ),
    ]


urlpatterns = [
    path("healthz", healthz),
    path(
        STUDIO_PATH_PREFIX.lstrip("/"),
        include(
            (
                studio_urlpatterns(
                    admit_login_attempt=build_admit_login_attempt(),
                    clear_login_failures=build_clear_login_failures(),
                    trusted_proxy_hops=settings.TRUSTED_PROXY_HOPS,
                    list_mountains=build_list_mountains(),
                    get_mountain_detail=build_get_mountain_detail(),
                    get_mountain_form_options=build_get_mountain_form_options(),
                    writes=MountainWrites(
                        create_mountain=build_create_mountain(),
                        update_mountain=build_update_mountain(),
                        change_location=build_change_mountain_location(),
                        delete_draft=build_delete_draft_mountain(),
                        publish=build_publish_mountain(),
                        deactivate=build_deactivate_mountain(),
                        reactivate=build_reactivate_mountain(),
                    ),
                    change_camera=build_change_mountain_camera(),
                    issue_preview=build_issue_preview_token(),
                    regions=RegionAdministration(
                        list_regions=build_list_mountain_regions(),
                        get_region=build_get_mountain_region(),
                        get_directory=build_get_region_directory(),
                        create=build_create_mountain_region(),
                        update=build_update_mountain_region(),
                        move=build_move_mountain_region(),
                        delete=build_delete_mountain_region(),
                    ),
                    users=UserAdministration(
                        list_users=build_list_users(),
                        get_user=build_get_user(),
                        change_access=build_change_user_access(),
                        set_password=build_set_user_password(),
                    ),
                    list_discoveries=build_list_daily_discoveries(),
                    media_base_url=settings.MEDIA_PUBLIC_BASE_URL,
                    web_origin=settings.WEB_ORIGIN,
                    max_photograph_bytes=STUDIO_INGESTION_LIMITS.max_bytes,
                ),
                "studio",
            )
        ),
    ),
    *mountain_urlpatterns(
        get_mountain=build_get_mountain_by_slug(),
        get_todays_mountain=build_get_todays_mountain(),
        get_random_mountain=build_get_random_mountain(),
        get_preview=build_get_mountain_preview(),
        media_base_url=settings.MEDIA_PUBLIC_BASE_URL,
    ),
    *development_media_urlpatterns(
        debug=settings.DEBUG,
        media_store=settings.MEDIA_STORE,
        media_root=settings.MEDIA_ROOT,
    ),
]
