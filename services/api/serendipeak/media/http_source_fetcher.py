import urllib.error
import urllib.request
from collections.abc import Collection, Sequence
from http.client import HTTPException
from urllib.parse import urlsplit

from serendipeak.catalog.errors import PhotographRejected, PhotographRejection
from serendipeak.errors import InfrastructureError

_CHUNK_BYTES = 1024 * 1024


class _InsecureRedirect(Exception):
    pass


class _UnauthorizedRedirect(Exception):
    pass


def _is_authorized(url: str, hosts: frozenset[str]) -> bool:
    parts = urlsplit(url)

    return parts.scheme == "https" and parts.hostname in hosts and parts.port in (None, 443)


class _AuthorizedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, hosts: frozenset[str]):
        super().__init__()
        self._hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != "https":
            raise _InsecureRedirect(newurl)
        if not _is_authorized(newurl, self._hosts):
            raise _UnauthorizedRedirect(newurl)

        return super().redirect_request(req, fp, code, msg, headers, newurl)


class HttpSourceImageFetcher:
    """Downloads source image files over https with the standard library.

    Only allowed_hosts are contacted, on the https port, redirects included: the URL comes from
    the catalog, where an editor can type any address, and this client runs on an operator's
    network. The response Content-Type is not trusted: ingestion decides from the decoded content.
    handlers replace urllib's transport handlers, which lets tests answer without a network.
    """

    def __init__(
        self,
        *,
        max_bytes: int,
        user_agent: str,
        timeout_seconds: float,
        allowed_hosts: Collection[str],
        handlers: Sequence[urllib.request.BaseHandler] = (),
    ):
        self._max_bytes = max_bytes
        self._user_agent = user_agent
        self._timeout_seconds = timeout_seconds
        self._allowed_hosts = frozenset(host.lower() for host in allowed_hosts)
        self._opener = urllib.request.build_opener(
            _AuthorizedRedirectHandler(self._allowed_hosts), *handlers
        )

    def fetch(self, url: str) -> bytes:
        if urlsplit(url).scheme != "https":
            raise InfrastructureError(f"{url} is not an https URL")
        if not _is_authorized(url, self._allowed_hosts):
            raise InfrastructureError(f"{url} is not on an authorized host")

        request = urllib.request.Request(url, headers={"User-Agent": self._user_agent})

        try:
            with self._opener.open(request, timeout=self._timeout_seconds) as response:
                if response.status != 200:
                    raise InfrastructureError(f"the source answered HTTP {response.status}")
                return self._read(response)
        except urllib.error.HTTPError as error:
            error.close()
            raise InfrastructureError(f"the source answered HTTP {error.code}") from error
        except _InsecureRedirect as error:
            raise InfrastructureError(
                f"the source redirected to a non-https URL {error}"
            ) from error
        except _UnauthorizedRedirect as error:
            raise InfrastructureError(
                f"the source redirected to {error}, which is not an authorized host"
            ) from error
        except (HTTPException, OSError) as error:
            raise InfrastructureError("the source could not be downloaded") from error

    def _read(self, response) -> bytes:
        declared = response.headers.get("Content-Length")
        if declared is not None and declared.isdigit() and int(declared) > self._max_bytes:
            raise PhotographRejected(PhotographRejection.TOO_MANY_BYTES)

        # Read in chunks so a body larger than announced, or announced not at all, stops at
        # the limit instead of being held in memory whole.
        body = bytearray()
        while chunk := response.read(_CHUNK_BYTES):
            body.extend(chunk)
            if len(body) > self._max_bytes:
                raise PhotographRejected(PhotographRejection.TOO_MANY_BYTES)

        return bytes(body)
