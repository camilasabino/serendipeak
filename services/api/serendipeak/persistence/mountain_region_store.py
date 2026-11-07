from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from django.db import IntegrityError, connection, transaction
from django.db.models import Value
from django.db.models.functions import Lower

from serendipeak.catalog.region_changes import (
    MountainRegionUpdate,
    NewMountainRegion,
    RegionInUse,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWikidataTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.regions import MountainRegion, UnknownRegion
from serendipeak.errors import ApplicationError, InfrastructureError
from serendipeak.persistence.errors import translate_database_errors
from serendipeak.persistence.mapping import to_region
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord

# The key the cycle trigger of migration 0019 takes; tests keep the two equal.
STRUCTURE_LOCK_KEY = 4737260011

_REGION = MountainRegionRecord._meta.db_table

_DESCENDS_FROM_SQL = f"""
WITH RECURSIVE ancestors(id) AS (
    SELECT %s
    UNION
    SELECT region.parent_id
    FROM {_REGION} region
    JOIN ancestors ON region.id = ancestors.id
    WHERE region.parent_id IS NOT NULL
)
SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = %s)
"""


@contextmanager
def _structure_write() -> Iterator[None]:
    """One atomic write of the taxonomy, serialized with every other.

    The advisory lock comes before any row lock. The cycle trigger takes the same lock while it
    holds the row it updates, so a writer that held a row and then asked for the lock could
    deadlock with the writer that holds the lock and asks for that row. Taking the lock first
    means a writer waits holding nothing, and the checks that follow judge the committed state
    left by whoever held it.
    """
    # The translation encloses atomic() because deferred constraints fail when it commits.
    with translate_database_errors(), transaction.atomic():
        _require_read_committed()
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [STRUCTURE_LOCK_KEY])
        yield


def _require_read_committed() -> None:
    # Each statement of a READ COMMITTED transaction takes a fresh snapshot, so what is read
    # after the lock includes what the previous holder committed. A stricter level would read
    # the tree as it was when the transaction began. The check precedes the lock because the
    # snapshot of such a transaction is fixed by its first statement.
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('transaction_isolation')")
        (level,) = cursor.fetchone()
    if level != "read committed":
        raise InfrastructureError(
            f"the region structure changes only under READ COMMITTED, not {level.upper()}"
        )


def _locked(region_id: UUID, *, key_changes: bool = False) -> MountainRegionRecord:
    """The region row, locked. Deleting changes its key, so only that lock also blocks the
    mountains and child regions that point at it from being assigned meanwhile."""
    record = (
        MountainRegionRecord.objects.select_for_update(no_key=not key_changes)
        .filter(pk=region_id)
        .first()
    )
    if record is None:
        raise UnknownRegion(region_id)

    return record


def _exists(region_id: UUID) -> bool:
    return MountainRegionRecord.objects.filter(pk=region_id).exists()


def _sibling_named(parent_id: UUID | None, name: str, *, excluding: UUID | None = None) -> bool:
    if parent_id is None:
        return False
    siblings = MountainRegionRecord.objects.annotate(folded=Lower("name_en")).filter(
        parent_id=parent_id, folded=Lower(Value(name))
    )

    return siblings.exclude(pk=excluding).exists()


def _wikidata_taken(wikidata_id: str | None, *, excluding: UUID | None = None) -> bool:
    if wikidata_id is None:
        return False

    return (
        MountainRegionRecord.objects.filter(wikidata_id=wikidata_id).exclude(pk=excluding).exists()
    )


class DjangoMountainRegionStore:
    def create(self, region: NewMountainRegion) -> MountainRegion:
        with _structure_write():
            parent_id = region.parent_id
            if (
                parent_id is not None
                and not MountainRegionRecord.objects.filter(pk=parent_id).exists()
            ):
                raise UnknownRegion(parent_id)

            record = MountainRegionRecord(
                slug=region.slug,
                parent_id=parent_id,
                name_en=region.name.en,
                name_es=region.name.es,
                name_pt=region.name.pt,
                wikidata_id=region.wikidata_id,
            )
            try:
                # A savepoint, so the conflict can be read after the failure; the outer block is
                # then rolled back by the application error.
                with transaction.atomic():
                    record.save(force_insert=True)
            except IntegrityError as error:
                refusal = _creation_refusal(region)
                if refusal is None:
                    raise
                raise refusal from error

            return to_region(record)

    def update(self, region_id: UUID, update: MountainRegionUpdate) -> MountainRegion:
        with _structure_write():
            record = _locked(region_id)
            if _state_of(record) == update:
                return to_region(record)

            try:
                with transaction.atomic():
                    # A queryset update names only these columns. A save() would also name
                    # parent_id and so fire the cycle trigger for a move that never happens.
                    MountainRegionRecord.objects.filter(pk=region_id).update(
                        name_en=update.name.en,
                        name_es=update.name.es,
                        name_pt=update.name.pt,
                        wikidata_id=update.wikidata_id,
                    )
            except IntegrityError as error:
                refusal = _update_refusal(record, update)
                if refusal is None:
                    raise
                raise refusal from error

            return to_region(MountainRegionRecord.objects.get(pk=region_id))

    def move(self, region_id: UUID, parent_id: UUID | None) -> MountainRegion:
        with _structure_write():
            record = _locked(region_id)
            if record.parent_id == parent_id:
                return to_region(record)

            if parent_id is not None:
                if not _exists(parent_id):
                    raise UnknownRegion(parent_id)
                if _descends_from(parent_id, region_id):
                    raise RegionWouldDescendFromItself(region_id, parent_id)

            try:
                with transaction.atomic():
                    MountainRegionRecord.objects.filter(pk=region_id).update(parent_id=parent_id)
            except IntegrityError as error:
                if parent_id is not None and _sibling_named(
                    parent_id, record.name_en, excluding=region_id
                ):
                    raise RegionNameTaken(parent_id, record.name_en) from error
                raise

            return to_region(MountainRegionRecord.objects.get(pk=region_id))

    def delete(self, region_id: UUID) -> None:
        with _structure_write():
            _locked(region_id, key_changes=True)

            try:
                # A savepoint, so the dependents can be counted after a refusal. The foreign
                # keys are PROTECT, and deferred in the database, so the check runs here.
                with transaction.atomic():
                    MountainRegionRecord.objects.filter(pk=region_id).delete()
                    connection.check_constraints()
            except IntegrityError as error:
                children = MountainRegionRecord.objects.filter(parent_id=region_id).count()
                mountains = MountainRecord.objects.filter(region_id=region_id).count()
                if children or mountains:
                    raise RegionInUse(region_id, children, mountains) from error
                raise


def _descends_from(region_id: UUID, ancestor_id: UUID) -> bool:
    """Whether region_id is ancestor_id or has it among its ancestors: one recursive query."""
    with connection.cursor() as cursor:
        cursor.execute(_DESCENDS_FROM_SQL, [region_id, ancestor_id])
        (found,) = cursor.fetchone()

    return found


def _state_of(record: MountainRegionRecord) -> MountainRegionUpdate:
    return _to_update(to_region(record))


def _to_update(region: MountainRegion) -> MountainRegionUpdate:
    return MountainRegionUpdate(name=region.name, wikidata_id=region.wikidata_id)


def _creation_refusal(region: NewMountainRegion) -> ApplicationError | None:
    """The reason a creation was refused, in the order the port promises, or None when the
    integrity error has another cause."""
    if MountainRegionRecord.objects.filter(slug=region.slug).exists():
        return RegionSlugTaken(region.slug)
    if region.parent_id is not None and _sibling_named(region.parent_id, region.name.en):
        return RegionNameTaken(region.parent_id, region.name.en)
    if region.wikidata_id is not None and _wikidata_taken(region.wikidata_id):
        return RegionWikidataTaken(region.wikidata_id)

    return None


def _update_refusal(
    record: MountainRegionRecord, update: MountainRegionUpdate
) -> ApplicationError | None:
    if record.parent_id is not None and _sibling_named(
        record.parent_id, update.name.en, excluding=record.pk
    ):
        return RegionNameTaken(record.parent_id, update.name.en)
    if update.wikidata_id is not None and _wikidata_taken(update.wikidata_id, excluding=record.pk):
        return RegionWikidataTaken(update.wikidata_id)

    return None
