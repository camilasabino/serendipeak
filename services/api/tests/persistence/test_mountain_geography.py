import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.entities import DailyMountain
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.models import MountainCountryRecord, MountainRecord
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.geography import continent, countries, reference

pytestmark = pytest.mark.django_db

ALL_CODES = sorted(reference().countries)


def load(*entries):
    DjangoCatalogStore().load(catalog_of(*entries))


@pytest.mark.parametrize("how_many", [0, 1, 3, 12, 40])
def test_reading_a_mountain_costs_two_queries_whatever_its_number_of_countries(
    how_many, django_assert_num_queries
):
    load(catalog_mountain("many-lands", region=None, countries=countries(*ALL_CODES[:how_many])))

    with django_assert_num_queries(2):
        found = DjangoMountainRepository().find_public_by_slug("many-lands")

    assert len(found.countries) == how_many


def test_reading_a_mountain_joins_no_country_row_per_link():
    load(catalog_mountain("many-lands", region=None, countries=countries("AR", "CL", "BO")))

    with CaptureQueriesContext(connection) as queries:
        DjangoMountainRepository().find_public_by_slug("many-lands")

    first, second = (query["sql"] for query in queries.captured_queries)
    assert 'FROM "mountain"' in first and "mountain_country" not in first
    assert 'FROM "mountain_country" INNER JOIN "country"' in second


def test_a_daily_mountain_carries_its_geography_in_two_queries(django_assert_num_queries):
    import datetime

    entry = catalog_mountain(
        "daily-peak", region=None, continent=continent("AS"), countries=countries("NP", "CN")
    )
    load(entry)
    day = datetime.date(2026, 10, 3)
    repository = DjangoDailyDiscoveryRepository()
    repository.insert_or_get(day, entry.mountain.id)

    with django_assert_num_queries(2):
        daily = repository.find_by_date(day)

    assert isinstance(daily, DailyMountain)
    assert daily.mountain.continent.code == "AS"
    assert [country.code for country in daily.mountain.countries] == ["CN", "NP"]


def test_a_mountain_outside_its_countries_continent_is_stored_as_given():
    load(
        catalog_mountain(
            "european-in-africa", continent=continent("AF"), countries=countries("CH")
        ),
        catalog_mountain(
            "american-in-oceania", continent=continent("OC"), countries=countries("US")
        ),
        catalog_mountain("southern-ice", continent=continent("AN"), countries=countries("AQ")),
        catalog_mountain("ordinary-peak", continent=continent("SA"), countries=countries("AR")),
    )

    stored = {
        record.slug: (record.continent_id, [link.country_id for link in record.country_links.all()])
        for record in MountainRecord.objects.prefetch_related("country_links")
    }

    assert stored == {
        "european-in-africa": ("AF", ["CH"]),
        "american-in-oceania": ("OC", ["US"]),
        "southern-ice": ("AN", ["AQ"]),
        "ordinary-peak": ("SA", ["AR"]),
    }


def test_a_draft_mountain_has_a_continent_and_may_have_no_country():
    load(
        catalog_mountain(
            "new-draft", status=MountainStatus.DRAFT, continent=continent("EU"), countries=()
        )
    )

    record = MountainRecord.objects.get(slug="new-draft")

    assert record.continent_id == "EU"
    assert not MountainCountryRecord.objects.exists()


def test_the_load_writes_one_link_per_country_and_no_other_geography():
    load(catalog_mountain("two-lands", countries=countries("AR", "CL")))

    assert sorted(MountainCountryRecord.objects.values_list("country_id", flat=True)) == [
        "AR",
        "CL",
    ]
