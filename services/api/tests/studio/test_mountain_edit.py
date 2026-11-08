import pytest
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import ActiveMountainLocationLocked, UnknownMountain
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainCountryRecord, MountainRecord
from tests.studio.support import csrf_token_of, form_payload, text_of
from tests.support.catalog import catalog_mountain, catalog_of, primary_image
from tests.support.geography import countries
from tests.support.regions import region_path

pytestmark = pytest.mark.usefixtures("media_store")

LIST_URL = reverse("studio:mountain_list")

DRAFT = catalog_mountain(
    "draft-peak",
    status=MountainStatus.DRAFT,
    countries=countries("AR"),
    region=region_path("Andes", "Southern Andes"),
)
PUBLISHED = catalog_mountain("aconcagua", countries=countries("AR", "CL"))
UNLISTED = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(catalog_of(DRAFT, PUBLISHED, UNLISTED))


def edit_url(slug):
    return reverse("studio:mountain_edit", args=[slug])


def detail_url(slug):
    return reverse("studio:mountain_detail", args=[slug])


def save(client, current_slug, /, **overrides):
    page = client.get(edit_url(current_slug))
    assert page.status_code == 200

    return client.post(edit_url(current_slug), form_payload(page, **overrides))


def stored(slug):
    return MountainRecord.objects.get(slug=slug)


def test_the_page_starts_from_the_stored_mountain(catalog, editor_client):
    body = text_of(editor_client.get(edit_url("draft-peak")))

    assert "<title>Edit Draft Peak · SerendiPeak Studio</title>" in body
    assert 'name="name" value="Draft Peak"' in body
    assert 'name="slug" value="draft-peak"' in body
    assert 'name="elevation_meters" value="6961"' in body
    assert '<option value="SA" selected>South America</option>' in body
    assert "Southern Andes</option>" in body
    assert 'value="AR" id="id_countries_9" checked' in body
    assert "Save changes" in body


def test_a_viewer_cannot_edit_and_a_missing_mountain_is_a_not_found_page(
    catalog, viewer_client, editor_client
):
    assert viewer_client.get(edit_url("draft-peak")).status_code == 403
    assert viewer_client.post(edit_url("draft-peak"), {}).status_code == 403
    assert Client().get(edit_url("draft-peak")).status_code == 302
    assert editor_client.get(edit_url("no-such-peak")).status_code == 404
    assert editor_client.post(edit_url("no-such-peak"), {}).status_code == 404


def test_saving_changes_the_content_and_returns_to_the_mountain(catalog, editor_client):
    response = save(
        editor_client,
        "draft-peak",
        name="Cerro Draft",
        elevation_meters="7000",
        countries=["AR", "CL"],
        region="",
        summary="A changed summary.",
        wikidata_id="Q1",
        osm_node_id="42",
    )

    assert response.status_code == 302
    assert response["Location"] == detail_url("draft-peak")
    record = stored("draft-peak")
    assert (record.name_en, record.elevation_meters, record.summary_en) == (
        "Cerro Draft",
        7000,
        "A changed summary.",
    )
    assert (record.wikidata_id, record.osm_node_id, record.region_id) == ("Q1", 42, None)
    assert sorted(
        MountainCountryRecord.objects.filter(mountain=record).values_list("country_id", flat=True)
    ) == ["AR", "CL"]
    assert "Cerro Draft was saved." in text_of(editor_client.get(response["Location"]))


def test_saving_without_changes_writes_nothing(catalog, editor_client):
    before = stored("draft-peak").updated_at

    response = save(editor_client, "draft-peak")

    assert response.status_code == 302
    assert stored("draft-peak").updated_at == before


def test_a_new_slug_moves_the_mountain_to_its_new_address(catalog, editor_client):
    response = save(editor_client, "draft-peak", slug="renamed-peak")

    assert response["Location"] == detail_url("renamed-peak")
    assert editor_client.get(detail_url("renamed-peak")).status_code == 200
    assert editor_client.get(detail_url("draft-peak")).status_code == 404


def test_a_mountain_on_the_site_warns_that_its_slug_is_its_public_address(catalog, editor_client):
    for slug in ("aconcagua", "old-peak"):
        assert "Changing the slug changes its public address" in text_of(
            editor_client.get(edit_url(slug))
        )
    assert "Changing the slug changes" not in text_of(editor_client.get(edit_url("draft-peak")))


def test_the_public_slug_policy_is_unchanged_a_published_slug_can_still_be_edited(
    catalog, editor_client
):
    response = save(editor_client, "aconcagua", slug="aconcagua-peak")

    assert response["Location"] == detail_url("aconcagua-peak")
    assert stored("aconcagua-peak").status == MountainStatus.ACTIVE.value


def test_every_error_is_shown_and_the_stored_mountain_is_untouched(catalog, editor_client):
    response = save(editor_client, "draft-peak", name="", elevation_meters="-5", wikidata_id="nope")
    body = text_of(response)

    assert response.status_code == 200
    assert "Name: Enter the name." in body
    assert "Elevation (m): Enter a whole number of meters above zero." in body
    assert "Wikidata id: Use the Wikidata item id" in body
    assert stored("draft-peak").name_en == "Draft Peak"
    assert 'value="nope"' in body
    assert 'value="-5"' in body


def test_a_slug_another_mountain_uses_is_refused_and_the_rest_is_kept(catalog, editor_client):
    response = save(editor_client, "draft-peak", slug="aconcagua", name="Renamed")
    body = text_of(response)

    assert response.status_code == 200
    assert "Slug: Another mountain already uses this slug." in body
    assert 'value="Renamed"' in body
    assert stored("draft-peak").name_en == "Draft Peak"


# Coordinates.


def test_a_draft_moves_only_with_the_camera_reset_confirmed(catalog, editor_client):
    refused = save(editor_client, "draft-peak", latitude="10.5", name="Renamed")
    body = text_of(refused)

    assert refused.status_code == 200
    assert "Clear the camera if the coordinates change: Changing the coordinates clears" in body
    assert 'value="Renamed"' in body
    assert stored("draft-peak").name_en == "Draft Peak"

    moved = save(
        editor_client, "draft-peak", latitude="10.5", confirm_camera_reset="on", name="Renamed"
    )

    assert moved.status_code == 302
    record = stored("draft-peak")
    assert (record.name_en, record.location.y) == ("Renamed", 10.5)
    assert record.camera_heading_degrees is None
    page = text_of(editor_client.get(moved["Location"]))
    assert "the camera was cleared" in page


def test_a_move_that_changes_nothing_keeps_the_camera(catalog, editor_client):
    save(editor_client, "draft-peak", confirm_camera_reset="on")

    assert stored("draft-peak").camera_heading_degrees is not None


def test_a_published_mountain_shows_its_coordinates_locked_and_ignores_forged_ones(
    catalog, editor_client
):
    page = text_of(editor_client.get(edit_url("aconcagua")))
    assert page.count(" disabled ") >= 2
    assert "A published mountain&#x27;s coordinates cannot change" in page

    response = save(editor_client, "aconcagua", latitude="10", longitude="20", name="Aconcagua 2")

    assert response.status_code == 302
    record = stored("aconcagua")
    assert record.name_en == "Aconcagua 2"
    assert (record.location.y, record.location.x) == (-32.6531487, -70.0119607)


def test_an_unlisted_mountain_can_be_moved_with_the_confirmation(catalog, editor_client):
    response = save(
        editor_client, "old-peak", latitude="1.5", longitude="2.5", confirm_camera_reset="on"
    )

    assert response.status_code == 302
    assert (stored("old-peak").location.y, stored("old-peak").location.x) == (1.5, 2.5)


# Mountains that are on the site.


def test_a_mountain_on_the_site_must_stay_publishable(db, editor_client):
    DjangoCatalogStore().load(
        catalog_of(catalog_mountain("seeded-peak", primary_image=primary_image(media=None)))
    )

    response = save(editor_client, "seeded-peak", name="Renamed")
    body = text_of(response)

    assert response.status_code == 200
    assert "The mountain is on the site, so a save has to leave it meeting the publication" in body
    assert "The photograph file is not stored yet." in body
    assert 'value="Renamed"' in body
    assert stored("seeded-peak").name_en == "Seeded Peak"


# Races, shown as the page's own messages.


class Refusing:
    def __init__(self, error):
        self._error = error

    def execute(self, *args, **kwargs):
        raise self._error


def patch_writes(monkeypatch, **replacements):
    from dataclasses import replace

    from django.urls import resolve

    for name in ("studio:mountain_new", "studio:mountain_edit"):
        kwargs = {} if name.endswith("new") else {"slug": "any"}
        initkwargs = resolve(reverse(name, kwargs=kwargs)).func.view_initkwargs
        monkeypatch.setitem(initkwargs, "writes", replace(initkwargs["writes"], **replacements))


def test_a_mountain_deleted_while_the_form_was_open_sends_the_editor_to_the_list(
    catalog, editor_client, monkeypatch
):
    patch_writes(monkeypatch, update_mountain=Refusing(UnknownMountain(DRAFT.mountain.id)))

    response = save(editor_client, "draft-peak")

    assert response["Location"] == LIST_URL
    assert "Draft Peak no longer exists, so nothing was changed." in text_of(
        editor_client.get(LIST_URL)
    )


def test_a_move_refused_after_the_content_was_saved_says_what_was_and_was_not_saved(
    catalog, editor_client, monkeypatch
):
    patch_writes(monkeypatch, change_location=Refusing(ActiveMountainLocationLocked()))

    response = save(
        editor_client, "draft-peak", name="Renamed", latitude="10.5", confirm_camera_reset="on"
    )

    assert response["Location"] == edit_url("draft-peak")
    assert stored("draft-peak").name_en == "Renamed"
    assert stored("draft-peak").location.y == -32.6531487
    page = text_of(editor_client.get(response["Location"]))
    assert "Your other changes were saved, but the coordinates were not." in page


def test_an_unexpected_failure_is_not_hidden_as_a_form_error(catalog, editor, monkeypatch):
    patch_writes(monkeypatch, update_mountain=Refusing(RuntimeError("boom")))
    client = Client(raise_request_exception=False)
    client.force_login(editor)

    page = client.get(edit_url("draft-peak"))
    response = client.post(edit_url("draft-peak"), form_payload(page))

    assert response.status_code == 500


def test_the_edit_needs_a_csrf_token(catalog, editor):
    client = Client(enforce_csrf_checks=True)
    client.force_login(editor)
    page = client.get(edit_url("draft-peak"))
    payload = form_payload(page, name="Renamed")
    payload.pop("csrfmiddlewaretoken")

    assert client.post(edit_url("draft-peak"), payload).status_code == 403
    assert stored("draft-peak").name_en == "Draft Peak"

    payload["csrfmiddlewaretoken"] = csrf_token_of(page)
    assert client.post(edit_url("draft-peak"), payload).status_code == 302
    assert stored("draft-peak").name_en == "Renamed"
