import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from serendipeak.accounts.access import Access, access_violation
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from serendipeak.persistence.user_admin import NewPasswordForm, OwnPasswordChangeForm
from serendipeak.persistence.user_store import DjangoUserStore
from tests.support.users import create_user

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "another long passphrase 42"


VIEWER = Access(Role.VIEWER, True)
INACTIVE_EDITOR = Access(Role.EDITOR, False)


def change_access(actor, target, desired):
    DjangoUserStore().change_access(actor.id, target.id, desired, access_violation)


def password_updates(queries):
    return [
        query["sql"]
        for query in queries
        if query["sql"].startswith('UPDATE "app_user"') and '"password"' in query["sql"]
    ]


@pytest.fixture
def stale_second_editor(db):
    actor = create_user("first-editor")
    target = create_user("second-editor", password=PASSWORD)
    stale = UserRecord.objects.get(pk=target.pk)

    return actor, target, stale


class TestStaleUserObject:
    def test_setting_a_password_for_a_user_never_restores_a_demoted_role(self, stale_second_editor):
        actor, target, stale = stale_second_editor
        form = NewPasswordForm(stale, {"password1": NEW_PASSWORD, "password2": NEW_PASSWORD})
        assert form.is_valid()
        change_access(actor, target, VIEWER)

        form.save()

        stored = UserRecord.objects.get(pk=target.pk)
        assert stored.role == "viewer"
        assert stored.check_password(NEW_PASSWORD)
        assert UserRecord.objects.filter(role="editor", is_active=True).count() == 1

    def test_setting_a_password_never_reactivates_a_deactivated_user(self, stale_second_editor):
        actor, target, stale = stale_second_editor
        form = NewPasswordForm(stale, {"password1": NEW_PASSWORD, "password2": NEW_PASSWORD})
        assert form.is_valid()
        change_access(actor, target, INACTIVE_EDITOR)

        form.save()

        assert UserRecord.objects.get(pk=target.pk).is_active is False

    def test_changing_ones_own_password_never_restores_a_demoted_role(self, stale_second_editor):
        actor, target, stale = stale_second_editor
        form = OwnPasswordChangeForm(
            stale,
            {
                "old_password": PASSWORD,
                "new_password1": NEW_PASSWORD,
                "new_password2": NEW_PASSWORD,
            },
        )
        assert form.is_valid()
        change_access(actor, target, VIEWER)

        form.save()

        stored = UserRecord.objects.get(pk=target.pk)
        assert stored.role == "viewer"
        assert stored.check_password(NEW_PASSWORD)

    def test_unrelated_columns_changed_meanwhile_are_kept(self, stale_second_editor):
        _, target, stale = stale_second_editor
        form = NewPasswordForm(stale, {"password1": NEW_PASSWORD, "password2": NEW_PASSWORD})
        assert form.is_valid()
        marker = "2001-02-03T04:05:06+00:00"
        UserRecord.objects.filter(pk=target.pk).update(last_login=marker)

        form.save()

        assert UserRecord.objects.get(pk=target.pk).last_login.isoformat() == marker


class TestOnlyThePasswordIsWritten:
    def test_the_admin_password_page_updates_the_password_column_alone(self, db):
        editor = create_user("editor")
        target = create_user("viewer", Role.VIEWER, password=PASSWORD)
        client = Client()
        client.force_login(editor)
        url = reverse("admin:auth_user_password_change", args=[target.pk])

        with CaptureQueriesContext(connection) as queries:
            response = client.post(url, {"password1": NEW_PASSWORD, "password2": NEW_PASSWORD})

        assert response.status_code == 302
        statements = password_updates(queries.captured_queries)
        assert len(statements) == 1
        assert statements[0].startswith('UPDATE "app_user" SET "password" = ')
        assert '"role"' not in statements[0]
        assert '"is_active"' not in statements[0]

    def test_the_own_password_page_updates_the_password_column_alone(self, db):
        user = create_user("camila-sabino", password=PASSWORD)
        client = Client()
        client.force_login(user)

        with CaptureQueriesContext(connection) as queries:
            response = client.post(
                reverse("admin:password_change"),
                {
                    "old_password": PASSWORD,
                    "new_password1": NEW_PASSWORD,
                    "new_password2": NEW_PASSWORD,
                },
            )

        assert response.status_code == 302
        statements = password_updates(queries.captured_queries)
        assert len(statements) == 1
        assert statements[0].startswith('UPDATE "app_user" SET "password" = ')
        assert '"role"' not in statements[0]
        assert '"is_active"' not in statements[0]
