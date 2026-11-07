import re

USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,31}$"
USERNAME_RULE = (
    "Use 3 to 32 lowercase letters, digits, dots, hyphens or underscores, "
    "starting with a letter or digit."
)

_USERNAME_REGEX = re.compile(USERNAME_PATTERN)


def is_valid_username(username: str) -> bool:
    return _USERNAME_REGEX.fullmatch(username) is not None
