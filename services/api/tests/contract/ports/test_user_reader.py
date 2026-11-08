import uuid

import pytest

from serendipeak.accounts.roles import Role
from serendipeak.persistence.user_reader import DjangoUserReader
from tests.support.fakes import InMemoryUserStore
from tests.support.users import create_user

pytestmark = pytest.mark.django_db

STRONG_PASSWORD = "correct horse battery staple"


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryUserStore()

        def add(username, role=Role.EDITOR, *, is_active=True):
            return store.create(username, role, STRONG_PASSWORD)

        return store, add

    request.getfixturevalue("db")

    def add(username, role=Role.EDITOR, *, is_active=True):
        from serendipeak.persistence.mapping import to_user

        return to_user(create_user(username, role, is_active=is_active))

    return DjangoUserReader(), add


def test_it_lists_every_user_including_inactive_ones(arranged):
    reader, add = arranged
    add("ana", Role.EDITOR)
    add("bruno", Role.VIEWER)

    assert {user.username for user in reader.list_all()} == {"ana", "bruno"}


def test_it_lists_nobody_when_there_are_no_users(arranged):
    reader, _ = arranged

    assert tuple(reader.list_all()) == ()


def test_it_finds_a_user_by_id_with_the_account_metadata(arranged):
    reader, add = arranged
    created = add("ana", Role.VIEWER)

    found = reader.find_by_id(created.id)

    assert (found.id, found.username, found.role, found.is_active) == (
        created.id,
        "ana",
        Role.VIEWER,
        True,
    )
    assert found.last_login is None
    assert found.date_joined is not None


def test_an_unknown_id_finds_nothing(arranged):
    reader, add = arranged
    add("ana")

    assert reader.find_by_id(uuid.uuid4()) is None
