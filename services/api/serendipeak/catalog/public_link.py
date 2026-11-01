import re

# PostgreSQL's \s follows the database locale and misses characters such as U+00A0
# that Python's \s rejects, so the whitespace set is spelled out. The same text is
# evaluated by Python and as a POSIX ARE by the CHECK constraints; both engines
# understand \uXXXX inside brackets. The scheme is case-sensitive on purpose.
_WHITESPACE_CODE_POINTS = (
    (0x0009, 0x000D),
    (0x001C, 0x0020),
    (0x0085, 0x0085),
    (0x00A0, 0x00A0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
)
_WHITESPACE = "".join(f"\\u{first:04x}-\\u{last:04x}" for first, last in _WHITESPACE_CODE_POINTS)
PUBLIC_LINK_PATTERN = rf"^https://[^{_WHITESPACE}/?#@]+([/?#][^{_WHITESPACE}]*)?$"

_PUBLIC_LINK_REGEX = re.compile(PUBLIC_LINK_PATTERN)


def is_public_link(value: str) -> bool:
    return _PUBLIC_LINK_REGEX.fullmatch(value) is not None
