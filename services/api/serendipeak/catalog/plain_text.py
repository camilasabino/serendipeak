import re
import unicodedata

HIDDEN_CHARACTERS = frozenset({"​", "﻿"})
LINE_SEPARATORS = frozenset({" ", " "})

_MARKUP_CHARACTERS = ("<", ">", "`", "](")
_CHARACTER_REFERENCE = re.compile(r"&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);")


def trim(text: str) -> str:
    """Strip whitespace and the zero-width characters that hide next to it from both ends."""
    start = 0
    end = len(text)
    while start < end and _is_incidental_space(text[start]):
        start += 1
    while end > start and _is_incidental_space(text[end - 1]):
        end -= 1

    return text[start:end]


def has_hidden_character(text: str) -> bool:
    return any(character in HIDDEN_CHARACTERS for character in text)


def has_markup(text: str) -> bool:
    return any(marker in text for marker in _MARKUP_CHARACTERS) or bool(
        _CHARACTER_REFERENCE.search(text)
    )


def is_line_break_or_control(character: str) -> bool:
    return unicodedata.category(character) == "Cc" or character in LINE_SEPARATORS


def _is_incidental_space(character: str) -> bool:
    return character.isspace() or character in HIDDEN_CHARACTERS
