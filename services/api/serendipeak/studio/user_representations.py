from dataclasses import dataclass
from uuid import UUID

from serendipeak.accounts.entities import User


@dataclass(frozen=True, slots=True)
class UserRow:
    user: User
    is_you: bool


def list_context(users: tuple[User, ...], current_user_id: UUID) -> dict:
    return {
        "rows": [UserRow(user, user.id == current_user_id) for user in users],
        "total": len(users),
        "active_editors": sum(1 for user in users if user.is_active and user.role.can_write),
    }


def edit_context(user: User, form, current_user_id: UUID) -> dict:
    return {"account": user, "form": form, "is_you": user.id == current_user_id}


def password_context(user: User, form) -> dict:
    return {"account": user, "form": form}
