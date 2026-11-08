from uuid import UUID

from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import UnknownUser
from serendipeak.accounts.ports import UserReader


class ListUsers:
    def __init__(self, reader: UserReader):
        self._reader = reader

    def execute(self) -> tuple[User, ...]:
        """Every user, inactive ones included, by username."""
        return tuple(sorted(self._reader.list_all(), key=lambda user: user.username))


class GetUser:
    def __init__(self, reader: UserReader):
        self._reader = reader

    def execute(self, user_id: UUID) -> User:
        user = self._reader.find_by_id(user_id)
        if user is None:
            raise UnknownUser(user_id)

        return user
