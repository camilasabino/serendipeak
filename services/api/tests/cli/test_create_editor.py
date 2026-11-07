import io
from unittest import mock

import pytest
from django.contrib.auth import authenticate
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError

from serendipeak.cli.management.commands import create_editor
from serendipeak.persistence.models import UserRecord
from tests.support.users import create_user

pytestmark = pytest.mark.django_db

PASSWORD = "correct horse battery staple"
VARIABLE = create_editor.PASSWORD_ENVIRONMENT_VARIABLE


@pytest.fixture(autouse=True)
def no_ambient_password(monkeypatch):
    monkeypatch.delenv(VARIABLE, raising=False)


def run(*arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command("create_editor", *arguments, stdout=stdout, stderr=stderr)

    return stdout.getvalue(), stderr.getvalue()


def failure(*arguments):
    with pytest.raises(CommandError) as raised:
        call_command("create_editor", *arguments, stdout=io.StringIO(), stderr=io.StringIO())

    return str(raised.value)


def prompts(monkeypatch, *answers, tty=True):
    monkeypatch.setattr(create_editor.sys.stdin, "isatty", lambda: tty, raising=False)
    answered = iter(answers)
    monkeypatch.setattr(create_editor, "getpass", lambda prompt: next(answered))


def test_it_creates_an_active_editor_from_the_environment_password(monkeypatch):
    monkeypatch.setenv(VARIABLE, PASSWORD)

    stdout, stderr = run("camila")

    user = UserRecord.objects.get(username="camila")
    assert (user.role, user.is_active) == ("editor", True)
    assert authenticate(username="camila", password=PASSWORD) == user
    assert stdout == "Created the Editor 'camila'.\n"
    assert stderr == ""


def test_it_prompts_twice_when_there_is_no_environment_password(monkeypatch):
    prompts(monkeypatch, PASSWORD, PASSWORD)

    run("camila")

    assert authenticate(username="camila", password=PASSWORD)


def test_it_refuses_passwords_that_do_not_match(monkeypatch):
    prompts(monkeypatch, PASSWORD, PASSWORD + "!")

    assert failure("camila") == "The passwords did not match."
    assert not UserRecord.objects.exists()


def test_it_needs_the_environment_variable_when_there_is_no_terminal(monkeypatch):
    prompts(monkeypatch, tty=False)

    assert VARIABLE in failure("camila")
    assert not UserRecord.objects.exists()


def test_it_never_accepts_the_password_as_an_argument():
    with pytest.raises(CommandError):
        call_command("create_editor", "camila", "--password", PASSWORD)

    assert not UserRecord.objects.exists()


def test_it_never_prints_the_password(monkeypatch):
    monkeypatch.setenv(VARIABLE, PASSWORD)

    stdout, stderr = run("camila")

    assert PASSWORD not in stdout + stderr


@pytest.mark.parametrize(
    ("password", "reason"),
    [("qw3r-ty", "at least 8 characters"), ("password1234", "too common")],
)
def test_it_applies_the_password_policy(monkeypatch, password, reason):
    monkeypatch.setenv(VARIABLE, password)

    message = failure("camila")

    assert message.startswith("The password was rejected.")
    assert reason in message
    assert password not in message
    assert not UserRecord.objects.exists()


@pytest.mark.parametrize("username", ["Camila", "ab", "has space"])
def test_it_applies_the_username_rule(monkeypatch, username):
    monkeypatch.setenv(VARIABLE, PASSWORD)

    assert "Use 3 to 32 lowercase letters" in failure(username)
    assert not UserRecord.objects.exists()


def test_it_does_not_touch_an_existing_user(monkeypatch):
    existing = create_user("camila", password="the original passphrase")
    monkeypatch.setenv(VARIABLE, PASSWORD)

    assert "already in use" in failure("camila")

    existing.refresh_from_db()
    assert existing.check_password("the original passphrase")
    assert existing.role == "editor"


def test_it_can_add_more_editors_to_recover_access(monkeypatch):
    monkeypatch.setenv(VARIABLE, PASSWORD)

    run("first-editor")
    run("second-editor")

    assert UserRecord.objects.filter(role="editor", is_active=True).count() == 2


def test_a_database_failure_is_a_command_error(monkeypatch):
    monkeypatch.setenv(VARIABLE, PASSWORD)

    with mock.patch.object(UserRecord.objects, "get_or_create", side_effect=OperationalError):
        assert "the database operation failed" in failure("camila")


def test_it_accepts_a_password_of_exactly_the_minimum_length(monkeypatch):
    monkeypatch.setenv(VARIABLE, "k7-m2x9q")

    run("camila")

    assert authenticate(username="camila", password="k7-m2x9q")


@pytest.mark.parametrize("password", [PASSWORD, "qw3r-ty", "password1234"])
def test_it_never_logs_the_password(monkeypatch, caplog, password):
    monkeypatch.setenv(VARIABLE, password)
    caplog.set_level(0)

    stdout, stderr = io.StringIO(), io.StringIO()
    try:
        call_command("create_editor", "camila", stdout=stdout, stderr=stderr)
    except CommandError as error:
        assert password not in str(error)

    assert password not in caplog.text
    assert password not in stdout.getvalue() + stderr.getvalue()


def test_a_database_failure_does_not_leak_the_password(monkeypatch):
    monkeypatch.setenv(VARIABLE, PASSWORD)
    with mock.patch.object(UserRecord.objects, "get_or_create", side_effect=OperationalError):
        message = failure("camila")

    assert PASSWORD not in message
