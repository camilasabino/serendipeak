import datetime
import hashlib
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
from serendipeak.catalog.bootstrap.ports import (
    CatalogDiscovery,
    CatalogMountain,
    CatalogSeed,
)
from serendipeak.catalog.bootstrap.seed import parse_catalog_seed
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
        "name": slug.replace("-", " ").title(),
        "status": MountainStatus.ACTIVE,
        "coordinates": Coordinates(latitude=-32.6531487, longitude=-70.0119607),
        "elevation_meters": 6961,
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
        "osm_node_id": 1504741757,
        "wikidata_id": "Q39739",
    }
    fields.update(overrides)

    return Mountain(**fields)


def catalog_mountain(slug="aconcagua", **overrides):
    return CatalogMountain(
        mountain=mountain(slug, **overrides),
        created_at=CREATED_AT,
        updated_at=UPDATED_AT,
    )


def seeded_mountain(slug="aconcagua", **overrides):
    """A mountain as the committed seed holds it: its photograph has no owned media yet."""
    overrides.setdefault("primary_image", primary_image(media=None))

    return catalog_mountain(slug, **overrides)


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
        osm_node_id=source.osm_node_id,
        wikidata_id=source.wikidata_id,
        image=FrozenImageIdentity(
            source_page_url=image.source_page_url,
            dimensions=image.dimensions,
        ),
    )


def with_mountain(entry, **overrides):
    return replace(entry, mountain=replace(entry.mountain, **overrides))


def media_of(slug):
    return photograph_media(hashlib.sha256(slug.encode()).hexdigest())


def with_media(entry):
    image = entry.mountain.primary_image

    return with_mountain(entry, primary_image=replace(image, media=media_of(entry.mountain.slug)))


@cache
def committed_seed_with_media():
    """The committed seed as served after materialization: every photograph holds media."""
    seed = committed_seed()

    return CatalogSeed(
        mountains=tuple(with_media(entry) for entry in seed.mountains),
        discoveries=seed.discoveries,
    )


def committed_mountain(slug):
    return next(
        entry.mountain for entry in committed_seed().mountains if entry.mountain.slug == slug
    )


def bare_mountain(status=MountainStatus.INACTIVE):
    return mountain(
        "bare-peak",
        id=uuid.UUID("b86e2544-fff1-4d44-9244-fa72113e04c3"),
        status=status,
        coordinates=Coordinates(latitude=45.0, longitude=10.0),
        elevation_meters=2000,
        range_name=None,
        countries=(),
        summary=None,
        camera=None,
        primary_image=None,
        osm_node_id=None,
        wikidata_id=None,
    )
