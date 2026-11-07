from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import InvalidUsername
from serendipeak.accounts.ports import UserStore
from serendipeak.accounts.roles import Role
from serendipeak.accounts.username import USERNAME_RULE, is_valid_username


class CreateUser:
    def __init__(self, users: UserStore):
        self._users = users

    def execute(self, username: str, role: Role, password: str) -> User:
        if not is_valid_username(username):
            raise InvalidUsername(USERNAME_RULE)

        return self._users.create(username, role, password)
