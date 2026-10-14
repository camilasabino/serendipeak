from django.urls import path

from config.health import healthz

urlpatterns = [
    path("healthz", healthz),
]
