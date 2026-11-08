from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import pytest
from django.conf import settings
from django.contrib.gis.geos import Point
from django.contrib.messages import get_messages
from django.test import Client
from django.urls import reverse
from django.utils.http import urlencode

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.persistence.camera_editor_url import camera_editor_url
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord
from tests.studio.support import csrf_token_of, text_of
from tests.support.catalog import catalog_mountain, catalog_seed

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
# Values whose shortest decimal form is long: the page must carry them without rounding.
AWKWARD = catalog_mountain(
    "awkward-peak",
    camera=CanonicalCamera(
        heading_degrees=359.99999999999994,
        pitch_degrees=-19.850000000000001,
        range_meters=17132.123456789,
        framing=CameraFraming(x=1e-05, y=-0.30000000000000004),
    ),
)
OTHER = catalog_mountain("other-peak", status=MountainStatus.DRAFT, camera=None)

PROPOSED = {"heading": "123.45", "pitch": "-12.5", "range": "4321", "fx": "0.125", "fy": "-0.25"}
PROPOSED_CAMERA = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)
SAVE_BUTTON = ">Save camera</button>"
MOVED = {"lat": "-33.25", "lon": "-70.75"}


@pytest.fixture
def load_catalog(db):
    def load(*entries):
        DjangoCatalogStore().load(catalog_seed(*entries))

    return load


def camera_path(entry):
    return reverse("studio:mountain_camera", args=[entry.mountain.slug])


def proposal_query(entry, query=PROPOSED, **overrides):
    coordinates = entry.mountain.coordinates
    carried = {
        "lat": repr(coordinates.latitude),
        "lon": repr(coordinates.longitude),
        "mountain": str(entry.mountain.id),
        **query,
        **overrides,
    }

    return {key: value for key, value in carried.items() if value is not None}


def camera_url(entry, query=PROPOSED, **overrides):
    """The confirmation address as the editor sends it: the proposal and what it was composed on."""
    return f"{camera_path(entry)}?{urlencode(proposal_query(entry, query, **overrides))}"


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


def stored_camera(entry):
    return to_camera(stored(entry))


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


class _HiddenInputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "input" and attributes.get("type") == "hidden":
            self.values[attributes["name"]] = attributes.get("value", "")


def payload_of(response):
    """What a browser posts from the confirmation page: its hidden fields."""
    parser = _HiddenInputs()
    parser.feed(text_of(response))

    return parser.values


def confirmation_payload(client, entry, query=PROPOSED):
    response = client.get(camera_url(entry, query))
    assert response.status_code == 200

    return payload_of(response)


def move(entry, latitude=-33.25, longitude=-70.75):
    """Another editor's move. A draft or inactive mountain loses its camera with it; an active one
    can only have moved while inactive and been given a camera and reactivated since."""
    columns = {"location": Point(longitude, latitude, srid=4326)}
    if entry.mountain.status is not MountainStatus.ACTIVE:
        columns |= {
            "camera_heading_degrees": None,
            "camera_pitch_degrees": None,
            "camera_range_meters": None,
            "camera_framing_x": None,
            "camera_framing_y": None,
        }
    MountainRecord.objects.filter(pk=entry.mountain.id).update(**columns)


def editor_link_query(response):
    import re

    hrefs = re.findall(r'href="([^"]*editorial/camera\?[^"]*)"', text_of(response))
    assert hrefs
    return {k: v[0] for k, v in parse_qs(urlsplit(unescape(hrefs[0])).query).items()}


class TestConfirmation:
    @pytest.mark.parametrize(
        ("entry", "notice"),
        [
            (DRAFT, "This mountain is a draft"),
            (ACTIVE, "This mountain is on the site"),
            (INACTIVE, "This mountain is on the site"),
        ],
        ids=["draft", "active", "inactive"],
    )
    def test_it_shows_the_current_and_the_proposed_camera_in_every_status(
        self, editor_client, load_catalog, entry, notice
    ):
        load_catalog(entry)

        response = editor_client.get(camera_url(entry))

        assert response.status_code == 200
        body = text_of(response)
        assert notice in body
        assert SAVE_BUTTON in body
        rows = {row["label"]: (row["current"], row["proposed"]) for row in response.context["rows"]}
        current = entry.mountain.camera
        assert rows["Heading (degrees)"] == (
            None if current is None else current.heading_degrees,
            123.45,
        )
        assert rows["Framing y"] == (None if current is None else current.framing.y, -0.25)

    def test_showing_it_changes_nothing(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.filter(pk=ACTIVE.mountain.id).values().get()

        editor_client.get(camera_url(ACTIVE))

        assert MountainRecord.objects.filter(pk=ACTIVE.mountain.id).values().get() == before

    def test_the_form_carries_the_proposed_and_the_current_camera_exactly(
        self, editor_client, load_catalog
    ):
        load_catalog(AWKWARD)
        query = {"heading": "1e-3", "pitch": "-0.0", "range": "2000", "fx": "-1", "fy": "1"}

        payload = confirmation_payload(editor_client, AWKWARD, query)

        current = AWKWARD.mountain.camera
        assert float(payload["expected-heading"]) == current.heading_degrees
        assert float(payload["expected-pitch"]) == current.pitch_degrees
        assert float(payload["expected-range"]) == current.range_meters
        assert float(payload["expected-fx"]) == current.framing.x
        assert float(payload["expected-fy"]) == current.framing.y
        assert float(payload["heading"]) == 0.001
        assert payload["fx"] == "-1.0"

    def test_the_form_carries_the_coordinates_and_the_mountain_the_camera_was_composed_for(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        payload = confirmation_payload(editor_client, ACTIVE)

        coordinates = ACTIVE.mountain.coordinates
        assert float(payload["lat"]) == coordinates.latitude
        assert float(payload["lon"]) == coordinates.longitude
        assert payload["mountain"] == str(ACTIVE.mountain.id)

    def test_a_mountain_without_a_camera_carries_an_empty_current_camera(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)

        payload = confirmation_payload(editor_client, DRAFT)

        assert {payload[f"expected-{name}"] for name in PROPOSED} == {""}

    @pytest.mark.parametrize(
        "query",
        [
            {key: None for key in PROPOSED},
            {**PROPOSED, "fy": ""},
            {key: value for key, value in PROPOSED.items() if key != "fx"},
            {**PROPOSED, "heading": "north"},
            {**PROPOSED, "pitch": "nan"},
            {**PROPOSED, "range": "inf"},
            {**PROPOSED, "range": "1e400"},
        ],
        ids=["empty", "blank", "incomplete", "text", "nan", "inf", "overflow"],
    )
    def test_an_unreadable_query_is_a_message_without_a_save_button(
        self, editor_client, load_catalog, query
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, query))

        assert response.status_code == 400
        body = text_of(response)
        assert "could not be read" in body
        assert SAVE_BUTTON not in body
        assert "Back to the editor" in body

    @pytest.mark.parametrize("fields", [{"heading": "360"}, {"pitch": "-95"}, {"range": "0"}])
    def test_an_out_of_bounds_camera_is_explained_without_a_save_button(
        self, editor_client, load_catalog, fields
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, {**PROPOSED, **fields}))

        assert response.status_code == 400
        body = text_of(response)
        assert "The proposed camera cannot be saved" in body
        assert "The heading is from" in body
        assert SAVE_BUTTON not in body

    def test_it_is_never_framed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        assert editor_client.get(camera_url(ACTIVE))["X-Frame-Options"] == "DENY"

    def test_the_editor_link_returns_to_the_proposal_only_when_it_can_be_used(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        good = editor_link_query(editor_client.get(camera_url(ACTIVE)))
        bad = editor_link_query(editor_client.get(camera_url(ACTIVE, {**PROPOSED, "pitch": "-95"})))

        assert good["proposal"] == "1"
        assert good["heading"] == "123.45"
        assert "proposal" not in bad
        assert float(bad["heading"]) == ACTIVE.mountain.camera.heading_degrees


class TestSave:
    @pytest.mark.parametrize(
        "entry", [DRAFT, ACTIVE, INACTIVE], ids=["draft", "active", "inactive"]
    )
    def test_a_confirmed_camera_is_saved_and_shown(self, editor_client, load_catalog, entry):
        load_catalog(entry)
        payload = confirmation_payload(editor_client, entry)

        response = editor_client.post(camera_path(entry), payload)

        assert response.status_code == 302
        assert response["Location"] == (
            reverse("studio:mountain_detail", args=[entry.mountain.slug]) + "#camera"
        )
        assert stored_camera(entry) == PROPOSED_CAMERA
        assert stored(entry).status == entry.mountain.status.value
        assert messages_of(response) == [f"The camera of {entry.mountain.name.en} was changed."]

        page = editor_client.get(response["Location"].split("#")[0])
        assert "123.45°" in text_of(page)
        assert 'id="camera"' in text_of(page)

    def test_a_camera_changed_since_the_page_was_opened_is_not_overwritten(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(camera_heading_degrees=10.0)

        response = editor_client.post(camera_path(ACTIVE), payload)

        assert response.status_code == 302
        assert stored(ACTIVE).camera_heading_degrees == 10.0
        assert "changed by someone else" in messages_of(response)[0]
        again = editor_client.get(response["Location"])
        assert again.status_code == 200
        assert SAVE_BUTTON in text_of(again)
        rows = {row["label"]: row["current"] for row in again.context["rows"]}
        assert rows["Heading (degrees)"] == 10.0

    def test_a_camera_changed_meanwhile_returns_the_proposal_with_its_coordinates_and_mountain(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(camera_heading_degrees=10.0)

        response = editor_client.post(camera_path(ACTIVE), payload)

        query = {k: v[0] for k, v in parse_qs(urlsplit(response["Location"]).query).items()}
        coordinates = ACTIVE.mountain.coordinates
        assert (float(query["lat"]), float(query["lon"])) == (
            coordinates.latitude,
            coordinates.longitude,
        )
        assert query["mountain"] == str(ACTIVE.mountain.id)
        assert float(query["heading"]) == 123.45

    def test_confirming_twice_writes_once(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        assert editor_client.post(camera_path(ACTIVE), payload).status_code == 302
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(camera_range_meters=5000.0)

        second = editor_client.post(camera_path(ACTIVE), payload)

        assert "changed by someone else" in messages_of(second)[-1]
        assert stored(ACTIVE).camera_range_meters == 5000.0

    def test_a_forged_out_of_bounds_camera_is_refused_and_nothing_is_written(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        response = editor_client.post(camera_path(ACTIVE), {**payload, "range": "999999999"})

        assert response.status_code == 400
        assert "The proposed camera cannot be saved" in text_of(response)
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    @pytest.mark.parametrize("changes", [{"heading": "x"}, {"fy": ""}, {"pitch": "nan"}])
    def test_an_unreadable_submission_is_refused_and_nothing_is_written(
        self, editor_client, load_catalog, changes
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        response = editor_client.post(camera_path(ACTIVE), {**payload, **changes})

        assert response.status_code == 400
        assert SAVE_BUTTON not in text_of(response)
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_a_submission_needs_the_csrf_token(self, editor, load_catalog):
        load_catalog(ACTIVE)
        client = Client(enforce_csrf_checks=True)
        client.force_login(editor)
        page = client.get(camera_url(ACTIVE))
        payload = payload_of(page)
        payload.pop("csrfmiddlewaretoken")

        assert client.post(camera_path(ACTIVE), payload).status_code == 403
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

        payload["csrfmiddlewaretoken"] = csrf_token_of(page)
        assert client.post(camera_path(ACTIVE), payload).status_code == 302
        assert stored_camera(ACTIVE) == PROPOSED_CAMERA

    def test_other_methods_are_not_allowed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        assert editor_client.put(camera_path(ACTIVE)).status_code == 405
        assert editor_client.delete(camera_path(ACTIVE)).status_code == 405


class TestAccess:
    def test_a_viewer_can_neither_see_nor_save_a_camera(
        self, viewer_client, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        assert viewer_client.get(camera_url(ACTIVE)).status_code == 403
        assert viewer_client.post(camera_path(ACTIVE), payload).status_code == 403
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_a_signed_out_visitor_is_sent_to_the_login_and_nothing_is_written(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        visitor = Client()

        get = visitor.get(camera_path(ACTIVE))
        post = visitor.post(camera_path(ACTIVE), payload)

        assert get.status_code == post.status_code == 302
        assert get["Location"].startswith(reverse("studio:login"))
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_an_unknown_mountain_is_not_found_for_both_methods(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        path = reverse("studio:mountain_camera", args=["no-such-peak"])

        assert editor_client.get(path).status_code == 404
        assert editor_client.post(path, payload).status_code == 404

    def test_a_mountain_deleted_between_the_page_and_the_save_is_a_message(
        self, editor_client, load_catalog, monkeypatch
    ):
        from serendipeak.catalog.errors import UnknownMountain
        from serendipeak.studio import camera_views

        load_catalog(DRAFT)
        payload = confirmation_payload(editor_client, DRAFT)

        def vanished(*args):
            raise UnknownMountain(DRAFT.mountain.id)

        monkeypatch.setattr(camera_views.ChangeMountainCamera, "execute", vanished)
        response = editor_client.post(camera_path(DRAFT), payload)

        assert response.status_code == 302
        assert response["Location"] == reverse("studio:mountain_list")
        assert "no longer exists" in messages_of(response)[0]


class TestTheMountainOfTheProposal:
    def test_a_proposal_for_other_coordinates_is_refused_when_it_is_shown(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, **MOVED))

        assert response.status_code == 409
        body = text_of(response)
        assert "Nothing was saved" in body
        assert SAVE_BUTTON not in body
        assert "Reopen the camera editor" in body

    @pytest.mark.parametrize("mountain", [None, "", "not-a-uuid"], ids=["absent", "blank", "text"])
    def test_a_proposal_that_does_not_name_a_mountain_cannot_be_saved(
        self, editor_client, load_catalog, mountain
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, mountain=mountain))

        assert response.status_code == 400
        assert SAVE_BUTTON not in text_of(response)

    def test_a_proposal_prepared_for_another_mountain_is_refused_and_writes_nothing(
        self, editor_client, load_catalog
    ):
        # A slug can be renamed after the editor opened, so its address can become another
        # mountain's: the proposal names the mountain it was composed for.
        load_catalog(ACTIVE, OTHER)
        payload = confirmation_payload(editor_client, ACTIVE)

        shown = editor_client.get(camera_url(OTHER, mountain=str(ACTIVE.mountain.id)))
        saved = editor_client.post(camera_path(OTHER), {**payload, "mountain": payload["mountain"]})

        assert shown.status_code == saved.status_code == 400
        assert stored_camera(OTHER) is None
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera


class TestAStaleProposalOnSave:
    @pytest.mark.parametrize(
        "entry", [DRAFT, ACTIVE, INACTIVE], ids=["draft", "active", "inactive"]
    )
    def test_a_save_after_the_mountain_moved_is_refused_and_writes_nothing(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)
        payload = confirmation_payload(editor_client, entry)
        move(entry)
        moved = MountainRecord.objects.filter(pk=entry.mountain.id).values().get()

        response = editor_client.post(camera_path(entry), payload)

        assert response.status_code == 409
        assert "Nothing was saved" in text_of(response)
        assert MountainRecord.objects.filter(pk=entry.mountain.id).values().get() == moved
        query = editor_link_query(response)
        assert (query["lat"], query["lon"]) == ("-33.25", "-70.75")

    def test_it_is_refused_when_both_the_expected_and_the_stored_camera_are_absent(
        self, editor_client, load_catalog
    ):
        # The camera comparison passes when both are absent, so only the coordinates can tell
        # that the proposal was composed on another summit.
        load_catalog(DRAFT)
        payload = confirmation_payload(editor_client, DRAFT)
        assert {payload[f"expected-{name}"] for name in PROPOSED} == {""}
        move(DRAFT)

        response = editor_client.post(camera_path(DRAFT), payload)

        assert response.status_code == 409
        assert stored_camera(DRAFT) is None

    @pytest.mark.parametrize(
        "changes",
        [{"lat": ""}, {"lon": "x"}, {"lat": "91"}],
        ids=["blank", "text", "range"],
    )
    def test_an_unreadable_location_is_refused_and_nothing_is_written(
        self, editor_client, load_catalog, changes
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        response = editor_client.post(camera_path(ACTIVE), {**payload, **changes})

        assert response.status_code == 400
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_reopening_the_editor_on_the_new_location_leads_to_a_camera_that_saves(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        payload = confirmation_payload(editor_client, DRAFT)
        move(DRAFT)
        refused = editor_client.post(camera_path(DRAFT), payload)
        reopened = editor_link_query(refused)

        confirmation = editor_client.get(
            camera_url(DRAFT, lat=reopened["lat"], lon=reopened["lon"])
        )
        assert confirmation.status_code == 200
        saved = editor_client.post(camera_path(DRAFT), payload_of(confirmation))

        assert saved.status_code == 302
        assert stored_camera(DRAFT) == PROPOSED_CAMERA


class TestTheEditorLink:
    @pytest.mark.parametrize(
        "entry", [DRAFT, ACTIVE, INACTIVE], ids=["draft", "active", "inactive"]
    )
    def test_the_mountain_page_opens_the_editor_for_an_editor(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)

        response = editor_client.get(reverse("studio:mountain_detail", args=[entry.mountain.slug]))

        link = response.context["camera_editor_url"]
        assert link.startswith(f"{settings.WEB_ORIGIN}/editorial/camera?")
        assert f'href="{unescape(link) if False else link}"'.replace("&", "&amp;") in text_of(
            response
        )
        assert "Edit camera visually" in text_of(response)
        query = editor_link_query(response)
        assert query["mountain"] == str(entry.mountain.id)
        assert query["slug"] == entry.mountain.slug

    def test_it_is_the_link_the_admin_builds_for_the_same_mountain(
        self, load_catalog, editor_client
    ):
        load_catalog(ACTIVE, DRAFT)

        for entry in (ACTIVE, DRAFT):
            response = editor_client.get(
                reverse("studio:mountain_detail", args=[entry.mountain.slug])
            )

            assert response.context["camera_editor_url"] == camera_editor_url(
                settings.WEB_ORIGIN, stored(entry)
            )

    def test_a_viewer_is_not_offered_the_editor(self, viewer_client, load_catalog):
        load_catalog(ACTIVE)

        response = viewer_client.get(reverse("studio:mountain_detail", args=[ACTIVE.mountain.slug]))

        assert "Edit camera visually" not in text_of(response)

    def test_the_edit_page_links_to_the_editor_with_the_saved_mountain(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(reverse("studio:mountain_edit", args=[ACTIVE.mountain.slug]))

        query = editor_link_query(response)
        assert query["mountain"] == str(ACTIVE.mountain.id)
        assert "edit the camera visually" in text_of(response)

    def test_the_creation_page_has_no_editor_link_because_there_is_no_mountain_yet(
        self, editor_client, db
    ):
        response = editor_client.get(reverse("studio:mountain_new"))

        assert "editorial/camera" not in text_of(response)
