import re
import unicodedata
from enum import StrEnum

SUMMARY_MAX_LENGTH = 200

_HIDDEN_CHARACTERS = frozenset({"​", "﻿"})
_LINE_SEPARATORS = frozenset({" ", " "})
_MARKUP_CHARACTERS = ("<", ">", "`", "](")
_CHARACTER_REFERENCE = re.compile(r"&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);")

_LOWERCASE_WORD_EXCEPTIONS = frozenset(
    {
        "al", "ap", "bin", "d", "da", "das", "de", "del", "della", "delle", "den", "der", "des",
        "di", "do", "dos", "du", "el", "ibn", "il", "l", "la", "las", "le", "les", "lo", "los",
        "ter", "ten", "van", "von", "zu", "zum", "zur",
        "cm", "ft", "ha", "kg", "km", "m", "mi", "mm", "yd",
    }
)  # fmt: skip
_DANGLING_WORDS = frozenset(
    {
        "a", "above", "across", "along", "an", "and", "around", "as", "at", "below", "beside",
        "between", "but", "by", "for", "from", "in", "into", "near", "nor", "of", "on", "or",
        "over", "per", "than", "the", "to", "under", "via", "with", "within", "without",
    }
)  # fmt: skip
_SENTENCE_END_CHARACTERS = frozenset(".!?…。！？｡؟‼⁇⁈⁉")
_SPACED_DASHES = (" - ", " – ", " — ")
_SUPPORTED_SCRIPTS = frozenset({"LATIN", "GREEK", "CYRILLIC"})


class SummaryViolation(StrEnum):
    BLANK = "blank"
    NOT_TRIMMED = "not_trimmed"
    CONTROL_CHARACTER = "control_character"
    HIDDEN_CHARACTER = "hidden_character"
    TOO_LONG = "too_long"
    MARKUP = "markup"
    NOT_SENTENCE_FORM = "not_sentence_form"


def summary_violations(text: str) -> tuple[SummaryViolation, ...]:
    """Return why a curated summary breaks the v1 rules; empty means it is acceptable.

    The first six rules are the v1 loader's; the last is the v1 importer's requirement that an
    approved text already equals its formatted form.
    """
    trimmed = _trim(text)
    if not trimmed:
        return (SummaryViolation.BLANK,)

    violations = []

    if trimmed != text:
        violations.append(SummaryViolation.NOT_TRIMMED)
    if any(_is_line_break_or_control(character) for character in text):
        violations.append(SummaryViolation.CONTROL_CHARACTER)
    if any(character in _HIDDEN_CHARACTERS for character in trimmed):
        violations.append(SummaryViolation.HIDDEN_CHARACTER)
    if len(text) > SUMMARY_MAX_LENGTH:
        violations.append(SummaryViolation.TOO_LONG)
    if _has_markup(text):
        violations.append(SummaryViolation.MARKUP)
    if trimmed == text and normalize_summary(text) != text:
        violations.append(SummaryViolation.NOT_SENTENCE_FORM)

    return tuple(violations)


def normalize_summary(description: str) -> str:
    """Format a description the way the v1 importer does: spacing, first letter and final period.

    It changes formatting only, never words, and it is idempotent.
    """
    text = _trim(description)
    if not text:
        return ""

    return _terminate(_capitalize_first_word(text))


def _is_incidental_space(character: str) -> bool:
    return character.isspace() or character in _HIDDEN_CHARACTERS


def _trim(text: str) -> str:
    start = 0
    end = len(text)
    while start < end and _is_incidental_space(text[start]):
        start += 1
    while end > start and _is_incidental_space(text[end - 1]):
        end -= 1

    return text[start:end]


def _is_line_break_or_control(character: str) -> bool:
    return unicodedata.category(character) == "Cc" or character in _LINE_SEPARATORS


def _has_markup(text: str) -> bool:
    return any(marker in text for marker in _MARKUP_CHARACTERS) or bool(
        _CHARACTER_REFERENCE.search(text)
    )


def _is_letter(character: str) -> bool:
    return unicodedata.category(character).startswith("L")


def _is_mark(character: str) -> bool:
    return unicodedata.category(character).startswith("M")


def _is_punctuation(character: str) -> bool:
    return unicodedata.category(character).startswith("P")


def _is_cased_upper(character: str) -> bool:
    return unicodedata.category(character) in ("Lu", "Lt")


def _capitalize_first_word(text: str) -> str:
    first = text[0]
    if unicodedata.category(first) != "Ll":
        return text

    word, rest = _split_first_word(text)
    if not _is_safe_to_capitalize(word, rest):
        return text

    title = first.title()
    if len(title) != 1 or title == first:
        return text

    return title + text[1:]


def _split_first_word(text: str) -> tuple[str, str]:
    for index, character in enumerate(text):
        if _is_letter(character) or _is_mark(character) or character in "'’":
            continue
        if character == "-" and index + 1 < len(text) and _is_letter(text[index + 1]):
            continue

        return text[:index], text[index:]

    return text, ""


def _is_safe_to_capitalize(word: str, rest: str) -> bool:
    if rest and not (rest[0].isspace() or _is_punctuation(rest[0])):
        return False
    if any(_is_cased_upper(character) for character in word):
        return False
    if len(word) == 1 and word != "a":
        return False

    segment = word.replace("’", "'").split("-", 1)[0].split("'", 1)[0]

    return segment not in _LOWERCASE_WORD_EXCEPTIONS


def _terminate(text: str) -> str:
    if len(text.split()) < 2 or not _is_single_sentence_descriptor(text):
        return text

    last = text[-1]
    if last in ")]":
        if text[-2] in _SENTENCE_END_CHARACTERS:
            return text
    elif _is_letter(last) or _is_mark(last) or unicodedata.category(last) == "Nd":
        if text.split()[-1].lower() in _DANGLING_WORDS:
            return text
    else:
        return text

    return text + "."


def _is_single_sentence_descriptor(text: str) -> bool:
    if ";" in text or ":" in text:
        return False
    if any(separator in text for separator in _SPACED_DASHES):
        return False

    letters = 0
    parentheses = 0
    brackets = 0

    for character in text:
        if character == "\t":
            pass
        elif _is_line_break_or_control(character):
            return False
        elif character == "(":
            parentheses += 1
        elif character == ")":
            parentheses -= 1
        elif character == "[":
            brackets += 1
        elif character == "]":
            brackets -= 1
        elif _is_letter(character) and unicodedata.category(character) != "Lm":
            if not _in_supported_script(character):
                return False
            letters += 1

        if parentheses < 0 or brackets < 0:
            return False

    return letters > 0 and parentheses == 0 and brackets == 0


def _in_supported_script(character: str) -> bool:
    # The standard library has no script property; a letter's name carries its script, after a
    # prefix word for decorated forms such as fullwidth Latin.
    return any(word in _SUPPORTED_SCRIPTS for word in unicodedata.name(character, "").split())
