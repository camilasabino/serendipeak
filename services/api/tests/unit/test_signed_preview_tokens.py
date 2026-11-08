import uuid
from datetime import UTC, datetime, timedelta

import pytest
from django.core import signing

from serendipeak.tokens.signed_preview_tokens import (
    MAX_TOKEN_LENGTH,
    PREVIEW_LIFETIME,
    SALT,
    SCOPE,
    SignedPreviewTokens,
)

KEY = "k" * 40
NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
MOUNTAIN = uuid.uuid5(uuid.NAMESPACE_URL, "draft-peak")
OTHER = uuid.uuid5(uuid.NAMESPACE_URL, "other-peak")


def tokens(key=KEY):
    return SignedPreviewTokens(key)


def test_a_token_names_the_mountain_it_was_issued_for():
    token = tokens().issue(MOUNTAIN, NOW)

    assert tokens().verify(token, NOW) == MOUNTAIN
    assert tokens().verify(token, NOW) != OTHER


def test_the_lifetime_is_fifteen_minutes():
    assert PREVIEW_LIFETIME == timedelta(minutes=15)


def test_a_token_works_until_its_expiry_and_not_at_it():
    token = tokens().issue(MOUNTAIN, NOW)

    assert tokens().verify(token, NOW + PREVIEW_LIFETIME - timedelta(seconds=1)) == MOUNTAIN
    assert tokens().verify(token, NOW + PREVIEW_LIFETIME) is None
    assert tokens().verify(token, NOW + PREVIEW_LIFETIME + timedelta(hours=1)) is None


def test_a_token_signed_with_another_key_is_refused():
    token = tokens("z" * 40).issue(MOUNTAIN, NOW)

    assert tokens().verify(token, NOW) is None


def test_a_tampered_token_is_refused():
    token = tokens().issue(MOUNTAIN, NOW)
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")

    assert tokens().verify(tampered, NOW) is None


def test_a_payload_swapped_onto_another_mountain_is_refused():
    token = tokens().issue(MOUNTAIN, NOW)
    other = tokens().issue(OTHER, NOW)
    payload, _, _ = other.partition(":")
    _, _, signature_part = token.partition(":")

    assert tokens().verify(f"{payload}:{signature_part}", NOW) is None


def test_a_value_signed_for_another_purpose_with_the_same_key_is_refused():
    payload = {"mountain": str(MOUNTAIN), "scope": SCOPE, "expires": int(NOW.timestamp()) + 600}
    token = signing.dumps(payload, key=KEY, salt="something.else")

    assert tokens().verify(token, NOW) is None


def test_a_token_of_another_scope_is_refused_even_with_the_right_key_and_salt():
    payload = {"mountain": str(MOUNTAIN), "scope": "other", "expires": int(NOW.timestamp()) + 600}
    token = signing.dumps(payload, key=KEY, salt=SALT)

    assert tokens().verify(token, NOW) is None


@pytest.mark.parametrize(
    "payload",
    [
        "text",
        [],
        {},
        {"scope": SCOPE},
        {"scope": SCOPE, "mountain": "not-a-uuid", "expires": 4_000_000_000},
        {"scope": SCOPE, "mountain": str(MOUNTAIN), "expires": "soon"},
        {"scope": SCOPE, "mountain": str(MOUNTAIN), "expires": 10**30},
        {"scope": SCOPE, "mountain": None, "expires": 4_000_000_000},
    ],
)
def test_a_validly_signed_but_malformed_payload_is_refused(payload):
    token = signing.dumps(payload, key=KEY, salt=SALT)

    assert tokens().verify(token, NOW) is None


@pytest.mark.parametrize("token", ["", "x", "a:b:c", "\x00", "💥" * 10, "e30:1abc:sig"])
def test_garbage_is_refused_without_an_error(token):
    assert tokens().verify(token, NOW) is None


def test_an_oversized_token_is_refused_before_it_is_parsed():
    assert tokens().verify("a" * (MAX_TOKEN_LENGTH + 1), NOW) is None


def test_an_issued_token_fits_well_inside_the_size_limit():
    assert len(tokens().issue(MOUNTAIN, NOW)) < MAX_TOKEN_LENGTH // 2
