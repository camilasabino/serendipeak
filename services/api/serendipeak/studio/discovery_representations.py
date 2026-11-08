from dataclasses import dataclass

from serendipeak.discovery.entities import DiscoveryHistory, DiscoveryHistoryEntry
from serendipeak.studio.representations import StatusPresentation, status_presentation


@dataclass(frozen=True, slots=True)
class DiscoveryRow:
    entry: DiscoveryHistoryEntry
    status: StatusPresentation
    is_today: bool


def list_context(history: DiscoveryHistory) -> dict:
    return {
        "rows": [
            DiscoveryRow(
                entry=entry,
                status=status_presentation(entry.mountain_status),
                is_today=entry.date == history.today,
            )
            for entry in history.entries
        ],
        "kept_since": history.kept_since,
    }
