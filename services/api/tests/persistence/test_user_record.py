import pytest
from django.db import connection

from serendipeak.persistence.models import UserRecord
from tests.support.records import insert_error
from tests.support.users import create_user

pytestmark = pytest.mark.django_db


def user_record(**overrides):
    fields = {"username": "camila", "role": "editor", "password": "pbkdf2_sha256$hash"}
    fields.update(overrides)

    return UserRecord(**fields)


REJECTED_USERS = [
    ("user_username_format", {"username": ""}),
    ("user_username_format", {"username": "ab"}),
    ("user_username_format", {"username": "a" * 33}),
    ("user_username_format", {"username": "Camila"}),
    ("user_username_format", {"username": "ca mila"}),
    ("user_username_format", {"username": "-camila"}),
    ("user_username_format", {"username": "camila\n"}),
    ("user_username_format", {"username": "camíla"}),
    ("user_role_valid", {"role": "superuser"}),
    ("user_role_valid", {"role": ""}),
    ("user_role_valid", {"role": "Editor"}),
    ("user_password_not_blank", {"password": ""}),
]


@pytest.mark.parametrize(("constraint", "overrides"), REJECTED_USERS)
def test_the_database_refuses_an_invalid_user(constraint, overrides):
    assert insert_error(user_record(**overrides)).constraint_name == constraint


def test_a_username_is_unique():
    create_user("camila")

    assert insert_error(user_record()).constraint_name == "user_username_key"


def test_usernames_that_differ_only_in_case_cannot_coexist():
    create_user("camila")

    assert insert_error(user_record(username="CAMILA")).constraint_name == "user_username_format"


def test_the_table_has_no_staff_superuser_permission_group_or_profile_column():
    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, "app_user")
        }

    assert columns == {
        "id",
        "username",
        "password",
        "role",
        "is_active",
        "last_login",
        "date_joined",
    }


def test_a_new_user_is_active_and_joined_now():
    user = create_user("camila")
    user.refresh_from_db()

    assert user.is_active is True
    assert user.last_login is None
    assert user.date_joined is not None
