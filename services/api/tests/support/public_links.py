ACCEPTED_PUBLIC_LINKS = (
    "https://example.com",
    "https://example.com/",
    "https://en.wikipedia.org/wiki/Aconcagua",
    "https://en.wikipedia.org/wiki/Aconcagua_(mountain)",
    "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg",
    "https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
    "https://creativecommons.org/licenses/by-sa/4.0",
    "https://unsplash.com/@user",
    "https://example.com:8443/path",
    "https://example.com?size=large&format=jpg",
    "https://example.com/photo.jpg?size=large&format=jpg",
    "https://example.com/page#section",
    "https://example.com/path?next=user@host#frag@ment",
    "https://example.com?query",
    "https://example.com#fragment",
    "https://example.com/café",
)

REJECTED_PUBLIC_LINKS = (
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://example.com",
    "HTTPS://example.com",
    "Https://example.com",
    "ftp://example.com/file",
    "//example.com/path",
    "example.com",
    "/relative/path",
    "https:example.com",
    "https:/example.com",
    "https://",
    "https:///path",
    "https://?query",
    "https://#fragment",
    "https://user@example.com/path",
    "https://user:secret@example.com/path",
    "https://@example.com",
    "https://example.com@evil.example/path",
    "https://exa mple.com",
    "https://example.com/a b",
    "https://example.com/path\n",
    "https://example.com/pa\tth",
    " https://example.com",
    "https://example.com ",
)

WHITESPACE_CHARACTERS = tuple(
    character for character in map(chr, range(0x110000)) if character.isspace()
)

PUBLIC_LINK_CASES = (
    *((value, True) for value in ACCEPTED_PUBLIC_LINKS),
    *((value, False) for value in REJECTED_PUBLIC_LINKS),
    *((f"https://example.com/a{character}b", False) for character in WHITESPACE_CHARACTERS),
)
