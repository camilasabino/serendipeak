import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import MountainNotDraft, UnknownMountain
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ID = DRAFT.mountain.id


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_of(DRAFT))


def delete():
    try:
        DjangoDraftMountainDeletionStore().delete_draft(ID)
    except (MountainNotDraft, UnknownMountain) as refusal:
        return refusal


def test_a_deletion_waiting_for_a_publication_finds_the_mountain_public_and_refuses():
    def publish():
        DjangoMountainStatusStore().change_status(ID, PUBLISH, lambda mountain: ())

    refusal = run_while_a_change_holds_the_lock(publish, delete)

    assert isinstance(refusal, MountainNotDraft)
    assert refusal.status is MountainStatus.ACTIVE
    assert MountainRecord.objects.get(pk=ID).status == "active"
    assert MountainImageRecord.objects.filter(pk=ID).exists()


def test_a_publication_waiting_for_a_deletion_finds_no_mountain():
    def publish():
        return DjangoMountainStatusStore().change_status(ID, PUBLISH, lambda mountain: ())

    outcome = run_while_a_change_holds_the_lock(delete, publish)

    assert outcome.outcome.name == "NOT_FOUND"
    assert not MountainRecord.objects.filter(pk=ID).exists()


def test_an_update_waiting_for_a_deletion_is_refused_as_unknown_and_writes_nothing():
    update = MountainUpdate(
        slug="draft-peak", name="Edited", elevation_meters=100, continent_code="SA"
    )

    def edit():
        try:
            DjangoMountainUpdateStore().update(ID, update, public_edit_violations)
        except UnknownMountain as refusal:
            return refusal

    refusal = run_while_a_change_holds_the_lock(delete, edit)

    assert refusal.mountain_id == ID
    assert MountainRecord.objects.count() == 0
    assert MountainImageRecord.objects.count() == 0


def test_a_deletion_waiting_for_an_update_deletes_what_the_update_left():
    update = MountainUpdate(
        slug="renamed-draft", name="Edited", elevation_meters=100, continent_code="SA"
    )

    run_while_a_change_holds_the_lock(
        lambda: DjangoMountainUpdateStore().update(ID, update, public_edit_violations), delete
    )

    assert MountainRecord.objects.count() == 0
