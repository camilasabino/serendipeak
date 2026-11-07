from django.urls import path

from serendipeak.accounts.login_throttle import AdmitLoginAttempt, ClearLoginFailures
from serendipeak.studio.access import StudioAccess, declare_access
from serendipeak.studio.views import (
    LandingView,
    StudioLoginView,
    StudioLogoutView,
    StudioPasswordChangeView,
)


def studio_urlpatterns(
    *,
    admit_login_attempt: AdmitLoginAttempt,
    clear_login_failures: ClearLoginFailures,
    trusted_proxy_hops: int,
):
    """The Studio routes, each declaring who may call it. Mounted under /studio/."""
    return [
        path(
            "",
            declare_access(StudioAccess.VIEWER, LandingView.as_view()),
            name="landing",
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
