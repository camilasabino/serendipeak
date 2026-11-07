import uuid

import pytest

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import (
    MountainRegion,
    RegionCycle,
    UnknownRegion,
    build_region_path,
    derive_region_slug,
    region_id_for_slug,
    regions_in_tree_order,
)


def region(slug, name=None, parent=None):
    return MountainRegion(
        id=region_id_for_slug(slug),
        slug=slug,
        name=LocalizedText(en=name or slug.replace("-", " ").title()),
        parent_id=None if parent is None else region_id_for_slug(parent),
        wikidata_id=None,
    )


def table(*regions):
    return {item.id: item for item in regions}


def chain(depth):
    slugs = [f"level-{index}" for index in range(depth)]

    return slugs, [
        region(slug, parent=None if index == 0 else slugs[index - 1])
        for index, slug in enumerate(slugs)
    ]


class TestSlugDerivation:
    @pytest.mark.parametrize(
        ("name", "slug"),
        [
            ("Alpha Range", "alpha-range"),
            ("Árbol–Rango  Grande / Ñu", "arbol-rango-grande-nu"),
            ("  Dash-Separated  Name  ", "dash-separated-name"),
            ("Ridge 7", "ridge-7"),
            ("Kā Tiritiri", "ka-tiritiri"),
        ],
    )
    def test_accents_are_dropped_and_every_run_of_other_characters_is_one_hyphen(self, name, slug):
        assert derive_region_slug(name) == slug

    @pytest.mark.parametrize("name", ["", "---", "¿?", "Today", "random"])
    def test_a_name_without_a_valid_slug_is_refused(self, name):
        with pytest.raises(ValueError, match="no valid slug"):
            derive_region_slug(name)


class TestIdentity:
    def test_the_id_follows_the_slug_alone(self):
        assert region_id_for_slug("alpha-range") == region_id_for_slug("alpha-range")
        assert region_id_for_slug("alpha-range") != region_id_for_slug("beta-range")
        assert isinstance(region_id_for_slug("alpha-range"), uuid.UUID)


class TestPath:
    def test_a_root_has_no_ancestors(self):
        root = region("alpha-range")

        path = build_region_path(root.id, table(root))

        assert (path.region.slug, path.ancestors) == ("alpha-range", ())

    @pytest.mark.parametrize("depth", [2, 3, 6, 12])
    def test_ancestors_run_from_the_root_to_the_nearest_parent(self, depth):
        slugs, regions = chain(depth)

        path = build_region_path(regions[-1].id, table(*regions))

        assert path.region.slug == slugs[-1]
        assert [ancestor.slug for ancestor in path.ancestors] == slugs[:-1]

    def test_the_path_of_an_intermediate_node_stops_there(self):
        slugs, regions = chain(4)

        path = build_region_path(regions[1].id, table(*regions))

        assert (path.region.slug, [a.slug for a in path.ancestors]) == (slugs[1], slugs[:1])

    def test_names_travel_with_the_references(self):
        parent = region("alpha-range", "Alpha Range")
        child = region("beta-ridge", "Beta Ridge", parent="alpha-range")

        path = build_region_path(child.id, table(parent, child))

        assert path.ancestors[0].name == LocalizedText(en="Alpha Range")
        assert path.region.name == LocalizedText(en="Beta Ridge")

    def test_an_unknown_region_is_refused(self):
        with pytest.raises(UnknownRegion):
            build_region_path(uuid.uuid4(), {})

    def test_an_unknown_parent_is_refused(self):
        orphan = region("beta-ridge", parent="missing-range")

        with pytest.raises(UnknownRegion):
            build_region_path(orphan.id, table(orphan))

    def test_parents_that_loop_are_refused_instead_of_walked_forever(self):
        first = region("first-range", parent="second-range")
        second = region("second-range", parent="first-range")

        with pytest.raises(RegionCycle):
            build_region_path(first.id, table(first, second))

    def test_a_region_that_is_its_own_parent_is_a_cycle(self):
        loop = region("loop-range", parent="loop-range")

        with pytest.raises(RegionCycle):
            build_region_path(loop.id, table(loop))


class TestTreeOrder:
    def labelled(self, *regions):
        return [(item.slug, label) for item, label in regions_in_tree_order(regions)]

    def test_a_region_follows_its_parent_and_precedes_the_next_sibling(self):
        regions = [
            region("zeta-range", "Zeta Range"),
            region("alpha-range", "Alpha Range"),
            region("beta-ridge", "Beta Ridge", parent="alpha-range"),
            region("gamma-spur", "Gamma Spur", parent="beta-ridge"),
            region("alpha-peak-group", "Alpha Group", parent="alpha-range"),
        ]

        assert self.labelled(*regions) == [
            ("alpha-range", "Alpha Range"),
            ("alpha-peak-group", "Alpha Range › Alpha Group"),
            ("beta-ridge", "Alpha Range › Beta Ridge"),
            ("gamma-spur", "Alpha Range › Beta Ridge › Gamma Spur"),
            ("zeta-range", "Zeta Range"),
        ]

    def test_siblings_with_one_name_are_ordered_by_slug(self):
        regions = [region("b-twin", "Twin"), region("a-twin", "Twin")]

        assert [slug for slug, _ in self.labelled(*regions)] == ["a-twin", "b-twin"]

    def test_equal_labels_carry_the_slug_and_unique_ones_do_not(self):
        regions = [
            region("twin-north", "Twin"),
            region("twin-south", "Twin"),
            region("other-range", "Other"),
        ]

        assert self.labelled(*regions) == [
            ("other-range", "Other"),
            ("twin-north", "Twin (twin-north)"),
            ("twin-south", "Twin (twin-south)"),
        ]

    def test_equal_names_under_different_parents_are_told_apart_by_their_paths(self):
        regions = [
            region("north-range", "North"),
            region("south-range", "South"),
            region("north-ridge", "Ridge", parent="north-range"),
            region("south-ridge", "Ridge", parent="south-range"),
        ]

        labels = dict(self.labelled(*regions))

        assert labels["north-ridge"] == "North › Ridge"
        assert labels["south-ridge"] == "South › Ridge"

    def test_a_region_whose_parent_is_missing_is_listed_as_a_root(self):
        regions = [region("beta-ridge", "Beta", parent="missing-range")]

        assert self.labelled(*regions) == [("beta-ridge", "Beta")]

    def test_a_cycle_is_left_out_instead_of_looping(self):
        regions = [
            region("loop-a", parent="loop-b"),
            region("loop-b", parent="loop-a"),
            region("fine-range"),
        ]

        assert [slug for slug, _ in self.labelled(*regions)] == ["fine-range"]

    def test_no_regions_give_no_options(self):
        assert regions_in_tree_order([]) == []
