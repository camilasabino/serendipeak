import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import SlugTaken
from serendipeak.catalog.mountain_update import MountainUpdate, public_edit_violations
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.catalog.status_transitions import DEACTIVATE
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import (
    MountainCountryRecord,
    MountainRecord,
    MountainRegionRecord,
)
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from serendipeak.persistence.mountain_update_store import DjangoMountainUpdateStore
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.concurrency import run_while_a_change_holds_the_lock

pytestmark = pytest.mark.django_db(transaction=True)

TARGET = catalog_mountain("target-peak")
OTHER = catalog_mountain("other-peak")


def update_of(**overrides):
    fields = {
        "slug": "target-peak",
        "name": "Target Peak",
        "elevation_meters": 6961,
        "continent_code": "SA",
        "country_codes": ("AR",),
        "summary": "Highest mountain outside Asia.",
        "osm_node_id": 1504741757,
        "wikidata_id": "Q39739",
    }
    fields.update(overrides)

    return MountainUpdate(**fields)


def save(entry=TARGET, gate=public_edit_violations, **overrides):
    return DjangoMountainUpdateStore().update(entry.mountain.id, update_of(**overrides), gate)


@pytest.fixture(autouse=True)
def catalog():
    DjangoCatalogStore().load(catalog_seed(TARGET, OTHER))


def links_of(entry):
    return sorted(
        MountainCountryRecord.objects.filter(mountain_id=entry.mountain.id).values_list(
            "country_id", flat=True
        )
    )


def test_two_updates_of_one_mountain_run_one_after_the_other_without_losing_a_link():
    # The waiting update diffs against the links the first one committed: judged on the state
    # read before the wait, it would insert CL again and fail on the primary key.
    run_while_a_change_holds_the_lock(
        lambda: save(country_codes=("CL",)),
        lambda: save(country_codes=("AR", "CL"), name="Second"),
    )

    assert links_of(TARGET) == ["AR", "CL"]
    assert MountainRecord.objects.get(pk=TARGET.mountain.id).name_en == "Second"


def test_an_update_waiting_for_a_status_change_is_judged_on_the_status_it_then_finds():
    judged = []

    def gate(prospective):
        judged.append(prospective.status)

        return ()

    def deactivate():
        DjangoMountainStatusStore().change_status(
            TARGET.mountain.id, DEACTIVATE, lambda mountain: ()
        )

    run_while_a_change_holds_the_lock(deactivate, lambda: save(gate=gate, name="Second"))

    assert judged == [MountainStatus.INACTIVE]
    assert MountainRecord.objects.get(pk=TARGET.mountain.id).status == "inactive"


def test_two_updates_to_one_slug_let_exactly_one_succeed_and_leave_the_other_unchanged():
    def losing_update():
        try:
            save(OTHER, slug="shared-slug", name="Second")
        except SlugTaken as error:
            return error

    refusal = run_while_a_change_holds_the_lock(
        lambda: save(slug="shared-slug", name="First"), losing_update
    )

    # The second update locks its own row, so it waits for the unique key, not for the first
    # mountain's lock, and loses once the first commits.
    assert refusal.slug == "shared-slug"
    assert dict(MountainRecord.objects.values_list("slug", "name_en")) == {
        "shared-slug": "First",
        "other-peak": "Other Peak",
    }


def test_a_region_deleted_while_an_update_waits_for_it_is_refused_as_unknown():
    region = MountainRegionRecord.objects.create(slug="doomed-range", name_en="Doomed Range")
    region_id = region.id

    def refused_update():
        try:
            save(region_id=region_id)
        except UnknownRegion as error:
            return error

    refusal = run_while_a_change_holds_the_lock(region.delete, refused_update)

    assert refusal.region_id == region_id
    assert MountainRecord.objects.get(pk=TARGET.mountain.id).region_id != region_id
