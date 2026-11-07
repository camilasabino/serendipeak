import re
import uuid

import pytest
from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from config.admin import build_admin_site
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import (
    InvalidMountain,
    MountainHasNoPhotograph,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
    UnknownMountain,
)
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.new_mountain import NewMountainViolation
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.admin import CAMERA_FIELDS, MountainImageInline
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)
from tests.admin.support import form_payload, input_names, photograph
from tests.support.catalog import catalog_mountain, primary_image, seeded_mountain

MEDIA_BASE_URL = settings.MEDIA_PUBLIC_BASE_URL
ADD_URL = reverse("admin:catalog_mountainrecord_add")
CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
NO_IMAGE_DRAFT = catalog_mountain(
    "bare-peak", status=MountainStatus.DRAFT, primary_image=None, countries=()
)


def admin_site():
    return build_admin_site()


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


NEW_MOUNTAIN = {
    "slug": "new-peak",
    "name_en": "New Peak",
    "latitude": "46.5",
    "longitude": "8.5",
    "elevation_meters": "3500",
    "continent": "EU",
    "region": "",
    "countries": [],
    "summary_en": "",
    "osm_node_id": "1504741757",
    "wikidata_id": "Q39739",
}


def new_mountain_payload(client, **overrides):
    page = client.get(ADD_URL)
    assert page.status_code == 200

    return form_payload(page, **{**NEW_MOUNTAIN, **photograph(), **overrides})


def create_mountain(client, **overrides):
    return client.post(ADD_URL, new_mountain_payload(client, **overrides))


EDITABLE = (
    "name_en",
    "latitude",
    "longitude",
    "elevation_meters",
    "continent",
    "summary_en",
    "region",
    "countries",
    "osm_node_id",
    "wikidata_id",
)
CORRECTIONS = {
    "name_en": "Cerro Aconcagua",
    "elevation_meters": "6960",
    "osm_node_id": "42",
    "wikidata_id": "Q1",
}


def linked_codes(record):
    return sorted(link.country_id for link in record.country_links.all())


def stored(entry):
    return MountainRecord.objects.filter(pk=entry.mountain.id).values().get()


def inline_errors_of(response):
    return list(response.context["inline_admin_formsets"][0].formset.non_form_errors())


def errors_of(response):
    form = response.context["adminform"].form

    return {name: list(messages) for name, messages in form.errors.items()}


def test_anonymous_visitors_are_sent_to_the_login(client):
    response = client.get(CHANGELIST_URL)

    assert response.status_code == 302
    assert response.headers["Location"].startswith(reverse("admin:login"))


@pytest.mark.parametrize("url", ["/admin/login/", "/admin/"])
def test_the_admin_cannot_be_framed(client, url):
    assert client.get(url).headers["X-Frame-Options"] == "DENY"


def test_the_public_api_does_not_gain_admin_headers(client, load_catalog):
    load_catalog(ACTIVE)

    response = client.get("/api/v1/mountains/aconcagua")

    assert response.status_code == 200
    assert "X-Frame-Options" not in response.headers
    assert "Set-Cookie" not in response.headers
    assert "Cookie" not in response.headers.get("Vary", "")


class TestChangeList:
    def test_lists_every_status_ordered_by_slug_with_status_visible(
        self, editor_client, load_catalog
    ):
        load_catalog(INACTIVE, DRAFT, ACTIVE)

        response = editor_client.get(CHANGELIST_URL)

        rows = list(response.context["cl"].result_list)
        assert [row.slug for row in rows] == ["aconcagua", "draft-peak", "old-peak"]
        assert {"slug", "english_name", "status", "continent", "country_codes"} <= set(
            response.context["cl"].list_display
        )

    @pytest.mark.parametrize(
        ("term", "slugs"),
        [
            ("draft", ["draft-peak"]),
            ("Draft Peak", ["draft-peak"]),
            ("test range", ["aconcagua", "draft-peak"]),
            ("TEST CHAIN", []),
        ],
    )
    def test_searches_name_slug_and_region(self, editor_client, load_catalog, term, slugs):
        load_catalog(DRAFT, ACTIVE)

        response = editor_client.get(CHANGELIST_URL, {"q": term})

        assert [row.slug for row in response.context["cl"].result_list] == slugs

    def test_filters_by_status(self, editor_client, load_catalog):
        load_catalog(DRAFT, ACTIVE, INACTIVE)

        response = editor_client.get(CHANGELIST_URL, {"status__exact": "draft"})

        assert [row.slug for row in response.context["cl"].result_list] == ["draft-peak"]

    def test_has_no_bulk_delete(self, editor_client, load_catalog):
        load_catalog(DRAFT)

        response = editor_client.get(CHANGELIST_URL)

        offered = dict(response.context["action_form"].fields["action"].choices)
        assert "delete_selected" not in offered
        assert "publish_selected" in offered


class TestCreation:
    def test_a_mountain_is_created_as_a_draft_with_its_point(self, editor_client):
        response = create_mountain(editor_client)

        assert response.status_code == 302, errors_of(response) if response.context else None
        record = MountainRecord.objects.get(slug="new-peak")
        assert record.status == "draft"
        assert (record.location.y, record.location.x) == (46.5, 8.5)
        assert record.location.srid == 4326
        assert record.osm_node_id == 1504741757
        assert all(getattr(record, name) is None for name in CAMERA_FIELDS)
        assert not record.country_links.exists()
        assert record.continent_id == "EU"
        assert record.summary_en is None

    def test_the_add_form_offers_no_status_no_camera_and_no_map_widget(self, editor_client):
        names = input_names(editor_client.get(ADD_URL))

        assert "status" not in names
        assert "location" not in names
        assert names & set(CAMERA_FIELDS) == set()
        assert {"latitude", "longitude", "slug", "osm_node_id", "wikidata_id"} <= names
        assert {"name_en", "summary_en", "continent", "countries"} <= names
        assert {"name", "summary", "name_es", "name_pt", "summary_es", "summary_pt"}.isdisjoint(
            names
        )

    def test_a_posted_camera_is_ignored_on_creation(self, editor_client):
        payload = new_mountain_payload(editor_client) | {
            "camera_heading_degrees": "66.87",
            "camera_pitch_degrees": "-19.85",
            "camera_range_meters": "17132",
        }

        assert editor_client.post(ADD_URL, payload).status_code == 302
        assert MountainRecord.objects.get(slug="new-peak").camera_heading_degrees is None

    def test_the_add_form_groups_the_secondary_data(self, editor_client):
        fieldsets = [
            (fieldset.name, list(fieldset.fields), fieldset.classes)
            for fieldset in editor_client.get(ADD_URL).context["adminform"]
        ]

        assert fieldsets == [
            ("Mountain", ["name_en", "slug", "latitude", "longitude", "elevation_meters"], ""),
            ("Geography", ["continent", "countries", "region"], ""),
            ("Editorial", ["summary_en"], ""),
            ("Additional data", ["osm_node_id", "wikidata_id"], "collapse"),
        ]

    def test_a_posted_status_is_ignored(self, editor_client):
        payload = new_mountain_payload(editor_client) | {"status": "active"}

        editor_client.post(ADD_URL, payload)

        assert MountainRecord.objects.get(slug="new-peak").status == "draft"

    def test_continent_countries_and_summary_are_stored_as_entered(self, editor_client):
        region = MountainRegionRecord.objects.create(slug="test-range", name_en="Test Range")
        create_mountain(
            editor_client,
            continent="SA",
            countries=["CL", "AR"],
            summary_en="Highest mountain outside Asia.",
            region=str(region.pk),
        )

        record = MountainRecord.objects.get(slug="new-peak")
        assert record.continent_id == "SA"
        assert linked_codes(record) == ["AR", "CL"]
        assert record.summary_en == "Highest mountain outside Asia."
        assert record.region_id == region.pk

    def test_the_photograph_is_created_with_the_draft(self, editor_client, media_store):
        payload = form_payload(editor_client.get(ADD_URL), **NEW_MOUNTAIN, **photograph())

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        image = MountainImageRecord.objects.get(mountain__slug="new-peak")
        assert (image.width, image.height, image.author) == (640, 480, "A. Photographer")
        assert image.original_key in media_store.originals
        assert {image.page_key, image.viewer_key} <= set(media_store.public)

    def test_creation_is_recorded_in_the_history(self, editor_client, editor):
        create_mountain(editor_client)

        entry = LogEntry.objects.get()
        assert entry.user == editor
        assert entry.object_repr == "new-peak"

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"latitude": "90.0001"}, "latitude"),
            ({"latitude": "-90.0001"}, "latitude"),
            ({"longitude": "180.0001"}, "longitude"),
            ({"longitude": "-181"}, "longitude"),
            ({"latitude": "nan"}, "latitude"),
            ({"longitude": "inf"}, "longitude"),
            ({"latitude": ""}, "latitude"),
            ({"longitude": "east"}, "longitude"),
        ],
    )
    def test_coordinates_outside_the_constraints_are_form_errors_not_server_errors(
        self, editor_client, overrides, field
    ):
        response = create_mountain(editor_client, **overrides)

        assert response.status_code == 200
        assert field in errors_of(response)
        assert not MountainRecord.objects.exists()

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"slug": "Bad Slug"}, "slug"),
            ({"slug": "today"}, "slug"),
            ({"slug": "random"}, "slug"),
            ({"slug": "-lead"}, "slug"),
            ({"slug": ""}, "slug"),
            ({"name_en": "  "}, "name_en"),
            ({"continent": ""}, "continent"),
            ({"continent": "ZZ"}, "continent"),
            ({"countries": ["ZZ"]}, "countries"),
            ({"elevation_meters": "0"}, "elevation_meters"),
            ({"elevation_meters": "-5"}, "elevation_meters"),
            ({"elevation_meters": ""}, "elevation_meters"),
            ({"osm_node_id": "0"}, "osm_node_id"),
            ({"osm_node_id": "-5"}, "osm_node_id"),
            ({"osm_node_id": "node/1"}, "osm_node_id"),
            ({"wikidata_id": "39739"}, "wikidata_id"),
            ({"wikidata_id": "Q0"}, "wikidata_id"),
            ({"summary_en": "highest mountain."}, "summary_en"),
        ],
    )
    def test_each_frozen_rule_gives_authoring_feedback_on_its_field(
        self, editor_client, overrides, field
    ):
        response = create_mountain(editor_client, **overrides)

        assert response.status_code == 200
        assert field in errors_of(response)
        assert not MountainRecord.objects.exists()

    def test_a_draft_may_be_saved_without_camera_or_provenance(self, editor_client):
        response = create_mountain(editor_client, osm_node_id="", wikidata_id="")

        assert response.status_code == 302
        record = MountainRecord.objects.get(slug="new-peak")
        assert (record.camera_heading_degrees, record.osm_node_id, record.wikidata_id) == (
            None,
            None,
            None,
        )

    def test_a_draft_is_created_without_a_photograph(self, editor_client, media_store):
        payload = form_payload(editor_client.get(ADD_URL), **NEW_MOUNTAIN)

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        record = MountainRecord.objects.get(slug="new-peak")
        assert record.status == "draft"
        assert not MountainImageRecord.objects.filter(pk=record.pk).exists()
        assert media_store.calls == []

    def test_a_credit_without_a_file_is_a_form_error_and_creates_nothing(
        self, editor_client, media_store
    ):
        payload = form_payload(
            editor_client.get(ADD_URL), **NEW_MOUNTAIN, **{"image-0-author": "A. Photographer"}
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert image_errors_of(response)["photograph_file"] == ["Choose a photograph."]
        assert not MountainRecord.objects.exists()
        assert media_store.calls == []

    def test_the_geography_and_photograph_are_created_together(self, editor_client, media_store):
        region = MountainRegionRecord.objects.create(slug="test-range", name_en="Test Range")

        response = create_mountain(
            editor_client,
            continent="SA",
            countries=["CL", "AR"],
            region=str(region.pk),
            **{"image-0-license_name": "CC BY 4.0"},
        )

        assert response.status_code == 302
        record = MountainRecord.objects.get(slug="new-peak")
        assert (record.status, record.continent_id, record.region_id) == ("draft", "SA", region.pk)
        assert linked_codes(record) == ["AR", "CL"]
        image = MountainImageRecord.objects.get(pk=record.pk)
        assert (image.author, image.license_name) == ("A. Photographer", "CC BY 4.0")
        assert image.original_key in media_store.originals
        assert LogEntry.objects.get().object_id == str(record.pk)

    def test_a_refusal_after_the_form_was_checked_is_a_form_error_that_keeps_what_was_typed(
        self, editor_client, monkeypatch
    ):
        payload = new_mountain_payload(editor_client, name_en="Typed Peak")
        model_admin = editor_client.get(ADD_URL).resolver_match.func.model_admin

        class Racing:
            def execute(self, new):
                raise SlugTaken(new.slug)

        monkeypatch.setattr(model_admin, "create_mountain", Racing())

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert errors_of(response)["slug"] == ["Another mountain already uses this slug."]
        assert "Typed Peak" in response.content.decode()
        assert not MountainRecord.objects.exists()
        assert not LogEntry.objects.exists()

    @pytest.mark.parametrize(
        ("missing", "field"),
        [
            ("image-0-photograph_file", "photograph_file"),
            ("image-0-author", "author"),
        ],
    )
    def test_an_incomplete_photograph_is_a_form_error(
        self, editor_client, media_store, missing, field
    ):
        fields = photograph()
        del fields[missing]
        payload = form_payload(editor_client.get(ADD_URL), **NEW_MOUNTAIN, **fields)

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert field in image_errors_of(response)
        assert not MountainRecord.objects.exists()
        assert not MountainImageRecord.objects.exists()
        assert media_store.calls == []


class TestEditing:
    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE, INACTIVE])
    def test_mountain_data_including_the_slug_is_input_on_every_status(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)

        names = input_names(editor_client.get(change_url(entry)))

        assert {"slug", *EDITABLE} <= names
        never_inputs = {"status", "location", "created_at", "updated_at", *CAMERA_FIELDS}
        assert names & never_inputs == set()
        derived = {"image-0-width", "image-0-height", "image-0-original_key", "image-0-page_key"}
        assert names & derived == set()

    def test_the_change_form_sections(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        page = editor_client.get(change_url(ACTIVE))

        sections = [(fieldset.name, fieldset.classes) for fieldset in page.context["adminform"]]
        assert sections == [
            ("Publication", ""),
            ("Mountain", ""),
            ("Geography", ""),
            ("Editorial", ""),
            ("Camera", ""),
            ("Additional data", "collapse"),
        ]

    def test_the_photograph_credit_stays_editable(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        names = input_names(editor_client.get(change_url(ACTIVE)))

        assert {
            "image-0-photograph_file",
            "image-0-source_page_url",
            "image-0-author",
            "image-0-license_name",
            "image-0-license_url",
        } <= names

    def test_read_only_values_and_current_coordinates_are_shown(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        page = editor_client.get(change_url(ACTIVE))

        content = page.content.decode()
        assert "aconcagua" in content
        assert "66.87" in content
        values = form_payload(page)
        assert (values["latitude"], values["longitude"]) == ("-32.6531487", "-70.0119607")
        assert values["elevation_meters"] == "6961"

    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE, INACTIVE])
    def test_mountain_data_is_saved_on_every_status(self, editor_client, load_catalog, entry):
        load_catalog(entry)
        before = stored(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(change_url(entry), form_payload(page, **CORRECTIONS))

        assert response.status_code == 302, errors_of(response)
        after = stored(entry)
        changed = {name for name in before if before[name] != after[name]}
        assert changed == {
            "name_en",
            "elevation_meters",
            "osm_node_id",
            "wikidata_id",
            "updated_at",
        }
        assert (after["name_en"], after["elevation_meters"]) == ("Cerro Aconcagua", 6960)
        assert (after["osm_node_id"], after["wikidata_id"]) == (42, "Q1")
        assert after["status"] == entry.mountain.status.value

    def test_unchanged_coordinates_keep_the_stored_point(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        before = stored(ACTIVE)["location"]
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(change_url(ACTIVE), form_payload(page, name_en="Cerro Aconcagua"))

        assert stored(ACTIVE)["location"].ewkb == before.ewkb

    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE, INACTIVE])
    def test_the_slug_can_be_corrected_on_every_status(self, editor_client, load_catalog, entry):
        load_catalog(entry)
        before = stored(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(change_url(entry), form_payload(page, slug="renamed-peak"))

        assert response.status_code == 302, errors_of(response)
        after = stored(entry)
        assert {name for name in before if before[name] != after[name]} == {"slug", "updated_at"}
        assert after["slug"] == "renamed-peak"
        assert after["status"] == entry.mountain.status.value

    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE, INACTIVE])
    @pytest.mark.parametrize("slug", ["Bad Slug", "today", "random", "other-peak", ""])
    def test_a_changed_slug_follows_the_slug_rules(self, editor_client, load_catalog, entry, slug):
        load_catalog(entry, catalog_mountain("other-peak"))
        before = stored(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(change_url(entry), form_payload(page, slug=slug))

        assert response.status_code == 200
        assert "slug" in errors_of(response)
        assert stored(entry) == before

    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE, INACTIVE])
    def test_forged_status_camera_and_derived_photograph_values_are_ignored(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)
        before = stored(entry)
        page = editor_client.get(change_url(entry))
        payload = form_payload(page, summary_en="Highest mountain in the Andes.")
        payload |= {
            "status": "draft" if entry is not DRAFT else "active",
            "camera_heading_degrees": "1",
            "camera_pitch_degrees": "1",
            "camera_range_meters": "2000",
            "camera_framing_x": "0",
            "camera_framing_y": "0",
            "location": "POINT(0 0)",
            "image-0-original_sha256": "f" * 64,
            "image-0-width": "1",
        }

        response = editor_client.post(change_url(entry), payload)

        assert response.status_code == 302
        after = stored(entry)
        assert {name for name in before if before[name] != after[name]} == {
            "summary_en",
            "updated_at",
        }

    def test_the_update_writes_only_the_columns_the_form_owns(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        with CaptureQueriesContext(connection) as queries:
            editor_client.post(change_url(ACTIVE), form_payload(page, name_en="Cerro Aconcagua"))

        updates = [q["sql"] for q in queries if q["sql"].startswith('UPDATE "mountain" SET')]
        assigned = {
            column
            for sql in updates
            for column in re.findall(r'"(\w+)" = ', sql.split(" WHERE ")[0])
        }
        assert assigned == {"name_en", "updated_at"}

    def test_a_stale_form_cannot_rewrite_a_camera_changed_after_it_was_rendered(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        MountainRecord.objects.filter(pk=ACTIVE.mountain.id).update(
            camera_heading_degrees=10.0, camera_framing_x=0.1
        )

        response = editor_client.post(change_url(ACTIVE), form_payload(page, name_en="Renamed"))

        assert response.status_code == 302
        after = stored(ACTIVE)
        assert (after["camera_heading_degrees"], after["camera_framing_x"]) == (10.0, 0.1)
        assert after["name_en"] == "Renamed"

    def test_optional_source_references_can_be_cleared_on_a_public_mountain(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            form_payload(page, osm_node_id="", wikidata_id=""),
        )

        assert response.status_code == 302
        after = stored(ACTIVE)
        assert (after["osm_node_id"], after["wikidata_id"]) == (None, None)

    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"osm_node_id": "0"}, "osm_node_id"),
            ({"wikidata_id": "39739"}, "wikidata_id"),
        ],
    )
    def test_present_source_references_keep_their_format_rules(
        self, editor_client, load_catalog, overrides, field
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(change_url(ACTIVE), form_payload(page, **overrides))

        assert response.status_code == 200
        assert field in errors_of(response)
        assert stored(ACTIVE)["osm_node_id"] == 1504741757

    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    @pytest.mark.parametrize(
        ("overrides", "field"),
        [
            ({"elevation_meters": "0"}, "elevation_meters"),
            ({"latitude": "90.5"}, "latitude"),
            ({"longitude": "-181"}, "longitude"),
            ({"latitude": "nan"}, "latitude"),
            ({"name_en": " "}, "name_en"),
            ({"summary_en": "highest mountain."}, "summary_en"),
        ],
    )
    def test_a_public_mountain_cannot_be_saved_into_an_unpublishable_state(
        self, editor_client, load_catalog, entry, overrides, field
    ):
        load_catalog(entry)
        before = stored(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(change_url(entry), form_payload(page, **overrides))

        assert response.status_code == 200
        assert field in errors_of(response)
        assert stored(entry) == before

    def test_a_public_mountain_is_judged_on_its_whole_prospective_state(
        self, editor_client, load_catalog
    ):
        load_catalog(INACTIVE)
        MountainRecord.objects.filter(pk=INACTIVE.mountain.id).update(
            camera_framing_x=None, camera_framing_y=None
        )
        before = stored(INACTIVE)
        page = editor_client.get(change_url(INACTIVE))

        response = editor_client.post(change_url(INACTIVE), form_payload(page, name_en="Renamed"))

        assert response.status_code == 200
        assert inline_errors_of(response) == [
            "Not allowed on a published mountain: the camera framing is missing."
        ]
        assert stored(INACTIVE) == before
        assert not LogEntry.objects.exists()

    def test_a_public_mountain_whose_photograph_awaits_its_file_cannot_be_saved(
        self, editor_client, load_catalog
    ):
        awaiting = seeded_mountain("awaiting-peak")
        load_catalog(awaiting)
        before = stored(awaiting)
        page = editor_client.get(change_url(awaiting))

        response = editor_client.post(change_url(awaiting), form_payload(page, name_en="Renamed"))

        assert response.status_code == 200
        assert inline_errors_of(response) == [
            "Not allowed on a published mountain: the photograph file is not stored yet."
        ]
        assert stored(awaiting) == before

    def test_a_draft_may_stay_incomplete(self, editor_client, load_catalog):
        draft = catalog_mountain(
            "bare-draft",
            status=MountainStatus.DRAFT,
            camera=None,
            primary_image=None,
            osm_node_id=None,
            wikidata_id=None,
        )
        load_catalog(draft)
        page = editor_client.get(change_url(draft))

        response = editor_client.post(change_url(draft), form_payload(page, name_en="Bare Draft"))

        assert response.status_code == 302
        assert stored(draft)["name_en"] == "Bare Draft"

    def test_countries_are_editable(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(page, countries=["AR", "CL"]),
        )

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert linked_codes(record) == ["AR", "CL"]

    def test_optional_fields_can_be_cleared(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(page, summary_en="", region="", countries=[]),
        )

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (record.summary_en, record.region_id, linked_codes(record)) == (None, None, [])

    def test_the_photograph_credit_is_saved(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                **{
                    "image-0-author": "New Author",
                    "image-0-license_name": "CC BY 4.0",
                    "image-0-license_url": "https://creativecommons.org/licenses/by/4.0/",
                },
            ),
        )

        image = MountainImageRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (image.author, image.license_name, image.license_url) == (
            "New Author",
            "CC BY 4.0",
            "https://creativecommons.org/licenses/by/4.0/",
        )

    def test_saving_bumps_updated_at_and_records_history(self, editor_client, editor, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE), form_payload(page, summary_en="Highest in the Andes.")
        )

        after = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert after.updated_at > before.updated_at
        assert after.created_at == before.created_at
        entry = LogEntry.objects.get()
        assert (entry.user, entry.object_repr) == (editor, "aconcagua")

    def test_a_photograph_edit_alone_bumps_updated_at(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(change_url(ACTIVE), form_payload(page, **{"image-0-author": "Someone"}))

        assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at > before

    def test_saving_does_not_overwrite_a_status_changed_after_the_row_was_read(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        page = editor_client.get(change_url(DRAFT))
        MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(status="active")

        response = editor_client.post(
            change_url(DRAFT), form_payload(page, summary_en="Highest in the Andes.")
        )

        assert response.status_code == 302
        saved = MountainRecord.objects.get(pk=DRAFT.mountain.id)
        assert (saved.status, saved.summary_en) == ("active", "Highest in the Andes.")

    @pytest.mark.parametrize(
        ("refusal", "location", "message"),
        [
            (SlugTaken("aconcagua"), ("form", "slug"), "Another mountain already uses this slug."),
            (UnknownContinent("ZZ"), ("form", "continent"), "This continent is not in the"),
            (UnknownRegion(uuid.uuid4()), ("form", "region"), "This region no longer exists."),
            (UnknownCountries(("ZZ",)), ("form", "countries"), "not in the reference data: ZZ."),
            (
                InvalidMountain((NewMountainViolation.SLUG_INVALID,)),
                ("form", "slug"),
                "Use lowercase letters",
            ),
            (
                InvalidMountain((NewMountainViolation.IMAGE_AUTHOR_MISSING,)),
                ("image", "author"),
                "Enter the author",
            ),
            (
                PublicationRejected((PublicationViolation.CAMERA_MISSING,)),
                ("inline", None),
                "Not allowed on a published mountain: the camera is missing.",
            ),
            (
                PhotographRejected(PhotographRejection.CORRUPT),
                ("image", "photograph_file"),
                "The file is damaged or incomplete.",
            ),
            (
                MountainHasNoPhotograph(uuid.uuid4()),
                ("image", "photograph_file"),
                "no photograph yet",
            ),
        ],
    )
    def test_what_a_use_case_refuses_at_save_is_shown_as_form_errors_without_internals(
        self, editor_client, load_catalog, monkeypatch, refusal, location, message
    ):
        load_catalog(ACTIVE)
        before = stored(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        model_admin = page.resolver_match.func.model_admin

        class Refusing:
            def execute(self, mountain_id, update):
                raise refusal

        monkeypatch.setattr(model_admin, "update_mountain", Refusing())

        response = editor_client.post(
            change_url(ACTIVE), form_payload(page, summary_en="Typed summary.")
        )

        assert response.status_code == 200
        kind, name = location
        errors = {
            "form": lambda: errors_of(response),
            "image": lambda: image_errors_of(response),
            "inline": lambda: {None: inline_errors_of(response)},
        }[kind]()
        assert any(message in text for text in errors[name])
        html = response.content.decode()
        assert "Typed summary." in html
        assert type(refusal).__name__ not in html
        assert stored(ACTIVE) == before
        assert not LogEntry.objects.exists()

    def test_a_mountain_deleted_while_the_form_was_open_is_a_message_and_the_changelist(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        model_admin = page.resolver_match.func.model_admin

        class Gone:
            def execute(self, mountain_id, update):
                raise UnknownMountain(mountain_id)

        monkeypatch.setattr(model_admin, "update_mountain", Gone())

        response = editor_client.post(change_url(ACTIVE), form_payload(page), follow=True)

        assert response.redirect_chain == [(CHANGELIST_URL, 302)]
        assert [str(m) for m in response.context["messages"]] == [
            "aconcagua no longer exists, so nothing was saved."
        ]

    def test_an_unexpected_failure_of_the_use_case_is_not_hidden(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        model_admin = page.resolver_match.func.model_admin

        class Failing:
            def execute(self, mountain_id, update):
                raise InfrastructureError("the database is down")

        monkeypatch.setattr(model_admin, "update_mountain", Failing())
        editor_client.raise_request_exception = False

        response = editor_client.post(change_url(ACTIVE), form_payload(page))

        assert response.status_code == 500

    def test_a_credit_edit_without_a_file_reaches_the_use_case_as_a_credit_alone(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        model_admin = page.resolver_match.func.model_admin
        received = []
        real = model_admin.update_mountain

        class Recording:
            def execute(self, mountain_id, update):
                received.append(update)

                return real.execute(mountain_id, update)

        monkeypatch.setattr(model_admin, "update_mountain", Recording())

        editor_client.post(change_url(ACTIVE), form_payload(page, **{"image-0-author": "Someone"}))

        (update,) = received
        assert update.photograph is None
        assert update.credit.author == "Someone"

    def test_a_save_that_changes_no_photograph_sends_none(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))
        model_admin = page.resolver_match.func.model_admin
        received = []
        real = model_admin.update_mountain

        class Recording:
            def execute(self, mountain_id, update):
                received.append(update)

                return real.execute(mountain_id, update)

        monkeypatch.setattr(model_admin, "update_mountain", Recording())

        editor_client.post(change_url(ACTIVE), form_payload(page, name_en="Renamed"))

        (update,) = received
        assert (update.photograph, update.credit) == (None, None)

    @pytest.mark.parametrize(
        "summary",
        [
            "highest mountain.",
            "A\nB.",
            "A <b>bold</b> claim.",
            "A" * 201,
            "Rock &amp; ice.",
            "Highest mountain (6961 m)",
        ],
    )
    def test_a_summary_that_breaks_the_v1_rules_is_a_form_error(
        self, editor_client, load_catalog, summary
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(change_url(ACTIVE), form_payload(page, summary_en=summary))

        assert response.status_code == 200
        assert "summary_en" in errors_of(response)
        assert (
            MountainRecord.objects.get(pk=ACTIVE.mountain.id).summary_en
            == "Highest mountain outside Asia."
        )

    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    @pytest.mark.parametrize("cleared", ["image-0-author", "image-0-photograph_file"])
    def test_a_published_photograph_cannot_lose_what_publication_requires(
        self, editor_client, load_catalog, entry, cleared
    ):
        load_catalog(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(
            change_url(entry),
            form_payload(page, summary_en="Edited.", **{cleared: ""}),
        )

        image = MountainImageRecord.objects.get(pk=entry.mountain.id)
        stored_image = entry.mountain.primary_image
        assert (image.author, image.source_page_url) == (
            stored_image.author,
            stored_image.source_page_url,
        )
        assert image.original_sha256 == stored_image.media.original_sha256
        if cleared == "image-0-photograph_file":
            assert response.status_code == 302
        else:
            assert response.status_code == 200

    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    def test_a_published_photograph_may_drop_its_license(self, editor_client, load_catalog, entry):
        load_catalog(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(
            change_url(entry),
            form_payload(page, **{"image-0-license_name": "", "image-0-license_url": ""}),
        )

        assert response.status_code == 302
        image = MountainImageRecord.objects.get(pk=entry.mountain.id)
        assert (image.license_name, image.license_url) == (None, None)

    def test_a_draft_photograph_credit_may_be_incomplete(self, editor_client, load_catalog):
        draft = catalog_mountain(
            "draft-peak",
            status=MountainStatus.DRAFT,
            primary_image=primary_image(license_url=None),
        )
        load_catalog(draft)
        page = editor_client.get(change_url(draft))

        response = editor_client.post(
            change_url(draft), form_payload(page, **{"image-0-license_name": ""})
        )

        assert response.status_code == 302

    def test_a_viewer_cannot_post(self, viewer_client, load_catalog):
        load_catalog(ACTIVE)

        response = viewer_client.post(change_url(ACTIVE), {"summary_en": "Highest in the Andes."})

        assert response.status_code == 403
        assert (
            MountainRecord.objects.get(pk=ACTIVE.mountain.id).summary_en
            == "Highest mountain outside Asia."
        )


class TestDeletion:
    def test_only_drafts_can_be_deleted(self, editor_client, load_catalog):
        load_catalog(NO_IMAGE_DRAFT, ACTIVE, INACTIVE)

        statuses = {
            entry.mountain.slug: editor_client.post(
                reverse("admin:catalog_mountainrecord_delete", args=[entry.mountain.id]),
                {"post": "yes"},
            ).status_code
            for entry in (NO_IMAGE_DRAFT, ACTIVE, INACTIVE)
        }

        assert statuses == {"bare-peak": 302, "aconcagua": 403, "old-peak": 403}
        assert set(MountainRecord.objects.values_list("slug", flat=True)) == {
            "aconcagua",
            "old-peak",
        }

    def test_the_delete_button_is_offered_for_drafts_only(self, editor_client, load_catalog):
        load_catalog(NO_IMAGE_DRAFT, ACTIVE)

        assert "deletelink" in editor_client.get(change_url(NO_IMAGE_DRAFT)).content.decode()
        assert "deletelink" not in editor_client.get(change_url(ACTIVE)).content.decode()

    def test_a_draft_is_deleted_with_its_photograph_and_countries(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(DRAFT)
        delete_url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])
        stored_objects = (set(media_store.originals), set(media_store.public))

        page = editor_client.get(delete_url)
        assert page.status_code == 200
        html = page.content.decode()
        assert "The record of its photograph" in html
        assert "Its links to the countries" in html
        assert "Cannot delete" not in html

        response = editor_client.post(delete_url, {"post": "yes"})

        assert response.status_code == 302
        assert not MountainRecord.objects.exists()
        assert not MountainImageRecord.objects.exists()
        assert not MountainCountryRecord.objects.exists()
        assert (set(media_store.originals), set(media_store.public)) == stored_objects

    def test_a_draft_without_a_photograph_or_countries_is_deleted(
        self, editor_client, load_catalog
    ):
        load_catalog(NO_IMAGE_DRAFT)
        delete_url = reverse(
            "admin:catalog_mountainrecord_delete", args=[NO_IMAGE_DRAFT.mountain.id]
        )

        page = editor_client.get(delete_url)

        assert "The record of its photograph" not in page.content.decode()
        assert editor_client.post(delete_url, {"post": "yes"}).status_code == 302
        assert not MountainRecord.objects.exists()

    def test_other_mountains_survive_a_deletion(self, editor_client, load_catalog):
        load_catalog(DRAFT, ACTIVE)

        editor_client.post(
            reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id]),
            {"post": "yes"},
        )

        assert list(MountainRecord.objects.values_list("slug", flat=True)) == ["aconcagua"]
        assert MountainImageRecord.objects.filter(pk=ACTIVE.mountain.id).exists()
        assert MountainCountryRecord.objects.filter(mountain_id=ACTIVE.mountain.id).exists()

    def test_the_deletion_is_recorded_in_the_history(self, editor_client, editor, load_catalog):
        load_catalog(DRAFT)

        editor_client.post(
            reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id]),
            {"post": "yes"},
        )

        entry = LogEntry.objects.get()
        assert (entry.user, entry.object_repr) == (editor, "draft-peak")

    def test_a_draft_a_discovery_refers_to_is_kept_with_a_message(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        DailyDiscoveryRecord.objects.create(date="2026-01-01", mountain_id=DRAFT.mountain.id)

        response = editor_client.post(
            reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id]),
            {"post": "yes"},
            follow=True,
        )

        assert response.redirect_chain == [(change_url(DRAFT), 302)]
        assert [str(m) for m in response.context["messages"]] == [
            "draft-peak was shown as the mountain of a day, so it cannot be deleted."
        ]
        assert MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).exists()
        assert MountainCountryRecord.objects.filter(mountain_id=DRAFT.mountain.id).exists()
        assert not LogEntry.objects.exists()

    def test_a_mountain_published_after_the_confirmation_page_was_shown_is_kept(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        delete_url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])
        editor_client.get(delete_url)
        MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(status="active")

        response = editor_client.post(delete_url, {"post": "yes"})

        assert response.status_code == 403
        assert MountainRecord.objects.filter(pk=DRAFT.mountain.id).exists()

    def test_a_mountain_deleted_meanwhile_is_a_not_found_redirect(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(DRAFT)
        delete_url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])
        model_admin = editor_client.get(delete_url).resolver_match.func.model_admin

        class Gone:
            def execute(self, mountain_id):
                raise UnknownMountain(mountain_id)

        monkeypatch.setattr(model_admin, "delete_draft_mountain", Gone())

        response = editor_client.post(delete_url, {"post": "yes"}, follow=True)

        assert response.redirect_chain == [(CHANGELIST_URL, 302)]
        assert [str(m) for m in response.context["messages"]] == [
            "draft-peak no longer exists, so nothing was saved."
        ]
        assert not LogEntry.objects.exists()


@pytest.mark.django_db
class TestPhotographRemoval:
    def remove(self, client, entry, **overrides):
        page = client.get(change_url(entry))

        return client.post(
            change_url(entry), form_payload(page, **{"image-0-DELETE": "on", **overrides})
        )

    def test_a_draft_offers_the_removal_and_a_published_mountain_does_not(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT, ACTIVE, INACTIVE)

        assert "image-0-DELETE" in input_names(editor_client.get(change_url(DRAFT)))
        assert "image-0-DELETE" not in input_names(editor_client.get(change_url(ACTIVE)))
        assert "image-0-DELETE" not in input_names(editor_client.get(change_url(INACTIVE)))

    def test_a_draft_loses_its_photograph_record_and_keeps_the_stored_objects(
        self, editor_client, editor, load_catalog, media_store
    ):
        load_catalog(DRAFT)
        stored_objects = (set(media_store.originals), set(media_store.public))
        before = stored(DRAFT)

        response = self.remove(editor_client, DRAFT)

        assert response.status_code == 302
        assert not MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).exists()
        assert (set(media_store.originals), set(media_store.public)) == stored_objects
        after = stored(DRAFT)
        assert {k: v for k, v in after.items() if k != "updated_at"} == {
            k: v for k, v in before.items() if k != "updated_at"
        }
        assert LogEntry.objects.get().user == editor

    def test_the_removal_goes_through_the_update_use_case(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(DRAFT)
        page = editor_client.get(change_url(DRAFT))
        model_admin = page.resolver_match.func.model_admin
        updates = []
        real = model_admin.update_mountain

        class Recording:
            def execute(self, mountain_id, update):
                updates.append(update)

                return real.execute(mountain_id, update)

        monkeypatch.setattr(model_admin, "update_mountain", Recording())

        editor_client.post(change_url(DRAFT), form_payload(page, **{"image-0-DELETE": "on"}))

        (update,) = updates
        assert (update.remove_photograph, update.photograph, update.credit) == (True, None, None)

    def test_a_draft_without_its_photograph_cannot_be_published_until_it_has_one(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        self.remove(editor_client, DRAFT)

        def publish():
            return editor_client.post(
                CHANGELIST_URL,
                {"action": "publish_selected", "_selected_action": [str(DRAFT.mountain.id)]},
                follow=True,
            )

        rejected = publish()

        assert stored(DRAFT)["status"] == "draft"
        assert any("photograph is missing" in str(m) for m in rejected.context["messages"])

        page = editor_client.get(change_url(DRAFT))
        assert (
            editor_client.post(change_url(DRAFT), form_payload(page, **photograph())).status_code
            == 302
        )
        publish()

        assert stored(DRAFT)["status"] == "active"

    def test_a_removal_the_use_case_judges_unpublishable_is_a_form_error_and_keeps_the_photograph(
        self, editor_client, load_catalog, monkeypatch
    ):
        load_catalog(ACTIVE)
        monkeypatch.setattr(
            MountainImageInline, "has_delete_permission", lambda self, request, obj=None: True
        )
        before = (
            stored(ACTIVE),
            MountainImageRecord.objects.filter(pk=ACTIVE.mountain.id).values().get(),
        )

        response = self.remove(editor_client, ACTIVE)

        assert response.status_code == 200
        assert any(
            "Not allowed on a published mountain: the photograph is missing." in text
            for text in inline_errors_of(response)
        )
        assert before == (
            stored(ACTIVE),
            MountainImageRecord.objects.filter(pk=ACTIVE.mountain.id).values().get(),
        )
        assert not LogEntry.objects.exists()

    def test_a_mountain_published_after_the_form_was_shown_keeps_its_photograph(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        page = editor_client.get(change_url(DRAFT))
        MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(status="active")

        editor_client.post(change_url(DRAFT), form_payload(page, **{"image-0-DELETE": "on"}))

        assert MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).exists()


class TestDiscoveries:
    def test_the_history_is_listed_and_cannot_be_changed(self, editor_client, load_catalog):
        import datetime

        from tests.support.catalog import catalog_discovery

        day = datetime.date(2026, 10, 3)
        load_catalog(ACTIVE, discoveries=[catalog_discovery(day, ACTIVE)])
        list_url = reverse("admin:catalog_dailydiscoveryrecord_changelist")

        listing = editor_client.get(list_url)
        assert listing.status_code == 200
        assert [row.date for row in listing.context["cl"].result_list] == [day]

        assert (
            editor_client.get(reverse("admin:catalog_dailydiscoveryrecord_add")).status_code == 403
        )
        change = reverse("admin:catalog_dailydiscoveryrecord_change", args=[day])
        assert editor_client.post(change, {"mountain": "x"}).status_code == 403
        delete = reverse("admin:catalog_dailydiscoveryrecord_delete", args=[day])
        assert editor_client.post(delete, {"post": "yes"}).status_code == 403


UNSAFE_LINKS = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://example.com/page",
    "HTTPS://example.com/page",
    "https://user@example.com/page",
    "https://",
    "https://exa mple.com",
]
USE_HTTPS_LINK = "Use an https:// link."


def image_errors_of(response):
    formset = response.context["inline_admin_formsets"][0].formset

    return {name: list(messages) for name, messages in formset.forms[0].errors.items()}


@pytest.mark.django_db
class TestPublicLinks:
    @pytest.mark.parametrize("value", UNSAFE_LINKS)
    @pytest.mark.parametrize("field", ["source_page_url", "license_url"])
    def test_an_unsafe_photograph_link_is_a_form_error_on_creation(
        self, editor_client, media_store, field, value
    ):
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **photograph(**{f"image-0-{field}": value, "image-0-license_name": "CC BY 4.0"}),
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert image_errors_of(response) == {field: [USE_HTTPS_LINK]}
        assert not MountainRecord.objects.exists()
        assert not MountainImageRecord.objects.exists()

    def test_safe_links_are_stored_unchanged(self, editor_client):
        links = {
            "image-0-source_page_url": "https://unsplash.com/photos/a?utm_source=app#top",
            "image-0-license_url": "https://creativecommons.org/licenses/by-sa/4.0",
        }
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **photograph(**links, **{"image-0-license_name": "CC BY-SA 4.0"}),
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        record = MountainRecord.objects.get(slug="new-peak")
        image = record.image
        assert image.source_page_url == links["image-0-source_page_url"]
        assert image.license_url == links["image-0-license_url"]

    def test_surrounding_whitespace_is_trimmed_before_the_rule_applies(
        self, editor_client, media_store
    ):
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **photograph(**{"image-0-source_page_url": "  https://example.com/a  "}),
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        assert MountainRecord.objects.get().image.source_page_url == "https://example.com/a"

    @pytest.mark.parametrize("entry", [DRAFT, ACTIVE])
    def test_an_unsafe_license_url_is_a_form_error_on_the_editable_photograph(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(
            change_url(entry),
            form_payload(page, **{"image-0-license_url": "http://example.com/license"}),
        )

        assert response.status_code == 200
        assert image_errors_of(response) == {"license_url": [USE_HTTPS_LINK]}
        stored = MountainImageRecord.objects.get(pk=entry.mountain.id).license_url
        assert stored == entry.mountain.primary_image.license_url

    def test_optional_links_can_still_be_cleared(self, editor_client, load_catalog):
        load_catalog(DRAFT)
        page = editor_client.get(change_url(DRAFT))

        response = editor_client.post(
            change_url(DRAFT),
            form_payload(page, **{"image-0-license_url": ""}),
        )

        assert response.status_code == 302
        assert MountainImageRecord.objects.get(pk=DRAFT.mountain.id).license_url is None


@pytest.mark.django_db
class TestPhotographInline:
    def test_the_photograph_is_the_only_derived_input(self, editor_client, load_catalog):
        load_catalog(DRAFT)

        adding = input_names(editor_client.get(ADD_URL))
        changing = input_names(editor_client.get(change_url(DRAFT)))

        assert "image-0-photograph_file" in adding
        assert not {name for name in adding | changing if "original" in name or "_key" in name}

    def test_the_stored_original_is_identified_by_its_checksum_and_never_by_its_keys(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        media = DRAFT.mountain.primary_image.media

        html = editor_client.get(change_url(DRAFT)).content.decode()

        assert media.original_sha256 in html
        for key in (media.original_key, media.viewer_key):
            assert key not in html
        assert html.count(media.page_key) == html.count(public_url(MEDIA_BASE_URL, media.page_key))

    def test_a_photograph_awaiting_its_file_says_so(self, editor_client, load_catalog):
        awaiting = seeded_mountain("awaiting-peak", status=MountainStatus.DRAFT)
        load_catalog(awaiting)

        html = editor_client.get(change_url(awaiting)).content.decode()

        assert "Not stored yet" in html

    def test_media_columns_are_never_form_inputs_and_forged_ones_are_ignored(
        self, editor_client, load_catalog
    ):
        awaiting = seeded_mountain("awaiting-peak", status=MountainStatus.DRAFT)
        load_catalog(awaiting)
        page = editor_client.get(change_url(awaiting))
        forged = {
            "image-0-original_key": "photographs/{}/original.jpg".format("a" * 64),
            "image-0-original_sha256": "a" * 64,
            "image-0-page_key": "photographs/{}/page-r1.jpg".format("a" * 64),
            "image-0-viewer_key": "photographs/{}/viewer-r1.jpg".format("a" * 64),
        }

        assert input_names(page) & set(forged) == set()
        response = editor_client.post(
            change_url(awaiting), {**form_payload(page, summary_en="Edited."), **forged}
        )

        assert response.status_code == 302
        assert MountainImageRecord.objects.get(pk=awaiting.mountain.id).original_key is None

    def test_a_seeded_photograph_awaiting_its_file_blocks_publication(
        self, editor_client, load_catalog
    ):
        awaiting = seeded_mountain("awaiting-peak", status=MountainStatus.DRAFT)
        load_catalog(awaiting)

        html = editor_client.get(change_url(awaiting)).content.decode()

        assert "The photograph file is not stored yet" in html
