import email.message
import io
import urllib.error
import urllib.request
import urllib.response

import pytest

from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.errors import InfrastructureError
from serendipeak.media.http_source_fetcher import HttpSourceImageFetcher

URL = "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg?utm_source=x"
MOVED = "https://upload.wikimedia.org/moved.jpg"
LIMIT = 100


class TimingOutBody(io.BytesIO):
    def read(self, *_):
        raise TimeoutError("timed out")


class FakeHttpsHandler(urllib.request.HTTPSHandler):
    """Answers https requests from a table instead of the network."""

    def __init__(self, answers):
        super().__init__()
        self.answers = answers
        self.requests = []

    def https_open(self, request):
        self.requests.append(request)
        answer = self.answers[request.full_url]
        if isinstance(answer, BaseException):
            raise answer

        status, headers, body = answer
        message = email.message.Message()
        for name, value in headers.items():
            message[name] = value
        fp = body if isinstance(body, io.IOBase) else io.BytesIO(body)
        response = urllib.response.addinfourl(fp, message, request.full_url, status)
        response.msg = "answer"

        return response


def fetcher(answers):
    handler = FakeHttpsHandler(answers)
    return (
        HttpSourceImageFetcher(
            max_bytes=LIMIT,
            user_agent="SerendiPeakTest/1",
            timeout_seconds=5,
            allowed_hosts=["upload.wikimedia.org"],
            handlers=[handler],
        ),
        handler,
    )


def test_the_body_of_a_200_answer_is_returned_with_a_descriptive_user_agent():
    subject, handler = fetcher({URL: (200, {"Content-Type": "text/html"}, b"image bytes")})

    assert subject.fetch(URL) == b"image bytes"
    assert handler.requests[0].get_header("User-agent") == "SerendiPeakTest/1"


def test_an_https_redirect_is_followed():
    subject, _ = fetcher({URL: (302, {"Location": MOVED}, b""), MOVED: (200, {}, b"moved bytes")})

    assert subject.fetch(URL) == b"moved bytes"


@pytest.mark.parametrize("target", ["http://upload.wikimedia.org/a.jpg", "ftp://example.com/a"])
def test_a_redirect_away_from_https_is_refused(target):
    subject, handler = fetcher({URL: (301, {"Location": target}, b"")})

    with pytest.raises(InfrastructureError, match="non-https"):
        subject.fetch(URL)

    assert [request.full_url for request in handler.requests] == [URL]


def test_a_url_that_is_not_https_is_refused_without_a_request():
    subject, handler = fetcher({})

    with pytest.raises(InfrastructureError, match="not an https URL"):
        subject.fetch("http://upload.wikimedia.org/a.jpg")

    assert handler.requests == []


@pytest.mark.parametrize(
    "url",
    [
        "https://internal.example/a.jpg",
        "https://upload.wikimedia.org.example.com/a.jpg",
        "https://upload.wikimedia.org@example.com/a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://upload.wikimedia.org:8443/a.jpg",
    ],
)
def test_a_url_on_another_host_or_port_is_refused_without_a_request(url):
    subject, handler = fetcher({})

    with pytest.raises(InfrastructureError, match="not on an authorized host"):
        subject.fetch(url)

    assert handler.requests == []


def test_hosts_are_compared_without_regard_to_case():
    subject, _ = fetcher({"https://UPLOAD.wikimedia.org/a.jpg": (200, {}, b"bytes")})

    assert subject.fetch("https://UPLOAD.wikimedia.org/a.jpg") == b"bytes"


@pytest.mark.parametrize(
    "target",
    [
        "https://example.com/a.jpg",
        "https://169.254.169.254/latest/meta-data",
        "https://upload.wikimedia.org:8443/a.jpg",
    ],
)
def test_a_redirect_to_another_host_is_refused_before_following_it(target):
    subject, handler = fetcher({URL: (302, {"Location": target}, b"")})

    with pytest.raises(InfrastructureError, match="not an authorized host"):
        subject.fetch(URL)

    assert [request.full_url for request in handler.requests] == [URL]


@pytest.mark.parametrize("status", [404, 500, 503])
def test_an_error_status_fails_the_download(status):
    subject, _ = fetcher({URL: (status, {}, b"error page")})

    with pytest.raises(InfrastructureError, match=f"HTTP {status}"):
        subject.fetch(URL)


def test_a_success_status_other_than_200_fails_the_download():
    subject, _ = fetcher({URL: (206, {}, b"partial")})

    with pytest.raises(InfrastructureError, match="HTTP 206"):
        subject.fetch(URL)


def test_a_body_over_the_limit_is_cut_mid_stream():
    subject, _ = fetcher({URL: (200, {}, b"x" * (LIMIT + 1))})

    with pytest.raises(PhotographRejected) as raised:
        subject.fetch(URL)

    assert raised.value.reason is PhotographRejection.TOO_MANY_BYTES


def test_a_body_at_the_limit_is_accepted():
    subject, _ = fetcher({URL: (200, {}, b"x" * LIMIT)})

    assert len(subject.fetch(URL)) == LIMIT


def test_an_announced_length_over_the_limit_is_refused_before_reading():
    body = TimingOutBody()
    subject, _ = fetcher({URL: (200, {"Content-Length": str(LIMIT + 1)}, body)})

    with pytest.raises(PhotographRejected):
        subject.fetch(URL)


def test_a_connection_timeout_fails_the_download():
    subject, _ = fetcher({URL: urllib.error.URLError(TimeoutError("timed out"))})

    with pytest.raises(InfrastructureError, match="could not be downloaded") as raised:
        subject.fetch(URL)

    assert isinstance(raised.value.__cause__, urllib.error.URLError)


def test_a_read_timeout_fails_the_download():
    subject, _ = fetcher({URL: (200, {}, TimingOutBody())})

    with pytest.raises(InfrastructureError, match="could not be downloaded") as raised:
        subject.fetch(URL)

    assert isinstance(raised.value.__cause__, TimeoutError)
