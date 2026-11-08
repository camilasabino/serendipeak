import uuid
from dataclasses import replace

import pytest

from serendipeak.catalog.entities import ImageDimensions, MountainStatus
from serendipeak.catalog.errors import (
    MountainHasNoPhotograph,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
    UnknownMountain,
)
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.new_mountain import PhotographCredit
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import MountainRecord
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import (
    catalog_mountain,
    catalog_of,
    photograph_media,
    primary_image,
)
from tests.support.fakes import InMemoryMountainUpdateStore
from tests.support.geography import continent, countries
from tests.support.regions import region_path, regions_of

pytestmark = pytest.mark.django_db

PATH = region_path("Test Chain", "Test Range")
REGIONS = regions_of(PATH)
LEAF = next(region for region in REGIONS if region.slug == "test-range")
ROOT = next(region for region in REGIONS if region.slug == "test-chain")
ABSENT_REGION_ID = catalog_mountain("elsewhere", region=region_path("Elsewhere")).mountain.id

TARGET = catalog_mountain("target-peak", region=PATH).mountain
OTHER = catalog_mountain("other-peak", region=PATH).mountain
DRAFT = catalog_mountain(
    "draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None
).mountain
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE, camera=None).mountain
ENTRIES = [
    catalog_mountain("target-peak", region=PATH),
    catalog_mountain("other-peak", region=PATH),
    catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None),
    catalog_mountain("old-peak", status=MountainStatus.INACTIVE, camera=None),
]


REPLACEMENT = primary_image(
    media=photograph_media("d" * 64),
    dimensions=ImageDimensions(width=640, height=480),
    author="A. Photographer",
    license_name=None,
    license_url=None,
    source_page_url=None,
)


def update_of(**overrides):
    fields = {
        "slug": "target-peak",
        "name": "Target Peak",
        "elevation_meters": 6961,
        "continent_code": "SA",
        "country_codes": ("AR",),
        "region_id": LEAF.id,
        "summary": "Highest mountain outside Asia.",
        "osm_node_id": 1504741757,
        "wikidata_id": "Q39739",
    }
    fields.update(overrides)

    return MountainUpdate(**fields)


class Arrangement:
    def __init__(self, store, mountain_of):
        self.store = store
        self.mountain_of = mountain_of

    def update(self, mountain=TARGET, **overrides):
        return self.store.update(mountain.id, update_of(**overrides), public_edit_violations)


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryMountainUpdateStore([TARGET, OTHER, DRAFT, INACTIVE], REGIONS)
        return Arrangement(store, lambda mountain: store.mountain(mountain.id))

    request.getfixturevalue("db")
    DjangoCatalogStore().load(catalog_of(*ENTRIES))

    return Arrangement(
        DjangoMountainUpdateStore(),
        lambda mountain: to_mountain(MountainRecord.objects.get(pk=mountain.id)),
    )


def test_the_content_and_geography_are_stored_and_returned_as_stored(arranged):
    updated = arranged.update(
        slug="renamed-peak",
        name="Renamed Peak",
        elevation_meters=7000,
        continent_code="EU",
        country_codes=("CL", "AR"),
        region_id=ROOT.id,
        summary="A new summary.",
        osm_node_id=42,
        wikidata_id="Q42",
    )

    assert updated.slug == "renamed-peak"
    assert updated.name.en == "Renamed Peak"
    assert updated.elevation_meters == 7000
    assert updated.continent == continent("EU")
    assert updated.countries == countries("AR", "CL")
    assert updated.region.region.slug == "test-chain"
    assert updated.summary.en == "A new summary."
    assert (updated.osm_node_id, updated.wikidata_id) == (42, "Q42")
    assert arranged.mountain_of(TARGET).slug == "renamed-peak"
    assert arranged.mountain_of(TARGET).countries == countries("AR", "CL")


def test_an_absent_optional_value_clears_the_stored_one_and_no_countries_clears_the_links(arranged):
    updated = arranged.update(
        country_codes=(), region_id=None, summary=None, osm_node_id=None, wikidata_id=None
    )

    assert updated.countries == ()
    assert updated.region is None
    assert updated.summary is None
    assert (updated.osm_node_id, updated.wikidata_id) == (None, None)
    assert arranged.mountain_of(TARGET) == updated


def test_a_repeated_country_code_is_one_link(arranged):
    updated = arranged.update(country_codes=("AR", "AR", "CL"))

    assert updated.countries == countries("AR", "CL")


def test_what_is_outside_the_update_is_preserved(arranged):
    updated = arranged.update(name="Changed", country_codes=("CL",))

    assert updated.id == TARGET.id
    assert updated.status is TARGET.status
    assert updated.coordinates == TARGET.coordinates
    assert updated.camera == TARGET.camera
    assert updated.primary_image == TARGET.primary_image
    assert arranged.mountain_of(TARGET).primary_image == TARGET.primary_image


def test_the_other_mountains_are_untouched(arranged):
    before = arranged.mountain_of(OTHER)

    arranged.update(name="Changed", country_codes=("CL",))

    assert arranged.mountain_of(OTHER) == before


def test_an_update_equal_to_the_stored_state_returns_it_unchanged(arranged):
    assert arranged.update() == arranged.mountain_of(TARGET)
    assert arranged.mountain_of(TARGET) == TARGET


def test_the_own_slug_is_not_taken(arranged):
    assert arranged.update(slug="target-peak").slug == "target-peak"


def test_a_slug_of_another_mountain_is_refused_and_nothing_is_stored(arranged):
    before = arranged.mountain_of(TARGET)

    with pytest.raises(SlugTaken) as refused:
        arranged.update(slug="other-peak", name="Changed", country_codes=("CL",))

    assert refused.value.slug == "other-peak"
    assert arranged.mountain_of(TARGET) == before


def test_an_unknown_mountain_is_refused(arranged):
    with pytest.raises(UnknownMountain) as refused:
        arranged.store.update(uuid.UUID(int=1), update_of(), public_edit_violations)

    assert refused.value.mountain_id == uuid.UUID(int=1)


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"continent_code": "ZZ"}, UnknownContinent),
        ({"region_id": ABSENT_REGION_ID}, UnknownRegion),
        ({"country_codes": ("AR", "ZZ")}, UnknownCountries),
    ],
    ids=["continent", "region", "countries"],
)
def test_an_unknown_reference_is_refused_and_nothing_is_stored(arranged, overrides, error):
    before = arranged.mountain_of(TARGET)

    with pytest.raises(error):
        arranged.update(name="Changed", **overrides)

    assert arranged.mountain_of(TARGET) == before


def test_the_unknown_references_are_named(arranged):
    with pytest.raises(UnknownContinent) as continent_error:
        arranged.update(continent_code="ZZ")
    with pytest.raises(UnknownRegion) as region_error:
        arranged.update(region_id=ABSENT_REGION_ID)
    with pytest.raises(UnknownCountries) as countries_error:
        arranged.update(country_codes=("QQ", "AR", "ZZ"))

    assert continent_error.value.code == "ZZ"
    assert region_error.value.region_id == ABSENT_REGION_ID
    assert countries_error.value.codes == ("QQ", "ZZ")


def test_the_first_applicable_refusal_in_the_documented_order_is_raised(arranged):
    with pytest.raises(UnknownMountain):
        arranged.store.update(
            uuid.UUID(int=1),
            update_of(slug="other-peak", continent_code="ZZ"),
            public_edit_violations,
        )
    with pytest.raises(SlugTaken):
        arranged.update(
            slug="other-peak",
            continent_code="ZZ",
            region_id=ABSENT_REGION_ID,
            country_codes=("ZZ",),
        )
    with pytest.raises(UnknownContinent):
        arranged.update(continent_code="ZZ", region_id=ABSENT_REGION_ID, country_codes=("ZZ",))
    with pytest.raises(UnknownRegion):
        arranged.update(region_id=ABSENT_REGION_ID, country_codes=("ZZ",))


def test_the_gate_judges_the_mountain_as_it_would_be_stored(arranged):
    judged = []

    def gate(prospective):
        judged.append(prospective)

        return ()

    arranged.store.update(
        TARGET.id, update_of(name="Judged", country_codes=("CL",), region_id=ROOT.id), gate
    )

    [prospective] = judged
    assert prospective.name == LocalizedText(en="Judged")
    assert prospective.countries == countries("CL")
    assert prospective.region.region.slug == "test-chain"
    assert prospective.camera == TARGET.camera
    assert prospective.primary_image == TARGET.primary_image


def test_a_rejecting_gate_raises_with_its_answer_and_nothing_is_stored(arranged):
    before = arranged.mountain_of(TARGET)

    with pytest.raises(PublicationRejected) as rejected:
        arranged.store.update(
            TARGET.id,
            update_of(name="Changed", country_codes=("CL",)),
            lambda prospective: (PublicationViolation.CAMERA_MISSING,),
        )

    assert rejected.value.violations == (PublicationViolation.CAMERA_MISSING,)
    assert arranged.mountain_of(TARGET) == before


def test_a_public_mountain_may_not_be_saved_unpublishable(arranged):
    with pytest.raises(PublicationRejected) as rejected:
        arranged.update(summary="not a sentence")

    assert rejected.value.violations == (PublicationViolation.SUMMARY_INVALID,)
    assert arranged.mountain_of(TARGET) == TARGET


def test_a_draft_and_an_inactive_mountain_without_a_camera_may_be_saved(arranged):
    draft = arranged.update(DRAFT, slug="draft-peak", name="Draft Edited", summary="x")
    inactive = arranged.update(INACTIVE, slug="old-peak", name="Old Edited")

    assert draft.status is MountainStatus.DRAFT
    assert draft.summary.en == "x"
    assert inactive.status is MountainStatus.INACTIVE
    assert inactive.camera is None
    assert inactive.name.en == "Old Edited"


def test_a_replacement_photograph_is_stored_and_returned_with_its_credit(arranged):
    updated = arranged.store.update(TARGET.id, update_of(), public_edit_violations, REPLACEMENT)

    assert updated.primary_image == REPLACEMENT
    assert arranged.mountain_of(TARGET).primary_image == REPLACEMENT


def test_a_replacement_leaves_the_content_and_the_other_mountains_as_they_were(arranged):
    other = arranged.mountain_of(OTHER)

    updated = arranged.store.update(TARGET.id, update_of(), public_edit_violations, REPLACEMENT)

    assert updated == arranged.mountain_of(TARGET)
    assert replace(updated, primary_image=TARGET.primary_image) == TARGET
    assert arranged.mountain_of(OTHER) == other


def test_a_replacement_changes_the_photograph_together_with_the_content(arranged):
    updated = arranged.store.update(
        TARGET.id,
        update_of(name="Changed", country_codes=("CL",)),
        public_edit_violations,
        REPLACEMENT,
    )

    assert (updated.name.en, updated.countries) == ("Changed", countries("CL"))
    assert updated.primary_image == REPLACEMENT


def test_a_replacement_gives_a_draft_without_a_photograph_one(arranged):
    updated = arranged.store.update(
        DRAFT.id, update_of(slug="draft-peak"), public_edit_violations, REPLACEMENT
    )

    assert updated.primary_image == REPLACEMENT
    assert arranged.mountain_of(DRAFT).primary_image == REPLACEMENT


def test_the_gate_judges_the_replacement_and_a_rejection_keeps_the_stored_photograph(arranged):
    judged = []

    def gate(prospective):
        judged.append(prospective.primary_image)

        return (PublicationViolation.IMAGE_AUTHOR_MISSING,)

    with pytest.raises(PublicationRejected):
        arranged.store.update(TARGET.id, update_of(), gate, REPLACEMENT)

    assert judged == [REPLACEMENT]
    assert arranged.mountain_of(TARGET).primary_image == TARGET.primary_image


def test_a_refusal_keeps_the_stored_photograph(arranged):
    with pytest.raises(SlugTaken):
        arranged.store.update(
            TARGET.id, update_of(slug="other-peak"), public_edit_violations, REPLACEMENT
        )

    assert arranged.mountain_of(TARGET).primary_image == TARGET.primary_image


def test_without_an_image_the_photograph_is_untouched(arranged):
    updated = arranged.update(name="Changed")

    assert updated.primary_image == TARGET.primary_image


CREDIT = PhotographCredit(
    author="Another Author",
    license_name="CC BY 4.0",
    license_url="https://creativecommons.org/licenses/by/4.0/",
    source_page_url=None,
)


def test_a_credit_replaces_the_credit_of_the_stored_photograph_and_keeps_its_file(arranged):
    updated = arranged.update(credit=CREDIT)

    expected = replace(
        TARGET.primary_image,
        author=CREDIT.author,
        license_name=CREDIT.license_name,
        license_url=CREDIT.license_url,
        source_page_url=None,
    )
    assert updated.primary_image == expected
    assert arranged.mountain_of(TARGET).primary_image == expected


def test_the_gate_judges_the_mountain_with_the_new_credit_and_a_rejection_keeps_the_old_one(
    arranged,
):
    with pytest.raises(PublicationRejected):
        arranged.store.update(
            TARGET.id,
            update_of(credit=CREDIT),
            lambda prospective: (
                (PublicationViolation.IMAGE_AUTHOR_MISSING,)
                if prospective.primary_image.author == CREDIT.author
                else ()
            ),
        )

    assert arranged.mountain_of(TARGET).primary_image == TARGET.primary_image


def test_a_credit_for_a_mountain_without_a_photograph_is_refused_and_nothing_is_stored(arranged):
    with pytest.raises(MountainHasNoPhotograph):
        arranged.store.update(
            DRAFT.id,
            update_of(slug="draft-peak", name="Changed", credit=CREDIT),
            public_edit_violations,
        )

    assert arranged.mountain_of(DRAFT).name.en == DRAFT.name.en


def test_removing_the_photograph_of_a_draft_deletes_it_with_its_credit(arranged):
    arranged.store.update(
        DRAFT.id, update_of(slug="draft-peak"), public_edit_violations, REPLACEMENT
    )

    updated = arranged.store.update(
        DRAFT.id, update_of(slug="draft-peak", remove_photograph=True), public_edit_violations
    )

    assert updated.primary_image is None
    assert arranged.mountain_of(DRAFT).primary_image is None


def test_removing_the_photograph_of_a_draft_without_one_is_not_a_change(arranged):
    updated = arranged.store.update(
        DRAFT.id,
        update_of(
            slug=DRAFT.slug,
            name=DRAFT.name.en,
            elevation_meters=DRAFT.elevation_meters,
            country_codes=tuple(country.code for country in DRAFT.countries),
            region_id=None if DRAFT.region is None else LEAF.id,
            summary=None if DRAFT.summary is None else DRAFT.summary.en,
            osm_node_id=DRAFT.osm_node_id,
            wikidata_id=DRAFT.wikidata_id,
            remove_photograph=True,
        ),
        public_edit_violations,
    )

    assert updated.primary_image is None


@pytest.mark.parametrize("mountain", [TARGET, INACTIVE])
def test_the_gate_refuses_removing_the_photograph_of_a_public_mountain(arranged, mountain):
    before = arranged.mountain_of(mountain)

    with pytest.raises(PublicationRejected) as rejected:
        arranged.store.update(
            mountain.id,
            update_of(slug=mountain.slug, remove_photograph=True),
            public_edit_violations,
        )

    assert PublicationViolation.PRIMARY_IMAGE_MISSING in rejected.value.violations
    assert arranged.mountain_of(mountain) == before
