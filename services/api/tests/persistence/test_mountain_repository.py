import pytest
from django.db import connection

from serendipeak.catalog.entities import MountainStatus
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.mountain_repository import DjangoMountainRepository
from tests.support.catalog import catalog_mountain, catalog_seed

pytestmark = pytest.mark.django_db

WITH_IMAGE = catalog_mountain("aconcagua")
WITHOUT_IMAGE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE, primary_image=None)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)


@pytest.fixture
def repository():
    DjangoCatalogStore().load(catalog_seed(WITH_IMAGE, WITHOUT_IMAGE, DRAFT))
    return DjangoMountainRepository()


@pytest.mark.parametrize(
    ("slug", "found"),
    [
        ("aconcagua", True),
        ("old-peak", True),
        ("draft-peak", False),
        ("unknown-peak", False),
    ],
)
def test_a_lookup_joins_the_image_and_continent_and_reads_the_countries_in_one_more_query(
    repository,
    django_assert_num_queries,
    slug,
    found,
):
    with django_assert_num_queries(2 if found else 1) as captured:
        mountain = repository.find_public_by_slug(slug)

    assert (mountain is not None) is found
    sql = captured.captured_queries[0]["sql"]
    assert 'LEFT OUTER JOIN "mountain_image"' in sql
    assert 'INNER JOIN "continent"' in sql
    assert """"mountain"."status" IN ('active', 'inactive')""" in sql
    if found:
        assert 'FROM "mountain_country" INNER JOIN "country"' in captured.captured_queries[1]["sql"]


def test_listing_active_candidates_is_one_query_without_model_instances(
    repository,
    django_assert_num_queries,
):
    with django_assert_num_queries(1) as captured:
        candidates = repository.list_active_candidates()

    assert [candidate.slug for candidate in candidates] == ["aconcagua"]
    sql = captured.captured_queries[0]["sql"]
    assert sql.startswith('SELECT "mountain"."id" AS "id", "mountain"."slug" AS "slug" FROM')
    assert """WHERE "mountain"."status" = 'active'""" in sql
    assert 'ORDER BY "mountain"."slug" COLLATE "C"' in sql


def test_database_errors_become_infrastructure_errors(repository):
    with connection.cursor() as cursor:
        cursor.execute('ALTER TABLE "mountain_image" RENAME TO "mountain_image_unavailable"')

    with pytest.raises(InfrastructureError) as raised:
        repository.find_public_by_slug("aconcagua")

    assert "mountain_image" in str(raised.value.__cause__)
