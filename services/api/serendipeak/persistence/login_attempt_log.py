from datetime import datetime

from django.db.models import Count, Q

from serendipeak.accounts.ports import RecordedLoginAttempt
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.models import LoginAttemptRecord


class DjangoLoginAttemptLog:
    def record(
        self,
        *,
        username_key: str,
        address: str,
        at: datetime,
        window_start: datetime,
    ) -> RecordedLoginAttempt:
        with translate_database_errors():
            LoginAttemptRecord.objects.filter(attempted_at__lt=window_start).delete()
            stored = LoginAttemptRecord.objects.create(
                username_key=username_key,
                address=address,
                attempted_at=at,
            )
            counts = LoginAttemptRecord.objects.filter(
                Q(username_key=username_key) | Q(address=address),
                attempted_at__gte=window_start,
            ).aggregate(
                by_username=Count("pk", filter=Q(username_key=username_key)),
                by_address=Count("pk", filter=Q(address=address)),
            )

        return RecordedLoginAttempt(
            attempt_id=stored.pk,
            by_username=counts["by_username"],
            by_address=counts["by_address"],
        )

    def discard(self, attempt_id: int) -> None:
        with translate_database_errors():
            LoginAttemptRecord.objects.filter(pk=attempt_id).delete()

    def forget_username(self, username_key: str) -> None:
        with translate_database_errors():
            LoginAttemptRecord.objects.filter(username_key=username_key).delete()
