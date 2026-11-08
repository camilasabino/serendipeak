import datetime
import hashlib
import re
import uuid
from dataclasses import replace
from functools import cache

from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSnapshot,
)
from serendipeak.catalog.country_aliases import LEGACY_COUNTRY_CODES
from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    ImageDimensions,
    Mountain,
    MountainStatus,
    PhotographMedia,
    PrimaryImage,
)
from serendipeak.catalog.localization import LocalizedText
from tests.support.contract_fixtures import load_fixture, load_frozen_catalog
from tests.support.geography import continent, countries, country
from tests.support.regions import region_path, regions_of

CREATED_AT = datetime.datetime(2026, 10, 2, 2, 55, 52, 889902, tzinfo=datetime.UTC)
UPDATED_AT = datetime.datetime(2026, 10, 12, 17, 59, 25, 645765, tzinfo=datetime.UTC)
FIRST_DISCOVERY_DAY = datetime.date(2026, 10, 5)
DISCOVERY_COUNT = 8
# The v1 documents that describe one mountain completely. The rest of the catalog is derived
# from the frozen catalog, which holds no summary, credit or geography, so tests that compare
# a whole response with a v1 document use these mountains.
V1_MOUNTAIN_DOCUMENTS = ("mountain-complete.json", "mountain-sparse.json")

_OSM_NODE = re.compile(r"/node/([1-9][0-9]*)$")
_WIKIDATA = re.compile(r"/wiki/(Q[1-9][0-9]*)$")


def photograph_media(sha256="0" * 64):
    return PhotographMedia(
        original_key=f"photographs/{sha256}/original.jpg",
        original_sha256=sha256,
        page_key=f"photographs/{sha256}/page-r1.jpg",
        viewer_key=f"photographs/{sha256}/viewer-r1.jpg",
    )


def primary_image(**overrides):
    fields = {
        "media": photograph_media(),
        "dimensions": ImageDimensions(width=4994, height=2758),
        "author": "Bjørn Christian Tørrissen",
        "license_name": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
        "source_page_url": "https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
    }
    fields.update(overrides)

    return PrimaryImage(**fields)


def mountain(slug="aconcagua", **overrides):
    fields = {
        "id": uuid.uuid5(uuid.NAMESPACE_URL, slug),
        "slug": slug,
        "name": LocalizedText(en=slug.replace("-", " ").title()),
        "status": MountainStatus.ACTIVE,
        "coordinates": Coordinates(latitude=-32.6531487, longitude=-70.0119607),
        "elevation_meters": 6961,
        "continent": continent("SA"),
        "countries": countries("AR"),
        "region": region_path("Test Chain", "Test Range"),
        "summary": LocalizedText(en="Highest mountain outside Asia."),
        "camera": CanonicalCamera(
            heading_degrees=66.87,
            pitch_degrees=-19.85,
            range_meters=17132.0,
            framing=CameraFraming(x=-0.0587, y=0.3857),
        ),
        "primary_image": primary_image(),
        "osm_node_id": 1504741757,
        "wikidata_id": "Q39739",
    }
    fields.update(overrides)
    for member in ("name", "summary"):
        if isinstance(fields[member], str):
            fields[member] = LocalizedText(en=fields[member])

    return Mountain(**fields)


def catalog_mountain(slug="aconcagua", **overrides):
    return CatalogMountain(
        mountain=mountain(slug, **overrides),
        created_at=CREATED_AT,
        updated_at=UPDATED_AT,
    )


def mountain_without_media(slug="aconcagua", **overrides):
    """A mountain whose photograph has no owned media yet."""
    overrides.setdefault("primary_image", primary_image(media=None))

    return catalog_mountain(slug, **overrides)


def catalog_discovery(day, entry):
    return CatalogDiscovery(
        date=day,
        mountain_id=entry.mountain.id,
        created_at=datetime.datetime.combine(day, datetime.time(1, 19), tzinfo=datetime.UTC),
    )


def catalog_of(*mountains, discoveries=()):
    regions = regions_of(*(entry.mountain.region for entry in mountains))

    return CatalogSnapshot(
        mountains=tuple(mountains), discoveries=tuple(discoveries), regions=regions
    )


def with_mountain(entry, **overrides):
    return replace(entry, mountain=replace(entry.mountain, **overrides))


def media_of(slug):
    return photograph_media(hashlib.sha256(slug.encode()).hexdigest())


def with_media(entry):
    image = entry.mountain.primary_image

    return with_mountain(entry, primary_image=replace(image, media=media_of(entry.mountain.slug)))


def mountain_from_v1_document(document):
    """The mountain a complete v1 mountain document describes, as the catalog would hold it.

    Geography follows the rule the contract helpers use for tests: the countries are the v1
    names through the alias table, the continent is the one of the first of them and the region
    is a root named by the range name. The photograph has no owned media yet.
    """
    codes = [LEGACY_COUNTRY_CODES[name] for name in document["countries"]]
    sources = document.get("sources", {})
    image = document.get("primaryImage")
    range_name = document.get("rangeName")
    summary = document.get("summary")

    return mountain(
        document["slug"],
        id=uuid.UUID(document["id"]),
        name=LocalizedText(en=document["name"]),
        coordinates=Coordinates(**document["coordinates"]),
        elevation_meters=document["elevationMeters"],
        continent=continent(country(codes[0]).continent_code),
        countries=countries(*codes),
        region=None if range_name is None else region_path(range_name),
        summary=None if summary is None else LocalizedText(en=summary),
        camera=_camera_of(document["camera"]),
        primary_image=None
        if image is None
        else PrimaryImage(
            media=None,
            dimensions=ImageDimensions(width=image["width"], height=image["height"]),
            author=image["attribution"],
            license_name=image["license"],
            license_url=image["licenseUrl"],
            source_page_url=image["sourcePageUrl"],
        ),
        osm_node_id=_identifier(_OSM_NODE, sources.get("osm")),
        wikidata_id=_identifier(_WIKIDATA, sources.get("wikidata")),
    )


def _camera_of(raw):
    framing = raw["framing"]

    return CanonicalCamera(
        heading_degrees=raw["headingDegrees"],
        pitch_degrees=raw["pitchDegrees"],
        range_meters=raw["rangeMeters"],
        framing=CameraFraming(x=framing["x"], y=framing["y"]),
    )


def _identifier(pattern, url):
    if url is None:
        return None
    value = pattern.search(url).group(1)

    return int(value) if value.isdigit() else value


def _frozen_entry(raw):
    image = raw["primaryImage"]

    return catalog_mountain(
        raw["slug"],
        name=LocalizedText(en=raw["name"]),
        coordinates=Coordinates(**raw["coordinates"]),
        elevation_meters=raw["elevationMeters"],
        camera=_camera_of(raw["camera"]),
        primary_image=primary_image(
            media=None,
            dimensions=ImageDimensions(width=image["width"], height=image["height"]),
            source_page_url=image["sourcePageUrl"],
        ),
        osm_node_id=_identifier(_OSM_NODE, raw["sources"]["osm"]),
        wikidata_id=_identifier(_WIKIDATA, raw["sources"]["wikidata"]),
    )


@cache
def fixture_catalog():
    """A catalog of the shape of the frozen v1 catalog: the same 73 slugs, names, coordinates,
    elevations, cameras and photograph identities, which are contract data. Everything the
    frozen catalog does not hold (summary, credit, geography, ids, dates) is synthetic or comes
    from the complete v1 documents, and the photographs have no owned media yet."""
    described = {}
    for name in V1_MOUNTAIN_DOCUMENTS:
        mountain_ = mountain_from_v1_document(load_fixture(name))
        described[mountain_.slug] = CatalogMountain(mountain_, CREATED_AT, UPDATED_AT)

    mountains = tuple(
        described.get(raw["slug"]) or _frozen_entry(raw) for raw in load_frozen_catalog()
    )
    history = [entry for entry in mountains if entry.mountain.slug not in described]
    discoveries = tuple(
        catalog_discovery(FIRST_DISCOVERY_DAY + datetime.timedelta(days=offset), history[offset])
        for offset in range(DISCOVERY_COUNT)
    )

    return CatalogSnapshot(
        mountains=mountains,
        discoveries=discoveries,
        regions=regions_of(*(entry.mountain.region for entry in mountains)),
    )


@cache
def fixture_catalog_with_media():
    """The fixture catalog as served once every photograph holds media."""
    catalog = fixture_catalog()

    return replace(catalog, mountains=tuple(with_media(entry) for entry in catalog.mountains))


def fixture_mountain(slug):
    return next(
        entry.mountain for entry in fixture_catalog().mountains if entry.mountain.slug == slug
    )


def bare_mountain(status=MountainStatus.INACTIVE):
    return mountain(
        "bare-peak",
        id=uuid.UUID("b86e2544-fff1-4d44-9244-fa72113e04c3"),
        status=status,
        coordinates=Coordinates(latitude=45.0, longitude=10.0),
        elevation_meters=2000,
        continent=continent("EU"),
        countries=(),
        region=None,
        summary=None,
        camera=None,
        primary_image=None,
        osm_node_id=None,
        wikidata_id=None,
    )
