from serendipeak.discovery.clock import Clock
from serendipeak.discovery.entities import DiscoveryHistory
from serendipeak.discovery.ports import DiscoveryHistoryReader
from serendipeak.discovery.retention import retention_cutoff


class ListDailyDiscoveries:
    def __init__(self, reader: DiscoveryHistoryReader, clock: Clock):
        self._reader = reader
        self._clock = clock

    def execute(self) -> DiscoveryHistory:
        """The discoveries inside the retention window, newest first.

        An expired discovery the cleanup has not removed yet is not shown, so the list never
        outgrows the window (366 days, today included).
        """
        today = self._clock.today()
        kept_since = retention_cutoff(today)
        entries = self._reader.list_between(kept_since, today)

        return DiscoveryHistory(
            today=today,
            kept_since=kept_since,
            entries=tuple(sorted(entries, key=lambda entry: entry.date, reverse=True)),
        )
