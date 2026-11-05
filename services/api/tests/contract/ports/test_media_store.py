import pytest

from serendipeak.errors import InfrastructureError
from serendipeak.media.filesystem_media_store import FilesystemMediaStore
from serendipeak.media.s3_media_store import S3MediaStore
from tests.support.fakes import FakeMediaStore
from tests.support.s3 import ORIGINALS_BUCKET, PUBLIC_BUCKET, InMemoryS3

DIGEST = "ab" * 32
ORIGINAL_KEY = f"photographs/{DIGEST}/original.png"
PAGE_KEY = f"photographs/{DIGEST}/page-r1.jpg"
INVALID_KEYS = ["", "../original.png", f"photographs/{DIGEST}/../../escape.jpg", "/etc/passwd"]


class Arrangement:
    def __init__(self, store, break_storage):
        self.store = store
        self.break_storage = break_storage


@pytest.fixture(params=["fake", "filesystem", "s3"])
def arranged(request, tmp_path):
    if request.param == "fake":
        store = FakeMediaStore()
        return Arrangement(store, lambda: setattr(store, "failing", True))

    if request.param == "filesystem":

        def break_storage():
            tmp_path.chmod(0o500)
            request.addfinalizer(lambda: tmp_path.chmod(0o700))

        return Arrangement(FilesystemMediaStore(tmp_path / "media"), break_storage)

    s3 = InMemoryS3()
    store = S3MediaStore(s3.client, public_bucket=PUBLIC_BUCKET, originals_bucket=ORIGINALS_BUCKET)

    return Arrangement(store, lambda: setattr(s3, "failure_status", 403))


def test_a_stored_original_exists_and_reads_back_byte_for_byte(arranged):
    data = bytes(range(256)) * 4

    arranged.store.put_original(ORIGINAL_KEY, data, "image/png")

    assert arranged.store.has_original(ORIGINAL_KEY)
    assert arranged.store.read_original(ORIGINAL_KEY) == data


def test_a_stored_public_object_exists(arranged):
    arranged.store.put_public(PAGE_KEY, b"page rendition", "image/jpeg")

    assert arranged.store.has_public(PAGE_KEY)


def test_nothing_exists_before_it_is_stored(arranged):
    assert not arranged.store.has_original(ORIGINAL_KEY)
    assert not arranged.store.has_public(PAGE_KEY)


def test_originals_and_public_objects_are_kept_apart(arranged):
    arranged.store.put_original(PAGE_KEY, b"original", "image/jpeg")

    assert not arranged.store.has_public(PAGE_KEY)

    arranged.store.put_public(ORIGINAL_KEY, b"public", "image/png")

    assert arranged.store.read_original(PAGE_KEY) == b"original"
    assert not arranged.store.has_original(ORIGINAL_KEY)


def test_storing_again_never_replaces_an_original(arranged):
    arranged.store.put_original(ORIGINAL_KEY, b"first", "image/png")

    arranged.store.put_original(ORIGINAL_KEY, b"second", "image/png")

    assert arranged.store.read_original(ORIGINAL_KEY) == b"first"


def test_storing_a_public_object_again_is_harmless(arranged):
    arranged.store.put_public(PAGE_KEY, b"first", "image/jpeg")

    arranged.store.put_public(PAGE_KEY, b"second", "image/jpeg")

    assert arranged.store.has_public(PAGE_KEY)


def test_reading_a_missing_original_is_an_infrastructure_error(arranged):
    with pytest.raises(InfrastructureError):
        arranged.store.read_original(ORIGINAL_KEY)


@pytest.mark.parametrize("key", INVALID_KEYS)
@pytest.mark.parametrize(
    "operation",
    [
        lambda store, key: store.put_original(key, b"data", "image/png"),
        lambda store, key: store.put_public(key, b"data", "image/jpeg"),
        lambda store, key: store.has_original(key),
        lambda store, key: store.has_public(key),
        lambda store, key: store.read_original(key),
    ],
    ids=["put_original", "put_public", "has_original", "has_public", "read_original"],
)
def test_keys_outside_the_scheme_are_refused_before_storage_access(arranged, operation, key):
    with pytest.raises(ValueError, match="media key"):
        operation(arranged.store, key)


@pytest.mark.parametrize(
    "operation",
    [
        lambda store: store.put_original(ORIGINAL_KEY, b"data", "image/png"),
        lambda store: store.put_public(PAGE_KEY, b"data", "image/jpeg"),
        lambda store: store.read_original(ORIGINAL_KEY),
    ],
    ids=["put_original", "put_public", "read_original"],
)
def test_storage_failures_are_infrastructure_errors(arranged, operation):
    arranged.break_storage()

    with pytest.raises(InfrastructureError):
        operation(arranged.store)
