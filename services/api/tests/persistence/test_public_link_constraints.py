import pytest
from django.db import IntegrityError, transaction

from serendipeak.catalog.public_link import is_public_link
from tests.support.public_links import PUBLIC_LINK_CASES
from tests.support.records import image_record, insert_error, mountain_record

IMAGE_LINK_CONSTRAINTS = {
    "source_page_url": "mountain_image_source_page_url_public_link",
    "license_url": "mountain_image_license_url_public_link",
}

pytestmark = pytest.mark.django_db


@pytest.fixture
def mountain():
    record = mountain_record()
    record.save()
    return record


@pytest.mark.parametrize("column", IMAGE_LINK_CONSTRAINTS)
@pytest.mark.parametrize(("value", "accepted"), PUBLIC_LINK_CASES)
def test_each_image_link_constraint_agrees_with_the_python_rule(mountain, column, value, accepted):
    assert is_public_link(value) is accepted

    record = image_record(mountain, **{column: value})
    if accepted:
        record.save(force_insert=True)
    else:
        assert insert_error(record).constraint_name == IMAGE_LINK_CONSTRAINTS[column]


def test_optional_links_may_be_absent(mountain):
    image_record(mountain, license_url=None).save(force_insert=True)


def test_an_existing_row_cannot_be_updated_to_an_unsafe_link(mountain):
    record = image_record(mountain)
    record.save(force_insert=True)

    record.source_page_url = "javascript:alert(1)"

    assert insert_error_on_update(record) == "mountain_image_source_page_url_public_link"


def insert_error_on_update(record):
    try:
        with transaction.atomic():
            record.save(force_update=True)
    except IntegrityError as error:
        return error.__cause__.diag.constraint_name
    raise AssertionError("update was accepted")
