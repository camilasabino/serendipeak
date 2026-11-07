from serendipeak.catalog.entities import Coordinates
from serendipeak.catalog.new_mountain import (
    NewMountain,
    NewMountainViolation,
    NewPhotograph,
    new_mountain_violations,
)


def draft(**overrides):
    fields = {
        "slug": "new-peak",
        "name": "New Peak",
        "coordinates": Coordinates(latitude=46.5, longitude=8.5),
        "elevation_meters": 1,
        "continent_code": "EU",
        "photograph": NewPhotograph(data=b"", author="A"),
    }
    fields.update(overrides)

    return NewMountain(**fields)


def test_a_minimal_draft_has_no_violation():
    assert new_mountain_violations(draft()) == ()


def test_the_boundary_values_are_accepted():
    extreme = draft(
        coordinates=Coordinates(latitude=-90.0, longitude=180.0),
        summary="Short.",
        osm_node_id=1,
        wikidata_id="Q1",
    )

    assert new_mountain_violations(extreme) == ()


def test_the_violations_follow_a_fixed_order():
    violations = new_mountain_violations(
        draft(
            slug="BAD",
            name=" ",
            coordinates=Coordinates(latitude=91.0, longitude=0.0),
            elevation_meters=0,
            summary="",
            osm_node_id=-1,
            wikidata_id="x",
            photograph=NewPhotograph(
                data=b"",
                author="",
                license_name="",
                license_url="http://a",
                source_page_url="http://b",
            ),
        )
    )

    assert violations == (
        NewMountainViolation.SLUG_INVALID,
        NewMountainViolation.NAME_BLANK,
        NewMountainViolation.COORDINATES_OUT_OF_RANGE,
        NewMountainViolation.ELEVATION_NOT_POSITIVE,
        NewMountainViolation.SUMMARY_INVALID,
        NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE,
        NewMountainViolation.WIKIDATA_ID_INVALID,
        NewMountainViolation.IMAGE_AUTHOR_MISSING,
        NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE,
        NewMountainViolation.IMAGE_LICENSE_NAME_BLANK,
        NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK,
        NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK,
    )


def test_a_license_url_with_a_license_name_is_accepted():
    photograph = NewPhotograph(
        data=b"", author="A", license_name="CC", license_url="https://example.org/l"
    )

    assert new_mountain_violations(draft(photograph=photograph)) == ()
