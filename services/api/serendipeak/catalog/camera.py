from enum import StrEnum

from serendipeak.catalog.entities import CanonicalCamera

HEADING_MIN_DEGREES = 0.0
HEADING_MAX_DEGREES_EXCLUSIVE = 360.0

PITCH_MIN_DEGREES = -60.0
PITCH_MAX_DEGREES = 15.0

RANGE_MIN_METERS = 2000.0
RANGE_MAX_METERS = 80000.0

FRAMING_MIN = -1.0
FRAMING_MAX = 1.0


class CameraViolation(StrEnum):
    OUT_OF_BOUNDS = "out_of_bounds"
    FRAMING_MISSING = "framing_missing"
    FRAMING_OUT_OF_BOUNDS = "framing_out_of_bounds"


def camera_violations(camera: CanonicalCamera) -> tuple[CameraViolation, ...]:
    # Written as inclusion tests so that NaN, which compares false, is out of bounds.
    violations = []

    if not (
        HEADING_MIN_DEGREES <= camera.heading_degrees < HEADING_MAX_DEGREES_EXCLUSIVE
        and PITCH_MIN_DEGREES <= camera.pitch_degrees <= PITCH_MAX_DEGREES
        and RANGE_MIN_METERS <= camera.range_meters <= RANGE_MAX_METERS
    ):
        violations.append(CameraViolation.OUT_OF_BOUNDS)

    if camera.framing is None:
        violations.append(CameraViolation.FRAMING_MISSING)
    elif not (
        FRAMING_MIN <= camera.framing.x <= FRAMING_MAX
        and FRAMING_MIN <= camera.framing.y <= FRAMING_MAX
    ):
        violations.append(CameraViolation.FRAMING_OUT_OF_BOUNDS)

    return tuple(violations)
