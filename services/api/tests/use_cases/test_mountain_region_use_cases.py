import uuid

import pytest

from serendipeak.catalog.create_mountain_region import CreateMountainRegion
from serendipeak.catalog.delete_mountain_region import DeleteMountainRegion
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.move_mountain_region import MoveMountainRegion
from serendipeak.catalog.region_changes import (
    InvalidMountainRegion,
    MountainRegionUpdate,
    MountainRegionViolation,
    NewMountainRegion,
    RegionInUse,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWikidataTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.catalog.update_mountain_region import UpdateMountainRegion
from serendipeak.errors import ApplicationError, DomainError
from tests.support.fakes import InMemoryMountainRegionStore
from tests.support.region_taxonomy import MOUNTAIN_REGION_SLUGS, TAXONOMY, id_of


@pytest.fixture
def store():
    return InMemoryMountainRegionStore(TAXONOMY, [id_of(slug) for slug in MOUNTAIN_REGION_SLUGS])


def new(slug="karakoram", en="Karakoram", **fields):
    return NewMountainRegion(slug=slug, name=LocalizedText(en=en), **fields)


class TestCreate:
    def test_a_region_is_created_with_trimmed_names(self, store):
        created = CreateMountainRegion(store).execute(
            new(en="  Karakoram ", parent_id=id_of("andes"))
        )

        assert created.name.en == "Karakoram"
        assert store.region(created.id) == created

    def test_an_invalid_region_is_refused_with_every_violation_before_the_store_is_called(
        self, store
    ):
        with pytest.raises(InvalidMountainRegion) as refused:
            CreateMountainRegion(store).execute(new(slug="Not A Slug", en="   "))

        assert refused.value.violations == (
            MountainRegionViolation.SLUG_INVALID,
            MountainRegionViolation.NAME_EN_BLANK,
        )
        assert isinstance(refused.value, DomainError)
        assert store.calls == 0

    def test_the_stores_refusals_reach_the_caller(self, store):
        create = CreateMountainRegion(store)

        with pytest.raises(RegionSlugTaken):
            create.execute(new(slug="andes"))
        with pytest.raises(RegionNameTaken):
            create.execute(new(slug="blanca-2", en="cordillera blanca", parent_id=id_of("andes")))
        with pytest.raises(RegionWikidataTaken):
            create.execute(
                NewMountainRegion(slug="fresh", name=LocalizedText(en="Fresh"), wikidata_id="Q5456")
            )
        with pytest.raises(UnknownRegion):
            create.execute(new(parent_id=uuid.uuid4()))


class TestUpdate:
    def test_the_names_are_replaced(self, store):
        updated = UpdateMountainRegion(store).execute(
            id_of("annapurna"),
            MountainRegionUpdate(name=LocalizedText(en=" Annapurna Massif ", es="Annapurna")),
        )

        assert updated.name == LocalizedText(en="Annapurna Massif", es="Annapurna")
        assert updated.slug == "annapurna"
        assert updated.parent_id == id_of("himalayas")

    def test_an_invalid_update_does_not_reach_the_store(self, store):
        with pytest.raises(InvalidMountainRegion) as refused:
            UpdateMountainRegion(store).execute(
                id_of("annapurna"),
                MountainRegionUpdate(name=LocalizedText(en=""), wikidata_id="bad"),
            )

        assert refused.value.violations == (
            MountainRegionViolation.NAME_EN_BLANK,
            MountainRegionViolation.WIKIDATA_ID_INVALID,
        )
        assert store.calls == 0

    def test_the_stores_refusals_reach_the_caller(self, store):
        update = UpdateMountainRegion(store)

        with pytest.raises(UnknownRegion):
            update.execute(uuid.uuid4(), MountainRegionUpdate(name=LocalizedText(en="X")))
        with pytest.raises(RegionNameTaken):
            update.execute(
                id_of("patagonian-andes"),
                MountainRegionUpdate(name=LocalizedText(en="Cordillera Blanca")),
            )
        with pytest.raises(RegionWikidataTaken):
            update.execute(
                id_of("lone-range"),
                MountainRegionUpdate(name=LocalizedText(en="Lone"), wikidata_id="Q4756"),
            )


class TestMove:
    def test_a_region_moves_with_its_subtree_and_mountains(self, store):
        moved = MoveMountainRegion(store).execute(id_of("cordillera-blanca"), id_of("himalayas"))

        assert moved.parent_id == id_of("himalayas")
        assert store.region(id_of("glacier-group")).parent_id == id_of("cordillera-blanca")

    def test_the_cycle_and_conflict_refusals_reach_the_caller(self, store):
        move = MoveMountainRegion(store)

        with pytest.raises(RegionWouldDescendFromItself) as cycle:
            move.execute(id_of("andes"), id_of("glacier-group"))
        with pytest.raises(UnknownRegion):
            move.execute(id_of("andes"), uuid.uuid4())

        assert isinstance(cycle.value, DomainError)


class TestDelete:
    def test_an_unused_region_is_deleted(self, store):
        assert DeleteMountainRegion(store).execute(id_of("lone-range")) is None

        assert store.region(id_of("lone-range")) is None

    def test_a_region_in_use_is_refused_with_what_depends_on_it(self, store):
        delete = DeleteMountainRegion(store)

        with pytest.raises(RegionInUse) as with_children:
            delete.execute(id_of("andes"))
        with pytest.raises(RegionInUse) as with_mountains:
            delete.execute(id_of("glacier-group"))

        assert with_children.value.child_count == 2
        assert with_mountains.value.mountain_count == 1
        assert isinstance(with_children.value, ApplicationError)
        assert not isinstance(with_children.value, DomainError)
        assert len(store.regions()) == len(TAXONOMY)
