from collections.abc import Sequence

from django.db.models.functions import Collate

from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CandidateMountain,
    Mountain,
    MountainStatus,
)
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_mountain
from serendipeak.persistence.models import MountainRecord

_PUBLIC_STATUS_VALUES = sorted(status.value for status in PUBLIC_STATUSES)


class DjangoMountainRepository:
    def find_public_by_slug(self, slug: str) -> Mountain | None:
        with translate_database_errors():
            record = (
                MountainRecord.objects.select_related("image")
                .filter(slug=slug, status__in=_PUBLIC_STATUS_VALUES)
                .first()
            )

        return None if record is None else to_mountain(record)

    def list_active_candidates(self) -> Sequence[CandidateMountain]:
        with translate_database_errors():
            # Code point order, so the order does not depend on the database collation.
            rows = list(
                MountainRecord.objects.filter(status=MountainStatus.ACTIVE.value)
                .order_by(Collate("slug", "C"))
                .values_list("id", "slug")
            )

        return tuple(CandidateMountain(id=mountain_id, slug=slug) for mountain_id, slug in rows)
