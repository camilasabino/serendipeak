from uuid import UUID

from django.db import IntegrityError, connection, transaction

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotDraft, MountainReferenced, UnknownMountain
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)


class DjangoDraftMountainDeletionStore:
    def delete_draft(self, mountain_id: UUID) -> None:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            # FOR UPDATE, not the NO KEY lock of the writers: the key is about to disappear. The
            # status is judged only after the wait, so a concurrent publication has committed
            # or is waiting behind this delete and then finds no mountain.
            record = (
                MountainRecord.objects.select_for_update(of=("self",))
                .filter(pk=mountain_id)
                .first()
            )
            if record is None:
                raise UnknownMountain(mountain_id)

            status = MountainStatus(record.status)
            if status is not MountainStatus.DRAFT:
                raise MountainNotDraft(mountain_id, status)

            try:
                # A savepoint, so a reference can be diagnosed after a failure; the outer block
                # is then rolled back by the application error. The foreign keys are PROTECT
                # and deferred, so the dependents go first and the check runs before leaving.
                with transaction.atomic():
                    MountainCountryRecord.objects.filter(mountain_id=mountain_id).delete()
                    MountainImageRecord.objects.filter(pk=mountain_id).delete()
                    MountainRecord.objects.filter(pk=mountain_id).delete()
                    connection.check_constraints()
            except IntegrityError as error:
                if DailyDiscoveryRecord.objects.filter(mountain_id=mountain_id).exists():
                    raise MountainReferenced(mountain_id) from error
                raise
