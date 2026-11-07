import re

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import NoReverseMatch, reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.models import CountryRecord, MountainCountryRecord, MountainRecord
from tests.admin.support import form_payload, input_names, photograph
from tests.support.catalog import catalog_mountain
from tests.support.geography import continent, countries

CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")
ADD_URL = reverse("admin:catalog_mountainrecord_add")

ANDES = catalog_mountain("andean-peak", continent=continent("SA"), countries=countries("AR", "CL"))
DRAFT = catalog_mountain(
    "draft-peak", status=MountainStatus.DRAFT, continent=continent("AS"), countries=countries("NP")
)


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def linked(entry):
    return sorted(
        MountainCountryRecord.objects.filter(mountain_id=entry.mountain.id).values_list(
            "country_id", flat=True
        )
    )


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


def select_options(html, name):
    block = re.search(rf'<select name="{name}".*?</select>', html, re.S).group(0)

    return re.findall(r'<option value="([^"]*)"( selected)?>([^<]*)</option>', block)


class TestForms:
    def test_the_add_form_offers_the_seven_continents_in_name_order_and_a_prompt(
        self, editor_client
    ):
        html = editor_client.get(ADD_URL).content.decode()

        options = select_options(html, "continent")

        assert [(value, label) for value, _, label in options] == [
            ("", "Select a continent"),
            ("AF", "Africa"),
            ("AN", "Antarctica"),
            ("AS", "Asia"),
            ("EU", "Europe"),
            ("NA", "North America"),
            ("OC", "Oceania"),
            ("SA", "South America"),
        ]

    def test_the_countries_are_a_selection_over_the_249_entries_by_english_name(
        self, editor_client
    ):
        html = editor_client.get(ADD_URL).content.decode()

        options = select_options(html, "countries")

        assert len(options) == 249
        assert options[0][2] == "Afghanistan (AF)"
        assert ("AR", "", "Argentina (AR)") in options
        labels = [label for _, _, label in options]
        assert labels == sorted(labels)
        assert "FilteredSelectMultiple" not in html or "multiple" in html
        assert "SelectFilter2.js" in html

    def test_the_change_form_selects_what_the_mountain_has(self, editor_client, load_catalog):
        load_catalog(ANDES)

        html = editor_client.get(change_url(ANDES)).content.decode()

        selected = [value for value, chosen, _ in select_options(html, "countries") if chosen]
        assert selected == ["AR", "CL"]
        assert [v for v, chosen, _ in select_options(html, "continent") if chosen] == ["SA"]

    def test_the_form_has_no_translation_inputs(self, editor_client):
        names = input_names(editor_client.get(ADD_URL))

        assert {"name_en", "summary_en", "continent", "countries"} <= names
        assert not {n for n in names if n.endswith(("_es", "_pt"))}

    def test_labels_keep_name_and_summary(self, editor_client):
        html = editor_client.get(ADD_URL).content.decode()

        assert re.search(r'<label[^>]*for="id_name_en">Name:</label>', html)
        assert re.search(r'<label[^>]*for="id_summary_en">Summary:</label>', html)


class TestSaving:
    def test_a_continent_is_required_on_a_new_draft(self, editor_client):
        payload = form_payload(
            editor_client.get(ADD_URL),
            slug="new-peak",
            name_en="New Peak",
            latitude="46.5",
            longitude="8.5",
            elevation_meters="3500",
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert "continent" in response.context["adminform"].form.errors
        assert not MountainRecord.objects.exists()

    def test_the_continent_is_chosen_not_derived_from_the_countries(self, editor_client):
        payload = form_payload(
            editor_client.get(ADD_URL),
            slug="new-peak",
            name_en="New Peak",
            latitude="46.5",
            longitude="8.5",
            elevation_meters="3500",
            continent="OC",
            countries=["US", "CH"],
            **photograph(),
        )

        assert editor_client.post(ADD_URL, payload).status_code == 302
        record = MountainRecord.objects.get(slug="new-peak")
        assert record.continent_id == "OC"
        assert sorted(link.country_id for link in record.country_links.all()) == ["CH", "US"]

    def test_changing_the_continent_leaves_the_countries_alone(self, editor_client, load_catalog):
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        assert (
            editor_client.post(change_url(ANDES), form_payload(page, continent="NA")).status_code
            == 302
        )

        assert stored(ANDES).continent_id == "NA"
        assert linked(ANDES) == ["AR", "CL"]

    def test_only_the_links_that_differ_are_written(self, editor_client, load_catalog):
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        with CaptureQueriesContext(connection) as queries:
            editor_client.post(change_url(ANDES), form_payload(page, countries=["AR", "PE"]))

        statements = [q["sql"] for q in queries if "mountain_country" in q["sql"]]
        deletes = [sql for sql in statements if sql.startswith("DELETE")]
        inserts = [sql for sql in statements if sql.startswith("INSERT")]
        assert len(deletes) == len(inserts) == 1
        assert "'CL'" in deletes[0] and "AR" not in deletes[0]
        assert "PE" in inserts[0] or "'PE'" in inserts[0]
        assert linked(ANDES) == ["AR", "PE"]

    def test_saving_the_same_countries_writes_no_link(self, editor_client, load_catalog):
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        with CaptureQueriesContext(connection) as queries:
            editor_client.post(change_url(ANDES), form_payload(page, name_en="Renamed"))

        writes = [
            q["sql"]
            for q in queries
            if "mountain_country" in q["sql"] and q["sql"].startswith(("INSERT", "DELETE"))
        ]
        assert writes == []
        assert linked(ANDES) == ["AR", "CL"]

    def test_all_countries_can_be_removed(self, editor_client, load_catalog):
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        editor_client.post(change_url(ANDES), form_payload(page, countries=[]))

        assert linked(ANDES) == []

    def test_a_country_outside_the_reference_data_is_a_form_error(
        self, editor_client, load_catalog
    ):
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        response = editor_client.post(change_url(ANDES), form_payload(page, countries=["AR", "ZZ"]))

        assert response.status_code == 200
        assert "countries" in response.context["adminform"].form.errors
        assert linked(ANDES) == ["AR", "CL"]

    def test_the_links_change_with_the_mountain_or_not_at_all(self, editor_client, load_catalog):
        # A public mountain whose photograph credit is cleared is refused as a whole.
        load_catalog(ANDES)
        page = editor_client.get(change_url(ANDES))

        response = editor_client.post(
            change_url(ANDES),
            form_payload(page, countries=["PE"], continent="NA", **{"image-0-author": ""}),
        )

        assert response.status_code == 200
        assert linked(ANDES) == ["AR", "CL"]
        assert stored(ANDES).continent_id == "SA"

    def test_a_save_bumps_the_update_time_when_only_countries_changed(
        self, editor_client, load_catalog
    ):
        load_catalog(ANDES)
        before = stored(ANDES).updated_at
        page = editor_client.get(change_url(ANDES))

        editor_client.post(change_url(ANDES), form_payload(page, countries=["AR"]))

        assert stored(ANDES).updated_at > before


class TestListing:
    def test_the_changelist_shows_the_continent_and_the_country_codes(
        self, editor_client, load_catalog
    ):
        load_catalog(ANDES, DRAFT)

        response = editor_client.get(CHANGELIST_URL)

        html = response.content.decode()
        assert "column-continent" in html and "column-country_codes" in html
        assert "AR, CL" in html and "South America" in html
        assert "NP" in html and ">Asia<" in html

    @pytest.mark.parametrize(
        ("term", "slugs"),
        [("Argentina", ["andean-peak"]), ("chile", ["andean-peak"]), ("nepal", ["draft-peak"])],
    )
    def test_it_searches_by_english_country_name(self, editor_client, load_catalog, term, slugs):
        load_catalog(ANDES, DRAFT)

        response = editor_client.get(CHANGELIST_URL, {"q": term})

        assert [row.slug for row in response.context["cl"].result_list] == slugs

    def test_a_search_by_country_does_not_repeat_a_mountain_with_two_matches(
        self, editor_client, load_catalog
    ):
        load_catalog(ANDES)

        response = editor_client.get(CHANGELIST_URL, {"q": "a"})

        assert [row.slug for row in response.context["cl"].result_list] == ["andean-peak"]

    def test_the_number_of_queries_does_not_grow_with_the_mountains_or_their_countries(
        self, editor_client, load_catalog
    ):
        load_catalog(*(catalog_mountain(f"peak-{n}", countries=countries("AR")) for n in range(2)))
        with CaptureQueriesContext(connection) as few:
            editor_client.get(CHANGELIST_URL)

        template = MountainRecord.objects.first()
        for n in range(12):
            record = MountainRecord.objects.create(
                slug=f"more-{n}",
                name_en=f"More {n}",
                location=template.location,
                elevation_meters=1000,
                continent_id="SA",
                status="draft",
            )
            MountainCountryRecord.objects.bulk_create(
                MountainCountryRecord(mountain=record, country_id=code)
                for code in ("AR", "CL", "PE", "BO")
            )
        with CaptureQueriesContext(connection) as many:
            editor_client.get(CHANGELIST_URL)

        assert len(many) == len(few)


class TestReferenceDataIsNotEditorial:
    @pytest.mark.parametrize(
        "view", ["continentrecord_changelist", "countryrecord_changelist", "countryrecord_add"]
    )
    def test_no_admin_page_exists_for_continents_or_countries(self, editor_client, view):
        with pytest.raises(NoReverseMatch):
            reverse(f"admin:catalog_{view}")

    def test_the_links_have_no_admin_page_either(self):
        with pytest.raises(NoReverseMatch):
            reverse("admin:catalog_mountaincountryrecord_changelist")


class TestViewOnly:
    def test_a_viewer_reads_the_continent_and_countries_without_any_input(
        self, viewer_client, load_catalog
    ):
        load_catalog(ANDES)

        response = viewer_client.get(change_url(ANDES))

        html = response.content.decode()
        assert response.status_code == 200
        assert "South America" in html
        assert "Argentina (AR), Chile (CL)" in html
        assert '<select name="continent"' not in html
        assert '<select name="countries"' not in html

    def test_a_viewer_sees_none_for_a_mountain_without_countries(self, viewer_client, load_catalog):
        load_catalog(catalog_mountain("lonely-peak", countries=()))

        html = viewer_client.get(change_url(catalog_mountain("lonely-peak"))).content.decode()

        assert ">None<" in html

    def test_a_viewer_cannot_change_the_geography(self, viewer_client, load_catalog):
        load_catalog(ANDES)

        response = viewer_client.post(change_url(ANDES), {"continent": "NA", "countries": ["US"]})

        assert response.status_code == 403
        assert stored(ANDES).continent_id == "SA"
        assert linked(ANDES) == ["AR", "CL"]


class TestDraftDeletion:
    def test_the_confirmation_lists_the_countries_that_go_with_the_draft(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])

        page = editor_client.get(url)

        assert page.status_code == 200
        assert "Its links to the countries NP" in page.content.decode()

    def test_a_draft_with_countries_is_deleted_with_its_links_and_the_countries_stay(
        self, editor_client, load_catalog
    ):
        load_catalog(DRAFT)
        url = reverse("admin:catalog_mountainrecord_delete", args=[DRAFT.mountain.id])

        assert editor_client.post(url, {"post": "yes"}).status_code == 302

        assert not MountainRecord.objects.exists()
        assert not MountainCountryRecord.objects.exists()
        assert CountryRecord.objects.filter(code="NP").exists()
