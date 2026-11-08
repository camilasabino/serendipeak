import re
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]
STATIC_ROOT = SERVICE_ROOT / "serendipeak" / "studio" / "static" / "studio"
TEMPLATE_ROOT = SERVICE_ROOT / "serendipeak" / "studio" / "templates"
WEB_TOKENS = SERVICE_ROOT.parents[1] / "apps" / "web" / "src" / "shell" / "tokens.css"

STUDIO_CSS = (STATIC_ROOT / "studio.css").read_text(encoding="utf-8")
WEB_CSS = WEB_TOKENS.read_text(encoding="utf-8")

DECLARATION = re.compile(r"^\s*(--sp-[a-z0-9-]+):\s*(.+?);\s*(?:/\*.*\*/)?\s*$", re.MULTILINE)


def tokens_of(css):
    return {name: " ".join(value.split()) for name, value in DECLARATION.findall(css)}


LIGHT_MARKER = ":root[data-theme='light']"
DARK_BLOCK, LIGHT_BLOCK = STUDIO_CSS.split("@font-face", 1)[0].split(LIGHT_MARKER)

STUDIO_TOKENS = tokens_of(DARK_BLOCK)
LIGHT_TOKENS = {**STUDIO_TOKENS, **tokens_of(LIGHT_BLOCK)}
THEMES = {"dark": STUDIO_TOKENS, "light": LIGHT_TOKENS}
WEB_TOKEN_VALUES = tokens_of(WEB_CSS)


def resolve(name, tokens=STUDIO_TOKENS):
    value = tokens[name]
    while match := re.fullmatch(r"var\((--sp-[a-z0-9-]+)\)", value):
        value = tokens[match.group(1)]

    return value


def luminance(hex_color):
    def linear(channel):
        value = channel / 255

        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (int(hex_color[index : index + 2], 16) for index in (1, 3, 5))

    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)


def contrast(foreground, background, tokens=STUDIO_TOKENS):
    darker, lighter = sorted(
        (luminance(resolve(foreground, tokens)), luminance(resolve(background, tokens)))
    )

    return (lighter + 0.05) / (darker + 0.05)


def test_the_web_tokens_were_found_and_are_not_empty():
    assert WEB_TOKEN_VALUES
    assert "--sp-paper" in WEB_TOKEN_VALUES


@pytest.mark.parametrize("name", sorted(WEB_TOKEN_VALUES))
def test_every_web_token_is_defined_in_the_studio_with_the_same_value(name):
    assert name in STUDIO_TOKENS, f"{name} exists in the web tokens but not in the Studio"
    assert STUDIO_TOKENS[name] == WEB_TOKEN_VALUES[name], f"{name} has drifted from the web"


def test_the_brand_hex_values_appear_nowhere_but_the_token_block():
    outside = STUDIO_CSS.split("@font-face", 1)[1]

    assert not re.findall(r"#[0-9a-fA-F]{3,8}\b", outside)


def test_every_token_a_rule_references_is_defined():
    referenced = set(re.findall(r"var\((--[a-z0-9-]+)", STUDIO_CSS))
    defined = set(STUDIO_TOKENS) | set(re.findall(r"^\s*(--[a-z-]+):", STUDIO_CSS, re.MULTILINE))

    assert referenced <= defined, sorted(referenced - defined)


TEXT_PAIRS = [
    ("--sp-text", "--sp-surface-paper", 7),
    ("--sp-text", "--sp-surface-card", 7),
    ("--sp-text-muted", "--sp-surface-paper", 4.5),
    ("--sp-text-muted", "--sp-surface-card", 4.5),
    ("--sp-link", "--sp-surface-paper", 4.5),
    ("--sp-link", "--sp-surface-card", 4.5),
    ("--sp-danger", "--sp-surface-card", 4.5),
    ("--sp-danger", "--sp-surface-paper", 4.5),
    ("--sp-success", "--sp-surface-card", 4.5),
    ("--sp-warning", "--sp-surface-card", 4.5),
    ("--sp-info", "--sp-surface-card", 4.5),
    ("--sp-paper", "--sp-surface-stage", 7),
    ("--sp-mist", "--sp-surface-stage", 4.5),
    ("--sp-link-on-stage", "--sp-surface-stage", 4.5),
    ("--sp-button-fg", "--sp-button-bg", 4.5),
    ("--sp-inverse-fg", "--sp-inverse-bg", 7),
    ("--sp-button-fg", "--sp-danger", 4.5),
    ("--sp-text", "--sp-rule-on-paper", 4.5),
    ("--sp-paper-bright", "--sp-ink", 7),
    ("--sp-ink", "--sp-paper-bright", 7),
]
CONTROL_PAIRS = [
    ("--sp-border-control", "--sp-surface-card", 3),
    ("--sp-border-control", "--sp-surface-paper", 3),
    ("--sp-focus-on-paper", "--sp-surface-paper", 3),
    ("--sp-focus-on-paper", "--sp-surface-card", 3),
    ("--sp-focus", "--sp-surface-stage", 3),
    ("--sp-danger", "--sp-surface-card", 3),
    ("--sp-glacier-light", "--sp-surface-stage", 3),
]


@pytest.mark.parametrize("theme", sorted(THEMES))
@pytest.mark.parametrize(("foreground", "background", "minimum"), TEXT_PAIRS + CONTROL_PAIRS)
def test_text_and_controls_meet_the_wcag_contrast_minimums(theme, foreground, background, minimum):
    assert contrast(foreground, background, THEMES[theme]) >= minimum, (
        theme,
        foreground,
        background,
    )


BUTTON_PAIRS = [
    ("--sp-button-fg", "--sp-button-bg"),
    ("--sp-inverse-fg", "--sp-inverse-bg"),
    ("--sp-link", "--sp-surface-paper"),
    ("--sp-link", "--sp-surface-card"),
    ("--sp-text", "--sp-surface-card"),
    ("--sp-text", "--sp-rule-on-paper"),
    ("--sp-text-muted", "--sp-surface-card"),
]


@pytest.mark.parametrize("theme", sorted(THEMES))
@pytest.mark.parametrize(("foreground", "background"), BUTTON_PAIRS)
def test_every_button_state_is_readable_in_both_themes(theme, foreground, background):
    assert contrast(foreground, background, THEMES[theme]) >= 4.5


def test_dark_is_the_default_and_light_is_an_explicit_override():
    assert "color-scheme: dark;" in STUDIO_CSS
    assert "html[data-theme='light']" in STUDIO_CSS
    assert "prefers-color-scheme" not in STUDIO_CSS
    assert set(tokens_of(LIGHT_BLOCK)) <= set(STUDIO_TOKENS)


def test_a_button_in_a_stage_panel_never_takes_the_paper_text_color():
    assert ".panel--stage .button--quiet {" in STUDIO_CSS


def test_the_fonts_are_self_hosted_with_swap_and_their_licenses():
    declared = re.findall(r"url\('(fonts/[^']+\.woff2)'\)", STUDIO_CSS)

    assert len(declared) == 5
    for relative in declared:
        assert (STATIC_ROOT / relative).is_file(), relative
    assert STUDIO_CSS.count("font-display: swap") == len(declared)
    assert (STATIC_ROOT / "fonts" / "Spectral-OFL.txt").is_file()
    assert (STATIC_ROOT / "fonts" / "InstrumentSans-OFL.txt").is_file()
    assert "Spectral" in STUDIO_TOKENS["--sp-font-display"]
    assert "Instrument Sans" in STUDIO_TOKENS["--sp-font-ui"]


def test_nothing_is_loaded_from_another_origin():
    for path in [STATIC_ROOT / "studio.css", *TEMPLATE_ROOT.rglob("*.html")]:
        text = path.read_text(encoding="utf-8")

        assert not re.search(r"https?://|//fonts\.|@import", text), path


def test_the_shell_adapts_to_narrow_and_wide_viewports():
    assert re.search(r"@media \(min-width: \d+rem\)", STUDIO_CSS)
    assert re.search(r"@media \(max-width: \d+rem\)", STUDIO_CSS)
    assert "flex-wrap: wrap" in STUDIO_CSS


def test_keyboard_focus_is_always_visible():
    without_programmatic_focus_target = STUDIO_CSS.replace(".page:focus {\n\toutline: none;", "")

    assert ":focus-visible" in STUDIO_CSS
    assert not re.search(r"outline:\s*(none|0)\s*;", without_programmatic_focus_target)
