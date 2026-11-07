from dataclasses import dataclass
from uuid import UUID

from serendipeak.catalog.entities import PUBLIC_STATUSES, Mountain, MountainStatus
from serendipeak.catalog.new_mountain import (
    NewMountainViolation,
    NewPhotograph,
    PhotographCredit,
    content_violations,
    credit_violations,
    photograph_violations,
)
from serendipeak.catalog.publication import PublicationViolation, publication_violations


@dataclass(frozen=True, slots=True)
class MountainUpdate:
    """The editable content and geography of a mountain, as the whole state an editor saves.

    Every field is written, so an optional one left as None is cleared. The name and summary are
    English only (translations are not written before the localization milestone). The status,
    the coordinates and the camera are not part of an update. A photograph replaces the stored
    one with its credit. A credit alone changes the credit of the stored photograph and keeps
    its file. Removing the photograph deletes the record with its credit. These three are
    exclusive, since each contradicts the others; with none, the stored photograph and its
    credit are kept.
    """

    slug: str
    name: str
    elevation_meters: int
    continent_code: str
    country_codes: tuple[str, ...] = ()
    region_id: UUID | None = None
    summary: str | None = None
    osm_node_id: int | None = None
    wikidata_id: str | None = None
    photograph: NewPhotograph | None = None
    credit: PhotographCredit | None = None
    remove_photograph: bool = False

    def __post_init__(self):
        changes = (self.photograph is not None, self.credit is not None, self.remove_photograph)
        if sum(changes) > 1:
            raise ValueError("a photograph is replaced, re-credited or removed, not several")


def mountain_update_violations(update: MountainUpdate) -> tuple[NewMountainViolation, ...]:
    """Why the content cannot be stored; empty means it can.

    The rules are those of a new draft, stated before the mountain is locked. Whether the
    continent, countries and region exist, and whether the slug is free, is decided when the
    update is written.
    """
    violations = content_violations(
        slug=update.slug,
        name=update.name,
        elevation_meters=update.elevation_meters,
        summary=update.summary,
        osm_node_id=update.osm_node_id,
        wikidata_id=update.wikidata_id,
    )
    if update.photograph is not None:
        return violations + tuple(photograph_violations(update.photograph))
    if update.credit is not None:
        return violations + tuple(credit_violations(update.credit))

    return violations


def public_edit_violations(prospective: Mountain) -> tuple[PublicationViolation, ...]:
    """What keeps an edit from being saved on a public mountain; empty for a draft.

    A draft may be saved incomplete. An active or inactive mountain must remain publishable
    after the edit. An inactive one has no camera after a move, and only the camera editor gives
    it one back, so a missing camera is what reactivation requires, not every other edit.
    """
    if prospective.status not in PUBLIC_STATUSES:
        return ()

    violations = publication_violations(prospective)
    if prospective.status is MountainStatus.INACTIVE:
        violations = tuple(v for v in violations if v is not PublicationViolation.CAMERA_MISSING)

    return violations
