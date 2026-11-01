from django.urls import path

from config.admin import build_admin_site
from config.composition import (
    build_get_mountain_by_slug,
    build_get_random_mountain,
    build_get_todays_mountain,
)
from config.health import healthz
from serendipeak.httpapi.urls import mountain_urlpatterns

urlpatterns = [
    path("healthz", healthz),
    path("admin/", build_admin_site().urls),
    *mountain_urlpatterns(
        get_mountain=build_get_mountain_by_slug(),
        get_todays_mountain=build_get_todays_mountain(),
        get_random_mountain=build_get_random_mountain(),
    ),
]
