import re
from enum import StrEnum

from serendipeak.catalog.plain_text import (
    has_hidden_character,
    has_markup,
    is_line_break_or_control,
    trim,
)

DESCRIPTION_MAX_WORDS = 350

_LINE_BREAKS = re.compile(r"\r\n?")
_BLANK_LINE_RUN = re.compile(r"\n{3,}")
_TRAILING_SPACE = re.compile(r"[^\S\n]+$", re.MULTILINE)


class DescriptionViolation(StrEnum):
    BLANK = "blank"
    NOT_NORMALIZED = "not_normalized"
    CONTROL_CHARACTER = "control_character"
    HIDDEN_CHARACTER = "hidden_character"
    MARKUP = "markup"
    TOO_MANY_WORDS = "too_many_words"


def word_count(text: str) -> int:
    """The words of a text, counted as the whitespace-separated pieces a word processor counts."""
    return len(text.split())


def description_violations(text: str) -> tuple[DescriptionViolation, ...]:
    """Return why a description breaks the rules; empty means it is acceptable.

    A description is plain text: paragraphs are separated by one empty line, and nothing in it is
    markup. Absence is None, never a blank text.
    """
    if not trim(text):
        return (DescriptionViolation.BLANK,)

    violations = []

    if normalize_description(text) != text:
        violations.append(DescriptionViolation.NOT_NORMALIZED)
    if any(_is_forbidden_control(character) for character in text):
        violations.append(DescriptionViolation.CONTROL_CHARACTER)
    if has_hidden_character(text):
        violations.append(DescriptionViolation.HIDDEN_CHARACTER)
    if has_markup(text):
        violations.append(DescriptionViolation.MARKUP)
    if word_count(text) > DESCRIPTION_MAX_WORDS:
        violations.append(DescriptionViolation.TOO_MANY_WORDS)

    return tuple(violations)


def normalize_description(text: str) -> str:
    """Give a description its stored form: line feeds only, no space at the end of a line, one
    empty line between paragraphs and none around the text.

    It changes spacing only, never words, and it is idempotent. Browsers submit a textarea with
    carriage returns, so the Studio applies it before judging.
    """
    unified = _LINE_BREAKS.sub("\n", text)
    spaced = _TRAILING_SPACE.sub("", unified)

    return trim(_BLANK_LINE_RUN.sub("\n\n", spaced))


def _is_forbidden_control(character: str) -> bool:
    # A carriage return is spacing that normalization removes, and is reported as that.
    return character not in "\n\r" and is_line_break_or_control(character)
