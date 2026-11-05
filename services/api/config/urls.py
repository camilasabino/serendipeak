from pathlib import Path

from django.conf import settings
from django.urls import path, re_path
from django.views.static import serve

from config.admin import build_admin_site
from config.composition import (
    build_get_mountain_by_slug,
    build_get_random_mountain,
    build_get_todays_mountain,
)
from config.health import healthz
from serendipeak.httpapi.urls import mountain_urlpatterns
from serendipeak.media.filesystem_media_store import PUBLIC_DIRECTORY


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
