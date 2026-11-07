from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import RegionPath

WIKIDATA_ID_PATTERN = r"^Q[1-9][0-9]*$"


class MountainStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"


PUBLIC_STATUSES = frozenset({MountainStatus.ACTIVE, MountainStatus.INACTIVE})


@dataclass(frozen=True, slots=True)
class Coordinates:
    latitude: float
    longitude: float


@dataclass(frozen=True, slots=True)
class CameraFraming:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class CanonicalCamera:
    heading_degrees: float
    pitch_degrees: float
    range_meters: float
    framing: CameraFraming | None


@dataclass(frozen=True, slots=True)
class ImageDimensions:
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class PhotographMedia:
    original_key: str
    original_sha256: str
    page_key: str
    viewer_key: str


@dataclass(frozen=True, slots=True)
class PrimaryImage:
    media: PhotographMedia | None
    dimensions: ImageDimensions | None
    author: str
    license_name: str | None
    license_url: str | None
    source_page_url: str | None


@dataclass(frozen=True, slots=True)
class Continent:
    code: str
    name: LocalizedText


@dataclass(frozen=True, slots=True)
class Country:
    code: str
    name: LocalizedText
    continent_code: str


@dataclass(frozen=True, slots=True)
class Mountain:
    id: UUID
    slug: str
    name: LocalizedText
    status: MountainStatus
    coordinates: Coordinates
    elevation_meters: int
    continent: Continent
    countries: tuple[Country, ...]
    region: RegionPath | None
    summary: LocalizedText | None
    camera: CanonicalCamera | None
    primary_image: PrimaryImage | None
    osm_node_id: int | None
    wikidata_id: str | None


@dataclass(frozen=True, slots=True)
class CandidateMountain:
    id: UUID
    slug: str
