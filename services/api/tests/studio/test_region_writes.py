import uuid

import pytest
from django.test import Client

from serendipeak.catalog.get_region_directory import GetRegionDirectory
from serendipeak.persistence.models import MountainRegionRecord
from serendipeak.persistence.mountain_region_reader import DjangoMountainRegionReader
from tests.studio.region_support import (
    NEW_URL,
    delete_url,
    edit_url,
    messages_of,
    mountain_regions,
    move_url,
    parents,
    region_of,
    seed,
    use_directory,
)
from tests.studio.support import csrf_token_of, text_of
from tests.support.region_taxonomy import TAXONOMY, id_of, region

MOUNTAINS = (
    ("glacier-peak", "glacier-group", "active"),
    ("andes-peak", "andes", "draft"),
)


@pytest.fixture
def taxonomy(db):
    seed(mountains=MOUNTAINS)


def payload(**overrides):
    values = {
        "parent": "",
        "name_en": "Karakoram",
        "name_es": "",
        "name_pt": "",
        "slug": "",
        "wikidata_id": "",
    }
    values.update(overrides)

    return values


def directory():
    return GetRegionDirectory(DjangoMountainRegionReader()).execute()


def count():
    return MountainRegionRecord.objects.count()


def errors_of(response):
    return text_of(response).split('class="error-summary__list"')[1].split("</ul>")[0]


class TestCreate:
    def test_the_form_offers_every_field_and_explains_the_slug(self, taxonomy, editor_client):
        body = text_of(editor_client.get(NEW_URL))

        for name in ("parent", "name_en", "name_es", "name_pt", "slug", "wikidata_id"):
            assert f'name="{name}"' in body
        assert "cannot be changed" in body or "impossible to change after saving" in body
        assert "sierra-nevada-spain" in body
        assert 'for="id_name_es"' in body and "Spanish name" in body
        assert "data-unsaved-guard" in body

    def test_a_root_region_is_created_and_the_slug_is_derived_from_the_name(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(NEW_URL, payload(name_en="  Cordillera Real "), follow=True)

        assert response.redirect_chain == [("/studio/regions/cordillera-real/", 302)]
        stored = region_of("cordillera-real")
        assert (stored.name_en, stored.parent_id, stored.name_es, stored.wikidata_id) == (
            "Cordillera Real",
            None,
            None,
            None,
        )
        assert messages_of(response) == ["Cordillera Real was created."]

    def test_a_child_is_created_with_all_its_names_a_chosen_slug_and_a_wikidata_item(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(
            NEW_URL,
            payload(
                parent=str(id_of("himalayas")),
                name_en="Karakoram",
                name_es="Karakórum",
                name_pt="Caracórum",
                slug="karakoram",
                wikidata_id="Q5498",
            ),
        )

        assert response.status_code == 302
        stored = region_of("karakoram")
        assert (stored.parent_id, stored.name_es, stored.name_pt, stored.wikidata_id) == (
            id_of("himalayas"),
            "Karakórum",
            "Caracórum",
            "Q5498",
        )

    def test_starting_from_a_node_preselects_it_as_the_parent(self, taxonomy, editor_client):
        body = text_of(editor_client.get(NEW_URL, {"parent": "cordillera-blanca"}))

        assert f'<option value="{id_of("cordillera-blanca")}" selected>' in body
        assert "Andes › Cordillera Blanca" in body

    def test_an_unknown_parent_in_the_link_starts_the_form_without_one(
        self, taxonomy, editor_client
    ):
        response = editor_client.get(NEW_URL, {"parent": "no-such-range"})

        assert response.status_code == 200
        select = text_of(response).split('name="parent"')[1].split("</select>")[0]
        assert select.count(" selected>") == 1
        assert 'value="" selected>No parent' in select

    def test_every_possible_parent_is_listed_by_its_path_and_equal_names_by_slug_too(
        self, db, editor_client
    ):
        seed(
            [
                region("sierra-nevada-us", "Sierra Nevada"),
                region("sierra-nevada-es", "Sierra Nevada"),
            ]
        )

        body = text_of(editor_client.get(NEW_URL))

        assert "Sierra Nevada (sierra-nevada-es)</option>" in body
        assert "Sierra Nevada (sierra-nevada-us)</option>" in body

    def test_a_sibling_with_the_same_name_is_refused_ignoring_case_and_nothing_is_written(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(
            NEW_URL,
            payload(parent=str(id_of("andes")), name_en="cordillera BLANCA", slug="blanca-2"),
        )

        assert response.status_code == 200
        assert "Andes already has a region named “cordillera BLANCA”" in errors_of(response)
        assert count() == len(TAXONOMY)

    def test_two_roots_may_share_a_name_until_one_is_placed(self, taxonomy, editor_client):
        response = editor_client.post(
            NEW_URL, payload(name_en="Andes", slug="andes-north", confirm_same_name="on")
        )

        assert response.status_code == 302
        assert region_of("andes-north").parent_id is None

    def test_a_name_that_exists_elsewhere_stops_for_a_confirmation_listing_the_paths(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(
            NEW_URL, payload(parent=str(id_of("himalayas")), name_en="Glacier Group")
        )

        body = text_of(response)
        assert response.status_code == 200
        assert count() == len(TAXONOMY)
        assert "Other regions have this name" in body
        assert "Andes › Cordillera Blanca › Glacier Group" in body
        assert 'href="/studio/regions/glacier-group/" target="_blank"' in body
        assert "Free slugs for this name: glacier-group-himalayas." in body
        assert "Confirm that this is a different region" in errors_of(response)
        # What was typed is kept.
        assert 'value="Glacier Group"' in body

    def test_confirming_creates_the_region_and_a_qualified_slug_needs_no_confirmation(
        self, taxonomy, editor_client
    ):
        confirmed = editor_client.post(
            NEW_URL,
            payload(
                parent=str(id_of("himalayas")),
                name_en="Glacier Group",
                slug="glacier-group-himalayas",
                confirm_same_name="on",
            ),
        )
        qualified = editor_client.post(
            NEW_URL,
            payload(name_en="Glacier Group", slug="glacier-group-alps"),
        )

        assert (confirmed.status_code, qualified.status_code) == (302, 302)
        assert {"glacier-group-himalayas", "glacier-group-alps"} <= set(parents())

    def test_a_slug_in_use_names_its_owner_and_suggests_free_ones(self, taxonomy, editor_client):
        response = editor_client.post(
            NEW_URL,
            payload(
                parent=str(id_of("himalayas")), name_en="Andes Foothills", slug="glacier-group"
            ),
        )

        message = errors_of(response)
        assert (
            "The slug glacier-group is already used by Andes › Cordillera Blanca › Glacier Group"
            in message
        )
        assert "Free slugs for this name: andes-foothills, andes-foothills-himalayas." in message
        assert count() == len(TAXONOMY)

    def test_slugs_are_unique_across_the_whole_tree_not_per_parent(self, taxonomy, editor_client):
        response = editor_client.post(
            NEW_URL,
            payload(parent=str(id_of("lone-range")), name_en="Another Annapurna", slug="annapurna"),
        )

        assert response.status_code == 200
        assert "already used by Himalayas › Annapurna" in errors_of(response)

    def test_a_name_without_letters_needs_a_slug_typed_by_hand(self, taxonomy, editor_client):
        response = editor_client.post(NEW_URL, payload(name_en="???"))

        assert "Enter the slug yourself" in errors_of(response)
        assert count() == len(TAXONOMY)

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"name_en": "   "}, "Enter the English name."),
            ({"slug": "Not A Slug"}, "Use lowercase letters and digits"),
            ({"slug": "-edge-"}, "Use lowercase letters and digits"),
            ({"wikidata_id": "5451"}, "Use the Wikidata item id, such as Q5451."),
            ({"wikidata_id": "Q0"}, "Use the Wikidata item id, such as Q5451."),
        ],
    )
    def test_invalid_input_is_a_form_error_and_nothing_is_written(
        self, taxonomy, editor_client, overrides, message
    ):
        response = editor_client.post(NEW_URL, payload(**overrides))

        assert response.status_code == 200
        assert message in errors_of(response)
        assert count() == len(TAXONOMY)

    def test_a_wikidata_item_already_used_is_refused(self, taxonomy, editor_client):
        response = editor_client.post(NEW_URL, payload(wikidata_id="Q5456"))

        assert "Another region already uses the Wikidata item Q5456." in errors_of(response)
        assert count() == len(TAXONOMY)

    def test_a_forged_parent_is_a_form_error(self, taxonomy, editor_client):
        response = editor_client.post(NEW_URL, payload(parent=str(uuid.uuid4())))

        assert response.status_code == 200
        assert "Select a valid choice" in errors_of(response)
        assert count() == len(TAXONOMY)

    def test_a_parent_deleted_after_the_page_was_loaded_is_a_form_error(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        MountainRegionRecord.objects.filter(slug="lone-range").delete()
        use_directory(monkeypatch, stale, "studio:region_new")

        response = editor_client.post(NEW_URL, payload(parent=str(id_of("lone-range"))))

        assert response.status_code == 200
        assert "That parent no longer exists" in errors_of(response)

    def test_a_sibling_created_after_the_page_was_loaded_is_refused_by_the_use_case(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        seed([region("karakoram-twin", "Karakoram", parent="himalayas")])
        use_directory(monkeypatch, stale, "studio:region_new")

        response = editor_client.post(
            NEW_URL, payload(parent=str(id_of("himalayas")), name_en="Karakoram", slug="karakoram")
        )

        assert response.status_code == 200
        assert "Himalayas already has a region named “Karakoram”" in errors_of(response)
        assert "karakoram" not in parents()


class TestEdit:
    def test_the_form_holds_the_stored_values_and_shows_the_slug_and_parent_as_fixed(
        self, db, editor_client
    ):
        seed([region("andes", "Andes", es="Los Andes", pt="Os Andes", wikidata_id="Q5456")])

        body = text_of(editor_client.get(edit_url("andes")))

        assert (
            'value="Andes"' in body and 'value="Los Andes"' in body and 'value="Os Andes"' in body
        )
        assert 'value="Q5456"' in body
        assert 'name="slug"' not in body and 'name="parent"' not in body
        assert "<dd>andes</dd>" in body
        assert "cannot be changed" in body

    def test_names_and_the_wikidata_item_are_saved_and_the_rest_is_untouched(
        self, taxonomy, editor_client
    ):
        before = parents()

        response = editor_client.post(
            edit_url("cordillera-blanca"),
            {
                "name_en": " Cordillera Blanca Norte ",
                "name_es": "Cordillera Blanca del Norte",
                "name_pt": "",
                "wikidata_id": "Q123",
            },
            follow=True,
        )

        stored = region_of("cordillera-blanca")
        assert (stored.name_en, stored.name_es, stored.name_pt, stored.wikidata_id) == (
            "Cordillera Blanca Norte",
            "Cordillera Blanca del Norte",
            None,
            "Q123",
        )
        assert parents() == before
        assert mountain_regions() == {"glacier-peak": "glacier-group", "andes-peak": "andes"}
        assert messages_of(response) == ["Cordillera Blanca Norte was saved."]

    def test_a_forged_slug_or_parent_is_ignored(self, taxonomy, editor_client):
        editor_client.post(
            edit_url("cordillera-blanca"),
            {"name_en": "Cordillera Blanca", "slug": "hijacked", "parent": str(id_of("himalayas"))},
        )

        assert region_of("cordillera-blanca").parent_id == id_of("andes")
        assert not MountainRegionRecord.objects.filter(slug="hijacked").exists()

    def test_clearing_a_translation_removes_it(self, db, editor_client):
        seed([region("andes", "Andes", es="Los Andes")])

        editor_client.post(edit_url("andes"), {"name_en": "Andes", "name_es": ""})

        assert region_of("andes").name_es is None

    def test_renaming_into_a_sibling_name_is_refused(self, taxonomy, editor_client):
        response = editor_client.post(
            edit_url("patagonian-andes"), {"name_en": "cordillera blanca"}
        )

        assert response.status_code == 200
        assert "Andes already has a region named “cordillera blanca”" in errors_of(response)
        assert region_of("patagonian-andes").name_en == "Patagonian Andes"

    def test_a_region_may_keep_its_own_name(self, taxonomy, editor_client):
        response = editor_client.post(edit_url("patagonian-andes"), {"name_en": "Patagonian Andes"})

        assert response.status_code == 302

    @pytest.mark.parametrize(
        ("values", "message"),
        [
            ({"name_en": ""}, "Enter the English name."),
            ({"name_en": "Andes", "wikidata_id": "Q12x"}, "Use the Wikidata item id"),
            (
                {"name_en": "Andes", "wikidata_id": "Q5451"},
                "Another region already uses the Wikidata item Q5451.",
            ),
        ],
    )
    def test_invalid_input_keeps_the_region_as_it_was(
        self, taxonomy, editor_client, values, message
    ):
        response = editor_client.post(edit_url("andes"), values)

        assert response.status_code == 200
        assert message in errors_of(response)
        assert region_of("andes").name_en == "Andes"

    def test_a_region_deleted_after_the_page_was_loaded_ends_in_a_notice(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        MountainRegionRecord.objects.filter(slug="lone-range").delete()
        use_directory(monkeypatch, stale, "studio:region_edit", slug="lone-range")

        response = editor_client.post(
            edit_url("lone-range"), {"name_en": "Lone Range II"}, follow=True
        )

        assert response.redirect_chain == [("/studio/regions/", 302)]
        assert messages_of(response) == ["Lone Range no longer exists, so nothing was changed."]

    def test_an_unknown_region_is_a_404(self, taxonomy, editor_client):
        assert editor_client.get(edit_url("no-such-range")).status_code == 404
        assert editor_client.post(edit_url("no-such-range"), {"name_en": "X"}).status_code == 404


class TestMove:
    def test_the_form_lists_every_region_and_disables_those_that_cannot_receive_it(
        self, taxonomy, editor_client
    ):
        body = text_of(editor_client.get(move_url("cordillera-blanca")))

        def option(slug):
            return next(line for line in body.split("<option") if f'value="{id_of(slug)}"' in line)

        assert "disabled" in option("cordillera-blanca")
        assert "this is the region you are moving" in option("cordillera-blanca")
        assert "disabled" in option("glacier-group")
        assert "it is inside this region" in option("glacier-group")
        assert "disabled" in option("andes")
        assert "it is already the parent" in option("andes")
        for slug in ("himalayas", "annapurna", "patagonian-andes", "lone-range"):
            assert "disabled" not in option(slug)
        assert "No parent: make it a root region</option>" in body
        assert "Why a destination is unavailable" in body

    def test_a_root_cannot_be_moved_to_no_parent(self, taxonomy, editor_client):
        body = text_of(editor_client.get(move_url("himalayas")))

        assert 'value="root" disabled' in body
        assert "it is already the parent" in body

    def test_a_destination_with_a_child_of_the_same_name_says_why(self, db, editor_client):
        seed([*TAXONOMY, region("blanca-twin", "Cordillera Blanca", parent="himalayas")])

        body = text_of(editor_client.get(move_url("blanca-twin")))

        assert "it already has a region named “Cordillera Blanca”" in body

    def test_choosing_a_destination_asks_for_confirmation_and_writes_nothing(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(
            move_url("cordillera-blanca"), {"parent": str(id_of("annapurna"))}
        )

        body = text_of(response)
        assert response.status_code == 200
        assert "Move Cordillera Blanca?" in body
        assert "<dd>Andes › Cordillera Blanca</dd>" in body
        assert "<dd>Himalayas › Annapurna › Cordillera Blanca</dd>" in body
        assert "1 region below it, at any depth, keep their places inside it." in body
        assert "1 mountain in it and below it keep their region." in body
        assert 'name="confirmed" value="yes"' in body
        assert f'name="parent" value="{id_of("annapurna")}"' in body
        assert parents()["cordillera-blanca"] == "andes"

    def test_confirming_moves_the_region_with_everything_below_it_and_its_mountains(
        self, taxonomy, editor_client
    ):
        response = editor_client.post(
            move_url("cordillera-blanca"),
            {"parent": str(id_of("annapurna")), "confirmed": "yes"},
            follow=True,
        )

        assert response.redirect_chain == [("/studio/regions/cordillera-blanca/", 302)]
        assert parents()["cordillera-blanca"] == "annapurna"
        assert parents()["glacier-group"] == "cordillera-blanca"
        assert mountain_regions()["glacier-peak"] == "glacier-group"
        assert messages_of(response) == [
            "Cordillera Blanca was moved, with 1 descendant region and 1 mountain below it."
        ]
        assert "Himalayas" in text_of(response)

    def test_a_region_can_become_a_root(self, taxonomy, editor_client):
        body = text_of(editor_client.post(move_url("cordillera-blanca"), {"parent": "root"}))
        assert "(a root region)" in body

        editor_client.post(move_url("cordillera-blanca"), {"parent": "root", "confirmed": "yes"})

        assert parents()["cordillera-blanca"] is None

    def test_a_move_with_nothing_below_it_says_so(self, taxonomy, editor_client):
        body = text_of(editor_client.post(move_url("lone-range"), {"parent": str(id_of("andes"))}))

        assert "It has no regions below it." in body
        assert "No mountain is in it or below it" in body

    @pytest.mark.parametrize("target", ["cordillera-blanca", "glacier-group", "andes"])
    def test_a_forged_destination_that_is_itself_inside_or_current_is_refused_even_confirmed(
        self, taxonomy, editor_client, target
    ):
        before = parents()

        response = editor_client.post(
            move_url("cordillera-blanca"), {"parent": str(id_of(target)), "confirmed": "yes"}
        )

        assert response.status_code == 200
        assert "This destination is unavailable" in errors_of(response)
        assert parents() == before

    def test_a_sibling_name_clash_is_refused(self, db, editor_client):
        seed([*TAXONOMY, region("blanca-twin", "Cordillera Blanca", parent="himalayas")])

        response = editor_client.post(
            move_url("blanca-twin"), {"parent": str(id_of("andes")), "confirmed": "yes"}
        )

        assert "This destination is unavailable: it already has a region named" in errors_of(
            response
        )
        assert parents()["blanca-twin"] == "himalayas"

    def test_no_destination_chosen_is_a_form_error(self, taxonomy, editor_client):
        response = editor_client.post(move_url("lone-range"), {"parent": ""})

        assert "Choose where the region goes." in errors_of(response)

    def test_a_destination_deleted_before_confirming_is_a_form_error(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        MountainRegionRecord.objects.filter(slug="patagonian-andes").delete()
        use_directory(monkeypatch, stale, "studio:region_move", slug="lone-range")

        response = editor_client.post(
            move_url("lone-range"),
            {"parent": str(id_of("patagonian-andes")), "confirmed": "yes"},
        )

        assert response.status_code == 200
        assert "That destination no longer exists" in errors_of(response)
        assert parents()["lone-range"] is None

    def test_a_destination_that_became_a_descendant_meanwhile_is_refused_by_the_use_case(
        self, taxonomy, editor_client, monkeypatch
    ):
        # The page offered himalayas as a destination; before the post, himalayas went under
        # lone-range, so lone-range now sits above it.
        stale = directory()
        MountainRegionRecord.objects.filter(slug="himalayas").update(parent=region_of("lone-range"))
        use_directory(monkeypatch, stale, "studio:region_move", slug="lone-range")

        response = editor_client.post(
            move_url("lone-range"), {"parent": str(id_of("himalayas")), "confirmed": "yes"}
        )

        assert response.status_code == 200
        assert "it is inside this region" in errors_of(response)
        assert parents()["lone-range"] is None

    def test_a_sibling_name_taken_meanwhile_is_refused_by_the_use_case(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        seed([region("blanca-twin", "Lone Range", parent="himalayas")])
        use_directory(monkeypatch, stale, "studio:region_move", slug="lone-range")

        response = editor_client.post(
            move_url("lone-range"), {"parent": str(id_of("himalayas")), "confirmed": "yes"}
        )

        assert "Himalayas already has a region named “Lone Range”" in errors_of(response)
        assert parents()["lone-range"] is None

    def test_a_region_deleted_meanwhile_ends_in_a_notice(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        MountainRegionRecord.objects.filter(slug="lone-range").delete()
        use_directory(monkeypatch, stale, "studio:region_move", slug="lone-range")

        response = editor_client.post(
            move_url("lone-range"), {"parent": str(id_of("andes")), "confirmed": "yes"}, follow=True
        )

        assert messages_of(response) == ["Lone Range no longer exists, so nothing was changed."]

    def test_an_unknown_region_is_a_404(self, taxonomy, editor_client):
        assert editor_client.get(move_url("no-such-range")).status_code == 404
        assert editor_client.post(move_url("no-such-range"), {"parent": "root"}).status_code == 404


class TestDelete:
    def test_a_region_with_nothing_depending_on_it_is_deleted_after_a_confirmation_page(
        self, taxonomy, editor_client
    ):
        page = text_of(editor_client.get(delete_url("lone-range")))
        assert "Delete Lone Range?" in page
        assert "It has no child regions and no mountains." in page
        assert 'class="button button--danger"' in page

        response = editor_client.post(delete_url("lone-range"), follow=True)

        assert response.redirect_chain == [("/studio/regions/", 302)]
        assert not MountainRegionRecord.objects.filter(slug="lone-range").exists()
        assert messages_of(response) == ["Lone Range was deleted."]

    def test_deleting_a_child_returns_to_its_parent(self, taxonomy, editor_client):
        response = editor_client.post(delete_url("patagonian-andes"), follow=True)

        assert response.redirect_chain == [("/studio/regions/andes/", 302)]

    def test_the_dependency_page_lists_children_and_mountains_and_offers_no_deletion(
        self, taxonomy, editor_client
    ):
        body = text_of(editor_client.get(delete_url("andes")))

        assert "Andes cannot be deleted yet" in body
        assert 'Child regions</dt><dd class="numeric">2</dd>' in body
        assert 'Mountains directly in it</dt><dd class="numeric">1</dd>' in body
        assert 'href="/studio/regions/cordillera-blanca/"' in body
        assert 'href="/studio/mountains/andes-peak/"' in body
        assert "button--danger" not in body
        assert "nothing is moved or deleted for you" in body

    def test_a_region_with_only_mountains_or_only_children_is_also_blocked(
        self, taxonomy, editor_client
    ):
        only_children = text_of(editor_client.get(delete_url("himalayas")))
        only_mountains = text_of(editor_client.get(delete_url("glacier-group")))

        assert "cannot be deleted yet" in only_children
        assert "cannot be deleted yet" in only_mountains

    @pytest.mark.parametrize("slug", ["andes", "glacier-group", "himalayas"])
    def test_a_forged_post_for_a_region_in_use_deletes_nothing_and_explains(
        self, taxonomy, editor_client, slug
    ):
        total = count()

        response = editor_client.post(delete_url(slug), follow=True)

        assert response.redirect_chain == [(f"/studio/regions/{slug}/delete/", 302)]
        assert count() == total
        assert "was not deleted: it still has" in messages_of(response)[0]
        assert mountain_regions() == {"glacier-peak": "glacier-group", "andes-peak": "andes"}

    def test_the_message_counts_children_and_mountains(self, taxonomy, editor_client):
        response = editor_client.post(delete_url("andes"), follow=True)

        assert messages_of(response) == [
            "Andes was not deleted: it still has 2 child regions and 1 mountain. Move or delete "
            "the child regions and reassign the mountains first."
        ]

    def test_a_mountain_assigned_after_the_page_was_loaded_blocks_the_deletion(
        self, taxonomy, editor_client
    ):
        editor_client.get(delete_url("lone-range"))
        seed(regions=(), mountains=[("late-peak", "lone-range", "draft")])

        response = editor_client.post(delete_url("lone-range"), follow=True)

        assert MountainRegionRecord.objects.filter(slug="lone-range").exists()
        assert "1 mountain" in messages_of(response)[0]

    def test_a_region_already_deleted_is_a_404(self, taxonomy, editor_client):
        MountainRegionRecord.objects.filter(slug="lone-range").delete()

        assert editor_client.get(delete_url("lone-range")).status_code == 404
        assert editor_client.post(delete_url("lone-range")).status_code == 404

    def test_a_region_deleted_between_the_lookup_and_the_write_ends_in_a_notice(
        self, taxonomy, editor_client, monkeypatch
    ):
        stale = directory()
        MountainRegionRecord.objects.filter(slug="lone-range").delete()
        use_directory(monkeypatch, stale, "studio:region_delete", slug="lone-range")

        response = editor_client.post(delete_url("lone-range"), follow=True)

        assert messages_of(response) == ["Lone Range no longer exists, so nothing was changed."]


class TestCsrf:
    ROUTES = (
        ("studio:region_new", {}, {"name_en": "Karakoram"}),
        ("studio:region_edit", {"slug": "lone-range"}, {"name_en": "Renamed"}),
        ("studio:region_move", {"slug": "lone-range"}, {"parent": "root"}),
        ("studio:region_delete", {"slug": "lone-range"}, {}),
    )

    def enforcing(self, editor):
        client = Client(enforce_csrf_checks=True)
        client.force_login(editor)

        return client

    @pytest.mark.parametrize(("name", "kwargs", "data"), ROUTES)
    def test_a_post_without_a_token_is_refused_inside_the_studio_and_changes_nothing(
        self, taxonomy, editor, name, kwargs, data
    ):
        from django.urls import reverse

        before = (count(), parents(), region_of("lone-range").name_en)

        response = self.enforcing(editor).post(reverse(name, kwargs=kwargs), data)

        assert response.status_code == 403
        assert "This page expired" in text_of(response)
        assert (count(), parents(), region_of("lone-range").name_en) == before

    def test_the_forms_carry_a_token_and_a_post_with_it_is_accepted(self, taxonomy, editor):
        client = self.enforcing(editor)
        token = csrf_token_of(client.get(NEW_URL))

        response = client.post(NEW_URL, payload(csrfmiddlewaretoken=token))

        assert response.status_code == 302

    def test_every_confirmation_page_carries_a_token(self, taxonomy, editor_client):
        for url, data in ((move_url("lone-range"), {"parent": str(id_of("andes"))}),):
            assert 'name="csrfmiddlewaretoken"' in text_of(editor_client.post(url, data))
        for url in (delete_url("lone-range"), edit_url("lone-range")):
            assert 'name="csrfmiddlewaretoken"' in text_of(editor_client.get(url))
