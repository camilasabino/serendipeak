import datetime
import json
import uuid
from dataclasses import replace
from functools import cache
from pathlib import Path

from serendipeak.catalog.bootstrap.frozen_catalog import (
    FrozenImageIdentity,
    FrozenMountain,
    parse_frozen_catalog,
)
from serendipeak.catalog.bootstrap.seed import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSeed,
    ImageProvenance,
    parse_catalog_seed,
)
from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Coordinates,
    ImageDimensions,
    Mountain,
    MountainStatus,
    OsmReference,
    OsmType,
    PrimaryImage,
)
from tests.support.contract_fixtures import load_fixture

SEED_PATH = Path(__file__).resolve().parents[2] / "seed" / "legacy-catalog-v1.json"
CREATED_AT = datetime.datetime(2026, 10, 2, 2, 55, 52, 889902, tzinfo=datetime.UTC)
UPDATED_AT = datetime.datetime(2026, 10, 12, 17, 59, 25, 645765, tzinfo=datetime.UTC)


def load_seed_document():
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


@cache
def committed_seed():
    return parse_catalog_seed(load_seed_document())


@cache
def frozen_catalog():
    return parse_frozen_catalog(load_fixture("catalog.json"))


def primary_image(**overrides):
    fields = {
        "url": "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg",
        "thumbnail_url": None,
        "dimensions": ImageDimensions(width=4994, height=2758),
        "creator": "Bjørn Christian Tørrissen",
        "attribution": "Bjørn Christian Tørrissen",
        "license_name": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
        "source_page_url": "https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
        "source_identifier": "File:Aconcagua2016.jpg",
    }
    fields.update(overrides)

    return PrimaryImage(**fields)


def mountain(slug="aconcagua", **overrides):
    fields = {
        "id": uuid.uuid5(uuid.NAMESPACE_URL, slug),
        "slug": slug,
        "name": slug.replace("-", " ").title(),
        "status": MountainStatus.ACTIVE,
        "coordinates": Coordinates(latitude=-32.6531487, longitude=-70.0119607),
        "elevation_meters": 6961,
        "prominence_meters": 6962,
        "range_name": "Principal Cordillera",
        "countries": ("Argentina",),
        "summary": "Highest mountain outside Asia.",
        "camera": CanonicalCamera(
            heading_degrees=66.87,
            pitch_degrees=-19.85,
            range_meters=17132.0,
            framing=CameraFraming(x=-0.0587, y=0.3857),
        ),
        "primary_image": primary_image(),
        "osm": OsmReference(type=OsmType.NODE, id=1504741757),
        "wikidata_id": "Q39739",
        "wikipedia_url": "https://en.wikipedia.org/wiki/Aconcagua",
    }
    fields.update(overrides)

    return Mountain(**fields)


def catalog_mountain(slug="aconcagua", provenance=None, **overrides):
    entry = mountain(slug, **overrides)

    return CatalogMountain(
        mountain=entry,
        image_provenance=None
        if entry.primary_image is None
        else provenance or ImageProvenance(None, None, None),
        created_at=CREATED_AT,
        updated_at=UPDATED_AT,
    )


def catalog_discovery(day, entry):
    return CatalogDiscovery(
        date=day,
        mountain_id=entry.mountain.id,
        created_at=datetime.datetime.combine(day, datetime.time(1, 19), tzinfo=datetime.UTC),
    )


def catalog_seed(*mountains, discoveries=()):
    return CatalogSeed(mountains=tuple(mountains), discoveries=tuple(discoveries))


def frozen_mountain(entry):
    source = entry.mountain
    image = source.primary_image

    return FrozenMountain(
        slug=source.slug,
        name=source.name,
        coordinates=source.coordinates,
        elevation_meters=source.elevation_meters,
        camera=source.camera,
        osm=source.osm,
        wikidata_id=source.wikidata_id,
        image=FrozenImageIdentity(
            source_identifier=image.source_identifier,
            source_page_url=image.source_page_url,
            dimensions=image.dimensions,
        ),
    )


def with_mountain(entry, **overrides):
    return replace(entry, mountain=replace(entry.mountain, **overrides))
