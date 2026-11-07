from django.db import IntegrityError, connection, transaction

from serendipeak.catalog.entities import Mountain, MountainStatus, PrimaryImage
from serendipeak.catalog.errors import SlugTaken, UnknownContinent, UnknownCountries
from serendipeak.catalog.new_mountain import NewMountain
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.errors import ApplicationError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import (
    camera_columns,
    image_columns,
    to_mountain,
    to_point,
    with_geography,
)
from serendipeak.persistence.models import (
    ContinentRecord,
    CountryRecord,
    MountainCountryRecord,
    MountainImageRecord,
    MountainRecord,
    MountainRegionRecord,
)


class DjangoMountainCreationStore:
    def create_draft(self, mountain: NewMountain, image: PrimaryImage | None) -> Mountain:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            record = _mountain_record(mountain)
            try:
                # A savepoint, so the references can be read after a failure; the outer block
                # is then rolled back by the application error.
                with transaction.atomic():
                    record.save(force_insert=True)
                    if image is not None:
                        _image_record(record, image).save(force_insert=True)
                    MountainCountryRecord.objects.bulk_create(
                        MountainCountryRecord(mountain=record, country_id=code)
                        for code in sorted(set(mountain.country_codes))
                    )
                    # The foreign keys are deferred. Checking them here, while the savepoint is
                    # still open, turns an unknown continent, region or country into an error
                    # that can be explained, instead of one raised by the final commit. The
                    # foreign key triggers also lock the referenced rows, so a region deleted
                    # concurrently either fails this check or waits for the commit.
                    connection.check_constraints()
            except IntegrityError as error:
                refusal = _refusal(mountain)
                if refusal is None:
                    raise
                raise refusal from error

            return to_mountain(
                with_geography(MountainRecord.objects.select_related("image")).get(pk=record.pk)
            )


def _mountain_record(mountain: NewMountain) -> MountainRecord:
    return MountainRecord(
        slug=mountain.slug,
        name_en=mountain.name,
        location=to_point(mountain.coordinates),
        elevation_meters=mountain.elevation_meters,
        continent_id=mountain.continent_code,
        region_id=mountain.region_id,
        summary_en=mountain.summary,
        **camera_columns(None),
        osm_node_id=mountain.osm_node_id,
        wikidata_id=mountain.wikidata_id,
        status=MountainStatus.DRAFT.value,
    )


def _image_record(record: MountainRecord, image: PrimaryImage) -> MountainImageRecord:
    return MountainImageRecord(mountain=record, **image_columns(image))


def _refusal(mountain: NewMountain) -> ApplicationError | None:
    """The reason a creation was refused, in the order the port promises, or None when the
    integrity error has another cause."""
    if MountainRecord.objects.filter(slug=mountain.slug).exists():
        return SlugTaken(mountain.slug)

    if not ContinentRecord.objects.filter(pk=mountain.continent_code).exists():
        return UnknownContinent(mountain.continent_code)

    region_id = mountain.region_id
    if region_id is not None and not MountainRegionRecord.objects.filter(pk=region_id).exists():
        return UnknownRegion(region_id)

    wanted = set(mountain.country_codes)
    known = set(CountryRecord.objects.filter(pk__in=wanted).values_list("pk", flat=True))
    if wanted - known:
        return UnknownCountries(tuple(sorted(wanted - known)))

    return None
