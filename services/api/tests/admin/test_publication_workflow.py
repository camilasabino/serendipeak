import datetime

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.messages import get_messages
from django.urls import reverse

from config.composition import build_check_catalog, build_verify_catalog
from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.admin.support import form_payload
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    committed_seed,
    frozen_catalog,
    primary_image,
)
from tests.support.records import attach_committed_media

CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")

COMPLETE_DRAFT = catalog_mountain("complete-draft", status=MountainStatus.DRAFT)
OTHER_DRAFT = catalog_mountain("other-draft", status=MountainStatus.DRAFT)
INCOMPLETE_DRAFT = catalog_mountain(
    "incomplete-draft",
    status=MountainStatus.DRAFT,
    camera=None,
    primary_image=primary_image(media=None),
)
BAD_SUMMARY_DRAFT = catalog_mountain(
    "bad-summary-draft", status=MountainStatus.DRAFT, summary="not a sentence"
)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
DAY = datetime.date(2026, 10, 3)


def run_action(client, action, *entries):
    return client.post(
        CHANGELIST_URL,
        {
            "action": action,
            "_selected_action": [str(entry.mountain.id) for entry in entries],
        },
        follow=True,
    )


def status_of(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id).status


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


def public_status(client, entry):
    return client.get(f"/api/v1/mountains/{entry.mountain.slug}").status_code


class TestPublishing:
    def test_publishing_a_complete_draft_makes_it_active_and_visible(
        self, editor_client, load_catalog
    ):
        load_catalog(COMPLETE_DRAFT)
        assert public_status(editor_client, COMPLETE_DRAFT) == 404

        response = run_action(editor_client, "publish_selected", COMPLETE_DRAFT)

        assert status_of(COMPLETE_DRAFT) == "active"
        assert messages_of(response) == ["1 mountain(s) published."]
        assert public_status(editor_client, COMPLETE_DRAFT) == 200

    def test_the_transition_is_recorded_in_the_history(self, editor_client, editor, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        run_action(editor_client, "publish_selected", COMPLETE_DRAFT)

        entry = LogEntry.objects.get()
        assert (entry.user, entry.object_repr) == (editor, "complete-draft")
        assert "published" in entry.get_change_message()

    def test_an_incomplete_draft_is_rejected_with_the_reasons_and_stays_hidden(
        self, editor_client, load_catalog
    ):
        load_catalog(INCOMPLETE_DRAFT)

        response = run_action(editor_client, "publish_selected", INCOMPLETE_DRAFT)

        assert status_of(INCOMPLETE_DRAFT) == "draft"
        [message] = messages_of(response)
        assert message.startswith("incomplete-draft was not published:")
        assert "the camera is missing" in message
        assert "the photograph file is not stored yet" in message
        assert public_status(editor_client, INCOMPLETE_DRAFT) == 404
        assert not LogEntry.objects.exists()

    def test_a_draft_whose_summary_breaks_the_rules_is_rejected(self, editor_client, load_catalog):
        load_catalog(BAD_SUMMARY_DRAFT)

        response = run_action(editor_client, "publish_selected", BAD_SUMMARY_DRAFT)

        assert status_of(BAD_SUMMARY_DRAFT) == "draft"
        assert "the summary breaks the summary rules" in messages_of(response)[0]

    def test_a_mixed_selection_publishes_what_can_be_published(self, editor_client, load_catalog):
        load_catalog(COMPLETE_DRAFT, INCOMPLETE_DRAFT, OTHER_DRAFT)

        response = run_action(
            editor_client, "publish_selected", COMPLETE_DRAFT, INCOMPLETE_DRAFT, OTHER_DRAFT
        )

        assert [status_of(e) for e in (COMPLETE_DRAFT, INCOMPLETE_DRAFT, OTHER_DRAFT)] == [
            "active",
            "draft",
            "active",
        ]
        assert len(messages_of(response)) == 2

    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    def test_only_drafts_are_published(self, editor_client, load_catalog, entry):
        load_catalog(entry)

        response = run_action(editor_client, "publish_selected", entry)

        assert status_of(entry) == entry.mountain.status.value
        assert f"it is {entry.mountain.status.value}" in messages_of(response)[0]

    def test_the_change_form_cannot_publish(self, editor_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)
        url = reverse("admin:catalog_mountainrecord_change", args=[COMPLETE_DRAFT.mountain.id])
        page = editor_client.get(url)

        editor_client.post(url, form_payload(page) | {"status": "active"})

        assert status_of(COMPLETE_DRAFT) == "draft"


class TestPermission:
    def test_a_viewer_is_not_offered_the_actions(self, viewer_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        response = viewer_client.get(CHANGELIST_URL)

        assert response.status_code == 200
        assert response.context["action_form"] is None

    @pytest.mark.parametrize(
        "action", ["publish_selected", "deactivate_selected", "reactivate_selected"]
    )
    def test_a_viewer_posting_an_action_changes_nothing(self, viewer_client, load_catalog, action):
        load_catalog(COMPLETE_DRAFT, ACTIVE, INACTIVE)

        run_action(viewer_client, action, COMPLETE_DRAFT, ACTIVE, INACTIVE)

        assert [status_of(e) for e in (COMPLETE_DRAFT, ACTIVE, INACTIVE)] == [
            "draft",
            "active",
            "inactive",
        ]
        assert not LogEntry.objects.exists()


class TestDeactivationAndReactivation:
    def test_a_deactivated_mountain_stays_addressable_but_leaves_random_and_keeps_history(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE, discoveries=[catalog_discovery(DAY, ACTIVE)])

        run_action(editor_client, "deactivate_selected", ACTIVE)

        assert status_of(ACTIVE) == "inactive"
        assert public_status(editor_client, ACTIVE) == 200
        assert editor_client.get("/api/v1/mountains/random").status_code == 503
        assert DailyDiscoveryRecord.objects.get(date=DAY).mountain_id == ACTIVE.mountain.id

    def test_reactivating_returns_the_mountain_to_random(self, editor_client, load_catalog):
        load_catalog(INACTIVE)
        assert editor_client.get("/api/v1/mountains/random").status_code == 503

        run_action(editor_client, "reactivate_selected", INACTIVE)

        assert status_of(INACTIVE) == "active"
        random = editor_client.get("/api/v1/mountains/random")
        assert random.json()["slug"] == "old-peak"

    def test_reactivation_is_held_to_the_publication_rules(self, editor_client, load_catalog):
        archived = catalog_mountain(
            "archived-peak", status=MountainStatus.INACTIVE, primary_image=None
        )
        load_catalog(archived)

        response = run_action(editor_client, "reactivate_selected", archived)

        assert status_of(archived) == "inactive"
        assert "the photograph is missing" in messages_of(response)[0]

    @pytest.mark.parametrize("entry", [COMPLETE_DRAFT, INACTIVE])
    def test_only_active_mountains_are_deactivated(self, editor_client, load_catalog, entry):
        load_catalog(entry)

        run_action(editor_client, "deactivate_selected", entry)

        assert status_of(entry) == entry.mountain.status.value

    def test_no_action_returns_a_mountain_to_draft(self, editor_client, load_catalog):
        load_catalog(ACTIVE, INACTIVE)
        offered = dict(
            editor_client.get(CHANGELIST_URL).context["action_form"].fields["action"].choices
        )

        assert set(offered) == {
            "",
            "publish_selected",
            "deactivate_selected",
            "reactivate_selected",
        }


class TestPublicVisibility:
    def test_drafts_never_leak_through_slug_random_or_daily(self, editor_client, load_catalog):
        load_catalog(COMPLETE_DRAFT, INCOMPLETE_DRAFT)

        assert public_status(editor_client, COMPLETE_DRAFT) == 404
        assert public_status(editor_client, INCOMPLETE_DRAFT) == 404
        assert editor_client.get("/api/v1/mountains/random").status_code == 503
        assert editor_client.get("/api/v1/mountains/today").status_code == 503
        assert not DailyDiscoveryRecord.objects.exists()

    def test_publishing_does_not_create_or_change_daily_history(self, editor_client, load_catalog):
        load_catalog(ACTIVE, COMPLETE_DRAFT, discoveries=[catalog_discovery(DAY, ACTIVE)])

        run_action(editor_client, "publish_selected", COMPLETE_DRAFT)

        assert list(DailyDiscoveryRecord.objects.values_list("date", "mountain_id")) == [
            (DAY, ACTIVE.mountain.id)
        ]

    def test_a_published_mountain_becomes_eligible_for_random(self, editor_client, load_catalog):
        load_catalog(COMPLETE_DRAFT)

        run_action(editor_client, "publish_selected", COMPLETE_DRAFT)

        random = editor_client.get("/api/v1/mountains/random")
        assert random.status_code == 200
        assert random.json()["slug"] == "complete-draft"


class TestCommittedCatalogParity:
    @pytest.fixture
    def seeded(self, db):
        from serendipeak.persistence.catalog_store import DjangoCatalogStore

        DjangoCatalogStore().load(committed_seed())
        attach_committed_media()

    def test_editorial_edits_leave_the_73_mountains_equal_to_the_frozen_catalog(
        self, editor_client, seeded
    ):
        for record in MountainRecord.objects.order_by("slug"):
            url = reverse("admin:catalog_mountainrecord_change", args=[record.id])
            page = editor_client.get(url)
            payload = form_payload(
                page,
                summary="Edited through the admin.",
                range_name="Edited range",
                countries="Edited country",
                **{"image-0-author": "Edited credit"},
            )

            assert editor_client.post(url, payload).status_code == 302

        report = build_verify_catalog().execute(committed_seed(), frozen_catalog())
        assert report.mountains == 73
        assert report.frozen.matched == report.frozen.total == 73
        assert report.frozen.mismatches == ()
        assert build_check_catalog().execute().violations == ()

    def test_deactivating_and_reactivating_the_committed_catalog_restores_it(
        self, editor_client, seeded
    ):
        everyone = list(MountainRecord.objects.filter(status="active"))
        ids = [str(record.id) for record in everyone]

        for action in ("deactivate_selected", "reactivate_selected"):
            editor_client.post(
                CHANGELIST_URL, {"action": action, "_selected_action": ids}, follow=True
            )

        assert MountainRecord.objects.filter(status="active").count() == len(everyone)
        report = build_verify_catalog().execute(committed_seed(), frozen_catalog())
        assert report.frozen.mismatches == ()
