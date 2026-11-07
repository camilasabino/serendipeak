import uuid

import pytest

from serendipeak.accounts.access import AccessViolation
from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.create_user import CreateUser
from serendipeak.accounts.errors import (
    AccessRefused,
    InvalidUsername,
    PasswordRejected,
    UnknownUser,
    UsernameTaken,
)
from serendipeak.accounts.roles import Role
from tests.support.fakes import InMemoryUserStore

PASSWORD = "correct horse battery staple"


@pytest.fixture
def store():
    return InMemoryUserStore()


class TestCreateUser:
    def test_it_creates_an_active_user_with_the_role(self, store):
        user = CreateUser(store).execute("camila", Role.EDITOR, PASSWORD)

        assert (user.username, user.role, user.is_active) == ("camila", Role.EDITOR, True)

    @pytest.mark.parametrize("username", ["", "Camila", "ab", "has space"])
    def test_it_refuses_an_invalid_username_before_touching_the_store(self, store, username):
        with pytest.raises(InvalidUsername):
            CreateUser(store).execute(username, Role.EDITOR, PASSWORD)

    def test_it_passes_the_store_refusals_on(self, store):
        create = CreateUser(store)
        create.execute("camila", Role.EDITOR, PASSWORD)

        with pytest.raises(UsernameTaken):
            create.execute("camila", Role.VIEWER, PASSWORD)
        with pytest.raises(PasswordRejected):
            create.execute("other", Role.VIEWER, "short")


class TestChangeUserAccess:
    @pytest.fixture
    def actor(self, store):
        return CreateUser(store).execute("actor", Role.EDITOR, PASSWORD)

    @pytest.fixture
    def target(self, store):
        return CreateUser(store).execute("target", Role.VIEWER, PASSWORD)

    def test_it_returns_the_changed_user(self, store, actor, target):
        user = ChangeUserAccess(store).execute(actor.id, target.id, Role.EDITOR, False)

        assert (user.id, user.role, user.is_active) == (target.id, Role.EDITOR, False)

    def test_it_refuses_with_the_violation(self, store, actor):
        with pytest.raises(AccessRefused) as refused:
            ChangeUserAccess(store).execute(actor.id, actor.id, Role.VIEWER, True)

        assert refused.value.violation is AccessViolation.SELF_DEMOTION
        assert store.get(actor.id).role is Role.EDITOR

    def test_it_reports_an_unknown_target(self, store, actor):
        unknown = uuid.uuid4()

        with pytest.raises(UnknownUser) as raised:
            ChangeUserAccess(store).execute(actor.id, unknown, Role.EDITOR, True)

        assert raised.value.user_id == unknown
