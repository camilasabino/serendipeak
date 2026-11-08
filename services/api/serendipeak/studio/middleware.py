from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.shortcuts import render
from django.utils.cache import add_never_cache_headers

from serendipeak.accounts.roles import Role
from serendipeak.studio import security_log
from serendipeak.studio.access import ACCESS_ATTRIBUTE, StudioAccess, is_studio_path


def forbidden(request):
    return render(request, "studio/forbidden.html", status=403)


class StudioAccessMiddleware:
    """Decides, for every Studio view, whether the caller may run it.

    Authorization lives here and nowhere else, so a view cannot forget it: the role is read from
    the stored user on each request (the framework drops an inactive user's session), an
    anonymous caller is sent to the sign-in page, and a view that declared nothing is refused.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if not is_studio_path(request.path_info):
            return None

        access = getattr(view_func, ACCESS_ATTRIBUTE, None)
        if access is None:
            security_log.log_security_event(security_log.UNDECLARED_VIEW, path=request.path)

            return forbidden(request)
        if access is StudioAccess.PUBLIC:
            return None

        user = request.user
        if not user.is_authenticated:
            return self._sign_in(request)
        if access is StudioAccess.EDITOR and not Role(user.role).can_write:
            security_log.log_security_event(
                security_log.ACCESS_DENIED,
                user_id=str(user.pk),
                role=user.role,
                path=request.path,
                method=request.method,
            )

            return forbidden(request)

        return None

    @staticmethod
    def _sign_in(request):
        # A form posted after the session ended cannot be replayed as a GET after sign-in.
        if request.method in ("GET", "HEAD"):
            return redirect_to_login(request.get_full_path(), settings.LOGIN_URL)

        return redirect_to_login("", settings.LOGIN_URL, redirect_field_name="")


def _origin(url):
    parts = urlsplit(url)

    return f"{parts.scheme}://{parts.netloc}"


class StudioSecurityHeadersMiddleware:
    """Frame protection and the other response headers of the authenticated Studio.

    The public API sets none of these, so they are applied by path rather than globally.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        # Photographs are the only thing the Studio loads from another origin. blob: is the preview
        # of a file the editor chose, made by the page itself before anything is uploaded.
        self.content_security_policy = "; ".join(
            [
                "default-src 'none'",
                f"img-src 'self' {_origin(settings.MEDIA_PUBLIC_BASE_URL)} blob:",
                "style-src 'self'",
                "font-src 'self'",
                "script-src 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
                "base-uri 'none'",
            ]
        )

    def __call__(self, request):
        response = self.get_response(request)
        if not is_studio_path(request.path_info):
            return response

        response["X-Frame-Options"] = "DENY"
        response["X-Content-Type-Options"] = "nosniff"
        response["X-Robots-Tag"] = "noindex, nofollow"
        # "same-origin", not "no-referrer": with no-referrer browsers send "Origin: null" on form
        # posts, which the framework's CSRF check refuses.
        response["Referrer-Policy"] = "same-origin"
        response["Content-Security-Policy"] = self.content_security_policy
        add_never_cache_headers(response)

        return response
