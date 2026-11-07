import pytest
from django.db import DatabaseError, connection, transaction

from serendipeak.persistence.models import MountainRegionRecord
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)


def move(slug, parent_slug):
    with transaction.atomic():
        MountainRegionRecord.objects.filter(slug=slug).update(
            parent=MountainRegionRecord.objects.get(slug=parent_slug)
        )


def parents():
    return dict(MountainRegionRecord.objects.values_list("slug", "parent__slug"))


def test_two_moves_that_would_form_a_cycle_together_let_exactly_one_succeed():
    MountainRegionRecord.objects.create(slug="alpha-chain", name_en="Alpha")
    MountainRegionRecord.objects.create(slug="beta-chain", name_en="Beta")

    def second_move():
        try:
            move("beta-chain", "alpha-chain")
        except DatabaseError as error:
            return str(error)
        finally:
            connection.close()

    # The first move has changed its row and holds the structure lock until the test lets it
    # commit; the second one waits for that lock and then sees the committed first move.
    refusal = run_while_a_change_holds_the_lock(
        lambda: move("alpha-chain", "beta-chain"), second_move
    )

    assert "cannot descend from itself" in refusal
    assert parents() == {"alpha-chain": "beta-chain", "beta-chain": None}


def test_without_the_lock_holder_a_disjoint_move_is_not_blocked():
    MountainRegionRecord.objects.create(slug="alpha-chain", name_en="Alpha")
    MountainRegionRecord.objects.create(slug="beta-chain", name_en="Beta")
    MountainRegionRecord.objects.create(slug="gamma-chain", name_en="Gamma")

    move("alpha-chain", "beta-chain")
    move("gamma-chain", "beta-chain")

    assert parents() == {
        "alpha-chain": "beta-chain",
        "beta-chain": None,
        "gamma-chain": "beta-chain",
    }
