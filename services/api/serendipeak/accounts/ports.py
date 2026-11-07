from dataclasses import dataclass
from datetime import datetime
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


@dataclass(frozen=True, slots=True)
class RecordedLoginAttempt:
    attempt_id: int
    by_username: int
    by_address: int


class LoginAttemptLog(Protocol):
    def record(
        self,
        *,
        username_key: str,
        address: str,
        at: datetime,
        window_start: datetime,
    ) -> RecordedLoginAttempt:
        """Store one attempt and count the attempts since the window start.

        Attempts older than the window start are dropped. The counts include the attempt just
        stored and every attempt committed before the count was read: those for the username key
        and those for the address.
        """

    def discard(self, attempt_id: int) -> None:
        """Remove one stored attempt; an unknown id is ignored."""

    def forget_username(self, username_key: str) -> None:
        """Remove every stored attempt of the username key."""
