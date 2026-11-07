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
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.support.catalog import committed_geography, load_seed_document, photograph_media
from tests.support.geography import geography_document
from tests.support.records import attach_committed_media, mountain_record

pytestmark = pytest.mark.django_db


@pytest.fixture
def geography(tmp_path):
    """The synthetic geography input of the committed seed, as a file with its checksum."""
    document = geography_document(
        (entry.id, entry.slug, entry.continent_code, list(entry.country_codes))
        for entry in committed_geography().mountains
    )
    path = tmp_path / "geography.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    return ["--geography", str(path), "--geography-sha256", document["content_sha256"]]


def run(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command(command, *arguments, stdout=stdout, stderr=stderr)
    return stdout.getvalue(), stderr.getvalue()


def failure(command, *arguments):
    stderr = io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command(command, *arguments, stdout=io.StringIO(), stderr=stderr)
    return str(raised.value), stderr.getvalue()


def test_bootstrap_loads_and_verifies_the_committed_seed(geography):
    stdout, stderr = run("bootstrap_catalog", *geography)

    assert stdout.splitlines() == [
        "Catalog: 73 mountains, 73 images, 8 daily discoveries.",
        "Seed mismatches: 0.",
        "Geography: compared.",
        "Frozen catalog: 73/73 mountains match.",
    ]
    assert stderr == ""


def test_bootstrap_refuses_without_a_geography_input_before_writing():
    message, _ = failure("bootstrap_catalog")

    assert "pass --geography and --geography-sha256" in message
    assert not MountainRecord.objects.exists()


def test_the_geography_input_and_its_checksum_are_given_together():
    message, _ = failure("bootstrap_catalog", "--geography-sha256", "0" * 64)

    assert message == "--geography and --geography-sha256 are given together"


def test_bootstrap_refuses_a_geography_input_with_another_checksum_before_writing(geography):
    message, _ = failure("bootstrap_catalog", geography[0], geography[1], geography[2], "0" * 64)

    assert message == "the input does not have the expected checksum"
    assert not MountainRecord.objects.exists()


def test_bootstrap_names_the_mountains_a_geography_input_does_not_cover(tmp_path):
    entries = list(committed_geography().mountains)[1:]
    document = geography_document(
        (entry.id, entry.slug, entry.continent_code, list(entry.country_codes)) for entry in entries
    )
    path = tmp_path / "partial.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    message, stderr = failure(
        "bootstrap_catalog",
        "--geography",
        str(path),
        "--geography-sha256",
        document["content_sha256"],
    )

    assert message == "the geography input does not fit the seed"
    assert stderr.count("has no entry") == 1
    assert not MountainRecord.objects.exists()


def test_verify_only_ignores_photograph_media_attached_after_the_bootstrap(geography):
    run("bootstrap_catalog", *geography)
    media = photograph_media("c" * 64)
    MountainImageRecord.objects.update(
        original_key=media.original_key,
        original_sha256=media.original_sha256,
        page_key=media.page_key,
        viewer_key=media.viewer_key,
    )

    stdout, stderr = run("bootstrap_catalog", "--verify-only", *geography)

    assert "Seed mismatches: 0." in stdout
    assert "Frozen catalog: 73/73 mountains match." in stdout
    assert stderr == ""


def test_verify_only_without_a_geography_input_says_it_did_not_compare_it(geography):
    run("bootstrap_catalog", *geography)

    stdout, _ = run("bootstrap_catalog", "--verify-only")

    assert "Geography: not compared (no geography input given)." in stdout


def test_verify_only_reports_a_continent_that_differs_from_the_geography_input(geography):
    run("bootstrap_catalog", *geography)
    MountainRecord.objects.filter(slug="aconcagua").update(continent_id="NA")

    _, stderr = failure("bootstrap_catalog", "--verify-only", *geography)

    assert "differs in continent" in stderr


def test_a_second_bootstrap_is_refused(geography):
    run("bootstrap_catalog", *geography)

    message, _ = failure("bootstrap_catalog", *geography)

    assert message == "the catalog already holds mountains"


def test_verify_only_is_repeatable_on_a_bootstrapped_catalog(geography):
    run("bootstrap_catalog", *geography)

    first, _ = run("bootstrap_catalog", "--verify-only", *geography)
    second, _ = run("bootstrap_catalog", "--verify-only", *geography)

    assert first == second
    assert "Frozen catalog: 73/73 mountains match." in first


def test_verify_only_fails_on_an_empty_catalog_and_lists_the_mismatches():
    message, stderr = failure("bootstrap_catalog", "--verify-only")

    assert message == "the catalog does not match the seed or the frozen catalog"
    assert "mountain aconcagua (5fc406a6-46cd-4dba-952a-e356481e2ad6) is missing" in stderr
    assert "aconcagua: missing from the catalog" in stderr


def test_bootstrap_rejects_an_invalid_seed_without_writing(tmp_path, geography):
    document = copy.deepcopy(load_seed_document())
    document["content"]["mountains"][0]["status"] = "unknown"
    document["content_sha256"] = content_sha256(document["content"])
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps(document), encoding="utf-8")

    message, _ = failure("bootstrap_catalog", "--seed", str(seed), *geography)

    assert message == "mountain 'aconcagua': unknown status 'unknown'"
    assert not MountainRecord.objects.exists()


def test_bootstrap_reports_an_unreadable_seed(tmp_path, geography):
    missing = tmp_path / "missing.json"

    message, _ = failure("bootstrap_catalog", "--seed", str(missing), *geography)

    assert message.startswith(f"cannot read {missing}")


def test_check_catalog_passes_on_the_bootstrapped_and_materialized_catalog(geography):
    run("bootstrap_catalog", *geography)
    attach_committed_media()

    stdout, _ = run("check_catalog")

    assert stdout == "73 active mountains satisfy the publication invariants.\n"


def test_check_catalog_reports_every_photograph_still_awaiting_materialization(geography):
    run("bootstrap_catalog", *geography)

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
