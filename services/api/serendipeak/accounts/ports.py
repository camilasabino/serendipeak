from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from serendipeak.accounts.access import Access, AccessRule, AccessViolation
from serendipeak.accounts.entities import User
from serendipeak.accounts.roles import Role


class AccessChangeOutcome(StrEnum):
    APPLIED = "applied"
    NOT_FOUND = "not_found"
    REFUSED = "refused"


@dataclass(frozen=True, slots=True)
class AccessChange:
    outcome: AccessChangeOutcome
    user: User | None = None
    violation: AccessViolation | None = None


class UserStore(Protocol):
    def create(self, username: str, role: Role, password: str) -> User:
        """Store a new active user whose password is hashed, and return it.

        Raises PasswordRejected when the configured password policy refuses the password and
        UsernameTaken when another user already has the username; nothing is stored then.
        """

    def change_access(
        self,
        actor_id: UUID,
        target_id: UUID,
        desired: Access,
        rule: AccessRule,
    ) -> AccessChange:
        """Give the target user the desired role and active state, atomically.

        The actor, the target and every active Editor are read and the change is written under
        one lock, so concurrent access changes run one at a time and the rule judges exactly the
        state that is then written. A non-empty answer of the rule refuses the change and nothing
        is written. An unknown target gives NOT_FOUND; an unknown actor is refused as not being
        an Editor.

        APPLIED carries the changed user; REFUSED carries the violation.
        """
