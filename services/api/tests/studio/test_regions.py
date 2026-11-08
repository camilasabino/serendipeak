import re

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from tests.studio.region_support import LIST_URL, detail_url, seed
from tests.studio.support import text_of
from tests.support.region_taxonomy import TAXONOMY, region

MOUNTAINS = (
    ("glacier-peak", "glacier-group", "active"),
    ("hidden-peak", "glacier-group", "draft"),
    ("andes-peak", "andes", "inactive"),
    ("annapurna-i", "annapurna", "active"),
)


@pytest.fixture
def taxonomy(db):
    seed(mountains=MOUNTAINS)


def node_of(body, slug):
    match = re.search(
        rf'<li class="region-node[^"]*">(?:(?!<li class="region-node).)*?'
        rf'href="/studio/regions/{slug}/".*?(?=<li class="region-node|</ul>\s*</main>)',
        body,
        re.S,
    )

    return match.group(0)


def balanced(body):
    for tag in ("ul", "li", "details"):
        assert len(re.findall(rf"<{tag}[\s>]", body)) == body.count(f"</{tag}>"), tag


class TestList:
    def test_a_viewer_and_an_editor_read_it(self, taxonomy, viewer_client, editor_client):
        for client in (viewer_client, editor_client):
            response = client.get(LIST_URL)

            assert response.status_code == 200
            assert "<title>Regions · SerendiPeak Admin</title>" in text_of(response)

    def test_the_section_is_in_the_navigation_and_marked_on_its_pages(
        self, taxonomy, viewer_client
    ):
        for url in (LIST_URL, detail_url("andes")):
            body = text_of(viewer_client.get(url))

            assert re.search(
                r'<a class="app-nav__link" href="/studio/regions/" aria-current="page">Regions</a>',
                body,
            )

    def test_the_tree_is_nested_in_order_with_balanced_markup(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(LIST_URL))

        slugs = re.findall(r'class="region-node__name" href="/studio/regions/([^/]+)/"', body)
        assert slugs == [
            "andes",
            "cordillera-blanca",
            "glacier-group",
            "patagonian-andes",
            "himalayas",
            "annapurna",
            "lone-range",
        ]
        assert body.count("<details") == 3
        assert body.count('<ul class="region-tree__children">') == 3
        balanced(body)
        assert body.count("<h1") == 1

    def test_parents_are_collapsed_without_a_search(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(LIST_URL))

        assert '<details class="region-node__details">' in body
        assert '<details class="region-node__details" open>' not in body

    def test_each_node_shows_names_slug_wikidata_and_both_counts(self, taxonomy, editor_client):
        body = text_of(editor_client.get(LIST_URL))
        andes = node_of(body, "andes")

        assert '<span class="region-node__slug">andes</span>' in andes
        assert 'href="https://www.wikidata.org/wiki/Q5456"' in andes
        assert 'target="_blank" rel="noopener"' in andes
        assert '<span class="numeric">1</span> direct' in andes
        assert '<span class="numeric">3</span> in total' in andes
        assert '<span class="numeric">2</span> child regions' in andes
        lone = node_of(body, "lone-range")
        assert '<span class="numeric">0</span> in total' in lone
        assert "wikidata.org" not in lone

    def test_translated_names_are_shown_with_their_language(self, db, viewer_client):
        seed([region("andes", "Andes", es="Los Andes", pt="Os Andes")])

        body = text_of(viewer_client.get(LIST_URL))

        assert '<span lang="es">Los Andes</span>' in body
        assert '<span lang="pt">Os Andes</span>' in body

    def test_names_are_escaped(self, db, viewer_client):
        seed([region("tricky", "<script>alert(1)</script>")])

        body = text_of(viewer_client.get(LIST_URL))

        assert "<script>alert(1)</script>" not in body
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body

    def test_only_an_editor_is_offered_the_creation_link(
        self, taxonomy, viewer_client, editor_client
    ):
        assert "New region" not in text_of(viewer_client.get(LIST_URL))
        assert 'href="/studio/new-region/"' in text_of(editor_client.get(LIST_URL))

    def test_an_empty_taxonomy_invites_the_first_region(self, db, editor_client, viewer_client):
        assert "There are no regions yet" in text_of(editor_client.get(LIST_URL))
        assert "New region" not in text_of(viewer_client.get(LIST_URL))

    def test_regions_with_the_same_name_are_told_apart_in_every_label(self, db, viewer_client):
        seed(
            [
                region("sierra-nevada-us", "Sierra Nevada"),
                region("sierra-nevada-es", "Sierra Nevada"),
            ]
        )

        body = text_of(viewer_client.get(LIST_URL))

        assert body.count('<span class="region-node__slug">sierra-nevada-us</span>') == 1
        assert body.count('<span class="region-node__slug">sierra-nevada-es</span>') == 1
        assert body.count(">Sierra Nevada</a>") == 2

    def test_a_long_name_and_a_deep_chain_render_completely(self, db, viewer_client):
        chain = [region("level-0", "Cordillera " + "Septentrional" * 12)]
        chain += [
            region(
                f"level-{index}", f"Macizo {'Oriental' * 6} {index}", parent=f"level-{index - 1}"
            )
            for index in range(1, 40)
        ]
        seed(chain)

        body = text_of(viewer_client.get(LIST_URL))

        assert body.count('class="region-node__name"') == 40
        assert "Septentrional" * 12 in body
        balanced(body)


class TestSearch:
    def test_it_finds_a_region_in_any_language_keeping_its_ancestors_open(self, db, viewer_client):
        seed(
            [
                *TAXONOMY,
                region("cordillera-real", "Cordillera Real", parent="andes", pt="Cordilheira Real"),
            ]
        )

        response = viewer_client.get(LIST_URL, {"q": "cordilheira"})
        body = text_of(response)

        assert re.findall(r'class="region-node__name" href="/studio/regions/([^/]+)/"', body) == [
            "andes",
            "cordillera-real",
        ]
        assert '<details class="region-node__details" open>' in body
        assert "region-node region-node--match" in body
        assert "1 region matches “cordilheira”, shown with the regions above it." in body
        balanced(body)

    def test_it_matches_the_slug_and_ignores_accents_and_case(self, taxonomy, viewer_client):
        by_slug = text_of(viewer_client.get(LIST_URL, {"q": "LONE-RANGE"}))
        by_name = text_of(viewer_client.get(LIST_URL, {"q": "pátagonian"}))

        assert 'href="/studio/regions/lone-range/"' in by_slug
        assert 'href="/studio/regions/patagonian-andes/"' in by_name

    def test_a_search_without_matches_says_so(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(LIST_URL, {"q": "atlantis"}))

        assert "No regions match" in body
        assert "region-tree" not in body

    def test_the_search_text_is_escaped_and_bounded(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(LIST_URL, {"q": '"><script>x</script>' + "a" * 500}))

        assert "<script>x</script>" not in body
        assert body.count("a" * 101) == 0


class TestDetail:
    def test_it_shows_the_place_the_counts_and_the_two_groups_of_mountains(
        self, taxonomy, viewer_client
    ):
        body = text_of(viewer_client.get(detail_url("andes")))

        assert "<title>Andes · SerendiPeak Admin</title>" in body
        assert body.count("<h1") == 1
        assert "Directly in this region" in body
        direct = body.split('id="direct-title"')[1].split('id="descendants-title"')[0]
        assert "Andes Peak" in direct and "Glacier Peak" not in direct
        below = body.split('id="descendants-title"')[1]
        assert "Cordillera Blanca › Glacier Group" in below
        assert "Glacier Peak" in below and "Hidden Peak" in below
        assert "Annapurna I" not in body
        assert 'href="/studio/mountains/glacier-peak/"' in body

    def test_a_status_badge_accompanies_every_mountain(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(detail_url("glacier-group")))

        assert 'status status--published">Published' in body
        assert 'status status--draft">Draft' in body

    def test_the_breadcrumb_and_the_path_link_every_ancestor(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(detail_url("glacier-group")))

        assert '<a href="/studio/regions/andes/">Andes</a>' in body
        assert '<a href="/studio/regions/cordillera-blanca/">Cordillera Blanca</a>' in body
        assert '<span aria-current="page">Glacier Group</span>' in body
        assert 'Level</dt><dd class="numeric">3</dd>' in body

    def test_the_counts_distinguish_direct_from_total(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(detail_url("cordillera-blanca")))

        assert 'Mountains directly in this region</dt><dd class="numeric">0</dd>' in body
        assert 'Mountains in total, with every region below</dt><dd class="numeric">2</dd>' in body
        assert 'Child regions</dt><dd class="numeric">1</dd>' in body
        assert "No mountain points at this region itself." in body

    def test_children_link_to_their_pages_with_their_counts(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(detail_url("andes")))

        assert 'href="/studio/regions/patagonian-andes/"' in body
        assert 'href="/studio/regions/cordillera-blanca/"' in body

    def test_a_viewer_sees_no_write_links_and_an_editor_sees_all_of_them(
        self, taxonomy, viewer_client, editor_client
    ):
        viewed = text_of(viewer_client.get(detail_url("andes")))
        edited = text_of(editor_client.get(detail_url("andes")))

        for fragment in (
            "/edit/",
            "/move/",
            "/delete/",
            "new-region",
            "/studio/mountains/andes-peak/edit/",
        ):
            assert fragment not in viewed
            assert fragment in edited
        assert "?parent=andes" in edited

    def test_the_wikidata_link_opens_in_a_new_tab_and_a_missing_one_says_none(
        self, taxonomy, viewer_client
    ):
        with_item = text_of(viewer_client.get(detail_url("andes")))
        without = text_of(viewer_client.get(detail_url("lone-range")))

        assert (
            'href="https://www.wikidata.org/wiki/Q5456" target="_blank" rel="noopener"' in with_item
        )
        assert "None</span>" in without

    def test_an_empty_region_explains_why_it_has_no_groups(self, taxonomy, viewer_client):
        body = text_of(viewer_client.get(detail_url("lone-range")))

        assert "This region has no child regions." in body
        assert "This region has no regions below it." in body

    @pytest.mark.parametrize("slug", ["no-such-range", "Not A Slug", "today", "nul%00"])
    def test_an_unknown_or_malformed_address_is_a_404_in_the_studio(
        self, taxonomy, viewer_client, slug
    ):
        response = viewer_client.get(f"/studio/regions/{slug}/")

        assert response.status_code == 404
        assert "Region not found" in text_of(response)


class TestQueries:
    def count(self, client, url):
        with CaptureQueriesContext(connection) as captured:
            response = client.get(url)

        assert response.status_code == 200
        return len(captured), [q["sql"] for q in captured.captured_queries]

    def populate(self, regions, mountains_per_region):
        seed(
            [
                region(
                    f"node-{index}",
                    f"Node {index}",
                    parent=None if index == 0 else f"node-{(index - 1) // 3}",
                )
                for index in range(regions)
            ],
            [
                (f"peak-{index}-{number}", f"node-{index}", "active")
                for index in range(regions)
                for number in range(mountains_per_region)
            ],
        )

    @pytest.mark.parametrize(("regions", "mountains"), [(1, 1), (60, 3)])
    def test_the_tree_costs_one_statement_for_the_regions_whatever_the_size(
        self, db, viewer_client, regions, mountains
    ):
        self.populate(regions, mountains)

        total, statements = self.count(viewer_client, LIST_URL)

        regional = [sql for sql in statements if "mountain_region" in sql]
        assert len(regional) == 1
        assert not [
            sql for sql in statements if 'FROM "mountain"' in sql and "mountain_region" not in sql
        ]
        # The session and the signed-in user are read on every page.
        assert total == 3

    @pytest.mark.parametrize(("regions", "mountains"), [(1, 1), (60, 3)])
    def test_a_region_page_costs_two_statements_for_the_taxonomy_and_its_mountains(
        self, db, viewer_client, regions, mountains
    ):
        self.populate(regions, mountains)

        total, statements = self.count(viewer_client, detail_url("node-0"))

        taxonomy_reads = [sql for sql in statements if "GROUP BY" in sql]
        mountain_reads = [sql for sql in statements if '"mountain"."region_id" IN' in sql]
        assert (len(taxonomy_reads), len(mountain_reads)) == (1, 1)
        assert total == 4

    def test_a_search_costs_the_same(self, db, viewer_client):
        self.populate(60, 1)

        with CaptureQueriesContext(connection) as captured:
            viewer_client.get(LIST_URL, {"q": "node 5"})

        assert len(captured) == 3
