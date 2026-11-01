import pytest
from django.contrib.auth.models import Permission, User

from serendipeak.persistence.catalog_store import DjangoCatalogStore
from tests.support.catalog import catalog_mountain, catalog_seed


def _user(username, *codenames):
    user = User.objects.create_user(username, password="not-used", is_staff=True)
    user.user_permissions.set(Permission.objects.filter(codename__in=codenames))

    return user


@pytest.fixture
def editor(db):
    return _user(
        "editor",
        "add_mountainrecord",
        "change_mountainrecord",
        "view_mountainrecord",
        "delete_mountainrecord",
        "view_dailydiscoveryrecord",
    )


@pytest.fixture
def publisher(db):
    return _user(
        "publisher",
        "add_mountainrecord",
        "change_mountainrecord",
        "view_mountainrecord",
        "delete_mountainrecord",
        "view_dailydiscoveryrecord",
        "publish_mountain",
    )


@pytest.fixture
def editor_client(client, editor):
    client.force_login(editor)

    return client


@pytest.fixture
def publisher_client(client, publisher):
    client.force_login(publisher)

    return client


@pytest.fixture
def load_catalog(db):
    def load(*entries, discoveries=()):
        DjangoCatalogStore().load(catalog_seed(*entries, discoveries=discoveries))

    return load


@pytest.fixture
def catalog_entry():
    return catalog_mountain
