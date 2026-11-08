from pathlib import Path

from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from config.admin import build_admin_site
from config.composition import (
    ADMIN_INGESTION_LIMITS,
    build_admit_login_attempt,
    build_change_mountain_location,
    build_clear_login_failures,
    build_create_mountain,
    build_deactivate_mountain,
    build_delete_draft_mountain,
    build_get_mountain_by_slug,
    build_get_mountain_detail,
    build_get_mountain_form_options,
    build_get_random_mountain,
    build_get_todays_mountain,
    build_list_mountains,
    build_publish_mountain,
    build_reactivate_mountain,
    build_update_mountain,
)
from config.health import healthz
from serendipeak.httpapi.urls import mountain_urlpatterns
from serendipeak.media.filesystem_media_store import PUBLIC_DIRECTORY
from serendipeak.studio.access import STUDIO_PATH_PREFIX
from serendipeak.studio.mountain_views import MountainWrites
from serendipeak.studio.urls import studio_urlpatterns


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
    path("admin/", build_admin_site().urls),
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
                    media_base_url=settings.MEDIA_PUBLIC_BASE_URL,
                    web_origin=settings.WEB_ORIGIN,
                    max_photograph_bytes=ADMIN_INGESTION_LIMITS.max_bytes,
                ),
                "studio",
            )
        ),
    ),
    *mountain_urlpatterns(
        get_mountain=build_get_mountain_by_slug(),
        get_todays_mountain=build_get_todays_mountain(),
        get_random_mountain=build_get_random_mountain(),
        media_base_url=settings.MEDIA_PUBLIC_BASE_URL,
    ),
    *development_media_urlpatterns(
        debug=settings.DEBUG,
        media_store=settings.MEDIA_STORE,
        media_root=settings.MEDIA_ROOT,
    ),
]
