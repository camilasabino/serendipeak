import re
from html import unescape
from urllib.parse import parse_qs, urlsplit

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.messages import get_messages
from django.urls import resolve, reverse
from django.utils.http import urlencode

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.admin import ACTIVE_LOCATION_LOCKED, CAMERA_RESET_REQUIRED
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.admin.support import form_payload, input_names, jpeg, upload
from tests.support.catalog import catalog_mountain

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
CAMERALESS_DRAFT = catalog_mountain("new-peak", status=MountainStatus.DRAFT, camera=None)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
STORED_LATITUDE = "-32.6531487"
STORED_LONGITUDE = "-70.0119607"
CAMERA_COLUMNS = (
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
)
NEW_CAMERA = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)
MOVES = {
    "latitude-only": {"latitude": "-33.25"},
    "longitude-only": {"longitude": "-70.75"},
    "both": {"latitude": "-33.25", "longitude": "-70.75"},
}
CONFIRM = {"confirm_camera_reset": "on"}


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def stored(entry):
    return MountainRecord.objects.filter(pk=entry.mountain.id).values().get()


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


def errors_of(response):
    form = response.context["adminform"].form

    return {name: list(messages) for name, messages in form.errors.items()}


def submit(client, entry, **fields):
    page = client.get(change_url(entry))

    return client.post(change_url(entry), form_payload(page, **fields))


def coordinates_of(row):
    return (row["location"].y, row["location"].x)


class TestAConfirmedMove:
    @pytest.mark.parametrize("move", MOVES.values(), ids=MOVES.keys())
    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE], ids=["draft", "inactive"])
    def test_it_saves_the_location_and_clears_the_whole_camera_together(
        self, editor_client, load_catalog, entry, move
    ):
        load_catalog(entry)
        before = stored(entry)
        expected = (
            float(move.get("latitude", STORED_LATITUDE)),
            float(move.get("longitude", STORED_LONGITUDE)),
        )

        response = submit(editor_client, entry, **move, **CONFIRM)

        assert response.status_code == 302
        after = stored(entry)
        assert coordinates_of(after) == expected
        assert after["location"].srid == 4326
        assert [after[name] for name in CAMERA_COLUMNS] == [None] * 5
        assert after["status"] == entry.mountain.status.value
        assert {name for name in before if before[name] != after[name]} == {
            "location",
            *CAMERA_COLUMNS,
            "updated_at",
        }

    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE, CAMERALESS_DRAFT])
    def test_it_says_that_the_camera_must_be_configured_again_and_where(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)

        response = submit(editor_client, entry, **MOVES["both"], **CONFIRM)

        [moved, saved] = messages_of(response)
        assert saved.endswith("was changed successfully.")
        assert "the camera was cleared" in moved
        assert "The camera must be configured again" in moved
        assert "Edit camera visually" in moved
        followed = editor_client.get(response["Location"])
        assert "The camera must be configured again" in followed.content.decode()

    def test_it_is_logged(self, editor_client, load_catalog):
        load_catalog(DRAFT)

        submit(editor_client, DRAFT, **MOVES["latitude-only"], **CONFIRM)

        assert sorted(entry.get_change_message() for entry in LogEntry.objects.all()) == [
            "Camera cleared by a change of coordinates.",
            "Changed latitude.",
        ]

    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE], ids=["draft", "inactive"])
    def test_the_camera_editor_stays_reachable_on_the_new_location_without_a_camera(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)
        submit(editor_client, entry, **MOVES["both"], **CONFIRM)

        page = editor_client.get(change_url(entry))

        links = [
            href
            for href in re.findall(r'href="([^"]+)"', page.content.decode())
            if "/editorial/camera?" in href
        ]
        assert len(links) >= 2
        for href in links:
            query = {k: v[0] for k, v in parse_qs(urlsplit(unescape(href)).query).items()}
            assert (query["lat"], query["lon"]) == ("-33.25", "-70.75")
            assert not {"heading", "pitch", "range", "fx", "fy", "proposal"} & set(query)

    def test_an_inactive_mountain_without_a_camera_can_still_be_edited(
        self, editor_client, load_catalog
    ):
        load_catalog(INACTIVE)
        submit(editor_client, INACTIVE, **MOVES["both"], **CONFIRM)

        response = submit(editor_client, INACTIVE, name_en="Renamed")

        assert response.status_code == 302
        assert stored(INACTIVE)["name_en"] == "Renamed"

    def test_the_confirmation_is_not_remembered_for_the_next_save(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        submit(editor_client, DRAFT, **MOVES["latitude-only"], **CONFIRM)
        page = editor_client.get(change_url(DRAFT))

        assert "confirm_camera_reset" not in form_payload(page)

        response = editor_client.post(change_url(DRAFT), form_payload(page, longitude="-71.0"))

        assert response.status_code == 200
        assert errors_of(response) == {"confirm_camera_reset": [CAMERA_RESET_REQUIRED]}


class TestWithoutConfirmation:
    @pytest.mark.parametrize("move", MOVES.values(), ids=MOVES.keys())
    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE], ids=["draft", "inactive"])
    def test_nothing_is_saved_and_the_confirmation_is_asked_for(
        self, editor_client, load_catalog, entry, move
    ):
        load_catalog(entry)
        before = stored(entry)

        response = submit(editor_client, entry, name_en="Renamed", **move)

        assert response.status_code == 200
        assert errors_of(response) == {"confirm_camera_reset": [CAMERA_RESET_REQUIRED]}
        assert stored(entry) == before
        assert not LogEntry.objects.exists()

    def test_the_form_keeps_what_was_typed_so_that_it_can_be_confirmed(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        page = editor_client.get(change_url(DRAFT))
        refused = editor_client.post(
            change_url(DRAFT), form_payload(page, **MOVES["both"], name_en="Renamed")
        )

        values = form_payload(refused)
        assert (values["latitude"], values["longitude"]) == ("-33.25", "-70.75")
        assert "confirm_camera_reset" not in values

        confirmed = editor_client.post(change_url(DRAFT), {**values, **CONFIRM})

        assert confirmed.status_code == 302
        assert stored(DRAFT)["name_en"] == "Renamed"
        assert coordinates_of(stored(DRAFT)) == (-33.25, -70.75)

    def test_cancelling_by_restoring_the_coordinates_keeps_the_camera(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        before = stored(DRAFT)
        page = editor_client.get(change_url(DRAFT))
        editor_client.post(change_url(DRAFT), form_payload(page, **MOVES["both"]))

        response = submit(editor_client, DRAFT, summary_en="Edited.")

        assert response.status_code == 302
        after = stored(DRAFT)
        assert after["location"].ewkb == before["location"].ewkb
        assert [after[name] for name in CAMERA_COLUMNS] == [before[name] for name in CAMERA_COLUMNS]

    def test_the_editor_link_of_the_refused_page_carries_the_saved_coordinates(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)

        response = submit(editor_client, DRAFT, **MOVES["both"])

        url = response.context["camera_editor_url"]
        query = parse_qs(urlsplit(url).query)
        assert (query["lat"], query["lon"]) == ([STORED_LATITUDE], [STORED_LONGITUDE])


class TestAnActiveMountain:
    @pytest.mark.parametrize("confirmed", [{}, CONFIRM], ids=["unconfirmed", "confirmed"])
    @pytest.mark.parametrize(
        ("move", "fields"),
        [
            (MOVES["latitude-only"], {"latitude"}),
            (MOVES["longitude-only"], {"longitude"}),
            (MOVES["both"], {"latitude", "longitude"}),
        ],
        ids=MOVES.keys(),
    )
    def test_its_coordinates_cannot_change_and_nothing_is_saved(
        self, editor_client, load_catalog, move, fields, confirmed
    ):
        load_catalog(ACTIVE)
        before = stored(ACTIVE)

        response = submit(editor_client, ACTIVE, name_en="Renamed", **move, **confirmed)

        assert response.status_code == 200
        assert errors_of(response) == {field: [ACTIVE_LOCATION_LOCKED] for field in fields}
        assert "Deactivate the mountain first" in response.content.decode()
        assert stored(ACTIVE) == before
        assert not LogEntry.objects.exists()

    def test_the_publication_status_is_never_touched_on_the_way(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        submit(editor_client, ACTIVE, **MOVES["both"], **CONFIRM)

        assert stored(ACTIVE)["status"] == "active"

    def test_it_can_still_be_edited_when_its_coordinates_stay(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        before = stored(ACTIVE)

        response = submit(editor_client, ACTIVE, name_en="Renamed")

        assert response.status_code == 302
        after = stored(ACTIVE)
        assert after["name_en"] == "Renamed"
        assert [after[name] for name in CAMERA_COLUMNS] == [before[name] for name in CAMERA_COLUMNS]

    def test_deactivating_it_first_allows_the_move_and_the_camera_must_be_redone(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        editor_client.post(
            reverse(
                "admin:catalog_mountainrecord_transition", args=[ACTIVE.mountain.id, "deactivate"]
            )
        )

        response = submit(editor_client, ACTIVE, **MOVES["both"], **CONFIRM)

        assert response.status_code == 302
        after = stored(ACTIVE)
        assert (after["status"], coordinates_of(after)) == ("inactive", (-33.25, -70.75))
        assert after["camera_heading_degrees"] is None


class TestUnrelatedEdits:
    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE, ACTIVE, CAMERALESS_DRAFT])
    @pytest.mark.parametrize("confirmed", [{}, CONFIRM], ids=["unconfirmed", "confirmed"])
    def test_they_keep_the_location_the_camera_and_say_nothing_about_a_move(
        self, editor_client, load_catalog, entry, confirmed
    ):
        load_catalog(entry)
        before = stored(entry)

        response = submit(
            editor_client, entry, name_en="Renamed", elevation_meters="6000", **confirmed
        )

        assert response.status_code == 302
        after = stored(entry)
        assert after["location"].ewkb == before["location"].ewkb
        assert [after[name] for name in CAMERA_COLUMNS] == [before[name] for name in CAMERA_COLUMNS]
        assert not any("camera was cleared" in message for message in messages_of(response))

    def test_the_same_coordinates_retyped_equal_are_not_a_move(self, editor_client, load_catalog):
        load_catalog(DRAFT)
        before = stored(DRAFT)

        response = submit(
            editor_client,
            DRAFT,
            latitude=str(DRAFT.mountain.coordinates.latitude),
            longitude=str(DRAFT.mountain.coordinates.longitude),
        )

        assert response.status_code == 302
        assert [stored(DRAFT)[name] for name in CAMERA_COLUMNS] == [
            before[name] for name in CAMERA_COLUMNS
        ]


class TestPublicationAfterAMove:
    def test_a_moved_draft_cannot_be_published_until_the_camera_is_configured_again(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        submit(editor_client, DRAFT, **MOVES["both"], **CONFIRM)
        publish = reverse(
            "admin:catalog_mountainrecord_transition", args=[DRAFT.mountain.id, "publish"]
        )

        refused = editor_client.post(publish, follow=True)

        assert "the camera is missing" in " ".join(messages_of(refused))
        assert stored(DRAFT)["status"] == "draft"

    def test_a_moved_inactive_mountain_cannot_be_reactivated_without_a_camera(
        self, editor_client, load_catalog
    ):
        load_catalog(INACTIVE)
        submit(editor_client, INACTIVE, **MOVES["both"], **CONFIRM)
        reactivate = reverse(
            "admin:catalog_mountainrecord_transition", args=[INACTIVE.mountain.id, "reactivate"]
        )

        refused = editor_client.post(reactivate, follow=True)

        assert "the camera is missing" in " ".join(messages_of(refused))
        assert stored(INACTIVE)["status"] == "inactive"

    def test_it_is_reactivated_once_a_camera_is_configured_on_the_new_location(
        self, editor_client, load_catalog
    ):
        load_catalog(INACTIVE)
        submit(editor_client, INACTIVE, **MOVES["both"], **CONFIRM)
        camera_url = reverse("admin:catalog_mountainrecord_camera", args=[INACTIVE.mountain.id])
        query = {
            "heading": "123.45",
            "pitch": "-12.5",
            "range": "4321",
            "fx": "0.125",
            "fy": "-0.25",
            "lat": "-33.25",
            "lon": "-70.75",
        }
        confirmation = editor_client.get(f"{camera_url}?{urlencode(query)}")
        assert confirmation.status_code == 200
        editor_client.post(camera_url, form_payload(confirmation))
        reactivate = reverse(
            "admin:catalog_mountainrecord_transition", args=[INACTIVE.mountain.id, "reactivate"]
        )

        editor_client.post(reactivate)

        record = MountainRecord.objects.get(pk=INACTIVE.mountain.id)
        assert record.status == "active"
        assert to_camera(record) == NEW_CAMERA


class TestTheForm:
    def test_the_add_form_has_no_confirmation(self, editor_client):
        html = editor_client.get(reverse("admin:catalog_mountainrecord_add"))

        assert "confirm_camera_reset" not in input_names(html)

    def test_the_change_form_offers_it_next_to_the_coordinates(self, editor_client, load_catalog):
        load_catalog(DRAFT)

        page = editor_client.get(change_url(DRAFT))

        assert "confirm_camera_reset" in input_names(page)

    def test_a_viewer_sees_no_confirmation(self, viewer_client, load_catalog):
        load_catalog(DRAFT)

        page = viewer_client.get(change_url(DRAFT))

        assert page.status_code == 200
        assert "confirm_camera_reset" not in page.content.decode()

    def test_a_forged_confirmation_cannot_move_an_active_mountain(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        before = stored(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            {**form_payload(page, **MOVES["both"]), "confirm_camera_reset": "true"},
        )

        assert response.status_code == 200
        assert stored(ACTIVE) == before


class TestAtomicity:
    def test_a_photograph_that_cannot_be_stored_rolls_back_the_move_and_the_camera(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(INACTIVE)
        before = stored(INACTIVE)
        media_store.failing = True

        response = submit(
            editor_client,
            INACTIVE,
            **MOVES["both"],
            name_en="Renamed",
            **CONFIRM,
            **{"image-0-photograph_file": upload(jpeg()), "image-0-credit_reviewed": "on"},
        )

        assert response.status_code == 302
        assert stored(INACTIVE) == before
        assert not LogEntry.objects.exists()

    def test_a_failure_of_the_move_rolls_back_the_fields_written_before_it(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(DRAFT)
        before = stored(DRAFT)
        model_admin = resolve(reverse("admin:catalog_mountainrecord_add")).func.model_admin

        class Failing:
            def execute(self, *args, **kwargs):
                raise InfrastructureError("the move failed")

        monkeypatch.setattr(model_admin, "change_mountain_location", Failing())
        editor_client.raise_request_exception = False

        response = submit(editor_client, DRAFT, **MOVES["both"], name_en="Renamed", **CONFIRM)

        assert response.status_code == 500
        assert stored(DRAFT) == before

    def test_a_failure_of_the_move_rolls_back_a_credit_written_before_it(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(DRAFT)
        before = stored(DRAFT)
        image_before = MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).values().get()
        model_admin = resolve(reverse("admin:catalog_mountainrecord_add")).func.model_admin

        class Failing:
            def execute(self, *args, **kwargs):
                raise InfrastructureError("the move failed")

        monkeypatch.setattr(model_admin, "change_mountain_location", Failing())
        editor_client.raise_request_exception = False

        response = submit(
            editor_client,
            DRAFT,
            **MOVES["both"],
            **CONFIRM,
            **{"image-0-author": "Someone Else"},
        )

        assert response.status_code == 500
        assert stored(DRAFT) == before
        assert (
            MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).values().get() == image_before
        )
