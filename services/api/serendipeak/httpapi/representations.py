from serendipeak.catalog.entities import CanonicalCamera, Mountain, PrimaryImage
from serendipeak.catalog.media.keys import public_url
from serendipeak.discovery.entities import DailyMountain

OSM_URL = "https://www.openstreetmap.org/{type}/{id}"
WIKIDATA_URL = "https://www.wikidata.org/wiki/{id}"


def represent_mountain(mountain: Mountain, media_base_url: str) -> dict[str, object]:
    coordinates = mountain.coordinates

    return _present(
        {
            "id": str(mountain.id),
            "slug": mountain.slug,
            "name": mountain.name,
            "coordinates": {
                "latitude": coordinates.latitude,
                "longitude": coordinates.longitude,
            },
            "elevationMeters": mountain.elevation_meters,
            "prominenceMeters": mountain.prominence_meters,
            "rangeName": mountain.range_name,
            "countries": list(mountain.countries),
            "summary": mountain.summary,
            "camera": _camera(mountain.camera),
            "primaryImage": _primary_image(mountain.primary_image, media_base_url),
            "sources": _sources(mountain),
        }
    )


def represent_daily_mountain(daily: DailyMountain, media_base_url: str) -> dict[str, object]:
    return {
        "date": daily.date.isoformat(),
        "mountain": represent_mountain(daily.mountain, media_base_url),
    }


def _camera(camera: CanonicalCamera | None) -> dict[str, object] | None:
    if camera is None:
        return None

    framing = camera.framing

    return _present(
        {
            "headingDegrees": camera.heading_degrees,
            "pitchDegrees": camera.pitch_degrees,
            "rangeMeters": camera.range_meters,
            "framing": None if framing is None else {"x": framing.x, "y": framing.y},
        }
    )


def _primary_image(image: PrimaryImage | None, media_base_url: str) -> dict[str, object] | None:
    # An image still awaiting its stored file has nothing to deliver: v1 allows a mountain
    # without a primary image, and readiness checks keep it from reaching a served environment.
    if image is None or image.media is None:
        return None

    dimensions = image.dimensions

    return _present(
        {
            "url": public_url(media_base_url, image.media.viewer_key),
            "thumbnailUrl": public_url(media_base_url, image.media.page_key),
            "width": None if dimensions is None else dimensions.width,
            "height": None if dimensions is None else dimensions.height,
            "creator": image.creator,
            "creatorUrl": image.creator_url,
            "attribution": image.attribution,
            "license": image.license_name,
            "licenseUrl": image.license_url,
            "sourcePageUrl": image.source_page_url,
            "sourceIdentifier": image.source_identifier,
        }
    )


def _sources(mountain: Mountain) -> dict[str, object] | None:
    osm = mountain.osm
    sources = _present(
        {
            "osm": None if osm is None else OSM_URL.format(type=osm.type.value, id=osm.id),
            "wikidata": None
            if mountain.wikidata_id is None
            else WIKIDATA_URL.format(id=mountain.wikidata_id),
            "wikipedia": mountain.wikipedia_url,
        }
    )

    return sources or None


def _present(members: dict[str, object]) -> dict[str, object]:
    return {name: value for name, value in members.items() if value is not None}
