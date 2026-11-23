import pytest

from serendipeak.catalog.description import (
    DESCRIPTION_MAX_WORDS,
    DescriptionViolation,
    description_violations,
    normalize_description,
    word_count,
)

PARAGRAPHS = "The first paragraph.\n\nThe second paragraph, with a dash — and an & sign."


def words(count):
    return " ".join(["word"] * count)


def test_the_limit_is_350_words():
    assert DESCRIPTION_MAX_WORDS == 350


@pytest.mark.parametrize(
    ("text", "count"),
    [
        ("", 0),
        ("   \n ", 0),
        ("one", 1),
        ("one two  three\nfour\n\nfive", 5),
        ("well-known peak (6,961 m)", 4),
        ("Aconcagüa — the highest", 4),
    ],
)
def test_words_are_the_whitespace_separated_pieces(text, count):
    assert word_count(text) == count


@pytest.mark.parametrize(
    "text",
    [
        "Short.",
        PARAGRAPHS,
        words(DESCRIPTION_MAX_WORDS),
        "Quotes “smart” and 'plain', (parentheses), 30° slopes; accents: áéíóú ñ & more.",
        "Para one.\n\nPara two.\n\nPara three.",
        "A line\nwith a soft break.",
    ],
)
def test_accepted_descriptions(text):
    assert description_violations(text) == ()


def test_the_word_limit_has_a_boundary():
    assert description_violations(words(DESCRIPTION_MAX_WORDS)) == ()
    assert description_violations(words(DESCRIPTION_MAX_WORDS + 1)) == (
        DescriptionViolation.TOO_MANY_WORDS,
    )


def test_words_in_every_paragraph_count_toward_the_limit():
    half = words(DESCRIPTION_MAX_WORDS // 2)

    assert description_violations(f"{half}\n\n{half}") == ()
    assert DescriptionViolation.TOO_MANY_WORDS in description_violations(f"{half}\n\n{half} extra")


@pytest.mark.parametrize("text", ["", " ", "\n\n", "\t \n", "​", "﻿\n"])
def test_a_blank_description_reports_only_that_it_is_blank(text):
    assert description_violations(text) == (DescriptionViolation.BLANK,)


@pytest.mark.parametrize(
    ("text", "violation"),
    [
        (" Leading.", DescriptionViolation.NOT_NORMALIZED),
        ("Trailing. ", DescriptionViolation.NOT_NORMALIZED),
        ("Trailing.\n", DescriptionViolation.NOT_NORMALIZED),
        ("One.\r\nTwo.", DescriptionViolation.NOT_NORMALIZED),
        ("One.\rTwo.", DescriptionViolation.NOT_NORMALIZED),
        ("One.\n\n\nTwo.", DescriptionViolation.NOT_NORMALIZED),
        ("One. \n\nTwo.", DescriptionViolation.NOT_NORMALIZED),
        ("One.\n \nTwo.", DescriptionViolation.NOT_NORMALIZED),
        ("Tab\there.", DescriptionViolation.CONTROL_CHARACTER),
        ("Null\x00here.", DescriptionViolation.CONTROL_CHARACTER),
        ("Escape\x1bhere.", DescriptionViolation.CONTROL_CHARACTER),
        ("Separator here.", DescriptionViolation.CONTROL_CHARACTER),
        ("Separator here.", DescriptionViolation.CONTROL_CHARACTER),
        ("Hidden​space.", DescriptionViolation.HIDDEN_CHARACTER),
        ("Hidden﻿mark.", DescriptionViolation.HIDDEN_CHARACTER),
        ("A <b>bold</b> claim.", DescriptionViolation.MARKUP),
        ("A <script>alert(1)</script> claim.", DescriptionViolation.MARKUP),
        ("A `code` claim.", DescriptionViolation.MARKUP),
        ("A [link](https://example.com) claim.", DescriptionViolation.MARKUP),
        ("Rock &amp; ice.", DescriptionViolation.MARKUP),
        ("Rock &#38; ice.", DescriptionViolation.MARKUP),
        ("Rock &#x26; ice.", DescriptionViolation.MARKUP),
    ],
)
def test_rejected_descriptions(text, violation):
    assert violation in description_violations(text)


def test_a_carriage_return_is_reported_as_spacing_not_as_a_control_character():
    assert description_violations("One.\r\n\r\nTwo.") == (DescriptionViolation.NOT_NORMALIZED,)


def test_an_ampersand_that_is_not_a_character_reference_is_legitimate_punctuation():
    assert description_violations("Rock & ice, R&D, AT&T and Johnson & Johnson.") == ()
    assert description_violations("Rock & ice; the slope is 30\u00b0 (steep).") == ()


def test_every_violation_is_reported_once_in_a_stable_order():
    text = " <b>x\ty</b> ​" + words(DESCRIPTION_MAX_WORDS)

    assert description_violations(text) == (
        DescriptionViolation.NOT_NORMALIZED,
        DescriptionViolation.CONTROL_CHARACTER,
        DescriptionViolation.HIDDEN_CHARACTER,
        DescriptionViolation.MARKUP,
        DescriptionViolation.TOO_MANY_WORDS,
    )


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("One.\r\n\r\nTwo.", "One.\n\nTwo."),
        ("One.\rTwo.", "One.\nTwo."),
        ("  One.  \n\n\n\n  Two.  ", "One.\n\n  Two."),
        ("One.\n \t \nTwo.", "One.\n\nTwo."),
        ("One.\n\n", "One."),
        ("​ One.​", "One."),
        ("A line\nwith a soft break.", "A line\nwith a soft break."),
        ("", ""),
    ],
)
def test_normalization_changes_spacing_only(text, expected):
    assert normalize_description(text) == expected


@pytest.mark.parametrize(
    "text",
    ["One.\r\n\r\n\r\nTwo. ", PARAGRAPHS, "  \n  ", "a\n\n\n\nb\n \nc", "x​"],
)
def test_normalization_is_idempotent_and_yields_an_unflagged_form(text):
    once = normalize_description(text)

    assert normalize_description(once) == once
    assert DescriptionViolation.NOT_NORMALIZED not in description_violations(once)


def test_normalization_never_changes_the_words():
    text = "Alpha  beta\r\n\r\n\r\ngamma \n delta"

    assert normalize_description(text).split() == text.split()
