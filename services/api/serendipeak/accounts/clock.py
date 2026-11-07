from datetime import UTC, datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime:
        """Return the current instant as an aware UTC datetime."""


class SystemUtcClock:
    def now(self) -> datetime:
        return datetime.now(UTC)
