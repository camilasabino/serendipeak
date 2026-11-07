import pytest
from django.test import Client

from serendipeak.accounts.roles import Role
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.admin.support import use_fake_media_store
from tests.support.catalog import catalog_mountain, catalog_seed
from tests.support.users import create_user


@pytest.fixture
def editor(db):
    return create_user("editor", Role.EDITOR)


@pytest.fixture
def viewer(db):
    return create_user("viewer", Role.VIEWER)


@pytest.fixture
def editor_client(editor):
    client = Client()
    client.force_login(editor)

    return client


@pytest.fixture
def viewer_client(viewer):
    client = Client()
    client.force_login(viewer)

    return client


@pytest.fixture
def load_catalog(db):
    def load(*entries, discoveries=()):
        DjangoCatalogStore().load(catalog_seed(*entries, discoveries=discoveries))

    return load


@pytest.fixture
def catalog_entry():
    return catalog_mountain


@pytest.fixture(autouse=True)
def media_store(monkeypatch):
    """Every admin test stores photographs in memory, never in the configured store."""
    return use_fake_media_store(monkeypatch)
