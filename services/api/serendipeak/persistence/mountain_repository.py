from collections.abc import Sequence

from django.db.models.functions import Collate

from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CandidateMountain,
    Mountain,
    MountainIndexEntry,
    MountainStatus,
)
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import (
    load_region_paths,
    to_mountain,
    to_mountain_index_entry,
    with_geography,
)
from serendipeak.persistence.models import MountainRecord

_PUBLIC_STATUS_VALUES = sorted(status.value for status in PUBLIC_STATUSES)


class DjangoMountainRepository:
    def find_public_by_slug(self, slug: str) -> Mountain | None:
        with translate_database_errors():
            record = (
                with_geography(MountainRecord.objects.select_related("image"))
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

    def list_active_index(self) -> Sequence[MountainIndexEntry]:
        with translate_database_errors():
            records = list(
                with_geography(MountainRecord.objects.filter(status=MountainStatus.ACTIVE.value))
                # Only the columns an entry maps: the summary and camera are never read here.
                .only(
                    "slug",
                    "name_en",
                    "name_es",
                    "name_pt",
                    "location",
                    "elevation_meters",
                    "region_id",
                    "continent",
                )
                .order_by(Collate("slug", "C"))
            )
            paths = load_region_paths(records)

        return tuple(to_mountain_index_entry(record, paths) for record in records)
