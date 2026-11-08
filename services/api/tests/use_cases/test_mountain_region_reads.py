import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.get_mountain_region import GetMountainRegion
from serendipeak.catalog.get_region_directory import GetRegionDirectory
from serendipeak.catalog.list_mountain_regions import SEARCH_MAX_LENGTH, ListMountainRegions
from serendipeak.catalog.regions import RegionSlugNotFound
from tests.support.fakes import InMemoryMountainRegionReader
from tests.support.region_taxonomy import TAXONOMY, id_of, region_mountain

MOUNTAINS = (
    region_mountain("zeta-peak", "glacier-group", "Zeta Peak"),
    region_mountain("alpha-peak", "glacier-group", "Álvaro Peak", MountainStatus.DRAFT),
    region_mountain("blanca-peak", "cordillera-blanca", "Blanca Peak"),
    region_mountain("andes-peak", "andes", "Andes Peak", MountainStatus.INACTIVE),
)


@pytest.fixture
def reader():
    return InMemoryMountainRegionReader(TAXONOMY, MOUNTAINS)


class TestList:
    def test_it_reads_the_regions_once_and_returns_the_tree_with_counts(self, reader):
        tree = ListMountainRegions(reader).execute()

        assert reader.reads == 1
        assert reader.mountain_reads == 0
        assert tree.total == 7
        assert tree.matches == 0
        andes = tree.entries[0].summary
        assert (andes.slug, andes.direct_mountains, andes.subtree_mountains) == ("andes", 1, 4)

    def test_a_search_reports_how_many_regions_matched(self, reader):
        tree = ListMountainRegions(reader).execute(search="blanca")

        assert tree.total == 7
        assert tree.matches == 1
        assert [entry.summary.slug for entry in tree.entries] == ["andes", "cordillera-blanca"]

    def test_the_search_is_bounded(self, reader):
        tree = ListMountainRegions(reader).execute(search="andes" + "x" * SEARCH_MAX_LENGTH)

        assert tree.matches == 0

    def test_an_empty_taxonomy_is_an_empty_tree(self):
        tree = ListMountainRegions(InMemoryMountainRegionReader()).execute()

        assert (tree.entries, tree.total) == ((), 0)


class TestDetail:
    def test_the_mountains_are_split_into_those_of_the_region_and_those_below_it(self, reader):
        detail = GetMountainRegion(reader).execute("andes")

        assert [item.slug for item in detail.directly] == ["andes-peak"]
        assert [
            (group.region.slug, group.path, [item.slug for item in group.mountains])
            for group in detail.in_descendants
        ] == [
            ("cordillera-blanca", "Cordillera Blanca", ["blanca-peak"]),
            # By folded name: "Álvaro" sorts before "Zeta".
            ("glacier-group", "Cordillera Blanca › Glacier Group", ["alpha-peak", "zeta-peak"]),
        ]
        assert [item.slug for item in detail.children] == ["cordillera-blanca", "patagonian-andes"]
        assert detail.sibling_count == 2
        assert detail.ancestors == ()

    def test_it_reads_the_regions_once_and_the_mountains_once(self, reader):
        GetMountainRegion(reader).execute("andes")

        assert (reader.reads, reader.mountain_reads) == (1, 1)

    def test_the_mountains_are_not_read_when_the_subtree_has_none(self, reader):
        detail = GetMountainRegion(reader).execute("lone-range")

        assert (reader.reads, reader.mountain_reads) == (1, 0)
        assert (detail.directly, detail.in_descendants) == ((), ())

    def test_a_leaf_reports_its_ancestors_root_first(self, reader):
        detail = GetMountainRegion(reader).execute("glacier-group")

        assert [item.slug for item in detail.ancestors] == ["andes", "cordillera-blanca"]
        assert [item.slug for item in detail.directly] == ["alpha-peak", "zeta-peak"]
        assert detail.in_descendants == ()

    @pytest.mark.parametrize("slug", ["unknown-range", "Not A Slug", "", "nul\x00", "today"])
    def test_an_unknown_or_malformed_slug_is_not_found(self, reader, slug):
        with pytest.raises(RegionSlugNotFound) as missing:
            GetMountainRegion(reader).execute(slug)

        assert missing.value.slug == slug

    def test_a_malformed_slug_is_refused_without_reading(self, reader):
        with pytest.raises(RegionSlugNotFound):
            GetMountainRegion(reader).execute("Not A Slug")

        assert reader.reads == 0


def test_the_directory_is_one_read(reader):
    directory = GetRegionDirectory(reader).execute()

    assert reader.reads == 1
    assert directory.find("andes").id == id_of("andes")
