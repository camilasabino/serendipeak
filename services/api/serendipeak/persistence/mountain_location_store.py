from uuid import UUID

from django.db import transaction
from django.db.models.functions import Now

from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.relocation import RelocationOutcome, RelocationRule
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import camera_columns, to_coordinates, to_point
from serendipeak.persistence.models import MountainRecord


class DjangoMountainLocationStore:
    def relocate(
        self,
        mountain_id: UUID,
        coordinates: Coordinates,
        rule: RelocationRule,
    ) -> RelocationOutcome:
        with translate_database_errors(), transaction.atomic():
            # The same first lock as the camera store, the status store and the Admin. A key is
            # not changed, so FOR NO KEY UPDATE still waits for each of them, publication
            # included, but not for a daily discovery that references the mountain.
            record = (
                MountainRecord.objects.select_for_update(no_key=True)
                .only("status", "location")
                .filter(pk=mountain_id)
                .first()
            )
            if record is None:
                return RelocationOutcome.NOT_FOUND

            outcome = rule(MountainStatus(record.status), to_coordinates(record))
            if outcome is not RelocationOutcome.APPLIED:
                return outcome

            # One statement, so the new location is never visible with the camera composed on the
            # old one, and the camera check constraints see the cleared columns together.
            MountainRecord.objects.filter(pk=mountain_id).update(
                location=to_point(coordinates),
                **camera_columns(None),
                updated_at=Now(),
            )

        return outcome
