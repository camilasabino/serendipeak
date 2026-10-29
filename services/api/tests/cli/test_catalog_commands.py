import copy
import io
import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError

from serendipeak.catalog.bootstrap.seed import content_sha256
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.cli.errors import command_error
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.models import MountainRecord
from tests.support.catalog import load_seed_document
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


def test_bootstrap_loads_and_verifies_the_committed_seed():
    stdout, stderr = run("bootstrap_catalog")

    assert stdout.splitlines() == [
        "Catalog: 73 mountains, 73 images, 8 daily discoveries.",
        "Seed mismatches: 0.",
        "Frozen catalog: 73/73 mountains match.",
    ]
    assert stderr == ""


def test_a_second_bootstrap_is_refused():
    run("bootstrap_catalog")

    message, _ = failure("bootstrap_catalog")

    assert message == "the catalog already holds mountains"


def test_verify_only_is_repeatable_on_a_bootstrapped_catalog():
    run("bootstrap_catalog")

    first, _ = run("bootstrap_catalog", "--verify-only")
    second, _ = run("bootstrap_catalog", "--verify-only")

    assert first == second
    assert "Frozen catalog: 73/73 mountains match." in first


def test_verify_only_fails_on_an_empty_catalog_and_lists_the_mismatches():
    message, stderr = failure("bootstrap_catalog", "--verify-only")

    assert message == "the catalog does not match the seed or the frozen catalog"
    assert "mountain aconcagua (5fc406a6-46cd-4dba-952a-e356481e2ad6) is missing" in stderr
    assert "aconcagua: missing from the catalog" in stderr


def test_bootstrap_rejects_an_invalid_seed_without_writing(tmp_path):
    document = copy.deepcopy(load_seed_document())
    document["content"]["mountains"][0]["status"] = "unknown"
    document["content_sha256"] = content_sha256(document["content"])
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps(document), encoding="utf-8")

    message, _ = failure("bootstrap_catalog", "--seed", str(seed))

    assert message == "mountain 'aconcagua': unknown status 'unknown'"
    assert not MountainRecord.objects.exists()


def test_bootstrap_reports_an_unreadable_seed(tmp_path):
    missing = tmp_path / "missing.json"

    message, _ = failure("bootstrap_catalog", "--seed", str(missing))

    assert message.startswith(f"cannot read {missing}")


def test_check_catalog_passes_on_the_bootstrapped_catalog():
    run("bootstrap_catalog")

    stdout, _ = run("check_catalog")

    assert stdout == "73 active mountains satisfy the publication invariants.\n"


def test_check_catalog_lists_violations_and_fails():
    mountain_record(slug="mont-blanc", name="Mont Blanc").save()

    message, stderr = failure("check_catalog")

    assert message == "1 publication violations in 1 active mountains"
    assert stderr == "mont-blanc: primary_image_missing\n"


def test_infrastructure_errors_name_their_cause():
    error = InfrastructureError("the database operation failed")
    error.__cause__ = OperationalError("connection refused")

    assert str(command_error(error)) == "the database operation failed: connection refused"


def test_application_errors_keep_their_message():
    assert str(command_error(CatalogAlreadyPopulated())) == "the catalog already holds mountains"
