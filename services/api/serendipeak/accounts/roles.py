from enum import StrEnum


class Role(StrEnum):
    EDITOR = "editor"
    VIEWER = "viewer"

    @property
    def can_write(self) -> bool:
        return self is Role.EDITOR
