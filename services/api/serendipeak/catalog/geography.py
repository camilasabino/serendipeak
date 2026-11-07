import re
from collections.abc import Mapping
from dataclasses import dataclass

from serendipeak.catalog.entities import Continent, Country

CONTINENT_CODES = ("AF", "AN", "AS", "EU", "NA", "OC", "SA")
COUNTRY_CODE_PATTERN = r"^[A-Z]{2}$"

_COUNTRY_CODE_REGEX = re.compile(COUNTRY_CODE_PATTERN)


def is_country_code(value: object) -> bool:
    return isinstance(value, str) and _COUNTRY_CODE_REGEX.fullmatch(value) is not None


@dataclass(frozen=True, slots=True)
class GeographyReference:
    continents: Mapping[str, Continent]
    countries: Mapping[str, Country]
