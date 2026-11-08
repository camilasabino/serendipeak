from collections.abc import Sequence
from uuid import UUID

from serendipeak.accounts.entities import User
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_user
from serendipeak.persistence.models import UserRecord


class DjangoUserReader:
    def list_all(self) -> Sequence[User]:
        with translate_database_errors():
            records = list(_without_password().order_by("username"))

        return tuple(to_user(record) for record in records)

    def find_by_id(self, user_id: UUID) -> User | None:
        with translate_database_errors():
            record = _without_password().filter(pk=user_id).first()

        return None if record is None else to_user(record)


def _without_password():
    # The screens never show a credential, so the hash is not even read.
    return UserRecord.objects.defer("password")
