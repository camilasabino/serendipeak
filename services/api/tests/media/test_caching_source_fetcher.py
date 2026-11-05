import hashlib

import pytest

from serendipeak.errors import InfrastructureError
from serendipeak.media.caching_source_fetcher import CachingSourceImageFetcher
from tests.support.fakes import FakeSourceImageFetcher

URL = "https://upload.wikimedia.org/wikipedia/commons/1/1b/Fuji.jpg"


def test_the_first_fetch_downloads_and_keeps_a_copy(tmp_path):
    inner = FakeSourceImageFetcher({URL: b"fuji"})
    cache = tmp_path / "cache"

    assert CachingSourceImageFetcher(inner, cache).fetch(URL) == b"fuji"

    copy = cache / hashlib.sha256(URL.encode()).hexdigest()
    assert copy.read_bytes() == b"fuji"
    assert [path.name for path in cache.iterdir()] == [copy.name]


def test_later_fetches_read_the_copy_without_downloading(tmp_path):
    CachingSourceImageFetcher(FakeSourceImageFetcher({URL: b"fuji"}), tmp_path).fetch(URL)
    offline = FakeSourceImageFetcher()

    assert CachingSourceImageFetcher(offline, tmp_path).fetch(URL) == b"fuji"
    assert offline.fetched == []


def test_a_failed_download_leaves_no_copy(tmp_path):
    inner = FakeSourceImageFetcher(failures={URL: InfrastructureError("down")})

    with pytest.raises(InfrastructureError):
        CachingSourceImageFetcher(inner, tmp_path).fetch(URL)

    assert list(tmp_path.iterdir()) == []


def test_an_unreadable_copy_is_an_infrastructure_error(tmp_path):
    (tmp_path / hashlib.sha256(URL.encode()).hexdigest()).mkdir()

    with pytest.raises(InfrastructureError, match="cached copy"):
        CachingSourceImageFetcher(FakeSourceImageFetcher(), tmp_path).fetch(URL)
