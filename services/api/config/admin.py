from django.contrib.admin import AdminSite
from django.contrib.auth.admin import GroupAdmin, UserAdmin
from django.contrib.auth.models import Group, User
from django.utils.decorators import method_decorator
from django.views.decorators.clickjacking import xframe_options_deny

from config.composition import (
    build_deactivate_mountain,
    build_publish_mountain,
    build_reactivate_mountain,
)
from serendipeak.persistence.admin import DailyDiscoveryAdmin, MountainAdmin
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord


class EditorialAdminSite(AdminSite):
    site_header = "SerendiPeak editorial"
    site_title = "SerendiPeak editorial"
    index_title = "Catalog"

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
    )
    site.register(DailyDiscoveryRecord, DailyDiscoveryAdmin)
    site.register(User, UserAdmin)
    site.register(Group, GroupAdmin)

    return site
