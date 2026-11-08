import logging
from urllib.parse import parse_qs, urlsplit

import pytest
from django.conf import settings
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.studio.support import text_of
from tests.support.catalog import catalog_mountain, catalog_seed

LOGGER = "serendipeak.security"

DRAFT = catalog_mountain("ready-draft", status=MountainStatus.DRAFT)
BARE = catalog_mountain("bare-draft", status=MountainStatus.DRAFT, camera=None, primary_image=None)
PUBLISHED = catalog_mountain("aconcagua")
UNLISTED = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(catalog_seed(DRAFT, BARE, PUBLISHED, UNLISTED))


def preview_url(slug):
    return reverse("studio:mountain_preview", args=[slug])


def detail_url(slug):
    return reverse("studio:mountain_detail", args=[slug])


def fragment_of(response):
    location = response.headers["Location"]

    return urlsplit(location), parse_qs(urlsplit(location).fragment)


@pytest.mark.parametrize("client_name", ["editor_client", "viewer_client"])
def test_a_signed_in_user_is_sent_to_the_web_preview_with_a_token_in_the_fragment(
    catalog, request, client_name
):
    client = request.getfixturevalue(client_name)

    response = client.get(preview_url("ready-draft"))

    assert response.status_code == 302
    location, fragment = fragment_of(response)
    assert f"{location.scheme}://{location.netloc}" == settings.WEB_ORIGIN
    assert location.path == "/preview"
    assert location.query == ""
    assert set(fragment) == {"token", "slug"}
    assert fragment["slug"] == ["ready-draft"]


def test_the_token_is_never_in_the_path_or_query_of_the_redirect(catalog, editor_client):
    response = editor_client.get(preview_url("ready-draft"))
    _, fragment = fragment_of(response)
    token = fragment["token"][0]
    before_fragment = response.headers["Location"].split("#")[0]

    assert token not in before_fragment
    assert token not in response.content.decode()


def test_the_token_reads_back_the_draft_through_the_preview_endpoint(catalog, editor_client):
    response = editor_client.get(preview_url("ready-draft"))
    _, fragment = fragment_of(response)

    served = Client().get(
        "/api/v1/previews/mountain", HTTP_AUTHORIZATION=f"Bearer {fragment['token'][0]}"
    )

    assert served.status_code == 200
    assert served.json()["slug"] == "ready-draft"


def test_the_redirect_is_not_cached_or_indexed_and_sends_no_referrer_off_site(
    catalog, editor_client
):
    response = editor_client.get(preview_url("ready-draft"))

    assert "no-store" in response.headers["Cache-Control"]
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert response.headers["Referrer-Policy"] == "same-origin"


def test_a_draft_without_camera_or_photograph_can_be_previewed(catalog, viewer_client):
    response = viewer_client.get(preview_url("bare-draft"))

    assert response.status_code == 302
    assert fragment_of(response)[1]["slug"] == ["bare-draft"]


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_a_public_mountain_has_nothing_to_preview(catalog, editor_client, slug):
    response = editor_client.get(preview_url(slug), follow=True)

    assert response.redirect_chain == [(detail_url(slug), 302)]
    assert "token" not in "".join(url for url, _ in response.redirect_chain)
    assert "already public" in text_of(response)


@pytest.mark.parametrize("slug", ["no-such-peak", "Ready-Draft", "a" * 5000])
def test_an_unknown_mountain_is_a_404_page_without_a_token(catalog, editor_client, slug):
    response = editor_client.get(preview_url(slug))

    assert response.status_code == 404
    assert "Location" not in response.headers


def test_anonymous_callers_are_sent_to_sign_in_and_get_no_token(catalog):
    response = Client().get(preview_url("ready-draft"))

    assert response.status_code == 302
    assert response.headers["Location"].startswith(reverse("studio:login"))
    assert "token" not in response.headers["Location"]


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_only_get_issues_a_token(catalog, editor_client, method):
    response = getattr(editor_client, method)(preview_url("ready-draft"))

    assert response.status_code == 405


def test_issuing_is_logged_without_the_token(catalog, editor, editor_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    response = editor_client.get(preview_url("ready-draft"))
    token = fragment_of(response)[1]["token"][0]

    lines = [record for record in caplog.records if record.name == LOGGER]
    assert [record.getMessage() for record in lines] == ["preview_issued"]
    assert lines[0].fields == {"user_id": str(editor.pk), "role": "editor", "slug": "ready-draft"}
    assert token not in caplog.text


def test_a_refusal_logs_nothing_and_issues_nothing(catalog, editor_client, caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    editor_client.get(preview_url("aconcagua"))
    editor_client.get(preview_url("no-such-peak"))

    assert [record for record in caplog.records if record.name == LOGGER] == []


# What the pages offer.


def test_a_draft_page_offers_a_preview_and_not_view_on_site(catalog, editor_client):
    body = text_of(editor_client.get(detail_url("ready-draft")))

    assert f'href="{preview_url("ready-draft")}"' in body
    assert ">Preview<" in body
    assert "View on site" not in body


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_a_public_page_offers_view_on_site_and_no_preview(catalog, editor_client, slug):
    body = text_of(editor_client.get(detail_url(slug)))

    assert "View on site" in body
    assert preview_url(slug) not in body


def test_a_viewer_is_offered_the_preview_too(catalog, viewer_client):
    body = text_of(viewer_client.get(detail_url("ready-draft")))

    assert f'href="{preview_url("ready-draft")}"' in body


def test_the_edit_page_of_a_draft_offers_a_preview_held_back_while_edits_are_unsaved(
    catalog, editor_client
):
    body = text_of(editor_client.get(reverse("studio:mountain_edit", args=["ready-draft"])))

    assert f'href="{preview_url("ready-draft")}"' in body
    assert "data-saved-only" in body
    assert "data-when-unsaved" in body
    assert "unsaved-changes.js" in body


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_the_edit_page_of_a_public_mountain_offers_no_preview(catalog, editor_client, slug):
    body = text_of(editor_client.get(reverse("studio:mountain_edit", args=[slug])))

    assert preview_url(slug) not in body


def test_the_creation_page_offers_no_preview(db, editor_client):
    body = text_of(editor_client.get(reverse("studio:mountain_new")))

    assert "mountain_preview" not in body
    assert "/preview/" not in body
