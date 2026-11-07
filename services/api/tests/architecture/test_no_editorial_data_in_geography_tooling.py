import re
from pathlib import Path

from tests.support.catalog import load_seed_document

SERVICE_ROOT = Path(__file__).resolve().parents[2]
# The migrations, domain modules, commands and generator of the geography work carry schema,
# reference data and rules. Mutable editorial data (which mountain is on which continent or in
# which country) lives in the private geography input and the database, never in these files.
TRACKED_GEOGRAPHY_FILES = [
    *sorted((SERVICE_ROOT / "serendipeak/persistence/migrations").glob("001[4-9]_*.py")),
    *sorted((SERVICE_ROOT / "serendipeak/persistence/migrations").glob("0020_*.py")),
    *sorted((SERVICE_ROOT / "serendipeak/catalog").glob("geography*.py")),
    SERVICE_ROOT / "serendipeak/catalog/country_aliases.py",
    SERVICE_ROOT / "serendipeak/catalog/localization.py",
    SERVICE_ROOT / "serendipeak/catalog/regions.py",
    *sorted((SERVICE_ROOT / "serendipeak/catalog/bootstrap").glob("*geography*.py")),
    *sorted((SERVICE_ROOT / "serendipeak/cli/management/commands").glob("*geography*.py")),
    SERVICE_ROOT / "serendipeak/persistence/geography_backfill_store.py",
    SERVICE_ROOT / "serendipeak/persistence/geography_reference.py",
    SERVICE_ROOT / "tools/generate_geography_reference.py",
]


def test_the_files_under_test_exist():
    assert len(TRACKED_GEOGRAPHY_FILES) >= 18
    assert all(path.is_file() for path in TRACKED_GEOGRAPHY_FILES)


def test_none_of_them_names_a_mountain_of_the_seed_or_its_id():
    mountains = load_seed_document()["content"]["mountains"]
    identifiers = [raw["slug"] for raw in mountains] + [raw["id"] for raw in mountains]
    pattern = re.compile(
        r"(?<![\w-])(" + "|".join(re.escape(item) for item in identifiers) + r")(?![\w-])"
    )

    found = {
        path.name: sorted({match.group(1) for match in pattern.finditer(path.read_text("utf-8"))})
        for path in TRACKED_GEOGRAPHY_FILES
    }

    assert {name: hits for name, hits in found.items() if hits} == {}


def test_none_of_them_names_a_region_of_the_seed():
    ranges = {
        raw["range_name"]
        for raw in load_seed_document()["content"]["mountains"]
        if raw["range_name"]
    }
    pattern = re.compile(
        r"(?<![\w-])(" + "|".join(re.escape(item) for item in sorted(ranges)) + r")(?![\w-])"
    )

    found = {
        path.name: sorted({match.group(1) for match in pattern.finditer(path.read_text("utf-8"))})
        for path in TRACKED_GEOGRAPHY_FILES
    }

    assert len(ranges) == 53
    assert {name: hits for name, hits in found.items() if hits} == {}
