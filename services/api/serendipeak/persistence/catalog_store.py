from django.db import connection, transaction
from django.db.models.functions import Collate

from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.errors import CatalogAlreadyPopulated
from serendipeak.catalog.regions import build_region_path
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import (
    country_link_records,
    discovery_record,
    image_record,
    mountain_record,
    region_record,
    to_catalog_discovery,
    to_catalog_mountain,
    to_region,
    with_geography,
)
from serendipeak.persistence.models import (
    DailyDiscoveryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)


class DjangoCatalogStore:
    def load(self, catalog: CatalogSnapshot) -> None:
        regions = [region_record(region) for region in catalog.regions]
        region_ids = {region.slug: region.id for region in catalog.regions}
        mountains = [mountain_record(entry, region_ids) for entry in catalog.mountains]
        links = [link for entry in catalog.mountains for link in country_link_records(entry)]
        images = [record for entry in catalog.mountains if (record := image_record(entry))]
        discoveries = [discovery_record(discovery) for discovery in catalog.discoveries]

        # Foreign keys are deferred, so their violations surface when atomic() commits:
        # the translation has to enclose the whole block, not sit inside it.
        with translate_database_errors(), transaction.atomic():
            _lock_the_mountain_table()
            if MountainRecord.objects.exists():
                raise CatalogAlreadyPopulated()

            # The parent link is a deferred foreign key, so the regions go in as one batch in any
            # order, and a mountain's region only has to exist by commit.
            MountainRegionRecord.objects.bulk_create(regions)
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
            regions = {
                record.id: to_region(record) for record in MountainRegionRecord.objects.all()
            }
            paths = {region_id: build_region_path(region_id, regions) for region_id in regions}

            return CatalogSnapshot(
                mountains=tuple(to_catalog_mountain(record, paths) for record in mountains),
                discoveries=tuple(to_catalog_discovery(record) for record in discoveries),
                regions=tuple(sorted(regions.values(), key=lambda region: region.slug)),
            )


def _lock_the_mountain_table() -> None:
    # SHARE ROW EXCLUSIVE conflicts with itself and with INSERT but not with plain reads, so
    # concurrent loads run one at a time and the emptiness read sees any load committed while
    # this one waited. Images and discoveries reference mountains, so mountains decide.
    table = connection.ops.quote_name(MountainRecord._meta.db_table)
    with connection.cursor() as cursor:
        cursor.execute(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE")
