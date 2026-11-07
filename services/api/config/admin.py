from django.conf import settings
from django.contrib.admin import AdminSite
from django.utils.decorators import method_decorator
from django.views.decorators.clickjacking import xframe_options_deny

from config.composition import (
    build_admin_photograph_ingestion,
    build_change_mountain_camera,
    build_change_mountain_location,
    build_change_user_access,
    build_deactivate_mountain,
    build_publish_mountain,
    build_reactivate_mountain,
)
from serendipeak.persistence.admin import DailyDiscoveryAdmin, MountainAdmin
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord, UserRecord
from serendipeak.persistence.user_admin import OwnPasswordChangeForm, UserRecordAdmin


class EditorialAdminSite(AdminSite):
    site_header = "SerendiPeak editorial"
    site_title = "SerendiPeak editorial"
    index_title = "Catalog"
    password_change_form = OwnPasswordChangeForm

    # The public API sets no frame policy; only the admin must never be framed.
    def admin_view(self, view, cacheable=False):
        return xframe_options_deny(super().admin_view(view, cacheable))

    @method_decorator(xframe_options_deny)
    def login(self, request, extra_context=None):
        return super().login(request, extra_context)


def build_admin_site() -> EditorialAdminSite:
    site = EditorialAdminSite()
    site.register(
        MountainRecord,
        MountainAdmin,
        publish_mountain=build_publish_mountain(),
        deactivate_mountain=build_deactivate_mountain(),
        reactivate_mountain=build_reactivate_mountain(),
        change_mountain_camera=build_change_mountain_camera(),
        change_mountain_location=build_change_mountain_location(),
        photograph_ingestion=build_admin_photograph_ingestion(),
        media_base_url=settings.MEDIA_PUBLIC_BASE_URL,
        web_origin=settings.WEB_ORIGIN,
    )
    site.register(DailyDiscoveryRecord, DailyDiscoveryAdmin)
    site.register(UserRecord, UserRecordAdmin, change_user_access=build_change_user_access())

    return site
