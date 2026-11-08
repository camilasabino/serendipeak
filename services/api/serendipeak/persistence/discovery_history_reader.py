from collections.abc import Sequence
from datetime import date

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.entities import DiscoveryHistoryEntry
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.models import DailyDiscoveryRecord


class DjangoDiscoveryHistoryReader:
    def list_between(self, first: date, last: date) -> Sequence[DiscoveryHistoryEntry]:
        # One statement over the primary key range, joined to the mountain for the three columns
        # the list shows, so the number of rows never changes the number of queries.
        with translate_database_errors():
            rows = list(
                DailyDiscoveryRecord.objects.filter(date__range=(first, last)).values_list(
                    "date",
                    "mountain__slug",
                    "mountain__name_en",
                    "mountain__status",
                    "created_at",
                )
            )

        return tuple(
            DiscoveryHistoryEntry(
                date=day,
                mountain_slug=slug,
                mountain_name=name,
                mountain_status=MountainStatus(status),
                recorded_at=recorded_at,
            )
            for day, slug, name, status, recorded_at in rows
        )
