import pytest

from serendipeak.catalog.ports import CountedRegion
from serendipeak.catalog.region_directory import MoveRefusal, RegionDirectory
from tests.support.region_taxonomy import TAXONOMY, id_of, region

DIRECT = {"glacier-group": 3, "cordillera-blanca": 1, "annapurna": 2, "andes": 4}


def directory(*extra, direct=None):
    direct = DIRECT if direct is None else direct

    return RegionDirectory(
        CountedRegion(entry, direct.get(entry.slug, 0)) for entry in (*TAXONOMY, *extra)
    )


def slugs(summaries):
    return [summary.slug for summary in summaries]


class TestShape:
    def test_the_tree_is_listed_parents_first_and_siblings_by_name(self):
        tree = directory().tree()

        assert [(entry.summary.slug, entry.summary.depth) for entry in tree] == [
            ("andes", 0),
            ("cordillera-blanca", 1),
            ("glacier-group", 2),
            ("patagonian-andes", 1),
            ("himalayas", 0),
            ("annapurna", 1),
            ("lone-range", 0),
        ]

    def test_counts_are_direct_and_for_the_whole_subtree(self):
        found = {entry.summary.slug: entry.summary for entry in directory().tree()}

        assert (found["andes"].direct_mountains, found["andes"].subtree_mountains) == (4, 8)
        assert (
            found["cordillera-blanca"].direct_mountains,
            found["cordillera-blanca"].subtree_mountains,
        ) == (1, 4)
        assert found["glacier-group"].subtree_mountains == 3
        assert found["lone-range"].subtree_mountains == 0
        assert (found["andes"].child_regions, found["andes"].descendant_regions) == (2, 3)

    def test_ancestors_come_root_first_and_descendants_depth_first(self):
        found = directory()
        glacier = found.find("glacier-group")
        andes = found.find("andes")

        assert slugs(found.ancestors(glacier.id)) == ["andes", "cordillera-blanca"]
        assert found.ancestors(andes.id) == ()
        assert slugs(found.descendants(andes.id)) == [
            "cordillera-blanca",
            "glacier-group",
            "patagonian-andes",
        ]
        assert slugs(found.children(andes.id)) == ["cordillera-blanca", "patagonian-andes"]
        assert found.sibling_count(andes.id) == 2
        assert found.sibling_count(glacier.id) == 0

    def test_an_unknown_region_has_no_summary_ancestors_or_descendants(self):
        found = directory()

        assert found.find("unknown") is None
        assert found.summary(id_of("unknown")) is None
        assert found.ancestors(id_of("unknown")) == ()
        assert found.descendants(id_of("unknown")) == ()
        assert found.sibling_count(id_of("unknown")) == 0

    def test_a_region_whose_parent_is_missing_is_a_root(self):
        orphan = region("orphan", parent="not-read")

        found = RegionDirectory([CountedRegion(orphan, 0)])

        assert found.find("orphan").depth == 0

    def test_two_regions_with_one_name_are_told_apart_by_their_slug(self):
        found = directory(
            region("sierra-nevada-us", "Sierra Nevada"), region("sierra-nevada-es", "Sierra Nevada")
        )

        labels = {option.slug: option.label for option in found.options()}

        assert labels["sierra-nevada-us"] == "Sierra Nevada (sierra-nevada-us)"
        assert labels["sierra-nevada-es"] == "Sierra Nevada (sierra-nevada-es)"
        assert labels["andes"] == "Andes"

    def test_the_relative_path_names_the_regions_under_the_one_viewed(self):
        found = directory()

        assert (
            found.relative_path(id_of("andes"), id_of("glacier-group"))
            == "Cordillera Blanca › Glacier Group"
        )

    def test_a_very_deep_taxonomy_needs_no_recursion(self):
        depth = 3000
        chain = [region("level-0", "Level 0")] + [
            region(f"level-{index}", f"Level {index}", parent=f"level-{index - 1}")
            for index in range(1, depth)
        ]

        found = RegionDirectory(CountedRegion(entry, 1) for entry in chain)

        assert found.find("level-0").subtree_mountains == depth
        assert found.find(f"level-{depth - 1}").depth == depth - 1
        assert len(found.tree()) == depth
        assert len(found.descendants(id_of("level-0"))) == depth - 1


class TestSearch:
    def test_a_search_keeps_the_matches_and_the_regions_above_them(self):
        tree = directory().tree("glacier")

        assert [(entry.summary.slug, entry.matched) for entry in tree] == [
            ("andes", False),
            ("cordillera-blanca", False),
            ("glacier-group", True),
        ]
        assert [entry.shown_children for entry in tree] == [1, 1, 0]

    def test_it_ignores_case_and_accents_and_looks_in_every_language(self):
        found = directory(
            region(
                "cordillera-real", "Cordillera Real", es="Cordillera Real", pt="Cordilheira Real"
            )
        )

        assert slugs(entry.summary for entry in found.tree("CORDILHEIRA")) == ["cordillera-real"]
        assert slugs(entry.summary for entry in found.tree("cordíllera real")) == [
            "cordillera-real"
        ]

    def test_it_matches_the_slug_and_a_search_without_matches_is_empty(self):
        found = directory()

        assert slugs(entry.summary for entry in found.tree("lone-")) == ["lone-range"]
        assert found.tree("nothing like it") == ()

    def test_without_a_search_nothing_is_marked_as_a_match(self):
        assert not any(entry.matched for entry in directory().tree("   "))


class TestCreationAids:
    def test_the_same_name_elsewhere_lists_the_regions_with_their_paths(self):
        found = directory(region("glacier-group-2", "Glacier Group", parent="himalayas"))

        homonyms = found.same_name_elsewhere("GLACIER GROUP")

        assert [(option.slug, option.label) for option in homonyms] == [
            ("glacier-group", "Andes › Cordillera Blanca › Glacier Group"),
            ("glacier-group-2", "Himalayas › Glacier Group"),
        ]
        assert found.same_name_elsewhere("Glacier Group", excluding=id_of("glacier-group")) == (
            homonyms[1],
        )
        assert found.same_name_elsewhere("   ") == ()

    def test_slug_suggestions_are_the_plain_slug_and_one_qualified_by_the_parent_when_free(self):
        found = directory()

        assert found.slug_suggestions("Karakoram", id_of("himalayas")) == (
            "karakoram",
            "karakoram-himalayas",
        )
        assert found.slug_suggestions("Andes", id_of("himalayas")) == ("andes-himalayas",)
        assert found.slug_suggestions("Andes", None) == ()
        assert found.slug_suggestions("???", None) == ()

    def test_the_owner_of_a_slug_is_found(self):
        found = directory()

        assert (
            found.slug_owner("glacier-group").label == "Andes › Cordillera Blanca › Glacier Group"
        )
        assert found.slug_owner("free") is None


class TestMoving:
    def refusals(self, choices):
        return {target.option.slug: target.refusal for target in choices.targets}

    def test_every_destination_says_whether_the_region_can_go_there(self):
        choices = directory().move_choices(id_of("cordillera-blanca"))

        assert self.refusals(choices) == {
            "andes": MoveRefusal.CURRENT_PARENT,
            "cordillera-blanca": MoveRefusal.ITSELF,
            "glacier-group": MoveRefusal.INSIDE,
            "patagonian-andes": None,
            "himalayas": None,
            "annapurna": None,
            "lone-range": None,
        }
        assert choices.root_refusal is None

    def test_a_root_cannot_move_to_no_parent_and_cannot_go_into_its_descendants(self):
        choices = directory().move_choices(id_of("andes"))

        assert choices.root_refusal is MoveRefusal.CURRENT_PARENT
        assert self.refusals(choices)["patagonian-andes"] is MoveRefusal.INSIDE
        assert self.refusals(choices)["himalayas"] is None

    def test_a_destination_with_a_child_of_the_same_name_is_refused_ignoring_case(self):
        found = directory(region("blanca-twin", "cordillera BLANCA", parent="himalayas"))

        choices = found.move_choices(id_of("blanca-twin"))
        # Moving the twin under "andes" would clash with the real Cordillera Blanca.
        assert self.refusals(choices)["andes"] is MoveRefusal.NAME_TAKEN
        assert self.refusals(choices)["lone-range"] is None

    def test_the_impact_names_the_old_and_the_new_path(self):
        impact = directory().move_impact(id_of("cordillera-blanca"), id_of("annapurna"))

        assert impact.old_path == ("Andes", "Cordillera Blanca")
        assert impact.new_path == ("Himalayas", "Annapurna", "Cordillera Blanca")
        assert impact.region.subtree_mountains == 4
        assert impact.region.descendant_regions == 1

    def test_moving_to_no_parent_makes_the_path_the_region_alone(self):
        impact = directory().move_impact(id_of("glacier-group"), None)

        assert impact.new_path == ("Glacier Group",)


@pytest.mark.parametrize("size", [0, 1])
def test_a_directory_of_few_regions_answers_without_fuss(size):
    found = RegionDirectory(CountedRegion(entry, 0) for entry in TAXONOMY[:size])

    assert len(found) == size
    assert len(found.tree()) == size
