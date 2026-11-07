from django.utils.http import urlencode

from serendipeak.catalog.camera import camera_violations
from serendipeak.catalog.entities import CanonicalCamera
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord

EDITOR_PATH = "/editorial/camera"


def camera_editor_url(
    web_origin: str, record: MountainRecord, proposed: CanonicalCamera | None = None
) -> str:
    """The visual editor's address for a mountain, carrying everything it renders from.

    The editor reads no API, because a draft is not public, so the mountain travels in the query.
    The editor opens on the stored camera. When the Admin confirmation sends it back with a
    camera that differs from the stored one, the editor opens on that proposal and is told so, so
    it never presents an unsaved camera as the saved one. Either camera is sent only when it is
    complete and inside the catalog bounds: the editor rejects anything else, and an unusable
    camera must not stop an editor from replacing it.
    """
    query = {
        "mountain": record.pk,
        "slug": record.slug,
        "name": record.name_en,
        "lat": record.location.y,
        "lon": record.location.x,
        "elevation": record.elevation_meters,
    }

    stored = to_camera(record)
    is_proposal = proposed is not None and proposed != stored and not camera_violations(proposed)
    camera = proposed if is_proposal else stored
    if camera is not None and not camera_violations(camera):
        query |= {
            "heading": camera.heading_degrees,
            "pitch": camera.pitch_degrees,
            "range": camera.range_meters,
            "fx": camera.framing.x,
            "fy": camera.framing.y,
        }
        if is_proposal:
            query["proposal"] = 1

    return f"{web_origin}{EDITOR_PATH}?{urlencode(query)}"
