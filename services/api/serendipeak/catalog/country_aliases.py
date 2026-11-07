from collections.abc import Iterable

from serendipeak.errors import ApplicationError

ANTARCTICA_CODE = "AQ"

# The country names the v1 catalog stored as text, with the ISO 3166-1 code each one stands for.
# Antarctica has no entry: no v1 mountain named it, so its links are the only ones that exist
# without a legacy name.
LEGACY_COUNTRY_CODES = {
    "Argentina": "AR",
    "Australia": "AU",
    "Bolivia": "BO",
    "Brazil": "BR",
    "Cameroon": "CM",
    "Canada": "CA",
    "Chile": "CL",
    "Democratic Republic of the Congo": "CD",
    "Ecuador": "EC",
    "Ethiopia": "ET",
    "France": "FR",
    "Georgia": "GE",
    "Greece": "GR",
    "Guyana": "GY",
    "Iceland": "IS",
    "India": "IN",
    "Indonesia": "ID",
    "Iran": "IR",
    "Italy": "IT",
    "Japan": "JP",
    "Kazakhstan": "KZ",
    "Kenya": "KE",
    "Kyrgyzstan": "KG",
    "Lesotho": "LS",
    "Malaysia": "MY",
    "Mexico": "MX",
    "Morocco": "MA",
    "Nepal": "NP",
    "New Zealand": "NZ",
    "North Korea": "KP",
    "Norway": "NO",
    "Pakistan": "PK",
    "Papua New Guinea": "PG",
    "People's Republic of China": "CN",
    "Peru": "PE",
    "Russia": "RU",
    "Slovenia": "SI",
    "South Korea": "KR",
    "Spain": "ES",
    "Sri Lanka": "LK",
    "Sweden": "SE",
    "Switzerland": "CH",
    "Tanzania": "TZ",
    "Turkey": "TR",
    "Uganda": "UG",
    "United Kingdom": "GB",
    "United States": "US",
    "Venezuela": "VE",
}

_NAME_OF_CODE = {code: name for name, code in LEGACY_COUNTRY_CODES.items()}


class UnknownLegacyCountry(ApplicationError):
    def __init__(self, names: tuple[str, ...]):
        super().__init__(f"no country code is known for: {', '.join(names)}")
        self.names = names


def codes_of_legacy_names(names: Iterable[str]) -> frozenset[str]:
    names = tuple(names)
    unknown = tuple(sorted({name for name in names if name not in LEGACY_COUNTRY_CODES}))
    if unknown:
        raise UnknownLegacyCountry(unknown)

    return frozenset(LEGACY_COUNTRY_CODES[name] for name in names)


def legacy_name_of_code(code: str) -> str | None:
    return _NAME_OF_CODE.get(code)


def links_agree_with_legacy_names(codes: Iterable[str], names: Iterable[str]) -> bool:
    return frozenset(codes) - {ANTARCTICA_CODE} == codes_of_legacy_names(names)
