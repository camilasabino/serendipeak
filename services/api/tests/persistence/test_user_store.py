from unittest import mock

import pytest
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password, identify_hasher
from django.db import OperationalError

from serendipeak.accounts.access import Access, access_violation
from serendipeak.accounts.errors import PasswordRejected
from serendipeak.accounts.roles import Role
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.models import UserRecord
from serendipeak.persistence.user_store import DjangoUserStore
from tests.support.users import create_user

pytestmark = pytest.mark.django_db

PASSWORD = "correct horse battery staple"


@pytest.fixture
def store():
    return DjangoUserStore()


class TestCreate:
    def test_the_password_is_stored_only_as_a_pbkdf2_hash(self, store):
        user = store.create("camila", Role.EDITOR, PASSWORD)

        stored = UserRecord.objects.get(pk=user.id).password
        assert stored != PASSWORD
        assert PASSWORD not in stored
        assert identify_hasher(stored).algorithm == "pbkdf2_sha256"
        assert check_password(PASSWORD, stored)

    def test_the_same_password_gets_a_different_salt_for_every_user(self, store):
        first = store.create("camila", Role.EDITOR, PASSWORD)
        second = store.create("martina", Role.EDITOR, PASSWORD)

        hashes = UserRecord.objects.filter(pk__in=[first.id, second.id]).values_list(
            "password", flat=True
        )
        assert len(set(hashes)) == 2

    def test_a_created_user_can_authenticate(self, store):
        store.create("camila", Role.VIEWER, PASSWORD)

        assert authenticate(username="camila", password=PASSWORD).username == "camila"
        assert authenticate(username="camila", password=PASSWORD + "!") is None
        assert authenticate(username="nobody", password=PASSWORD) is None

    def test_an_inactive_user_cannot_authenticate(self, store):
        user = store.create("camila", Role.EDITOR, PASSWORD)
        UserRecord.objects.filter(pk=user.id).update(is_active=False)

        assert authenticate(username="camila", password=PASSWORD) is None

    @pytest.mark.parametrize(
        ("password", "reason"),
        [
            ("short-1", "at least 8 characters"),
            ("sevench", "at least 8 characters"),
            ("password1234", "too common"),
            ("123456789012345", "entirely numeric"),
            ("camila-sabino", "too similar"),
        ],
    )
    def test_the_password_policy_is_applied(self, store, password, reason):
        with pytest.raises(PasswordRejected) as rejected:
            store.create("camila-sabino", Role.EDITOR, password)

        assert reason in str(rejected.value)
        assert not UserRecord.objects.exists()

    def test_eight_characters_are_enough(self, store):
        assert store.create("camila", Role.EDITOR, "k7-m2x9q")

    def test_a_database_failure_is_translated(self, store):
        with (
            mock.patch.object(UserRecord.objects, "get_or_create", side_effect=OperationalError),
            pytest.raises(InfrastructureError),
        ):
            store.create("camila", Role.EDITOR, PASSWORD)


class TestChangeAccess:
    def test_a_change_locks_the_accounts_then_updates_one_row(
        self, store, django_assert_num_queries
    ):
        actor = create_user("actor")
        target = create_user("target", Role.VIEWER)

        with django_assert_num_queries(4) as captured:
            store.change_access(actor.id, target.id, Access(Role.EDITOR, True), access_violation)

        statements = [query["sql"] for query in captured.captured_queries]
        assert statements[0].startswith("SAVEPOINT")
        assert "FOR UPDATE" in statements[1]
        assert 'ORDER BY "app_user"."id"' in statements[1]
        assert statements[2].startswith('UPDATE "app_user"')
        assert statements[3].startswith("RELEASE SAVEPOINT")

    def test_only_role_and_active_state_are_written(self, store, django_assert_num_queries):
        actor = create_user("actor")
        target = create_user("target", Role.VIEWER)

        with django_assert_num_queries(4) as captured:
            store.change_access(actor.id, target.id, Access(Role.EDITOR, True), access_violation)

        update = captured.captured_queries[2]["sql"]
        assert '"role"' in update and '"is_active"' in update
        assert '"password"' not in update and '"last_login"' not in update

    def test_a_refusal_writes_nothing(self, store, django_assert_num_queries):
        actor = create_user("actor")

        with django_assert_num_queries(3) as captured:
            store.change_access(actor.id, actor.id, Access(Role.VIEWER, True), access_violation)

        assert not any(q["sql"].startswith("UPDATE") for q in captured.captured_queries)

    def test_the_cost_does_not_grow_with_the_number_of_editors(
        self, store, django_assert_num_queries
    ):
        actor = create_user("actor")
        target = create_user("target", Role.VIEWER)
        for index in range(20):
            create_user(f"editor{index:02d}")

        with django_assert_num_queries(4):
            store.change_access(actor.id, target.id, Access(Role.EDITOR, True), access_violation)
