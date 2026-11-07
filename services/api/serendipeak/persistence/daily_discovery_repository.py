from collections.abc import Sequence
from datetime import date
from uuid import UUID

from serendipeak.discovery.entities import DailyMountain, RecentDiscovery
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_daily_mountain, with_geography
from serendipeak.persistence.models import DailyDiscoveryRecord


class DjangoDailyDiscoveryRepository:
    def find_by_date(self, day: date) -> DailyMountain | None:
        with translate_database_errors():
            record = _with_mountain().filter(date=day).first()

        return None if record is None else to_daily_mountain(record)

    def list_recent(self, first: date, last: date) -> Sequence[RecentDiscovery]:
        with translate_database_errors():
            rows = list(
                DailyDiscoveryRecord.objects.filter(date__range=(first, last))
                .order_by("date")
                .values_list("date", "mountain__slug")
            )

        return tuple(RecentDiscovery(date=day, slug=slug) for day, slug in rows)

    def insert_or_get(self, day: date, mountain_id: UUID) -> DailyMountain:
        # ON CONFLICT DO NOTHING: a concurrent insert of the same date waits for the first one
        # to finish and then inserts nothing, so the re-read sees the committed winner.
        # Foreign keys are deferred, so a missing mountain fails when bulk_create's own
        # transaction commits: the translation has to enclose the call, not sit inside it.
        with translate_database_errors():
            DailyDiscoveryRecord.objects.bulk_create(
                [DailyDiscoveryRecord(date=day, mountain_id=mountain_id)],
                ignore_conflicts=True,
            )

        persisted = self.find_by_date(day)
        if persisted is None:
            raise InfrastructureError(f"the discovery of {day.isoformat()} is missing after insert")

        return persisted

    def delete_before(self, cutoff: date) -> int:
        # One DELETE on the primary key. The trigger re-checks every row against the
        # database's own clock, so a wrong cutoff cannot remove a retained discovery.
        with translate_database_errors():
            deleted, _ = DailyDiscoveryRecord.objects.filter(date__lt=cutoff).delete()

        return deleted


def _with_mountain():
    return with_geography(
        DailyDiscoveryRecord.objects.select_related("mountain", "mountain__image"),
        through="mountain",
    )
