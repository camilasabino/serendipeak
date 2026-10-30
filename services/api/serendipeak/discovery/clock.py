from datetime import UTC, date, datetime
from typing import Protocol


class Clock(Protocol):
    def today(self) -> date:
        """Return the current UTC calendar date."""


class SystemUtcClock:
    def today(self) -> date:
        return datetime.now(UTC).date()
