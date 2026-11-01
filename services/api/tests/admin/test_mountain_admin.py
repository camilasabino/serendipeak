import pytest
from django.contrib.admin.models import LogEntry
from django.urls import reverse

from config.admin import build_admin_site
from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.admin import MountainChangeForm
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.admin.support import form_payload, input_names
from tests.support.catalog import catalog_mountain, primary_image

ADD_URL = reverse("admin:catalog_mountainrecord_add")
CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT, range_name="Karakoram")
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
NO_IMAGE_DRAFT = catalog_mountain("bare-peak", status=MountainStatus.DRAFT, primary_image=None)


def admin_site():
    return build_admin_site()


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


NEW_MOUNTAIN = {
    "slug": "new-peak",
    "name": "New Peak",
    "latitude": "46.5",
    "longitude": "8.5",
    "elevation_meters": "3500",
    "prominence_meters": "",
    "range_name": "",
    "countries": "",
    "summary": "",
    "wikipedia_url": "",
    "camera_heading_degrees": "66.87",
    "camera_pitch_degrees": "-19.85",
    "camera_range_meters": "17132",
    "camera_framing_x": "-0.0587",
    "camera_framing_y": "0.3857",
    "osm_type": "node",
    "osm_id": "1504741757",
    "wikidata_id": "Q39739",
}


def new_mountain_payload(client, **overrides):
    page = client.get(ADD_URL)
    assert page.status_code == 200

    return form_payload(page, **{**NEW_MOUNTAIN, **overrides})


def create_mountain(client, **overrides):
    return client.post(ADD_URL, new_mountain_payload(client, **overrides))


def errors_of(response):
    form = response.context["adminform"].form

    return {name: list(messages) for name, messages in form.errors.items()}


def test_anonymous_visitors_are_sent_to_the_login(client):
    response = client.get(CHANGELIST_URL)

    assert response.status_code == 302
    assert response.headers["Location"].startswith(reverse("admin:login"))


def test_a_staff_user_without_catalog_permissions_sees_no_mountains(client, db):
    from django.contrib.auth.models import User

    client.force_login(User.objects.create_user("intruder", is_staff=True))

    assert client.get(CHANGELIST_URL).status_code == 403


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
        assert {"slug", "name", "status", "elevation_meters"} <= set(
            response.context["cl"].list_display
        )

    @pytest.mark.parametrize(
        ("term", "slugs"),
        [
            ("draft", ["draft-peak"]),
            ("Draft Peak", ["draft-peak"]),
            ("karakoram", ["draft-peak"]),
            ("principal", ["aconcagua"]),
        ],
    )
    def test_searches_name_slug_and_range(self, editor_client, load_catalog, term, slugs):
        load_catalog(DRAFT, ACTIVE)

        response = editor_client.get(CHANGELIST_URL, {"q": term})

        assert [row.slug for row in response.context["cl"].result_list] == slugs

    def test_filters_by_status(self, editor_client, load_catalog):
        load_catalog(DRAFT, ACTIVE, INACTIVE)

        response = editor_client.get(CHANGELIST_URL, {"status__exact": "draft"})

        assert [row.slug for row in response.context["cl"].result_list] == ["draft-peak"]

    def test_has_no_bulk_delete(self, publisher_client, load_catalog):
        load_catalog(DRAFT)

        response = publisher_client.get(CHANGELIST_URL)

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
        assert (record.camera_heading_degrees, record.osm_id) == (66.87, 1504741757)
        assert record.countries == []
        assert record.prominence_meters is None
        assert record.summary is None

    def test_the_add_form_offers_no_status_and_no_map_widget(self, editor_client):
        names = input_names(editor_client.get(ADD_URL))

        assert "status" not in names
        assert "location" not in names
        assert {"latitude", "longitude", "slug", "camera_heading_degrees"} <= names

    def test_a_posted_status_is_ignored(self, editor_client):
        payload = new_mountain_payload(editor_client) | {"status": "active"}

        editor_client.post(ADD_URL, payload)

        assert MountainRecord.objects.get(slug="new-peak").status == "draft"

    def test_countries_summary_and_numbers_are_stored_as_entered(self, editor_client):
        create_mountain(
            editor_client,
            countries="Argentina, Chile",
            summary="Highest mountain outside Asia.",
            prominence_meters="6962",
            range_name=" Principal Cordillera ",
            wikipedia_url="https://en.wikipedia.org/wiki/Aconcagua",
        )

        record = MountainRecord.objects.get(slug="new-peak")
        assert record.countries == ["Argentina", "Chile"]
        assert record.summary == "Highest mountain outside Asia."
        assert record.prominence_meters == 6962
        assert record.range_name == "Principal Cordillera"

    def test_the_photograph_is_created_with_the_draft(self, editor_client):
        page = editor_client.get(ADD_URL)
        payload = form_payload(
            page,
            **NEW_MOUNTAIN,
            **{
                "image-0-url": "https://upload.wikimedia.org/a.jpg",
                "image-0-source_page_url": "https://commons.wikimedia.org/wiki/File:a.jpg",
                "image-0-source_identifier": "File:a.jpg",
                "image-0-attribution": "A. Photographer",
                "image-0-width": "400",
                "image-0-height": "300",
            },
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        image = MountainImageRecord.objects.get(mountain__slug="new-peak")
        assert (image.width, image.height, image.creator) == (400, 300, None)

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
            ({"name": "  "}, "name"),
            ({"elevation_meters": "0"}, "elevation_meters"),
            ({"elevation_meters": "-5"}, "elevation_meters"),
            ({"elevation_meters": ""}, "elevation_meters"),
            ({"camera_heading_degrees": "360"}, "camera_heading_degrees"),
            ({"camera_pitch_degrees": "15.1"}, "camera_pitch_degrees"),
            ({"camera_range_meters": "1999"}, "camera_range_meters"),
            ({"camera_framing_x": "1.1"}, "camera_framing_x"),
            ({"camera_heading_degrees": ""}, "camera_heading_degrees"),
            ({"camera_framing_y": ""}, "camera_framing_y"),
            ({"osm_id": ""}, "osm_id"),
            ({"osm_type": ""}, "osm_id"),
            ({"osm_id": "0"}, "osm_id"),
            ({"wikidata_id": "39739"}, "wikidata_id"),
            ({"wikidata_id": "Q0"}, "wikidata_id"),
            ({"summary": "highest mountain."}, "summary"),
            ({"wikipedia_url": "  "}, None),
        ],
    )
    def test_each_frozen_rule_gives_authoring_feedback_on_its_field(
        self, editor_client, overrides, field
    ):
        response = create_mountain(editor_client, **overrides)

        if field is None:
            assert response.status_code == 302
            return
        assert response.status_code == 200
        assert field in errors_of(response)
        assert not MountainRecord.objects.exists()

    def test_framing_without_a_camera_is_rejected(self, editor_client):
        response = create_mountain(
            editor_client,
            camera_heading_degrees="",
            camera_pitch_degrees="",
            camera_range_meters="",
        )

        assert response.status_code == 200
        assert errors_of(response)
        assert not MountainRecord.objects.exists()

    def test_a_draft_may_be_saved_without_camera_provenance_or_photograph(self, editor_client):
        response = create_mountain(
            editor_client,
            camera_heading_degrees="",
            camera_pitch_degrees="",
            camera_range_meters="",
            camera_framing_x="",
            camera_framing_y="",
            osm_type="",
            osm_id="",
            wikidata_id="",
        )

        assert response.status_code == 302
        assert MountainRecord.objects.get(slug="new-peak").camera_heading_degrees is None

    def test_a_duplicate_slug_is_a_form_error(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        response = create_mountain(editor_client, slug="aconcagua")

        assert response.status_code == 200
        assert "slug" in errors_of(response)
        assert MountainRecord.objects.count() == 1

    def test_an_incomplete_photograph_is_a_form_error(self, editor_client):
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **{"image-0-url": "https://upload.wikimedia.org/a.jpg", "image-0-width": "400"},
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert not MountainRecord.objects.exists()
        assert not MountainImageRecord.objects.exists()


class TestEditing:
    def test_frozen_fields_are_not_inputs_after_creation(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        names = input_names(editor_client.get(change_url(ACTIVE)))

        assert {"summary", "range_name", "countries", "prominence_meters", "wikipedia_url"} <= names
        frozen = {
            "slug",
            "name",
            "latitude",
            "longitude",
            "location",
            "elevation_meters",
            "status",
            "camera_heading_degrees",
            "camera_pitch_degrees",
            "camera_range_meters",
            "camera_framing_x",
            "camera_framing_y",
            "osm_type",
            "osm_id",
            "wikidata_id",
            "created_at",
            "updated_at",
            "image-0-url",
            "image-0-thumbnail_url",
            "image-0-width",
            "image-0-height",
            "image-0-source_page_url",
            "image-0-source_identifier",
            "image-0-license_reported",
            "image-0-license_election_basis_url",
            "image-0-approved_on",
        }
        assert names & frozen == set()

    def test_the_photograph_credit_stays_editable(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        names = input_names(editor_client.get(change_url(ACTIVE)))

        assert {
            "image-0-creator",
            "image-0-attribution",
            "image-0-license_name",
            "image-0-license_url",
        } <= names

    def test_frozen_values_are_shown_read_only(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        page = editor_client.get(change_url(ACTIVE))

        content = page.content.decode()
        assert "aconcagua" in content
        assert "-32.6531487" in content
        assert "6961" in content

    def test_editorial_fields_are_saved_and_frozen_ones_cannot_be_forged(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.filter(pk=ACTIVE.mountain.id).values().get()
        page = editor_client.get(change_url(ACTIVE))
        payload = form_payload(page, summary="Highest mountain in the Andes.", range_name="Andes")
        payload |= {
            "slug": "forged",
            "name": "Forged",
            "elevation_meters": "1",
            "latitude": "0",
            "longitude": "0",
            "status": "draft",
            "camera_heading_degrees": "1",
            "wikidata_id": "Q1",
            "image-0-url": "https://forged.example/a.jpg",
            "image-0-source_identifier": "File:forged.jpg",
        }

        response = editor_client.post(change_url(ACTIVE), payload)

        assert response.status_code == 302
        after = MountainRecord.objects.filter(pk=ACTIVE.mountain.id).values().get()
        changed = {name for name in before if before[name] != after[name]}
        assert changed == {"summary", "range_name", "updated_at"}
        image = MountainImageRecord.objects.get(pk=ACTIVE.mountain.id)
        assert image.url == ACTIVE.mountain.primary_image.url
        assert image.source_identifier == ACTIVE.mountain.primary_image.source_identifier

    def test_countries_prominence_and_wikipedia_url_are_editable(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                countries="Argentina, Chile",
                prominence_meters="0",
                wikipedia_url="https://en.wikipedia.org/wiki/Aconcagua_(mountain)",
            ),
        )

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert record.countries == ["Argentina", "Chile"]
        assert record.prominence_meters == 0
        assert record.wikipedia_url.endswith("Aconcagua_(mountain)")

    def test_optional_fields_can_be_cleared(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                summary="",
                range_name="",
                prominence_meters="",
                countries="",
                wikipedia_url="",
            ),
        )

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (record.summary, record.range_name, record.prominence_meters) == (None, None, None)
        assert (record.countries, record.wikipedia_url) == ([], None)

    def test_the_photograph_credit_is_saved(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                **{"image-0-creator": "New Creator", "image-0-attribution": "New Credit"},
            ),
        )

        image = MountainImageRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (image.creator, image.attribution) == ("New Creator", "New Credit")

    def test_saving_bumps_updated_at_and_records_history(self, editor_client, editor, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(change_url(ACTIVE), form_payload(page, summary="Highest in the Andes."))

        after = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert after.updated_at > before.updated_at
        assert after.created_at == before.created_at
        entry = LogEntry.objects.get()
        assert (entry.user, entry.object_repr) == (editor, "aconcagua")

    def test_a_photograph_edit_alone_bumps_updated_at(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        before = MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at
        page = editor_client.get(change_url(ACTIVE))

        editor_client.post(change_url(ACTIVE), form_payload(page, **{"image-0-creator": "Someone"}))

        assert MountainRecord.objects.get(pk=ACTIVE.mountain.id).updated_at > before

    def test_saving_does_not_overwrite_a_status_changed_after_the_row_was_read(
        self, publisher, load_catalog, rf
    ):
        load_catalog(DRAFT)
        stale = MountainRecord.objects.get(pk=DRAFT.mountain.id)
        MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(status="active")
        model_admin = admin_site().get_model_admin(MountainRecord)
        form = MountainChangeForm(
            {"summary": "Highest in the Andes.", "countries": "Argentina"}, instance=stale
        )
        assert form.is_valid()
        request = rf.post("/")
        request.user = publisher

        model_admin.save_model(request, form.save(commit=False), form, change=True)

        saved = MountainRecord.objects.get(pk=DRAFT.mountain.id)
        assert (saved.status, saved.summary) == ("active", "Highest in the Andes.")

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

        response = editor_client.post(change_url(ACTIVE), form_payload(page, summary=summary))

        assert response.status_code == 200
        assert "summary" in errors_of(response)
        assert (
            MountainRecord.objects.get(pk=ACTIVE.mountain.id).summary
            == "Highest mountain outside Asia."
        )

    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    def test_a_published_photograph_cannot_lose_what_publication_requires(
        self, editor_client, load_catalog, entry
    ):
        load_catalog(entry)
        page = editor_client.get(change_url(entry))

        response = editor_client.post(
            change_url(entry),
            form_payload(page, **{"image-0-license_name": "", "image-0-license_url": ""}),
        )

        assert response.status_code == 200
        image = MountainImageRecord.objects.get(pk=entry.mountain.id)
        assert image.license_name == entry.mountain.primary_image.license_name

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

    def test_a_viewer_without_change_permission_cannot_post(self, client, load_catalog, db):
        from django.contrib.auth.models import Permission, User

        load_catalog(ACTIVE)
        viewer = User.objects.create_user("viewer", is_staff=True)
        viewer.user_permissions.set(Permission.objects.filter(codename="view_mountainrecord"))
        client.force_login(viewer)

        response = client.post(change_url(ACTIVE), {"summary": "Highest in the Andes."})

        assert response.status_code == 403
        assert (
            MountainRecord.objects.get(pk=ACTIVE.mountain.id).summary
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

    def test_a_draft_with_a_photograph_needs_the_photograph_removed_first(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        delete_url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])

        blocked = editor_client.post(delete_url, {"post": "yes"})
        assert blocked.status_code == 200
        assert MountainRecord.objects.filter(pk=DRAFT.mountain.id).exists()

        page = editor_client.get(change_url(DRAFT))
        editor_client.post(change_url(DRAFT), form_payload(page, **{"image-0-DELETE": "on"}))
        assert not MountainImageRecord.objects.exists()

        assert editor_client.post(delete_url, {"post": "yes"}).status_code == 302
        assert not MountainRecord.objects.exists()

    def test_a_published_photograph_cannot_be_removed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)

        names = input_names(editor_client.get(change_url(ACTIVE)))

        assert "image-0-DELETE" not in names


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
