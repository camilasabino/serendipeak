import pytest
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.studio.support import form_payload, jpeg, text_of, upload
from tests.support.catalog import catalog_mountain, catalog_of, primary_image

pytestmark = pytest.mark.usefixtures("media_store")

STORED = primary_image()
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
BARE_DRAFT = catalog_mountain("bare-peak", status=MountainStatus.DRAFT, primary_image=None)
PUBLISHED = catalog_mountain("aconcagua")


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(catalog_of(DRAFT, BARE_DRAFT, PUBLISHED))


def edit_url(slug):
    return reverse("studio:mountain_edit", args=[slug])


def save(client, current_slug, /, **overrides):
    page = client.get(edit_url(current_slug))

    return client.post(edit_url(current_slug), form_payload(page, **overrides))


def image_of(slug):
    return MountainImageRecord.objects.get(mountain__slug=slug)


def test_the_card_shows_the_saved_photograph_and_its_credit(catalog, editor_client):
    body = text_of(editor_client.get(edit_url("draft-peak")))

    assert "Saved photograph of Draft Peak" in body
    assert f'name="photograph-author" value="{STORED.author}"' in body
    assert 'name="photograph-license_name" value="CC BY-SA 4.0"' in body
    assert 'name="photograph-file"' in body
    assert 'accept="image/jpeg,image/png,image/webp"' in body


def test_a_draft_without_a_photograph_says_so_and_publication_will_need_one(catalog, editor_client):
    body = text_of(editor_client.get(edit_url("bare-peak")))

    assert "No photograph yet. A draft may have none; publishing needs one." in body
    assert "credit_reviewed" not in body
    assert 'name="photograph-remove"' not in body


def test_a_photograph_is_added_to_a_draft_that_has_none(catalog, editor_client, media_store):
    response = save(
        editor_client,
        "bare-peak",
        **{"photograph-file": upload(), "photograph-author": "A. Photographer"},
    )

    assert response.status_code == 302
    image = image_of("bare-peak")
    assert image.author == "A. Photographer"
    assert image.page_key in media_store.public


def test_replacing_with_the_credit_unchanged_asks_to_confirm_it_still_applies(
    catalog, editor_client, media_store
):
    before = image_of("draft-peak").page_key

    response = save(editor_client, "draft-peak", **{"photograph-file": upload(jpeg((320, 200)))})
    body = text_of(response)

    assert response.status_code == 200
    assert "The author and license are those of the photograph being replaced." in body
    assert image_of("draft-peak").page_key == before
    assert media_store.originals == {}


def test_confirming_the_credit_replaces_the_photograph_and_keeps_the_credit(
    catalog, editor_client, media_store
):
    before = image_of("draft-peak").page_key

    response = save(
        editor_client,
        "draft-peak",
        **{"photograph-file": upload(jpeg((320, 200))), "photograph-credit_reviewed": "on"},
    )

    assert response.status_code == 302
    image = image_of("draft-peak")
    assert image.page_key != before
    assert image.page_key in media_store.public
    assert (image.author, image.license_name) == (STORED.author, STORED.license_name)
    assert (image.width, image.height) == (320, 200)


def test_replacing_with_a_new_credit_needs_no_confirmation_and_replaces_all_of_it(
    catalog, editor_client
):
    response = save(
        editor_client,
        "draft-peak",
        **{
            "photograph-file": upload(jpeg((320, 200))),
            "photograph-author": "Someone Else",
            "photograph-license_name": "",
            "photograph-license_url": "",
            "photograph-source_page_url": "",
        },
    )

    assert response.status_code == 302
    image = image_of("draft-peak")
    assert image.author == "Someone Else"
    assert (image.license_name, image.license_url, image.source_page_url) == (None, None, None)


def test_changing_only_the_credit_keeps_the_stored_file(catalog, editor_client, media_store):
    before = image_of("aconcagua")

    response = save(editor_client, "aconcagua", **{"photograph-author": "Corrected Author"})

    assert response.status_code == 302
    image = image_of("aconcagua")
    assert image.author == "Corrected Author"
    assert (image.page_key, image.original_sha256) == (before.page_key, before.original_sha256)
    assert media_store.originals == {}


def test_a_credit_error_keeps_the_card_and_saves_nothing(catalog, editor_client):
    response = save(
        editor_client,
        "draft-peak",
        name="Renamed",
        **{"photograph-license_name": "", "photograph-license_url": "https://example.org/license"},
    )
    body = text_of(response)

    assert response.status_code == 200
    assert "License: Add the license name of this license URL." in body
    assert 'value="https://example.org/license"' in body
    assert MountainRecord.objects.get(slug="draft-peak").name_en == "Draft Peak"


def test_a_credit_link_that_is_not_https_is_refused(catalog, editor_client):
    response = save(editor_client, "draft-peak", **{"photograph-source_page_url": "http://e.org"})

    assert response.status_code == 200
    assert "Photo page URL: Use an https:// link." in text_of(response)


def test_the_author_cannot_be_cleared(catalog, editor_client):
    response = save(editor_client, "draft-peak", **{"photograph-author": ""})

    assert response.status_code == 200
    assert "Author: Enter the author of the photograph." in text_of(response)
    assert image_of("draft-peak").author == STORED.author


def test_a_file_that_is_not_a_photograph_is_a_field_error_and_keeps_the_stored_one(
    catalog, editor_client, media_store
):
    before = image_of("draft-peak").page_key

    response = save(
        editor_client,
        "draft-peak",
        name="Renamed",
        **{
            "photograph-file": upload(b"not an image"),
            "photograph-credit_reviewed": "on",
        },
    )

    assert response.status_code == 200
    assert "Photograph: The file is not an image." in text_of(response)
    assert image_of("draft-peak").page_key == before
    assert MountainRecord.objects.get(slug="draft-peak").name_en == "Draft Peak"
    assert media_store.originals == {}


def test_a_media_store_failure_keeps_everything_typed_and_the_stored_photograph(
    catalog, editor_client, media_store
):
    media_store.failing = True
    before = image_of("draft-peak").page_key

    response = save(
        editor_client,
        "draft-peak",
        name="Renamed",
        **{"photograph-file": upload(), "photograph-credit_reviewed": "on"},
    )
    body = text_of(response)

    assert response.status_code == 200
    assert "The photograph could not be stored. Nothing was saved; try again." in body
    assert 'value="Renamed"' in body
    assert image_of("draft-peak").page_key == before
    assert MountainRecord.objects.get(slug="draft-peak").name_en == "Draft Peak"


# Removal.


def test_a_draft_offers_to_remove_its_photograph_and_a_published_mountain_does_not(
    catalog, editor_client
):
    assert 'name="photograph-remove"' in text_of(editor_client.get(edit_url("draft-peak")))
    assert 'name="photograph-remove"' not in text_of(editor_client.get(edit_url("aconcagua")))


def test_removing_a_drafts_photograph_deletes_the_record_and_leaves_the_files(
    catalog, editor_client, media_store
):
    response = save(editor_client, "draft-peak", **{"photograph-remove": "on"})

    assert response.status_code == 302
    assert not MountainImageRecord.objects.filter(mountain__slug="draft-peak").exists()
    assert MountainRecord.objects.filter(slug="draft-peak").exists()
    assert media_store.calls == []


def test_a_draft_without_its_photograph_is_not_ready_to_publish(catalog, editor_client):
    save(editor_client, "draft-peak", **{"photograph-remove": "on"})

    body = text_of(editor_client.get(reverse("studio:mountain_detail", args=["draft-peak"])))

    assert "The photograph is missing." in body
    assert "Not ready to publish" in body


def test_a_forged_removal_on_a_published_mountain_changes_nothing(catalog, editor_client):
    page = editor_client.get(edit_url("aconcagua"))
    payload = form_payload(page)
    payload["photograph-remove"] = "on"

    response = editor_client.post(edit_url("aconcagua"), payload)

    assert response.status_code == 302
    assert MountainImageRecord.objects.filter(mountain__slug="aconcagua").exists()


def test_removing_and_choosing_a_file_at_once_is_refused(catalog, editor_client):
    response = save(
        editor_client,
        "draft-peak",
        **{"photograph-remove": "on", "photograph-file": upload()},
    )

    assert response.status_code == 200
    assert "Remove the photograph or choose a new file, not both." in text_of(response)
    assert MountainImageRecord.objects.filter(mountain__slug="draft-peak").exists()
