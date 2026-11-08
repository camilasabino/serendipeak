from collections.abc import Sequence

from serendipeak.catalog.entities import Mountain
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import load_region_paths, to_mountain, with_geography
from serendipeak.persistence.models import MountainRecord


class DjangoMountainCatalogReader:
    def list_all(self) -> Sequence[Mountain]:
        with translate_database_errors():
            records = list(with_geography(MountainRecord.objects.select_related("image")))
            paths = load_region_paths(records)

        return tuple(to_mountain(record, paths) for record in records)

    def find_by_slug(self, slug: str) -> Mountain | None:
        with translate_database_errors():
            record = (
                with_geography(MountainRecord.objects.select_related("image"))
                .filter(slug=slug)
                .first()
            )

        return None if record is None else to_mountain(record)
