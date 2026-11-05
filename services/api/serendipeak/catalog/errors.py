from enum import StrEnum
from uuid import UUID

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.publication import PublicationViolation
from serendipeak.errors import ApplicationError, DomainError


class InvalidCatalogSeed(ApplicationError):
    pass


class InvalidFrozenCatalog(ApplicationError):
    pass


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


class UnknownMountain(ApplicationError):
    def __init__(self, mountain_id: UUID):
        super().__init__(f"no mountain has the id {mountain_id}")
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


class UnknownPhotographs(ApplicationError):
    def __init__(self, slugs: tuple[str, ...]):
        super().__init__(f"no selected photograph has these slugs: {', '.join(slugs)}")
        self.slugs = slugs


class InvalidPhotographManifest(ApplicationError):
    pass


class PhotographRejection(StrEnum):
    TOO_MANY_BYTES = "too_many_bytes"
    TOO_MANY_PIXELS = "too_many_pixels"
    UNSUPPORTED_FORMAT = "unsupported_format"
    NOT_AN_IMAGE = "not_an_image"
    CORRUPT = "corrupt"
    ANIMATED = "animated"
    DIMENSIONS_DIFFER = "dimensions_differ"
    CHECKSUM_DIFFERS = "checksum_differs"


class PhotographRejected(ApplicationError):
    def __init__(self, reason: PhotographRejection):
        super().__init__(f"the photograph was rejected: {reason.value}")
        self.reason = reason
