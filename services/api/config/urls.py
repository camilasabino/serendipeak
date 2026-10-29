from django.urls import path

from config.composition import build_get_mountain_by_slug
from config.health import healthz
from serendipeak.httpapi.urls import mountain_urlpatterns

urlpatterns = [
    path("healthz", healthz),
    *mountain_urlpatterns(get_mountain=build_get_mountain_by_slug()),
]
