from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import pytest
from django.conf import settings
from django.contrib.auth.models import Permission, User
from django.test import Client, RequestFactory
from django.urls import reverse

from config.admin import build_admin_site
from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, MountainStatus
from serendipeak.persistence.models import MountainRecord
from tests.admin.support import form_payload
from tests.support.catalog import catalog_mountain

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, camera=None)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
EDITOR_PATH = "/editorial/camera"
LABEL = "Edit camera visually"


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def editor_links(html):
    """Every anchor that points at the visual editor, as (href, rel)."""

    class Anchors(HTMLParser):
        found = []

        def handle_starttag(self, tag, attrs):
            attributes = dict(attrs)
            if tag == "a" and attributes.get("href", "").startswith(settings.WEB_ORIGIN):
                self.found.append((attributes["href"], attributes.get("rel")))

    parser = Anchors()
    parser.found = []
    parser.feed(html)

    return parser.found


def query_of(href):
    return {key: values[0] for key, values in parse_qs(urlsplit(href).query).items()}


@pytest.fixture
def viewer_client(db):
    viewer = User.objects.create_user("viewer", password="not-used", is_staff=True)
    viewer.user_permissions.set(Permission.objects.filter(codename="view_mountainrecord"))
    client = Client()
    client.force_login(viewer)

    return client


class TestLink:
    @pytest.mark.parametrize(
        "entry", [DRAFT, ACTIVE, INACTIVE], ids=["draft", "active", "inactive"]
    )
    def test_the_change_page_offers_the_editor_in_the_tools_and_in_the_camera_fieldset(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)

        response = editor_client.get(change_url(entry))

        links = editor_links(response.content.decode())
        assert len(links) == 2
        assert {href for href, _rel in links} == {links[0][0]}
        assert {rel for _href, rel in links} == {"noreferrer"}
        assert response.content.decode().count(LABEL) == 2
        assert links[0][0].startswith(f"{settings.WEB_ORIGIN}{EDITOR_PATH}?")

    def test_it_carries_the_mountain_and_its_stored_camera_exactly(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        mountain = ACTIVE.mountain
        camera = mountain.camera

        href = editor_links(editor_client.get(change_url(ACTIVE)).content.decode())[0][0]

        query = query_of(href)
        assert query["mountain"] == str(mountain.id)
        assert query["slug"] == mountain.slug
        assert query["name"] == mountain.name
        assert float(query["lat"]) == mountain.coordinates.latitude
        assert float(query["lon"]) == mountain.coordinates.longitude
        assert int(query["elevation"]) == mountain.elevation_meters
        assert float(query["heading"]) == camera.heading_degrees
        assert float(query["pitch"]) == camera.pitch_degrees
        assert float(query["range"]) == camera.range_meters
        assert float(query["fx"]) == camera.framing.x
        assert float(query["fy"]) == camera.framing.y

    def test_a_mountain_without_a_camera_sends_none(self, editor_client, load_catalog):
        load_catalog(DRAFT)

        href = editor_links(editor_client.get(change_url(DRAFT)).content.decode())[0][0]

        assert set(query_of(href)) == {"mountain", "slug", "name", "lat", "lon", "elevation"}

    def test_floats_keep_every_digit_the_stored_camera_has(self, editor_client, load_catalog):
        awkward = catalog_mountain(
            "awkward-peak",
            camera=CanonicalCamera(
                heading_degrees=359.99999999999994,
                pitch_degrees=-19.850000000000001,
                range_meters=17132.123456789,
                framing=CameraFraming(x=1e-05, y=-0.30000000000000004),
            ),
        )
        load_catalog(awkward)

        href = editor_links(editor_client.get(change_url(awkward)).content.decode())[0][0]

        query = query_of(href)
        assert query["heading"] == "359.99999999999994"
        assert query["fx"] == "1e-05"
        assert query["fy"] == "-0.30000000000000004"

    def test_a_draft_camera_without_framing_is_not_sent_so_it_can_still_be_completed(
        self, editor_client, load_catalog
    ):
        entry = catalog_mountain(
            "odd-peak",
            status=MountainStatus.DRAFT,
            camera=CanonicalCamera(
                heading_degrees=10, pitch_degrees=-10, range_meters=5000, framing=None
            ),
        )
        load_catalog(entry)

        href = editor_links(editor_client.get(change_url(entry)).content.decode())[0][0]

        assert "heading" not in query_of(href)

    def test_names_that_need_escaping_travel_intact(self, editor_client, load_catalog):
        entry = catalog_mountain(
            "odd-name",
            name="Mont Blanc & Co. #1 ñandú=?",
            status=MountainStatus.DRAFT,
            camera=None,
        )
        load_catalog(entry)

        response = editor_client.get(change_url(entry))

        href = editor_links(response.content.decode())[0][0]
        assert query_of(href)["name"] == "Mont Blanc & Co. #1 ñandú=?"
        assert "<script" not in href

    def test_the_link_is_on_the_origin_the_setting_names_and_nowhere_else(
        self, editor_client, load_catalog, settings
    ):
        settings.CORS_ALLOWED_ORIGIN = "https://other.example"
        load_catalog(ACTIVE)

        href = editor_links(editor_client.get(change_url(ACTIVE)).content.decode())[0][0]

        assert href.startswith(f"{settings.WEB_ORIGIN}{EDITOR_PATH}?")
        assert "other.example" not in href

    def test_a_view_only_user_reads_the_page_without_any_way_to_edit_the_camera(
        self, viewer_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = viewer_client.get(change_url(ACTIVE))

        html = response.content.decode()
        assert response.status_code == 200
        assert ACTIVE.mountain.name in html
        assert editor_links(html) == []
        assert LABEL not in html
        assert 'name="_save"' not in html

    def test_a_view_only_user_sees_the_saved_photograph_and_its_credit_without_any_control(
        self, viewer_client, load_catalog
    ):
        load_catalog(ACTIVE)
        image = ACTIVE.mountain.primary_image

        response = viewer_client.get(change_url(ACTIVE))

        html = response.content.decode()
        assert response.status_code == 200
        assert 'alt="Saved photograph"' in html
        assert f"{settings.MEDIA_PUBLIC_BASE_URL}/{image.media.page_key}" in html
        assert image.author in html
        assert image.license_name in html
        assert image.source_page_url in html
        assert "4994 × 2758 pixels" in html
        assert 'type="file"' not in html
        assert "image-0-DELETE" not in html
        assert "Add another" not in html.replace("Add another Photograph&quot;", "")
        assert "credit_reviewed" not in html
        assert "data-photograph-file" not in html
        assert editor_links(html) == []
        assert 'name="_save"' not in html

    def test_a_view_only_user_cannot_post_a_change(self, viewer_client, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.values().get(pk=ACTIVE.mountain.id)

        response = viewer_client.post(change_url(ACTIVE), {"name": "Hijacked", "_save": "Save"})

        assert response.status_code == 403
        assert MountainRecord.objects.values().get(pk=ACTIVE.mountain.id) == before

    def test_a_view_only_user_cannot_reach_the_camera_confirmation(
        self, viewer_client, load_catalog
    ):
        load_catalog(ACTIVE)
        camera_url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])
        before = MountainRecord.objects.values().get(pk=ACTIVE.mountain.id)

        got = viewer_client.get(camera_url, {"heading": 10, "pitch": -20, "range": 5000})
        posted = viewer_client.post(camera_url, {"heading": 10, "pitch": -20, "range": 5000})

        assert (got.status_code, posted.status_code) == (403, 403)
        assert MountainRecord.objects.values().get(pk=ACTIVE.mountain.id) == before

    def test_a_staff_user_with_no_permissions_is_refused(self, db, load_catalog):
        load_catalog(ACTIVE)
        nobody = User.objects.create_user("nobody", password="not-used", is_staff=True)
        client = Client()
        client.force_login(nobody)

        response = client.get(change_url(ACTIVE))

        assert response.status_code == 403
        assert settings.WEB_ORIGIN not in response.content.decode()

    def test_it_is_offered_to_a_user_who_can_change_the_mountain(self, editor, load_catalog):
        load_catalog(ACTIVE)
        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        mountain_admin = build_admin_site()._registry[MountainRecord]
        request = RequestFactory().get(change_url(ACTIVE))
        request.user = editor

        tool = mountain_admin._camera_editor_tool(request, record)

        assert tool["camera_editor_label"] == LABEL
        assert tool["camera_editor_url"].startswith(settings.WEB_ORIGIN)

    def test_it_is_absent_when_adding_a_mountain(self, editor_client):
        response = editor_client.get(reverse("admin:catalog_mountainrecord_add"))

        assert response.status_code == 200
        assert LABEL not in response.content.decode()


PROPOSAL = "heading=10&pitch=-10&range=5000&fx=0.5&fy=-0.5"


class TestReturn:
    def test_the_confirmation_offers_the_way_back_to_the_editor(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])

        response = editor_client.get(f"{url}?heading=10&pitch=-10&range=5000&fx=0&fy=0")

        links = editor_links(response.content.decode())
        assert len(links) == 1
        assert query_of(links[0][0])["slug"] == ACTIVE.mountain.slug

    def test_an_unreadable_proposal_still_leads_back_to_the_editor(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])

        response = editor_client.get(f"{url}?heading=north")

        assert response.status_code == 400
        assert len(editor_links(response.content.decode())) == 1

    def test_the_confirmation_sends_the_proposal_back_marked_as_one(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])

        response = editor_client.get(f"{url}?{PROPOSAL}")

        query = query_of(editor_links(response.content.decode())[0][0])
        assert (query["heading"], query["pitch"], query["range"]) == ("10.0", "-10.0", "5000.0")
        assert (query["fx"], query["fy"], query["proposal"]) == ("0.5", "-0.5", "1")
        # Going back does not decide anything: saving compares with the camera stored at that
        # moment, so a change made by someone else in the meantime is still detected.
        stored = ACTIVE.mountain.camera
        assert float(form_payload(response)["expected-heading"]) == stored.heading_degrees

    def test_a_proposal_that_equals_the_stored_camera_is_not_marked_as_one(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])
        stored = ACTIVE.mountain.camera
        same = (
            f"heading={stored.heading_degrees!r}&pitch={stored.pitch_degrees!r}"
            f"&range={stored.range_meters!r}&fx={stored.framing.x!r}&fy={stored.framing.y!r}"
        )

        response = editor_client.get(f"{url}?{same}")

        query = query_of(editor_links(response.content.decode())[0][0])
        assert "proposal" not in query
        assert float(query["heading"]) == stored.heading_degrees

    def test_a_proposal_out_of_bounds_leads_back_with_the_stored_camera(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])

        response = editor_client.get(f"{url}?heading=10&pitch=16&range=5000&fx=0&fy=0")

        assert response.status_code == 400
        query = query_of(editor_links(response.content.decode())[0][0])
        assert "proposal" not in query
        assert float(query["pitch"]) == ACTIVE.mountain.camera.pitch_degrees

    def test_a_stale_save_returns_with_the_new_current_camera_and_still_offers_the_proposal(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])
        payload = form_payload(editor_client.get(f"{url}?{PROPOSAL}"))
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(camera_heading_degrees=200.0)

        again = editor_client.post(url, payload, follow=True)

        html = again.content.decode()
        assert "changed by someone else" in html
        assert float(form_payload(again)["expected-heading"]) == 200.0
        query = query_of(editor_links(html)[0][0])
        assert (query["heading"], query["proposal"]) == ("10.0", "1")

    def test_after_saving_the_editor_reopens_on_the_camera_that_was_saved(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        url = reverse("admin:catalog_mountainrecord_camera", args=[ACTIVE.mountain.id])
        confirmation = editor_client.get(
            f"{url}?heading=123.45&pitch=-12.5&range=4321&fx=0.125&fy=-0.25"
        )
        saved = editor_client.post(url, form_payload(confirmation), follow=True)

        href = editor_links(saved.content.decode())[0][0]
        query = query_of(href)
        assert (query["heading"], query["pitch"], query["range"]) == ("123.45", "-12.5", "4321.0")
        assert (query["fx"], query["fy"]) == ("0.125", "-0.25")
