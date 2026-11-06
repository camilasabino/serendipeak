import pytest

from tests.support.records import image_record, insert_error, mountain_record

DIGEST = "5d" * 32
UPLOADED = {
    "legacy_file_url": None,
    "source_identifier": None,
    "original_key": f"photographs/{DIGEST}/original.jpg",
    "original_sha256": DIGEST,
    "page_key": f"photographs/{DIGEST}/page-r1.jpg",
    "viewer_key": f"photographs/{DIGEST}/viewer-r1.jpg",
    "width": 4000,
    "height": 3000,
}

REJECTED_IMAGES = [
    ("mountain_image_legacy_file_url_https", {"legacy_file_url": " "}),
    ("mountain_image_dimensions_complete", {"width": 4994}),
    ("mountain_image_dimensions_complete", {"height": 2758}),
    ("mountain_image_width_positive", {"width": 0, "height": 2758}),
    ("mountain_image_height_positive", {"width": 4994, "height": -1}),
    ("mountain_image_has_media_or_legacy_file_url", {"legacy_file_url": None}),
    ("mountain_image_creator_not_blank", {"creator": " "}),
    ("mountain_image_creator_url_not_blank", {"creator_url": " "}),
    ("mountain_image_attribution_not_blank", {"attribution": ""}),
    ("mountain_image_license_name_not_blank", {"license_name": ""}),
    ("mountain_image_license_url_not_blank", {"license_url": " "}),
    (
        "mountain_image_license_url_requires_license_name",
        {"license_name": None, "license_url": "https://unsplash.com/license"},
    ),
    ("mountain_image_license_reported_not_blank", {"license_reported": ""}),
    ("mountain_image_license_election_basis_url_not_blank", {"license_election_basis_url": " "}),
    ("mountain_image_source_page_url_not_blank", {"source_page_url": ""}),
    ("mountain_image_source_identifier_not_blank", {"source_identifier": "\t"}),
]


@pytest.fixture
def mountain(db):
    record = mountain_record()
    record.save()
    return record


@pytest.mark.parametrize(("constraint", "overrides"), REJECTED_IMAGES)
def test_rejects_invalid_image_rows(mountain, constraint, overrides):
    error = insert_error(image_record(mountain, **overrides))

    assert error.constraint_name == constraint


def test_accepts_an_image_with_only_required_fields(mountain):
    image_record(mountain).save(force_insert=True)


def test_accepts_an_uploaded_photograph_without_legacy_provenance_or_license(mountain):
    image_record(
        mountain,
        **UPLOADED,
        creator="Sébastien Goldberg",
        creator_url="https://unsplash.com/@sebastiengoldberg",
        license_name=None,
        source_page_url="https://unsplash.com/photos/a-mountain",
    ).save(force_insert=True)


def test_accepts_a_license_name_without_a_license_url(mountain):
    image_record(mountain, license_name="Unsplash License", license_url=None).save(
        force_insert=True
    )


def test_accepts_an_image_with_every_provenance_field(mountain):
    image_record(
        mountain,
        width=4994,
        height=2758,
        creator="Denali National Park and Preserve",
        license_name="CC BY 2.0",
        license_url="https://creativecommons.org/licenses/by/2.0/",
        license_reported="Public domain",
        license_election_basis_url="https://www.flickr.com/photos/denalinps/7205909856/",
        approved_on="2026-10-06",
    ).save(force_insert=True)


def test_allows_one_image_per_mountain(mountain):
    image_record(mountain).save(force_insert=True)

    error = insert_error(image_record(mountain, source_identifier="File:Other.jpg"))

    assert error.constraint_name == "mountain_image_pkey"
