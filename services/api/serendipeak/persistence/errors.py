from collections.abc import Iterator
from contextlib import contextmanager

from django.db import Error

from serendipeak.errors import InfrastructureError


@contextmanager
def translate_database_errors() -> Iterator[None]:
    try:
        yield
    except Error as error:
        raise InfrastructureError("the database operation failed") from error
