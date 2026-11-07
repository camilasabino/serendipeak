import hashlib
from dataclasses import replace

import pytest

from serendipeak.catalog.entities import ImageDimensions, MountainStatus
from serendipeak.catalog.errors import (
    InvalidMountain,
    MountainHasNoPhotograph,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownMountain,
)
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import (
    NewMountainViolation,
    NewPhotograph,
    PhotographCredit,
)
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.errors import DomainError, InfrastructureError
from tests.support.catalog import mountain
from tests.support.fakes import (
    FakeMediaStore,
    InMemoryMountainUpdateStore,
    SyntheticPhotographProcessor,
)
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


PHOTOGRAPH = b"640x480:file"
DIGEST = hashlib.sha256(PHOTOGRAPH).hexdigest()


class OrderRecordingStore(InMemoryMountainUpdateStore):
    """Remembers which objects were already stored when the row was written."""

    def __init__(self, media, mountains=(), regions=()):
        super().__init__(mountains, regions)
        self._media = media
        self.stored_before_the_row = None
        self.image_given = None

    def update(self, mountain_id, update, gate, image=None):
        self.stored_before_the_row = (set(self._media.originals), set(self._media.public))
        self.image_given = image

        return super().update(mountain_id, update, gate, image)


@pytest.fixture
def media():
    return FakeMediaStore()


@pytest.fixture
def ingestion(media):
    return PhotographIngestion(
        SyntheticPhotographProcessor(), media, IngestionLimits(max_bytes=1024)
    )


@pytest.fixture
def store(media):
    return OrderRecordingStore(media, [ACTIVE, DRAFT, INACTIVE, OTHER], REGIONS)


@pytest.fixture
def update_mountain(store, ingestion):
    return UpdateMountain(store, ingestion)


def with_photograph(source, data=PHOTOGRAPH, **credit):
    credit.setdefault("author", "A. Photographer")

    return update_of(source, photograph=NewPhotograph(data=data, **credit))


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
    ingestion,
):
    broken = replace(ACTIVE, primary_image=None)
    store = InMemoryMountainUpdateStore([broken], REGIONS)

    with pytest.raises(PublicationRejected) as rejected:
        UpdateMountain(store, ingestion).execute(broken.id, update_of(broken, name="Changed"))

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


def test_the_translated_summary_texts_are_kept(ingestion):
    translated = replace(ACTIVE, summary=LocalizedText(en="English.", es="Español.", pt="Inglês."))
    store = InMemoryMountainUpdateStore([translated], REGIONS)

    updated = UpdateMountain(store, ingestion).execute(
        translated.id, update_of(translated, summary="Edited English.")
    )

    assert updated.summary == LocalizedText(en="Edited English.", es="Español.", pt="Inglês.")


def test_without_a_photograph_nothing_is_stored_and_the_stored_one_is_kept(
    update_mountain, store, media
):
    update_mountain.execute(ACTIVE.id, update_of(ACTIVE, name="Changed"))

    assert media.calls == []
    assert store.image_given is None
    assert store.mountain(ACTIVE.id).primary_image == ACTIVE.primary_image


def test_a_replacement_stores_its_processed_photograph_and_credit(update_mountain, store):
    updated = update_mountain.execute(
        ACTIVE.id,
        with_photograph(
            ACTIVE,
            license_name="CC BY 4.0",
            license_url="https://creativecommons.org/licenses/by/4.0",
            source_page_url="https://example.org/photo",
        ),
    )

    image = updated.primary_image
    assert image.dimensions == ImageDimensions(width=640, height=480)
    assert image.media.original_sha256 == DIGEST
    assert image.media != ACTIVE.primary_image.media
    assert (image.author, image.license_name) == ("A. Photographer", "CC BY 4.0")
    assert image.license_url == "https://creativecommons.org/licenses/by/4.0"
    assert image.source_page_url == "https://example.org/photo"
    assert store.mountain(ACTIVE.id) == updated


def test_a_replacement_credit_is_not_inherited_from_the_replaced_photograph(update_mountain):
    updated = update_mountain.execute(ACTIVE.id, with_photograph(ACTIVE))

    assert updated.primary_image.license_name is None
    assert updated.primary_image.license_url is None
    assert updated.primary_image.source_page_url is None


def test_the_replacement_objects_are_stored_before_the_row_is_written(update_mountain, store):
    updated = update_mountain.execute(ACTIVE.id, with_photograph(ACTIVE))

    originals, public = store.stored_before_the_row
    media = updated.primary_image.media
    assert originals == {media.original_key}
    assert public == {media.page_key, media.viewer_key}
    assert store.image_given == updated.primary_image


def test_a_replacement_gives_a_draft_without_a_photograph_one(update_mountain):
    updated = update_mountain.execute(DRAFT.id, with_photograph(DRAFT))

    assert updated.primary_image.media.original_sha256 == DIGEST


def test_a_replacement_on_a_mountain_that_stays_unpublishable_is_rejected_and_unchanged(
    ingestion, media
):
    without_camera = replace(ACTIVE, camera=None)
    store = OrderRecordingStore(media, [without_camera], REGIONS)

    with pytest.raises(PublicationRejected) as rejected:
        UpdateMountain(store, ingestion).execute(without_camera.id, with_photograph(ACTIVE))

    assert rejected.value.violations == (PublicationViolation.CAMERA_MISSING,)
    assert store.mountain(without_camera.id) == without_camera


@pytest.mark.parametrize(
    ("credit", "violation"),
    [
        ({"author": "   "}, NewMountainViolation.IMAGE_AUTHOR_MISSING),
        ({"license_name": " "}, NewMountainViolation.IMAGE_LICENSE_NAME_BLANK),
        (
            {"license_url": "https://example.org/license"},
            NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        ),
        (
            {"source_page_url": "javascript:alert(1)"},
            NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK,
        ),
    ],
)
def test_a_credit_that_breaks_a_rule_is_refused_before_anything_is_stored(
    update_mountain, store, media, credit, violation
):
    with pytest.raises(InvalidMountain) as refused:
        update_mountain.execute(ACTIVE.id, with_photograph(ACTIVE, **credit))

    assert violation in refused.value.violations
    assert media.calls == []
    assert store.calls == 0


def test_content_and_credit_violations_are_reported_together(update_mountain):
    with pytest.raises(InvalidMountain) as refused:
        update_mountain.execute(ACTIVE.id, replace(with_photograph(ACTIVE, author=""), name=" "))

    assert refused.value.violations == (
        NewMountainViolation.NAME_BLANK,
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
    )


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (b"not an image", PhotographRejection.NOT_AN_IMAGE),
        (b"640x480:" + b"x" * 2000, PhotographRejection.TOO_MANY_BYTES),
    ],
)
def test_a_file_that_is_no_acceptable_photograph_stores_nothing(
    update_mountain, store, media, data, reason
):
    with pytest.raises(PhotographRejected) as refused:
        update_mountain.execute(ACTIVE.id, with_photograph(ACTIVE, data=data))

    assert refused.value.reason is reason
    assert media.calls == []
    assert store.calls == 0


def test_a_storage_failure_writes_no_row(update_mountain, store, media):
    media.failing = True

    with pytest.raises(InfrastructureError):
        update_mountain.execute(ACTIVE.id, with_photograph(ACTIVE))

    assert store.calls == 0
    assert store.mountain(ACTIVE.id) == ACTIVE


def test_a_refusal_by_the_store_leaves_the_stored_photograph_and_the_objects_unreferenced(
    update_mountain, store, media
):
    with pytest.raises(SlugTaken):
        update_mountain.execute(ACTIVE.id, replace(with_photograph(ACTIVE), slug=OTHER.slug))

    assert store.mountain(ACTIVE.id).primary_image == ACTIVE.primary_image
    assert media.originals


def test_a_credit_alone_stores_nothing_and_changes_only_the_credit(update_mountain, store, media):
    credit = PhotographCredit(author="Another Author", license_name="CC BY 4.0")

    updated = update_mountain.execute(ACTIVE.id, update_of(ACTIVE, credit=credit))

    assert media.calls == []
    assert store.image_given is None
    assert updated.primary_image == replace(
        ACTIVE.primary_image,
        author="Another Author",
        license_name="CC BY 4.0",
        license_url=None,
        source_page_url=None,
    )


def test_a_credit_that_breaks_a_rule_is_refused_before_the_store_is_called(update_mountain, store):
    with pytest.raises(InvalidMountain) as refused:
        update_mountain.execute(
            ACTIVE.id, update_of(ACTIVE, credit=PhotographCredit(author="", license_url="x"))
        )

    assert refused.value.violations == (
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
        NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK,
    )
    assert store.calls == 0


def test_a_credit_on_a_mountain_that_stays_unpublishable_is_rejected_and_unchanged(
    ingestion, media
):
    without_camera = replace(ACTIVE, camera=None)
    store = OrderRecordingStore(media, [without_camera], REGIONS)
    credit = PhotographCredit(author="Another Author")

    with pytest.raises(PublicationRejected) as rejected:
        UpdateMountain(store, ingestion).execute(
            without_camera.id, update_of(ACTIVE, credit=credit)
        )

    assert rejected.value.violations == (PublicationViolation.CAMERA_MISSING,)
    assert store.mountain(without_camera.id) == without_camera


def test_a_credit_for_a_mountain_without_a_photograph_is_refused(update_mountain, store):
    with pytest.raises(MountainHasNoPhotograph):
        update_mountain.execute(
            DRAFT.id, update_of(DRAFT, credit=PhotographCredit(author="Another Author"))
        )

    assert store.mountain(DRAFT.id) == DRAFT


def test_removing_the_photograph_of_a_draft_deletes_it_with_its_credit(
    update_mountain, store, media
):
    draft = replace(DRAFT, primary_image=ACTIVE.primary_image)
    store = OrderRecordingStore(media, [draft], REGIONS)

    updated = UpdateMountain(store, update_mountain._ingestion).execute(
        draft.id, update_of(draft, remove_photograph=True)
    )

    assert updated.primary_image is None
    assert store.mountain(draft.id).primary_image is None
    assert (media.originals, media.public) == ({}, {})


def test_removing_the_photograph_of_a_draft_without_one_changes_nothing(update_mountain, store):
    updated = update_mountain.execute(DRAFT.id, update_of(DRAFT, remove_photograph=True))

    assert updated == DRAFT


@pytest.mark.parametrize("source", [ACTIVE, INACTIVE])
def test_removing_the_photograph_of_a_public_mountain_is_rejected_and_unchanged(
    update_mountain, store, source
):
    with pytest.raises(PublicationRejected) as rejected:
        update_mountain.execute(source.id, update_of(source, remove_photograph=True))

    assert PublicationViolation.PRIMARY_IMAGE_MISSING in rejected.value.violations
    assert store.mountain(source.id) == source


def test_a_draft_whose_photograph_was_removed_is_published_again_by_a_new_one(
    update_mountain, store, media
):
    draft = replace(DRAFT, primary_image=ACTIVE.primary_image)
    store = OrderRecordingStore(media, [draft], REGIONS)
    use_case = UpdateMountain(store, update_mountain._ingestion)
    use_case.execute(draft.id, update_of(draft, remove_photograph=True))

    restored = use_case.execute(draft.id, with_photograph(draft))

    assert restored.primary_image.media.original_sha256 == DIGEST
