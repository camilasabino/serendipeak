from uuid import UUID

from django.db import transaction
from django.db.models.functions import Now

from serendipeak.catalog.entities import CanonicalCamera
from serendipeak.catalog.ports import CameraChange
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import camera_columns, to_camera
from serendipeak.persistence.models import MountainRecord

CAMERA_COLUMNS = tuple(camera_columns(None))


class DjangoMountainCameraStore:
    def replace_camera(
        self,
        mountain_id: UUID,
        camera: CanonicalCamera,
        expected: CanonicalCamera | None,
    ) -> CameraChange:
        with translate_database_errors(), transaction.atomic():
            # The mountain row is the first lock, as in the status store and the Admin. A key
            # is not changed, so FOR NO KEY UPDATE is enough: it still waits for both of them
            # but not for a daily discovery that references the mountain.
            record = (
                MountainRecord.objects.select_for_update(no_key=True)
                .only(*CAMERA_COLUMNS)
                .filter(pk=mountain_id)
                .first()
            )
            if record is None:
                return CameraChange.NOT_FOUND
            if to_camera(record) != expected:
                return CameraChange.STALE

            MountainRecord.objects.filter(pk=mountain_id).update(
                **camera_columns(camera),
                updated_at=Now(),
            )

        return CameraChange.APPLIED
