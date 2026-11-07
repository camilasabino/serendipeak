import io
import json
import stat

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from tests.support.geography import geography_document, invented_id
from tests.support.geography_schema import (
    PRESERVED,
    fingerprints,
    migrate_to_schema_ready,
    mountain_values,
    nothing_is_assigned,
    stored_geography,
)
from tests.support.migrations import migrate_to_latest_discarding_catalog

pytestmark = pytest.mark.django_db(transaction=True)

MOUNTAINS = {"alpha-peak": ("Argentina",), "beta-peak": ("Switzerland", "Italy"), "ice-peak": ()}


@pytest.fixture(autouse=True)
def mountains_at_the_schema_ready_for_the_backfill():
    model = migrate_to_schema_ready()
    for slug, names in MOUNTAINS.items():
        model.objects.create(**mountain_values(slug, list(names)))
    yield
    migrate_to_latest_discarding_catalog()


def write_input(tmp_path, document=None):
    document = document or geography_document(
        [
            (invented_id("alpha-peak"), "alpha-peak", "SA", ["AR"]),
            (invented_id("beta-peak"), "beta-peak", "EU", ["CH", "IT"]),
            (invented_id("ice-peak"), "ice-peak", "AN", ["AQ"]),
        ]
    )
    path = tmp_path / "geography.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    return path, document["content_sha256"]


def run(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    call_command(command, *arguments, stdout=stdout, stderr=stderr)

    return stdout.getvalue(), stderr.getvalue()


def failure(command, *arguments):
    stdout, stderr = io.StringIO(), io.StringIO()
    with pytest.raises(CommandError) as raised:
        call_command(command, *arguments, stdout=stdout, stderr=stderr)

    return str(raised.value), stdout.getvalue(), stderr.getvalue()


class TestApplyGeographyBackfill:
    def test_it_prints_the_target_first_then_the_changes_and_the_counts(self, tmp_path):
        path, sha = write_input(tmp_path)

        stdout, stderr = run("apply_geography_backfill", "--input", str(path), "--sha256", sha)

        lines = stdout.splitlines()
        assert lines[0].startswith("Target: database test_serendipeak on ")
        assert lines[0].endswith("catalog migration 0017_mountain_continent.")
        assert lines[1:-1] == [
            "alpha-peak: continent - -> SA; adds AR",
            "beta-peak: continent - -> EU; adds CH, IT",
            "ice-peak: continent - -> AN; adds AQ",
        ]
        assert lines[-1] == "Applied. 3 mountains checked, 3 changed, 0 unchanged."
        assert stderr == ""
        assert stored_geography()["beta-peak"] == ("EU", ["CH", "IT"])

    def test_a_dry_run_says_so_and_writes_nothing(self, tmp_path):
        path, sha = write_input(tmp_path)
        before = fingerprints(PRESERVED)

        stdout, _ = run(
            "apply_geography_backfill", "--input", str(path), "--sha256", sha, "--dry-run"
        )

        assert stdout.splitlines()[-1] == (
            "Dry run, nothing was written. 3 mountains checked, 3 changed, 0 unchanged."
        )
        assert nothing_is_assigned()
        assert fingerprints(PRESERVED) == before

    def test_a_rerun_reports_no_change(self, tmp_path):
        path, sha = write_input(tmp_path)
        run("apply_geography_backfill", "--input", str(path), "--sha256", sha)

        stdout, _ = run("apply_geography_backfill", "--input", str(path), "--sha256", sha)

        assert stdout.splitlines()[1:] == ["Applied. 3 mountains checked, 0 changed, 3 unchanged."]

    def test_a_wrong_checksum_is_refused_before_the_database_is_named(self, tmp_path):
        path, _ = write_input(tmp_path)

        message, stdout, _ = failure(
            "apply_geography_backfill", "--input", str(path), "--sha256", "0" * 64
        )

        assert message == "the input does not have the expected checksum"
        assert stdout == ""
        assert nothing_is_assigned()

    def test_an_input_that_does_not_fit_names_every_problem_after_the_target(self, tmp_path):
        path, sha = write_input(
            tmp_path,
            geography_document(
                [
                    (invented_id("alpha-peak"), "alpha-peak", "SA", ["CL"]),
                    (invented_id("gone-peak"), "gone-peak", "EU", []),
                ]
            ),
        )

        message, stdout, stderr = failure(
            "apply_geography_backfill", "--input", str(path), "--sha256", sha
        )

        assert message == "the geography input does not fit the catalog"
        assert stdout.startswith("Target: database ")
        assert "alpha-peak: countries ['CL'] do not match" in stderr
        assert "entry gone-peak" in stderr
        assert "mountain beta-peak" in stderr
        assert nothing_is_assigned()

    def test_an_unreadable_input_is_reported(self, tmp_path):
        missing = tmp_path / "missing.json"

        message, _, _ = failure(
            "apply_geography_backfill", "--input", str(missing), "--sha256", "0" * 64
        )

        assert message.startswith(f"cannot read {missing}")

    def test_the_input_and_checksum_are_required(self):
        with pytest.raises(CommandError, match="required"):
            call_command("apply_geography_backfill")

    def test_it_refuses_a_schema_that_is_not_ready(self, tmp_path):
        from tests.support.geography_schema import LOCALIZED
        from tests.support.migrations import migrate_to

        migrate_to(LOCALIZED)
        path, sha = write_input(tmp_path)

        message, _, _ = failure("apply_geography_backfill", "--input", str(path), "--sha256", sha)

        assert "0014_localized_mountain_text" in message
        assert "0017_mountain_continent" in message


class TestPrepareGeographyInput:
    def test_it_writes_a_private_draft_with_the_countries_and_no_continents(self, tmp_path):
        output = tmp_path / "draft.json"

        stdout, _ = run("prepare_geography_input", "--output", str(output))

        draft = json.loads(output.read_text(encoding="utf-8"))
        assert stdout == f"Wrote a draft of 3 mountains to {output}.\n"
        assert stat.S_IMODE(output.stat().st_mode) == 0o600
        assert (draft["format"], draft["version"], draft["content_sha256"]) == (
            "serendipeak.geography",
            1,
            None,
        )
        assert draft["mountains"] == [
            {
                "id": str(invented_id("alpha-peak")),
                "slug": "alpha-peak",
                "continent": None,
                "countries": ["AR"],
            },
            {
                "id": str(invented_id("beta-peak")),
                "slug": "beta-peak",
                "continent": None,
                "countries": ["CH", "IT"],
            },
            {
                "id": str(invented_id("ice-peak")),
                "slug": "ice-peak",
                "continent": None,
                "countries": [],
            },
        ]

    def test_it_is_read_only(self, tmp_path):
        before = fingerprints(PRESERVED)

        run("prepare_geography_input", "--output", str(tmp_path / "draft.json"))

        assert fingerprints(PRESERVED) == before
        assert nothing_is_assigned()

    def test_it_never_overwrites_a_file(self, tmp_path):
        output = tmp_path / "draft.json"
        output.write_text("keep me", encoding="utf-8")

        message, _, _ = failure("prepare_geography_input", "--output", str(output))

        assert message.startswith(f"cannot write {output}")
        assert output.read_text(encoding="utf-8") == "keep me"

    def test_a_draft_cannot_be_applied(self, tmp_path):
        output = tmp_path / "draft.json"
        run("prepare_geography_input", "--output", str(output))

        message, _, _ = failure(
            "apply_geography_backfill", "--input", str(output), "--sha256", "0" * 64
        )

        assert message == "content_sha256 does not match the content"
        assert nothing_is_assigned()

    def test_a_country_name_outside_the_alias_table_stops_it_without_a_file(self, tmp_path):
        from tests.support.geography_schema import SCHEMA_READY
        from tests.support.migrations import historical_model

        historical_model(SCHEMA_READY, "MountainRecord").objects.filter(slug="alpha-peak").update(
            countries=["Narnia"]
        )
        output = tmp_path / "draft.json"

        message, _, _ = failure("prepare_geography_input", "--output", str(output))

        assert "Narnia" in message
        assert not output.exists()
