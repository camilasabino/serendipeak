import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.status_transitions import (
    DEACTIVATE,
    PUBLISH,
    REACTIVATE,
    StatusTransition,
)

DRAFT = MountainStatus.DRAFT
ACTIVE = MountainStatus.ACTIVE
INACTIVE = MountainStatus.INACTIVE


def test_the_named_transitions_are_draft_to_active_and_active_to_inactive_both_ways():
    assert (PUBLISH.source, PUBLISH.target) == (DRAFT, ACTIVE)
    assert (DEACTIVATE.source, DEACTIVATE.target) == (ACTIVE, INACTIVE)
    assert (REACTIVATE.source, REACTIVATE.target) == (INACTIVE, ACTIVE)


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (ACTIVE, DRAFT),
        (INACTIVE, DRAFT),
        (DRAFT, INACTIVE),
        (DRAFT, DRAFT),
        (ACTIVE, ACTIVE),
        (INACTIVE, INACTIVE),
    ],
)
def test_no_other_transition_exists(source, target):
    with pytest.raises(ValueError, match="not allowed"):
        StatusTransition(source, target)
