"""Accounts are created and recovered from the command line: the Studio has no screen that
creates one, and Django's own administration site is not installed."""

import io
from unittest import mock

import pytest
from django.contrib.auth import authenticate
from django.core.management import call_command
from django.core.management.base import CommandError

from serendipeak.cli.management.commands import create_editor, create_viewer
from serendipeak.persistence.models import UserRecord
from tests.support.users import create_user

pytestmark = pytest.mark.django_db

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "another long passphrase 42"


@pytest.fixture(autouse=True)
def no_ambient_password(monkeypatch):
    monkeypatch.delenv(create_editor.PASSWORD_ENVIRONMENT_VARIABLE, raising=False)
    monkeypatch.delenv(create_viewer.PASSWORD_ENVIRONMENT_VARIABLE, raising=False)


def run(name, *arguments):
    stdout = io.StringIO()
    call_command(name, *arguments, stdout=stdout, stderr=io.StringIO())

    return stdout.getvalue()


class TestCreateViewer:
    def test_it_creates_an_active_viewer_from_its_own_environment_variable(self, monkeypatch):
        monkeypatch.setenv(create_viewer.PASSWORD_ENVIRONMENT_VARIABLE, PASSWORD)

        stdout = run("create_viewer", "reader")

        user = UserRecord.objects.get(username="reader")
        assert (user.role, user.is_active) == ("viewer", True)
        assert authenticate(username="reader", password=PASSWORD) == user
        assert stdout == "Created the Viewer 'reader'.\n"

    def test_it_does_not_read_the_editor_password_variable(self, monkeypatch):
        monkeypatch.setenv(create_editor.PASSWORD_ENVIRONMENT_VARIABLE, PASSWORD)
        monkeypatch.setattr(create_editor.sys.stdin, "isatty", lambda: False, raising=False)

        with pytest.raises(CommandError, match=create_viewer.PASSWORD_ENVIRONMENT_VARIABLE):
            run("create_viewer", "reader")

        assert not UserRecord.objects.filter(username="reader").exists()

    def test_it_applies_the_username_and_password_rules_and_refuses_a_taken_name(self, monkeypatch):
        create_user("taken")
        monkeypatch.setenv(create_viewer.PASSWORD_ENVIRONMENT_VARIABLE, PASSWORD)

        with pytest.raises(CommandError):
            run("create_viewer", "taken")
        with pytest.raises(CommandError):
            run("create_viewer", "Not Valid!")
        monkeypatch.setenv(create_viewer.PASSWORD_ENVIRONMENT_VARIABLE, "password")
        with pytest.raises(CommandError, match="rejected"):
            run("create_viewer", "reader")

    def test_the_editor_command_still_creates_editors(self, monkeypatch):
        monkeypatch.setenv(create_editor.PASSWORD_ENVIRONMENT_VARIABLE, PASSWORD)

        assert run("create_editor", "boss") == "Created the Editor 'boss'.\n"
        assert UserRecord.objects.get(username="boss").role == "editor"


class TestPasswordRecovery:
    def test_the_framework_command_sets_the_password_of_an_existing_account(self):
        create_user("camila", password=PASSWORD)

        with mock.patch(
            "django.contrib.auth.management.commands.changepassword.getpass.getpass",
            return_value=NEW_PASSWORD,
        ):
            run("changepassword", "camila")

        assert authenticate(username="camila", password=NEW_PASSWORD) is not None
        assert authenticate(username="camila", password=PASSWORD) is None

    def test_it_keeps_the_role_and_the_active_state(self):
        create_user("camila", password=PASSWORD)
        before = UserRecord.objects.values_list("role", "is_active").get(username="camila")

        with mock.patch(
            "django.contrib.auth.management.commands.changepassword.getpass.getpass",
            return_value=NEW_PASSWORD,
        ):
            run("changepassword", "camila")

        assert UserRecord.objects.values_list("role", "is_active").get(username="camila") == before

    def test_the_password_policy_applies(self):
        create_user("camila", password=PASSWORD)

        with (
            mock.patch(
                "django.contrib.auth.management.commands.changepassword.getpass.getpass",
                return_value="password",
            ),
            pytest.raises(CommandError),
        ):
            run("changepassword", "camila")

        assert authenticate(username="camila", password=PASSWORD) is not None
