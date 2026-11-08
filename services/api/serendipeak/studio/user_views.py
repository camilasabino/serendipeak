from dataclasses import dataclass

from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.views import View

from serendipeak.accounts.access import AccessViolation
from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.errors import AccessRefused, PasswordRejected, UnknownUser
from serendipeak.accounts.read_users import GetUser, ListUsers
from serendipeak.accounts.set_user_password import SetUserPassword
from serendipeak.studio import security_log, user_representations
from serendipeak.studio.user_forms import NewPasswordForm, UserAccessForm

GONE = "That user no longer exists, so nothing was changed."


@dataclass(frozen=True, slots=True)
class UserAdministration:
    """The use cases the Studio's user screens read and write through."""

    list_users: ListUsers
    get_user: GetUser
    change_access: ChangeUserAccess
    set_password: SetUserPassword


def user_not_found(request):
    return render(request, "studio/user_not_found.html", status=404)


def user_gone(request):
    messages.error(request, GONE)

    return HttpResponseRedirect(reverse("studio:user_list"))


def _log_refusal(request, target_id, refused: AccessRefused) -> None:
    security_log.log_security_event(
        security_log.USER_CHANGE_REFUSED,
        actor_id=str(request.user.pk),
        target_id=str(target_id),
        violation=refused.violation.value,
    )


class UserListView(View):
    administration: UserAdministration | None = None

    def get(self, request):
        users = self.administration.list_users.execute()

        return render(
            request,
            "studio/user_list.html",
            user_representations.list_context(users, request.user.pk),
        )


class UserEditView(View):
    administration: UserAdministration | None = None

    def get(self, request, user_id):
        try:
            user = self.administration.get_user.execute(user_id)
        except UnknownUser:
            return user_not_found(request)

        return self._page(request, user, UserAccessForm(user=user))

    def post(self, request, user_id):
        try:
            user = self.administration.get_user.execute(user_id)
        except UnknownUser:
            return user_not_found(request)

        form = UserAccessForm(request.POST, user=user)
        if not form.is_valid():
            return self._page(request, user, form)

        desired = form.desired
        try:
            changed = self.administration.change_access.execute(
                request.user.pk,
                user.id,
                desired.role,
                desired.is_active,
                expected=form.expected,
            )
        except UnknownUser:
            return user_gone(request)
        except AccessRefused as refused:
            _log_refusal(request, user.id, refused)
            if refused.violation is AccessViolation.CHANGED_MEANWHILE:
                messages.warning(
                    request, f"{refused} Review the current values below and save again."
                )

                return HttpResponseRedirect(reverse("studio:user_edit", args=[user.id]))
            form.add_error(None, str(refused))

            return self._page(request, user, form)

        security_log.log_security_event(
            security_log.USER_ACCESS_CHANGED,
            actor_id=str(request.user.pk),
            target_id=str(changed.id),
            role=changed.role.value,
            is_active=changed.is_active,
        )
        messages.success(request, f"{changed.username} was saved.")

        return HttpResponseRedirect(reverse("studio:user_list"))

    def _page(self, request, user, form):
        context = user_representations.edit_context(user, form, request.user.pk)

        return render(request, "studio/user_edit.html", context)


class UserPasswordView(View):
    administration: UserAdministration | None = None

    def get(self, request, user_id):
        user = self._user(user_id)
        if user is None:
            return user_not_found(request)
        if user.id == request.user.pk:
            return self._own_password(request)

        return self._page(request, user, NewPasswordForm())

    def post(self, request, user_id):
        user = self._user(user_id)
        if user is None:
            return user_not_found(request)
        if user.id == request.user.pk:
            return self._own_password(request)

        form = NewPasswordForm(request.POST)
        if not form.is_valid():
            return self._page(request, user, form)

        try:
            self.administration.set_password.execute(
                request.user.pk, user.id, form.cleaned_data["new_password1"]
            )
        except UnknownUser:
            return user_gone(request)
        except PasswordRejected as rejected:
            form.add_error("new_password1", list(rejected.reasons))

            return self._page(request, user, form)
        except AccessRefused as refused:
            _log_refusal(request, user.id, refused)
            form.add_error(None, str(refused))

            return self._page(request, user, form)

        security_log.log_security_event(
            security_log.USER_PASSWORD_SET,
            actor_id=str(request.user.pk),
            target_id=str(user.id),
        )
        messages.success(
            request,
            f"The password of {user.username} was changed. Their open sessions have ended.",
        )

        return HttpResponseRedirect(reverse("studio:user_list"))

    def _user(self, user_id):
        try:
            return self.administration.get_user.execute(user_id)
        except UnknownUser:
            return None

    @staticmethod
    def _own_password(request):
        messages.info(
            request,
            "Your own password is changed here, where your current password is asked.",
        )

        return HttpResponseRedirect(reverse("studio:password_change"))

    def _page(self, request, user, form):
        return render(
            request,
            "studio/user_password.html",
            user_representations.password_context(user, form),
        )
