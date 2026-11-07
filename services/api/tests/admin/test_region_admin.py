import re
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import NoReverseMatch, reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.regions import region_id_for_slug
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from tests.admin.support import form_payload, input_names, photograph
from tests.support.catalog import catalog_mountain
from tests.support.regions import region_path

CHANGELIST_URL = reverse("admin:catalog_mountainrecord_changelist")
ADD_URL = reverse("admin:catalog_mountainrecord_add")

DEEP = catalog_mountain("deep-peak", region=region_path("Alpha Chain", "Beta Range", "Gamma Ridge"))
ROOT = catalog_mountain("root-peak", region=region_path("Zeta Chain"))
BARE = catalog_mountain("bare-peak", status=MountainStatus.DRAFT, region=None)


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def select_options(html, name):
    block = re.search(rf'<select name="{name}".*?</select>', html, re.S).group(0)

    return [
        (value, bool(chosen), label.replace("&rsaquo;", "›"))
        for value, chosen, label in re.findall(
            r'<option value="([^"]*)"( selected)?>([^<]*)</option>', block
        )
    ]


def stored(entry):
    return MountainRecord.objects.get(pk=entry.mountain.id)


def regions_by_slug():
    return {record.slug: record for record in MountainRegionRecord.objects.all()}


class TestTheSelector:
    def test_the_options_are_every_region_in_tree_order_labelled_with_its_path(
        self, editor_client, load_catalog
    ):
        load_catalog(DEEP, ROOT)

        options = select_options(editor_client.get(ADD_URL).content.decode(), "region")

        assert [label for _, _, label in options] == [
            "No region",
            "Alpha Chain",
            "Alpha Chain › Beta Range",
            "Alpha Chain › Beta Range › Gamma Ridge",
            "Zeta Chain",
        ]
        assert options[0][0] == ""

    def test_the_option_values_are_the_region_ids(self, editor_client, load_catalog):
        load_catalog(DEEP)

        options = select_options(editor_client.get(ADD_URL).content.decode(), "region")

        assert {value for value, _, _ in options[1:]} == {
            str(region_id_for_slug(slug)) for slug in ("alpha-chain", "beta-range", "gamma-ridge")
        }

    def test_the_form_selects_what_the_mountain_has(self, editor_client, load_catalog):
        load_catalog(DEEP, ROOT)

        options = select_options(editor_client.get(change_url(DEEP)).content.decode(), "region")

        assert [label for _, chosen, label in options if chosen] == [
            "Alpha Chain › Beta Range › Gamma Ridge"
        ]

    def test_a_mountain_without_a_region_selects_no_region(self, editor_client, load_catalog):
        load_catalog(BARE, ROOT)

        options = select_options(editor_client.get(change_url(BARE)).content.decode(), "region")

        assert [label for _, chosen, label in options if chosen] == ["No region"]

    def test_regions_with_one_path_are_told_apart_by_their_slug(self, editor_client, load_catalog):
        MountainRegionRecord.objects.create(slug="twin-north", name_en="Twin")
        MountainRegionRecord.objects.create(slug="twin-south", name_en="Twin")

        options = select_options(editor_client.get(ADD_URL).content.decode(), "region")

        assert [label for _, _, label in options[1:]] == [
            "Twin (twin-north)",
            "Twin (twin-south)",
        ]

    def test_the_form_reads_the_regions_with_one_query_whatever_their_number(
        self, editor_client, load_catalog
    ):
        load_catalog(ROOT)
        with CaptureQueriesContext(connection) as few:
            editor_client.get(ADD_URL)

        for number in range(40):
            MountainRegionRecord.objects.create(slug=f"extra-{number}", name_en=f"Extra {number}")
        with CaptureQueriesContext(connection) as many:
            editor_client.get(ADD_URL)

        assert len(many) == len(few)
        assert sum('FROM "mountain_region"' in q["sql"] for q in many) == 1

    def test_regions_have_no_admin_page_and_the_form_has_no_text_range(self, editor_client):
        with pytest.raises(NoReverseMatch):
            reverse("admin:catalog_mountainregionrecord_changelist")
        with pytest.raises(NoReverseMatch):
            reverse("admin:catalog_mountainregionrecord_add")

        names = input_names(editor_client.get(ADD_URL))
        assert "region" in names and "range_name" not in names


class TestSaving:
    def test_a_region_is_chosen_at_any_depth(self, editor_client, load_catalog):
        load_catalog(DEEP, BARE)
        slugs = ("alpha-chain", "beta-range", "gamma-ridge")

        for slug in slugs:
            page = editor_client.get(change_url(BARE))
            target = regions_by_slug()[slug]
            response = editor_client.post(
                change_url(BARE), form_payload(page, region=str(target.pk))
            )

            assert response.status_code == 302
            assert stored(BARE).region_id == target.pk

    def test_the_region_is_cleared_with_no_region(self, editor_client, load_catalog):
        load_catalog(DEEP)
        page = editor_client.get(change_url(DEEP))

        assert (
            editor_client.post(change_url(DEEP), form_payload(page, region="")).status_code == 302
        )

        assert stored(DEEP).region_id is None
        assert MountainRegionRecord.objects.count() == 3

    def test_a_region_that_does_not_exist_is_a_form_error_and_changes_nothing(
        self, editor_client, load_catalog
    ):
        load_catalog(DEEP)
        page = editor_client.get(change_url(DEEP))
        before = stored(DEEP).region_id

        response = editor_client.post(
            change_url(DEEP), form_payload(page, region=str(uuid.uuid4()))
        )

        assert response.status_code == 200
        assert "region" in response.context["adminform"].form.errors
        assert stored(DEEP).region_id == before

    def test_text_that_is_not_an_id_is_a_form_error(self, editor_client, load_catalog):
        load_catalog(DEEP)
        page = editor_client.get(change_url(DEEP))

        response = editor_client.post(change_url(DEEP), form_payload(page, region="Andes"))

        assert response.status_code == 200
        assert "region" in response.context["adminform"].form.errors

    def test_a_new_draft_may_have_a_region_or_none(self, editor_client, load_catalog):
        load_catalog(ROOT)
        target = regions_by_slug()["zeta-chain"]
        base = {
            "slug": "new-peak",
            "name_en": "New Peak",
            "latitude": "46.5",
            "longitude": "8.5",
            "elevation_meters": "3500",
            "continent": "EU",
        }

        with_region = form_payload(
            editor_client.get(ADD_URL), **base, region=str(target.pk), **photograph()
        )
        without = form_payload(
            editor_client.get(ADD_URL),
            **{**base, "slug": "other-peak"},
            region="",
            **photograph(),
        )

        assert editor_client.post(ADD_URL, with_region).status_code == 302
        assert editor_client.post(ADD_URL, without).status_code == 302
        assert MountainRecord.objects.get(slug="new-peak").region_id == target.pk
        assert MountainRecord.objects.get(slug="other-peak").region_id is None

    def test_saving_a_mountain_never_changes_the_regions(self, editor_client, load_catalog):
        load_catalog(DEEP, ROOT)
        before = list(
            MountainRegionRecord.objects.order_by("slug").values_list(
                "id", "slug", "parent_id", "name_en", "name_es", "name_pt", "wikidata_id"
            )
        )
        page = editor_client.get(change_url(DEEP))
        target = regions_by_slug()["zeta-chain"]

        editor_client.post(change_url(DEEP), form_payload(page, region=str(target.pk)))

        assert (
            list(
                MountainRegionRecord.objects.order_by("slug").values_list(
                    "id", "slug", "parent_id", "name_en", "name_es", "name_pt", "wikidata_id"
                )
            )
            == before
        )

    def test_a_viewer_cannot_change_the_region(self, viewer_client, load_catalog):
        load_catalog(DEEP, ROOT)
        target = regions_by_slug()["zeta-chain"]

        response = viewer_client.post(change_url(DEEP), {"region": str(target.pk)})

        assert response.status_code == 403
        assert stored(DEEP).region_id == region_id_for_slug("gamma-ridge")


class TestChangelist:
    def test_it_shows_the_region_and_its_nearest_ancestor(self, editor_client, load_catalog):
        load_catalog(DEEP, ROOT, BARE)

        html = editor_client.get(CHANGELIST_URL).content.decode()

        assert "Gamma Ridge, Beta Range" in html
        assert "Zeta Chain" in html
        assert "Alpha Chain, " not in html

    @pytest.mark.parametrize(
        ("term", "slugs"),
        [("gamma", ["deep-peak"]), ("zeta", ["root-peak"])],
    )
    def test_it_searches_by_english_region_name(self, editor_client, load_catalog, term, slugs):
        load_catalog(DEEP, ROOT, BARE)

        response = editor_client.get(CHANGELIST_URL, {"q": term})

        assert [row.slug for row in response.context["cl"].result_list] == slugs

    def test_the_number_of_queries_does_not_grow_with_the_mountains_or_their_regions(
        self, editor_client, load_catalog
    ):
        load_catalog(DEEP)
        with CaptureQueriesContext(connection) as few:
            editor_client.get(CHANGELIST_URL)

        template = MountainRecord.objects.first()
        for number in range(12):
            region = MountainRegionRecord.objects.create(
                slug=f"more-{number}",
                name_en=f"More {number}",
                parent=MountainRegionRecord.objects.get(slug="beta-range"),
            )
            MountainRecord.objects.create(
                slug=f"more-peak-{number}",
                name_en=f"More {number}",
                location=template.location,
                elevation_meters=1000,
                continent_id="SA",
                status="draft",
                region=region,
            )
        with CaptureQueriesContext(connection) as many:
            editor_client.get(CHANGELIST_URL)

        assert len(many) == len(few)


class TestViewOnly:
    def test_a_viewer_reads_the_whole_path_without_any_input(self, viewer_client, load_catalog):
        load_catalog(DEEP)

        response = viewer_client.get(change_url(DEEP))
        html = response.content.decode()

        assert "Alpha Chain › Beta Range › Gamma Ridge" in html.replace("&rsaquo;", "›")
        assert "region" not in input_names(response)

    def test_a_viewer_reads_that_a_mountain_has_no_region(self, viewer_client, load_catalog):
        load_catalog(BARE)

        html = viewer_client.get(change_url(BARE)).content.decode()

        assert re.search(r"Region:.*?None", html, re.S)
