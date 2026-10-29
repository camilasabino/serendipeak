from serendipeak.catalog.entities import PUBLIC_STATUSES, Mountain
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
