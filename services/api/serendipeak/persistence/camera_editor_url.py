from django.utils.http import urlencode

from serendipeak.catalog.camera import camera_violations
from serendipeak.persistence.mapping import to_camera
from serendipeak.persistence.models import MountainRecord

EDITOR_PATH = "/editorial/camera"


def camera_editor_url(web_origin: str, record: MountainRecord) -> str:
    """The visual editor's address for a mountain, carrying everything it renders from.

    The editor reads no API, because a draft is not public, so the mountain travels in the query.
    A stored camera is sent only when it is complete and inside the catalog bounds: the editor
    rejects anything else, and an unusable camera must not stop an editor from replacing it.
    """
    query = {
        "mountain": record.pk,
        "slug": record.slug,
        "name": record.name,
        "lat": record.location.y,
        "lon": record.location.x,
        "elevation": record.elevation_meters,
    }

    camera = to_camera(record)
    if camera is not None and not camera_violations(camera):
        query |= {
            "heading": camera.heading_degrees,
            "pitch": camera.pitch_degrees,
            "range": camera.range_meters,
            "fx": camera.framing.x,
            "fy": camera.framing.y,
        }

    return f"{web_origin}{EDITOR_PATH}?{urlencode(query)}"
