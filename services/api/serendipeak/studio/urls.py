from django.urls import path

from serendipeak.accounts.login_throttle import AdmitLoginAttempt, ClearLoginFailures
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.list_mountains import ListMountains
from serendipeak.studio.access import StudioAccess, declare_access
from serendipeak.studio.views import (
    LandingView,
    MountainDetailView,
    MountainListView,
    StudioLoginView,
    StudioLogoutView,
    StudioPasswordChangeView,
)


def studio_urlpatterns(
    *,
    admit_login_attempt: AdmitLoginAttempt,
    clear_login_failures: ClearLoginFailures,
    trusted_proxy_hops: int,
    list_mountains: ListMountains,
    get_mountain_detail: GetMountainDetail,
    media_base_url: str,
    web_origin: str,
):
    """The Studio routes, each declaring who may call it. Mounted under /studio/."""
    return [
        path(
            "",
            declare_access(StudioAccess.VIEWER, LandingView.as_view()),
            name="landing",
        ),
        path(
            "mountains/",
            declare_access(
                StudioAccess.VIEWER,
                MountainListView.as_view(
                    list_mountains=list_mountains, media_base_url=media_base_url
                ),
            ),
            name="mountain_list",
        ),
        path(
            "mountains/<str:slug>/",
            declare_access(
                StudioAccess.VIEWER,
                MountainDetailView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    media_base_url=media_base_url,
                    web_origin=web_origin,
                ),
            ),
            name="mountain_detail",
        ),
        path(
            "login/",
            declare_access(
                StudioAccess.PUBLIC,
                StudioLoginView.as_view(
                    admit_attempt=admit_login_attempt,
                    clear_failures=clear_login_failures,
                    trusted_proxy_hops=trusted_proxy_hops,
                ),
            ),
            name="login",
        ),
        path(
            "logout/",
            declare_access(StudioAccess.VIEWER, StudioLogoutView.as_view()),
            name="logout",
        ),
        path(
            "password/",
            declare_access(StudioAccess.VIEWER, StudioPasswordChangeView.as_view()),
            name="password_change",
        ),
    ]
