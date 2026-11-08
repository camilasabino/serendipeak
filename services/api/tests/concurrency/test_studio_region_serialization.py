"""The Studio's region screens read the taxonomy, then write it through use cases that take the
structure lock. A colleague's change committed between the two must end in an explained refusal,
never in a corrupt tree or a server error. Each test holds a colleague's uncommitted change, sends
the Studio request behind it, and lets the change commit."""

import pytest
from django.db import connection
from django.test import Client

from serendipeak.accounts.roles import Role
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import NewMountainRegion
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from serendipeak.persistence.mountain_region_store import DjangoMountainRegionStore
from tests.studio.region_support import (
    NEW_URL,
    delete_url,
    edit_url,
    messages_of,
    move_url,
    parents,
    seed,
)
from tests.studio.support import text_of
from tests.support.concurrency import run_while_a_change_holds_the_lock
from tests.support.records import mountain_record
from tests.support.region_taxonomy import TAXONOMY, id_of, region
from tests.support.users import create_user

pytestmark = pytest.mark.django_db(transaction=True)

STORE = DjangoMountainRegionStore()


@pytest.fixture(autouse=True)
def taxonomy():
    seed([*TAXONOMY, region("zeta-range"), region("eta-range")])


@pytest.fixture
def editor_client():
    client = Client()
    client.force_login(create_user("editor", Role.EDITOR))

    return client


def errors_of(response):
    return text_of(response).split('class="error-summary__list"')[1].split("</ul>")[0]


def test_a_sibling_created_by_a_colleague_meanwhile_is_a_form_error_and_leaves_one_region(
    editor_client,
):
    response = run_while_a_change_holds_the_lock(
        lambda: STORE.create(
            NewMountainRegion(
                slug="karakoram",
                name=LocalizedText(en="Karakoram"),
                parent_id=id_of("himalayas"),
            )
        ),
        lambda: editor_client.post(
            NEW_URL,
            {
                "parent": str(id_of("himalayas")),
                "name_en": "karakoram",
                "slug": "karakoram-2",
            },
        ),
    )

    assert response.status_code == 200
    assert "Himalayas already has a region named “karakoram”" in errors_of(response)
    assert set(parents()) - {entry.slug for entry in TAXONOMY} == {
        "zeta-range",
        "eta-range",
        "karakoram",
    }


def test_two_studio_creations_of_one_slug_let_exactly_one_succeed(editor_client):
    response = run_while_a_change_holds_the_lock(
        lambda: STORE.create(
            NewMountainRegion(slug="karakoram", name=LocalizedText(en="Karakoram"))
        ),
        lambda: editor_client.post(NEW_URL, {"name_en": "Karakoram Two", "slug": "karakoram"}),
    )

    assert response.status_code == 200
    # The page's directory predates the colleague's region, so it cannot name the owner.
    assert "Another region already uses the slug karakoram." in errors_of(response)
    assert MountainRegionRecord.objects.filter(slug="karakoram").count() == 1


def test_editing_a_region_a_colleague_deleted_meanwhile_ends_in_a_notice(editor_client):
    response = run_while_a_change_holds_the_lock(
        lambda: STORE.delete(id_of("lone-range")),
        lambda: editor_client.post(
            edit_url("lone-range"), {"name_en": "Lone Range Two"}, follow=True
        ),
    )

    assert response.redirect_chain == [("/studio/regions/", 302)]
    assert messages_of(response) == ["Lone Range no longer exists, so nothing was changed."]
    assert not MountainRegionRecord.objects.filter(slug="lone-range").exists()


def test_two_opposite_moves_never_form_a_cycle_and_the_loser_is_told_why(editor_client):
    response = run_while_a_change_holds_the_lock(
        lambda: STORE.move(id_of("eta-range"), id_of("zeta-range")),
        lambda: editor_client.post(
            move_url("zeta-range"), {"parent": str(id_of("eta-range")), "confirmed": "yes"}
        ),
    )

    assert response.status_code == 200
    assert "it is inside this region" in errors_of(response)
    assert parents()["eta-range"] == "zeta-range"
    assert parents()["zeta-range"] is None


def test_deleting_a_region_a_colleague_just_gave_a_mountain_is_refused_and_keeps_both(
    editor_client,
):
    def assign():
        mountain_record(slug="late-peak", region_id=id_of("lone-range")).save()
        # The foreign keys are deferred; checking them takes the key-share lock on the region
        # row that a mountain store takes before it commits.
        connection.check_constraints()

    response = run_while_a_change_holds_the_lock(
        assign, lambda: editor_client.post(delete_url("lone-range"), follow=True)
    )

    assert (
        "was not deleted: it still has 0 child regions and 1 mountain" in messages_of(response)[0]
    )
    assert MountainRegionRecord.objects.filter(slug="lone-range").exists()
    assert MountainRecord.objects.get(slug="late-peak").region_id == id_of("lone-range")
