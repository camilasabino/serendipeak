from uuid import uuid4

import pytest

from serendipeak.accounts.access import (
    Access,
    AccessChangeContext,
    AccessViolation,
    Account,
    access_violation,
)
from serendipeak.accounts.roles import Role

ACTIVE_EDITOR = Access(Role.EDITOR, True)
INACTIVE_EDITOR = Access(Role.EDITOR, False)
ACTIVE_VIEWER = Access(Role.VIEWER, True)
INACTIVE_VIEWER = Access(Role.VIEWER, False)


def judged(actor, target, desired, *, editors, same=False):
    actor_account = Account(uuid4(), actor)
    target_account = actor_account if same else Account(uuid4(), target)

    return access_violation(
        AccessChangeContext(
            actor=actor_account,
            target=target_account,
            desired=desired,
            active_editors=editors,
        )
    )


@pytest.mark.parametrize("actor", [ACTIVE_VIEWER, INACTIVE_EDITOR, INACTIVE_VIEWER])
def test_only_an_active_editor_changes_access(actor):
    violation = judged(actor, ACTIVE_VIEWER, ACTIVE_EDITOR, editors=2)

    assert violation is AccessViolation.ACTOR_NOT_EDITOR


@pytest.mark.parametrize(
    ("target", "desired"),
    [
        (ACTIVE_VIEWER, ACTIVE_EDITOR),
        (ACTIVE_VIEWER, INACTIVE_VIEWER),
        (INACTIVE_VIEWER, ACTIVE_VIEWER),
        (ACTIVE_EDITOR, INACTIVE_EDITOR),
        (ACTIVE_EDITOR, ACTIVE_VIEWER),
        (INACTIVE_EDITOR, ACTIVE_EDITOR),
    ],
)
def test_an_editor_may_change_any_other_user_while_another_editor_remains(target, desired):
    assert judged(ACTIVE_EDITOR, target, desired, editors=2) is None


def test_an_editor_may_resave_their_own_access_unchanged():
    assert judged(ACTIVE_EDITOR, ACTIVE_EDITOR, ACTIVE_EDITOR, editors=1, same=True) is None


def test_an_editor_cannot_deactivate_themselves_even_when_others_remain():
    violation = judged(ACTIVE_EDITOR, ACTIVE_EDITOR, INACTIVE_EDITOR, editors=3, same=True)

    assert violation is AccessViolation.SELF_DEACTIVATION


def test_an_editor_cannot_demote_themselves_even_when_others_remain():
    violation = judged(ACTIVE_EDITOR, ACTIVE_EDITOR, ACTIVE_VIEWER, editors=3, same=True)

    assert violation is AccessViolation.SELF_DEMOTION


def test_an_editor_cannot_demote_and_deactivate_themselves_in_one_change():
    violation = judged(ACTIVE_EDITOR, ACTIVE_EDITOR, INACTIVE_VIEWER, editors=3, same=True)

    assert violation is AccessViolation.SELF_DEACTIVATION


@pytest.mark.parametrize("desired", [INACTIVE_EDITOR, ACTIVE_VIEWER, INACTIVE_VIEWER])
def test_no_change_may_leave_the_system_without_an_active_editor(desired):
    violation = judged(ACTIVE_EDITOR, ACTIVE_EDITOR, desired, editors=1)

    assert violation is AccessViolation.LAST_ACTIVE_EDITOR


def test_changing_a_user_who_is_not_an_active_editor_never_loses_one():
    assert judged(ACTIVE_EDITOR, ACTIVE_VIEWER, INACTIVE_VIEWER, editors=1) is None
