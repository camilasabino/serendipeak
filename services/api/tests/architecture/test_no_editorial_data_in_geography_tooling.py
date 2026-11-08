import re
from pathlib import Path

from tests.support.contract_fixtures import load_frozen_catalog

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
    *sorted((SERVICE_ROOT / "serendipeak/catalog/bootstrap").glob("*snapshot*.py")),
    *sorted((SERVICE_ROOT / "serendipeak/cli/management/commands").glob("*geography*.py")),
    *sorted((SERVICE_ROOT / "serendipeak/cli/management/commands").glob("*snapshot*.py")),
    SERVICE_ROOT / "serendipeak/persistence/geography_backfill_store.py",
    SERVICE_ROOT / "serendipeak/persistence/geography_reference.py",
    SERVICE_ROOT / "tools/generate_geography_reference.py",
]


def test_the_files_under_test_exist():
    assert len(TRACKED_GEOGRAPHY_FILES) >= 22
    assert all(path.is_file() for path in TRACKED_GEOGRAPHY_FILES)


def test_none_of_them_names_a_mountain_of_the_frozen_catalog():
    identifiers = [raw["slug"] for raw in load_frozen_catalog()]
    pattern = re.compile(
        r"(?<![\w-])(" + "|".join(re.escape(item) for item in identifiers) + r")(?![\w-])"
    )

    found = {
        path.name: sorted({match.group(1) for match in pattern.finditer(path.read_text("utf-8"))})
        for path in TRACKED_GEOGRAPHY_FILES
    }

    assert {name: hits for name, hits in found.items() if hits} == {}
