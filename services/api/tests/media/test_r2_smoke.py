import hashlib
import secrets
import urllib.error
import urllib.request

import pytest

from config.composition import build_media_store
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.media.s3_media_store import PUBLIC_CACHE_CONTROL

pytestmark = pytest.mark.r2_smoke

# Every run uses fresh content-addressed keys, so it proves real writes rather than skips.
# The few bytes it leaves in the development buckets are never referenced by a photograph.
DATA = b"serendipeak r2 smoke test " + secrets.token_hex(16).encode()
DIGEST = hashlib.sha256(DATA).hexdigest()
ORIGINAL_KEY = keys.original_key(DIGEST, PhotographFormat.JPEG)
PUBLIC_KEY = keys.page_key(DIGEST)


@pytest.fixture(scope="module")
def store():
    from django.conf import settings

    if settings.MEDIA_STORE != "s3":
        pytest.fail("the R2 smoke test needs MEDIA_STORE=s3 and the development buckets")

    return build_media_store()


def public_get(key):
    from django.conf import settings

    request = urllib.request.Request(
        f"{settings.MEDIA_PUBLIC_BASE_URL}/{key}",
        headers={"User-Agent": "SerendiPeakR2SmokeTest/1"},
    )
    return urllib.request.urlopen(request, timeout=30)


def test_an_original_is_stored_and_read_back_from_the_private_bucket(store):
    assert not store.has_original(ORIGINAL_KEY)

    store.put_original(ORIGINAL_KEY, DATA, "image/jpeg")
    store.put_original(ORIGINAL_KEY, b"never written", "image/jpeg")

    assert store.has_original(ORIGINAL_KEY)
    assert not store.has_public(ORIGINAL_KEY)
    assert store.read_original(ORIGINAL_KEY) == DATA


def test_an_original_is_not_reachable_through_the_public_base_url(store):
    store.put_original(ORIGINAL_KEY, DATA, "image/jpeg")

    with pytest.raises(urllib.error.HTTPError) as raised:
        public_get(ORIGINAL_KEY)

    assert raised.value.code == 404


def test_a_public_object_is_served_with_its_type_and_immutable_caching(store):
    store.put_public(PUBLIC_KEY, DATA, "image/jpeg")

    assert store.has_public(PUBLIC_KEY)
    assert not store.has_original(PUBLIC_KEY)
    with public_get(PUBLIC_KEY) as response:
        assert response.status == 200
        assert response.headers["Content-Type"] == "image/jpeg"
        assert response.headers["Cache-Control"] == PUBLIC_CACHE_CONTROL
        assert response.read() == DATA
