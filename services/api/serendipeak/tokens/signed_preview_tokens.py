from datetime import UTC, datetime, timedelta
from uuid import UUID

from django.core import signing

PREVIEW_LIFETIME = timedelta(minutes=15)
# A token is a few hundred bytes at most; anything longer is refused before it is parsed.
MAX_TOKEN_LENGTH = 512
# Separates these tokens from every other value signed with Django's signer, whatever the key.
SALT = "serendipeak.preview-token.v1"
SCOPE = "mountain-preview"


class SignedPreviewTokens:
    """Stateless preview tokens: a signed mountain id, a scope and an expiry.

    The expiry is carried in the payload and judged against the instant the caller passes, rather
    than with the signer's own clock, so the lifetime is decided in one place and can be tested.
    """

    def __init__(self, key: str, lifetime: timedelta = PREVIEW_LIFETIME):
        self._key = key
        self._lifetime = lifetime

    def issue(self, mountain_id: UUID, now: datetime) -> str:
        payload = {
            "mountain": str(mountain_id),
            "scope": SCOPE,
            "expires": int((now + self._lifetime).timestamp()),
        }

        return signing.dumps(payload, key=self._key, salt=SALT, compress=False)

    def verify(self, token: str, now: datetime) -> UUID | None:
        if not token or len(token) > MAX_TOKEN_LENGTH:
            return None

        try:
            payload = signing.loads(token, key=self._key, salt=SALT)
            if payload["scope"] != SCOPE:
                return None
            if datetime.fromtimestamp(payload["expires"], UTC) <= now:
                return None

            return UUID(payload["mountain"])
        except (signing.BadSignature, KeyError, TypeError, ValueError, OverflowError):
            return None
