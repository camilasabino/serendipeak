from django.contrib.gis.geos import Point

from serendipeak.accounts.entities import User
from serendipeak.accounts.roles import Role
from serendipeak.catalog.bootstrap.ports import CatalogDiscovery, CatalogMountain
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
from serendipeak.discovery.entities import DailyMountain
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainImageRecord,
    MountainRecord,
    UserRecord,
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
        range_name=record.range_name,
        countries=tuple(record.countries),
        summary=record.summary,
        camera=to_camera(record),
        primary_image=None if image is None else to_primary_image(image),
        osm_node_id=record.osm_node_id,
        wikidata_id=record.wikidata_id,
    )


def to_daily_mountain(record: DailyDiscoveryRecord) -> DailyMountain:
    return DailyMountain(date=record.date, mountain=to_mountain(record.mountain))


def to_catalog_mountain(record: MountainRecord) -> CatalogMountain:
    return CatalogMountain(
        mountain=to_mountain(record),
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

    return MountainRecord(
        id=mountain.id,
        slug=mountain.slug,
        name=mountain.name,
        location=Point(mountain.coordinates.longitude, mountain.coordinates.latitude, srid=4326),
        elevation_meters=mountain.elevation_meters,
        range_name=mountain.range_name,
        countries=list(mountain.countries),
        summary=mountain.summary,
        **camera_columns(mountain.camera),
        osm_node_id=mountain.osm_node_id,
        wikidata_id=mountain.wikidata_id,
        status=mountain.status.value,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


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
