from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord


def create_user(username="editor", role=Role.EDITOR, *, is_active=True, password=None):
    user = UserRecord(username=username, role=role.value, is_active=is_active)
    if password is None:
        user.set_unusable_password()
    else:
        user.set_password(password)
    user.save()

    return user
