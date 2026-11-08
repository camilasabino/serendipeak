"""What the Studio's publication and edit writes do to the public site and to the catalog that
the frozen v1 contract describes."""

import datetime

import pytest
from django.urls import reverse

from config.composition import build_check_catalog
from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import DailyDiscoveryRecord, MountainRecord
from tests.studio.support import form_payload
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    catalog_of,
    fixture_catalog,
    fixture_catalog_with_media,
    primary_image,
)

pytestmark = pytest.mark.usefixtures("media_store")

DRAFT = catalog_mountain("complete-draft", status=MountainStatus.DRAFT)
INCOMPLETE_DRAFT = catalog_mountain(
    "incomplete-draft",
    status=MountainStatus.DRAFT,
    camera=None,
    primary_image=primary_image(media=None),
)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
DAY = datetime.date(2026, 10, 3)


def load(*entries, discoveries=()):
    DjangoCatalogStore().load(catalog_of(*entries, discoveries=discoveries))


def post(client, name, entry):
    return client.post(reverse(f"studio:{name}", args=[entry.mountain.slug]))


def status_of(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id).status


def public_status(client, entry):
    return client.get(f"/api/v1/mountains/{entry.mountain.slug}").status_code


class TestPublicVisibility:
    def test_drafts_never_leak_through_slug_random_or_daily(self, db, editor_client):
        load(DRAFT, INCOMPLETE_DRAFT)

        assert public_status(editor_client, DRAFT) == 404
        assert public_status(editor_client, INCOMPLETE_DRAFT) == 404
        assert editor_client.get("/api/v1/mountains/random").status_code == 503
        assert editor_client.get("/api/v1/mountains/today").status_code == 503
        assert not DailyDiscoveryRecord.objects.exists()

    def test_a_published_mountain_becomes_eligible_for_random(self, db, editor_client):
        load(DRAFT)

        post(editor_client, "mountain_publish", DRAFT)

        random = editor_client.get("/api/v1/mountains/random")
        assert random.status_code == 200
        assert random.json()["slug"] == "complete-draft"

    def test_publishing_does_not_create_or_change_daily_history(self, db, editor_client):
        load(ACTIVE, DRAFT, discoveries=[catalog_discovery(DAY, ACTIVE)])

        post(editor_client, "mountain_publish", DRAFT)

        assert list(DailyDiscoveryRecord.objects.values_list("date", "mountain_id")) == [
            (DAY, ACTIVE.mountain.id)
        ]

    def test_an_unlisted_mountain_stays_addressable_but_leaves_random_and_keeps_history(
        self, db, editor_client
    ):
        load(ACTIVE, discoveries=[catalog_discovery(DAY, ACTIVE)])

        post(editor_client, "mountain_unlist", ACTIVE)

        assert status_of(ACTIVE) == "inactive"
        assert public_status(editor_client, ACTIVE) == 200
        assert editor_client.get("/api/v1/mountains/random").status_code == 503
        assert DailyDiscoveryRecord.objects.get(date=DAY).mountain_id == ACTIVE.mountain.id

    def test_listing_again_returns_the_mountain_to_random(self, db, editor_client):
        load(INACTIVE)
        assert editor_client.get("/api/v1/mountains/random").status_code == 503

        post(editor_client, "mountain_relist", INACTIVE)

        assert status_of(INACTIVE) == "active"
        assert editor_client.get("/api/v1/mountains/random").json()["slug"] == "old-peak"

    @pytest.mark.parametrize("entry", [DRAFT, INACTIVE])
    def test_only_published_mountains_are_unlisted(self, db, editor_client, entry):
        load(entry)

        post(editor_client, "mountain_unlist", entry)

        assert status_of(entry) == entry.mountain.status.value


def identity(mountain):
    """What editorial edits through the Studio form must leave as it was."""
    image = mountain.primary_image

    return (
        mountain.slug,
        mountain.name,
        mountain.coordinates,
        mountain.elevation_meters,
        mountain.camera,
        mountain.osm_node_id,
        mountain.wikidata_id,
        image.source_page_url,
        image.dimensions,
    )


class TestFullCatalogEdits:
    @pytest.fixture
    def stored(self, db):
        DjangoCatalogStore().load(fixture_catalog_with_media())

    def test_editorial_edits_leave_the_identity_of_all_73_mountains_untouched(
        self, editor_client, stored
    ):
        before = {
            entry.mountain.slug: identity(entry.mountain) for entry in fixture_catalog().mountains
        }

        for record in MountainRecord.objects.order_by("slug"):
            url = reverse("studio:mountain_edit", args=[record.slug])
            payload = form_payload(
                editor_client.get(url),
                summary="Edited through the Studio.",
                region="",
                continent="OC",
                countries=["NZ"],
                **{"photograph-author": "Edited credit"},
            )

            assert editor_client.post(url, payload).status_code == 302

        after = DjangoCatalogStore().snapshot().mountains
        assert {entry.mountain.slug: identity(entry.mountain) for entry in after} == before
        assert len(after) == 73
        assert build_check_catalog().execute().violations == ()

    def test_unlisting_and_listing_again_every_mountain_restores_the_catalog(
        self, editor_client, stored
    ):
        before = DjangoCatalogStore().snapshot()
        slugs = list(MountainRecord.objects.filter(status="active").values_list("slug", flat=True))

        for name in ("mountain_unlist", "mountain_relist"):
            for slug in slugs:
                response = editor_client.post(reverse(f"studio:{name}", args=[slug]))
                assert response.status_code == 302

        assert MountainRecord.objects.filter(status="active").count() == len(slugs) == 73
        statuses = {entry.mountain.slug: entry.mountain.status for entry in before.mountains}
        after = DjangoCatalogStore().snapshot().mountains
        assert {entry.mountain.slug: entry.mountain.status for entry in after} == statuses
