import pytest

from serendipeak.accounts.roles import Role
from serendipeak.persistence.user_reader import DjangoUserReader
from tests.support.users import create_user

pytestmark = pytest.mark.django_db


def test_listing_is_one_query_whatever_the_number_of_users(django_assert_num_queries):
    for index in range(25):
        create_user(f"user{index:02d}", Role.VIEWER)

    with django_assert_num_queries(1):
        users = DjangoUserReader().list_all()

    assert len(users) == 25


def test_finding_one_user_is_one_query(django_assert_num_queries):
    user = create_user("ana")

    with django_assert_num_queries(1):
        found = DjangoUserReader().find_by_id(user.id)

    assert found.username == "ana"


def test_the_password_column_is_not_read(django_assert_num_queries):
    user = create_user("ana", password="correct horse battery staple")

    with django_assert_num_queries(1) as captured:
        DjangoUserReader().find_by_id(user.id)
    with django_assert_num_queries(1) as listed:
        DjangoUserReader().list_all()

    for query in (captured.captured_queries[0], listed.captured_queries[0]):
        assert '"password"' not in query["sql"]


def test_an_entity_carries_no_credential():
    user = create_user("ana", password="correct horse battery staple")

    entity = DjangoUserReader().find_by_id(user.id)

    assert not hasattr(entity, "password")
    assert "pbkdf2" not in repr(entity)
