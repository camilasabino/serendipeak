from collections.abc import Callable, Sequence
from dataclasses import dataclass

from serendipeak.catalog.entities import Mountain, MountainStatus
from serendipeak.catalog.publication import PublicationViolation

_ALLOWED = frozenset(
    {
        (MountainStatus.DRAFT, MountainStatus.ACTIVE),
        (MountainStatus.ACTIVE, MountainStatus.INACTIVE),
        (MountainStatus.INACTIVE, MountainStatus.ACTIVE),
    }
)

Gate = Callable[[Mountain], Sequence[PublicationViolation]]


@dataclass(frozen=True, slots=True)
class StatusTransition:
    source: MountainStatus
    target: MountainStatus

    def __post_init__(self):
        if (self.source, self.target) not in _ALLOWED:
            raise ValueError(f"{self.source.value} to {self.target.value} is not allowed")


PUBLISH = StatusTransition(MountainStatus.DRAFT, MountainStatus.ACTIVE)
DEACTIVATE = StatusTransition(MountainStatus.ACTIVE, MountainStatus.INACTIVE)
REACTIVATE = StatusTransition(MountainStatus.INACTIVE, MountainStatus.ACTIVE)
