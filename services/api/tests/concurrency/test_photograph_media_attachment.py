import pytest

from serendipeak.catalog.bootstrap.ports import AttachOutcome
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
from tests.support.catalog import catalog_mountain, catalog_seed, photograph_media
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

FUJI = catalog_mountain("fuji")
IMAGE = FUJI.mountain.primary_image
MEDIA = photograph_media("b" * 64)


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_seed(FUJI))


def admin_save(**image_columns):
    """Lock and update the way an Admin save does: the mountain row first, then its image."""

    def change():
        MountainRecord.objects.select_for_update().filter(pk=FUJI.mountain.id).get()
        MountainRecord.objects.filter(pk=FUJI.mountain.id).update(name="Fuji-san")
        MountainImageRecord.objects.filter(pk=FUJI.mountain.id).update(**image_columns)

    return change


def attach():
    return DjangoPhotographMediaWriter().attach_media(
        FUJI.mountain.id, IMAGE.url, IMAGE.dimensions, MEDIA
    )


def stored_image():
    return MountainImageRecord.objects.get(pk=FUJI.mountain.id)


def test_an_attachment_waits_for_an_admin_save_and_applies_when_the_photograph_is_unchanged():
    outcome = run_while_a_change_holds_the_lock(admin_save(creator="Another creator"), attach)

    assert outcome is AttachOutcome.APPLIED
    image = stored_image()
    assert image.original_key == MEDIA.original_key
    assert image.creator == "Another creator"


def test_an_attachment_that_waited_for_a_new_file_url_is_stale():
    new_url = "https://upload.wikimedia.org/wikipedia/commons/9/99/Other.jpg"

    outcome = run_while_a_change_holds_the_lock(admin_save(url=new_url), attach)

    assert outcome is AttachOutcome.STALE
    image = stored_image()
    assert image.original_key is None
    assert image.url == new_url


def test_an_attachment_that_waited_for_new_dimensions_is_stale():
    outcome = run_while_a_change_holds_the_lock(admin_save(width=10, height=10), attach)

    assert outcome is AttachOutcome.STALE
    assert stored_image().original_key is None
