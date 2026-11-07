import pytest
from django.test import Client

from serendipeak.accounts.roles import Role
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
