import pytest
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)
from tests.studio.support import csrf_token_of, form_payload, text_of, upload
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.regions import region_path

pytestmark = pytest.mark.usefixtures("media_store")

NEW_URL = reverse("studio:mountain_new")
LIST_URL = reverse("studio:mountain_list")

MOUNTAIN = {
    "name": "New Peak",
    "slug": "new-peak",
    "latitude": "46.5",
    "longitude": "8.5",
    "elevation_meters": "3500",
    "continent": "EU",
    "osm_node_id": "1504741757",
    "wikidata_id": "Q39739",
}
PHOTOGRAPH = {"photograph-author": "A. Photographer"}


def detail_url(slug):
    return reverse("studio:mountain_detail", args=[slug])


def create(client, *, photograph=True, **overrides):
    page = client.get(NEW_URL)
    assert page.status_code == 200
    extra = {"photograph-file": upload(), **PHOTOGRAPH} if photograph else {}

    return client.post(NEW_URL, form_payload(page, **{**MOUNTAIN, **extra, **overrides}))


def stored(slug="new-peak"):
    return MountainRecord.objects.get(slug=slug)


def test_the_page_is_an_empty_form_with_the_reference_choices(editor_client):
    response = editor_client.get(NEW_URL)
    body = text_of(response)

    assert response.status_code == 200
    assert "<title>New mountain · SerendiPeak Studio</title>" in body
    assert body.count("<h1") == 1
    assert 'enctype="multipart/form-data"' in body
    assert '<option value="" selected>Select a continent</option>' in body
    assert '<option value="EU">Europe</option>' in body
    assert body.count('name="countries"') == 249
    assert "Create draft" in body


def test_a_viewer_is_refused_and_an_anonymous_visitor_is_sent_to_sign_in(viewer_client):
    assert viewer_client.get(NEW_URL).status_code == 403
    assert viewer_client.post(NEW_URL, {}).status_code == 403
    assert Client().get(NEW_URL).status_code == 302
    assert not MountainRecord.objects.exists()


def test_creating_a_mountain_stores_a_draft_with_its_photograph(editor_client, media_store):
    response = create(
        editor_client,
        countries=["CH", "IT"],
        summary="A fine peak.",
        **{"photograph-license_name": "CC BY 4.0", "photograph-source_page_url": "https://e.org/p"},
    )

    assert response.status_code == 302
    assert response["Location"] == detail_url("new-peak")
    record = stored()
    assert record.status == MountainStatus.DRAFT.value
    assert (record.name_en, record.summary_en, record.continent_id) == (
        "New Peak",
        "A fine peak.",
        "EU",
    )
    assert sorted(MountainCountryRecord.objects.values_list("country_id", flat=True)) == [
        "CH",
        "IT",
    ]
    image = MountainImageRecord.objects.get(mountain=record)
    assert (image.author, image.license_name) == ("A. Photographer", "CC BY 4.0")
    assert image.page_key in media_store.public
    assert image.original_key in media_store.originals


def test_the_created_mountain_is_shown_with_a_confirmation(editor_client):
    response = create(editor_client)
    page = editor_client.get(response["Location"])

    assert "New Peak was created as a draft." in text_of(page)


def test_a_draft_can_be_created_without_a_photograph(editor_client, media_store):
    response = create(editor_client, photograph=False)

    assert response.status_code == 302
    assert not MountainImageRecord.objects.exists()
    assert media_store.originals == {}
    page = editor_client.get(response["Location"])
    assert "Add a photograph to publish it." in text_of(page)


def test_the_region_is_chosen_from_the_whole_taxonomy(editor_client, db):
    DjangoCatalogStore().load(
        catalog_of(catalog_mountain("other-peak", region=region_path("Alps", "Pennine Alps")))
    )
    page = editor_client.get(NEW_URL)
    assert "Alps › Pennine Alps" in text_of(page)
    region_id = stored("other-peak").region_id

    create(editor_client, photograph=False, region=str(region_id))

    assert stored().region_id == region_id


def test_every_error_is_shown_at_once_and_what_was_typed_is_kept(editor_client):
    response = create(
        editor_client,
        slug="Not A Slug",
        elevation_meters="0",
        countries=["CH"],
        photograph=False,
        **{"photograph-author": "Someone"},
    )
    body = text_of(response)

    assert response.status_code == 200
    assert not MountainRecord.objects.exists()
    assert 'class="error-summary"' in body
    for expected in (
        "Slug: Use lowercase letters",
        "Elevation (m): Enter a whole number of meters above zero.",
        "Photograph: Choose a photograph.",
    ):
        assert expected in body
    assert 'value="Not A Slug"' in body
    assert 'value="New Peak"' in body
    assert 'value="CH" id="id_countries_' in body
    assert '<option value="EU" selected>Europe</option>' in body
    assert 'value="Someone"' in body


def test_a_taken_slug_is_a_field_error_and_the_typed_values_stay(editor_client, db):
    DjangoCatalogStore().load(catalog_of(catalog_mountain("new-peak")))

    response = create(editor_client, name="Another Peak")
    body = text_of(response)

    assert response.status_code == 200
    assert "Slug: Another mountain already uses this slug." in body
    assert 'value="Another Peak"' in body
    assert MountainRecord.objects.count() == 1


def test_a_reference_that_vanished_is_a_field_error_not_a_server_error(editor_client):
    response = create(
        editor_client, photograph=False, region="00000000-0000-0000-0000-000000000000"
    )

    assert response.status_code == 200
    assert "Region" in text_of(response)
    assert not MountainRecord.objects.exists()


def test_a_file_that_is_not_a_photograph_is_a_field_error_and_writes_nothing(
    editor_client, media_store
):
    response = create(
        editor_client,
        **{"photograph-file": upload(b"this is not an image", name="notes.jpg")},
    )

    assert response.status_code == 200
    assert "Photograph: The file is not an image." in text_of(response)
    assert not MountainRecord.objects.exists()
    assert media_store.originals == {}


def test_a_file_over_the_limit_is_refused_before_it_is_read(editor_client):
    response = create(editor_client, **{"photograph-file": upload(b"x" * (31 * 1024 * 1024))})

    assert response.status_code == 200
    assert "Photograph: The file is larger than 30 MiB." in text_of(response)
    assert not MountainRecord.objects.exists()


def test_a_media_store_failure_saves_nothing_and_keeps_what_was_typed(editor_client, media_store):
    media_store.failing = True

    response = create(editor_client, summary="A fine peak.")
    body = text_of(response)

    assert response.status_code == 200
    assert "The photograph could not be stored. Nothing was saved; try again." in body
    assert 'value="New Peak"' in body
    assert "A fine peak." in body
    assert not MountainRecord.objects.exists()

    media_store.failing = False
    assert create(editor_client).status_code == 302
    assert MountainRecord.objects.count() == 1


def test_the_creation_needs_a_csrf_token(editor):
    client = Client(enforce_csrf_checks=True)
    client.force_login(editor)
    page = client.get(NEW_URL)
    payload = form_payload(page, **MOUNTAIN)
    payload.pop("csrfmiddlewaretoken")

    refused = client.post(NEW_URL, payload)
    accepted = client.post(NEW_URL, {**payload, "csrfmiddlewaretoken": csrf_token_of(page)})

    assert refused.status_code == 403
    assert accepted.status_code == 302
    assert MountainRecord.objects.count() == 1


def test_the_list_offers_the_creation_to_an_editor_and_not_to_a_viewer(
    editor_client, viewer_client
):
    assert f'href="{NEW_URL}"' in text_of(editor_client.get(LIST_URL))
    assert NEW_URL not in text_of(viewer_client.get(LIST_URL))


def test_a_mountain_called_new_keeps_its_own_address(editor_client, db):
    DjangoCatalogStore().load(catalog_of(catalog_mountain("new")))

    assert editor_client.get(detail_url("new")).status_code == 200
    assert reverse("studio:mountain_new") == "/studio/new-mountain/"
