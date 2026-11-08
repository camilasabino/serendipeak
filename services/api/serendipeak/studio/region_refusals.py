from serendipeak.catalog.region_changes import (
    InvalidMountainRegion,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWikidataTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.region_directory import MoveRefusal, RegionDirectory
from serendipeak.catalog.regions import UnknownRegion
from serendipeak.studio import region_messages as messages


def _add(form, name, text) -> None:
    form.add_error(name if name in form.fields else None, text)


def refuse_in_form(error: Exception, form, directory: RegionDirectory) -> bool:
    """Put the reason a region write was refused into the form, in the words of its fields.

    Returns False for any error an editor cannot fix by editing the form. The directory is the
    one the page was built with, so the names it gives may be a moment old.
    """
    match error:
        case InvalidMountainRegion():
            for violation in error.violations:
                name, text = messages.VIOLATION_FIELDS[violation]
                _add(form, name, text)
        case RegionSlugTaken():
            owner = directory.slug_owner(error.slug)
            if owner is None:
                _add(form, "slug", messages.SLUG_TAKEN_UNKNOWN.format(slug=error.slug))
            else:
                _add(form, "slug", messages.SLUG_TAKEN.format(slug=error.slug, owner=owner.label))
            suggestions = form.slug_suggestions
            if suggestions:
                _add(form, "slug", messages.SLUG_SUGGESTIONS.format(", ".join(suggestions)))
        case RegionNameTaken():
            parent = directory.summary(error.parent_id)
            label = "The parent" if parent is None else parent.label
            _add(form, "name_en", messages.NAME_TAKEN.format(parent=label, name=error.name))
        case RegionWikidataTaken():
            _add(form, "wikidata_id", messages.WIKIDATA_TAKEN.format(wikidata_id=error.wikidata_id))
        case UnknownRegion():
            _add(form, "parent", messages.PARENT_UNKNOWN)
        case RegionWouldDescendFromItself():
            _add(
                form,
                "parent",
                messages.UNAVAILABLE.format(messages.move_refusal(MoveRefusal.INSIDE, "")),
            )
        case _:
            return False

    return True
