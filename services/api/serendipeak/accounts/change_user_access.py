from dataclasses import replace
from uuid import UUID

from serendipeak.accounts.access import (
    Access,
    AccessChangeContext,
    AccessViolation,
    access_violation,
)
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import AccessRefused, UnknownUser
from serendipeak.accounts.ports import AccessChangeOutcome, UserStore
from serendipeak.accounts.roles import Role


class ChangeUserAccess:
    def __init__(self, users: UserStore):
        self._users = users

    def execute(
        self,
        actor_id: UUID,
        target_id: UUID,
        role: Role,
        is_active: bool,
        *,
        expected: Access | None = None,
    ) -> User:
        """Give the target the role and active state, unless the guards refuse.

        With expected, the change also refuses when the target no longer has that access, so a
        form shown before a colleague's change cannot silently undo it.
        """

        def rule(context: AccessChangeContext) -> AccessViolation | None:
            return access_violation(replace(context, expected=expected))

        change = self._users.change_access(actor_id, target_id, Access(role, is_active), rule)

        match change.outcome:
            case AccessChangeOutcome.APPLIED:
                return change.user
            case AccessChangeOutcome.REFUSED:
                raise AccessRefused(change.violation)
            case AccessChangeOutcome.NOT_FOUND:
                raise UnknownUser(target_id)
