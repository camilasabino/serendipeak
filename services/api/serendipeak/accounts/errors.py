from uuid import UUID

from serendipeak.accounts.access import AccessViolation
from serendipeak.errors import ApplicationError, DomainError


class InvalidUsername(DomainError):
    def __init__(self, rule: str):
        super().__init__(rule)
        self.rule = rule


class UsernameTaken(ApplicationError):
    def __init__(self, username: str):
        super().__init__(f"the username {username!r} is already in use")
        self.username = username


class PasswordRejected(ApplicationError):
    def __init__(self, reasons: tuple[str, ...]):
        super().__init__(" ".join(reasons))
        self.reasons = reasons


class UnknownUser(ApplicationError):
    def __init__(self, user_id: UUID):
        super().__init__(f"no user has the id {user_id}")
        self.user_id = user_id


ACCESS_REFUSAL_MESSAGES = {
    AccessViolation.ACTOR_NOT_EDITOR: "Only an active Editor can change access.",
    AccessViolation.SELF_DEACTIVATION: "You cannot deactivate your own account.",
    AccessViolation.SELF_DEMOTION: "You cannot change your own role.",
    AccessViolation.LAST_ACTIVE_EDITOR: "The last active Editor cannot be demoted or deactivated.",
}


class AccessRefused(DomainError):
    def __init__(self, violation: AccessViolation):
        super().__init__(ACCESS_REFUSAL_MESSAGES[violation])
        self.violation = violation
