from django.conf import settings
from django.contrib.auth.forms import AuthenticationForm, PasswordChangeForm
from django.core.exceptions import ValidationError

from serendipeak.accounts.login_throttle import AdmitLoginAttempt


class StudioAuthenticationForm(AuthenticationForm):
    """The framework sign-in form, counting each attempt before it checks the password.

    The messages never say which of the username and the password was wrong, nor whether the
    account exists, is inactive, or is the one being throttled.
    """

    error_messages = {
        **AuthenticationForm.error_messages,
        "invalid_login": "The username or password is not correct.",
        "inactive": "The username or password is not correct.",
        "throttled": "Too many sign-in attempts. Wait a few minutes and try again.",
    }

    def __init__(
        self, request=None, *args, admit_attempt: AdmitLoginAttempt, address: str, **kwargs
    ):
        super().__init__(request, *args, **kwargs)
        self._admit_attempt = admit_attempt
        self._address = address
        self.throttled = False
        self.attempt_key = None

    def clean(self):
        username = self.cleaned_data.get("username")
        password = self.cleaned_data.get("password")
        if username is not None and password:
            admission = self._admit_attempt.execute(username, self._address)
            self.attempt_key = admission.key
            if not admission.admitted:
                self.throttled = True

                raise ValidationError(self.error_messages["throttled"], code="throttled")

        return super().clean()


class StudioPasswordChangeForm(PasswordChangeForm):
    """The framework form with a one-line policy and a write that touches only the password.

    The framework saves the whole row after setting a password, so a role or active change
    committed after the form loaded the user would be overwritten with the stale values.
    """

    def __init__(self, user, *args, **kwargs):
        super().__init__(user, *args, **kwargs)
        self.fields[
            "new_password1"
        ].help_text = (
            f"At least {settings.PASSWORD_MINIMUM_LENGTH} characters. Common passwords are refused."
        )

    def set_password_and_save(self, user, password_field_name="password1", commit=True):
        user.set_password(self.cleaned_data[password_field_name])
        if commit:
            user.save(update_fields=["password"])

        return user
