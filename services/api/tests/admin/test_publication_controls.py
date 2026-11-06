import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.messages import get_messages
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.models import MountainRecord
from tests.admin.support import form_payload
from tests.support.catalog import catalog_mountain, primary_image

COMPLETE_DRAFT = catalog_mountain("complete-draft", status=MountainStatus.DRAFT)
INCOMPLETE_DRAFT = catalog_mountain(
    "incomplete-draft",
    status=MountainStatus.DRAFT,
    camera=None,
    primary_image=primary_image(media=None),
)
UNSOURCED_DRAFT = catalog_mountain(
    "unsourced-draft",
    status=MountainStatus.DRAFT,
    osm=None,
    wikidata_id=None,
    wikipedia_url=None,
)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def transition_url(entry, kind):
    return reverse("admin:catalog_mountainrecord_transition", args=[entry.mountain.id, kind])


def status_of(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id).status


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


class TestControls:
    @pytest.mark.parametrize(
        ("entry", "kind", "label"),
        [
            (COMPLETE_DRAFT, "publish", "Publish"),
            (ACTIVE, "deactivate", "Deactivate"),
            (INACTIVE, "reactivate", "Reactivate"),
        ],
    )
    def test_only_the_valid_transition_is_offered(
        self, publisher_client, load_catalog, entry, kind, label
    ):
        load_catalog(entry)

        html = publisher_client.get(change_url(entry)).content.decode()

        assert f'action="{transition_url(entry, kind)}"' in html
        for other in {"publish", "deactivate", "reactivate"} - {kind}:
            assert transition_url(entry, other) not in html
        assert f">{label}</button>" in html

    def test_no_control_is_offered_without_the_publish_permission(
        self, editor_client, load_catalog
    ):
        load_catalog(COMPLETE_DRAFT)

        html = editor_client.get(change_url(COMPLETE_DRAFT)).content.decode()

        assert "/transition/" not in html

    def test_the_control_is_outside_the_change_form(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        html = publisher_client.get(change_url(COMPLETE_DRAFT)).content.decode()

        control = html.index("/transition/publish/")
        form_start = html.index('id="mountainrecord_form"')
        form_end = html.index("</form>", form_start)
        assert not form_start < control < form_end


class TestTransitionEndpoint:
    def test_post_publishes_through_the_use_case_and_returns_to_the_change_page(
        self, publisher_client, publisher, load_catalog
    ):
        load_catalog(COMPLETE_DRAFT)

        response = publisher_client.post(transition_url(COMPLETE_DRAFT, "publish"), follow=True)

        assert response.redirect_chain[-1][0] == change_url(COMPLETE_DRAFT)
        assert status_of(COMPLETE_DRAFT) == "active"
        assert messages_of(response) == ["1 mountain(s) published."]
        entry = LogEntry.objects.get(object_id=str(COMPLETE_DRAFT.mountain.id))
        assert entry.user == publisher
        assert entry.get_change_message() == "Status published."

    def test_post_deactivates_and_reactivates(self, publisher_client, load_catalog):
        load_catalog(ACTIVE, INACTIVE)

        publisher_client.post(transition_url(ACTIVE, "deactivate"))
        publisher_client.post(transition_url(INACTIVE, "reactivate"))

        assert status_of(ACTIVE) == "inactive"
        assert status_of(INACTIVE) == "active"

    def test_a_rejected_publication_reports_the_reasons_and_changes_nothing(
        self, publisher_client, load_catalog
    ):
        load_catalog(INCOMPLETE_DRAFT)

        response = publisher_client.post(transition_url(INCOMPLETE_DRAFT, "publish"), follow=True)

        assert status_of(INCOMPLETE_DRAFT) == "draft"
        messages = messages_of(response)
        assert any("was not published" in m and "the camera is missing" in m for m in messages)
        assert any("saved mountain" in m and "unsaved" in m for m in messages)
        assert not LogEntry.objects.exists()

    def test_a_transition_from_the_wrong_status_is_reported(self, publisher_client, load_catalog):
        load_catalog(ACTIVE)

        response = publisher_client.post(transition_url(ACTIVE, "publish"), follow=True)

        assert status_of(ACTIVE) == "active"
        assert any("it is active" in m for m in messages_of(response))

    def test_get_does_not_mutate(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        response = publisher_client.get(transition_url(COMPLETE_DRAFT, "publish"))

        assert response.status_code == 405
        assert status_of(COMPLETE_DRAFT) == "draft"

    def test_without_the_publish_permission_nothing_changes(self, editor_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        response = editor_client.post(transition_url(COMPLETE_DRAFT, "publish"))

        assert response.status_code == 403
        assert status_of(COMPLETE_DRAFT) == "draft"

    def test_post_requires_the_csrf_token(self, publisher, load_catalog):
        from django.test import Client

        load_catalog(COMPLETE_DRAFT)
        client = Client(enforce_csrf_checks=True)
        client.force_login(publisher)

        response = client.post(transition_url(COMPLETE_DRAFT, "publish"))

        assert response.status_code == 403
        assert status_of(COMPLETE_DRAFT) == "draft"

    def test_an_unknown_kind_or_mountain_is_not_found(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)
        missing = reverse(
            "admin:catalog_mountainrecord_transition",
            args=["00000000-0000-0000-0000-000000000000", "publish"],
        )

        assert publisher_client.post(missing).status_code == 404
        assert (
            publisher_client.post(change_url(COMPLETE_DRAFT) + "transition/delete/").status_code
            == 404
        )

    def test_a_plain_save_never_changes_the_status(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)
        page = publisher_client.get(change_url(COMPLETE_DRAFT))

        publisher_client.post(change_url(COMPLETE_DRAFT), form_payload(page))

        assert status_of(COMPLETE_DRAFT) == "draft"


class TestPublicationSection:
    def test_a_complete_draft_is_ready_to_publish(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        html = publisher_client.get(change_url(COMPLETE_DRAFT)).content.decode()

        assert "Ready to publish" in html

    def test_a_draft_without_source_references_is_ready_and_publishes(
        self, publisher_client, load_catalog
    ):
        load_catalog(UNSOURCED_DRAFT)

        html = publisher_client.get(change_url(UNSOURCED_DRAFT)).content.decode()
        assert "Ready to publish" in html

        response = publisher_client.post(transition_url(UNSOURCED_DRAFT, "publish"), follow=True)

        assert messages_of(response) == ["1 mountain(s) published."]
        assert status_of(UNSOURCED_DRAFT) == "active"
        served = publisher_client.get("/api/v1/mountains/unsourced-draft").json()
        assert "sources" not in served

    def test_an_incomplete_draft_lists_the_stored_violations(self, publisher_client, load_catalog):
        load_catalog(INCOMPLETE_DRAFT)

        html = publisher_client.get(change_url(INCOMPLETE_DRAFT)).content.decode()

        assert "Ready to publish" not in html
        assert "The camera is missing" in html
        assert "The photograph file is not stored yet" in html

    def test_the_section_shows_status_and_timestamps_first(self, publisher_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        page = publisher_client.get(change_url(COMPLETE_DRAFT))

        first = list(page.context["adminform"])[0]
        assert first.name == "Publication"
        assert list(first.fields) == [
            "status",
            "created_at",
            "updated_at",
            "publication_readiness",
        ]

    def test_a_published_mountain_has_no_readiness_verdict(self, publisher_client, load_catalog):
        load_catalog(ACTIVE)

        html = publisher_client.get(change_url(ACTIVE)).content.decode()

        assert "Ready to publish" not in html
