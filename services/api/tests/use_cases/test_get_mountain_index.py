from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.get_mountain_index import GetMountainIndex
from tests.support.catalog import index_entry_of, mountain
from tests.support.fakes import InMemoryMountainRepository

ACTIVE = mountain("aconcagua")
ANOTHER_ACTIVE = mountain("mont-blanc")
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT)


def test_returns_the_active_mountains_in_slug_order():
    repository = InMemoryMountainRepository([ANOTHER_ACTIVE, INACTIVE, DRAFT, ACTIVE])

    index = GetMountainIndex(repository).execute()

    assert index == (index_entry_of(ACTIVE), index_entry_of(ANOTHER_ACTIVE))


def test_an_empty_catalog_gives_an_empty_index():
    assert GetMountainIndex(InMemoryMountainRepository()).execute() == ()
