import ipaddress

from django.http import HttpRequest

UNKNOWN_ADDRESS = "unknown"


def client_address(request: HttpRequest, trusted_proxy_hops: int) -> str:
    """Return the address of the client, or the proxy's when no proxy is trusted.

    X-Forwarded-For is client-controlled except for the entries that trusted proxies appended, so
    the entry that many places from the right is the only one worth reading. With no trusted
    proxy the header is ignored: honoring it would let anyone choose the address that is counted.
    """
    candidate = request.META.get("REMOTE_ADDR", "")
    if trusted_proxy_hops > 0:
        forwarded = [
            entry.strip()
            for entry in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
            if entry.strip()
        ]
        if len(forwarded) >= trusted_proxy_hops:
            candidate = forwarded[-trusted_proxy_hops]

    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return UNKNOWN_ADDRESS
