import pytest

from tests.support.records import image_record, insert_error, mountain_record

DIGEST = "5d" * 32
MEDIA = {
    "original_key": f"photographs/{DIGEST}/original.jpg",
    "original_sha256": DIGEST,
    "page_key": f"photographs/{DIGEST}/page-r1.jpg",
    "viewer_key": f"photographs/{DIGEST}/viewer-r1.jpg",
    "width": 4000,
    "height": 3000,
}

REJECTED_IMAGES = [
    ("mountain_image_dimensions_complete", {"width": 4994}),
    ("mountain_image_dimensions_complete", {"height": 2758}),
    ("mountain_image_width_positive", {"width": 0, "height": 2758}),
    ("mountain_image_height_positive", {"width": 4994, "height": -1}),
    ("mountain_image_author_not_blank", {"author": ""}),
    ("mountain_image_author_not_blank", {"author": " "}),
    ("mountain_image_license_name_not_blank", {"license_name": ""}),
    ("mountain_image_license_url_not_blank", {"license_url": " "}),
    (
        "mountain_image_license_url_requires_license_name",
        {"license_name": None, "license_url": "https://unsplash.com/license"},
    ),
    ("mountain_image_source_page_url_not_blank", {"source_page_url": ""}),
    ("mountain_image_source_page_url_public_link", {"source_page_url": "http://example.com"}),
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


def test_accepts_an_uploaded_photograph_from_another_source(mountain):
    image_record(
        mountain,
        **MEDIA,
        author="Sébastien Goldberg",
        license_name="Unsplash License",
        license_url="https://unsplash.com/license",
        source_page_url="https://unsplash.com/photos/a-mountain",
    ).save(force_insert=True)


def test_accepts_a_photograph_with_neither_a_source_page_nor_a_license(mountain):
    image_record(mountain, **MEDIA, source_page_url=None, license_name=None).save(force_insert=True)


def test_accepts_a_license_name_without_a_license_url(mountain):
    image_record(mountain, license_name="Unsplash License", license_url=None).save(
        force_insert=True
    )


def test_allows_one_image_per_mountain(mountain):
    image_record(mountain).save(force_insert=True)

    error = insert_error(image_record(mountain, author="Someone else"))

    assert error.constraint_name == "mountain_image_pkey"
