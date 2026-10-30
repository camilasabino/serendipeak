import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.errors import NoEligibleMountains
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.errors import InfrastructureError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainRepository, RecordingPickIndex

ALPHA = mountain("alpha")
BRAVO = mountain("bravo")
CHARLIE = mountain("charlie")
RETIRED = mountain("retired-peak", status=MountainStatus.INACTIVE)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = [CHARLIE, ALPHA, BRAVO]


def get_random_mountain(mountains, pick_index):
    return GetRandomMountain(InMemoryMountainRepository(mountains), pick_index)


@pytest.mark.parametrize(
    ("index", "expected"),
    [(0, ALPHA), (1, BRAVO), (2, CHARLIE)],
)
def test_the_index_selects_among_the_active_mountains_ordered_by_slug(index, expected):
    pick_index = RecordingPickIndex(index)

    result = get_random_mountain(ACTIVE, pick_index).execute()

    assert result == expected
    assert pick_index.counts == [3]


def test_only_active_mountains_are_candidates():
    pick_index = RecordingPickIndex(*range(3))
    use_case = get_random_mountain([*ACTIVE, RETIRED, DRAFT], pick_index)

    results = [use_case.execute() for _ in range(3)]

    assert results == [ALPHA, BRAVO, CHARLIE]
    assert pick_index.counts == [3, 3, 3]


@pytest.mark.parametrize(
    ("index", "expected"),
    [(0, ALPHA), (1, CHARLIE)],
)
def test_the_excluded_mountain_is_never_returned_when_another_is_active(index, expected):
    pick_index = RecordingPickIndex(index)

    result = get_random_mountain(ACTIVE, pick_index).execute("bravo")

    assert result == expected
    assert pick_index.counts == [2]


@pytest.mark.parametrize("exclude", ["", "unknown-peak", "retired-peak", "draft-peak"])
def test_an_empty_unknown_or_inactive_exclusion_has_no_effect(exclude):
    pick_index = RecordingPickIndex(2)
    use_case = get_random_mountain([*ACTIVE, RETIRED, DRAFT], pick_index)

    result = use_case.execute(exclude)

    assert result == CHARLIE
    assert pick_index.counts == [3]


@pytest.mark.parametrize("exclude", ["Alpha", "alpha ", " alpha", "ALPHA"])
def test_the_exclusion_is_matched_exactly(exclude):
    pick_index = RecordingPickIndex(0)

    result = get_random_mountain(ACTIVE, pick_index).execute(exclude)

    assert result == ALPHA
    assert pick_index.counts == [3]


@pytest.mark.parametrize("exclude", ["", "alpha", "unknown-peak"])
def test_the_sole_active_mountain_is_returned_even_when_excluded(exclude):
    pick_index = RecordingPickIndex(0)

    result = get_random_mountain([ALPHA, RETIRED], pick_index).execute(exclude)

    assert result == ALPHA
    assert pick_index.counts == [1]


@pytest.mark.parametrize("mountains", [[], [RETIRED, DRAFT]])
def test_no_active_mountain_raises_without_picking(mountains):
    pick_index = RecordingPickIndex()

    with pytest.raises(NoEligibleMountains):
        get_random_mountain(mountains, pick_index).execute()

    assert pick_index.counts == []


@pytest.mark.parametrize("index", [-1, 3])
def test_an_index_outside_the_candidates_is_rejected(index):
    with pytest.raises(InfrastructureError):
        get_random_mountain(ACTIVE, RecordingPickIndex(index)).execute()


def test_a_mountain_that_stops_being_public_during_selection_is_rejected():
    class VanishingRepository(InMemoryMountainRepository):
        def find_public_by_slug(self, slug):
            return None

    use_case = GetRandomMountain(VanishingRepository(ACTIVE), RecordingPickIndex(0))

    with pytest.raises(InfrastructureError):
        use_case.execute()
