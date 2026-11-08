from serendipeak.accounts.roles import Role
from serendipeak.cli.management.commands import create_editor

PASSWORD_ENVIRONMENT_VARIABLE = "SERENDIPEAK_VIEWER_PASSWORD"


class Command(create_editor.Command):
    role = Role.VIEWER
    password_variable = PASSWORD_ENVIRONMENT_VARIABLE
    help = (
        "Create an active Viewer, who can read the Studio but change nothing. The password is "
        f"read from the environment variable {PASSWORD_ENVIRONMENT_VARIABLE} when it is set, and "
        "otherwise prompted for twice. It is never accepted as an argument. The password must "
        "have at least 8 characters and not be a common one."
    )
