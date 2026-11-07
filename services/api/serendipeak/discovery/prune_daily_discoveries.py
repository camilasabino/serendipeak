from serendipeak.discovery.clock import Clock
from serendipeak.discovery.entities import PruneResult
from serendipeak.discovery.ports import DailyDiscoveryRepository
from serendipeak.discovery.retention import retention_cutoff


class PruneDailyDiscoveries:
    def __init__(self, discoveries: DailyDiscoveryRepository, clock: Clock):
        self._discoveries = discoveries
        self._clock = clock

    def execute(self) -> PruneResult:
        cutoff = retention_cutoff(self._clock.today())
        deleted = self._discoveries.delete_before(cutoff)

        return PruneResult(cutoff=cutoff, deleted=deleted)
