import os
import sys
from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from serendipeak.accounts.errors import InvalidUsername, PasswordRejected, UsernameTaken
from serendipeak.accounts.roles import Role
from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError

PASSWORD_ENVIRONMENT_VARIABLE = "SERENDIPEAK_EDITOR_PASSWORD"


class Command(BaseCommand):
    """Also the base of create_viewer: the Studio has no screen that creates an account, so the
    two commands are how every account comes to exist."""

    role = Role.EDITOR
    password_variable = PASSWORD_ENVIRONMENT_VARIABLE
    help = (
        "Create an active Editor. The password is read from the environment variable "
        f"{PASSWORD_ENVIRONMENT_VARIABLE} when it is set, and otherwise prompted for twice. "
        "It is never accepted as an argument, so it stays out of the process list and the shell "
        "history. The password must have at least 8 characters and not be a common one."
    )

    def add_arguments(self, parser):
        parser.add_argument("username")

    def handle(self, *args, username, **options):
        from config import composition

        password = self._password()

        try:
            user = composition.build_create_user().execute(username, self.role, password)
        except InvalidUsername as error:
            raise CommandError(error.rule) from error
        except PasswordRejected as error:
            raise CommandError(f"The password was rejected. {error}") from error
        except UsernameTaken as error:
            raise CommandError(str(error)) from error
        except InfrastructureError as error:
            raise command_error(error) from error

        self.stdout.write(f"Created the {self.role.value.capitalize()} {user.username!r}.")

    def _password(self):
        password = os.environ.get(self.password_variable)
        if password:
            return password

        if not sys.stdin.isatty():
            raise CommandError(f"Set {self.password_variable}: there is no terminal to prompt on.")

        password = getpass("Password: ")
        if getpass("Password (again): ") != password:
            raise CommandError("The passwords did not match.")

        return password
