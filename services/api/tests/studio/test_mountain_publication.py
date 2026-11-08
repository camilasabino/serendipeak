import json
import logging

import pytest
from django.test import Client
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainRecord
from tests.studio.support import csrf_token_of, text_of
from tests.support.catalog import catalog_mountain, catalog_of, primary_image

LOGGER = "serendipeak.security"

READY = catalog_mountain("ready-draft", status=MountainStatus.DRAFT)
BLOCKED = catalog_mountain("blocked-draft", status=MountainStatus.DRAFT, primary_image=None)
PUBLISHED = catalog_mountain("aconcagua")
UNLISTED = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
UNLISTED_BLOCKED = catalog_mountain(
    "broken-peak", status=MountainStatus.INACTIVE, primary_image=primary_image(media=None)
)


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(catalog_of(READY, BLOCKED, PUBLISHED, UNLISTED, UNLISTED_BLOCKED))


@pytest.fixture
def events(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)

    def read():
        return [
            (record.getMessage(), getattr(record, "fields", {}))
            for record in caplog.records
            if record.name == LOGGER
        ]

    return read


def url(name, slug):
    return reverse(f"studio:{name}", args=[slug])


def status_of(slug):
    return MountainRecord.objects.get(slug=slug).status


def detail(client, slug):
    return text_of(client.get(url("mountain_detail", slug)))


# What the mountain page offers.


def test_a_draft_that_is_ready_offers_publish(catalog, editor_client):
    body = detail(editor_client, "ready-draft")

    assert f'action="{url("mountain_publish", "ready-draft")}"' in body
    assert ">Publish</button>" in body
    assert "disabled" not in body.split(">Publish</button>")[0].rsplit("<button", 1)[1]


def test_a_draft_that_is_not_ready_shows_why_and_cannot_be_published_from_the_page(
    catalog, editor_client
):
    body = detail(editor_client, "blocked-draft")

    assert "Not ready to publish" in body
    assert "The photograph is missing." in body
    assert "disabled" in body.split(">Publish</button>")[0].rsplit("<button", 1)[1]


def test_a_published_mountain_offers_unlist_and_an_unlisted_one_offers_list_again(
    catalog, editor_client
):
    published = detail(editor_client, "aconcagua")
    unlisted = detail(editor_client, "old-peak")

    assert f'href="{url("mountain_unlist", "aconcagua")}"' in published
    assert "Publish</button>" not in published
    assert f'action="{url("mountain_relist", "old-peak")}"' in unlisted
    assert ">List again</button>" in unlisted


def test_a_viewer_sees_no_publication_control(catalog, viewer_client):
    for slug in ("ready-draft", "aconcagua", "old-peak"):
        body = detail(viewer_client, slug)

        assert "mountain_publish" not in body
        assert "/publish/" not in body
        assert "/unlist/" not in body
        assert "/list/" not in body
        assert "/delete/" not in body
        assert ">Edit</a>" not in body


# Publishing.


def test_publishing_a_ready_draft_puts_it_on_the_site_and_logs_the_transition(
    catalog, editor, editor_client, events
):
    response = editor_client.post(url("mountain_publish", "ready-draft"))

    assert response["Location"] == url("mountain_detail", "ready-draft")
    assert status_of("ready-draft") == "active"
    assert "Ready Draft is published." in detail(editor_client, "ready-draft")
    assert events() == [
        (
            "publication_changed",
            {
                "user_id": str(editor.pk),
                "role": "editor",
                "slug": "ready-draft",
                "status": "published",
            },
        )
    ]


def test_publishing_a_draft_that_is_not_ready_is_refused_with_the_reasons_and_not_logged(
    catalog, editor_client, events
):
    response = editor_client.post(url("mountain_publish", "blocked-draft"), follow=True)

    assert status_of("blocked-draft") == "draft"
    assert "Blocked Draft was not changed: The photograph is missing." in text_of(response)
    assert events() == []


def test_publishing_what_is_already_published_changes_nothing(catalog, editor_client, events):
    response = editor_client.post(url("mountain_publish", "aconcagua"), follow=True)

    assert "Aconcagua was not changed: it is already published." in text_of(response)
    assert status_of("aconcagua") == "active"
    assert events() == []


# Unlisting.


def test_the_unlist_page_states_the_consequence_and_writes_nothing(catalog, editor_client, events):
    response = editor_client.get(url("mountain_unlist", "aconcagua"))
    body = text_of(response)

    assert response.status_code == 200
    assert "Unlist Aconcagua?" in body
    assert "no longer chosen as the mountain of the day or at random" in body
    assert "stays reachable at its public address" in body
    assert f'action="{url("mountain_unlist", "aconcagua")}"' in body
    assert status_of("aconcagua") == "active"
    assert events() == []


def test_confirming_unlists_the_mountain_and_logs_it(catalog, editor, editor_client, events):
    response = editor_client.post(url("mountain_unlist", "aconcagua"))

    assert response["Location"] == url("mountain_detail", "aconcagua")
    assert status_of("aconcagua") == "inactive"
    assert events() == [
        (
            "publication_changed",
            {
                "user_id": str(editor.pk),
                "role": "editor",
                "slug": "aconcagua",
                "status": "unlisted",
            },
        )
    ]


def test_the_unlist_page_of_a_mountain_that_is_not_published_goes_back_to_the_mountain(
    catalog, editor_client
):
    response = editor_client.get(url("mountain_unlist", "old-peak"), follow=True)

    assert "Old Peak is unlisted, so there is nothing to change." in text_of(response)


# Listing again.


def test_an_unlisted_mountain_that_still_qualifies_is_listed_again(
    catalog, editor, editor_client, events
):
    editor_client.post(url("mountain_relist", "old-peak"))

    assert status_of("old-peak") == "active"
    assert events() == [
        (
            "publication_changed",
            {
                "user_id": str(editor.pk),
                "role": "editor",
                "slug": "old-peak",
                "status": "published",
            },
        )
    ]


def test_an_unlisted_mountain_that_no_longer_qualifies_is_refused_with_the_reasons(
    catalog, editor_client, events
):
    response = editor_client.post(url("mountain_relist", "broken-peak"), follow=True)

    assert status_of("broken-peak") == "inactive"
    assert "The photograph file is not stored yet." in text_of(response)
    assert events() == []


def test_a_transition_that_cannot_be_asked_by_get_is_refused(catalog, editor_client):
    assert editor_client.get(url("mountain_publish", "ready-draft")).status_code == 405
    assert editor_client.get(url("mountain_relist", "old-peak")).status_code == 405
    assert status_of("ready-draft") == "draft"


# Authorization and CSRF.


@pytest.mark.parametrize("name", ["mountain_publish", "mountain_unlist", "mountain_relist"])
def test_a_viewer_cannot_change_the_status_and_nothing_is_logged(
    catalog, viewer_client, events, name
):
    response = viewer_client.post(url(name, "ready-draft"))

    assert response.status_code == 403
    assert status_of("ready-draft") == "draft"
    assert [event for event, _ in events()] == ["access_denied"]


@pytest.mark.parametrize("name", ["mountain_publish", "mountain_unlist", "mountain_relist"])
def test_an_anonymous_visitor_is_sent_to_sign_in(catalog, name):
    assert Client().post(url(name, "ready-draft")).status_code == 302
    assert status_of("ready-draft") == "draft"


def test_a_transition_needs_a_csrf_token(catalog, editor, events):
    client = Client(enforce_csrf_checks=True)
    client.force_login(editor)
    page = client.get(url("mountain_unlist", "aconcagua"))

    refused = client.post(url("mountain_unlist", "aconcagua"))
    assert refused.status_code == 403
    assert status_of("aconcagua") == "active"

    accepted = client.post(
        url("mountain_unlist", "aconcagua"), {"csrfmiddlewaretoken": csrf_token_of(page)}
    )
    assert accepted.status_code == 302
    assert status_of("aconcagua") == "inactive"


def test_a_mountain_that_does_not_exist_is_a_not_found_page(catalog, editor_client):
    for name in ("mountain_publish", "mountain_unlist", "mountain_relist"):
        assert editor_client.post(url(name, "no-such-peak")).status_code == 404
    assert editor_client.get(url("mountain_unlist", "no-such-peak")).status_code == 404


def test_the_log_line_carries_identifiers_only(catalog, editor_client, events):
    editor_client.post(url("mountain_publish", "ready-draft"))

    [(_, fields)] = events()
    assert set(fields) == {"user_id", "role", "slug", "status"}
    line = json.dumps(fields).lower()
    assert "password" not in line and "session" not in line and "csrf" not in line
