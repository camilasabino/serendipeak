import pytest
from botocore.exceptions import EndpointConnectionError

from serendipeak.errors import InfrastructureError
from serendipeak.media.s3_media_store import PUBLIC_CACHE_CONTROL, S3MediaStore
from tests.support.s3 import ENDPOINT_URL, ORIGINALS_BUCKET, PUBLIC_BUCKET, InMemoryS3

DIGEST = "cd" * 32
ORIGINAL_KEY = f"photographs/{DIGEST}/original.webp"
VIEWER_KEY = f"photographs/{DIGEST}/viewer-r1.jpg"


@pytest.fixture
def s3():
    return InMemoryS3()


@pytest.fixture
def store(s3):
    return S3MediaStore(s3.client, public_bucket=PUBLIC_BUCKET, originals_bucket=ORIGINALS_BUCKET)


def puts(s3):
    return [request for request in s3.requests if request[0] == "PUT"]


def test_the_client_targets_the_endpoint_with_bounded_timeouts_and_retries(s3):
    config = s3.client.meta.config

    assert s3.client.meta.endpoint_url == ENDPOINT_URL
    assert s3.client.meta.region_name == "auto"
    assert (config.connect_timeout, config.read_timeout) == (5, 60)
    assert config.retries == {"mode": "standard", "total_max_attempts": 3}


def test_connect_builds_a_store_without_contacting_the_endpoint():
    store = S3MediaStore.connect(
        endpoint_url=ENDPOINT_URL,
        access_key_id="access",
        secret_access_key="secret",
        public_bucket=PUBLIC_BUCKET,
        originals_bucket=ORIGINALS_BUCKET,
    )

    assert isinstance(store, S3MediaStore)


def test_an_original_goes_to_the_private_bucket_without_public_caching(s3, store):
    store.put_original(ORIGINAL_KEY, b"original", "image/webp")

    data, headers = s3.object(ORIGINALS_BUCKET, ORIGINAL_KEY)
    assert data == b"original"
    assert headers["content-type"] == "image/webp"
    assert "cache-control" not in headers
    assert s3.object(PUBLIC_BUCKET, ORIGINAL_KEY) is None


def test_a_public_object_is_cached_immutably_for_a_year(s3, store):
    store.put_public(VIEWER_KEY, b"viewer", "image/jpeg")

    data, headers = s3.object(PUBLIC_BUCKET, VIEWER_KEY)
    assert data == b"viewer"
    assert headers["content-type"] == "image/jpeg"
    assert headers["cache-control"] == PUBLIC_CACHE_CONTROL == "public, max-age=31536000, immutable"


def test_no_acl_is_ever_sent(s3, store):
    store.put_original(ORIGINAL_KEY, b"original", "image/webp")
    store.put_public(VIEWER_KEY, b"viewer", "image/jpeg")

    assert all("x-amz-acl" not in headers for *_, headers in puts(s3))


def test_a_put_looks_before_it_writes_and_skips_an_existing_object(s3, store):
    store.put_public(VIEWER_KEY, b"first", "image/jpeg")
    store.put_public(VIEWER_KEY, b"second", "image/jpeg")

    assert [(method, bucket) for method, bucket, *_ in s3.requests] == [
        ("HEAD", PUBLIC_BUCKET),
        ("PUT", PUBLIC_BUCKET),
        ("HEAD", PUBLIC_BUCKET),
    ]
    assert s3.object(PUBLIC_BUCKET, VIEWER_KEY)[0] == b"first"


def test_existence_is_checked_with_head_in_the_right_bucket(s3, store):
    store.has_original(ORIGINAL_KEY)
    store.has_public(VIEWER_KEY)

    assert [request[:3] for request in s3.requests] == [
        ("HEAD", ORIGINALS_BUCKET, ORIGINAL_KEY),
        ("HEAD", PUBLIC_BUCKET, VIEWER_KEY),
    ]


@pytest.mark.parametrize("operation", ["has_original", "has_public"])
def test_a_denied_lookup_is_an_infrastructure_error_not_a_missing_object(s3, store, operation):
    s3.failure_status = 403

    with pytest.raises(InfrastructureError):
        getattr(store, operation)(ORIGINAL_KEY)


def test_transient_server_errors_are_retried_a_bounded_number_of_times(s3, store, monkeypatch):
    monkeypatch.setattr("botocore.endpoint.time.sleep", lambda seconds: None)
    s3.failure_status = 503

    with pytest.raises(InfrastructureError):
        store.has_public(VIEWER_KEY)

    assert len(s3.requests) == 3


def test_an_unreachable_endpoint_is_an_infrastructure_error(s3, store, monkeypatch):
    monkeypatch.setattr("botocore.endpoint.time.sleep", lambda seconds: None)

    def unreachable(**_):
        raise EndpointConnectionError(endpoint_url=ENDPOINT_URL)

    s3.client.meta.events.register_first("before-send.s3", unreachable)

    with pytest.raises(InfrastructureError) as raised:
        store.put_original(ORIGINAL_KEY, b"original", "image/webp")

    assert "secret" not in str(raised.value)
