import uuid
from dataclasses import replace

import pytest

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import (
    MountainRegionUpdate,
    NewMountainRegion,
    RegionInUse,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWikidataTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.persistence.mapping import region_record, to_region
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from serendipeak.persistence.mountain_region_store import DjangoMountainRegionStore
from tests.support.fakes import InMemoryMountainRegionStore
from tests.support.records import mountain_record
from tests.support.region_taxonomy import MOUNTAIN_REGION_SLUGS, TAXONOMY, id_of, region

pytestmark = pytest.mark.django_db


class Arrangement:
    def __init__(self, store, regions):
        self.store = store
        self.regions = regions


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    mountain_region_ids = [id_of(slug) for slug in MOUNTAIN_REGION_SLUGS]
    if request.param == "in-memory":
        store = InMemoryMountainRegionStore(TAXONOMY, mountain_region_ids)
        return Arrangement(store, store.regions)

    request.getfixturevalue("db")
    for entry in TAXONOMY:
        region_record(entry).save(force_insert=True)
    for index, region_id in enumerate(mountain_region_ids):
        mountain_record(slug=f"mountain-{index}", region_id=region_id).save()

    def regions():
        return {record.id: to_region(record) for record in MountainRegionRecord.objects.all()}

    return Arrangement(DjangoMountainRegionStore(), regions)


def new(slug, name=None, parent=None, wikidata_id=None, **names):
    return NewMountainRegion(
        slug=slug,
        name=LocalizedText(en=name or slug.replace("-", " ").title(), **names),
        parent_id=None if parent is None else id_of(parent),
        wikidata_id=wikidata_id,
    )


def state_of(entry, **changes):
    return replace(MountainRegionUpdate(name=entry.name, wikidata_id=entry.wikidata_id), **changes)


class TestCreate:
    def test_a_root_is_stored_with_a_new_id_and_returned_as_stored(self, arranged):
        created = arranged.store.create(
            new("karakoram", "Karakoram", wikidata_id="Q128", es="Karakórum")
        )

        assert isinstance(created.id, uuid.UUID)
        assert (created.slug, created.parent_id, created.wikidata_id) == ("karakoram", None, "Q128")
        assert created.name == LocalizedText(en="Karakoram", es="Karakórum")
        assert arranged.regions()[created.id] == created

    def test_a_child_is_stored_under_its_parent_and_the_rest_is_unchanged(self, arranged):
        before = arranged.regions()

        created = arranged.store.create(new("alpine-lake", parent="patagonian-andes"))

        assert created.parent_id == id_of("patagonian-andes")
        assert arranged.regions() == {**before, created.id: created}

    def test_two_regions_may_share_a_display_name_when_they_are_not_siblings(self, arranged):
        roots = [
            arranged.store.create(new("sierra-nevada-spain", "Sierra Nevada")),
            arranged.store.create(new("sierra-nevada-california", "Sierra Nevada")),
        ]
        child = arranged.store.create(new("sierra-nevada-child", "Sierra Nevada", parent="andes"))

        assert {root.name.en for root in roots} == {child.name.en} == {"Sierra Nevada"}

    def test_an_unknown_parent_is_refused_and_nothing_is_written(self, arranged):
        before = arranged.regions()
        parent_id = uuid.uuid4()

        with pytest.raises(UnknownRegion) as refused:
            arranged.store.create(replace(new("karakoram"), parent_id=parent_id))

        assert refused.value.region_id == parent_id
        assert arranged.regions() == before

    def test_a_taken_slug_is_refused_even_under_another_parent(self, arranged):
        before = arranged.regions()

        with pytest.raises(RegionSlugTaken) as refused:
            arranged.store.create(new("annapurna", "Another", parent="andes"))

        assert refused.value.slug == "annapurna"
        assert arranged.regions() == before

    @pytest.mark.parametrize(
        "name", ["Cordillera Blanca", "CORDILLERA BLANCA", "cordillera blanca"]
    )
    def test_a_sibling_name_is_refused_ignoring_case(self, arranged, name):
        before = arranged.regions()

        with pytest.raises(RegionNameTaken) as refused:
            arranged.store.create(new("another-blanca", name, parent="andes"))

        assert refused.value.parent_id == id_of("andes")
        assert arranged.regions() == before

    def test_a_taken_wikidata_item_is_refused(self, arranged):
        before = arranged.regions()

        with pytest.raises(RegionWikidataTaken) as refused:
            arranged.store.create(new("karakoram", wikidata_id="Q5456"))

        assert refused.value.wikidata_id == "Q5456"
        assert arranged.regions() == before

    def test_the_first_applicable_refusal_in_the_documented_order_is_raised(self, arranged):
        taken = new("annapurna", "Cordillera Blanca", parent="andes", wikidata_id="Q5456")

        with pytest.raises(RegionSlugTaken):
            arranged.store.create(taken)
        with pytest.raises(RegionNameTaken):
            arranged.store.create(replace(taken, slug="fresh-slug"))
        with pytest.raises(UnknownRegion):
            arranged.store.create(replace(taken, slug="fresh-slug", parent_id=uuid.uuid4()))


class TestUpdate:
    def test_the_names_and_the_wikidata_item_are_replaced_and_nothing_else(self, arranged):
        before = arranged.regions()
        target = id_of("cordillera-blanca")

        updated = arranged.store.update(
            target,
            MountainRegionUpdate(
                name=LocalizedText(en="White Range", es="Cordillera Blanca", pt="Cordilheira"),
                wikidata_id="Q1234",
            ),
        )

        assert updated.name == LocalizedText(
            en="White Range", es="Cordillera Blanca", pt="Cordilheira"
        )
        assert updated.wikidata_id == "Q1234"
        assert (updated.id, updated.slug, updated.parent_id) == (
            target,
            "cordillera-blanca",
            id_of("andes"),
        )
        assert arranged.regions() == {**before, target: updated}

    def test_translations_and_the_wikidata_item_can_be_removed(self, arranged):
        target = id_of("annapurna")

        updated = arranged.store.update(target, state_of(region("annapurna"), wikidata_id=None))

        assert updated.wikidata_id is None
        assert arranged.regions()[target].wikidata_id is None

    def test_a_state_equal_to_the_stored_one_changes_nothing(self, arranged):
        before = arranged.regions()
        stored = before[id_of("annapurna")]

        assert arranged.store.update(stored.id, state_of(stored)) == stored
        assert arranged.regions() == before

    def test_a_region_may_change_only_the_case_of_its_own_name(self, arranged):
        updated = arranged.store.update(
            id_of("cordillera-blanca"),
            MountainRegionUpdate(name=LocalizedText(en="CORDILLERA BLANCA")),
        )

        assert updated.name.en == "CORDILLERA BLANCA"

    def test_a_root_may_take_the_name_of_another_root(self, arranged):
        updated = arranged.store.update(
            id_of("lone-range"), MountainRegionUpdate(name=LocalizedText(en="Himalayas"))
        )

        assert updated.name.en == "Himalayas"

    def test_an_unknown_region_is_refused(self, arranged):
        unknown = uuid.uuid4()

        with pytest.raises(UnknownRegion) as refused:
            arranged.store.update(unknown, MountainRegionUpdate(name=LocalizedText(en="Lost")))

        assert refused.value.region_id == unknown

    def test_a_sibling_name_is_refused_and_nothing_is_written(self, arranged):
        before = arranged.regions()

        with pytest.raises(RegionNameTaken):
            arranged.store.update(
                id_of("patagonian-andes"),
                MountainRegionUpdate(name=LocalizedText(en="cordillera BLANCA")),
            )

        assert arranged.regions() == before

    def test_a_wikidata_item_of_another_region_is_refused_and_nothing_is_written(self, arranged):
        before = arranged.regions()
        stored = before[id_of("lone-range")]

        with pytest.raises(RegionWikidataTaken):
            arranged.store.update(stored.id, state_of(stored, wikidata_id="Q4756"))

        assert arranged.regions() == before

    def test_the_name_refusal_precedes_the_wikidata_refusal(self, arranged):
        with pytest.raises(RegionNameTaken):
            arranged.store.update(
                id_of("patagonian-andes"),
                MountainRegionUpdate(
                    name=LocalizedText(en="Cordillera Blanca"), wikidata_id="Q4756"
                ),
            )


class TestMove:
    def test_a_region_is_placed_under_another_with_its_descendants_untouched(self, arranged):
        before = arranged.regions()
        target = id_of("cordillera-blanca")

        moved = arranged.store.move(target, id_of("himalayas"))

        assert moved.parent_id == id_of("himalayas")
        assert arranged.regions() == {**before, target: moved}
        assert arranged.regions()[id_of("glacier-group")].parent_id == target

    def test_a_region_becomes_a_root(self, arranged):
        moved = arranged.store.move(id_of("annapurna"), None)

        assert moved.parent_id is None
        assert arranged.regions()[moved.id].parent_id is None

    def test_a_root_may_be_placed_under_a_leaf(self, arranged):
        moved = arranged.store.move(id_of("lone-range"), id_of("glacier-group"))

        assert moved.parent_id == id_of("glacier-group")

    def test_a_region_already_under_that_parent_is_not_written(self, arranged):
        before = arranged.regions()

        moved = arranged.store.move(id_of("annapurna"), id_of("himalayas"))

        assert moved == before[id_of("annapurna")]
        assert arranged.regions() == before

    def test_an_unknown_region_and_an_unknown_parent_are_refused(self, arranged):
        before = arranged.regions()
        unknown = uuid.uuid4()

        with pytest.raises(UnknownRegion) as missing_region:
            arranged.store.move(unknown, id_of("andes"))
        with pytest.raises(UnknownRegion) as missing_parent:
            arranged.store.move(id_of("annapurna"), unknown)

        assert missing_region.value.region_id == missing_parent.value.region_id == unknown
        assert arranged.regions() == before

    def test_a_region_cannot_become_its_own_parent(self, arranged):
        before = arranged.regions()
        target = id_of("andes")

        with pytest.raises(RegionWouldDescendFromItself) as refused:
            arranged.store.move(target, target)

        assert (refused.value.region_id, refused.value.parent_id) == (target, target)
        assert arranged.regions() == before

    @pytest.mark.parametrize("descendant", ["cordillera-blanca", "glacier-group"])
    def test_a_region_cannot_be_placed_inside_its_own_subtree(self, arranged, descendant):
        before = arranged.regions()

        with pytest.raises(RegionWouldDescendFromItself):
            arranged.store.move(id_of("andes"), id_of(descendant))

        assert arranged.regions() == before

    def test_a_sibling_name_at_the_target_is_refused(self, arranged):
        arranged.store.create(new("blanca-in-himalayas", "Cordillera Blanca", parent="himalayas"))
        before = arranged.regions()

        with pytest.raises(RegionNameTaken) as refused:
            arranged.store.move(id_of("cordillera-blanca"), id_of("himalayas"))

        assert refused.value.parent_id == id_of("himalayas")
        assert arranged.regions() == before

    def test_a_name_shared_with_a_region_elsewhere_is_allowed(self, arranged):
        arranged.store.create(new("blanca-in-himalayas", "Cordillera Blanca", parent="himalayas"))
        arranged.store.create(new("blanca-root", "Cordillera Blanca"))

        moved = arranged.store.move(id_of("cordillera-blanca"), None)

        assert moved.parent_id is None


class TestDelete:
    def test_a_region_without_children_or_mountains_is_deleted_and_the_rest_kept(self, arranged):
        before = arranged.regions()

        assert arranged.store.delete(id_of("lone-range")) is None

        assert arranged.regions() == {
            region_id: entry
            for region_id, entry in before.items()
            if region_id != id_of("lone-range")
        }

    def test_an_unknown_region_is_refused(self, arranged):
        unknown = uuid.uuid4()

        with pytest.raises(UnknownRegion) as refused:
            arranged.store.delete(unknown)

        assert refused.value.region_id == unknown

    def test_a_region_with_children_is_refused_and_nothing_is_reassigned(self, arranged):
        before = arranged.regions()

        with pytest.raises(RegionInUse) as refused:
            arranged.store.delete(id_of("andes"))

        assert (refused.value.child_count, refused.value.mountain_count) == (2, 0)
        assert arranged.regions() == before

    def test_a_region_with_mountains_is_refused_and_nothing_is_reassigned(self, arranged):
        before = arranged.regions()

        with pytest.raises(RegionInUse) as refused:
            arranged.store.delete(id_of("glacier-group"))

        assert (refused.value.child_count, refused.value.mountain_count) == (0, 1)
        assert arranged.regions() == before

    def test_a_region_emptied_by_the_caller_can_then_be_deleted(self, arranged):
        arranged.store.move(id_of("annapurna"), None)

        arranged.store.delete(id_of("himalayas"))

        assert id_of("himalayas") not in arranged.regions()
        assert id_of("annapurna") in arranged.regions()


def test_the_django_mountains_keep_their_region_after_a_refused_deletion(db):
    for entry in TAXONOMY:
        region_record(entry).save(force_insert=True)
    mountain_record(slug="mountain-on-glacier", region_id=id_of("glacier-group")).save()

    with pytest.raises(RegionInUse):
        DjangoMountainRegionStore().delete(id_of("glacier-group"))

    assert MountainRecord.objects.get().region_id == id_of("glacier-group")
