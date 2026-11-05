import io
from urllib.parse import unquote, urlsplit

from botocore.awsrequest import AWSResponse

from serendipeak.media.s3_media_store import s3_client

ENDPOINT_URL = "https://account.r2.cloudflarestorage.test"
PUBLIC_BUCKET = "photographs-public"
ORIGINALS_BUCKET = "photographs-originals"

_NOT_FOUND = b"<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>"


class _Raw:
    def __init__(self, body):
        self._body = io.BytesIO(body)

    def stream(self, **_):
        yield self._body.read()

    def read(self, amount=None):
        return self._body.read(amount)


class InMemoryS3:
    """An S3 endpoint answering botocore's own HTTP requests, so no request leaves the process.

    The real client still serializes every request and parses every response, which keeps
    headers, error codes and retries honest without a network or an S3 emulator.
    """

    def __init__(self):
        self.buckets = {PUBLIC_BUCKET: {}, ORIGINALS_BUCKET: {}}
        self.requests = []
        self.failure_status = None
        self.client = s3_client(
            endpoint_url=ENDPOINT_URL,
            access_key_id="test-access-key",
            secret_access_key="test-secret-key",
        )
        self.client.meta.events.register("before-send.s3", self._answer)

    def object(self, bucket, key):
        return self.buckets[bucket].get(key)

    def _answer(self, request, **_):
        path = urlsplit(request.url).path
        bucket, _, key = unquote(path).lstrip("/").partition("/")
        headers = {name.lower(): _text(value) for name, value in request.headers.items()}
        self.requests.append((request.method, bucket, key, headers))

        if self.failure_status is not None:
            return _response(request.url, self.failure_status)

        objects = self.buckets[bucket]
        if request.method == "PUT":
            objects[key] = (_decoded_body(request.body, headers), headers)
            return _response(request.url, 200)
        if key not in objects:
            body = b"" if request.method == "HEAD" else _NOT_FOUND
            return _response(request.url, 404, body)

        data, stored_headers = objects[key]
        response_headers = {
            "Content-Length": str(len(data)),
            "Content-Type": stored_headers.get("content-type", "binary/octet-stream"),
        }
        body = b"" if request.method == "HEAD" else data

        return _response(request.url, 200, body, response_headers)


def _response(url, status, body=b"", headers=None):
    return AWSResponse(url, status, headers or {}, _Raw(body))


def _text(value):
    return value.decode() if isinstance(value, bytes) else value


def _decoded_body(body, headers):
    raw = body.read() if hasattr(body, "read") else body or b""
    if headers.get("content-encoding") != "aws-chunked":
        return raw

    data = b""
    while True:
        size_line, _, raw = raw.partition(b"\r\n")
        size = int(size_line.split(b";")[0], 16)
        if size == 0:
            return data
        data += raw[:size]
        raw = raw[size + 2 :]
