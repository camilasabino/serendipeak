import uuid

import pytest

from serendipeak.accounts.access import Access, AccessViolation, access_violation
from serendipeak.accounts.errors import PasswordRejected, UsernameTaken
from serendipeak.accounts.ports import AccessChangeOutcome
from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from serendipeak.persistence.user_store import DjangoUserStore
from tests.support.fakes import InMemoryUserStore
from tests.support.users import create_user

pytestmark = pytest.mark.django_db

STRONG_PASSWORD = "correct horse battery staple"
EDITOR = Access(Role.EDITOR, True)
VIEWER = Access(Role.VIEWER, True)
INACTIVE_VIEWER = Access(Role.VIEWER, False)


class Arrangement:
    def __init__(self, store, add, access_of):
        self.store = store
        self.add = add
        self.access_of = access_of


@pytest.fixture(params=["in-memory", "django"])
def arranged(request):
    if request.param == "in-memory":
        store = InMemoryUserStore()

        def add(username, role=Role.EDITOR, *, is_active=True):
            user = store.create(username, role, STRONG_PASSWORD)
            if not is_active:
                store.change_access(user.id, user.id, Access(role, False), lambda _: None)
            return user.id

        return Arrangement(store, add, lambda user_id: _access(store.get(user_id)))

    request.getfixturevalue("db")

    def add(username, role=Role.EDITOR, *, is_active=True):
        return create_user(username, role, is_active=is_active).id

    return Arrangement(
        DjangoUserStore(),
        add,
        lambda user_id: _access(UserRecord.objects.get(pk=user_id)),
    )


def _access(user):
    return Access(Role(user.role), user.is_active)


def test_a_created_user_is_active_and_has_the_requested_role(arranged):
    user = arranged.store.create("camila", Role.VIEWER, STRONG_PASSWORD)

    assert (user.username, user.role, user.is_active) == ("camila", Role.VIEWER, True)
    assert arranged.access_of(user.id) == VIEWER


def test_a_weak_password_is_rejected_without_taking_the_username(arranged):
    with pytest.raises(PasswordRejected):
        arranged.store.create("camila", Role.EDITOR, "short")

    user = arranged.store.create("camila", Role.EDITOR, STRONG_PASSWORD)

    assert user.username == "camila"


def test_a_username_in_use_is_refused(arranged):
    arranged.store.create("camila", Role.EDITOR, STRONG_PASSWORD)

    with pytest.raises(UsernameTaken):
        arranged.store.create("camila", Role.VIEWER, STRONG_PASSWORD)


def test_an_editor_changes_the_access_of_another_user(arranged):
    actor = arranged.add("actor")
    target = arranged.add("target", Role.VIEWER)

    change = arranged.store.change_access(actor, target, EDITOR, access_violation)

    assert change.outcome is AccessChangeOutcome.APPLIED
    assert (change.user.id, change.user.role) == (target, Role.EDITOR)
    assert arranged.access_of(target) == EDITOR


def test_an_editor_deactivates_another_editor_while_one_remains(arranged):
    actor = arranged.add("actor")
    target = arranged.add("target")

    change = arranged.store.change_access(
        actor, target, Access(Role.EDITOR, False), access_violation
    )

    assert change.outcome is AccessChangeOutcome.APPLIED
    assert arranged.access_of(target) == Access(Role.EDITOR, False)
    assert arranged.access_of(actor) == EDITOR


@pytest.mark.parametrize(
    ("desired", "violation"),
    [
        (Access(Role.EDITOR, False), AccessViolation.SELF_DEACTIVATION),
        (VIEWER, AccessViolation.SELF_DEMOTION),
    ],
    ids=["deactivation", "demotion"],
)
def test_an_editor_cannot_deactivate_or_demote_themselves(arranged, desired, violation):
    actor = arranged.add("actor")
    arranged.add("other")

    change = arranged.store.change_access(actor, actor, desired, access_violation)

    assert change.outcome is AccessChangeOutcome.REFUSED
    assert change.violation is violation
    assert arranged.access_of(actor) == EDITOR


@pytest.mark.parametrize("access", [VIEWER, INACTIVE_VIEWER], ids=["viewer", "inactive viewer"])
def test_only_an_active_editor_can_change_access(arranged, access):
    actor = arranged.add("actor", access.role, is_active=access.is_active)
    target = arranged.add("target", Role.VIEWER)

    change = arranged.store.change_access(actor, target, EDITOR, access_violation)

    assert change.outcome is AccessChangeOutcome.REFUSED
    assert change.violation is AccessViolation.ACTOR_NOT_EDITOR
    assert arranged.access_of(target) == VIEWER


def test_an_unknown_target_is_not_found(arranged):
    actor = arranged.add("actor")

    change = arranged.store.change_access(actor, uuid.uuid4(), EDITOR, access_violation)

    assert change.outcome is AccessChangeOutcome.NOT_FOUND


def test_an_unknown_actor_is_refused_as_not_an_editor(arranged):
    target = arranged.add("target", Role.VIEWER)

    change = arranged.store.change_access(uuid.uuid4(), target, EDITOR, access_violation)

    assert change.outcome is AccessChangeOutcome.REFUSED
    assert change.violation is AccessViolation.ACTOR_NOT_EDITOR


def test_the_rule_judges_what_the_store_read(arranged):
    actor = arranged.add("actor")
    target = arranged.add("target", Role.VIEWER)
    seen = []

    def spy(context):
        seen.append(context)

    arranged.store.change_access(actor, target, EDITOR, spy)

    (context,) = seen
    assert context.actor.id == actor
    assert context.target.id == target
    assert context.target.access == VIEWER
    assert context.desired == EDITOR
    assert context.active_editors == 1


def test_a_refusing_rule_writes_nothing(arranged):
    actor = arranged.add("actor")
    target = arranged.add("target", Role.VIEWER)

    change = arranged.store.change_access(
        actor, target, EDITOR, lambda _: AccessViolation.LAST_ACTIVE_EDITOR
    )

    assert change.violation is AccessViolation.LAST_ACTIVE_EDITOR
    assert arranged.access_of(target) == VIEWER
