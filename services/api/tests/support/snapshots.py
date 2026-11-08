import datetime

from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.entities import CanonicalCamera, Coordinates, MountainStatus
from serendipeak.catalog.localization import LocalizedText
from tests.support.catalog import (
    catalog_discovery,
    catalog_mountain,
    primary_image,
    with_mountain,
)
from tests.support.geography import continent, countries
from tests.support.regions import region_path, regions_of

DAY = datetime.date(2026, 10, 3)


def varied_catalog(*, with_discoveries=True):
    """A synthetic catalog that exercises every shape the snapshot has to carry: a nested
    region, a translation, a camera with and without framing, a photograph with and without
    media, a sparse draft and a mountain without a region."""
    tall = with_mountain(
        catalog_mountain("tall-peak"),
        name=LocalizedText(en="Tall Peak", es="Pico Alto", pt="Pico Alto"),
        summary=LocalizedText(en="A tall peak.", es="Un pico alto.", pt=None),
        countries=countries("AR", "CL"),
    )
    unframed = with_mountain(
        catalog_mountain("unframed-peak"),
        status=MountainStatus.INACTIVE,
        camera=CanonicalCamera(
            heading_degrees=0.0, pitch_degrees=15.0, range_meters=80000.0, framing=None
        ),
        region=region_path("Test Chain"),
        continent=continent("EU"),
        countries=countries("FR"),
    )
    pending = with_mountain(
        catalog_mountain("pending-peak"),
        primary_image=primary_image(media=None, dimensions=None, source_page_url=None),
    )
    draft = with_mountain(
        catalog_mountain("draft-peak"),
        status=MountainStatus.DRAFT,
        coordinates=Coordinates(latitude=90.0, longitude=-180.0),
        region=None,
        countries=(),
        summary=None,
        camera=None,
        primary_image=None,
        osm_node_id=None,
        wikidata_id=None,
    )
    regions = regions_of(*(m.mountain.region for m in (tall, unframed, pending, draft)))
    entries = (tall, unframed, pending, draft)

    return CatalogSnapshot(
        mountains=entries,
        discoveries=(
            (
                catalog_discovery(DAY, tall),
                catalog_discovery(DAY + datetime.timedelta(days=1), unframed),
            )
            if with_discoveries
            else ()
        ),
        regions=regions,
    )
