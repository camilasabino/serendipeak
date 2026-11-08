from serendipeak.catalog.entities import CanonicalCamera
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord
from serendipeak.studio import camera_editor_link


def camera_editor_url(
    web_origin: str, record: MountainRecord, proposed: CanonicalCamera | None = None
) -> str:
    """The visual editor's address for a stored mountain; the link itself is the Studio's."""
    return camera_editor_link.camera_editor_url(
        web_origin,
        mountain_id=record.pk,
        slug=record.slug,
        name=record.name_en,
        latitude=record.location.y,
        longitude=record.location.x,
        elevation_meters=record.elevation_meters,
        stored=to_camera(record),
        proposed=proposed,
    )
