import pytest
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import identify_hasher
from django.contrib.messages import get_messages
from django.test import Client
from django.urls import reverse

from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from tests.admin.support import form_payload, input_names
from tests.support.users import create_user

CHANGELIST_URL = reverse("admin:catalog_userrecord_changelist")
ADD_URL = reverse("admin:catalog_userrecord_add")
STRONG_PASSWORD = "correct horse battery staple"


def change_url(user):
    return reverse("admin:catalog_userrecord_change", args=[user.pk])


def password_url(user):
    return reverse("admin:auth_user_password_change", args=[user.pk])


def stored(user):
    return UserRecord.objects.get(pk=user.pk)


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


def add_payload(**overrides):
    return {
        "username": "martina",
        "role": "viewer",
        "password1": STRONG_PASSWORD,
        "password2": STRONG_PASSWORD,
        "_save": "Save",
    } | overrides


def errors_of(response):
    return {
        name: list(errors) for name, errors in response.context["adminform"].form.errors.items()
    }


class TestList:
    def test_it_shows_the_username_role_state_and_last_login(self, editor_client, editor):
        create_user("martina", Role.VIEWER, is_active=False)

        html = editor_client.get(CHANGELIST_URL).content.decode()

        for header in ("Username", "Role", "Active", "Last login"):
            assert header in html
        assert "martina" in html

    def test_it_never_shows_credentials_or_framework_flags(self, editor_client, editor):
        html = editor_client.get(CHANGELIST_URL).content.decode()

        for forbidden in ("pbkdf2", "Staff status", "Superuser", "email", "Groups"):
            assert forbidden not in html

    def test_it_filters_by_role_and_state(self, editor_client, editor):
        create_user("martina", Role.VIEWER)
        create_user("gone", Role.VIEWER, is_active=False)

        viewers = editor_client.get(CHANGELIST_URL, {"role": "viewer"})
        inactive = editor_client.get(CHANGELIST_URL, {"is_active__exact": "0"})

        assert {u.username for u in viewers.context["cl"].result_list} == {"martina", "gone"}
        assert {u.username for u in inactive.context["cl"].result_list} == {"gone"}


class TestAdd:
    def test_the_form_asks_only_for_the_username_role_and_password(self, editor_client):
        names = input_names(editor_client.get(ADD_URL))

        assert names >= {"username", "role", "password1", "password2"}
        assert not names & {
            "is_staff",
            "is_superuser",
            "groups",
            "user_permissions",
            "email",
            "first_name",
            "usable_password",
        }

    @pytest.mark.parametrize("role", ["editor", "viewer"])
    def test_an_editor_creates_a_user_with_a_hashed_password(self, editor_client, role):
        response = editor_client.post(ADD_URL, add_payload(role=role))

        assert response.status_code == 302
        user = UserRecord.objects.get(username="martina")
        assert (user.role, user.is_active) == (role, True)
        assert user.password != STRONG_PASSWORD
        assert identify_hasher(user.password).algorithm == "pbkdf2_sha256"
        assert authenticate(username="martina", password=STRONG_PASSWORD) == user

    @pytest.mark.parametrize(
        ("password", "reason"),
        [
            ("short-1", "at least 8 characters"),
            ("password1234", "too common"),
            ("123456789012345", "entirely numeric"),
            ("martina-sabino", "too similar"),
        ],
    )
    def test_the_password_policy_applies(self, editor_client, password, reason):
        response = editor_client.post(
            ADD_URL, add_payload(username="martina-sabino", password1=password, password2=password)
        )

        assert response.status_code == 200
        assert reason in " ".join(errors_of(response)["password2"])
        assert not UserRecord.objects.filter(username="martina-sabino").exists()

    def test_the_two_passwords_must_match(self, editor_client):
        response = editor_client.post(ADD_URL, add_payload(password2=STRONG_PASSWORD + "x"))

        assert response.status_code == 200
        assert "password2" in errors_of(response)
        assert not UserRecord.objects.filter(username="martina").exists()

    @pytest.mark.parametrize("username", ["Martina", "ma", "has space", "-martina"])
    def test_an_invalid_username_is_explained(self, editor_client, username):
        response = editor_client.post(ADD_URL, add_payload(username=username))

        assert response.status_code == 200
        assert "Use 3 to 32 lowercase letters" in " ".join(errors_of(response)["__all__"])
        assert not UserRecord.objects.filter(username=username).exists()

    def test_a_username_in_use_is_explained(self, editor_client, editor):
        response = editor_client.post(ADD_URL, add_payload(username="editor"))

        assert response.status_code == 200
        assert "already exists" in " ".join(errors_of(response)["__all__"])

    def test_an_unknown_role_is_refused(self, editor_client):
        response = editor_client.post(ADD_URL, add_payload(role="superuser"))

        assert response.status_code == 200
        assert "role" in errors_of(response)


class TestChange:
    def test_the_page_edits_only_the_role_and_state(self, editor_client, viewer):
        page = editor_client.get(change_url(viewer))

        assert page.status_code == 200
        assert input_names(page) - {"csrfmiddlewaretoken", "_save", "_continue", "_addanother"} == {
            "role",
            "is_active",
        }

    def test_the_page_shows_no_credential_detail(self, editor_client, viewer):
        html = editor_client.get(change_url(viewer)).content.decode()

        for forbidden in ("pbkdf2", "algorithm", "salt", "iterations", "Staff", "Superuser"):
            assert forbidden not in html
        assert "Set a new password" in html
        assert password_url(viewer) in html

    def test_the_activity_dates_are_read_only(self, editor_client, viewer):
        page = editor_client.get(change_url(viewer))
        form = page.context["adminform"].form

        assert {"username", "last_login", "date_joined", "password"}.isdisjoint(form.fields)
        assert "Date joined" in page.content.decode()

    def test_an_editor_promotes_a_viewer(self, editor_client, viewer):
        page = editor_client.get(change_url(viewer))

        response = editor_client.post(change_url(viewer), form_payload(page, role="editor"))

        assert response.status_code == 302
        assert stored(viewer).role == "editor"

    def test_an_editor_deactivates_another_user(self, editor_client, viewer):
        payload = form_payload(editor_client.get(change_url(viewer)))
        payload.pop("is_active")

        response = editor_client.post(change_url(viewer), payload)

        assert response.status_code == 302
        assert stored(viewer).is_active is False

    def test_the_posted_fields_that_are_not_editable_are_ignored(self, editor_client, viewer):
        page = editor_client.get(change_url(viewer))
        before = stored(viewer)

        editor_client.post(
            change_url(viewer),
            form_payload(
                page,
                role="viewer",
            )
            | {
                "username": "taken-over",
                "date_joined": "2000-01-01 00:00:00",
                "last_login": "2000-01-01 00:00:00",
                "password": "x",
                "is_staff": "on",
                "is_superuser": "on",
            },
        )

        after = stored(viewer)
        assert (after.username, after.date_joined, after.last_login, after.password) == (
            before.username,
            before.date_joined,
            before.last_login,
            before.password,
        )
        assert not hasattr(after, "is_superuser")

    def test_an_editor_cannot_deactivate_themselves(self, editor_client, editor):
        create_user("other-editor")
        payload = form_payload(editor_client.get(change_url(editor)))
        payload.pop("is_active")

        response = editor_client.post(change_url(editor), payload, follow=True)

        assert stored(editor).is_active is True
        assert "You cannot deactivate your own account." in messages_of(response)
        assert response.redirect_chain[-1][0] == change_url(editor)

    def test_an_editor_cannot_demote_themselves(self, editor_client, editor):
        create_user("other-editor")
        page = editor_client.get(change_url(editor))

        response = editor_client.post(
            change_url(editor), form_payload(page, role="viewer"), follow=True
        )

        assert stored(editor).role == "editor"
        assert "You cannot change your own role." in messages_of(response)

    def test_the_sole_editor_cannot_lose_their_role(self, editor_client, editor):
        page = editor_client.get(change_url(editor))

        editor_client.post(change_url(editor), form_payload(page, role="viewer"))

        assert stored(editor).role == "editor"

    def test_a_refused_change_is_not_reported_as_a_success(self, editor_client, editor):
        page = editor_client.get(change_url(editor))

        response = editor_client.post(
            change_url(editor), form_payload(page, role="viewer"), follow=True
        )

        assert not any("was changed successfully" in m for m in messages_of(response))

    def test_resaving_oneself_unchanged_is_allowed(self, editor_client, editor):
        page = editor_client.get(change_url(editor))

        response = editor_client.post(change_url(editor), form_payload(page))

        assert response.status_code == 302
        assert (stored(editor).role, stored(editor).is_active) == ("editor", True)

    def test_an_unknown_user_redirects_to_the_admin_index(self, editor_client):
        missing = reverse(
            "admin:catalog_userrecord_change", args=["00000000-0000-0000-0000-000000000000"]
        )

        assert editor_client.get(missing).status_code == 302


class TestDeletion:
    def test_users_cannot_be_deleted(self, editor_client, viewer):
        delete = reverse("admin:catalog_userrecord_delete", args=[viewer.pk])

        assert editor_client.get(delete).status_code == 403
        assert editor_client.post(delete, {"post": "yes"}).status_code == 403
        assert UserRecord.objects.filter(pk=viewer.pk).exists()

    def test_the_list_offers_no_bulk_delete(self, editor_client, viewer):
        response = editor_client.get(CHANGELIST_URL)

        assert response.context["action_form"] is None
        posted = editor_client.post(
            CHANGELIST_URL,
            {"action": "delete_selected", "_selected_action": [str(viewer.pk)], "post": "yes"},
        )
        assert posted.status_code in {200, 302}
        assert UserRecord.objects.filter(pk=viewer.pk).exists()


class TestPassword:
    def test_an_editor_sets_a_new_password_for_another_user(self, editor_client, viewer):
        response = editor_client.post(
            password_url(viewer),
            {
                "password1": STRONG_PASSWORD,
                "password2": STRONG_PASSWORD,
                "usable_password": "true",
            },
        )

        assert response.status_code == 302
        assert authenticate(username="viewer", password=STRONG_PASSWORD) == stored(viewer)

    @pytest.mark.parametrize("own", [False, True])
    def test_password_sign_in_cannot_be_disabled(self, editor_client, editor, own):
        target = editor if own else create_user("martina", Role.VIEWER, password=STRONG_PASSWORD)
        target.set_password(STRONG_PASSWORD)
        target.save()
        editor_client.force_login(editor)
        before = stored(target).password

        response = editor_client.post(
            password_url(target), {"usable_password": "false", "unset-password": "1"}
        )

        assert response.status_code == 200
        assert stored(target).password == before
        assert stored(target).has_usable_password()

    def test_the_policy_applies_to_a_password_set_for_another_user(self, editor_client, viewer):
        response = editor_client.post(
            password_url(viewer),
            {"password1": "short", "password2": "short", "usable_password": "true"},
        )

        assert response.status_code == 200
        assert authenticate(username="viewer", password="short") is None

    def test_a_new_password_ends_the_sessions_of_that_user(
        self, editor_client, viewer_client, viewer
    ):
        assert viewer_client.get(reverse("admin:index")).status_code == 200

        editor_client.post(
            password_url(viewer),
            {
                "password1": STRONG_PASSWORD,
                "password2": STRONG_PASSWORD,
                "usable_password": "true",
            },
        )

        assert viewer_client.get(reverse("admin:index")).status_code == 302

    def test_the_password_page_shows_no_hash(self, editor_client, viewer):
        page = editor_client.get(password_url(viewer))

        assert page.status_code == 200
        assert b"pbkdf2" not in page.content


@pytest.mark.parametrize("client_factory", [lambda: Client(enforce_csrf_checks=True)])
class TestCsrf:
    def test_user_changes_need_the_csrf_token(self, client_factory, editor, viewer):
        client = client_factory()
        client.force_login(editor)

        responses = [
            client.post(ADD_URL, add_payload()),
            client.post(change_url(viewer), {"role": "editor"}),
            client.post(password_url(viewer), {"password1": STRONG_PASSWORD}),
        ]

        assert [r.status_code for r in responses] == [403, 403, 403]
        assert stored(viewer).role == "viewer"
