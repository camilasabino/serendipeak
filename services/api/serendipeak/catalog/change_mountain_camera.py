from uuid import UUID

from serendipeak.catalog.camera import camera_violations
from serendipeak.catalog.entities import CanonicalCamera
from serendipeak.catalog.errors import CameraChanged, CameraRejected, UnknownMountain
from serendipeak.catalog.ports import CameraChange, MountainCameraStore


class ChangeMountainCamera:
    def __init__(self, cameras: MountainCameraStore):
        self._cameras = cameras

    def execute(
        self,
        mountain_id: UUID,
        camera: CanonicalCamera,
        expected: CanonicalCamera | None,
    ) -> None:
        # The camera rules are the publication gate's own, and nothing else a camera change
        # can affect is judged by the gate, so a public mountain stays publishable.
        violations = camera_violations(camera)
        if violations:
            raise CameraRejected(violations)

        match self._cameras.replace_camera(mountain_id, camera, expected):
            case CameraChange.APPLIED:
                return
            case CameraChange.NOT_FOUND:
                raise UnknownMountain(mountain_id)
            case CameraChange.STALE:
                raise CameraChanged(mountain_id)
