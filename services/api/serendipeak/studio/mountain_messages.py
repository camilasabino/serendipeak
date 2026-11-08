from serendipeak.catalog import coordinates
from serendipeak.catalog.errors import PhotographRejection
from serendipeak.catalog.new_mountain import NewMountainViolation
from serendipeak.catalog.slug import RESERVED_SLUGS
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH, SummaryViolation

SLUG_MESSAGE = (
    "Use lowercase letters and digits separated by single hyphens; "
    f"{', '.join(sorted(RESERVED_SLUGS))} are reserved."
)
NAME_REQUIRED = "Enter the name."
LATITUDE_MESSAGE = (
    f"Latitude is between {coordinates.LATITUDE_MIN_DEGREES:g} and "
    f"{coordinates.LATITUDE_MAX_DEGREES:g} degrees."
)
LONGITUDE_MESSAGE = (
    f"Longitude is between {coordinates.LONGITUDE_MIN_DEGREES:g} and "
    f"{coordinates.LONGITUDE_MAX_DEGREES:g} degrees."
)
ELEVATION_MESSAGE = "Enter a whole number of meters above zero."
SUMMARY_MESSAGE = "The summary breaks the summary rules."
OSM_NODE_ID_MESSAGE = "Enter a positive OpenStreetMap node id."
WIKIDATA_MESSAGE = "Use the Wikidata item id, such as Q39739."
PUBLIC_LINK_MESSAGE = "Use an https:// link."
AUTHOR_REQUIRED = "Enter the author of the photograph."
LICENSE_NAME_BLANK = "Leave the license empty instead of blank."
LICENSE_NAME_FOR_URL = "Add the license name of this license URL."
PHOTOGRAPH_REQUIRED = "Choose a photograph."
NO_PHOTOGRAPH_TO_REVIEW = "This mountain has no photograph yet. Choose a file."
REMOVE_AND_REPLACE = "Remove the photograph or choose a new file, not both."
CREDIT_NOT_REVIEWED = (
    "The author and license are those of the photograph being replaced. Update them, or confirm "
    "that they also describe the new photograph."
)
SLUG_TAKEN = "Another mountain already uses this slug."
CONTINENT_UNKNOWN = "This continent is not in the reference data. Reload the page and choose again."
REGION_UNKNOWN = "This region no longer exists. Reload the page and choose again."
COUNTRIES_UNKNOWN = "A selected country is not in the reference data: {}."
PHOTOGRAPH_REJECTED = "The photograph was rejected."
PHOTOGRAPH_NOT_STORED = "The photograph could not be stored. Nothing was saved; try again."
ACTIVE_LOCATION_LOCKED = (
    "A published mountain's coordinates cannot change, because its public camera is composed on "
    "them. Unlist the mountain first, then change the coordinates and set the camera again."
)
CAMERA_RESET_REQUIRED = (
    "Changing the coordinates clears the saved camera. Tick this box to confirm, or restore the "
    "saved coordinates."
)
SLUG_CHANGES_PUBLIC_ADDRESS = (
    "This mountain is on the site. Changing the slug changes its public address, and links to the "
    "old address stop working."
)

SUMMARY_MESSAGES = {
    SummaryViolation.BLANK: "Leave the summary empty instead of blank.",
    SummaryViolation.NOT_TRIMMED: "Remove the spaces around the summary.",
    SummaryViolation.CONTROL_CHARACTER: "The summary must be one line without control characters.",
    SummaryViolation.HIDDEN_CHARACTER: "Remove the zero-width space or byte order mark.",
    SummaryViolation.TOO_LONG: f"The summary has at most {SUMMARY_MAX_LENGTH} characters.",
    SummaryViolation.MARKUP: "The summary has no markup: no <, >, backtick, ]( or &entity;.",
    SummaryViolation.NOT_SENTENCE_FORM: (
        "Write the summary in sentence form: a capitalized first word and a final period."
    ),
}

PHOTOGRAPH_REJECTION_MESSAGES = {
    PhotographRejection.TOO_MANY_PIXELS: "The photograph has too many pixels to be processed.",
    PhotographRejection.UNSUPPORTED_FORMAT: "Use a JPEG, PNG or WebP file.",
    PhotographRejection.NOT_AN_IMAGE: "The file is not an image. Use a JPEG, PNG or WebP file.",
    PhotographRejection.CORRUPT: "The file is damaged or incomplete.",
    PhotographRejection.ANIMATED: "Use a still photograph, not an animated image.",
}


def too_many_bytes(max_bytes: int) -> str:
    return f"The file is larger than {max_bytes // (1024 * 1024)} MiB."


# The form field that shows each violation of the mountain's own content.
MOUNTAIN_VIOLATION_FIELDS = {
    NewMountainViolation.SLUG_INVALID: ("slug", SLUG_MESSAGE),
    NewMountainViolation.NAME_BLANK: ("name", NAME_REQUIRED),
    NewMountainViolation.COORDINATES_OUT_OF_RANGE: ("latitude", LATITUDE_MESSAGE),
    NewMountainViolation.ELEVATION_NOT_POSITIVE: ("elevation_meters", ELEVATION_MESSAGE),
    NewMountainViolation.SUMMARY_INVALID: ("summary", SUMMARY_MESSAGE),
    NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE: ("osm_node_id", OSM_NODE_ID_MESSAGE),
    NewMountainViolation.WIKIDATA_ID_INVALID: ("wikidata_id", WIKIDATA_MESSAGE),
}
PHOTOGRAPH_VIOLATION_FIELDS = {
    NewMountainViolation.IMAGE_AUTHOR_MISSING: ("author", AUTHOR_REQUIRED),
    NewMountainViolation.IMAGE_LICENSE_NAME_BLANK: ("license_name", LICENSE_NAME_BLANK),
    NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: ("license_name", LICENSE_NAME_FOR_URL),
    NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK: ("license_url", PUBLIC_LINK_MESSAGE),
    NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK: (
        "source_page_url",
        PUBLIC_LINK_MESSAGE,
    ),
}
