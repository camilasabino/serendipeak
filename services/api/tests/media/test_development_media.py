import pytest
from django.core.exceptions import SuspiciousFileOperation
from django.http import Http404
from django.test import RequestFactory

from config.urls import development_media_urlpatterns
from serendipeak.media.filesystem_media_store import FilesystemMediaStore

DIGEST = "12" * 32
PAGE_KEY = f"photographs/{DIGEST}/page-r1.jpg"
ORIGINAL_KEY = f"photographs/{DIGEST}/original.jpg"


def fetch(patterns, url_path):
    (pattern,) = patterns
    match = pattern.resolve(url_path)
    assert match is not None, url_path

    return match.func(RequestFactory().get(f"/{url_path}"), *match.args, **match.kwargs)


@pytest.fixture
def media_root(tmp_path):
    store = FilesystemMediaStore(tmp_path)
    store.put_public(PAGE_KEY, b"page rendition", "image/jpeg")
    store.put_original(ORIGINAL_KEY, b"private original", "image/jpeg")

    return tmp_path


@pytest.mark.parametrize(("debug", "media_store"), [(False, "filesystem"), (True, "s3")])
def test_media_is_only_served_by_django_in_development_from_the_filesystem(
    media_root, debug, media_store
):
    patterns = development_media_urlpatterns(
        debug=debug, media_store=media_store, media_root=media_root
    )

    assert patterns == []


def test_public_renditions_are_served_in_development(media_root):
    patterns = development_media_urlpatterns(
        debug=True, media_store="filesystem", media_root=media_root
    )

    response = fetch(patterns, f"media/{PAGE_KEY}")

    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"page rendition"
    assert response["Content-Type"] == "image/jpeg"


@pytest.mark.parametrize(
    "url_path",
    [
        f"media/{ORIGINAL_KEY}",
        f"media/originals/{ORIGINAL_KEY}",
        f"media/../originals/{ORIGINAL_KEY}",
        f"media/%2e%2e/originals/{ORIGINAL_KEY}",
    ],
)
def test_originals_are_never_served(media_root, url_path):
    patterns = development_media_urlpatterns(
        debug=True, media_store="filesystem", media_root=media_root
    )

    with pytest.raises((Http404, SuspiciousFileOperation)):
        fetch(patterns, url_path)
