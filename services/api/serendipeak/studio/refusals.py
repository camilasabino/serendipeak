from dataclasses import dataclass, field

from serendipeak.catalog.errors import (
    ActiveMountainLocationLocked,
    CameraResetNotConfirmed,
    CoordinatesRejected,
    InvalidMountain,
    MountainHasNoPhotograph,
    PhotographNotStored,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
)
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.studio import mountain_messages as messages
from serendipeak.studio.representations import VIOLATION_REASONS

PUBLISHED_MUST_STAY_PUBLISHABLE = (
    "The mountain is on the site, so a save has to leave it meeting the publication rules."
)


@dataclass
class Refusal:
    """Why a write use case refused the form, in the words of the form's fields.

    Keys are field names; None is an error of the whole form.
    """

    mountain: dict[str | None, list[str]] = field(default_factory=dict)
    photograph: dict[str | None, list[str]] = field(default_factory=dict)

    def apply(self, mountain_form, photograph_form) -> None:
        _add(mountain_form, self.mountain)
        _add(photograph_form, self.photograph)


def _add(form, errors) -> None:
    for name, texts in errors.items():
        form.add_error(name if name in form.fields else None, texts)


def refusal_of(error: Exception, *, max_photograph_bytes: int) -> Refusal | None:
    """The form errors that say why a use case refused a save; None for any other exception."""
    refusal = Refusal()

    def refuse(target, name, message):
        target.setdefault(name, []).append(message)

    match error:
        case InvalidMountain():
            for violation in error.violations:
                if violation in messages.MOUNTAIN_VIOLATION_FIELDS:
                    name, message = messages.MOUNTAIN_VIOLATION_FIELDS[violation]
                    refuse(refusal.mountain, name, message)
                else:
                    name, message = messages.PHOTOGRAPH_VIOLATION_FIELDS[violation]
                    refuse(refusal.photograph, name, message)
        case PublicationRejected():
            refuse(refusal.mountain, None, PUBLISHED_MUST_STAY_PUBLISHABLE)
            for violation in error.violations:
                refuse(refusal.mountain, None, VIOLATION_REASONS[violation])
        case SlugTaken():
            refuse(refusal.mountain, "slug", messages.SLUG_TAKEN)
        case UnknownContinent():
            refuse(refusal.mountain, "continent", messages.CONTINENT_UNKNOWN)
        case UnknownRegion():
            refuse(refusal.mountain, "region", messages.REGION_UNKNOWN)
        case UnknownCountries():
            refuse(
                refusal.mountain,
                "countries",
                messages.COUNTRIES_UNKNOWN.format(", ".join(error.codes)),
            )
        case PhotographRejected():
            refuse(refusal.photograph, "file", _rejection_message(error, max_photograph_bytes))
        case MountainHasNoPhotograph():
            refuse(refusal.photograph, "file", messages.NO_PHOTOGRAPH_TO_REVIEW)
        case PhotographNotStored():
            refuse(refusal.mountain, None, messages.PHOTOGRAPH_NOT_STORED)
        case ActiveMountainLocationLocked():
            refuse(refusal.mountain, "latitude", messages.ACTIVE_LOCATION_LOCKED)
        case CameraResetNotConfirmed():
            refuse(refusal.mountain, "confirm_camera_reset", messages.CAMERA_RESET_REQUIRED)
        case CoordinatesRejected():
            refuse(refusal.mountain, "latitude", messages.LATITUDE_MESSAGE)
        case _:
            return None

    return refusal


def _rejection_message(error: PhotographRejected, max_bytes: int) -> str:
    if error.reason is PhotographRejection.TOO_MANY_BYTES:
        return messages.too_many_bytes(max_bytes)

    return messages.PHOTOGRAPH_REJECTION_MESSAGES.get(error.reason, messages.PHOTOGRAPH_REJECTED)
