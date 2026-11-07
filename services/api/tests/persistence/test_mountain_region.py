import uuid

import pytest
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.records import mountain_record
from tests.support.regions import region_path

pytestmark = pytest.mark.django_db


def region(slug, name=None, parent=None, **overrides):
    return MountainRegionRecord.objects.create(
        slug=slug,
        name_en=slug.replace("-", " ").title() if name is None else name,
        parent=parent,
        **overrides,
    )


def refused(action):
    """The diagnostics of the database error that `action` raises inside a savepoint."""
    with pytest.raises(DatabaseError) as raised, transaction.atomic():
        action()

    return raised.value


def chain(depth):
    nodes = []
    for index in range(depth):
        nodes.append(region(f"level-{index}", parent=nodes[-1] if nodes else None))

    return nodes


class TestHierarchy:
    def test_a_region_may_be_a_root_or_have_a_parent_at_any_depth(self):
        nodes = chain(30)

        assert nodes[0].parent_id is None
        assert MountainRegionRecord.objects.get(slug="level-29").parent_id == nodes[28].id

    def test_children_are_found_through_the_parent_link(self):
        root = region("alpha-chain")
        region("beta-range", parent=root)
        region("gamma-range", parent=root)

        assert sorted(root.children.values_list("slug", flat=True)) == ["beta-range", "gamma-range"]

    def test_the_id_defaults_to_a_uuid(self):
        assert isinstance(region("alpha-chain").id, uuid.UUID)


class TestNamesAndSlugs:
    def test_duplicate_display_names_are_allowed_among_roots(self):
        region("twin-north", "Twin")
        region("twin-south", "Twin")

        assert MountainRegionRecord.objects.filter(name_en="Twin").count() == 2

    def test_different_parents_may_share_a_child_name(self):
        north, south = region("north-range"), region("south-range")
        region("north-ridge", "Ridge", parent=north)
        region("south-ridge", "Ridge", parent=south)

        assert MountainRegionRecord.objects.filter(name_en="Ridge").count() == 2

    def test_siblings_may_not_share_a_name_whatever_its_case(self):
        parent = region("alpha-chain")
        region("beta-ridge", "Ridge", parent=parent)

        error = refused(lambda: region("gamma-ridge", "RIDGE", parent=parent))

        assert "mountain_region_sibling_name_key" in str(error)

    def test_the_slug_is_unique_across_the_whole_tree(self):
        region("alpha-chain")
        other = region("beta-chain")

        error = refused(lambda: region("alpha-chain", parent=other))

        assert "mountain_region_slug_key" in str(error)

    @pytest.mark.parametrize("slug", ["Upper", "two words", "-lead", "trail-", "a--b", ""])
    def test_the_slug_follows_the_slug_rule(self, slug):
        error = refused(lambda: region(slug, "Fine Name"))

        assert "mountain_region_slug_format" in str(error)

    @pytest.mark.parametrize("name", ["", "   "])
    def test_the_english_name_is_not_blank(self, name):
        error = refused(lambda: region("alpha-chain", name))

        assert "mountain_region_name_en_not_blank" in str(error)

    @pytest.mark.parametrize("column", ["name_es", "name_pt"])
    def test_a_translation_is_null_or_not_blank(self, column):
        region("alpha-chain", **{column: "Cadena"})

        error = refused(lambda: region("beta-chain", **{column: " "}))

        assert f"mountain_region_{column}_not_blank" in str(error)

    def test_the_wikidata_identifier_has_the_item_format(self):
        region("alpha-chain", wikidata_id="Q42")

        error = refused(lambda: region("beta-chain", wikidata_id="42"))

        assert "mountain_region_wikidata_id_format" in str(error)

    def test_two_regions_cannot_claim_one_wikidata_item(self):
        region("alpha-chain", wikidata_id="Q42")

        error = refused(lambda: region("beta-chain", wikidata_id="Q42"))

        assert "mountain_region_wikidata_id_key" in str(error)

    def test_regions_without_a_wikidata_item_do_not_collide(self):
        region("alpha-chain")
        region("beta-chain")

        assert MountainRegionRecord.objects.filter(wikidata_id__isnull=True).count() == 2


class TestCycles:
    def test_a_region_cannot_be_its_own_parent_by_the_check(self):
        node = region("alpha-chain")

        error = refused(
            lambda: connection.cursor().execute(
                "UPDATE mountain_region SET parent_id = id WHERE id = %s", [node.id]
            )
        )

        assert "mountain_region_not_its_own_parent" in str(error) or "descend" in str(error)

    def test_a_direct_cycle_is_refused(self):
        parent = region("alpha-chain")
        child = region("beta-range", parent=parent)

        parent.parent = child
        error = refused(parent.save)

        assert "cannot descend from itself" in str(error)

    @pytest.mark.parametrize("depth", [3, 8, 25])
    def test_an_indirect_cycle_is_refused_at_any_depth(self, depth):
        nodes = chain(depth)

        nodes[0].parent = nodes[-1]
        error = refused(nodes[0].save)

        assert "cannot descend from itself" in str(error)

    def test_a_cycle_is_refused_by_raw_sql_too(self):
        parent = region("alpha-chain")
        child = region("beta-range", parent=parent)

        error = refused(
            lambda: connection.cursor().execute(
                "UPDATE mountain_region SET parent_id = %s WHERE id = %s", [child.id, parent.id]
            )
        )

        assert "cannot descend from itself" in str(error)
        assert MountainRegionRecord.objects.get(pk=parent.pk).parent_id is None

    def test_a_region_moves_to_another_branch_and_takes_its_descendants(self):
        old, new = region("old-chain"), region("new-chain")
        moving = region("moving-range", parent=old)
        leaf = region("leaf-ridge", parent=moving)

        moving.parent = new
        moving.save()

        assert MountainRegionRecord.objects.get(pk=leaf.pk).parent_id == moving.id
        assert MountainRegionRecord.objects.get(pk=moving.pk).parent_id == new.id

    def test_a_region_becomes_a_root(self):
        parent = region("alpha-chain")
        child = region("beta-range", parent=parent)

        child.parent = None
        child.save()

        assert MountainRegionRecord.objects.get(pk=child.pk).parent_id is None

    def test_the_parent_of_an_unrelated_branch_may_change_freely(self):
        first = chain(3)
        other = region("other-chain")

        first[2].parent = other
        first[2].save()

        assert MountainRegionRecord.objects.get(pk=first[2].pk).parent_id == other.id


class TestIdentity:
    def test_the_slug_never_changes(self):
        node = region("alpha-chain")

        error = refused(
            lambda: MountainRegionRecord.objects.filter(pk=node.pk).update(slug="renamed-chain")
        )

        assert "never change" in str(error)

    def test_the_id_never_changes(self):
        node = region("alpha-chain")

        error = refused(
            lambda: MountainRegionRecord.objects.filter(pk=node.pk).update(id=uuid.uuid4())
        )

        assert "never change" in str(error)

    def test_names_and_the_wikidata_item_may_change(self):
        node = region("alpha-chain")

        node.name_en = "Renamed"
        node.wikidata_id = "Q7"
        node.name_es = "Cadena"
        node.save()

        assert MountainRegionRecord.objects.get(pk=node.pk).name_en == "Renamed"


class TestReferentialIntegrity:
    def test_a_region_with_a_child_cannot_be_deleted(self):
        parent = region("alpha-chain")
        region("beta-range", parent=parent)

        with pytest.raises(Exception) as raised, transaction.atomic():
            parent.delete()

        assert "protected" in str(raised.value).lower()

    def test_a_region_with_a_child_cannot_be_deleted_by_raw_sql(self):
        parent = region("alpha-chain")
        region("beta-range", parent=parent)

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM mountain_region WHERE id = %s", [parent.id])
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")

        assert MountainRegionRecord.objects.filter(pk=parent.pk).exists()

    def test_a_region_with_a_mountain_cannot_be_deleted(self):
        node = region("alpha-chain")
        mountain_record(region=node).save()

        with pytest.raises(Exception) as raised, transaction.atomic():
            node.delete()

        assert "protected" in str(raised.value).lower()

    def test_a_region_with_a_mountain_cannot_be_deleted_by_raw_sql(self):
        node = region("alpha-chain")
        mountain_record(region=node).save()

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM mountain_region WHERE id = %s", [node.id])
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")

    def test_a_leaf_without_mountains_can_be_deleted(self):
        parent = region("alpha-chain")
        leaf = region("beta-range", parent=parent)

        leaf.delete()

        assert list(MountainRegionRecord.objects.values_list("slug", flat=True)) == ["alpha-chain"]

    def test_a_mountain_cannot_point_at_a_region_that_does_not_exist(self):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                mountain_record(region_id=uuid.uuid4()).save()
                connection.check_constraints()

    def test_a_region_cannot_have_a_parent_that_does_not_exist(self):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                region("alpha-chain", parent_id=uuid.uuid4())
                connection.check_constraints()

    def test_a_mountain_may_have_no_region(self):
        mountain_record().save()

        assert MountainRecord.objects.get().region_id is None

    def test_a_mountain_may_point_at_a_root_an_intermediate_node_or_a_leaf(self):
        nodes = chain(3)
        for index, node in enumerate(nodes):
            mountain_record(slug=f"peak-{index}", region=node).save()

        assert sorted(MountainRecord.objects.values_list("region__slug", flat=True)) == [
            "level-0",
            "level-1",
            "level-2",
        ]


def load(*entries):
    DjangoCatalogStore().load(catalog_seed(*entries))


class TestReading:
    @pytest.mark.parametrize("depth", [1, 3, 6])
    def test_a_mountain_costs_three_queries_whatever_the_depth_of_its_region(
        self, depth, django_assert_num_queries
    ):
        names = [f"Level {index}" for index in range(depth)]
        load(catalog_mountain("deep-peak", region=region_path(*names)))

        with django_assert_num_queries(3):
            found = DjangoMountainRepository().find_public_by_slug("deep-peak")

        assert found.region.region.name.en == names[-1]
        assert [ancestor.name.en for ancestor in found.region.ancestors] == names[:-1]

    def test_a_mountain_without_a_region_needs_no_region_query(self, django_assert_num_queries):
        load(catalog_mountain("plain-peak", region=None))

        with django_assert_num_queries(2):
            found = DjangoMountainRepository().find_public_by_slug("plain-peak")

        assert found.region is None

    def test_the_ancestors_come_from_one_recursive_query(self):
        load(catalog_mountain("deep-peak", region=region_path("A One", "B Two", "C Three")))

        with CaptureQueriesContext(connection) as queries:
            DjangoMountainRepository().find_public_by_slug("deep-peak")

        recursive = [q["sql"] for q in queries.captured_queries if "RECURSIVE" in q["sql"]]
        assert len(recursive) == 1

    def test_ancestors_are_ordered_from_the_root_to_the_immediate_parent(self):
        load(catalog_mountain("deep-peak", region=region_path("Root", "Middle", "Near", "Leaf")))

        found = DjangoMountainRepository().find_public_by_slug("deep-peak")

        assert [ref.slug for ref in found.region.ancestors] == ["root", "middle", "near"]
        assert found.region.region.slug == "leaf"

    def test_mountains_that_share_an_ancestor_store_it_once_and_read_every_path(self):
        load(
            catalog_mountain("first-peak", region=region_path("Root", "Left")),
            catalog_mountain("second-peak", region=region_path("Root", "Right")),
            catalog_mountain("third-peak", region=region_path("Root")),
        )

        assert MountainRegionRecord.objects.count() == 3
        paths = {
            slug: DjangoMountainRepository().find_public_by_slug(slug).region
            for slug in ("first-peak", "second-peak", "third-peak")
        }
        assert [ref.slug for ref in paths["first-peak"].ancestors] == ["root"]
        assert [ref.slug for ref in paths["second-peak"].ancestors] == ["root"]
        assert paths["third-peak"].ancestors == ()

    def test_the_snapshot_reads_the_regions_in_one_query_for_any_number_of_mountains(
        self, django_assert_num_queries
    ):
        load(
            *(
                catalog_mountain(f"peak-{index}", region=region_path("Root", f"Range {index}"))
                for index in range(20)
            )
        )

        with django_assert_num_queries(4):
            snapshot = DjangoCatalogStore().snapshot()

        assert len(snapshot.mountains) == 20
        assert len(snapshot.regions) == 21
        assert all(
            entry.mountain.region.ancestors[0].slug == "root" for entry in snapshot.mountains
        )

    def test_a_region_translation_is_stored_but_the_entity_keeps_all_three_names(self):
        node = region("alpha-chain", name_es="Cadena", name_pt="Cadeia")
        mountain_record(region=node).save()

        from serendipeak.persistence.mapping import to_mountain

        path = to_mountain(MountainRecord.objects.get()).region

        assert (path.region.name.es, path.region.name.pt) == ("Cadena", "Cadeia")
