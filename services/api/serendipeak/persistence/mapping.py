from collections.abc import Iterable, Mapping
from uuid import UUID

from django.contrib.gis.geos import Point
from django.db.models import Prefetch, prefetch_related_objects

from serendipeak.accounts.entities import User
from serendipeak.accounts.roles import Role
from serendipeak.catalog.bootstrap.ports import CatalogDiscovery, CatalogMountain
from serendipeak.catalog.entities import (
    CameraFraming,
    CanonicalCamera,
    Continent,
    Coordinates,
    Country,
    ImageDimensions,
    Mountain,
    MountainStatus,
    PhotographMedia,
    PrimaryImage,
)
from serendipeak.catalog.geography import GeographyReference
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.regions import MountainRegion, RegionPath, build_region_path
from serendipeak.discovery.entities import DailyMountain
from serendipeak.persistence.models import (
    ContinentRecord,
    CountryRecord,
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
    UserRecord,
)


def _country_links(prefix: str = "") -> Prefetch:
    return Prefetch(
        f"{prefix}country_links",
        queryset=MountainCountryRecord.objects.select_related("country"),
    )


def with_geography(queryset, *, through: str = ""):
    """Select the continent and prefetch the countries of the mountains a queryset reads, in
    one join and one extra query however many mountains there are. through names the relation
    to the mountain when the queryset is not of mountains."""
    prefix = f"{through}__" if through else ""

    return queryset.select_related(f"{prefix}continent").prefetch_related(_country_links(prefix))


def load_countries(record: MountainRecord) -> None:
    """Read the countries of one record that was fetched without them, in one query."""
    prefetch_related_objects([record], _country_links())


_ANCESTORS_SQL = f"""
WITH RECURSIVE chain AS (
    SELECT * FROM {MountainRegionRecord._meta.db_table} WHERE id = ANY(%s)
    UNION
    SELECT parent.*
    FROM {MountainRegionRecord._meta.db_table} parent
    JOIN chain ON parent.id = chain.parent_id
)
SELECT * FROM chain
"""


def load_region_paths(records: Iterable[MountainRecord]) -> dict[UUID, RegionPath]:
    """The path of every region the records point at, ancestors root first, in one recursive
    query however many records or regions there are, and none when no record has a region.
    UNION keeps the walk finite and gives each shared ancestor once."""
    region_ids = list({record.region_id for record in records if record.region_id is not None})
    if not region_ids:
        return {}

    regions = {
        record.id: to_region(record)
        for record in MountainRegionRecord.objects.raw(_ANCESTORS_SQL, [region_ids])
    }

    return {region_id: build_region_path(region_id, regions) for region_id in region_ids}


def to_mountain(
    record: MountainRecord, region_paths: Mapping[UUID, RegionPath] | None = None
) -> Mountain:
    return to_mountain_with_image(record, _image_of(record), region_paths)


def to_mountain_with_image(
    record: MountainRecord,
    image: MountainImageRecord | None,
    region_paths: Mapping[UUID, RegionPath] | None = None,
) -> Mountain:
    """The continent and the country links are read through the record's relations: a caller
    that maps many records selects the continent and prefetches `country_links` with their
    country, and a caller that maps one lets the relations load themselves. The region path
    comes from region_paths, which a caller that maps many records builds once with
    load_region_paths; without it the path of the record's own region is read in one query.
    A caller that passes region_paths without the record's region gets no region, which is how
    one that judges nothing about the region avoids reading it."""
    if record.region_id is None:
        region = None
    else:
        paths = load_region_paths([record]) if region_paths is None else region_paths
        region = paths.get(record.region_id)

    return Mountain(
        id=record.id,
        slug=record.slug,
        name=LocalizedText(en=record.name_en, es=record.name_es, pt=record.name_pt),
        status=MountainStatus(record.status),
        coordinates=to_coordinates(record),
        elevation_meters=record.elevation_meters,
        continent=to_continent(record.continent),
        countries=to_countries(link.country for link in record.country_links.all()),
        region=region,
        summary=to_summary(record),
        camera=to_camera(record),
        primary_image=None if image is None else to_primary_image(image),
        osm_node_id=record.osm_node_id,
        wikidata_id=record.wikidata_id,
    )


def to_coordinates(record: MountainRecord) -> Coordinates:
    return Coordinates(latitude=record.location.y, longitude=record.location.x)


def to_point(coordinates: Coordinates) -> Point:
    return Point(coordinates.longitude, coordinates.latitude, srid=4326)


def to_summary(record: MountainRecord) -> LocalizedText | None:
    if record.summary_en is None:
        return None

    return LocalizedText(en=record.summary_en, es=record.summary_es, pt=record.summary_pt)


def to_region(record: MountainRegionRecord) -> MountainRegion:
    return MountainRegion(
        id=record.id,
        slug=record.slug,
        name=LocalizedText(en=record.name_en, es=record.name_es, pt=record.name_pt),
        parent_id=record.parent_id,
        wikidata_id=record.wikidata_id,
    )


def region_record(region: MountainRegion) -> MountainRegionRecord:
    return MountainRegionRecord(
        id=region.id,
        slug=region.slug,
        parent_id=region.parent_id,
        name_en=region.name.en,
        name_es=region.name.es,
        name_pt=region.name.pt,
        wikidata_id=region.wikidata_id,
    )


def to_continent(record: ContinentRecord) -> Continent:
    return Continent(
        code=record.code,
        name=LocalizedText(en=record.name_en, es=record.name_es, pt=record.name_pt),
    )


def to_country(record: CountryRecord) -> Country:
    return Country(
        code=record.code,
        name=LocalizedText(en=record.name_en, es=record.name_es, pt=record.name_pt),
        continent_code=record.continent_id,
    )


def to_countries(records) -> tuple[Country, ...]:
    # Code point order of the English name, then the code, whatever the database collation.
    return tuple(
        sorted(
            (to_country(record) for record in records),
            key=lambda country: (country.name.en, country.code),
        )
    )


def to_geography_reference(
    continents: Iterable[ContinentRecord], countries: Iterable[CountryRecord]
) -> GeographyReference:
    return GeographyReference(
        continents={record.code: to_continent(record) for record in continents},
        countries={record.code: to_country(record) for record in countries},
    )


def to_daily_mountain(record: DailyDiscoveryRecord) -> DailyMountain:
    return DailyMountain(date=record.date, mountain=to_mountain(record.mountain))


def to_catalog_mountain(
    record: MountainRecord, region_paths: Mapping[UUID, RegionPath]
) -> CatalogMountain:
    return CatalogMountain(
        mountain=to_mountain(record, region_paths),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def to_catalog_discovery(record: DailyDiscoveryRecord) -> CatalogDiscovery:
    return CatalogDiscovery(
        date=record.date,
        mountain_id=record.mountain_id,
        created_at=record.created_at,
    )


def mountain_record(entry: CatalogMountain, region_ids: Mapping[str, UUID]) -> MountainRecord:
    """region_ids maps the slug of each region the mountains may point at to its id."""
    mountain = entry.mountain

    return MountainRecord(
        id=mountain.id,
        slug=mountain.slug,
        name_en=mountain.name.en,
        name_es=mountain.name.es,
        name_pt=mountain.name.pt,
        location=to_point(mountain.coordinates),
        elevation_meters=mountain.elevation_meters,
        continent_id=mountain.continent.code,
        region_id=None if mountain.region is None else region_ids[mountain.region.region.slug],
        summary_en=None if mountain.summary is None else mountain.summary.en,
        summary_es=None if mountain.summary is None else mountain.summary.es,
        summary_pt=None if mountain.summary is None else mountain.summary.pt,
        **camera_columns(mountain.camera),
        osm_node_id=mountain.osm_node_id,
        wikidata_id=mountain.wikidata_id,
        status=mountain.status.value,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def country_link_records(entry: CatalogMountain) -> list[MountainCountryRecord]:
    return [
        MountainCountryRecord(mountain_id=entry.mountain.id, country_id=country.code)
        for country in entry.mountain.countries
    ]


def image_record(entry: CatalogMountain) -> MountainImageRecord | None:
    image = entry.mountain.primary_image
    if image is None:
        return None
    dimensions = image.dimensions
    media = image.media

    return MountainImageRecord(
        mountain_id=entry.mountain.id,
        original_key=None if media is None else media.original_key,
        original_sha256=None if media is None else media.original_sha256,
        page_key=None if media is None else media.page_key,
        viewer_key=None if media is None else media.viewer_key,
        width=None if dimensions is None else dimensions.width,
        height=None if dimensions is None else dimensions.height,
        author=image.author,
        license_name=image.license_name,
        license_url=image.license_url,
        source_page_url=image.source_page_url,
    )


def discovery_record(discovery: CatalogDiscovery) -> DailyDiscoveryRecord:
    return DailyDiscoveryRecord(
        date=discovery.date,
        mountain_id=discovery.mountain_id,
        created_at=discovery.created_at,
    )


def _image_of(record: MountainRecord) -> MountainImageRecord | None:
    try:
        return record.image
    except MountainImageRecord.DoesNotExist:
        return None


def camera_columns(camera: CanonicalCamera | None) -> dict[str, float | None]:
    framing = None if camera is None else camera.framing

    return {
        "camera_heading_degrees": None if camera is None else camera.heading_degrees,
        "camera_pitch_degrees": None if camera is None else camera.pitch_degrees,
        "camera_range_meters": None if camera is None else camera.range_meters,
        "camera_framing_x": None if framing is None else framing.x,
        "camera_framing_y": None if framing is None else framing.y,
    }


def to_camera(record: MountainRecord) -> CanonicalCamera | None:
    if record.camera_heading_degrees is None:
        return None

    return CanonicalCamera(
        heading_degrees=record.camera_heading_degrees,
        pitch_degrees=record.camera_pitch_degrees,
        range_meters=record.camera_range_meters,
        framing=None
        if record.camera_framing_x is None
        else CameraFraming(x=record.camera_framing_x, y=record.camera_framing_y),
    )


def to_primary_image(image: MountainImageRecord) -> PrimaryImage:
    return PrimaryImage(
        media=_photograph_media(image),
        dimensions=None
        if image.width is None
        else ImageDimensions(width=image.width, height=image.height),
        author=image.author,
        license_name=image.license_name,
        license_url=image.license_url,
        source_page_url=image.source_page_url,
    )


def _photograph_media(image: MountainImageRecord) -> PhotographMedia | None:
    if image.original_key is None:
        return None

    return PhotographMedia(
        original_key=image.original_key,
        original_sha256=image.original_sha256,
        page_key=image.page_key,
        viewer_key=image.viewer_key,
    )


def to_user(record: UserRecord) -> User:
    return User(
        id=record.id,
        username=record.username,
        role=Role(record.role),
        is_active=record.is_active,
        last_login=record.last_login,
        date_joined=record.date_joined,
    )
