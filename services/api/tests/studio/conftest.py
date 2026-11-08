import pytest
from django.test import Client

from serendipeak.accounts.roles import Role
from tests.studio.support import use_fake_media_store
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
def media_store(monkeypatch):
    """The creation and edit pages store photographs in memory, never in the configured store."""
    return use_fake_media_store(monkeypatch)
