from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.camera import CameraViolation
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.new_mountain import NewMountainViolation
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.errors import ApplicationError, DomainError, InfrastructureError


class InvalidCatalogSnapshot(ApplicationError):
    pass


class InvalidGeographyInput(ApplicationError):
    pass


class GeographyBackfillRejected(ApplicationError):
    def __init__(self, problems: tuple[str, ...]):
        super().__init__("; ".join(problems))
        self.problems = problems


class UnexpectedSchemaState(ApplicationError):
    def __init__(self, migration: str, expected: tuple[str, ...]):
        super().__init__(
            f"the catalog schema is at migration {migration}, not at {' or '.join(expected)}"
        )
        self.migration = migration


class CatalogAlreadyPopulated(ApplicationError):
    def __init__(self):
        super().__init__("the catalog already holds mountains")


class CatalogMismatch(ApplicationError):
    def __init__(self, mismatches: tuple[str, ...]):
        super().__init__("; ".join(mismatches))
        self.mismatches = mismatches


class MountainNotFound(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"no public mountain has the slug {slug!r}")
        self.slug = slug


class MountainSlugNotFound(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"no mountain has the slug {slug!r}")
        self.slug = slug


class UnknownMountain(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"no mountain has the id {mountain_id}")
        self.mountain_id = mountain_id


class MountainHasNoPhotograph(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"mountain {mountain_id} has no photograph whose credit could change")
        self.mountain_id = mountain_id


class MountainNotDraft(DomainError):
    def __init__(self, mountain_id: UUID, status: MountainStatus):
        super().__init__(f"mountain {mountain_id} is {status.value}, and only a draft is deleted")
        self.mountain_id = mountain_id
        self.status = status


class MountainReferenced(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"mountain {mountain_id} is referenced by a daily discovery")
        self.mountain_id = mountain_id


class PublicationRejected(DomainError):
    def __init__(self, violations: tuple[PublicationViolation, ...]):
        super().__init__(", ".join(violations))
        self.violations = violations


class InvalidStatusTransition(DomainError):
    def __init__(self, current: MountainStatus, target: MountainStatus):
        super().__init__(f"a {current.value} mountain cannot become {target.value}")
        self.current = current
        self.target = target


class CameraRejected(DomainError):
    def __init__(self, violations: tuple[CameraViolation, ...]):
        super().__init__(", ".join(violations))
        self.violations = violations


class CameraChanged(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"the camera of mountain {mountain_id} changed since it was read")
        self.mountain_id = mountain_id


class LocationChanged(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"the location of mountain {mountain_id} changed since it was read")
        self.mountain_id = mountain_id


class CoordinatesRejected(DomainError):
    pass


class CameraResetNotConfirmed(DomainError):
    def __init__(self):
        super().__init__("changing the coordinates clears the camera, which must be confirmed")


class ActiveMountainLocationLocked(DomainError):
    def __init__(self):
        super().__init__("an active mountain must be deactivated before its coordinates change")


class PhotographRejection(StrEnum):
    TOO_MANY_BYTES = "too_many_bytes"
    TOO_MANY_PIXELS = "too_many_pixels"
    UNSUPPORTED_FORMAT = "unsupported_format"
    NOT_AN_IMAGE = "not_an_image"
    CORRUPT = "corrupt"
    ANIMATED = "animated"


class PhotographNotStored(InfrastructureError):
    """The media store failed while the objects of an accepted photograph were being written."""


class PhotographRejected(ApplicationError):
    def __init__(self, reason: PhotographRejection):
        super().__init__(f"the photograph was rejected: {reason.value}")
        self.reason = reason


class InvalidMountain(DomainError):
    def __init__(self, violations: tuple[NewMountainViolation, ...]):
        super().__init__(", ".join(violations))
        self.violations = violations


class SlugTaken(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"the slug {slug!r} is already in use")
        self.slug = slug


class UnknownContinent(ApplicationError):
    def __init__(self, code: str):
        super().__init__(f"no continent has the code {code!r}")
        self.code = code


class UnknownCountries(ApplicationError):
    def __init__(self, codes: tuple[str, ...]):
        super().__init__(f"no country has these codes: {', '.join(codes)}")
        self.codes = codes


class MountainNotInDraft(ApplicationError):
    def __init__(self, slug: str):
        super().__init__(f"the mountain {slug!r} is not a draft")
        self.slug = slug


class InvalidPreviewToken(ApplicationError):
    def __init__(self):
        super().__init__("the preview token is not valid")


class PreviewUnavailable(ApplicationError):
    """The token is valid but its mountain was deleted or is no longer a draft."""

    def __init__(self, mountain_id: UUID):
        super().__init__(f"no draft mountain has the id {mountain_id}")
        self.mountain_id = mountain_id
