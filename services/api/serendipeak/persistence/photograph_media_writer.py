from uuid import UUID

from django.db import transaction

from serendipeak.catalog.bootstrap.ports import AttachOutcome
from serendipeak.catalog.entities import ImageDimensions, PhotographMedia
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_primary_image
from serendipeak.persistence.models import MountainImageRecord, MountainRecord


class DjangoPhotographMediaWriter:
    def attach_media(
        self,
        mountain_id: UUID,
        expected_file_url: str,
        expected_dimensions: ImageDimensions,
        media: PhotographMedia,
    ) -> AttachOutcome:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            # Mountain first, then image: the order the Admin and the status store lock in,
            # so an edit in flight finishes before the photograph is compared.
            if not MountainRecord.objects.select_for_update().filter(pk=mountain_id).exists():
                return AttachOutcome.NOT_FOUND

            image = MountainImageRecord.objects.select_for_update().filter(pk=mountain_id).first()
            if image is None:
                return AttachOutcome.NOT_FOUND

            current = to_primary_image(image)
            if current.media is not None:
                return (
                    AttachOutcome.ALREADY_ATTACHED
                    if current.media == media
                    else AttachOutcome.STALE
                )
            if (
                image.legacy_file_url != expected_file_url
                or current.dimensions != expected_dimensions
            ):
                return AttachOutcome.STALE

            # The lock already guarantees the compared state; the predicate keeps the write
            # safe if the lock is ever removed or moved. updated_at stays: attaching media is
            # not an editorial change, and the seed verification compares updated_at.
            updated = MountainImageRecord.objects.filter(
                pk=mountain_id,
                original_key__isnull=True,
                legacy_file_url=expected_file_url,
            ).update(
                original_key=media.original_key,
                original_sha256=media.original_sha256,
                page_key=media.page_key,
                viewer_key=media.viewer_key,
            )
            if updated != 1:
                raise InfrastructureError(
                    f"the photograph of mountain {mountain_id} changed while it was locked"
                )

        return AttachOutcome.APPLIED
