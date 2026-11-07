import pytest
from django.db import IntegrityError

from tests.support.migrations import applied_head, migrate_to, migrate_to_latest
from tests.support.records import mountain_record

BEFORE = ("catalog", "0004_public_link_https")
AFTER = ("catalog", "0005_optional_provenance")

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def back_to_the_latest_schema():
    yield
    migrate_to_latest()


def test_reversing_and_reapplying_succeeds_while_every_active_mountain_has_its_references():
    mountain_record().save()

    migrate_to(BEFORE)
    assert applied_head() == BEFORE[1]

    migrate_to(AFTER)
    assert applied_head() == AFTER[1]


def test_reversing_fails_once_an_active_mountain_lacks_source_references():
    mountain_record(osm_node_id=None, wikidata_id=None).save()

    with pytest.raises(IntegrityError):
        migrate_to(BEFORE)

    assert applied_head() >= AFTER[1]
