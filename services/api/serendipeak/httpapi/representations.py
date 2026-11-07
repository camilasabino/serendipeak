from serendipeak.catalog.entities import CanonicalCamera, Mountain, PrimaryImage
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.regions import RegionPath, RegionRef
from serendipeak.discovery.entities import DailyMountain

OSM_NODE_URL = "https://www.openstreetmap.org/node/{id}"
WIKIDATA_URL = "https://www.wikidata.org/wiki/{id}"


def represent_mountain(mountain: Mountain, media_base_url: str) -> dict[str, object]:
    coordinates = mountain.coordinates

    members = _present(
        {
            "id": str(mountain.id),
            "slug": mountain.slug,
            "name": mountain.name.en,
            "coordinates": {
                "latitude": coordinates.latitude,
                "longitude": coordinates.longitude,
            },
            "elevationMeters": mountain.elevation_meters,
            "continent": {"code": mountain.continent.code, "name": mountain.continent.name.en},
            "countries": [
                {"code": country.code, "name": country.name.en} for country in mountain.countries
            ],
            "summary": None if mountain.summary is None else mountain.summary.en,
            "camera": _camera(mountain.camera),
            "primaryImage": _primary_image(mountain.primary_image, media_base_url),
            "sources": _sources(mountain),
        }
    )

    # Always present, and null without a region, unlike every other member that has no value.
    return {**members, "region": _region(mountain.region)}


def _region(path: RegionPath | None) -> dict[str, object] | None:
    if path is None:
        return None

    return {
        **_region_ref(path.region),
        "ancestors": [_region_ref(ancestor) for ancestor in path.ancestors],
    }


def _region_ref(ref: RegionRef) -> dict[str, object]:
    return {"slug": ref.slug, "name": ref.name.en}


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
            "author": image.author,
            "license": image.license_name,
            "licenseUrl": image.license_url,
            "sourcePageUrl": image.source_page_url,
        }
    )


def _sources(mountain: Mountain) -> dict[str, object] | None:
    sources = _present(
        {
            "osm": None
            if mountain.osm_node_id is None
            else OSM_NODE_URL.format(id=mountain.osm_node_id),
            "wikidata": None
            if mountain.wikidata_id is None
            else WIKIDATA_URL.format(id=mountain.wikidata_id),
        }
    )

    return sources or None


def _present(members: dict[str, object]) -> dict[str, object]:
    return {name: value for name, value in members.items() if value is not None}
