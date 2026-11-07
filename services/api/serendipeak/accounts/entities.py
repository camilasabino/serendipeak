from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from serendipeak.accounts.roles import Role


@dataclass(frozen=True, slots=True)
class User:
    id: UUID
    username: str
    role: Role
    is_active: bool
    last_login: datetime | None
    date_joined: datetime
