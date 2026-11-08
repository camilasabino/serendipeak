from urllib.parse import parse_qs, urlsplit

from serendipeak.catalog.entities import CameraFraming, CanonicalCamera
from serendipeak.studio.camera_editor_link import EDITOR_PATH, camera_editor_url

ORIGIN = "https://web.example"
STORED = CanonicalCamera(
    heading_degrees=123.45,
    pitch_degrees=-12.5,
    range_meters=4321.0,
    framing=CameraFraming(x=0.125, y=-0.25),
)
MOUNTAIN = {
    "mountain_id": "7d4f0b4c-0000-4000-8000-000000000001",
    "slug": "aconcagua",
    "name": "Aconcagua",
    "latitude": -32.6531487,
    "longitude": -70.0109327,
    "elevation_meters": 6961,
}


def link(**overrides):
    return camera_editor_url(ORIGIN, **{**MOUNTAIN, "stored": STORED, **overrides})


def query_of(url):
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


def test_it_is_on_the_origin_it_is_given_and_the_editor_path():
    url = link()

    assert url.startswith(f"{ORIGIN}{EDITOR_PATH}?")


def test_it_carries_the_mountain_and_its_stored_camera_exactly():
    query = query_of(link())

    assert query["mountain"] == MOUNTAIN["mountain_id"]
    assert query["slug"] == "aconcagua"
    assert query["name"] == "Aconcagua"
    assert float(query["lat"]) == MOUNTAIN["latitude"]
    assert float(query["lon"]) == MOUNTAIN["longitude"]
    assert int(query["elevation"]) == 6961
    assert float(query["heading"]) == STORED.heading_degrees
    assert float(query["pitch"]) == STORED.pitch_degrees
    assert float(query["range"]) == STORED.range_meters
    assert (float(query["fx"]), float(query["fy"])) == (0.125, -0.25)
    assert "proposal" not in query


def test_a_mountain_without_a_camera_sends_none():
    assert set(query_of(link(stored=None))) == {
        "mountain",
        "slug",
        "name",
        "lat",
        "lon",
        "elevation",
    }


def test_floats_keep_every_digit_the_stored_camera_has():
    awkward = CanonicalCamera(
        heading_degrees=359.99999999999994,
        pitch_degrees=-19.850000000000001,
        range_meters=17132.123456789,
        framing=CameraFraming(x=1e-05, y=-0.30000000000000004),
    )

    query = query_of(link(stored=awkward))

    assert query["heading"] == "359.99999999999994"
    assert query["fx"] == "1e-05"
    assert query["fy"] == "-0.30000000000000004"


def test_a_camera_without_framing_is_not_sent_so_it_can_still_be_completed():
    unframed = CanonicalCamera(
        heading_degrees=10, pitch_degrees=-10, range_meters=5000, framing=None
    )

    assert "heading" not in query_of(link(stored=unframed))


def test_names_that_need_escaping_travel_intact():
    name = "Mont Blanc & Co. #1 ñandú=?"

    url = link(name=name)

    assert query_of(url)["name"] == name
    assert "<" not in url


def test_a_proposal_that_differs_from_the_stored_camera_is_sent_and_marked():
    proposed = CanonicalCamera(
        heading_degrees=200.0,
        pitch_degrees=-12.5,
        range_meters=4321.0,
        framing=CameraFraming(x=0.125, y=-0.25),
    )

    query = query_of(link(proposed=proposed))

    assert float(query["heading"]) == 200.0
    assert query["proposal"] == "1"


def test_a_proposal_that_equals_the_stored_camera_is_not_marked():
    assert "proposal" not in query_of(link(proposed=STORED))


def test_a_proposal_out_of_bounds_leads_back_with_the_stored_camera():
    unusable = CanonicalCamera(
        heading_degrees=9999, pitch_degrees=-12.5, range_meters=4321.0, framing=STORED.framing
    )

    query = query_of(link(proposed=unusable))

    assert float(query["heading"]) == STORED.heading_degrees
    assert "proposal" not in query
