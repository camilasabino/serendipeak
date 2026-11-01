from django.contrib.admin import AdminSite
from django.contrib.admin.options import ShowFacets
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import Permission, User
from django.utils.decorators import method_decorator
from django.views.decorators.clickjacking import xframe_options_deny

from config.composition import (
    build_deactivate_mountain,
    build_publish_mountain,
    build_reactivate_mountain,
)
from serendipeak.persistence.admin import DailyDiscoveryAdmin, MountainAdmin
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord

CATALOG_APP_LABEL = "catalog"


class EditorialUserAdmin(UserAdmin):
    show_facets = ShowFacets.ALWAYS
    list_filter = ("is_staff", "is_superuser", "is_active")

    def get_fieldsets(self, request, obj=None):
        return [
            (
                name,
                {**options, "fields": tuple(f for f in options["fields"] if f != "groups")},
            )
            for name, options in super().get_fieldsets(request, obj)
        ]

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if db_field.name == "user_permissions":
            kwargs["queryset"] = Permission.objects.filter(
                content_type__app_label=CATALOG_APP_LABEL
            ).select_related("content_type")

        return super().formfield_for_manytomany(db_field, request, **kwargs)


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
    site.register(User, EditorialUserAdmin)

    return site
