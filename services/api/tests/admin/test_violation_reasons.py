from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.persistence.admin import violation_reasons
from tests.support.catalog import mountain, primary_image


def test_an_unsafe_link_violation_names_every_offending_field():
    candidate = mountain(
        primary_image=primary_image(
            source_page_url="http://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
            license_url="javascript:alert(1)",
        ),
    )

    reasons = violation_reasons(publication_violations(candidate), candidate)

    assert reasons == [
        "the photo page URL does not use https://",
        "the photograph license URL does not use https://",
    ]


def test_other_violations_keep_their_own_message():
    candidate = mountain(camera=None, primary_image=primary_image(license_url="http://example.com"))

    reasons = violation_reasons(publication_violations(candidate), candidate)

    assert reasons == [
        "the camera is missing",
        "the photograph license URL does not use https://",
    ]
    assert PublicationViolation.CAMERA_MISSING in publication_violations(candidate)


def test_a_photograph_without_media_is_reported_as_not_stored_yet():
    candidate = mountain(primary_image=primary_image(media=None))

    reasons = violation_reasons(publication_violations(candidate), candidate)

    assert reasons == ["the photograph file is not stored yet"]
