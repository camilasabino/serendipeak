import re

SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
RESERVED_SLUGS = frozenset({"today", "random"})

_SLUG_REGEX = re.compile(SLUG_PATTERN)


def is_valid_slug(slug: str) -> bool:
    return _SLUG_REGEX.fullmatch(slug) is not None and slug not in RESERVED_SLUGS
