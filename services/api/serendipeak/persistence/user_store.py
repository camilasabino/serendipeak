from uuid import UUID

from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from serendipeak.accounts.access import (
    Access,
    AccessChangeContext,
    AccessRule,
    AccessViolation,
    Account,
)
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import PasswordRejected, UsernameTaken
from serendipeak.accounts.ports import AccessChange, AccessChangeOutcome
from serendipeak.accounts.roles import Role
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_user
from serendipeak.persistence.models import UserRecord


def _access_of(record: UserRecord) -> Access:
    return Access(Role(record.role), record.is_active)


class DjangoUserStore:
    def create(self, username: str, role: Role, password: str) -> User:
        try:
            validate_password(password, UserRecord(username=username))
        except ValidationError as error:
            raise PasswordRejected(tuple(error.messages)) from error

        with translate_database_errors():
            record, created = UserRecord.objects.get_or_create(
                username=username,
                defaults={"role": role.value, "password": make_password(password)},
            )
        if not created:
            raise UsernameTaken(username)

        return to_user(record)

    def change_access(
        self,
        actor_id: UUID,
        target_id: UUID,
        desired: Access,
        rule: AccessRule,
    ) -> AccessChange:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            # Every active Editor is locked with the two accounts, in primary key order, so
            # access changes queue instead of deadlocking and two Editors demoting each other
            # cannot both read the other as an Editor. A row changed while waiting is
            # re-evaluated against the filter and dropped if it no longer matches, which can
            # only understate the count and so never admits a change that leaves none.
            locked = {
                record.id: record
                for record in UserRecord.objects.select_for_update()
                .filter(Q(pk__in=(actor_id, target_id)) | Q(role=Role.EDITOR.value, is_active=True))
                .order_by("pk")
            }

            target = locked.get(target_id)
            if target is None:
                return AccessChange(AccessChangeOutcome.NOT_FOUND)

            actor = locked.get(actor_id)
            if actor is None:
                return AccessChange(
                    AccessChangeOutcome.REFUSED, violation=AccessViolation.ACTOR_NOT_EDITOR
                )

            violation = rule(
                AccessChangeContext(
                    actor=Account(actor.id, _access_of(actor)),
                    target=Account(target.id, _access_of(target)),
                    desired=desired,
                    active_editors=sum(_access_of(r).is_active_editor for r in locked.values()),
                )
            )
            if violation is not None:
                return AccessChange(AccessChangeOutcome.REFUSED, violation=violation)

            target.role = desired.role.value
            target.is_active = desired.is_active
            target.save(update_fields=["role", "is_active"])

        return AccessChange(AccessChangeOutcome.APPLIED, user=to_user(target))

    def set_password(self, actor_id: UUID, target_id: UUID, password: str) -> AccessChange:
        with translate_database_errors():
            target = UserRecord.objects.filter(pk=target_id).first()
        if target is None:
            return AccessChange(AccessChangeOutcome.NOT_FOUND)

        # Validated and hashed before any lock is taken: hashing is slow on purpose and must not
        # hold up the access changes that queue behind these rows. The username cannot change,
        # so the similarity check sees the same account the write will reach.
        try:
            validate_password(password, target)
        except ValidationError as error:
            raise PasswordRejected(tuple(error.messages)) from error
        hashed = make_password(password)

        with translate_database_errors(), transaction.atomic():
            # The same primary key order as change_access, so the two never wait for each other
            # in a cycle.
            locked = {
                record.id: record
                for record in UserRecord.objects.select_for_update()
                .filter(pk__in=(actor_id, target_id))
                .order_by("pk")
            }

            target = locked.get(target_id)
            if target is None:
                return AccessChange(AccessChangeOutcome.NOT_FOUND)

            actor = locked.get(actor_id)
            if actor is None or not _access_of(actor).is_active_editor:
                return AccessChange(
                    AccessChangeOutcome.REFUSED, violation=AccessViolation.ACTOR_NOT_EDITOR
                )

            # Only the password column, so a role or active change committed since the target
            # was read is not overwritten.
            target.password = hashed
            target.save(update_fields=["password"])

        return AccessChange(AccessChangeOutcome.APPLIED, user=to_user(target))
