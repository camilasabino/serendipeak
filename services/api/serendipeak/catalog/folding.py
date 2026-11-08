import unicodedata


def fold(text: str) -> str:
    """Lowercase, accent-free and whitespace-trimmed, so "Mönch" is found by "monch"."""
    decomposed = unicodedata.normalize("NFKD", text.strip())

    return "".join(char for char in decomposed if not unicodedata.combining(char)).casefold()
