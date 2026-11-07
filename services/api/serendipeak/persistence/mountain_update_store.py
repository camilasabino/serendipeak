from uuid import UUID

from django.db import IntegrityError, connection, transaction
from django.db.models.functions import Now

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.errors import (
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
    UnknownMountain,
)
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.catalog.status_transitions import Gate
from serendipeak.errors import ApplicationError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_mountain, with_geography
from serendipeak.persistence.models import (
    ContinentRecord,
    CountryRecord,
    MountainCountryRecord,
    MountainRecord,
    MountainRegionRecord,
)


class DjangoMountainUpdateStore:
    def update(self, mountain_id: UUID, update: MountainUpdate, gate: Gate) -> Mountain:
        # The translation encloses atomic() because deferred constraints fail when it commits.
        with translate_database_errors(), transaction.atomic():
            # The first lock of every writer of the mountain row: the Admin, the status, camera
            # and location stores. The image is not locked or joined here: it is read after the
            # lock is held, so the gate never judges a photograph from before the wait.
            record = (
                MountainRecord.objects.select_for_update(of=("self",), no_key=True)
                .filter(pk=mountain_id)
                .first()
            )
            if record is None:
                raise UnknownMountain(mountain_id)

            try:
                # A savepoint, so the references can be read after a failure; the outer block
                # is then rolled back by the application error.
                with transaction.atomic():
                    changed = _write_columns(record, update)
                    changed |= _write_country_links(mountain_id, update)
                    if changed:
                        MountainRecord.objects.filter(pk=mountain_id).update(updated_at=Now())
                    # The foreign keys are deferred. Checking them here, while the savepoint is
                    # open, turns an unknown continent, region or country into an error that
                    # can be explained, and the checks lock the referenced rows, so a region
                    # deleted concurrently either fails here or waits for the commit.
                    connection.check_constraints()
            except IntegrityError as error:
                refusal = _refusal(mountain_id, update)
                if refusal is None:
                    raise
                raise refusal from error

            stored = to_mountain(
                with_geography(MountainRecord.objects.select_related("image")).get(pk=mountain_id)
            )
            # Judged on what was written, still under the lock; raising rolls the write back.
            violations = tuple(gate(stored))
            if violations:
                raise PublicationRejected(violations)

            return stored


def _column_values(update: MountainUpdate) -> dict[str, object]:
    return {
        "slug": update.slug,
        "name_en": update.name,
        "elevation_meters": update.elevation_meters,
        "continent_id": update.continent_code,
        "region_id": update.region_id,
        "summary_en": update.summary,
        "osm_node_id": update.osm_node_id,
        "wikidata_id": update.wikidata_id,
    }


def _write_columns(record: MountainRecord, update: MountainUpdate) -> bool:
    """Write the columns that differ in one statement; whether any did."""
    differing = {
        column: value
        for column, value in _column_values(update).items()
        if getattr(record, column) != value
    }
    if not differing:
        return False

    MountainRecord.objects.filter(pk=record.pk).update(**differing)

    return True


def _write_country_links(mountain_id: UUID, update: MountainUpdate) -> bool:
    """Write only the links that differ; whether any did."""
    wanted = set(update.country_codes)
    held = set(
        MountainCountryRecord.objects.filter(mountain_id=mountain_id).values_list(
            "country_id", flat=True
        )
    )
    removed = held - wanted
    added = wanted - held

    if removed:
        MountainCountryRecord.objects.filter(
            mountain_id=mountain_id, country_id__in=removed
        ).delete()
    if added:
        MountainCountryRecord.objects.bulk_create(
            MountainCountryRecord(mountain_id=mountain_id, country_id=code)
            for code in sorted(added)
        )

    return bool(removed or added)


def _refusal(mountain_id: UUID, update: MountainUpdate) -> ApplicationError | None:
    """The reason an update was refused, in the order the port promises, or None when the
    integrity error has another cause."""
    if MountainRecord.objects.filter(slug=update.slug).exclude(pk=mountain_id).exists():
        return SlugTaken(update.slug)

    if not ContinentRecord.objects.filter(pk=update.continent_code).exists():
        return UnknownContinent(update.continent_code)

    region_id = update.region_id
    if region_id is not None and not MountainRegionRecord.objects.filter(pk=region_id).exists():
        return UnknownRegion(region_id)

    wanted = set(update.country_codes)
    known = set(CountryRecord.objects.filter(pk__in=wanted).values_list("pk", flat=True))
    if wanted - known:
        return UnknownCountries(tuple(sorted(wanted - known)))

    return None
