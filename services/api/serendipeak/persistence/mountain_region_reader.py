from collections.abc import Collection, Sequence
from uuid import UUID

from django.db.models import Count

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import CountedRegion, RegionMountain
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_region
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord


class DjangoMountainRegionReader:
    def read_all(self) -> Sequence[CountedRegion]:
        with translate_database_errors():
            # One grouped statement; the only join is the mountains' region_id index.
            records = list(
                MountainRegionRecord.objects.annotate(
                    direct_mountains=Count("mountains")
                ).order_by()
            )

        return tuple(
            CountedRegion(region=to_region(record), direct_mountains=record.direct_mountains)
            for record in records
        )

    def list_mountains(self, region_ids: Collection[UUID]) -> Sequence[RegionMountain]:
        if not region_ids:
            return ()

        with translate_database_errors():
            rows = list(
                MountainRecord.objects.filter(region_id__in=list(region_ids)).values_list(
                    "id", "slug", "name_en", "status", "region_id"
                )
            )

        return tuple(
            RegionMountain(
                id=mountain_id,
                slug=slug,
                name=name,
                status=MountainStatus(status),
                region_id=region_id,
            )
            for mountain_id, slug, name, status, region_id in rows
        )
