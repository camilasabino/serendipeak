from django.contrib import messages
from django.contrib.auth.views import LoginView, LogoutView, PasswordChangeView
from django.shortcuts import render
from django.urls import reverse_lazy
from django.views import csrf
from django.views.generic import TemplateView, View

from serendipeak.accounts.login_throttle import AdmitLoginAttempt, ClearLoginFailures
from serendipeak.catalog.errors import MountainSlugNotFound
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.list_mountains import SEARCH_MAX_LENGTH, ListMountains
from serendipeak.studio import representations, security_log
from serendipeak.studio.access import is_studio_path
from serendipeak.studio.client_address import client_address
from serendipeak.studio.forms import StudioAuthenticationForm, StudioPasswordChangeForm

THROTTLED_STATUS = 429


class StudioLoginView(LoginView):
    template_name = "studio/login.html"
    authentication_form = StudioAuthenticationForm
    redirect_authenticated_user = True

    # Supplied through as_view by the composition root; as_view only accepts existing attributes.
    admit_attempt: AdmitLoginAttempt | None = None
    clear_failures: ClearLoginFailures | None = None
    trusted_proxy_hops: int = 0

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs["admit_attempt"] = self.admit_attempt
        kwargs["address"] = self._address()

        return kwargs

    def form_valid(self, form):
        response = super().form_valid(form)
        user = form.get_user()
        self.clear_failures.execute(form.cleaned_data["username"])
        security_log.log_security_event(
            security_log.LOGIN_SUCCEEDED,
            user_id=str(user.pk),
            role=user.role,
            address=self._address(),
        )

        return response

    def form_invalid(self, form):
        response = super().form_invalid(form)
        security_log.log_security_event(
            security_log.LOGIN_THROTTLED if form.throttled else security_log.LOGIN_FAILED,
            username_key=form.attempt_key,
            address=self._address(),
        )
        if form.throttled:
            response.status_code = THROTTLED_STATUS

        return response

    def _address(self):
        return client_address(self.request, self.trusted_proxy_hops)


class StudioLogoutView(LogoutView):
    next_page = reverse_lazy("studio:login")

    def post(self, request, *args, **kwargs):
        user = request.user
        response = super().post(request, *args, **kwargs)
        if user.is_authenticated:
            security_log.log_security_event(
                security_log.LOGOUT, user_id=str(user.pk), role=user.role
            )
            messages.info(request, "You are signed out.")

        return response


class StudioPasswordChangeView(PasswordChangeView):
    template_name = "studio/password_change.html"
    form_class = StudioPasswordChangeForm
    success_url = reverse_lazy("studio:landing")

    def form_valid(self, form):
        response = super().form_valid(form)
        user = self.request.user
        security_log.log_security_event(
            security_log.PASSWORD_CHANGED, user_id=str(user.pk), role=user.role
        )
        messages.success(self.request, "Your password was changed.")

        return response

    def form_invalid(self, form):
        user = self.request.user
        security_log.log_security_event(
            security_log.PASSWORD_CHANGE_REFUSED, user_id=str(user.pk), role=user.role
        )

        return super().form_invalid(form)


class LandingView(TemplateView):
    template_name = "studio/landing.html"


class MountainListView(View):
    list_mountains: ListMountains | None = None
    media_base_url: str = ""

    def get(self, request):
        search = request.GET.get("q", "").strip()[:SEARCH_MAX_LENGTH]
        status = representations.STATUS_BY_KEY.get(request.GET.get("status", ""))
        listing = self.list_mountains.execute(status=status, search=search)

        return render(
            request,
            "studio/mountain_list.html",
            {
                "rows": representations.list_rows(listing, self.media_base_url),
                "chips": representations.filter_chips(listing, status, search),
                "search": search,
                "status_key": ""
                if status is None
                else representations.status_presentation(status).key,
                "total": listing.total,
                "filtered": bool(search or status),
            },
        )


class MountainDetailView(View):
    get_mountain_detail: GetMountainDetail | None = None
    media_base_url: str = ""
    web_origin: str = ""

    def get(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return render(request, "studio/mountain_not_found.html", status=404)

        context = representations.detail_context(
            detail, media_base_url=self.media_base_url, web_origin=self.web_origin
        )

        return render(request, "studio/mountain_detail.html", context)


def csrf_failure(request, reason=""):
    """Render the framework's refusal inside the Studio's own page when the request is its own."""
    if not is_studio_path(request.path_info):
        return csrf.csrf_failure(request, reason)

    security_log.log_security_event(security_log.CSRF_FAILED, path=request.path)

    return render(request, "studio/csrf_failure.html", status=403)
