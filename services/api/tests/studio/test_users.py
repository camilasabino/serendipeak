import json
import logging
import re
import uuid

import pytest
from django.contrib.auth import authenticate
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from tests.studio.support import LANDING_URL, NEUTRAL_FAILURE, PASSWORD, sign_in, text_of
from tests.support.users import create_user

LIST_URL = reverse("studio:user_list")
LOGGER = "serendipeak.security"
NEW_PASSWORD = "another long passphrase 42"


def edit_url(user):
    return reverse("studio:user_edit", kwargs={"user_id": user.pk})


def password_url(user):
    return reverse("studio:user_password", kwargs={"user_id": user.pk})


def access_of(user):
    return UserRecord.objects.values_list("role", "is_active").get(pk=user.pk)


def client_of(user):
    client = Client()
    client.force_login(user)

    return client


def form_of(response):
    """What the user form posts as the page renders it."""
    body = text_of(response)
    role = re.search(r'<option value="(\w+)" selected>', body)
    shown = re.search(r'name="shown" value="([^"]+)"', body)

    return {
        "role": role.group(1) if role else "",
        "is_active": "on" if re.search(r'name="is_active"[^>]* checked', body) else "",
        "shown": shown.group(1) if shown else "",
    }


def post_access(client, target, **overrides):
    page = client.get(edit_url(target))
    data = {key: value for key, value in form_of(page).items() if value != "" or key == "role"}
    data.update(overrides)
    data = {key: value for key, value in data.items() if value is not None}

    return client.post(edit_url(target), data)


def messages_of(response):
    return re.findall(r'<span class="message__text">(.*?)</span>', text_of(response), re.S)


@pytest.fixture
def events(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    def read():
        return [
            (record.getMessage(), getattr(record, "fields", {}))
            for record in caplog.records
            if record.name == LOGGER
        ]

    return read


class TestList:
    def test_it_lists_every_user_by_username_with_role_status_and_dates(
        self, editor, editor_client
    ):
        create_user("zoe", Role.VIEWER)
        create_user("ana", Role.EDITOR, is_active=False)

        body = text_of(editor_client.get(LIST_URL))

        assert body.index(">ana<") < body.index(">editor<") < body.index(">zoe<")
        assert "3 users, 1 active Editor." in body
        assert 'class="status status--inactive">Inactive' in body
        assert 'class="status status--active">Active' in body
        # The signed-in editor has a last sign-in; the two others never signed in.
        assert body.count("Never") == 2
        assert f'href="{edit_url(editor)}"' in body

    def test_it_marks_the_signed_in_editor_and_shows_the_last_sign_in(self, editor, editor_client):
        editor_client.logout()
        sign_in_client = Client()
        user = create_user("camila-sabino", password=PASSWORD)
        create_user("zoe", Role.VIEWER)
        assert sign_in(sign_in_client, "camila-sabino").status_code == 302

        body = text_of(sign_in_client.get(LIST_URL))

        assert re.search(r">camila-sabino</a>\s*<span class=\"role-tag role-tag--paper\">You", body)
        assert body.count("Never") == 1
        assert f'<time datetime="{UserRecord.objects.get(pk=user.pk).last_login:%Y-%m-%d}' in body

    def test_it_shows_no_password_hash_algorithm_or_salt(self, editor_client):
        user = create_user("ana", Role.VIEWER, password=PASSWORD)
        stored = UserRecord.objects.get(pk=user.pk).password

        for url in (LIST_URL, edit_url(user), password_url(user)):
            body = text_of(editor_client.get(url))

            assert stored not in body
            assert "pbkdf2" not in body.lower()
            assert "$" not in re.sub(r"<[^>]*>", "", body)

    def test_it_is_two_queries_beyond_the_session_whatever_the_number_of_users(self, editor_client):
        for index in range(30):
            create_user(f"user{index:02d}", Role.VIEWER)

        with CaptureQueriesContext(connection) as captured:
            response = editor_client.get(LIST_URL)

        assert response.status_code == 200
        users = [q for q in captured.captured_queries if '"app_user"' in q["sql"]]
        assert len(users) == 2  # the session's user and the listing

    def test_a_viewer_is_refused_the_list_and_the_nav_does_not_offer_it(
        self, viewer_client, editor_client
    ):
        response = viewer_client.get(LIST_URL)

        assert response.status_code == 403
        assert 'href="/studio/users/"' not in text_of(viewer_client.get(LANDING_URL))
        assert 'href="/studio/users/"' in text_of(editor_client.get(LANDING_URL))

    def test_the_nav_keeps_users_marked_on_its_own_pages(self, editor, editor_client):
        for url in (LIST_URL, edit_url(editor), password_url(create_user("ana", Role.VIEWER))):
            body = text_of(editor_client.get(url, follow=True))

            assert re.search(
                r'<a class="app-nav__link" href="/studio/users/" aria-current="page">Users</a>',
                body,
            )


class TestEditPage:
    def test_it_shows_the_account_read_only_and_the_form_for_another_user(
        self, editor_client, viewer
    ):
        body = text_of(editor_client.get(edit_url(viewer)))

        assert "<h1" in body and ">viewer</h1>" in body
        assert "Member since" in body and "Last sign-in" in body and "Never" in body
        assert 'name="username"' not in body
        assert re.search(r'<option value="viewer" selected>Viewer</option>', body)
        assert re.search(r'name="is_active"[^>]* checked', body)
        assert f'href="{password_url(viewer)}"' in body
        assert "csrfmiddlewaretoken" in body

    def test_an_unknown_user_is_a_404_inside_the_studio(self, editor_client):
        response = editor_client.get(reverse("studio:user_edit", kwargs={"user_id": uuid.uuid4()}))

        assert response.status_code == 404
        assert "User not found" in text_of(response)
        assert 'class="app-nav"' in text_of(response)

    def test_an_address_that_is_not_a_user_id_is_a_plain_404(self, editor_client):
        assert editor_client.get("/studio/users/not-an-id/").status_code == 404

    def test_reading_the_page_writes_nothing(self, editor_client, viewer):
        with CaptureQueriesContext(connection) as captured:
            editor_client.get(edit_url(viewer))

        writes = [
            q["sql"]
            for q in captured.captured_queries
            if q["sql"].split()[0] in ("UPDATE", "INSERT")
        ]
        assert writes == []
        assert access_of(viewer) == ("viewer", True)


class TestRoleChanges:
    def test_an_editor_promotes_a_viewer(self, editor_client, viewer, events):
        response = post_access(editor_client, viewer, role="editor")

        assert response.status_code == 302 and response.headers["Location"] == LIST_URL
        assert access_of(viewer) == ("editor", True)
        assert "viewer was saved." in messages_of(editor_client.get(LIST_URL))
        assert (
            "user_access_changed",
            {
                "actor_id": str(UserRecord.objects.get(username="editor").pk),
                "target_id": str(viewer.pk),
                "role": "editor",
                "is_active": True,
            },
        ) in events()

    def test_an_editor_demotes_another_editor_while_one_remains(self, editor_client):
        other = create_user("other-editor", Role.EDITOR)

        response = post_access(editor_client, other, role="viewer")

        assert response.status_code == 302
        assert access_of(other) == ("viewer", True)

    def test_a_promoted_viewer_gets_editor_access_on_the_next_request(self, editor_client, viewer):
        viewer_client = client_of(viewer)
        assert viewer_client.get(LIST_URL).status_code == 403

        post_access(editor_client, viewer, role="editor")

        assert viewer_client.get(LIST_URL).status_code == 200

    def test_a_demoted_editor_loses_editor_access_on_the_next_request(self, editor_client):
        other = create_user("other-editor", Role.EDITOR)
        other_client = client_of(other)
        assert other_client.get(LIST_URL).status_code == 200

        post_access(editor_client, other, role="viewer")

        assert other_client.get(LIST_URL).status_code == 403

    def test_a_role_that_does_not_exist_is_a_form_error_and_changes_nothing(
        self, editor_client, viewer
    ):
        response = post_access(editor_client, viewer, role="owner")

        assert response.status_code == 200
        assert "There is a problem" in text_of(response)
        assert access_of(viewer) == ("viewer", True)

    @pytest.mark.parametrize("shown", ["", "editor", "viewer:maybe", "owner:active"])
    def test_a_missing_or_tampered_shown_state_asks_for_a_reload(
        self, editor_client, viewer, shown
    ):
        response = post_access(editor_client, viewer, role="editor", shown=shown)

        assert response.status_code == 200
        assert "This page is out of date. Reload it and try again." in text_of(response)
        assert access_of(viewer) == ("viewer", True)


class TestActivation:
    def test_an_editor_deactivates_a_user_and_their_open_session_ends(self, editor_client, viewer):
        viewer_client = client_of(viewer)
        assert viewer_client.get(LANDING_URL).status_code == 200

        response = post_access(editor_client, viewer, is_active=None)

        assert response.status_code == 302
        assert access_of(viewer) == ("viewer", False)
        assert viewer_client.get(LANDING_URL).status_code == 302
        assert sign_in(Client(), "viewer").status_code == 200

    def test_a_deactivated_user_cannot_sign_in_and_is_told_nothing_about_why(self, editor_client):
        user = create_user("ana", Role.VIEWER, password=PASSWORD)
        post_access(editor_client, user, is_active=None)

        response = sign_in(Client(), "ana")

        assert response.status_code == 200
        assert NEUTRAL_FAILURE in text_of(response)

    def test_an_inactive_user_is_shown_as_inactive_and_can_be_reactivated(
        self, editor_client, viewer
    ):
        post_access(editor_client, viewer, is_active=None)
        page = text_of(editor_client.get(edit_url(viewer)))
        assert 'class="status status--inactive">Inactive' in page
        assert not re.search(r'name="is_active"[^>]* checked', page)

        post_access(editor_client, viewer, is_active="on")

        assert access_of(viewer) == ("viewer", True)
        assert client_of(viewer).get(LANDING_URL).status_code == 200

    def test_an_inactive_editor_cannot_use_the_user_screens(self, editor_client):
        other = create_user("other-editor", Role.EDITOR)
        other_client = client_of(other)
        post_access(editor_client, other, is_active=None)

        assert other_client.get(LIST_URL).status_code == 302
        assert other_client.post(edit_url(other), {}).status_code == 302

    def test_deactivating_an_editor_keeps_the_other_editor_able_to_act(self, editor_client):
        other = create_user("other-editor", Role.EDITOR)

        post_access(editor_client, other, is_active=None)

        assert editor_client.get(LIST_URL).status_code == 200


class TestGuards:
    def test_an_editor_sees_their_own_account_without_the_access_form(self, editor, editor_client):
        body = text_of(editor_client.get(edit_url(editor)))

        assert "This is your own account." in body
        assert 'name="role"' not in body and 'name="is_active"' not in body
        assert f'href="{password_url(editor)}"' not in body
        assert 'href="/studio/password/"' in body

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"role": "viewer"}, "You cannot change your own role."),
            ({"is_active": None}, "You cannot deactivate your own account."),
        ],
        ids=["demotion", "deactivation"],
    )
    def test_a_posted_self_demotion_or_deactivation_is_refused_and_changes_nothing(
        self, editor, editor_client, overrides, message
    ):
        create_user("other-editor", Role.EDITOR)
        data = {"role": "editor", "is_active": "on", "shown": "editor:active"}
        data.update({k: v for k, v in overrides.items() if v is not None})
        if "is_active" in overrides and overrides["is_active"] is None:
            del data["is_active"]

        response = editor_client.post(edit_url(editor), data)

        assert response.status_code == 200
        assert message in text_of(response)
        assert access_of(editor) == ("editor", True)

    def test_the_only_editor_cannot_lock_the_studio_out(self, editor, editor_client):
        response = editor_client.post(
            edit_url(editor), {"role": "viewer", "is_active": "on", "shown": "editor:active"}
        )

        assert response.status_code == 200
        assert access_of(editor) == ("editor", True)
        assert UserRecord.objects.filter(role="editor", is_active=True).count() == 1

    def test_a_refusal_is_logged_with_identifiers_only(self, editor, editor_client, events):
        editor_client.post(
            edit_url(editor), {"role": "viewer", "is_active": "on", "shown": "editor:active"}
        )

        refusals = [fields for name, fields in events() if name == "user_change_refused"]
        assert refusals == [
            {
                "actor_id": str(editor.pk),
                "target_id": str(editor.pk),
                "violation": "self_demotion",
            }
        ]


class TestConcurrentChanges:
    def test_a_form_older_than_a_colleagues_change_does_not_undo_it(self, editor_client, viewer):
        stale_page = editor_client.get(edit_url(viewer))
        stale = form_of(stale_page)
        colleague = create_user("colleague", Role.EDITOR)
        colleague_client = client_of(colleague)
        post_access(colleague_client, viewer, is_active=None)

        response = editor_client.post(edit_url(viewer), {**stale, "role": "editor"})

        assert response.status_code == 302
        assert response.headers["Location"] == edit_url(viewer)
        assert access_of(viewer) == ("viewer", False)
        body = text_of(editor_client.get(response.headers["Location"]))
        assert "Someone else changed this account while you were editing." in body
        assert "Review the current values below and save again." in body
        assert not re.search(r'name="is_active"[^>]* checked', body)

    def test_after_the_warning_the_refreshed_form_saves(self, editor_client, viewer):
        stale = form_of(editor_client.get(edit_url(viewer)))
        UserRecord.objects.filter(pk=viewer.pk).update(is_active=False)
        editor_client.post(edit_url(viewer), {**stale, "role": "editor"})

        response = post_access(editor_client, viewer, role="editor", is_active="on")

        assert response.status_code == 302
        assert access_of(viewer) == ("editor", True)

    def test_a_user_removed_from_the_database_meanwhile_is_reported_not_crashed(
        self, editor_client, viewer
    ):
        page = editor_client.get(edit_url(viewer))
        data = form_of(page)
        UserRecord.objects.filter(pk=viewer.pk).delete()

        response = editor_client.post(edit_url(viewer), data)

        assert response.status_code == 404

    def test_an_editor_demoted_after_loading_the_page_is_refused_on_save(
        self, editor_client, viewer
    ):
        other = create_user("other-editor", Role.EDITOR)
        other_client = client_of(other)
        data = form_of(other_client.get(edit_url(viewer)))
        post_access(editor_client, other, role="viewer")

        response = other_client.post(edit_url(viewer), {**data, "role": "editor"})

        assert response.status_code == 403
        assert access_of(viewer) == ("viewer", True)


class TestPassword:
    def test_the_form_asks_twice_and_never_echoes_a_password(self, editor_client, viewer):
        response = editor_client.post(
            password_url(viewer), {"new_password1": NEW_PASSWORD, "new_password2": "different"}
        )

        body = text_of(response)
        assert response.status_code == 200
        assert "The two passwords do not match." in body
        assert NEW_PASSWORD not in body and "different" not in body
        assert body.count('autocomplete="new-password"') == 2
        assert body.count('type="password"') == 2
        assert authenticate(username="viewer", password=NEW_PASSWORD) is None

    def test_an_editor_sets_a_password_and_the_user_signs_in_with_it(self, editor_client):
        user = create_user("ana", Role.VIEWER, password=PASSWORD)
        ana_client = Client()
        assert sign_in(ana_client, "ana").status_code == 302

        response = editor_client.post(
            password_url(user), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        assert response.status_code == 302 and response.headers["Location"] == LIST_URL
        assert "The password of ana was changed. Their open sessions have ended." in messages_of(
            editor_client.get(LIST_URL)
        )
        assert ana_client.get(LANDING_URL).status_code == 302
        assert sign_in(Client(), "ana").status_code == 200
        assert sign_in(Client(), "ana", NEW_PASSWORD).status_code == 302

    def test_only_the_password_changes(self, editor_client):
        user = create_user("ana", Role.VIEWER, password=PASSWORD)
        before = UserRecord.objects.values("role", "is_active", "username", "date_joined").get(
            pk=user.pk
        )

        editor_client.post(
            password_url(user), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        after = UserRecord.objects.values("role", "is_active", "username", "date_joined").get(
            pk=user.pk
        )
        assert after == before

    def test_the_actors_own_session_survives(self, editor_client, viewer):
        editor_client.post(
            password_url(viewer), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        assert editor_client.get(LIST_URL).status_code == 200

    @pytest.mark.parametrize(
        ("password", "reason"),
        [
            ("short", "at least 8 characters"),
            ("password1234", "too common"),
            ("123456789012345", "entirely numeric"),
            ("viewer12", "too similar"),
        ],
    )
    def test_the_password_policy_refuses_a_weak_password_in_the_form(
        self, editor_client, viewer, password, reason
    ):
        before = UserRecord.objects.get(pk=viewer.pk).password

        response = editor_client.post(
            password_url(viewer), {"new_password1": password, "new_password2": password}
        )

        body = text_of(response)
        assert response.status_code == 200
        assert reason in body
        assert f'value="{password}"' not in body
        assert UserRecord.objects.get(pk=viewer.pk).password == before

    def test_blank_fields_are_required(self, editor_client, viewer):
        response = editor_client.post(password_url(viewer), {})

        assert response.status_code == 200
        body = text_of(response)
        assert "New password: This field is required." in body
        assert "Confirm the new password: This field is required." in body

    def test_an_editor_cannot_set_their_own_password_here(self, editor, editor_client):
        before = UserRecord.objects.get(pk=editor.pk).password

        get = editor_client.get(password_url(editor))
        post = editor_client.post(
            password_url(editor),
            {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
        )

        for response in (get, post):
            assert response.status_code == 302
            assert response.headers["Location"] == reverse("studio:password_change")
        assert UserRecord.objects.get(pk=editor.pk).password == before

    def test_a_password_can_be_set_for_an_inactive_user_who_stays_inactive(self, editor_client):
        user = create_user("ana", Role.VIEWER, is_active=False, password=PASSWORD)

        editor_client.post(
            password_url(user), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        assert UserRecord.objects.get(pk=user.pk).check_password(NEW_PASSWORD)
        assert access_of(user) == ("viewer", False)

    def test_an_unknown_user_is_a_404(self, editor_client):
        response = editor_client.get(
            reverse("studio:user_password", kwargs={"user_id": uuid.uuid4()})
        )

        assert response.status_code == 404

    def test_the_event_is_logged_without_any_password(self, editor, editor_client, viewer, events):
        editor_client.post(
            password_url(viewer), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        logged = json.dumps(events(), default=str)
        assert "user_password_set" in logged
        assert NEW_PASSWORD not in logged
        assert str(viewer.pk) in logged

    def test_a_weak_attempt_is_not_logged_as_a_change(self, editor_client, viewer, events):
        editor_client.post(
            password_url(viewer), {"new_password1": "short", "new_password2": "short"}
        )

        assert "user_password_set" not in json.dumps(events(), default=str)

    def test_an_editor_demoted_after_loading_the_page_is_refused_on_save(
        self, editor_client, viewer
    ):
        other = create_user("other-editor", Role.EDITOR)
        other_client = client_of(other)
        other_client.get(password_url(viewer))
        post_access(editor_client, other, role="viewer")

        response = other_client.post(
            password_url(viewer), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        assert response.status_code == 403
        assert authenticate(username="viewer", password=NEW_PASSWORD) is None


class TestCsrf:
    @pytest.fixture
    def enforcing_editor(self, editor):
        client = Client(enforce_csrf_checks=True)
        client.force_login(editor)

        return client

    def test_the_forms_carry_a_token(self, enforcing_editor, viewer):
        for url in (edit_url(viewer), password_url(viewer)):
            assert re.search(
                r'name="csrfmiddlewaretoken" value="[^"]{32,}"',
                text_of(enforcing_editor.get(url)),
            )

    def test_an_access_change_without_a_token_is_refused_inside_the_studio(
        self, enforcing_editor, viewer
    ):
        response = enforcing_editor.post(
            edit_url(viewer), {"role": "editor", "is_active": "on", "shown": "viewer:active"}
        )

        assert response.status_code == 403
        assert "This page expired" in text_of(response)
        assert access_of(viewer) == ("viewer", True)

    def test_a_password_change_without_a_token_is_refused_and_changes_nothing(
        self, enforcing_editor, viewer
    ):
        before = UserRecord.objects.get(pk=viewer.pk).password

        response = enforcing_editor.post(
            password_url(viewer), {"new_password1": NEW_PASSWORD, "new_password2": NEW_PASSWORD}
        )

        assert response.status_code == 403
        assert UserRecord.objects.get(pk=viewer.pk).password == before

    def test_a_change_with_the_token_goes_through(self, enforcing_editor, viewer):
        token = re.search(
            r'name="csrfmiddlewaretoken" value="([^"]+)"',
            text_of(enforcing_editor.get(edit_url(viewer))),
        ).group(1)

        response = enforcing_editor.post(
            edit_url(viewer),
            {
                "role": "editor",
                "is_active": "on",
                "shown": "viewer:active",
                "csrfmiddlewaretoken": token,
            },
        )

        assert response.status_code == 302
        assert access_of(viewer) == ("editor", True)
