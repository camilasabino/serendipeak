from django import forms
from django.contrib import admin, messages
from django.contrib.admin.forms import AdminPasswordChangeForm as SiteAdminPasswordChangeForm
from django.contrib.admin.options import ShowFacets
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import AdminPasswordChangeForm, BaseUserCreationForm
from django.http import Http404, HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html

from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.errors import AccessRefused, UnknownUser
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord

MANAGE_USERS_PERMISSION = "catalog.change_userrecord"


class _AccessRefusedInAdmin(Exception):
    def __init__(self, refusal: AccessRefused):
        super().__init__(str(refusal))
        self.refusal = refusal


class UserCreationForm(BaseUserCreationForm):
    class Meta(BaseUserCreationForm.Meta):
        model = UserRecord
        fields = ("username", "role")
        widgets = {"username": forms.TextInput}


class _CredentialOnlySave:
    """The framework saves the whole user row after setting a password, so a role or active
    change committed after the form loaded the user would be overwritten with the stale
    values. Writing only the password column leaves access changes to the guarded path."""

    def set_password_and_save(self, user, password_field_name="password1", commit=True):
        user.set_password(self.cleaned_data[password_field_name])
        if commit:
            user.save(update_fields=["password"])

        return user


class OwnPasswordChangeForm(_CredentialOnlySave, SiteAdminPasswordChangeForm):
    pass


class NewPasswordForm(_CredentialOnlySave, AdminPasswordChangeForm):
    """The framework form minus its option to disable password sign-in, which would leave an
    account, possibly the last Editor's, with no way in."""

    def __init__(self, user, *args, **kwargs):
        super().__init__(user, *args, **kwargs)
        self.fields.pop("usable_password", None)
        self.fields["password1"].required = True
        self.fields["password2"].required = True


class UserAccessForm(forms.ModelForm):
    class Meta:
        model = UserRecord
        fields = ("role", "is_active")


class UserRecordAdmin(UserAdmin):
    change_user_access: ChangeUserAccess

    show_facets = ShowFacets.ALWAYS
    add_form = UserCreationForm
    change_password_form = NewPasswordForm
    form = UserAccessForm
    list_display = ("username", "role", "is_active", "last_login")
    list_filter = ("role", "is_active")
    search_fields = ("username",)
    ordering = ("username",)
    filter_horizontal = ()
    fieldsets = (
        (None, {"fields": ("username", "role", "is_active", "password_link")}),
        ("Activity", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"fields": ("username", "role", "password1", "password2")}),)

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return ()

        return ("username", "password_link", "last_login", "date_joined")

    @admin.display(description="Password")
    def password_link(self, user):
        return format_html(
            '<a href="{}">Set a new password</a>',
            reverse("admin:auth_user_password_change", args=[user.pk]),
        )

    # Only an Editor manages users; a Viewer does not even see the list. Users are deactivated,
    # never deleted, so the access guards cannot be bypassed by removing a row.
    def has_module_permission(self, request):
        return self._manages_users(request)

    def has_view_permission(self, request, obj=None):
        return self._manages_users(request)

    def has_add_permission(self, request):
        return self._manages_users(request)

    def has_change_permission(self, request, obj=None):
        return self._manages_users(request)

    def has_delete_permission(self, request, obj=None):
        return False

    @staticmethod
    def _manages_users(request):
        return request.user.has_perm(MANAGE_USERS_PERMISSION)

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        # The exception leaves the view's transaction, and a redirect re-renders the user as
        # stored instead of claiming a change that was refused.
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except _AccessRefusedInAdmin as refused:
            self.message_user(request, str(refused.refusal), messages.ERROR)

            return HttpResponseRedirect(request.get_full_path())

    def save_model(self, request, obj, form, change):
        if not change:
            super().save_model(request, obj, form, change)
            return

        try:
            self.change_user_access.execute(request.user.pk, obj.pk, Role(obj.role), obj.is_active)
        except AccessRefused as refusal:
            raise _AccessRefusedInAdmin(refusal) from refusal
        except UnknownUser as unknown:
            raise Http404 from unknown
