from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.accounts.roles import Role


@dataclass(frozen=True, slots=True)
class Access:
    role: Role
    is_active: bool

    @property
    def is_active_editor(self) -> bool:
        return self.is_active and self.role is Role.EDITOR


@dataclass(frozen=True, slots=True)
class Account:
    id: UUID
    access: Access


class AccessViolation(StrEnum):
    ACTOR_NOT_EDITOR = "actor_not_editor"
    SELF_DEACTIVATION = "self_deactivation"
    SELF_DEMOTION = "self_demotion"
    LAST_ACTIVE_EDITOR = "last_active_editor"
    CHANGED_MEANWHILE = "changed_meanwhile"
    OWN_PASSWORD = "own_password"


@dataclass(frozen=True, slots=True)
class AccessChangeContext:
    """The state an access change is judged against, read under the store's lock."""

    actor: Account
    target: Account
    desired: Access
    active_editors: int
    # What the person editing was shown; set only by callers that must not overwrite a newer change.
    expected: Access | None = None


AccessRule = Callable[[AccessChangeContext], AccessViolation | None]


def access_violation(context: AccessChangeContext) -> AccessViolation | None:
    actor, target, desired = context.actor, context.target, context.desired

    if not actor.access.is_active_editor:
        return AccessViolation.ACTOR_NOT_EDITOR

    if context.expected is not None and context.expected != target.access:
        return AccessViolation.CHANGED_MEANWHILE

    if actor.id == target.id:
        if target.access.is_active and not desired.is_active:
            return AccessViolation.SELF_DEACTIVATION
        if target.access.role is Role.EDITOR and desired.role is not Role.EDITOR:
            return AccessViolation.SELF_DEMOTION

    editors_lost = int(target.access.is_active_editor and not desired.is_active_editor)
    if context.active_editors - editors_lost < 1:
        return AccessViolation.LAST_ACTIVE_EDITOR

    return None
