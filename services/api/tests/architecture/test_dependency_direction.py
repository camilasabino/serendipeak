import ast
import sys
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]
SOURCE_PACKAGES = ("config", "serendipeak", "tools")

ORM_MODULES = ("django.db", "django.contrib.gis", "django.contrib.postgres", "psycopg")
HTTP_CLIENT_MODULES = (
    "requests",
    "httpx",
    "urllib.request",
    "urllib3",
    "http.client",
    "aiohttp",
)
OFFLINE_TOOLING_MODULES = ("tools", "yaml")
DYNAMIC_IMPORT_CALLS = ("import_module", "__import__")
CAPABILITY_FORBIDDEN_STDLIB = (
    "os",
    "random",
    "secrets",
    "subprocess",
    "socket",
    "ssl",
    "sqlite3",
    "ftplib",
    "smtplib",
    "xmlrpc",
)

CAPABILITY_PACKAGES = ("serendipeak.catalog", "serendipeak.discovery", "serendipeak.errors")
PERMITTED_BY_PACKAGE = {
    "serendipeak.catalog": ("serendipeak.catalog", "serendipeak.errors"),
    "serendipeak.discovery": ("serendipeak.discovery", "serendipeak.catalog", "serendipeak.errors"),
    "serendipeak.errors": ("serendipeak.errors",),
    "serendipeak.cli": (
        "django.apps",
        "django.core.management",
        "config.composition",
        "serendipeak.cli",
        "serendipeak.catalog",
        "serendipeak.discovery",
        "serendipeak.errors",
    ),
    "tools": ("psycopg", "yaml", "serendipeak.catalog.bootstrap.seed"),
}
FORBIDDEN_BY_PACKAGE = {
    "serendipeak.persistence": (
        "rest_framework",
        "serendipeak.httpapi",
        "serendipeak.cli",
        "config",
    ),
    "serendipeak.httpapi": (*ORM_MODULES, "serendipeak.persistence", "config"),
    "serendipeak.cli": ("django.db", "serendipeak.persistence"),
}
ORM_OWNERS = ("serendipeak.persistence", "tools")
ORM_ALLOWED_FILES = {"config/health.py"}


def is_within(module, prefix):
    return module == prefix or module.startswith(f"{prefix}.")


def module_name(relative_path):
    parts = Path(relative_path).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imported_modules(tree, relative_path):
    """Return the imported names, and the subset imported with a plain import statement."""
    module = module_name(relative_path)
    package = module if Path(relative_path).name == "__init__.py" else module.rpartition(".")[0]
    found = set()
    plain = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            plain.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                anchor = package.rsplit(".", node.level - 1)[0]
                base = f"{anchor}.{node.module}" if node.module else anchor
            else:
                base = node.module
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)
    return found | plain, plain


def dynamic_import_calls(tree):
    calls = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            function = node.func
            if isinstance(function, ast.Name):
                calls.add(function.id)
            elif isinstance(function, ast.Attribute):
                calls.add(function.attr)
    return calls & set(DYNAMIC_IMPORT_CALLS)


def is_permitted(name, permitted, plain, stdlib_denied):
    top_level = name.partition(".")[0]
    if top_level in sys.stdlib_module_names:
        return top_level not in stdlib_denied
    # "from serendipeak import errors" names its parent package as well; "import serendipeak"
    # does not get that allowance.
    return any(is_within(name, package) for package in permitted) or (
        name not in plain and any(is_within(package, name) for package in permitted)
    )


def outside_allowlist(module, imports, plain):
    stdlib_denied = (
        CAPABILITY_FORBIDDEN_STDLIB
        if any(is_within(module, package) for package in CAPABILITY_PACKAGES)
        else ()
    )
    return [
        name
        for package, permitted in PERMITTED_BY_PACKAGE.items()
        if is_within(module, package)
        for name in imports
        if not is_permitted(name, permitted, plain, stdlib_denied)
    ]


def violations(source, relative_path):
    module = module_name(relative_path)
    tree = ast.parse(source)
    imports, plain = imported_modules(tree, relative_path)
    forbidden = [
        rule
        for package, rules in FORBIDDEN_BY_PACKAGE.items()
        if is_within(module, package)
        for rule in rules
    ]
    forbidden.extend(HTTP_CLIENT_MODULES)
    is_tool = is_within(module, "tools")
    if not is_tool:
        forbidden.extend(OFFLINE_TOOLING_MODULES)
    is_orm_owner = any(is_within(module, owner) for owner in ORM_OWNERS)
    if not is_orm_owner and relative_path not in ORM_ALLOWED_FILES:
        forbidden.extend(ORM_MODULES)
    return sorted(
        {
            f"{module} imports {rule}"
            for rule in forbidden
            if any(is_within(name, rule) for name in imports)
        }
        | {f"{module} imports {name}" for name in outside_allowlist(module, imports, plain)}
        | {f"{module} calls {call}" for call in dynamic_import_calls(tree)}
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
    assert "serendipeak/catalog/bootstrap/seed.py" in files
    assert "serendipeak/persistence/models.py" in files
    assert "serendipeak/cli/management/commands/bootstrap_catalog.py" in files
    assert "serendipeak/httpapi/views.py" in files
    assert "serendipeak/discovery/get_todays_mountain.py" in files
    assert "serendipeak/persistence/daily_discovery_repository.py" in files
    assert "tools/export_legacy_catalog.py" in files
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
        (
            "serendipeak/catalog/entities.py",
            "import attrs",
            "serendipeak.catalog.entities imports attrs",
        ),
        (
            "serendipeak/errors.py",
            "from serendipeak.catalog import errors",
            "serendipeak.errors imports serendipeak.catalog",
        ),
        (
            "serendipeak/discovery/clock.py",
            "from serendipeak.cli import apps",
            "serendipeak.discovery.clock imports serendipeak.cli",
        ),
        (
            "serendipeak/catalog/slug.py",
            "import importlib\nimportlib.import_module('django.db')",
            "serendipeak.catalog.slug calls import_module",
        ),
        (
            "serendipeak/persistence/mapping.py",
            "from importlib import import_module\nimport_module('rest_framework')",
            "serendipeak.persistence.mapping calls import_module",
        ),
        (
            "serendipeak/catalog/slug.py",
            "__import__('django')",
            "serendipeak.catalog.slug calls __import__",
        ),
        (
            "serendipeak/catalog/slug.py",
            "import http.client",
            "serendipeak.catalog.slug imports http.client",
        ),
        (
            "serendipeak/persistence/catalog_store.py",
            "import urllib3",
            "serendipeak.persistence.catalog_store imports urllib3",
        ),
        (
            "serendipeak/httpapi/views.py",
            "from serendipeak.persistence.mountain_repository import DjangoMountainRepository",
            "serendipeak.httpapi.views imports serendipeak.persistence",
        ),
        (
            "serendipeak/httpapi/urls.py",
            "from config.composition import build_get_mountain_by_slug",
            "serendipeak.httpapi.urls imports config",
        ),
        (
            "serendipeak/catalog/get_mountain_by_slug.py",
            "from rest_framework.exceptions import NotFound",
            "serendipeak.catalog.get_mountain_by_slug imports rest_framework.exceptions",
        ),
        *(
            (
                "serendipeak/discovery/get_todays_mountain.py",
                f"import {name}",
                f"serendipeak.discovery.get_todays_mountain imports {name}",
            )
            for name in CAPABILITY_FORBIDDEN_STDLIB
        ),
        (
            "serendipeak/discovery/selection.py",
            "from random import choice",
            "serendipeak.discovery.selection imports random",
        ),
        (
            "serendipeak/catalog/publication.py",
            "from os.path import join",
            "serendipeak.catalog.publication imports os.path",
        ),
        (
            "serendipeak/errors.py",
            "import xmlrpc.client",
            "serendipeak.errors imports xmlrpc.client",
        ),
        (
            "serendipeak/catalog/slug.py",
            "import serendipeak",
            "serendipeak.catalog.slug imports serendipeak",
        ),
        (
            "serendipeak/discovery/ports.py",
            "import serendipeak.persistence.models",
            "serendipeak.discovery.ports imports serendipeak.persistence.models",
        ),
        (
            "serendipeak/discovery/get_todays_mountain.py",
            "from serendipeak.httpapi import views",
            "serendipeak.discovery.get_todays_mountain imports serendipeak.httpapi",
        ),
        (
            "serendipeak/discovery/clock.py",
            "from django.utils import timezone",
            "serendipeak.discovery.clock imports django.utils",
        ),
        (
            "tools/export_legacy_catalog.py",
            "from serendipeak.catalog.entities import Mountain",
            "tools.export_legacy_catalog imports serendipeak.catalog.entities",
        ),
        (
            "tools/export_legacy_catalog.py",
            "from serendipeak.persistence import models",
            "tools.export_legacy_catalog imports serendipeak.persistence",
        ),
        (
            "tools/export_legacy_catalog.py",
            "import django",
            "tools.export_legacy_catalog imports django",
        ),
        (
            "tools/export_legacy_catalog.py",
            "import httpx",
            "tools.export_legacy_catalog imports httpx",
        ),
        (
            "serendipeak/cli/management/commands/check_catalog.py",
            "from rest_framework.response import Response",
            "serendipeak.cli.management.commands.check_catalog imports rest_framework.response",
        ),
        (
            "serendipeak/cli/management/commands/check_catalog.py",
            "from config.settings import DEBUG",
            "serendipeak.cli.management.commands.check_catalog imports config.settings",
        ),
        (
            "serendipeak/cli/management/commands/check_catalog.py",
            "from serendipeak.httpapi.errors import api_exception_handler",
            "serendipeak.cli.management.commands.check_catalog imports serendipeak.httpapi.errors",
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
        ("serendipeak/catalog/entities.py", "from dataclasses import dataclass"),
        ("serendipeak/catalog/__init__.py", "from serendipeak import errors"),
        ("serendipeak/catalog/bootstrap/seed.py", "from ..entities import Mountain"),
        ("serendipeak/discovery/selection.py", "from serendipeak.catalog.entities import Mountain"),
        ("serendipeak/errors.py", "from __future__ import annotations"),
        ("serendipeak/discovery/clock.py", "from datetime import UTC, date, datetime"),
        ("serendipeak/discovery/selection.py", "import hashlib"),
        ("serendipeak/discovery/ports.py", "from serendipeak.catalog import entities"),
        ("serendipeak/persistence/mapping.py", "from serendipeak.discovery import entities"),
        ("serendipeak/httpapi/views.py", "from serendipeak.discovery import get_todays_mountain"),
        ("config/composition.py", "import secrets"),
        ("tools/export_legacy_catalog.py", "import os\nimport subprocess\nimport yaml"),
        ("tools/export_legacy_catalog.py", "from psycopg.rows import dict_row"),
        (
            "tools/export_legacy_catalog.py",
            "from serendipeak.catalog.bootstrap.seed import content_sha256",
        ),
        ("serendipeak/cli/apps.py", "from django.apps import AppConfig"),
        (
            "serendipeak/cli/management/commands/check_catalog.py",
            "from django.core.management.base import BaseCommand",
        ),
    ],
)
def test_allows_permitted_imports(relative_path, source):
    assert violations(source, relative_path) == []
