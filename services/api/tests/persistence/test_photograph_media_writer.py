import pytest

from serendipeak.catalog.bootstrap.ports import AttachOutcome
from serendipeak.catalog.entities import PhotographMedia
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
from tests.support.catalog import catalog_seed, photograph_media, seeded_mountain

pytestmark = pytest.mark.django_db

FUJI = seeded_mountain("fuji")
IMAGE = FUJI.mountain.primary_image
FILE_URL = FUJI.image_provenance.legacy_file_url
MEDIA = photograph_media("b" * 64)


@pytest.fixture
def writer():
    DjangoCatalogStore().load(catalog_seed(FUJI))
    return DjangoPhotographMediaWriter()


def attach(writer, media=MEDIA):
    return writer.attach_media(FUJI.mountain.id, FILE_URL, IMAGE.dimensions, media)


def test_attaching_changes_only_the_media_columns(writer):
    mountain_before = MountainRecord.objects.filter(pk=FUJI.mountain.id).values().get()
    image_before = MountainImageRecord.objects.filter(pk=FUJI.mountain.id).values().get()

    attach(writer)

    mountain_after = MountainRecord.objects.filter(pk=FUJI.mountain.id).values().get()
    image_after = MountainImageRecord.objects.filter(pk=FUJI.mountain.id).values().get()
    assert mountain_after == mountain_before
    changed = {name for name in image_before if image_before[name] != image_after[name]}
    assert changed == {"original_key", "original_sha256", "page_key", "viewer_key"}


def test_attaching_locks_the_mountain_then_the_image_then_updates_in_one_transaction(
    writer, django_assert_num_queries
):
    with django_assert_num_queries(5) as captured:
        assert attach(writer) is AttachOutcome.APPLIED

    statements = [query["sql"] for query in captured.captured_queries]
    assert statements[0].startswith("SAVEPOINT")
    assert 'FROM "mountain"' in statements[1] and statements[1].endswith("FOR UPDATE")
    assert 'FROM "mountain_image"' in statements[2] and statements[2].endswith("FOR UPDATE")
    assert statements[3].startswith('UPDATE "mountain_image"')
    assert statements[4].startswith("RELEASE SAVEPOINT")


def test_a_refused_attachment_reads_but_never_writes(writer, django_assert_num_queries):
    attach(writer)

    with django_assert_num_queries(4) as captured:
        assert attach(writer) is AttachOutcome.ALREADY_ATTACHED

    assert not any(query["sql"].startswith("UPDATE") for query in captured.captured_queries)


def test_the_database_still_refuses_media_without_its_format(writer):
    malformed = PhotographMedia(
        original_key="photographs/not-a-digest/original.jpg",
        original_sha256="b" * 64,
        page_key=MEDIA.page_key,
        viewer_key=MEDIA.viewer_key,
    )

    with pytest.raises(InfrastructureError):
        attach(writer, malformed)

    assert MountainImageRecord.objects.get(pk=FUJI.mountain.id).original_key is None
