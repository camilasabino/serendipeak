from uuid import UUID

from serendipeak.accounts.access import AccessViolation
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import AccessRefused, UnknownUser
from serendipeak.accounts.ports import AccessChangeOutcome, UserStore


class SetUserPassword:
    """An Editor gives another user a new password.

    Your own password is changed with the current one (the account menu), so this path, which
    does not ask for it, refuses the actor's own account.
    """

    def __init__(self, users: UserStore):
        self._users = users

    def execute(self, actor_id: UUID, target_id: UUID, password: str) -> User:
        if actor_id == target_id:
            raise AccessRefused(AccessViolation.OWN_PASSWORD)

        change = self._users.set_password(actor_id, target_id, password)

        match change.outcome:
            case AccessChangeOutcome.APPLIED:
                return change.user
            case AccessChangeOutcome.REFUSED:
                raise AccessRefused(change.violation)
            case AccessChangeOutcome.NOT_FOUND:
                raise UnknownUser(target_id)
