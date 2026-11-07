import pytest

from serendipeak.catalog.bootstrap.ports import AttachOutcome
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
from tests.support.catalog import catalog_seed, photograph_media, seeded_mountain
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

FUJI = seeded_mountain("fuji")
IMAGE = FUJI.mountain.primary_image
MEDIA = photograph_media("b" * 64)


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_seed(FUJI))


def admin_save(**image_columns):
    """Lock and update the way an Admin save does: the mountain row first, then its image."""

    def change():
        MountainRecord.objects.select_for_update().filter(pk=FUJI.mountain.id).get()
        MountainRecord.objects.filter(pk=FUJI.mountain.id).update(name_en="Fuji-san")
        MountainImageRecord.objects.filter(pk=FUJI.mountain.id).update(**image_columns)

    return change


def attach():
    return DjangoPhotographMediaWriter().attach_media(FUJI.mountain.id, IMAGE.dimensions, MEDIA)


def stored_image():
    return MountainImageRecord.objects.get(pk=FUJI.mountain.id)


def test_an_attachment_waits_for_an_admin_save_and_applies_when_the_photograph_is_unchanged():
    outcome = run_while_a_change_holds_the_lock(admin_save(author="Another author"), attach)

    assert outcome is AttachOutcome.APPLIED
    image = stored_image()
    assert image.original_key == MEDIA.original_key
    assert image.author == "Another author"


def test_an_attachment_that_waited_for_a_replacement_leaves_it_alone():
    other = photograph_media("c" * 64)

    def replacement():
        MountainRecord.objects.select_for_update().filter(pk=FUJI.mountain.id).get()
        MountainImageRecord.objects.filter(pk=FUJI.mountain.id).update(
            original_key=other.original_key,
            original_sha256=other.original_sha256,
            page_key=other.page_key,
            viewer_key=other.viewer_key,
        )

    outcome = run_while_a_change_holds_the_lock(replacement, attach)

    assert outcome is AttachOutcome.STALE
    assert stored_image().original_key == other.original_key


def test_an_attachment_that_waited_for_new_dimensions_is_stale():
    outcome = run_while_a_change_holds_the_lock(admin_save(width=10, height=10), attach)

    assert outcome is AttachOutcome.STALE
    assert stored_image().original_key is None


def test_two_simultaneous_attachments_of_the_same_media_apply_once():
    outcome = run_while_a_change_holds_the_lock(attach, attach)

    assert outcome is AttachOutcome.ALREADY_ATTACHED
    assert stored_image().original_key == MEDIA.original_key


def test_an_attachment_that_waited_for_a_status_transition_leaves_the_status_alone():
    def deactivate():
        MountainRecord.objects.select_for_update().filter(pk=FUJI.mountain.id).get()
        MountainRecord.objects.filter(pk=FUJI.mountain.id).update(status="inactive")

    outcome = run_while_a_change_holds_the_lock(deactivate, attach)

    assert outcome is AttachOutcome.APPLIED
    assert MountainRecord.objects.get(pk=FUJI.mountain.id).status == "inactive"
    assert stored_image().original_key == MEDIA.original_key
