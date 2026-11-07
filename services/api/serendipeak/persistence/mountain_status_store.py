from uuid import UUID

from django.db import transaction
from django.db.models.functions import Now

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChange, StatusChangeOutcome
from serendipeak.catalog.status_transitions import Gate, StatusTransition
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import load_countries, to_mountain
from serendipeak.persistence.models import MountainRecord


class DjangoMountainStatusStore:
    def change_status(
        self,
        mountain_id: UUID,
        transition: StatusTransition,
        gate: Gate,
    ) -> StatusChange:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            # The Admin updates the mountain row before it touches the image and the country
            # links, so an edit in flight holds this lock. The image and the countries are read
            # by later statements, not joined here: after waiting for the lock PostgreSQL
            # rechecks the locked row but keeps the snapshot of the joined one, which would
            # hand the gate a stale image. The continent is joined because reference data never
            # changes, and only the mountain row is locked.
            record = (
                MountainRecord.objects.select_related("continent")
                .select_for_update(of=("self",))
                .filter(pk=mountain_id)
                .first()
            )
            if record is None:
                return StatusChange(StatusChangeOutcome.NOT_FOUND, None)

            current = MountainStatus(record.status)
            if current is not transition.source:
                return StatusChange(StatusChangeOutcome.WRONG_STATUS, current)

            load_countries(record)
            violations = tuple(gate(to_mountain(record)))
            if violations:
                return StatusChange(StatusChangeOutcome.REJECTED, current, violations)

            # The lock already guarantees the source status; the predicate keeps the write
            # safe if the lock is ever removed or moved.
            updated = MountainRecord.objects.filter(
                pk=mountain_id,
                status=transition.source.value,
            ).update(
                status=transition.target.value,
                updated_at=Now(),
            )
            if updated != 1:
                raise InfrastructureError(
                    f"mountain {mountain_id} left {transition.source.value} while it was locked"
                )

        return StatusChange(StatusChangeOutcome.APPLIED, transition.target)
