from django.core.management.base import CommandError

from serendipeak.errors import ApplicationError, InfrastructureError


def command_error(error: ApplicationError | InfrastructureError) -> CommandError:
    if isinstance(error, InfrastructureError) and error.__cause__ is not None:
        return CommandError(f"{error}: {error.__cause__}")
    return CommandError(str(error))
