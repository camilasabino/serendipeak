import logging

LOGGER = logging.getLogger("serendipeak.security")

LOGIN_SUCCEEDED = "login_succeeded"
LOGIN_FAILED = "login_failed"
LOGIN_THROTTLED = "login_throttled"
LOGOUT = "logout"
PASSWORD_CHANGED = "password_changed"
PASSWORD_CHANGE_REFUSED = "password_change_refused"
ACCESS_DENIED = "access_denied"
UNDECLARED_VIEW = "undeclared_view"
CSRF_FAILED = "csrf_failed"

WARNING_EVENTS = frozenset(
    {LOGIN_FAILED, LOGIN_THROTTLED, PASSWORD_CHANGE_REFUSED, ACCESS_DENIED, CSRF_FAILED}
)


def log_security_event(event: str, **fields: object) -> None:
    """Write one structured line: an event name and identifiers, never a credential.

    Callers pass user ids, roles, digests of typed usernames, addresses and request paths. A
    typed username is never passed raw because a mistyped password often lands in that field.
    """
    level = logging.ERROR if event == UNDECLARED_VIEW else logging.INFO
    if event in WARNING_EVENTS:
        level = logging.WARNING
    LOGGER.log(level, event, extra={"fields": fields})
