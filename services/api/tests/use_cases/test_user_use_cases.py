import uuid

import pytest

from serendipeak.accounts.access import Access, AccessViolation
from serendipeak.accounts.change_user_access import ChangeUserAccess
from serendipeak.accounts.create_user import CreateUser
from serendipeak.accounts.errors import (
    AccessRefused,
    InvalidUsername,
    PasswordRejected,
    UnknownUser,
    UsernameTaken,
)
from serendipeak.accounts.read_users import GetUser, ListUsers
from serendipeak.accounts.roles import Role
from serendipeak.accounts.set_user_password import SetUserPassword
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

    def test_it_refuses_a_change_when_the_target_is_no_longer_what_the_form_showed(
        self, store, actor, target
    ):
        shown = Access(Role.VIEWER, True)
        ChangeUserAccess(store).execute(actor.id, target.id, Role.VIEWER, False)

        with pytest.raises(AccessRefused) as refused:
            ChangeUserAccess(store).execute(actor.id, target.id, Role.EDITOR, True, expected=shown)

        assert refused.value.violation is AccessViolation.CHANGED_MEANWHILE
        assert (store.get(target.id).role, store.get(target.id).is_active) == (Role.VIEWER, False)

    def test_it_applies_a_change_when_the_target_is_what_the_form_showed(
        self, store, actor, target
    ):
        user = ChangeUserAccess(store).execute(
            actor.id, target.id, Role.EDITOR, True, expected=Access(Role.VIEWER, True)
        )

        assert user.role is Role.EDITOR

    def test_the_actor_check_comes_before_the_staleness_check(self, store, target):
        viewer = CreateUser(store).execute("viewer", Role.VIEWER, PASSWORD)

        with pytest.raises(AccessRefused) as refused:
            ChangeUserAccess(store).execute(
                viewer.id, target.id, Role.EDITOR, True, expected=Access(Role.EDITOR, False)
            )

        assert refused.value.violation is AccessViolation.ACTOR_NOT_EDITOR


class TestSetUserPassword:
    @pytest.fixture
    def actor(self, store):
        return CreateUser(store).execute("actor", Role.EDITOR, PASSWORD)

    @pytest.fixture
    def target(self, store):
        return CreateUser(store).execute("target", Role.VIEWER, PASSWORD)

    def test_it_sets_the_password_of_another_user(self, store, actor, target):
        user = SetUserPassword(store).execute(actor.id, target.id, "another long passphrase")

        assert user.id == target.id
        assert store.passwords[target.id] == "another long passphrase"

    def test_it_refuses_the_actors_own_account_without_touching_the_store(self, store, actor):
        with pytest.raises(AccessRefused) as refused:
            SetUserPassword(store).execute(actor.id, actor.id, "another long passphrase")

        assert refused.value.violation is AccessViolation.OWN_PASSWORD
        assert store.passwords == {}

    def test_it_refuses_an_actor_who_is_not_an_editor(self, store, target):
        viewer = CreateUser(store).execute("viewer", Role.VIEWER, PASSWORD)

        with pytest.raises(AccessRefused) as refused:
            SetUserPassword(store).execute(viewer.id, target.id, "another long passphrase")

        assert refused.value.violation is AccessViolation.ACTOR_NOT_EDITOR
        assert store.passwords == {}

    def test_it_reports_an_unknown_target(self, store, actor):
        with pytest.raises(UnknownUser):
            SetUserPassword(store).execute(actor.id, uuid.uuid4(), "another long passphrase")

    def test_it_passes_the_password_policy_refusal_on(self, store, actor, target):
        with pytest.raises(PasswordRejected):
            SetUserPassword(store).execute(actor.id, target.id, "short")

        assert store.passwords == {}


class TestReadUsers:
    def test_it_lists_every_user_by_username_inactive_ones_included(self, store):
        create = CreateUser(store)
        zed = create.execute("zed", Role.VIEWER, PASSWORD)
        ana = create.execute("ana", Role.EDITOR, PASSWORD)
        ChangeUserAccess(store).execute(ana.id, zed.id, Role.VIEWER, False)

        users = ListUsers(store).execute()

        assert [user.username for user in users] == ["ana", "zed"]
        assert [user.is_active for user in users] == [True, False]

    def test_it_lists_nobody_when_there_are_no_users(self, store):
        assert ListUsers(store).execute() == ()

    def test_it_gets_one_user(self, store):
        created = CreateUser(store).execute("ana", Role.EDITOR, PASSWORD)

        assert GetUser(store).execute(created.id) == created

    def test_it_reports_an_unknown_user(self, store):
        unknown = uuid.uuid4()

        with pytest.raises(UnknownUser) as raised:
            GetUser(store).execute(unknown)

        assert raised.value.user_id == unknown
