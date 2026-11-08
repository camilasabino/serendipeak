import re

import pytest
from django.conf import settings
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from serendipeak.catalog.bootstrap.ports import CatalogMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import RegionPath, RegionRef
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.studio.support import text_of
from tests.support.catalog import (
    CREATED_AT,
    UPDATED_AT,
    bare_mountain,
    catalog_mountain,
    catalog_seed,
    photograph_media,
    primary_image,
)
from tests.support.geography import continent, countries
from tests.support.regions import region_path

LIST_URL = reverse("studio:mountain_list")
MEDIA = settings.MEDIA_PUBLIC_BASE_URL


def detail_url(slug):
    return reverse("studio:mountain_detail", kwargs={"slug": slug})


def load(*entries):
    DjangoCatalogStore().load(catalog_seed(*entries))


def draft(slug="draft-peak", **overrides):
    return catalog_mountain(slug, status=MountainStatus.DRAFT, **overrides)


def row_of(body, slug):
    match = re.search(
        rf'<li class="mountain-row">(?:(?!</li>\s*<li class="mountain-row">).)*?'
        rf'href="/studio/mountains/{slug}/".*?</li>\s*(?=<li class="mountain-row">|</ul>)',
        body,
        re.S,
    )

    return match.group(0)


@pytest.fixture
def catalog(db):
    load(
        catalog_mountain(
            "aconcagua",
            region=region_path("Andes", "Southern Andes", "Central Andes"),
            countries=countries("AR", "CL"),
        ),
        catalog_mountain("old-peak", status=MountainStatus.INACTIVE, primary_image=None),
        draft("ready-draft"),
        draft("blocked-draft", camera=None, primary_image=None),
    )


def test_a_viewer_and_an_editor_read_the_list(catalog, viewer_client, editor_client):
    for client in (viewer_client, editor_client):
        response = client.get(LIST_URL)

        assert response.status_code == 200
        assert "<title>Mountains · SerendiPeak Admin</title>" in text_of(response)


def test_the_list_is_marked_in_the_navigation_and_is_one_h1_plus_one_h2_per_mountain(
    catalog, viewer_client
):
    body = text_of(viewer_client.get(LIST_URL))

    assert 'href="/studio/mountains/" aria-current="page">Mountains</a>' in body
    assert body.count("<h1") == 1
    assert body.count('<h2 class="mountain-row__name">') == 4


def test_mountains_are_listed_by_name(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL))

    names = re.findall(r'<h2 class="mountain-row__name"><a href="[^"]+">([^<]+)</a>', body)

    assert names == ["Aconcagua", "Blocked Draft", "Old Peak", "Ready Draft"]


def test_each_row_shows_status_region_countries_and_elevation(catalog, viewer_client):
    row = row_of(text_of(viewer_client.get(LIST_URL)), "aconcagua")

    assert '<span class="status status--published">Published</span>' in row
    assert "South America · Southern Andes › Central Andes" in row
    assert "Argentina, Chile" in row
    assert "6961 m" in row
    assert ">aconcagua</p>" in row


def test_a_row_without_a_region_or_country_says_so_without_inventing_one(db, viewer_client):
    load(CatalogMountain(mountain=bare_mountain(), created_at=CREATED_AT, updated_at=UPDATED_AT))

    row = row_of(text_of(viewer_client.get(LIST_URL)), "bare-peak")

    assert "No country" in row
    assert "No photograph" in row
    assert " · " not in row.split("mountain-row__place")[1].split("</p>")[0].replace("Europe", "")


def test_the_thumbnail_is_the_page_rendition_with_empty_alt_and_lazy_loading(
    catalog, viewer_client
):
    row = row_of(text_of(viewer_client.get(LIST_URL)), "aconcagua")

    page_key = photograph_media().page_key
    assert f'src="{MEDIA}/{page_key}" alt="" width="96" height="72" loading="lazy"' in row
    assert "No photograph" not in row


def test_a_mountain_without_a_photograph_shows_a_placeholder(catalog, viewer_client):
    row = row_of(text_of(viewer_client.get(LIST_URL)), "old-peak")

    assert "<img" not in row
    assert "No photograph" in row


def test_a_photograph_whose_file_is_not_stored_yet_shows_the_placeholder(db, viewer_client):
    load(draft("waiting", primary_image=primary_image(media=None)))

    assert "No photograph" in row_of(text_of(viewer_client.get(LIST_URL)), "waiting")


def test_a_draft_shows_whether_it_is_ready_and_what_blocks_it(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL))

    assert "Ready to publish" in row_of(body, "ready-draft")
    blocked = row_of(body, "blocked-draft")
    assert "Not ready: 2 issues" in blocked
    assert "<li>The camera is missing.</li>" in blocked
    assert "<li>The photograph is missing.</li>" in blocked


def test_published_and_unlisted_mountains_show_no_readiness(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL))

    for slug in ("aconcagua", "old-peak"):
        assert "readiness" not in row_of(body, slug)


def test_the_status_chips_carry_counts_and_mark_the_current_filter(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL, {"status": "draft"}))

    chips = re.findall(
        r'<a class="chip" href="([^"]*)"( aria-current="true")?>(\w+) '
        r'<span class="chip__count numeric">(\d+)',
        body,
    )

    assert chips == [
        ("/studio/mountains/", "", "All", "4"),
        ("/studio/mountains/?status=draft", ' aria-current="true"', "Draft", "2"),
        ("/studio/mountains/?status=published", "", "Published", "1"),
        ("/studio/mountains/?status=unlisted", "", "Unlisted", "1"),
    ]


@pytest.mark.parametrize(
    ("status", "slugs"),
    [
        ("draft", ["blocked-draft", "ready-draft"]),
        ("published", ["aconcagua"]),
        ("unlisted", ["old-peak"]),
        ("nonsense", ["aconcagua", "blocked-draft", "old-peak", "ready-draft"]),
        ("", ["aconcagua", "blocked-draft", "old-peak", "ready-draft"]),
    ],
)
def test_the_status_filter_keeps_one_status_and_ignores_an_unknown_value(
    catalog, viewer_client, status, slugs
):
    body = text_of(viewer_client.get(LIST_URL, {"status": status}))

    assert re.findall(r'href="/studio/mountains/([^/"]+)/"', body) == slugs


def test_search_matches_the_name_or_the_slug_and_keeps_the_filter(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL, {"q": "draft", "status": "draft"}))

    assert re.findall(r'href="/studio/mountains/([^/"]+)/"', body) == [
        "blocked-draft",
        "ready-draft",
    ]
    assert 'value="draft"' in body
    assert '<input type="hidden" name="status" value="draft">' in body
    assert "Showing 2 of 2 mountains matching “draft”." in body
    assert 'href="/studio/mountains/?q=draft&amp;status=published"' in body


def test_the_search_field_has_a_label_and_the_form_is_a_search_landmark(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL))

    assert 'role="search"' in body
    assert re.search(
        r'<label class="field__label" for="mountain-search">Search by name or slug', body
    )
    assert 'id="mountain-search" name="q" type="search"' in body


def test_a_search_with_markup_is_escaped(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL, {"q": '"><script>alert(1)</script>'}))

    assert "<script>alert(1)" not in body
    assert "&lt;script&gt;" in body
    assert "No mountains match" in body


def test_no_match_offers_a_way_back(catalog, viewer_client):
    body = text_of(viewer_client.get(LIST_URL, {"q": "zzz"}))

    assert "No mountains match" in body
    assert "Show all mountains</a>" in body
    assert 'mountain-row"' not in body


def test_an_empty_catalog_says_so(db, viewer_client):
    response = viewer_client.get(LIST_URL)
    body = text_of(response)

    assert response.status_code == 200
    assert "The catalog is empty" in body
    assert "No mountains match" not in body


def test_a_very_long_search_is_accepted_and_cut(catalog, viewer_client):
    response = viewer_client.get(LIST_URL, {"q": "x" * 5000})

    assert response.status_code == 200
    assert 'value="' + "x" * 100 + '"' in text_of(response)


def test_long_names_stay_inside_their_row(db, viewer_client):
    load(
        catalog_mountain(
            "long-one",
            name=LocalizedText(en="Pico " + "Extraordinariamente" * 8),
            region=region_path("Cordillera " + "Septentrional" * 6, "Macizo " + "Oriental" * 8),
        )
    )

    response = viewer_client.get(LIST_URL)

    assert response.status_code == 200
    assert "Extraordinariamente" * 8 in text_of(response)


def query_count(client, url):
    with CaptureQueriesContext(connection) as captured:
        assert client.get(url).status_code == 200

    return len(captured)


@pytest.mark.parametrize("count", [1, 15])
def test_the_list_costs_the_same_queries_for_one_mountain_and_for_many(db, viewer_client, count):
    load(
        *(
            catalog_mountain(f"peak-{index}", region=region_path("A", f"B{index}"))
            for index in range(count)
        )
    )

    # The session, the user and the three reads of the catalog.
    assert query_count(viewer_client, LIST_URL) == 5


def test_the_list_is_private_and_not_indexed(catalog, viewer_client):
    response = viewer_client.get(LIST_URL)

    assert (
        response.headers["Cache-Control"]
        == "max-age=0, no-cache, no-store, must-revalidate, private"
    )
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"


def test_the_list_offers_no_way_to_change_the_catalog(catalog, editor_client):
    body = text_of(editor_client.get(LIST_URL))

    assert re.findall(r"<button[^>]*>([^<]+)</button>", body) == ["Sign out", "Search"]
    assert re.findall(r'<form[^>]*method="(\w+)"', body) == ["post", "get"]


# Detail


def test_the_detail_shows_the_content_geography_photograph_and_camera(catalog, viewer_client):
    response = viewer_client.get(detail_url("aconcagua"))
    body = text_of(response)

    assert response.status_code == 200
    assert "<title>Aconcagua · SerendiPeak Admin</title>" in body
    assert body.count("<h1") == 1
    assert "Highest mountain outside Asia." in body
    assert "6961 m" in body
    assert "-32.65315, -70.01196" in body
    assert "South America" in body
    assert "Argentina" in body and "Chile" in body
    assert "<li>Andes</li><li>Southern Andes</li><li>Central Andes</li>" in body.replace(
        "\n", ""
    ).replace("\t", "")
    assert '<dt>Heading</dt><dd class="numeric">66.87°</dd>' in body
    assert '<dt>Range</dt><dd class="numeric">17,132 m</dd>' in body
    assert "x -0.0587, y 0.3857" in body
    assert "Bjørn Christian Tørrissen" in body
    assert f'src="{MEDIA}/{photograph_media().page_key}" alt="Photograph of Aconcagua"' in body
    assert 'width="4994" height="2758"' in body
    assert "CC BY-SA 4.0" in body
    assert 'href="https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg"' in body
    assert 'href="https://www.wikidata.org/wiki/Q39739"' in body


def test_the_detail_keeps_the_mountains_item_marked_in_the_navigation(catalog, viewer_client):
    body = text_of(viewer_client.get(detail_url("aconcagua")))

    assert 'href="/studio/mountains/" aria-current="page">Mountains</a>' in body
    assert 'aria-label="Breadcrumb"' in body


def test_external_links_open_in_a_new_tab_without_opener_access(catalog, viewer_client):
    body = text_of(viewer_client.get(detail_url("aconcagua")))

    links = re.findall(r'<a [^>]*target="_blank"[^>]*>', body)
    assert links
    for link in links:
        assert 'rel="noopener"' in link


@pytest.mark.parametrize(
    ("slug", "visible"),
    [("aconcagua", True), ("old-peak", True), ("ready-draft", False)],
)
def test_view_on_site_is_offered_only_for_published_and_unlisted_mountains(
    catalog, viewer_client, slug, visible
):
    body = text_of(viewer_client.get(detail_url(slug)))

    link = (
        f'href="{settings.WEB_ORIGIN}/mountains/{slug}" target="_blank" rel="noopener">View on site'
    )
    assert (link in body) is visible


@pytest.mark.parametrize(
    ("slug", "label"),
    [("aconcagua", "Published"), ("old-peak", "Unlisted"), ("ready-draft", "Draft")],
)
def test_the_detail_names_the_status_and_what_it_means(catalog, viewer_client, slug, label):
    body = text_of(viewer_client.get(detail_url(slug)))

    assert f'status--{label.lower()}">{label}</span>' in body
    assert '<p class="panel__note">' in body


def test_a_ready_draft_says_so(catalog, viewer_client):
    assert "Ready to publish" in text_of(viewer_client.get(detail_url("ready-draft")))


def test_a_blocked_draft_lists_every_reason(catalog, viewer_client):
    body = text_of(viewer_client.get(detail_url("blocked-draft")))

    assert "Not ready to publish" in body
    assert "<li>The camera is missing.</li>" in body
    assert "<li>The photograph is missing.</li>" in body
    assert "No camera has been saved for this mountain." in body
    assert "This mountain has no photograph." in body


def test_a_public_mountain_meets_the_rules_or_the_page_says_it_does_not(catalog, viewer_client):
    assert "Meets the publication rules" in text_of(viewer_client.get(detail_url("aconcagua")))


def test_missing_optional_fields_are_shown_as_absent_not_as_blanks(db, viewer_client):
    load(CatalogMountain(mountain=bare_mountain(), created_at=CREATED_AT, updated_at=UPDATED_AT))

    response = viewer_client.get(detail_url("bare-peak"))
    body = text_of(response)

    assert response.status_code == 200
    assert "No summary yet." in body
    assert "No country" in body
    assert "No region" in body
    assert body.count("None</span>") == 2
    assert "This mountain has no photograph." in body
    assert "No camera has been saved" in body


def test_the_license_and_source_are_plain_text_when_they_have_no_link(db, viewer_client):
    load(
        catalog_mountain(
            "plain-credit",
            primary_image=primary_image(license_name=None, license_url=None, source_page_url=None),
        )
    )

    body = text_of(viewer_client.get(detail_url("plain-credit")))

    assert body.count("Not stated") == 2


def test_translations_are_shown_in_their_language_for_text_and_geography(db, viewer_client):
    alps = RegionRef(slug="alps", name=LocalizedText(en="Alps", es="Alpes", pt="Alpes"))
    massif = RegionRef(slug="mont-blanc-massif", name=LocalizedText(en="Mont Blanc Massif"))
    load(
        catalog_mountain(
            "mont-blanc",
            name=LocalizedText(en="Mont Blanc", es="Montblanc", pt="Monte Branco"),
            summary=LocalizedText(en="Highest in the Alps.", es="La más alta de los Alpes."),
            continent=continent("EU"),
            countries=countries("FR", "IT"),
            region=RegionPath(region=massif, ancestors=(alps,)),
        )
    )

    body = text_of(viewer_client.get(detail_url("mont-blanc")))

    assert '<span lang="es">Montblanc</span>' in body
    assert '<span lang="pt">Monte Branco</span>' in body
    assert '<span lang="es">La más alta de los Alpes.</span>' in body
    assert '<span lang="pt">La más' not in body
    assert '<span lang="es">Europa</span>' in body
    assert '<span lang="es">Francia</span>' in body
    assert '<span lang="pt">Itália</span>' in body
    assert '<span lang="es">Alpes › Mont Blanc Massif</span>' in body


def test_a_region_without_any_translation_adds_no_translated_path(db, viewer_client):
    load(catalog_mountain("plain-region", region=region_path("Alps", "Pennine Alps")))

    body = text_of(viewer_client.get(detail_url("plain-region")))

    assert "Pennine Alps" in body
    assert 'lang="es">Alps' not in body


def test_very_long_geographic_names_render(db, viewer_client):
    long_chain = "Cordillera " + "Septentrional " * 12
    load(
        catalog_mountain(
            "long-names",
            name=LocalizedText(en="Pico " + "Extraordinariamente" * 10),
            region=region_path(long_chain, "Macizo " + "Oriental" * 10),
        )
    )

    response = viewer_client.get(detail_url("long-names"))

    assert response.status_code == 200
    assert long_chain.strip() in text_of(response)


@pytest.mark.parametrize("slug", ["no-such-peak", "UPPER", "a" * 300, "%00", "with space"])
def test_an_unknown_mountain_is_a_404_inside_the_shell(catalog, viewer_client, slug):
    response = viewer_client.get(f"/studio/mountains/{slug}/")
    body = text_of(response)

    assert response.status_code == 404
    assert "Mountain not found" in body
    assert 'class="app-nav"' in body
    assert 'href="/studio/mountains/">Back to the mountains' in body


def test_a_mountain_name_with_markup_is_escaped(db, viewer_client):
    load(catalog_mountain("tricky", name=LocalizedText(en="<img src=x onerror=alert(1)>")))

    body = text_of(viewer_client.get(detail_url("tricky")))

    assert "<img src=x" not in body
    assert "&lt;img src=x onerror=alert(1)&gt;" in body


def test_the_detail_costs_two_queries_for_the_session_and_three_for_the_mountain(
    catalog, viewer_client
):
    assert query_count(viewer_client, detail_url("aconcagua")) == 5


def test_a_viewers_detail_has_no_forms_or_change_controls(catalog, viewer_client):
    body = text_of(viewer_client.get(detail_url("ready-draft")))

    assert re.findall(r"<button[^>]*>([^<]+)</button>", body) == ["Sign out"]
    assert len(re.findall(r"<form", body)) == 1
