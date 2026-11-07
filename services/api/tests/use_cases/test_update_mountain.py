from dataclasses import replace

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import (
    InvalidMountain,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownMountain,
)
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import NewMountainViolation
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.errors import DomainError
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainUpdateStore
from tests.support.regions import region_path, regions_of

PATH = region_path("Test Chain", "Test Range")
REGIONS = regions_of(PATH)
ACTIVE = mountain("active-peak")
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None)
INACTIVE = mountain("old-peak", status=MountainStatus.INACTIVE, camera=None)
OTHER = mountain("other-peak")


def update_of(source, **overrides):
    fields = {
        "slug": source.slug,
        "name": source.name.en,
        "elevation_meters": source.elevation_meters,
        "continent_code": source.continent.code,
        "country_codes": tuple(country.code for country in source.countries),
        "region_id": None if source.region is None else REGIONS[-1].id,
        "summary": None if source.summary is None else source.summary.en,
        "osm_node_id": source.osm_node_id,
        "wikidata_id": source.wikidata_id,
    }
    fields.update(overrides)

    return MountainUpdate(**fields)


@pytest.fixture
def store():
    return InMemoryMountainUpdateStore([ACTIVE, DRAFT, INACTIVE, OTHER], REGIONS)


@pytest.fixture
def update_mountain(store):
    return UpdateMountain(store)


def test_an_update_returns_and_stores_the_new_content_and_geography(update_mountain, store):
    update = update_of(
        ACTIVE,
        slug="renamed-peak",
        name="Renamed Peak",
        elevation_meters=7000,
        continent_code="EU",
        country_codes=("CH", "AR"),
        region_id=None,
        summary="A new summary.",
        osm_node_id=None,
        wikidata_id="Q1",
    )

    updated = update_mountain.execute(ACTIVE.id, update)

    assert updated == store.mountain(ACTIVE.id)
    assert (updated.slug, updated.name.en, updated.elevation_meters) == (
        "renamed-peak",
        "Renamed Peak",
        7000,
    )
    assert updated.continent.code == "EU"
    assert [country.code for country in updated.countries] == ["AR", "CH"]
    assert updated.region is None
    assert updated.summary.en == "A new summary."
    assert (updated.osm_node_id, updated.wikidata_id) == (None, "Q1")


def test_what_is_outside_the_update_is_preserved(update_mountain):
    updated = update_mountain.execute(ACTIVE.id, update_of(ACTIVE, name="Changed"))

    assert updated.status is ACTIVE.status
    assert updated.coordinates == ACTIVE.coordinates
    assert updated.camera == ACTIVE.camera
    assert updated.primary_image == ACTIVE.primary_image
    assert updated.id == ACTIVE.id


def test_a_draft_may_be_saved_without_its_camera_or_photograph(update_mountain):
    updated = update_mountain.execute(DRAFT.id, update_of(DRAFT, name="Still A Draft"))

    assert updated.name.en == "Still A Draft"
    assert updated.status is MountainStatus.DRAFT


def test_an_inactive_mountain_without_a_camera_may_be_edited(update_mountain):
    updated = update_mountain.execute(INACTIVE.id, update_of(INACTIVE, name="Quiet Peak"))

    assert updated.name.en == "Quiet Peak"


def test_invalid_content_is_refused_with_every_violation_before_the_store_is_called(
    update_mountain, store
):
    with pytest.raises(InvalidMountain) as refused:
        update_mountain.execute(ACTIVE.id, update_of(ACTIVE, slug="Bad Slug", name=" "))

    assert set(refused.value.violations) == {
        NewMountainViolation.SLUG_INVALID,
        NewMountainViolation.NAME_BLANK,
    }
    assert isinstance(refused.value, DomainError)
    assert store.calls == 0


def test_an_active_mountain_that_would_stop_being_publishable_is_rejected_and_unchanged(
    update_mountain, store
):
    store.replace_for_test = None
    broken = replace(ACTIVE, primary_image=None)
    store = InMemoryMountainUpdateStore([broken], REGIONS)

    with pytest.raises(PublicationRejected) as rejected:
        UpdateMountain(store).execute(broken.id, update_of(broken, name="Changed"))

    assert rejected.value.violations == (PublicationViolation.PRIMARY_IMAGE_MISSING,)
    assert store.mountain(broken.id) == broken


def test_a_missing_mountain_is_unknown(update_mountain):
    with pytest.raises(UnknownMountain):
        update_mountain.execute(OTHER.id.__class__(int=1), update_of(ACTIVE))


def test_a_slug_of_another_mountain_is_taken_but_the_own_slug_is_not(update_mountain):
    with pytest.raises(SlugTaken):
        update_mountain.execute(ACTIVE.id, update_of(ACTIVE, slug=OTHER.slug))

    assert update_mountain.execute(ACTIVE.id, update_of(ACTIVE)).slug == ACTIVE.slug


def test_a_refusal_by_the_store_changes_nothing(update_mountain, store):
    with pytest.raises(UnknownContinent):
        update_mountain.execute(ACTIVE.id, update_of(ACTIVE, name="Changed", continent_code="ZZ"))

    assert store.mountain(ACTIVE.id) == ACTIVE


def test_the_translated_summary_texts_are_kept(store):
    translated = replace(ACTIVE, summary=LocalizedText(en="English.", es="Español.", pt="Inglês."))
    store = InMemoryMountainUpdateStore([translated], REGIONS)

    updated = UpdateMountain(store).execute(
        translated.id, update_of(translated, summary="Edited English.")
    )

    assert updated.summary == LocalizedText(en="Edited English.", es="Español.", pt="Inglês.")
