from uuid import UUID

from serendipeak.accounts.access import Access, access_violation
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import AccessRefused, UnknownUser
from serendipeak.accounts.ports import AccessChangeOutcome, UserStore
from serendipeak.accounts.roles import Role


class ChangeUserAccess:
    def __init__(self, users: UserStore):
        self._users = users

    def execute(self, actor_id: UUID, target_id: UUID, role: Role, is_active: bool) -> User:
        change = self._users.change_access(
            actor_id, target_id, Access(role, is_active), access_violation
        )

        match change.outcome:
            case AccessChangeOutcome.APPLIED:
                return change.user
            case AccessChangeOutcome.REFUSED:
                raise AccessRefused(change.violation)
            case AccessChangeOutcome.NOT_FOUND:
                raise UnknownUser(target_id)
