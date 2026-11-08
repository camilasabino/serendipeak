from django import forms
from django.conf import settings

from serendipeak.accounts.access import Access
from serendipeak.accounts.entities import User
from serendipeak.accounts.roles import Role

PAGE_OUT_OF_DATE = "This page is out of date. Reload it and try again."
PASSWORDS_DIFFER = "The two passwords do not match."


def _encode(access: Access) -> str:
    return f"{access.role.value}:{'active' if access.is_active else 'inactive'}"


def _decode(text: str) -> Access | None:
    role, _, state = text.partition(":")
    if role not in {r.value for r in Role} or state not in ("active", "inactive"):
        return None

    return Access(Role(role), state == "active")


class UserAccessForm(forms.Form):
    """The role and the active state of a user, and the access the page was shown with.

    The shown access travels with the form so the use case can refuse a save that would undo a
    colleague's change made in the meantime. It is a consistency check, not a credential: the
    guards judge the real state under a lock either way.
    """

    role = forms.ChoiceField(
        label="Role",
        choices=[(role.value, role.value.capitalize()) for role in Role],
        help_text="Editors can change everything in the Studio. Viewers can only read.",
    )
    is_active = forms.BooleanField(
        label="Active",
        required=False,
        help_text="An inactive user cannot sign in, and their open sessions end.",
    )
    shown = forms.CharField(
        label="Account state",
        widget=forms.HiddenInput,
        error_messages={"required": PAGE_OUT_OF_DATE},
    )

    def __init__(self, data=None, *, user: User):
        shown = Access(user.role, user.is_active)
        super().__init__(
            data,
            initial={
                "role": shown.role.value,
                "is_active": shown.is_active,
                "shown": _encode(shown),
            },
        )

    def clean_shown(self) -> Access:
        shown = _decode(self.cleaned_data["shown"])
        if shown is None:
            raise forms.ValidationError(PAGE_OUT_OF_DATE)

        return shown

    @property
    def expected(self) -> Access:
        return self.cleaned_data["shown"]

    @property
    def desired(self) -> Access:
        return Access(Role(self.cleaned_data["role"]), self.cleaned_data["is_active"])


class NewPasswordForm(forms.Form):
    """Two matching entries. The password policy lives in the store, which every caller shares,
    so this form never applies a second copy of it."""

    new_password1 = forms.CharField(
        label="New password",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
        help_text=(
            f"At least {settings.PASSWORD_MINIMUM_LENGTH} characters. Common passwords are refused."
        ),
    )
    new_password2 = forms.CharField(
        label="Confirm the new password",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )

    def clean(self):
        cleaned = super().clean()
        first, second = cleaned.get("new_password1"), cleaned.get("new_password2")
        if first and second and first != second:
            self.add_error("new_password2", PASSWORDS_DIFFER)

        return cleaned
