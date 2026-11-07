from django.db import connection, transaction
from django.db.models.functions import Collate

from serendipeak.catalog.bootstrap.ports import CatalogSeed, CatalogSnapshot
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import (
    country_link_records,
    discovery_record,
    image_record,
    mountain_record,
    to_catalog_discovery,
    to_catalog_mountain,
    with_geography,
)
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
)


class DjangoCatalogStore:
    def load(self, seed: CatalogSeed) -> None:
        mountains = [mountain_record(entry) for entry in seed.mountains]
        links = [link for entry in seed.mountains for link in country_link_records(entry)]
        images = [record for entry in seed.mountains if (record := image_record(entry))]
        discoveries = [discovery_record(discovery) for discovery in seed.discoveries]

        # Foreign keys are deferred, so their violations surface when atomic() commits:
        # the translation has to enclose the whole block, not sit inside it.
        with translate_database_errors(), transaction.atomic():
            _lock_the_mountain_table()
            if MountainRecord.objects.exists():
                raise CatalogAlreadyPopulated()

            MountainRecord.objects.bulk_create(mountains)
            MountainCountryRecord.objects.bulk_create(links)
            MountainImageRecord.objects.bulk_create(images)
            DailyDiscoveryRecord.objects.bulk_create(discoveries)

    def snapshot(self) -> CatalogSnapshot:
        with translate_database_errors():
            # Code point order, so the snapshot order does not depend on the database collation.
            mountains = with_geography(MountainRecord.objects.select_related("image")).order_by(
                Collate("slug", "C")
            )
            discoveries = DailyDiscoveryRecord.objects.order_by("date")

            return CatalogSnapshot(
                mountains=tuple(to_catalog_mountain(record) for record in mountains),
                discoveries=tuple(to_catalog_discovery(record) for record in discoveries),
            )


def _lock_the_mountain_table() -> None:
    # SHARE ROW EXCLUSIVE conflicts with itself and with INSERT but not with plain reads, so
    # concurrent loads run one at a time and the emptiness read sees any load committed while
    # this one waited. Images and discoveries reference mountains, so mountains decide.
    table = connection.ops.quote_name(MountainRecord._meta.db_table)
    with connection.cursor() as cursor:
        cursor.execute(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE")
