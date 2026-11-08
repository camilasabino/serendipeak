import re
from html.parser import HTMLParser

import pytest
from django.contrib.staticfiles import finders
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.studio.support import form_payload, text_of, upload
from tests.support.catalog import catalog_mountain, catalog_seed

pytestmark = pytest.mark.usefixtures("media_store")

NEW_URL = reverse("studio:mountain_new")
EDIT_URL = reverse("studio:mountain_edit", args=["draft-peak"])
SCRIPTS = ("unsaved-changes.js", "photograph-upload.js", "country-filter.js")


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(
        catalog_seed(catalog_mountain("draft-peak", status=MountainStatus.DRAFT))
    )


class Elements(HTMLParser):
    """The controls, labels and ids of a page, to check how they are wired to each other."""

    def __init__(self):
        super().__init__()
        self.controls = []
        self.label_targets = set()
        self.ids = set()
        self.legends = 0
        self.fieldsets = 0
        self.scripts = []
        self.handlers = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.add(attributes["id"])
        self.handlers.extend(name for name in attributes if name.startswith("on"))
        if tag == "label" and "for" in attributes:
            self.label_targets.add(attributes["for"])
        elif tag in ("input", "select", "textarea") and attributes.get("type") not in (
            "hidden",
            "submit",
        ):
            self.controls.append(attributes)
        elif tag == "legend":
            self.legends += 1
        elif tag == "fieldset":
            self.fieldsets += 1
        elif tag == "script":
            self.scripts.append(attributes)


def elements(response):
    parser = Elements()
    parser.feed(text_of(response))

    return parser


def refused_page(client):
    page = client.get(EDIT_URL)

    return client.post(
        EDIT_URL, form_payload(page, name="", elevation_meters="0", **{"photograph-author": ""})
    )


@pytest.mark.parametrize("url", [NEW_URL, EDIT_URL], ids=["new", "edit"])
def test_every_control_has_a_label_and_a_unique_id(catalog, editor_client, url):
    page = elements(editor_client.get(url))

    for control in page.controls:
        assert control.get("id"), control
        assert control["id"] in page.label_targets, f"{control['id']} has no label"
        assert (control.get("aria-hidden") != "true") or control.get("type") != "hidden"
    ids = [control["id"] for control in page.controls]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("url", [NEW_URL, EDIT_URL], ids=["new", "edit"])
def test_the_form_has_one_h1_grouped_sections_and_a_submit_button(catalog, editor_client, url):
    body = text_of(editor_client.get(url))
    page = elements(editor_client.get(url))

    assert body.count("<h1") == 1
    assert page.fieldsets == page.legends >= 5
    assert re.search(r'<button class="button" type="submit"', body)
    assert 'method="post"' in body
    assert "novalidate" in body


@pytest.mark.parametrize("url", [NEW_URL, EDIT_URL], ids=["new", "edit"])
def test_required_fields_are_marked_and_optional_ones_say_so(catalog, editor_client, url):
    body = text_of(editor_client.get(url))

    for name in ("name", "slug", "elevation_meters", "latitude", "longitude", "continent"):
        assert re.search(rf'<(input|select)[^>]*name="{name}"[^>]*required', body), name
    for label in ("Region", "Summary", "Wikidata id", "OpenStreetMap node id", "Countries"):
        assert f'{label} <span class="field__optional">(optional)</span>' in body


def test_the_help_text_is_wired_to_its_control(catalog, editor_client):
    page = elements(editor_client.get(EDIT_URL))

    for control in page.controls:
        for described in control.get("aria-describedby", "").split():
            assert described in page.ids, f"{control['id']} points to a missing {described}"


def test_a_refused_form_marks_the_fields_in_error_and_wires_their_messages(catalog, editor_client):
    response = refused_page(editor_client)
    body = text_of(response)
    page = elements(response)

    assert response.status_code == 200
    assert 'class="error-summary" tabindex="-1" autofocus' in body
    assert 'aria-labelledby="error-summary-title"' in body
    invalid = [control for control in page.controls if control.get("aria-invalid") == "true"]
    assert {control["name"] for control in invalid} == {
        "name",
        "elevation_meters",
        "photograph-author",
    }
    for control in invalid:
        assert control["id"] in page.label_targets
        assert "errorlist" in body

    for target in re.findall(r'<li><a href="#([^"]+)">', body):
        assert target in page.ids, f"the error summary links to a missing #{target}"


def test_an_error_on_the_countries_links_to_the_group(catalog, editor_client):
    page = editor_client.get(EDIT_URL)
    response = editor_client.post(EDIT_URL, form_payload(page, countries=["ZZ"]))
    body = text_of(response)
    parsed = elements(response)

    [target] = re.findall(r'<li><a href="#([^"]+)">Countries:', body)
    assert target in parsed.ids


def test_the_country_checklist_is_a_labelled_group_that_works_without_a_script(
    catalog, editor_client
):
    body = text_of(editor_client.get(EDIT_URL))

    assert re.search(r'<fieldset class="field field--checklist[^"]*" id="id_countries"', body)
    assert '<legend class="field__label">Countries' in body
    assert "data-country-filter-controls hidden" in body
    assert body.count('<li class="checklist__item">') == 249


# Unsaved changes.


@pytest.mark.parametrize("url", [NEW_URL, EDIT_URL], ids=["new", "edit"])
def test_the_form_asks_for_the_unsaved_changes_guard_and_loads_only_its_own_scripts(
    catalog, editor_client, url
):
    response = editor_client.get(url)
    body = text_of(response)
    page = elements(response)

    assert "data-unsaved-guard" in body
    assert "data-unsaved-on-load" not in body
    assert [script["src"] for script in page.scripts] == [
        f"/static/studio/{name}" for name in ("theme.js", *SCRIPTS)
    ]
    assert all("defer" in script for script in page.scripts if "theme.js" not in script["src"])
    assert not [script for script in page.scripts if "src" not in script], "no inline script"
    assert page.handlers == [], "no inline event handler"


def test_a_form_that_comes_back_refused_counts_as_unsaved_from_the_start(catalog, editor_client):
    assert "data-unsaved-on-load" in text_of(refused_page(editor_client))


def test_the_guard_does_not_cover_pages_without_edits(catalog, editor_client):
    for name, args in (("mountain_detail", ["draft-peak"]), ("mountain_list", [])):
        body = text_of(editor_client.get(reverse(f"studio:{name}", args=args)))

        assert "data-unsaved-guard" not in body
        assert not re.search(r"<script(?![^>]*\ssrc=)", body)


@pytest.mark.parametrize("name", SCRIPTS)
def test_the_scripts_are_shipped_with_the_studio(name):
    path = finders.find(f"studio/{name}")

    assert path is not None
    source = open(path, encoding="utf-8").read()
    assert source.startswith('"use strict";')
    assert "eval(" not in source
    assert "innerHTML" not in source


def test_the_unsaved_changes_script_listens_for_leaving_and_for_a_second_submission():
    source = open(finders.find("studio/unsaved-changes.js"), encoding="utf-8").read()

    assert 'addEventListener("beforeunload"' in source
    assert "data-unsaved-guard" in source
    assert "data-unsaved-on-load" in source
    assert "submitting" in source


def test_the_photograph_card_keeps_a_chosen_file_only_in_the_browser(catalog, editor_client):
    response = editor_client.get(EDIT_URL)
    body = text_of(response)

    assert 'class="form-section photograph-card"' in body
    assert "data-photograph-file" in body
    assert "data-photograph-selected hidden" in body
    assert "data-photograph-cancel" in body
    assert "data-credit-review" in body
    source = open(finders.find("studio/photograph-upload.js"), encoding="utf-8").read()
    assert "indexedDB" in source
    assert "fetch(" not in source and "XMLHttpRequest" not in source


def test_a_refused_credit_review_stays_visible_without_a_chosen_file(catalog, editor_client):
    page = editor_client.get(EDIT_URL)
    response = editor_client.post(EDIT_URL, form_payload(page, **{"photograph-file": upload()}))

    assert "data-credit-review-invalid" in text_of(response)


# Cost.


def queries(client, url):
    with CaptureQueriesContext(connection) as captured:
        assert client.get(url).status_code == 200

    return len(captured)


def test_the_creation_page_costs_the_session_and_three_reads_of_reference_data(
    catalog, editor_client
):
    assert queries(editor_client, NEW_URL) == 2 + 3


def test_the_edit_page_costs_the_session_the_mountain_and_the_reference_data(
    catalog, editor_client
):
    assert queries(editor_client, EDIT_URL) == 2 + 3 + 3
