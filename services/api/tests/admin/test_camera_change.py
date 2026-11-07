import uuid
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.messages import get_messages
from django.test import Client
from django.urls import reverse
from django.utils.http import urlencode

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord
from tests.admin.support import form_payload
from tests.support.catalog import catalog_mountain

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

PROPOSED = {"heading": "123.45", "pitch": "-12.5", "range": "4321", "fx": "0.125", "fy": "-0.25"}
PROPOSED_CAMERA = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)
SAVE_BUTTON = 'value="Save camera"'


def camera_url(entry, query=PROPOSED):
    url = reverse("admin:catalog_mountainrecord_camera", args=[entry.mountain.id])
    return f"{url}?{urlencode(query)}" if query else url


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def stored_camera(entry):
    return to_camera(MountainRecord.objects.get(pk=entry.mountain.id))


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


def confirmation_payload(client, entry, query=PROPOSED):
    response = client.get(camera_url(entry, query))
    assert response.status_code == 200

    return form_payload(response)


class TestConfirmation:
    @pytest.mark.parametrize(
        ("entry", "notice"),
        [
            (DRAFT, "This mountain is a draft"),
            (ACTIVE, "This mountain is public"),
            (INACTIVE, "This mountain is public"),
        ],
        ids=["draft", "active", "inactive"],
    )
    def test_it_shows_the_current_and_the_proposed_camera_in_every_status(
        self, editor_client, load_catalog, entry, notice
    ):
        load_catalog(entry)

        response = editor_client.get(camera_url(entry))

        assert response.status_code == 200
        html = response.content.decode()
        assert notice in html
        assert SAVE_BUTTON in html
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
        assert not LogEntry.objects.exists()

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

    def test_a_mountain_without_a_camera_carries_an_empty_current_camera(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)

        payload = confirmation_payload(editor_client, DRAFT)

        assert {payload[f"expected-{name}"] for name in PROPOSED} == {""}

    @pytest.mark.parametrize(
        "query",
        [
            {},
            {**PROPOSED, "fy": ""},
            {key: value for key, value in PROPOSED.items() if key != "fx"},
            {**PROPOSED, "heading": "north"},
            {**PROPOSED, "pitch": "nan"},
            {**PROPOSED, "range": "inf"},
            {**PROPOSED, "range": "1e400"},
        ],
        ids=["empty", "blank", "missing", "text", "nan", "infinite", "overflow"],
    )
    def test_an_unreadable_query_is_a_message_without_a_save_button(
        self, editor_client, load_catalog, query
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, query))

        assert response.status_code == 400
        html = response.content.decode()
        assert "could not be read" in html
        assert SAVE_BUTTON not in html
        assert 'id="camera_form"' not in html

    @pytest.mark.parametrize(
        ("changes", "problem"),
        [
            ({"heading": "360"}, "The heading is from 0 to below 360 degrees"),
            ({"pitch": "15.5"}, "the pitch from -60 to 15 degrees"),
            ({"range": "1999"}, "the range from 2000 to 80000 meters"),
            ({"fx": "-1.5"}, "The framing x and y are from -1 to 1."),
        ],
    )
    def test_an_out_of_bounds_camera_is_explained_without_a_save_button(
        self, editor_client, load_catalog, changes, problem
    ):
        load_catalog(ACTIVE)

        response = editor_client.get(camera_url(ACTIVE, {**PROPOSED, **changes}))

        assert response.status_code == 400
        html = response.content.decode()
        assert problem in html
        assert SAVE_BUTTON not in html

    def test_it_is_never_framed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        assert editor_client.get(camera_url(ACTIVE))["X-Frame-Options"] == "DENY"


class TestSave:
    @pytest.mark.parametrize(
        "entry", [DRAFT, ACTIVE, INACTIVE], ids=["draft", "active", "inactive"]
    )
    def test_a_confirmed_camera_is_saved_logged_and_shown(self, editor_client, load_catalog, entry):
        load_catalog(entry)
        payload = confirmation_payload(editor_client, entry)

        response = editor_client.post(camera_url(entry, None), payload)

        assert response.status_code == 302
        assert response["Location"] == f"{change_url(entry)}#camera"
        assert stored_camera(entry) == PROPOSED_CAMERA
        record = MountainRecord.objects.get(pk=entry.mountain.id)
        assert record.status == entry.mountain.status.value
        assert messages_of(response) == [f"The camera of {record.name_en} was changed."]
        log = LogEntry.objects.get()
        assert (log.object_id, log.get_change_message()) == (
            str(entry.mountain.id),
            "Camera changed.",
        )

    def test_a_saved_camera_is_served_with_its_exact_values(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        query = {
            "heading": "359.99",
            "pitch": "-59.99",
            "range": "79999.5",
            "fx": "0.1234",
            "fy": "-0.9876",
        }
        editor_client.post(
            camera_url(ACTIVE, None), confirmation_payload(editor_client, ACTIVE, query)
        )

        served = editor_client.get(f"/api/v1/mountains/{ACTIVE.mountain.slug}").json()

        assert served["camera"] == {
            "headingDegrees": 359.99,
            "pitchDegrees": -59.99,
            "rangeMeters": 79999.5,
            "framing": {"x": 0.1234, "y": -0.9876},
        }

    def test_the_change_page_anchors_the_camera_and_checks_it(self, editor_client, load_catalog):
        load_catalog(ACTIVE, DRAFT)

        active = editor_client.get(change_url(ACTIVE)).content.decode()
        draft = editor_client.get(change_url(DRAFT)).content.decode()

        assert 'id="camera"' in active
        assert "Complete and within bounds." in active
        assert "No camera yet." in draft

    def test_a_camera_changed_since_the_page_was_opened_is_not_overwritten(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        meanwhile = replace(ACTIVE.mountain.camera, heading_degrees=10.0)
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(camera_heading_degrees=10.0)

        response = editor_client.post(camera_url(ACTIVE, None), payload)

        assert response.status_code == 302
        location = urlsplit(response["Location"])
        assert location.path == camera_url(ACTIVE, None)
        assert {name: float(values[0]) for name, values in parse_qs(location.query).items()} == {
            name: float(value) for name, value in PROPOSED.items()
        }
        assert stored_camera(ACTIVE) == meanwhile
        assert "changed by someone else" in messages_of(response)[0]
        assert not LogEntry.objects.exists()

        again = editor_client.get(response["Location"])
        assert again.status_code == 200
        assert float(form_payload(again)["expected-heading"]) == 10.0

    def test_confirming_twice_writes_and_logs_once(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)
        first = editor_client.post(camera_url(ACTIVE, None), payload)
        updated_at = MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at

        second = editor_client.post(camera_url(ACTIVE, None), payload)

        assert first["Location"] == f"{change_url(ACTIVE)}#camera"
        assert second.status_code == 302
        assert stored_camera(ACTIVE) == PROPOSED_CAMERA
        assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at == updated_at
        assert LogEntry.objects.count() == 1

    def test_a_forged_out_of_bounds_camera_is_refused_and_nothing_is_written(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        response = editor_client.post(camera_url(ACTIVE, None), {**payload, "pitch": "16"})

        assert response.status_code == 400
        assert "the pitch from -60 to 15 degrees" in response.content.decode()
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    @pytest.mark.parametrize(
        "changes",
        [{"fx": ""}, {"range": "nan"}, {"expected-pitch": ""}, {"expected-fx": "x"}],
        ids=["framing-missing", "nan", "expected-incomplete", "expected-unreadable"],
    )
    def test_an_unreadable_submission_is_refused_and_nothing_is_written(
        self, editor_client, load_catalog, changes
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        response = editor_client.post(camera_url(ACTIVE, None), {**payload, **changes})

        assert response.status_code == 400
        assert SAVE_BUTTON not in response.content.decode()
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_a_submission_without_the_csrf_token_is_refused(self, editor, load_catalog):
        load_catalog(ACTIVE)
        client = Client(enforce_csrf_checks=True)
        client.force_login(editor)
        payload = confirmation_payload(client, ACTIVE)
        del payload["csrfmiddlewaretoken"]

        response = client.post(camera_url(ACTIVE, None), payload)

        assert response.status_code == 403
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_a_submission_with_the_csrf_token_passes_the_check(self, editor, load_catalog):
        load_catalog(ACTIVE)
        client = Client(enforce_csrf_checks=True)
        client.force_login(editor)

        response = client.post(camera_url(ACTIVE, None), confirmation_payload(client, ACTIVE))

        assert response.status_code == 302
        assert stored_camera(ACTIVE) == PROPOSED_CAMERA

    def test_other_methods_are_not_allowed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        assert editor_client.put(camera_url(ACTIVE)).status_code == 405


class TestAccess:
    def test_without_the_change_permission_it_is_forbidden(
        self, viewer_client, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        payload = confirmation_payload(editor_client, ACTIVE)

        shown = viewer_client.get(camera_url(ACTIVE))
        saved = viewer_client.post(camera_url(ACTIVE, None), payload)

        assert (shown.status_code, saved.status_code) == (403, 403)
        assert stored_camera(ACTIVE) == ACTIVE.mountain.camera

    def test_a_signed_out_visitor_is_sent_to_the_login_with_the_query_kept(self, load_catalog):
        load_catalog(ACTIVE)

        response = Client().get(camera_url(ACTIVE))

        assert response.status_code == 302
        location = urlsplit(response["Location"])
        assert location.path == reverse("admin:login")
        assert parse_qs(location.query)["next"] == [camera_url(ACTIVE)]

    @pytest.mark.parametrize("object_id", [uuid.UUID(int=1), "not-a-uuid"])
    def test_an_unknown_mountain_is_not_found(self, editor_client, load_catalog, object_id):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[object_id])

        assert editor_client.get(f"{url}?{urlencode(PROPOSED)}").status_code == 404
