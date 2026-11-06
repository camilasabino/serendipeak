import math
from dataclasses import replace

import pytest

from serendipeak.catalog import camera
from serendipeak.catalog.camera import CameraViolation
from serendipeak.catalog.entities import CameraFraming, CanonicalCamera
from tests.support.contract_fixtures import load_frozen_catalog


def test_bounds_match_the_v1_canonical_camera_contract():
    assert (camera.HEADING_MIN_DEGREES, camera.HEADING_MAX_DEGREES_EXCLUSIVE) == (0, 360)
    assert (camera.PITCH_MIN_DEGREES, camera.PITCH_MAX_DEGREES) == (-60, 15)
    assert (camera.RANGE_MIN_METERS, camera.RANGE_MAX_METERS) == (2000, 80000)
    assert (camera.FRAMING_MIN, camera.FRAMING_MAX) == (-1, 1)


def test_every_frozen_catalog_camera_is_within_bounds():
    for mountain in load_frozen_catalog():
        pose = mountain["camera"]
        framing = pose["framing"]
        assert (
            camera.HEADING_MIN_DEGREES
            <= pose["headingDegrees"]
            < camera.HEADING_MAX_DEGREES_EXCLUSIVE
        )
        assert camera.PITCH_MIN_DEGREES <= pose["pitchDegrees"] <= camera.PITCH_MAX_DEGREES
        assert camera.RANGE_MIN_METERS <= pose["rangeMeters"] <= camera.RANGE_MAX_METERS
        assert camera.FRAMING_MIN <= framing["x"] <= camera.FRAMING_MAX
        assert camera.FRAMING_MIN <= framing["y"] <= camera.FRAMING_MAX


FRAMED = CanonicalCamera(
    heading_degrees=0.0,
    pitch_degrees=-60.0,
    range_meters=80000.0,
    framing=CameraFraming(x=-1.0, y=1.0),
)


def test_bounds_are_inclusive_except_the_heading_maximum():
    assert camera.camera_violations(FRAMED) == ()
    assert camera.camera_violations(replace(FRAMED, heading_degrees=359.99)) == ()
    assert camera.camera_violations(replace(FRAMED, heading_degrees=360.0)) == (
        CameraViolation.OUT_OF_BOUNDS,
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"heading_degrees": -0.01},
        {"pitch_degrees": 15.01},
        {"pitch_degrees": -60.01},
        {"range_meters": 1999.9},
        {"range_meters": 80000.1},
        {"heading_degrees": math.nan},
        {"range_meters": math.inf},
    ],
)
def test_a_pose_outside_the_bounds_or_not_a_number_is_out_of_bounds(changes):
    assert camera.camera_violations(replace(FRAMED, **changes)) == (CameraViolation.OUT_OF_BOUNDS,)


@pytest.mark.parametrize(
    ("framing", "violation"),
    [
        (None, CameraViolation.FRAMING_MISSING),
        (CameraFraming(x=1.01, y=0.0), CameraViolation.FRAMING_OUT_OF_BOUNDS),
        (CameraFraming(x=0.0, y=math.nan), CameraViolation.FRAMING_OUT_OF_BOUNDS),
    ],
)
def test_the_framing_is_required_and_bounded(framing, violation):
    assert camera.camera_violations(replace(FRAMED, framing=framing)) == (violation,)
