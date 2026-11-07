from uuid import UUID

from serendipeak.catalog.coordinates import coordinates_in_range
from serendipeak.catalog.entities import Coordinates
from serendipeak.catalog.errors import (
    ActiveMountainLocationLocked,
    CameraResetNotConfirmed,
    CoordinatesRejected,
    UnknownMountain,
)
from serendipeak.catalog.ports import MountainLocationStore
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation


class ChangeMountainLocation:
    def __init__(self, locations: MountainLocationStore):
        self._locations = locations

    def execute(
        self,
        mountain_id: UUID,
        coordinates: Coordinates,
        camera_reset_confirmed: bool,
    ) -> RelocationOutcome:
        """Move a draft or inactive mountain, clearing its camera, or report why it cannot.

        Returns APPLIED when the location and the camera were rewritten and UNCHANGED when the
        coordinates already were these, which writes nothing and keeps the camera.
        """
        if not coordinates_in_range(coordinates.latitude, coordinates.longitude):
            raise CoordinatesRejected("the coordinates are out of range")

        outcome = self._locations.relocate(
            mountain_id,
            coordinates,
            lambda status, stored: judge_relocation(
                status, stored, coordinates, camera_reset_confirmed
            ),
        )

        match outcome:
            case RelocationOutcome.APPLIED | RelocationOutcome.UNCHANGED:
                return outcome
            case RelocationOutcome.NOT_FOUND:
                raise UnknownMountain(mountain_id)
            case RelocationOutcome.CONFIRMATION_REQUIRED:
                raise CameraResetNotConfirmed
            case RelocationOutcome.ACTIVE_MOUNTAIN:
                raise ActiveMountainLocationLocked
