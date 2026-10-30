import hashlib
from collections.abc import Iterable
from datetime import date, timedelta

from serendipeak.discovery.entities import RecentDiscovery

RECENT_WINDOW_DAYS = 30


def recent_window(day: date) -> tuple[date, date]:
    return day - timedelta(days=RECENT_WINDOW_DAYS), day - timedelta(days=1)


def select_daily_slug(
    day: date,
    slugs: Iterable[str],
    recent: Iterable[RecentDiscovery],
) -> str:
    candidates = sorted(set(slugs))
    if not candidates:
        raise ValueError("selecting a daily mountain needs at least one candidate")

    first, last = recent_window(day)
    excluded = {discovery.slug for discovery in recent if first <= discovery.date <= last}
    fresh = [slug for slug in candidates if slug not in excluded]
    if fresh:
        candidates = fresh

    return candidates[_selection_index(day, len(candidates))]


def _selection_index(day: date, count: int) -> int:
    digest = hashlib.sha256(day.isoformat().encode("ascii")).digest()

    return int.from_bytes(digest[:8], "big") % count
