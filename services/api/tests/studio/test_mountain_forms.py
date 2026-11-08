import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from serendipeak.catalog.entities import Coordinates, MountainStatus
from serendipeak.catalog.get_mountain_form_options import GetMountainFormOptions
from serendipeak.catalog.new_mountain import NewPhotograph, PhotographCredit
from serendipeak.studio import mountain_messages as messages
from serendipeak.studio.mountain_forms import (
    MountainForm,
    PhotographChange,
    PhotographForm,
    initial_of,
)
from tests.support.catalog import mountain, primary_image
from tests.support.fakes import InMemoryGeographyOptionsReader
from tests.support.regions import region_path, regions_of

MAX_BYTES = 1024
REGION = region_path("Andes", "Southern Andes")
OPTIONS = GetMountainFormOptions(InMemoryGeographyOptionsReader(regions_of(REGION))).execute()
REGION_ID = next(option.id for option in OPTIONS.regions if option.slug == "southern-andes")


def valid(**overrides):
    return {
        "name": "New Peak",
        "slug": "new-peak",
        "latitude": "46.5",
        "longitude": "8.5",
        "elevation_meters": "3500",
        "continent": "EU",
        "region": "",
        "summary": "",
        "osm_node_id": "",
        "wikidata_id": "",
        **overrides,
    }


def mountain_form(data=None, stored=None, **kwargs):
    return MountainForm(data, options=OPTIONS, stored=stored, **kwargs)


def photograph_form(data=None, files=None, stored=None, removable=False):
    return PhotographForm(data, files, stored=stored, removable=removable, max_bytes=MAX_BYTES)


def photo_data(**overrides):
    return {"photograph-author": "A. Photographer", **overrides}


def jpeg_file(size=16):
    return SimpleUploadedFile("photo.jpg", b"x" * size, content_type="image/jpeg")


def test_a_complete_mountain_is_valid_and_becomes_a_new_mountain():
    form = mountain_form(valid(region=str(REGION_ID), countries=["CH", "IT"], summary="A peak."))

    assert form.is_valid(), form.errors
    new = form.new_mountain(PhotographChange())
    assert (new.slug, new.name, new.continent_code) == ("new-peak", "New Peak", "EU")
    assert new.coordinates == Coordinates(latitude=46.5, longitude=8.5)
    assert new.country_codes == ("CH", "IT")
    assert new.region_id == REGION_ID
    assert new.summary == "A peak."
    assert (new.osm_node_id, new.wikidata_id, new.photograph) == (None, None, None)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("name", "", messages.NAME_REQUIRED),
        ("slug", "Not A Slug", messages.SLUG_MESSAGE),
        ("slug", "today", messages.SLUG_MESSAGE),
        ("latitude", "91", messages.LATITUDE_MESSAGE),
        ("longitude", "-181", messages.LONGITUDE_MESSAGE),
        ("elevation_meters", "0", messages.ELEVATION_MESSAGE),
        ("osm_node_id", "0", messages.OSM_NODE_ID_MESSAGE),
        ("wikidata_id", "39739", messages.WIKIDATA_MESSAGE),
        ("summary", "no capital or period", messages.SUMMARY_MESSAGES),
    ],
)
def test_each_rule_of_the_content_is_a_field_error(field, value, message):
    form = mountain_form(valid(**{field: value}))

    assert not form.is_valid()
    assert list(form.errors) == [field]
    if isinstance(message, dict):
        assert form.errors[field][0] in message.values()
    else:
        assert form.errors[field] == [message]


def test_a_continent_is_required_and_never_inferred_from_the_countries():
    form = mountain_form(valid(continent="", countries=["CH"]))

    assert not form.is_valid()
    assert "continent" in form.errors


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("continent", "XX"),
        ("region", "00000000-0000-0000-0000-000000000000"),
        ("countries", ["ZZ"]),
    ],
)
def test_a_reference_that_is_not_offered_is_refused(field, value):
    form = mountain_form(valid(**{field: value}))

    assert not form.is_valid()
    assert field in form.errors


def test_regions_are_offered_in_tree_order_with_their_path_and_no_region_first():
    choices = mountain_form().fields["region"].choices

    assert choices == [
        ("", "No region"),
        (str(OPTIONS.regions[0].id), "Andes"),
        (str(OPTIONS.regions[1].id), "Andes › Southern Andes"),
    ]


def test_a_blank_optional_text_is_absent_not_empty():
    form = mountain_form(valid(wikidata_id="", summary="", osm_node_id=""))

    assert form.is_valid()
    assert form.cleaned_data["wikidata_id"] is None
    assert form.cleaned_data["summary"] is None
    assert form.cleaned_data["osm_node_id"] is None


def stored(status=MountainStatus.DRAFT, **overrides):
    return mountain("stored-peak", status=status, **overrides)


def data_of(stored_mountain, **overrides):
    return {**initial_of(stored_mountain, OPTIONS), **overrides}


def test_the_form_starts_from_the_stored_mountain_with_exact_coordinates():
    peak = stored(region=REGION, coordinates=Coordinates(latitude=-32.6531487, longitude=-70.01))

    initial = initial_of(peak, OPTIONS)

    assert initial["latitude"] == "-32.6531487"
    assert float(initial["latitude"]) == peak.coordinates.latitude
    assert initial["region"] == str(REGION_ID)
    assert initial["continent"] == peak.continent.code


def test_saving_the_stored_values_unchanged_is_valid_and_does_not_move_the_mountain():
    peak = stored()

    form = mountain_form(data_of(peak), stored=peak)

    assert form.is_valid(), form.errors
    assert not form.moves_the_mountain


def test_changing_the_coordinates_of_a_draft_asks_for_the_camera_reset_confirmation():
    peak = stored()

    form = mountain_form(data_of(peak, latitude="10.5"), stored=peak)

    assert not form.is_valid()
    assert form.errors["confirm_camera_reset"] == [messages.CAMERA_RESET_REQUIRED]


def test_a_confirmed_change_of_coordinates_moves_the_mountain():
    peak = stored(status=MountainStatus.INACTIVE)

    form = mountain_form(data_of(peak, latitude="10.5", confirm_camera_reset="on"), stored=peak)

    assert form.is_valid(), form.errors
    assert form.moves_the_mountain
    assert form.camera_reset_confirmed
    assert form.coordinates.latitude == 10.5


def test_a_published_mountain_cannot_be_moved_whatever_is_posted():
    peak = stored(status=MountainStatus.ACTIVE)

    form = mountain_form(
        data_of(peak, latitude="10.5", longitude="20.5", confirm_camera_reset="on"), stored=peak
    )

    assert form.is_valid(), form.errors
    assert not form.moves_the_mountain
    assert form.coordinates == peak.coordinates
    assert "confirm_camera_reset" not in form.fields


def test_only_a_mountain_on_the_site_warns_that_its_slug_is_its_address():
    assert (
        "public address"
        in mountain_form(stored=stored(MountainStatus.ACTIVE)).fields["slug"].help_text
    )
    assert (
        "public address"
        in mountain_form(stored=stored(MountainStatus.INACTIVE)).fields["slug"].help_text
    )
    assert mountain_form(stored=stored(MountainStatus.DRAFT)).fields["slug"].help_text == ""
    assert mountain_form().fields["slug"].help_text == ""


def test_the_update_carries_the_photograph_change_and_the_whole_state():
    peak = stored()
    form = mountain_form(data_of(peak, name="Renamed Peak"), stored=peak)
    assert form.is_valid()
    credit = PhotographCredit(author="New Author")

    update = form.mountain_update(PhotographChange(credit=credit))

    assert update.name == "Renamed Peak"
    assert update.slug == peak.slug
    assert update.credit == credit
    assert (update.photograph, update.remove_photograph) == (None, False)


# The photograph card.


def test_no_photograph_input_is_no_change_to_a_mountain_without_one():
    form = photograph_form({})

    assert form.is_valid()
    assert form.change == PhotographChange()


def test_a_file_needs_an_author():
    form = photograph_form({}, {"photograph-file": jpeg_file()})

    assert not form.is_valid()
    assert form.errors["author"] == [messages.AUTHOR_REQUIRED]


def test_a_file_with_its_credit_becomes_a_new_photograph():
    form = photograph_form(
        photo_data(**{"photograph-license-name": ""}),
        {"photograph-file": jpeg_file()},
    )

    assert form.is_valid(), form.errors
    assert form.change == PhotographChange(
        photograph=NewPhotograph(data=b"x" * 16, author="A. Photographer")
    )


def test_a_credit_without_a_file_on_a_mountain_without_a_photograph_asks_for_the_file():
    form = photograph_form(photo_data())

    assert not form.is_valid()
    assert form.errors["file"] == [messages.PHOTOGRAPH_REQUIRED]


@pytest.mark.parametrize(
    ("data", "field", "message"),
    [
        (
            {"photograph-license_url": "https://example.org/license"},
            "license_name",
            messages.LICENSE_NAME_FOR_URL,
        ),
        ({"photograph-source_page_url": "http://example.org"}, "source_page_url", None),
        (
            {"photograph-license_name": "CC", "photograph-license_url": "ftp://example.org"},
            "license_url",
            messages.PUBLIC_LINK_MESSAGE,
        ),
    ],
)
def test_the_credit_rules_are_the_domains(data, field, message):
    form = photograph_form(photo_data(**data), {"photograph-file": jpeg_file()})

    assert not form.is_valid()
    assert field in form.errors
    if message:
        assert form.errors[field] == [message]


def test_a_file_over_the_limit_is_refused_unread():
    form = photograph_form(photo_data(), {"photograph-file": jpeg_file(MAX_BYTES + 1)})

    assert not form.is_valid()
    assert form.errors["file"] == [messages.too_many_bytes(MAX_BYTES)]


STORED = primary_image()


def stored_data(**overrides):
    return {
        "photograph-author": STORED.author,
        "photograph-license_name": STORED.license_name,
        "photograph-license_url": STORED.license_url,
        "photograph-source_page_url": STORED.source_page_url,
        **overrides,
    }


def test_the_stored_credit_fills_the_form_and_leaving_it_alone_changes_nothing():
    form = photograph_form(stored_data(), stored=STORED)

    assert form.initial["author"] == STORED.author
    assert form.is_valid(), form.errors
    assert form.change == PhotographChange()


def test_changing_only_the_credit_keeps_the_file():
    form = photograph_form(stored_data(**{"photograph-author": "Someone Else"}), stored=STORED)

    assert form.is_valid(), form.errors
    assert form.change.credit == PhotographCredit(
        author="Someone Else",
        license_name=STORED.license_name,
        license_url=STORED.license_url,
        source_page_url=STORED.source_page_url,
    )
    assert form.change.photograph is None


def test_clearing_the_author_of_the_stored_credit_is_refused():
    form = photograph_form(stored_data(**{"photograph-author": ""}), stored=STORED)

    assert not form.is_valid()
    assert form.errors["author"] == [messages.AUTHOR_REQUIRED]


def test_a_replacement_with_the_unchanged_credit_needs_the_review_confirmation():
    form = photograph_form(stored_data(), {"photograph-file": jpeg_file()}, stored=STORED)

    assert not form.is_valid()
    assert form.errors["credit_reviewed"] == [messages.CREDIT_NOT_REVIEWED]


def test_confirming_that_the_credit_still_applies_allows_the_replacement():
    form = photograph_form(
        stored_data(**{"photograph-credit_reviewed": "on"}),
        {"photograph-file": jpeg_file()},
        stored=STORED,
    )

    assert form.is_valid(), form.errors
    assert form.change.photograph.author == STORED.author


def test_a_replacement_with_a_changed_credit_needs_no_confirmation():
    form = photograph_form(
        stored_data(**{"photograph-author": "Someone Else"}),
        {"photograph-file": jpeg_file()},
        stored=STORED,
    )

    assert form.is_valid(), form.errors
    assert form.change.photograph.author == "Someone Else"


def test_only_a_draft_with_a_photograph_offers_to_remove_it():
    assert "remove" in photograph_form(stored=STORED, removable=True).fields
    assert "remove" not in photograph_form(stored=STORED, removable=False).fields
    assert "remove" not in photograph_form(stored=None, removable=True).fields


def test_removing_the_photograph_ignores_the_credit():
    form = photograph_form(
        stored_data(**{"photograph-remove": "on", "photograph-author": ""}),
        stored=STORED,
        removable=True,
    )

    assert form.is_valid(), form.errors
    assert form.change == PhotographChange(remove=True)


def test_removing_and_replacing_at_once_is_refused():
    form = photograph_form(
        stored_data(**{"photograph-remove": "on"}),
        {"photograph-file": jpeg_file()},
        stored=STORED,
        removable=True,
    )

    assert not form.is_valid()
    assert form.errors["file"] == [messages.REMOVE_AND_REPLACE]
