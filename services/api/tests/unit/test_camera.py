from serendipeak.catalog import camera
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
