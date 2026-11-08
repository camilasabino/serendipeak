import datetime

import pytest
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)
from tests.studio.support import csrf_token_of, text_of
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_of
from tests.support.geography import countries

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, countries=countries("AR", "CL"))
SHOWN = catalog_mountain("shown-peak", status=MountainStatus.DRAFT)
PUBLISHED = catalog_mountain("aconcagua")
UNLISTED = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
LIST_URL = reverse("studio:mountain_list")


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(
        catalog_of(
            DRAFT,
            SHOWN,
            PUBLISHED,
            UNLISTED,
            discoveries=(catalog_discovery(datetime.date(2026, 1, 1), SHOWN),),
        )
    )


def url(slug):
    return reverse("studio:mountain_delete", args=[slug])


def test_the_page_says_what_goes_with_the_draft_and_deletes_nothing(catalog, editor_client):
    response = editor_client.get(url("draft-peak"))
    body = text_of(response)

    assert response.status_code == 200
    assert "Delete the draft Draft Peak?" in body
    assert "Its photograph record and credit." in body
    assert "Its links to Argentina, Chile; the countries stay." in body
    assert "Photograph files already uploaded stay in storage." in body
    assert f'action="{url("draft-peak")}"' in body
    assert MountainRecord.objects.filter(slug="draft-peak").exists()


def test_confirming_deletes_the_draft_its_photograph_record_and_country_links(
    catalog, editor_client
):
    record = MountainRecord.objects.get(slug="draft-peak")

    response = editor_client.post(url("draft-peak"))

    assert response["Location"] == LIST_URL
    assert not MountainRecord.objects.filter(slug="draft-peak").exists()
    assert not MountainImageRecord.objects.filter(mountain_id=record.pk).exists()
    assert not MountainCountryRecord.objects.filter(mountain_id=record.pk).exists()
    assert "The draft Draft Peak was deleted." in text_of(editor_client.get(LIST_URL))


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_a_published_or_unlisted_mountain_shows_why_it_cannot_be_deleted(
    catalog, editor_client, slug
):
    response = editor_client.get(url(slug))
    body = text_of(response)

    assert response.status_code == 200
    assert "cannot be deleted" in body
    assert "Only a draft can be deleted." in body
    assert "<form" not in body.split("</header>")[1]
    assert 'class="button button--danger"' not in body


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_a_forced_deletion_of_a_published_or_unlisted_mountain_is_refused(
    catalog, editor_client, slug
):
    response = editor_client.post(url(slug), follow=True)

    assert MountainRecord.objects.filter(slug=slug).exists()
    assert "only a draft can be deleted. Nothing was deleted." in text_of(response)


def test_a_draft_that_was_the_mountain_of_a_day_cannot_be_deleted(catalog, editor_client):
    response = editor_client.post(url("shown-peak"), follow=True)

    assert MountainRecord.objects.filter(slug="shown-peak").exists()
    assert DailyDiscoveryRecord.objects.count() == 1
    assert "was shown as the mountain of a day, so it cannot be deleted." in text_of(response)


def test_the_mountain_page_offers_the_deletion_of_a_draft_and_explains_the_others(
    catalog, editor_client
):
    draft = text_of(editor_client.get(reverse("studio:mountain_detail", args=["draft-peak"])))
    published = text_of(editor_client.get(reverse("studio:mountain_detail", args=["aconcagua"])))

    assert f'href="{url("draft-peak")}"' in draft
    assert "Only a draft can be deleted." in published
    assert url("aconcagua") not in published


def test_a_viewer_cannot_delete_and_an_anonymous_visitor_is_sent_to_sign_in(catalog, viewer_client):
    assert viewer_client.get(url("draft-peak")).status_code == 403
    assert viewer_client.post(url("draft-peak")).status_code == 403
    assert Client().post(url("draft-peak")).status_code == 302
    assert MountainRecord.objects.filter(slug="draft-peak").exists()


def test_the_deletion_needs_a_csrf_token(catalog, editor):
    client = Client(enforce_csrf_checks=True)
    client.force_login(editor)
    page = client.get(url("draft-peak"))

    assert client.post(url("draft-peak")).status_code == 403
    assert MountainRecord.objects.filter(slug="draft-peak").exists()

    accepted = client.post(url("draft-peak"), {"csrfmiddlewaretoken": csrf_token_of(page)})
    assert accepted.status_code == 302
    assert not MountainRecord.objects.filter(slug="draft-peak").exists()


def test_a_mountain_that_does_not_exist_is_a_not_found_page(catalog, editor_client):
    assert editor_client.get(url("no-such-peak")).status_code == 404
    assert editor_client.post(url("no-such-peak")).status_code == 404
