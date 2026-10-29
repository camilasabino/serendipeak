import ast
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]
SOURCE_PACKAGES = ("config", "serendipeak")

ORM_MODULES = ("django.db", "django.contrib.gis", "django.contrib.postgres", "psycopg")
HTTP_CLIENT_MODULES = ("requests", "httpx", "urllib.request", "aiohttp")
OFFLINE_TOOLING_MODULES = ("tools", "yaml")
FRAMEWORK_FREE_FORBIDDEN = (
    "django",
    "rest_framework",
    "psycopg",
    "corsheaders",
    "serendipeak.persistence",
    "serendipeak.httpapi",
    "serendipeak.cli",
    "config",
)

FORBIDDEN_BY_PACKAGE = {
    "serendipeak.catalog": (*FRAMEWORK_FREE_FORBIDDEN, "serendipeak.discovery"),
    "serendipeak.discovery": FRAMEWORK_FREE_FORBIDDEN,
    "serendipeak.errors": FRAMEWORK_FREE_FORBIDDEN,
    "serendipeak.persistence": (
        "rest_framework",
        "serendipeak.httpapi",
        "serendipeak.cli",
        "config",
    ),
    "serendipeak.httpapi": (*ORM_MODULES, "serendipeak.persistence", "config"),
    "serendipeak.cli": ("django.db", "serendipeak.persistence"),
}
ORM_OWNER = "serendipeak.persistence"
ORM_ALLOWED_FILES = {"config/health.py"}


def is_within(module, prefix):
    return module == prefix or module.startswith(f"{prefix}.")


def module_name(relative_path):
    parts = Path(relative_path).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imported_modules(source, relative_path):
    module = module_name(relative_path)
    package = module if Path(relative_path).name == "__init__.py" else module.rpartition(".")[0]
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                anchor = package.rsplit(".", node.level - 1)[0]
                base = f"{anchor}.{node.module}" if node.module else anchor
            else:
                base = node.module
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)
    return found


def violations(source, relative_path):
    module = module_name(relative_path)
    imports = imported_modules(source, relative_path)
    forbidden = [
        rule
        for package, rules in FORBIDDEN_BY_PACKAGE.items()
        if is_within(module, package)
        for rule in rules
    ]
    forbidden.extend(HTTP_CLIENT_MODULES)
    forbidden.extend(OFFLINE_TOOLING_MODULES)
    if not is_within(module, ORM_OWNER) and relative_path not in ORM_ALLOWED_FILES:
        forbidden.extend(ORM_MODULES)
    return sorted(
        {
            f"{module} imports {rule}"
            for rule in forbidden
            if any(is_within(name, rule) for name in imports)
        }
    )


def source_files():
    return sorted(
        path.relative_to(SERVICE_ROOT).as_posix()
        for package in SOURCE_PACKAGES
        for path in (SERVICE_ROOT / package).rglob("*.py")
    )


def test_scan_covers_the_application_packages():
    files = source_files()

    assert "serendipeak/catalog/slug.py" in files
    assert "serendipeak/persistence/models.py" in files
    assert "config/health.py" in files


@pytest.mark.parametrize("relative_path", source_files())
def test_imports_follow_the_dependency_direction(relative_path):
    source = (SERVICE_ROOT / relative_path).read_text(encoding="utf-8")

    assert violations(source, relative_path) == []


@pytest.mark.parametrize(
    ("relative_path", "source", "expected"),
    [
        (
            "serendipeak/catalog/rules.py",
            "from django.db import models",
            "serendipeak.catalog.rules imports django.db",
        ),
        (
            "serendipeak/catalog/rules.py",
            "from ..persistence import models",
            "serendipeak.catalog.rules imports serendipeak.persistence",
        ),
        (
            "serendipeak/catalog/__init__.py",
            "from serendipeak import discovery",
            "serendipeak.catalog imports serendipeak.discovery",
        ),
        (
            "serendipeak/discovery/clock.py",
            "import psycopg",
            "serendipeak.discovery.clock imports psycopg",
        ),
        (
            "serendipeak/httpapi/views.py",
            "from django.contrib.gis.geos import Point",
            "serendipeak.httpapi.views imports django.contrib.gis",
        ),
        (
            "serendipeak/cli/management/commands/check_catalog.py",
            "from serendipeak.persistence.models import MountainRecord",
            "serendipeak.cli.management.commands.check_catalog imports serendipeak.persistence",
        ),
        (
            "config/composition.py",
            "from django.db import connection",
            "config.composition imports django.db",
        ),
        (
            "serendipeak/persistence/catalog_store.py",
            "import httpx",
            "serendipeak.persistence.catalog_store imports httpx",
        ),
        (
            "serendipeak/cli/management/commands/bootstrap_catalog.py",
            "from tools.export_legacy_catalog import export",
            "serendipeak.cli.management.commands.bootstrap_catalog imports tools",
        ),
        (
            "config/composition.py",
            "import yaml",
            "config.composition imports yaml",
        ),
    ],
)
def test_detects_forbidden_imports(relative_path, source, expected):
    assert expected in violations(source, relative_path)


@pytest.mark.parametrize(
    ("relative_path", "source"),
    [
        ("serendipeak/persistence/models.py", "from serendipeak.catalog import camera"),
        (
            "serendipeak/persistence/models.py",
            "from django.contrib.postgres.fields import ArrayField",
        ),
        ("config/health.py", "from django.db import connection"),
        ("serendipeak/cli/management/commands/check_catalog.py", "from config import composition"),
    ],
)
def test_allows_permitted_imports(relative_path, source):
    assert violations(source, relative_path) == []
