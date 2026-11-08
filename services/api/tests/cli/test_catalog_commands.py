import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError

from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import fixture_catalog, fixture_catalog_with_media
from tests.support.records import mountain_record

pytestmark = pytest.mark.django_db


def run(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command(command, *arguments, stdout=stdout, stderr=stderr)
    return stdout.getvalue(), stderr.getvalue()


def failure(command, *arguments):
    stderr = io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command(command, *arguments, stdout=io.StringIO(), stderr=stderr)
    return str(raised.value), stderr.getvalue()


def test_check_catalog_passes_on_a_catalog_whose_photographs_all_have_media():
    DjangoCatalogStore().load(fixture_catalog_with_media())

    stdout, _ = run("check_catalog")

    assert stdout == "73 active mountains satisfy the publication invariants.\n"


def test_check_catalog_reports_every_photograph_still_awaiting_media():
    DjangoCatalogStore().load(fixture_catalog())

    message, stderr = failure("check_catalog")

    assert message == "73 publication violations in 73 active mountains"
    assert stderr.splitlines()[0] == "aconcagua: image_media_missing"


def test_check_catalog_lists_violations_and_fails():
    mountain_record(slug="mont-blanc", name_en="Mont Blanc").save()

    message, stderr = failure("check_catalog")

    assert message == "1 publication violations in 1 active mountains"
    assert stderr == "mont-blanc: primary_image_missing\n"


def test_infrastructure_errors_name_their_cause():
    error = InfrastructureError("the database operation failed")
    error.__cause__ = OperationalError("connection refused")

    assert str(command_error(error)) == "the database operation failed: connection refused"


def test_application_errors_keep_their_message():
    assert str(command_error(CatalogAlreadyPopulated())) == "the catalog already holds mountains"


def test_prune_daily_discoveries_deletes_only_expired_rows_and_is_repeatable():
    import datetime

    from serendipeak.persistence.models import DailyDiscoveryRecord

    today = datetime.datetime.now(datetime.UTC).date()
    expired = today - datetime.timedelta(days=366)
    retained = today - datetime.timedelta(days=365)
    record = mountain_record()
    record.save()
    for day in (expired, retained, today):
        DailyDiscoveryRecord(date=day, mountain=record).save(force_insert=True)

    stdout, _ = run("prune_daily_discoveries")
    again, _ = run("prune_daily_discoveries")

    cutoff = retained.isoformat()
    assert stdout == f"Deleted 1 daily discoveries dated before {cutoff}.\n"
    assert again == f"Deleted 0 daily discoveries dated before {cutoff}.\n"
    assert sorted(DailyDiscoveryRecord.objects.values_list("date", flat=True)) == [retained, today]
