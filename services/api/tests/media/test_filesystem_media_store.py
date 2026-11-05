import pytest

from serendipeak.errors import InfrastructureError
from serendipeak.media.filesystem_media_store import FilesystemMediaStore

DIGEST = "ef" * 32
ORIGINAL_KEY = f"photographs/{DIGEST}/original.jpg"
PAGE_KEY = f"photographs/{DIGEST}/page-r1.jpg"


def test_originals_and_public_objects_live_in_separate_directories(tmp_path):
    store = FilesystemMediaStore(tmp_path)

    store.put_original(ORIGINAL_KEY, b"original", "image/jpeg")
    store.put_public(PAGE_KEY, b"page", "image/jpeg")

    assert (tmp_path / "originals" / ORIGINAL_KEY).read_bytes() == b"original"
    assert (tmp_path / "public" / PAGE_KEY).read_bytes() == b"page"
    assert not (tmp_path / "public" / ORIGINAL_KEY).exists()


def test_a_write_leaves_no_temporary_file_behind(tmp_path):
    FilesystemMediaStore(tmp_path).put_public(PAGE_KEY, b"page", "image/jpeg")

    assert [path.name for path in (tmp_path / "public" / "photographs" / DIGEST).iterdir()] == [
        "page-r1.jpg"
    ]


def test_a_failed_write_leaves_neither_the_object_nor_a_temporary_file(tmp_path, monkeypatch):
    def failing_replace(source, destination):
        raise OSError("disk full")

    monkeypatch.setattr("serendipeak.media.atomic_file.os.replace", failing_replace)
    store = FilesystemMediaStore(tmp_path)

    with pytest.raises(InfrastructureError):
        store.put_public(PAGE_KEY, b"page", "image/jpeg")

    assert list((tmp_path / "public" / "photographs" / DIGEST).iterdir()) == []


def test_a_key_leading_outside_the_media_directory_through_a_link_is_refused(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (tmp_path / "media" / "originals" / "photographs").mkdir(parents=True)
    (tmp_path / "media" / "originals" / "photographs" / DIGEST).symlink_to(outside)
    store = FilesystemMediaStore(tmp_path / "media")

    with pytest.raises(InfrastructureError):
        store.put_original(ORIGINAL_KEY, b"original", "image/jpeg")

    assert list(outside.iterdir()) == []
