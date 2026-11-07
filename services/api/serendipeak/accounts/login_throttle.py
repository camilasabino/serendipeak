import hashlib
from dataclasses import dataclass
from datetime import timedelta

from serendipeak.accounts.clock import Clock
from serendipeak.accounts.ports import LoginAttemptLog

LOGIN_ATTEMPT_WINDOW = timedelta(minutes=15)
USERNAME_ATTEMPT_LIMIT = 5
# Higher than the per-username limit because one address can be an office or a mobile network
# shared by several legitimate users; the per-username limit is what stops a targeted guess.
ADDRESS_ATTEMPT_LIMIT = 20


def username_key(username: str) -> str:
    """Identify a typed username without storing it.

    The sign-in field is where a mistyped password most often lands, so the log keeps a digest.
    Sign-in ignores case, so the digest does too.
    """
    return hashlib.sha256(username.strip().casefold().encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class LoginAdmission:
    admitted: bool
    key: str


class AdmitLoginAttempt:
    """Counts a sign-in attempt before the password is checked and refuses it over a limit.

    The attempt is stored first and counted after, so concurrent guesses each see every attempt
    committed before them and at most the limit are admitted. A refused attempt is removed again:
    otherwise an attacker retrying more often than the window would keep a username locked for as
    long as they like instead of for one window.
    """

    def __init__(self, attempts: LoginAttemptLog, clock: Clock):
        self._attempts = attempts
        self._clock = clock

    def execute(self, username: str, address: str) -> LoginAdmission:
        key = username_key(username)
        now = self._clock.now()
        recorded = self._attempts.record(
            username_key=key,
            address=address,
            at=now,
            window_start=now - LOGIN_ATTEMPT_WINDOW,
        )
        admitted = (
            recorded.by_username <= USERNAME_ATTEMPT_LIMIT
            and recorded.by_address <= ADDRESS_ATTEMPT_LIMIT
        )
        if not admitted:
            self._attempts.discard(recorded.attempt_id)

        return LoginAdmission(admitted=admitted, key=key)


class ClearLoginFailures:
    """Forgets the attempts counted against a username once its owner has signed in.

    Attempts counted against the address stay: signing in to one's own account must not reset the
    allowance of an address that is guessing other accounts.
    """

    def __init__(self, attempts: LoginAttemptLog):
        self._attempts = attempts

    def execute(self, username: str) -> None:
        self._attempts.forget_username(username_key(username))
