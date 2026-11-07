import hashlib
from dataclasses import replace

import pytest

from serendipeak.catalog.create_mountain import CreateMountain
from serendipeak.catalog.entities import Coordinates, ImageDimensions, MountainStatus
from serendipeak.catalog.errors import (
    InvalidMountain,
    PhotographRejected,
    PhotographRejection,
    SlugTaken,
    UnknownContinent,
)
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.new_mountain import NewMountain, NewMountainViolation, NewPhotograph
from serendipeak.errors import DomainError, InfrastructureError
from tests.support.catalog import catalog_mountain
from tests.support.fakes import (
    FakeMediaStore,
    InMemoryMountainCreationStore,
    SyntheticPhotographProcessor,
)

PHOTOGRAPH = b"640x480:file"
DIGEST = hashlib.sha256(PHOTOGRAPH).hexdigest()
TAKEN = catalog_mountain("taken-peak").mountain


class OrderRecordingStore(InMemoryMountainCreationStore):
    """Remembers which objects were already stored when the row was written."""

    def __init__(self, media, mountains=()):
        super().__init__(mountains)
        self._media = media
        self.stored_before_the_row = None

    def create_draft(self, mountain, image):
        self.stored_before_the_row = (set(self._media.originals), set(self._media.public))

        return super().create_draft(mountain, image)


@pytest.fixture
def media():
    return FakeMediaStore()


@pytest.fixture
def store(media):
    return OrderRecordingStore(media, [TAKEN])


@pytest.fixture
def create_mountain(store, media):
    ingestion = PhotographIngestion(
        SyntheticPhotographProcessor(), media, IngestionLimits(max_bytes=1024)
    )

    return CreateMountain(store, ingestion)


def new_mountain(**overrides):
    fields = {
        "slug": "new-peak",
        "name": "New Peak",
        "coordinates": Coordinates(latitude=46.5, longitude=8.5),
        "elevation_meters": 3123,
        "continent_code": "EU",
        "photograph": NewPhotograph(data=PHOTOGRAPH, author="A. Photographer"),
    }
    fields.update(overrides)

    return NewMountain(**fields)


def with_photograph(**overrides):
    return new_mountain(photograph=replace(new_mountain().photograph, **overrides))


def test_a_draft_is_created_with_its_values_and_its_processed_photograph(create_mountain):
    created = create_mountain.execute(
        new_mountain(
            country_codes=("CH", "IT"),
            summary="A fine mountain.",
            osm_node_id=7,
            wikidata_id="Q9",
            photograph=NewPhotograph(
                data=PHOTOGRAPH,
                author="A. Photographer",
                license_name="CC BY 4.0",
                license_url="https://creativecommons.org/licenses/by/4.0",
                source_page_url="https://example.org/photo",
            ),
        )
    )

    assert created.status is MountainStatus.DRAFT
    assert (created.slug, created.name.en, created.elevation_meters) == (
        "new-peak",
        "New Peak",
        3123,
    )
    assert created.camera is None
    assert [country.code for country in created.countries] == ["IT", "CH"]
    assert created.summary.en == "A fine mountain."
    image = created.primary_image
    assert image.dimensions == ImageDimensions(width=640, height=480)
    assert image.media.original_sha256 == DIGEST
    assert (image.author, image.license_name) == ("A. Photographer", "CC BY 4.0")
    assert image.license_url == "https://creativecommons.org/licenses/by/4.0"
    assert image.source_page_url == "https://example.org/photo"


def test_the_photograph_objects_are_stored_before_the_row_is_written(create_mountain, store):
    created = create_mountain.execute(new_mountain())

    originals, public = store.stored_before_the_row
    assert originals == {created.primary_image.media.original_key}
    assert public == {created.primary_image.media.page_key, created.primary_image.media.viewer_key}


def test_a_new_draft_is_found_in_the_store(create_mountain, store):
    created = create_mountain.execute(new_mountain())

    assert store.mountain("new-peak") == created


@pytest.mark.parametrize(
    ("overrides", "violation"),
    [
        ({"slug": "Not A Slug"}, NewMountainViolation.SLUG_INVALID),
        ({"slug": "random"}, NewMountainViolation.SLUG_INVALID),
        ({"slug": ""}, NewMountainViolation.SLUG_INVALID),
        ({"name": "  "}, NewMountainViolation.NAME_BLANK),
        (
            {"coordinates": Coordinates(latitude=90.5, longitude=0.0)},
            NewMountainViolation.COORDINATES_OUT_OF_RANGE,
        ),
        (
            {"coordinates": Coordinates(latitude=0.0, longitude=-180.5)},
            NewMountainViolation.COORDINATES_OUT_OF_RANGE,
        ),
        ({"elevation_meters": 0}, NewMountainViolation.ELEVATION_NOT_POSITIVE),
        ({"elevation_meters": -5}, NewMountainViolation.ELEVATION_NOT_POSITIVE),
        ({"summary": ""}, NewMountainViolation.SUMMARY_INVALID),
        ({"summary": "x" * 201}, NewMountainViolation.SUMMARY_INVALID),
        ({"summary": " padded."}, NewMountainViolation.SUMMARY_INVALID),
        ({"osm_node_id": 0}, NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE),
        ({"wikidata_id": "39739"}, NewMountainViolation.WIKIDATA_ID_INVALID),
        ({"wikidata_id": "Q0"}, NewMountainViolation.WIKIDATA_ID_INVALID),
    ],
)
def test_a_value_that_breaks_a_rule_is_refused_before_anything_is_stored(
    create_mountain, store, media, overrides, violation
):
    with pytest.raises(InvalidMountain) as refused:
        create_mountain.execute(new_mountain(**overrides))

    assert refused.value.violations == (violation,)
    assert isinstance(refused.value, DomainError)
    assert media.calls == []
    assert store.calls == 0


@pytest.mark.parametrize(
    ("overrides", "violation"),
    [
        ({"author": "   "}, NewMountainViolation.IMAGE_AUTHOR_MISSING),
        ({"license_name": " "}, NewMountainViolation.IMAGE_LICENSE_NAME_BLANK),
        (
            {"license_url": "https://example.org/license"},
            NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        ),
        (
            {"license_name": "CC", "license_url": "http://example.org/license"},
            NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK,
        ),
        (
            {"license_name": "CC", "license_url": ""},
            NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK,
        ),
        (
            {"source_page_url": "javascript:alert(1)"},
            NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK,
        ),
        ({"source_page_url": ""}, NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK),
    ],
)
def test_a_credit_that_breaks_a_rule_is_refused_before_the_file_is_read(
    create_mountain, store, media, overrides, violation
):
    with pytest.raises(InvalidMountain) as refused:
        create_mountain.execute(with_photograph(**overrides))

    assert violation in refused.value.violations
    assert media.calls == []
    assert store.calls == 0


def test_every_violated_rule_is_reported_at_once(create_mountain):
    with pytest.raises(InvalidMountain) as refused:
        create_mountain.execute(
            new_mountain(
                slug="Bad Slug",
                name="",
                elevation_meters=0,
                photograph=NewPhotograph(data=PHOTOGRAPH, author=""),
            )
        )

    assert refused.value.violations == (
        NewMountainViolation.SLUG_INVALID,
        NewMountainViolation.NAME_BLANK,
        NewMountainViolation.ELEVATION_NOT_POSITIVE,
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
    )


def test_a_draft_needs_neither_a_camera_nor_a_complete_publication_record(create_mountain):
    created = create_mountain.execute(new_mountain())

    assert created.camera is None
    assert created.summary is None
    assert created.countries == ()
    assert created.region is None


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (b"not an image", PhotographRejection.NOT_AN_IMAGE),
        (b"640x480:" + b"x" * 2000, PhotographRejection.TOO_MANY_BYTES),
    ],
)
def test_a_file_that_is_no_acceptable_photograph_stores_nothing(
    create_mountain, store, media, data, reason
):
    with pytest.raises(PhotographRejected) as refused:
        create_mountain.execute(with_photograph(data=data))

    assert refused.value.reason is reason
    assert media.calls == []
    assert store.calls == 0


def test_a_storage_failure_writes_no_row(create_mountain, store, media):
    media.failing = True

    with pytest.raises(InfrastructureError):
        create_mountain.execute(new_mountain())

    assert store.calls == 0
    assert store.mountain("new-peak") is None


def test_a_refusal_by_the_store_is_raised_as_it_is(create_mountain, media):
    with pytest.raises(SlugTaken):
        create_mountain.execute(new_mountain(slug="taken-peak"))

    with pytest.raises(UnknownContinent):
        create_mountain.execute(new_mountain(continent_code="ZZ"))


def test_a_store_refusal_leaves_the_stored_objects_in_place_for_a_retry(
    create_mountain, store, media
):
    with pytest.raises(SlugTaken):
        create_mountain.execute(new_mountain(slug="taken-peak"))
    stored = (set(media.originals), set(media.public))

    created = create_mountain.execute(new_mountain())

    assert stored == (
        {created.primary_image.media.original_key},
        {created.primary_image.media.page_key, created.primary_image.media.viewer_key},
    )


def test_a_draft_may_be_created_without_a_photograph(create_mountain, store, media):
    created = create_mountain.execute(new_mountain(photograph=None))

    assert created.status is MountainStatus.DRAFT
    assert created.primary_image is None
    assert store.mountain("new-peak") == created
    assert (media.originals, media.public) == ({}, {})
