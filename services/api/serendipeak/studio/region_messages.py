from serendipeak.catalog.region_changes import MountainRegionViolation
from serendipeak.catalog.region_directory import MoveRefusal

NAME_REQUIRED = "Enter the English name."
SLUG_MESSAGE = "Use lowercase letters and digits separated by single hyphens."
SLUG_FROM_NAME = (
    "The English name has no letters or digits to derive a slug from. Enter the slug yourself."
)
SLUG_IMMUTABLE = (
    "The slug is the permanent address of the region. It is chosen now and cannot be changed "
    "after the region is saved."
)
SLUG_TAKEN = "The slug {slug} is already used by {owner}. Slugs are unique across all regions."
SLUG_TAKEN_UNKNOWN = "Another region already uses the slug {slug}."
SLUG_SUGGESTIONS = "Free slugs for this name: {}."
NAME_TAKEN = "{parent} already has a region named “{name}”. Sibling names must differ."
NAME_BLANK = "Leave the name empty instead of blank."
WIKIDATA_INVALID = "Use the Wikidata item id, such as Q5451."
WIKIDATA_TAKEN = "Another region already uses the Wikidata item {wikidata_id}."
PARENT_UNKNOWN = "That parent no longer exists. Reload the page and choose again."
CONFIRM_SAME_NAME = "Confirm that this is a different region, or qualify the slug."

DESTINATION_REQUIRED = "Choose where the region goes."
UNAVAILABLE = "This destination is unavailable: {}."
DESTINATION_UNKNOWN = "That destination no longer exists. Reload the page and choose again."
REGION_GONE = "{} no longer exists, so nothing was changed."
IN_USE = (
    "{name} was not deleted: it still has {children} and {mountains}. Move or delete the child "
    "regions and reassign the mountains first."
)

VIOLATION_FIELDS = {
    MountainRegionViolation.SLUG_INVALID: ("slug", SLUG_MESSAGE),
    MountainRegionViolation.NAME_EN_BLANK: ("name_en", NAME_REQUIRED),
    MountainRegionViolation.NAME_ES_BLANK: ("name_es", NAME_BLANK),
    MountainRegionViolation.NAME_PT_BLANK: ("name_pt", NAME_BLANK),
    MountainRegionViolation.WIKIDATA_ID_INVALID: ("wikidata_id", WIKIDATA_INVALID),
}

MOVE_REFUSALS = {
    MoveRefusal.ITSELF: "this is the region you are moving",
    MoveRefusal.INSIDE: "it is inside this region, which would end up inside itself",
    MoveRefusal.CURRENT_PARENT: "it is already the parent",
    MoveRefusal.NAME_TAKEN: "it already has a region named “{name}”",
}


def move_refusal(refusal: MoveRefusal, name: str) -> str:
    return MOVE_REFUSALS[refusal].format(name=name)


def plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def moved(name: str, descendant_regions: int, mountains: int) -> str:
    travelled = [
        plural(count, noun)
        for count, noun in ((descendant_regions, "descendant region"), (mountains, "mountain"))
        if count
    ]
    if not travelled:
        return f"{name} was moved."

    return f"{name} was moved, with {' and '.join(travelled)} below it."
