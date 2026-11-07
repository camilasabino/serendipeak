import pytest

from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation

STORED = Coordinates(latitude=-32.6531487, longitude=-70.0119607)
DRAFT = MountainStatus.DRAFT
ACTIVE = MountainStatus.ACTIVE
INACTIVE = MountainStatus.INACTIVE


@pytest.mark.parametrize("status", list(MountainStatus))
@pytest.mark.parametrize("confirmed", [False, True])
def test_the_same_coordinates_change_nothing_in_any_status(status, confirmed):
    assert judge_relocation(status, STORED, STORED, confirmed) is RelocationOutcome.UNCHANGED


@pytest.mark.parametrize(
    "requested",
    [
        Coordinates(latitude=-32.6531488, longitude=STORED.longitude),
        Coordinates(latitude=STORED.latitude, longitude=-70.0119608),
        Coordinates(latitude=0.0, longitude=0.0),
    ],
    ids=["latitude-only", "longitude-only", "both"],
)
class TestAChangedLocation:
    @pytest.mark.parametrize("status", [DRAFT, INACTIVE])
    def test_a_draft_or_inactive_mountain_needs_the_confirmation(self, status, requested):
        outcome = judge_relocation(status, STORED, requested, camera_reset_confirmed=False)

        assert outcome is RelocationOutcome.CONFIRMATION_REQUIRED

    @pytest.mark.parametrize("status", [DRAFT, INACTIVE])
    def test_a_confirmed_move_is_applied(self, status, requested):
        assert judge_relocation(status, STORED, requested, True) is RelocationOutcome.APPLIED

    @pytest.mark.parametrize("confirmed", [False, True])
    def test_an_active_mountain_is_refused_whatever_was_confirmed(self, requested, confirmed):
        outcome = judge_relocation(ACTIVE, STORED, requested, confirmed)

        assert outcome is RelocationOutcome.ACTIVE_MOUNTAIN


def test_the_comparison_is_exact_not_approximate():
    nearly = Coordinates(latitude=STORED.latitude + 1e-12, longitude=STORED.longitude)

    assert judge_relocation(DRAFT, STORED, nearly, True) is RelocationOutcome.APPLIED
