from django.contrib.gis.geos import Point

from serendipeak.catalog.bootstrap.ports import CatalogDiscovery, CatalogMountain, ImageProvenance
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
from serendipeak.discovery.entities import DailyMountain
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainImageRecord,
    MountainRecord,
)


def to_mountain(record: MountainRecord) -> Mountain:
    return to_mountain_with_image(record, _image_of(record))


def to_mountain_with_image(record: MountainRecord, image: MountainImageRecord | None) -> Mountain:
    return Mountain(
        id=record.id,
        slug=record.slug,
        name=record.name,
        status=MountainStatus(record.status),
        coordinates=Coordinates(latitude=record.location.y, longitude=record.location.x),
        elevation_meters=record.elevation_meters,
        prominence_meters=record.prominence_meters,
        range_name=record.range_name,
        countries=tuple(record.countries),
        summary=record.summary,
        camera=_camera(record),
        primary_image=None if image is None else to_primary_image(image),
        osm=None
        if record.osm_type is None
        else OsmReference(type=OsmType(record.osm_type), id=record.osm_id),
        wikidata_id=record.wikidata_id,
        wikipedia_url=record.wikipedia_url,
    )


def to_daily_mountain(record: DailyDiscoveryRecord) -> DailyMountain:
    return DailyMountain(date=record.date, mountain=to_mountain(record.mountain))


def to_catalog_mountain(record: MountainRecord) -> CatalogMountain:
    image = _image_of(record)

    return CatalogMountain(
        mountain=to_mountain(record),
        image_provenance=None
        if image is None
        else ImageProvenance(
            license_reported=image.license_reported,
            license_election_basis_url=image.license_election_basis_url,
            approved_on=image.approved_on,
        ),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def to_catalog_discovery(record: DailyDiscoveryRecord) -> CatalogDiscovery:
    return CatalogDiscovery(
        date=record.date,
        mountain_id=record.mountain_id,
        created_at=record.created_at,
    )


def mountain_record(entry: CatalogMountain) -> MountainRecord:
    mountain = entry.mountain
    camera = mountain.camera
    framing = None if camera is None else camera.framing

    return MountainRecord(
        id=mountain.id,
        slug=mountain.slug,
        name=mountain.name,
        location=Point(mountain.coordinates.longitude, mountain.coordinates.latitude, srid=4326),
        elevation_meters=mountain.elevation_meters,
        prominence_meters=mountain.prominence_meters,
        range_name=mountain.range_name,
        countries=list(mountain.countries),
        summary=mountain.summary,
        camera_heading_degrees=None if camera is None else camera.heading_degrees,
        camera_pitch_degrees=None if camera is None else camera.pitch_degrees,
        camera_range_meters=None if camera is None else camera.range_meters,
        camera_framing_x=None if framing is None else framing.x,
        camera_framing_y=None if framing is None else framing.y,
        osm_type=None if mountain.osm is None else mountain.osm.type.value,
        osm_id=None if mountain.osm is None else mountain.osm.id,
        wikidata_id=mountain.wikidata_id,
        wikipedia_url=mountain.wikipedia_url,
        status=mountain.status.value,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def image_record(entry: CatalogMountain) -> MountainImageRecord | None:
    image = entry.mountain.primary_image
    if image is None:
        return None
    provenance = entry.image_provenance or ImageProvenance(None, None, None)
    dimensions = image.dimensions

    return MountainImageRecord(
        mountain_id=entry.mountain.id,
        url=image.url,
        thumbnail_url=image.thumbnail_url,
        width=None if dimensions is None else dimensions.width,
        height=None if dimensions is None else dimensions.height,
        creator=image.creator,
        attribution=image.attribution,
        license_name=image.license_name,
        license_url=image.license_url,
        license_reported=provenance.license_reported,
        license_election_basis_url=provenance.license_election_basis_url,
        source_page_url=image.source_page_url,
        source_identifier=image.source_identifier,
        approved_on=provenance.approved_on,
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


def _camera(record: MountainRecord) -> CanonicalCamera | None:
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
        url=image.url,
        thumbnail_url=image.thumbnail_url,
        dimensions=None
        if image.width is None
        else ImageDimensions(width=image.width, height=image.height),
        creator=image.creator,
        attribution=image.attribution,
        license_name=image.license_name,
        license_url=image.license_url,
        source_page_url=image.source_page_url,
        source_identifier=image.source_identifier,
    )
