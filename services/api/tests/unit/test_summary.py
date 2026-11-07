import pytest

from serendipeak.catalog.summary import (
    SUMMARY_MAX_LENGTH,
    SummaryViolation,
    normalize_summary,
    summary_violations,
)
from tests.support.catalog import committed_seed

CAPITALIZATION = {
    "common noun": ("volcano in Japan.", "Volcano in Japan."),
    "hyphenated word": (
        "third-highest mountain in the world.",
        "Third-highest mountain in the world.",
    ),
    "possessive": ("sweden's highest mountain.", "Sweden's highest mountain."),
    "typographic apostrophe": ("sweden’s highest mountain.", "Sweden’s highest mountain."),
    "first word before a comma": ("volcano, active since 1900.", "Volcano, active since 1900."),
    "latin with diacritic": ("ürümqi's highest peak.", "Ürümqi's highest peak."),
    "combining mark": ("élan peak in Wales.", "Élan peak in Wales."),
    "greek": ("όρος στην Ελλάδα.", "Όρος στην Ελλάδα."),
    "cyrillic": ("гора в России.", "Гора в России."),
    "article": ("a mountain in Peru.", "A mountain in Peru."),
    "already capitalized": ("Highest mountain in Norway.", "Highest mountain in Norway."),
    "acronym": ("NASA-monitored volcano.", "NASA-monitored volcano."),
    "mixed case product word": ("iPhone-shaped rock formation.", "iPhone-shaped rock formation."),
    "leading digit": ("2nd-highest mountain on Earth.", "2nd-highest mountain on Earth."),
    "digit inside the first word": ("k2 base camp.", "k2 base camp."),
    "first word followed by digit": ("peak8848 in Nepal.", "peak8848 in Nepal."),
    "first word with superscript": ("km² of ice.", "km² of ice."),
    "lowercase name particle": ("van Hasselt Peak in Suriname.", "van Hasselt Peak in Suriname."),
    "lowercase particle with dash": ("al-ahmar ridge.", "al-ahmar ridge."),
    "unit as first word": ("km-long ridge in Nepal.", "km-long ridge in Nepal."),
    "single letter other than a": ("x marks the summit.", "x marks the summit."),
    "opening parenthesis": ("(historic) volcano in Italy.", "(historic) volcano in Italy."),
    "opening quote": ('"holy" mountain of Tibet.', '"holy" mountain of Tibet.'),
    "modifier letter okina": ("ʻohi ridge on Maui.", "ʻohi ridge on Maui."),
    "han characters": ("日本の山。", "日本の山。"),
    "arabic": ("جبل في لبنان.", "جبل في لبنان."),
    "latin before han": ("volcano 富士山.", "Volcano 富士山."),
    "letter followed by a slash": ("mountain/volcano in Chile.", "Mountain/volcano in Chile."),
    "single word": ("mountain", "Mountain"),
    "single word already formatted": ("Mountain.", "Mountain."),
}

WHITESPACE = {
    "empty": ("", ""),
    "spaces only": ("   ", ""),
    "line breaks and tabs only": ("\t\r\n ", ""),
    "no-break and ideographic": (" 　", ""),
    "zero-width and byte order": ("​﻿", ""),
    "leading spaces": ("   highest mountain in the Alps", "Highest mountain in the Alps."),
    "trailing spaces": ("highest mountain in the Alps   ", "Highest mountain in the Alps."),
    "zero-width space and BOM": (
        "﻿​highest mountain in the Alps​",
        "Highest mountain in the Alps.",
    ),
    "trailing space after period": (
        "Highest mountain in the Alps. ",
        "Highest mountain in the Alps.",
    ),
    "inner spaces are kept": ("highest  mountain\tin the Alps", "Highest  mountain\tin the Alps."),
}

FINAL_PUNCTUATION = {
    "descriptor gets a period": ("Highest mountain in the Alps", "Highest mountain in the Alps."),
    "exclamation kept": ("Highest mountain in the Alps!", "Highest mountain in the Alps!"),
    "question mark kept": (
        "Is it the highest mountain in the Alps?",
        "Is it the highest mountain in the Alps?",
    ),
    "ellipsis character kept": ("Highest mountain in the Alps…", "Highest mountain in the Alps…"),
    "ideographic stop kept": ("Highest mountain in the Alps。", "Highest mountain in the Alps。"),
    "abbreviation without period": ("Highest mountain in the U.S", "Highest mountain in the U.S."),
    "period inside parenthesis kept": (
        "Highest mountain (see below.)",
        "Highest mountain (see below.)",
    ),
    "parentheses in the wrong order": (
        "Highest )mountain( in Nepal",
        "Highest )mountain( in Nepal",
    ),
    "closing parenthesis": (
        "Highest mountain in the Alps (4808 m)",
        "Highest mountain in the Alps (4808 m).",
    ),
    "closing bracket": (
        "Highest mountain in the Alps [citation needed]",
        "Highest mountain in the Alps [citation needed].",
    ),
    "final number": ("Highest peak in the Alps, 4808", "Highest peak in the Alps, 4808."),
    "final straight quote": (
        'Highest "sacred" mountain "Chomolungma"',
        'Highest "sacred" mountain "Chomolungma"',
    ),
    "final comma": ("Mountain in Nepal,", "Mountain in Nepal,"),
    "final colon": ("Mountain in Nepal:", "Mountain in Nepal:"),
    "dangling article": ("Highest mountain of the", "Highest mountain of the"),
    "dangling conjunction": ("Mountain in Nepal and", "Mountain in Nepal and"),
    "dangling word in upper case": ("Mountain in Nepal AND", "Mountain in Nepal AND"),
    "word that only ends in a stop": ("Mountain in the Andes", "Mountain in the Andes."),
    "unclosed parenthesis": ("Highest mountain (4808 m", "Highest mountain (4808 m"),
    "spaced hyphen": (
        "Mountain - highest peak of Olympus, Greece",
        "Mountain - highest peak of Olympus, Greece",
    ),
    "spaced em dash": ("Mountain — highest peak of Olympus", "Mountain — highest peak of Olympus"),
    "semicolon inside": (
        "Mountain in Pakistan; 9th highest in the world",
        "Mountain in Pakistan; 9th highest in the world",
    ),
    "unspaced en dash is part of name": (
        "Border of New South Wales–Victoria",
        "Border of New South Wales–Victoria.",
    ),
    "line break inside": ("Highest mountain\nin the Alps", "Highest mountain\nin the Alps"),
    "no letters": ("12 34", "12 34"),
    "han characters": ("日本の山", "日本の山"),
    "han characters with latin": ("Volcano 富士山", "Volcano 富士山"),
    "cyrillic": ("Гора в России", "Гора в России."),
    "greek": ("Όρος στην Ελλάδα", "Όρος στην Ελλάδα."),
    "latin with okina": (
        "Volcano on the island of Hawaiʻi",
        "Volcano on the island of Hawaiʻi.",
    ),
}


@pytest.mark.parametrize(
    ("text", "expected"),
    [*CAPITALIZATION.values(), *WHITESPACE.values(), *FINAL_PUNCTUATION.values()],
    ids=[*CAPITALIZATION, *WHITESPACE, *FINAL_PUNCTUATION],
)
def test_normalize_summary_matches_the_legacy_formatter(text, expected):
    assert normalize_summary(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "mountain",
        "​ volcano in Japan ",
        "(historic) volcano",
        "mountain - highest peak",
        "日本の山",
        "Гора в России",
        "peak 4808 m)",
    ],
)
def test_normalize_summary_is_idempotent(text):
    once = normalize_summary(text)

    assert normalize_summary(once) == once


def test_every_committed_summary_is_already_in_sentence_form():
    summaries = [
        entry.mountain.summary.en
        for entry in committed_seed().mountains
        if entry.mountain.summary is not None
    ]

    assert len(summaries) == 73
    assert [text for text in summaries if summary_violations(text)] == []


@pytest.mark.parametrize(
    "text",
    [
        "Highest mountain outside Asia.",
        "2nd-highest mountain on Earth.",
        "Olympus",
        "Mountain; the highest peak of Greece",
        "A" * (SUMMARY_MAX_LENGTH - 1) + ".",
    ],
)
def test_accepted_summaries(text):
    assert summary_violations(text) == ()


@pytest.mark.parametrize(
    ("text", "violation"),
    [
        ("", SummaryViolation.BLANK),
        ("  \t ", SummaryViolation.BLANK),
        ("\u200b", SummaryViolation.BLANK),
        (" Highest mountain.", SummaryViolation.NOT_TRIMMED),
        ("Highest mountain. ", SummaryViolation.NOT_TRIMMED),
        ("Highest mountain.\u200b", SummaryViolation.NOT_TRIMMED),
        ("Highest\nmountain.", SummaryViolation.CONTROL_CHARACTER),
        ("Highest\tmountain.", SummaryViolation.CONTROL_CHARACTER),
        ("Highest\u2028mountain.", SummaryViolation.CONTROL_CHARACTER),
        ("Highest\x00mountain.", SummaryViolation.CONTROL_CHARACTER),
        ("Highest\u200bmountain.", SummaryViolation.HIDDEN_CHARACTER),
        ("Highest\ufeffmountain.", SummaryViolation.HIDDEN_CHARACTER),
        ("A" * (SUMMARY_MAX_LENGTH + 1), SummaryViolation.TOO_LONG),
        ("The <b>highest</b> mountain.", SummaryViolation.MARKUP),
        ("The highest `mountain`.", SummaryViolation.MARKUP),
        ("The [highest](https://example.com) mountain.", SummaryViolation.MARKUP),
        ("Rock &amp; ice.", SummaryViolation.MARKUP),
        ("Rock &#38; ice.", SummaryViolation.MARKUP),
        ("Rock &#x26; ice.", SummaryViolation.MARKUP),
        ("highest mountain in the Alps.", SummaryViolation.NOT_SENTENCE_FORM),
        ("Highest mountain in the Alps (4808 m)", SummaryViolation.NOT_SENTENCE_FORM),
    ],
)
def test_rejected_summaries(text, violation):
    assert violation in summary_violations(text)


def test_the_length_limit_counts_characters_not_bytes():
    accepted = "É" * (SUMMARY_MAX_LENGTH - 1) + "."

    assert len(accepted.encode()) > SUMMARY_MAX_LENGTH
    assert summary_violations(accepted) == ()


def test_a_blank_summary_reports_only_that_it_is_blank():
    assert summary_violations("   ") == (SummaryViolation.BLANK,)


def test_every_violation_of_a_summary_is_reported_once_in_a_stable_order():
    violations = summary_violations(" <b>x\ny</b> ")

    assert violations == (
        SummaryViolation.NOT_TRIMMED,
        SummaryViolation.CONTROL_CHARACTER,
        SummaryViolation.MARKUP,
    )
