import pytest
from django.test import RequestFactory

from serendipeak.studio.client_address import UNKNOWN_ADDRESS, client_address

factory = RequestFactory()


def request_from(remote="10.0.0.1", forwarded=None):
    extra = {"REMOTE_ADDR": remote}
    if forwarded is not None:
        extra["HTTP_X_FORWARDED_FOR"] = forwarded

    return factory.get("/", **extra)


def test_without_a_trusted_proxy_the_connection_address_is_used_and_the_header_ignored():
    assert client_address(request_from("203.0.113.7", "198.51.100.1"), 0) == "203.0.113.7"


@pytest.mark.parametrize(
    ("forwarded", "hops", "expected"),
    [
        ("198.51.100.1", 1, "198.51.100.1"),
        ("6.6.6.6, 198.51.100.1", 1, "198.51.100.1"),
        ("198.51.100.1, 192.0.2.5", 2, "198.51.100.1"),
        ("6.6.6.6, 198.51.100.1, 192.0.2.5", 2, "198.51.100.1"),
    ],
)
def test_with_trusted_proxies_the_entry_that_many_places_from_the_right_is_used(
    forwarded, hops, expected
):
    assert client_address(request_from(forwarded=forwarded), hops) == expected


def test_a_header_shorter_than_the_trusted_chain_falls_back_to_the_connection_address():
    assert client_address(request_from("203.0.113.7", "198.51.100.1"), 3) == "203.0.113.7"
    assert client_address(request_from("203.0.113.7"), 1) == "203.0.113.7"


@pytest.mark.parametrize("junk", ["not an address", "999.1.1.1", "1.2.3.4:80"])
def test_an_unparseable_address_is_counted_as_unknown(junk):
    assert client_address(request_from(junk), 0) == UNKNOWN_ADDRESS
    assert client_address(request_from(forwarded=junk), 1) == UNKNOWN_ADDRESS


def test_a_missing_connection_address_is_counted_as_unknown():
    assert client_address(request_from(""), 0) == UNKNOWN_ADDRESS


def test_ipv6_is_normalized():
    assert client_address(request_from("2001:DB8:0:0:0:0:0:1"), 0) == "2001:db8::1"
