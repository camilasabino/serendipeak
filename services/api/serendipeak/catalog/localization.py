from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LocalizedText:
    en: str
    es: str | None = None
    pt: str | None = None
