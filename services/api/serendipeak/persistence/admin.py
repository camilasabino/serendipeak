import logging
import re
from dataclasses import dataclass, field

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation, ShowFacets
from django.contrib.admin.utils import unquote
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import router, transaction
from django.db.models.functions import Collate
from django.forms.models import BaseInlineFormSet
from django.http import Http404, HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.functional import cached_property
from django.utils.html import format_html, format_html_join
from django.utils.http import urlencode
from django.utils.text import capfirst
from django.views.decorators.http import require_http_methods, require_POST

from serendipeak.catalog import coordinates
from serendipeak.catalog.camera import camera_violations
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.change_mountain_location import ChangeMountainLocation
from serendipeak.catalog.create_mountain import CreateMountain
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.delete_draft_mountain import DeleteDraftMountain
from serendipeak.catalog.entities import (
    WIKIDATA_ID_PATTERN,
    Coordinates,
    MountainStatus,
)
from serendipeak.catalog.errors import (
    CameraChanged,
    CameraRejected,
    InvalidMountain,
    InvalidStatusTransition,
    LocationChanged,
    MountainHasNoPhotograph,
    MountainNotDraft,
    MountainReferenced,
    PhotographNotStored,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
    UnknownMountain,
)
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import (
    NewMountain,
    NewMountainViolation,
    NewPhotograph,
    PhotographCredit,
)
from serendipeak.catalog.public_link import is_public_link
from serendipeak.catalog.publication import (
    PublicationViolation,
    PublicLinkField,
    publication_violations,
    unsafe_public_links,
)
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.catalog.regions import PATH_SEPARATOR, UnknownRegion, regions_in_tree_order
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation
from serendipeak.catalog.slug import RESERVED_SLUGS, is_valid_slug
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH, SummaryViolation, summary_violations
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.errors import ApplicationError, InfrastructureError
from serendipeak.persistence.camera_editor_url import camera_editor_url
from serendipeak.persistence.mapping import (
    load_region_paths,
    to_camera,
    to_coordinates,
    to_mountain,
    to_region,
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
from serendipeak.studio.camera_confirmation import (
    CAMERA_CHANGED_MEANWHILE,
    CAMERA_LOCATION_CHANGED,
    CAMERA_UNREADABLE,
    CAMERA_VIOLATION_MESSAGES,
    CameraForm,
    LocationForm,
    camera_values,
    comparison_rows,
)

logger = logging.getLogger(__name__)

SAFE_METHODS = ("GET", "HEAD", "OPTIONS", "TRACE")
REFUSAL_ATTRIBUTE = "_save_refusal"

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

VIOLATION_MESSAGES = {
    PublicationViolation.SLUG_INVALID: "the slug is not valid",
    PublicationViolation.COORDINATES_OUT_OF_RANGE: "the coordinates are out of range",
    PublicationViolation.ELEVATION_NOT_POSITIVE: "the elevation is not positive",
    PublicationViolation.CAMERA_MISSING: "the camera is missing",
    PublicationViolation.CAMERA_OUT_OF_BOUNDS: "the camera is out of bounds",
    PublicationViolation.CAMERA_FRAMING_MISSING: "the camera framing is missing",
    PublicationViolation.CAMERA_FRAMING_OUT_OF_BOUNDS: "the camera framing is out of bounds",
    PublicationViolation.PRIMARY_IMAGE_MISSING: "the photograph is missing",
    PublicationViolation.IMAGE_MEDIA_MISSING: "the photograph file is not stored yet",
    PublicationViolation.IMAGE_AUTHOR_MISSING: "the photograph author is missing",
    PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: (
        "the photograph license URL needs the license name"
    ),
    PublicationViolation.IMAGE_DIMENSIONS_MISSING: "the photograph dimensions are missing",
    PublicationViolation.SUMMARY_INVALID: "the summary breaks the summary rules",
    PublicationViolation.LINK_NOT_HTTPS: "a public link does not use https://",
}
PUBLIC_LINK_LABELS = {
    PublicLinkField.IMAGE_SOURCE_PAGE_URL: "the photo page URL",
    PublicLinkField.IMAGE_LICENSE_URL: "the photograph license URL",
}
PUBLIC_LINK_MESSAGE = "Use an https:// link."

ACCEPTED_PHOTOGRAPH_TYPES = "image/jpeg,image/png,image/webp"
REJECTION_MESSAGES = {
    PhotographRejection.TOO_MANY_PIXELS: "The photograph has too many pixels to be processed.",
    PhotographRejection.UNSUPPORTED_FORMAT: "Use a JPEG, PNG or WebP file.",
    PhotographRejection.NOT_AN_IMAGE: "The file is not an image. Use a JPEG, PNG or WebP file.",
    PhotographRejection.CORRUPT: "The file is damaged or incomplete.",
    PhotographRejection.ANIMATED: "Use a still photograph, not an animated image.",
}
PHOTOGRAPH_REJECTED = "The photograph was rejected."
PHOTOGRAPH_NOT_PROCESSED = "The photograph could not be processed. Try again or use another file."
PHOTOGRAPH_NOT_STORED = "The photograph could not be stored. Nothing was saved; try again."
PHOTOGRAPH_NOT_STORED_TAG = "photograph-not-stored"
PHOTOGRAPH_REQUIRED = "Choose a photograph."
LICENSE_NAME_FOR_URL = "Add the license name of this license URL."
LICENSE_NAME_BLANK = "Leave the license empty instead of blank."
AUTHOR_REQUIRED = "Enter the author of the photograph."
NAME_REQUIRED = "Enter the name."
SLUG_MESSAGE = (
    "Use lowercase letters and digits separated by single hyphens; "
    f"{', '.join(sorted(RESERVED_SLUGS))} are reserved."
)
WIKIDATA_MESSAGE = "Use the Wikidata item id, such as Q39739."
COORDINATES_MESSAGE = "The coordinates are out of range."
ELEVATION_MESSAGE = "Enter a whole number of meters above zero."
SUMMARY_MESSAGE = "The summary breaks the summary rules."
OSM_NODE_ID_MESSAGE = "Enter a positive OpenStreetMap node id."
SLUG_TAKEN = "Another mountain already uses this slug."
CONTINENT_UNKNOWN = "This continent is not in the reference data. Reload the page and choose again."
REGION_UNKNOWN = "This region no longer exists. Reload the page and choose again."
COUNTRIES_UNKNOWN = "A selected country is not in the reference data: {}."
NO_PHOTOGRAPH_TO_REVIEW = "This mountain has no photograph yet. Choose a file."
MOUNTAIN_GONE = "{} no longer exists, so nothing was saved."
NOT_A_DRAFT = "{} is {} and only a draft can be deleted. Nothing was deleted."
DRAFT_REFERENCED = "{} was shown as the mountain of a day, so it cannot be deleted."
MOUNTAIN_REFERENCES = {
    NewMountainViolation.SLUG_INVALID: ("slug", SLUG_MESSAGE),
    NewMountainViolation.NAME_BLANK: ("name_en", NAME_REQUIRED),
    NewMountainViolation.COORDINATES_OUT_OF_RANGE: ("latitude", COORDINATES_MESSAGE),
    NewMountainViolation.ELEVATION_NOT_POSITIVE: ("elevation_meters", ELEVATION_MESSAGE),
    NewMountainViolation.SUMMARY_INVALID: ("summary_en", SUMMARY_MESSAGE),
    NewMountainViolation.OSM_NODE_ID_NOT_POSITIVE: ("osm_node_id", OSM_NODE_ID_MESSAGE),
    NewMountainViolation.WIKIDATA_ID_INVALID: ("wikidata_id", WIKIDATA_MESSAGE),
}
PHOTOGRAPH_REFERENCES = {
    NewMountainViolation.IMAGE_AUTHOR_MISSING: ("author", AUTHOR_REQUIRED),
    NewMountainViolation.IMAGE_LICENSE_NAME_BLANK: ("license_name", LICENSE_NAME_BLANK),
    NewMountainViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: ("license_name", LICENSE_NAME_FOR_URL),
    NewMountainViolation.IMAGE_LICENSE_URL_NOT_PUBLIC_LINK: ("license_url", PUBLIC_LINK_MESSAGE),
    NewMountainViolation.IMAGE_SOURCE_PAGE_URL_NOT_PUBLIC_LINK: (
        "source_page_url",
        PUBLIC_LINK_MESSAGE,
    ),
}
CREDIT_NOT_REVIEWED = (
    "The author and license are those of the photograph being replaced. Update them, or confirm "
    "that they also describe the new photograph."
)

CAMERA_RESET_LABEL = "Clear the camera if the coordinates change"
CAMERA_RESET_HELP = (
    "Tick it when you change the latitude or longitude. The saved camera is composed on the "
    "current location, so it is cleared with the move and has to be configured again in the "
    "camera editor. An active mountain cannot move: deactivate it first."
)
CAMERA_RESET_REQUIRED = (
    "Changing the coordinates clears the saved camera. Tick this box to confirm, or restore the "
    "saved coordinates."
)
ACTIVE_LOCATION_LOCKED = (
    "An active mountain's coordinates cannot change, because its public camera is composed on "
    "them. Deactivate the mountain first, then change the coordinates and configure the camera "
    "again."
)
COORDINATES_MOVED = (
    "The coordinates were saved and the camera was cleared, because it was composed on the old "
    "location. The camera must be configured again with the camera editor{}."
)
CAMERA_EDITOR_LABEL = "Edit camera visually"
CAMERA_LOG_MESSAGE = "Camera changed."
CAMERA_CLEARED_LOG_MESSAGE = "Camera cleared by a change of coordinates."
CAMERA_ANCHOR = "camera"

OPTIONAL_TEXT = ("summary_en",)
CAMERA_FIELDS = (
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
)
CAMERA_RESET_FIELD = "confirm_camera_reset"
IMAGE_CREDIT_FIELDS = ("author", "source_page_url")
IMAGE_LICENSE_FIELDS = ("license_name", "license_url")
IMAGE_FIELDS = (*IMAGE_CREDIT_FIELDS, *IMAGE_LICENSE_FIELDS)
IMAGE_OPTIONAL = ("source_page_url", *IMAGE_LICENSE_FIELDS)
IMAGE_LINKS = ("source_page_url", "license_url")
CAMERA_DIAGNOSTIC_FIELDS = (*CAMERA_FIELDS, "camera_check")
PHOTOGRAPH_DETAIL_FIELDS = ("photograph_dimensions", "stored_original")
PUBLIC_STATUS_VALUES = frozenset({MountainStatus.ACTIVE.value, MountainStatus.INACTIVE.value})
MOUNTAIN_FIELDS = ("name_en", "slug", "latitude", "longitude", "elevation_meters")
MOVABLE_MOUNTAIN_FIELDS = (
    "name_en",
    "slug",
    "latitude",
    "longitude",
    CAMERA_RESET_FIELD,
    "elevation_meters",
)
GEOGRAPHY_FIELDS = ("continent", "countries", "region")
READ_ONLY_GEOGRAPHY_FIELDS = ("continent", "countries", "region_path")
EDITORIAL_FIELDS = ("summary_en",)
ADDITIONAL_FIELDS = ("osm_node_id", "wikidata_id")
PUBLICATION_FIELDS = ("status", "created_at", "updated_at", "publication_readiness")
_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)


def _make_optional(form, names):
    for name in names:
        field = form.fields.get(name)
        if field is None:
            continue
        field.required = False
        if isinstance(field, forms.CharField):
            field.empty_value = None


TRANSITION_BY_STATUS = {
    MountainStatus.DRAFT.value: ("publish", "Publish"),
    MountainStatus.ACTIVE.value: ("deactivate", "Deactivate"),
    MountainStatus.INACTIVE.value: ("reactivate", "Reactivate"),
}
STORED_STATE_NOTICE = (
    "Publication checks the saved mountain, not unsaved changes in the form. Save your edits first."
)


def _single_line(*names):
    return {name: forms.TextInput(attrs={"size": 80}) for name in names}


def _summary_textarea():
    return forms.Textarea(attrs={"rows": 3, "cols": 80})


def _validate_public_link(value):
    if not is_public_link(value):
        raise ValidationError(PUBLIC_LINK_MESSAGE, code="public_link")


def _require_public_links(form, names):
    for name in names:
        if name in form.fields:
            form.fields[name].validators.append(_validate_public_link)


def violation_reasons(violations, mountain=None):
    reasons = []
    for violation in violations:
        if violation == PublicationViolation.LINK_NOT_HTTPS and mountain is not None:
            reasons.extend(
                f"{PUBLIC_LINK_LABELS[field]} does not use https://"
                for field in unsafe_public_links(mountain)
            )
        else:
            reasons.append(VIOLATION_MESSAGES[violation])

    return reasons


def _country_label(country):
    return f"{country.name_en} ({country.code})"


def _region_choices():
    """Every region in tree order, each labelled with its path, from one query."""
    records = list(MountainRegionRecord.objects.all())
    by_id = {record.id: record for record in records}
    ordered = regions_in_tree_order(to_region(record) for record in records)

    return [(by_id[region.id].pk, label) for region, label in ordered]


def _clean_summary(value):
    if value is None:
        return value
    violations = summary_violations(value)
    if violations:
        raise ValidationError([SUMMARY_MESSAGES[violation] for violation in violations])

    return value


@dataclass
class SaveRefusal:
    """What the write use cases refused when the form was saved, in the form's own words.

    Keys are field names; None is an error of the whole form (the mountain's) or of the whole
    photograph formset.
    """

    mountain: dict[str | None, list[str]] = field(default_factory=dict)
    photograph: dict[str | None, list[str]] = field(default_factory=dict)

    def apply_to_mountain(self, form):
        for name, messages_ in self.mountain.items():
            form.add_error(name, messages_)

    def apply_to_photograph(self, formset, form):
        for name, messages_ in self.photograph.items():
            if name is not None and form is not None:
                form.add_error(name, messages_)
        if None in self.photograph:
            raise ValidationError(self.photograph[None])


class _SaveRefused(Exception):
    def __init__(self, refusal: SaveRefusal):
        super().__init__("the write use case refused the form")
        self.refusal = refusal


class _SaveAbandoned(Exception):
    """A save that cannot be shown as form errors: the page is left with a message instead."""

    def __init__(self, message, *, level=messages.ERROR, tag="", to_changelist=False):
        super().__init__(message)
        self.message = message
        self.level = level
        self.tag = tag
        self.to_changelist = to_changelist


class _DeleteRefused(Exception):
    def __init__(self, message, *, to_changelist=False):
        super().__init__(message)
        self.message = message
        self.to_changelist = to_changelist


def _refusal_of(error) -> SaveRefusal | None:
    """The form errors that say why a use case refused a save; None for any other exception."""
    refusal = SaveRefusal()

    def refuse(target, name, message):
        target.setdefault(name, []).append(message)

    match error:
        case InvalidMountain():
            for violation in error.violations:
                if violation in MOUNTAIN_REFERENCES:
                    name, message = MOUNTAIN_REFERENCES[violation]
                    refuse(refusal.mountain, name, message)
                else:
                    name, message = PHOTOGRAPH_REFERENCES[violation]
                    refuse(refusal.photograph, name, message)
        case PublicationRejected():
            for reason in violation_reasons(error.violations):
                refuse(refusal.photograph, None, f"Not allowed on a published mountain: {reason}.")
        case SlugTaken():
            refuse(refusal.mountain, "slug", SLUG_TAKEN)
        case UnknownContinent():
            refuse(refusal.mountain, "continent", CONTINENT_UNKNOWN)
        case UnknownRegion():
            refuse(refusal.mountain, "region", REGION_UNKNOWN)
        case UnknownCountries():
            refuse(refusal.mountain, "countries", COUNTRIES_UNKNOWN.format(", ".join(error.codes)))
        case PhotographRejected():
            refuse(
                refusal.photograph,
                "photograph_file",
                REJECTION_MESSAGES.get(error.reason, PHOTOGRAPH_REJECTED),
            )
        case MountainHasNoPhotograph():
            refuse(refusal.photograph, "photograph_file", NO_PHOTOGRAPH_TO_REVIEW)
        case _:
            return None

    return refusal


class MountainForm(forms.ModelForm):
    latitude = forms.FloatField(
        help_text=f"Degrees, {coordinates.LATITUDE_MIN_DEGREES:g} to "
        f"{coordinates.LATITUDE_MAX_DEGREES:g}."
    )
    longitude = forms.FloatField(
        help_text=f"Degrees, {coordinates.LONGITUDE_MIN_DEGREES:g} to "
        f"{coordinates.LONGITUDE_MAX_DEGREES:g}."
    )
    confirm_camera_reset = forms.BooleanField(
        label=CAMERA_RESET_LABEL, required=False, help_text=CAMERA_RESET_HELP
    )
    elevation_meters = forms.IntegerField(min_value=1)
    osm_node_id = forms.IntegerField(required=False, min_value=1)
    wikidata_id = forms.CharField(required=False, empty_value=None)
    countries = forms.ModelMultipleChoiceField(
        queryset=CountryRecord.objects.order_by(Collate("name_en", "C"), "code"),
        required=False,
        widget=FilteredSelectMultiple("countries", is_stacked=False),
        help_text="A mountain may have none, for example while it is a new draft.",
    )

    refusal: "SaveRefusal | None" = None

    class Meta:
        model = MountainRecord
        fields = (
            "slug",
            "name_en",
            "elevation_meters",
            "continent",
            "region",
            "summary_en",
            "osm_node_id",
            "wikidata_id",
        )
        labels = {"name_en": "Name", "summary_en": "Summary"}
        widgets = {
            **_single_line("slug", "name_en"),
            "summary_en": _summary_textarea(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _make_optional(self, OPTIONAL_TEXT)

        # A user who cannot change the mountain gets a form without the model fields.
        continent = self.fields.get("continent")
        if continent is not None:
            continent.queryset = ContinentRecord.objects.order_by(Collate("name_en", "C"))
            continent.empty_label = "Select a continent"
            continent.help_text = (
                "The continent where the summit lies. It is chosen, never derived from the"
                " countries."
            )
        region = self.fields.get("region")
        if region is not None:
            region.required = False
            region.choices = [("", "No region"), *_region_choices()]
            region.help_text = (
                "The most specific region known, shown with the regions above it. The regions"
                " themselves cannot be edited here."
            )
        self.fields["countries"].label_from_instance = _country_label
        if not self.instance._state.adding:
            self.initial.setdefault(
                "countries", [link.country_id for link in self.instance.country_links.all()]
            )

        location = self.instance.location
        self.stored_coordinates: Coordinates | None = None
        if location is not None:
            self.initial.setdefault("latitude", location.y)
            self.initial.setdefault("longitude", location.x)
            self.stored_coordinates = to_coordinates(self.instance)
        if self.instance._state.adding:
            del self.fields[CAMERA_RESET_FIELD]

    @cached_property
    def changed_data(self):
        # The confirmation is not a value of the mountain, so the history does not list it.
        return [name for name in super().changed_data if name != CAMERA_RESET_FIELD]

    def clean_slug(self):
        slug = self.cleaned_data["slug"]
        if not is_valid_slug(slug):
            raise ValidationError(SLUG_MESSAGE)

        return slug

    def clean_summary_en(self):
        return _clean_summary(self.cleaned_data.get("summary_en"))

    def clean_wikidata_id(self):
        wikidata_id = self.cleaned_data.get("wikidata_id")
        if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
            raise ValidationError(WIKIDATA_MESSAGE)

        return wikidata_id

    def clean_latitude(self):
        latitude = self.cleaned_data["latitude"]
        if not coordinates.LATITUDE_MIN_DEGREES <= latitude <= coordinates.LATITUDE_MAX_DEGREES:
            raise ValidationError(
                f"Latitude is between {coordinates.LATITUDE_MIN_DEGREES:g} and "
                f"{coordinates.LATITUDE_MAX_DEGREES:g} degrees."
            )

        return latitude

    def clean_longitude(self):
        longitude = self.cleaned_data["longitude"]
        if not coordinates.LONGITUDE_MIN_DEGREES <= longitude <= coordinates.LONGITUDE_MAX_DEGREES:
            raise ValidationError(
                f"Longitude is between {coordinates.LONGITUDE_MIN_DEGREES:g} and "
                f"{coordinates.LONGITUDE_MAX_DEGREES:g} degrees."
            )

        return longitude

    def clean(self):
        cleaned = super().clean()
        if self.refusal is not None:
            self.refusal.apply_to_mountain(self)

        if "latitude" not in cleaned or "longitude" not in cleaned:
            return cleaned

        requested = Coordinates(latitude=cleaned["latitude"], longitude=cleaned["longitude"])
        self._judge_relocation(requested, cleaned)

        return cleaned

    def _judge_relocation(self, requested, cleaned):
        # The change view holds the row lock from before this form is built, so the stored
        # coordinates and status are the ones the save is then judged on. The use case judges
        # them again under its own lock for callers that hold none.
        if self.stored_coordinates is None:
            return

        outcome = judge_relocation(
            MountainStatus(self.instance.status),
            self.stored_coordinates,
            requested,
            bool(cleaned.get(CAMERA_RESET_FIELD)),
        )
        match outcome:
            case RelocationOutcome.ACTIVE_MOUNTAIN:
                for field, stored in (
                    ("latitude", self.stored_coordinates.latitude),
                    ("longitude", self.stored_coordinates.longitude),
                ):
                    if cleaned[field] != stored:
                        self.add_error(field, ACTIVE_LOCATION_LOCKED)
            case RelocationOutcome.CONFIRMATION_REQUIRED:
                self.add_error(CAMERA_RESET_FIELD, CAMERA_RESET_REQUIRED)


class PhotographFileInput(forms.FileInput):
    """The file input with the saved photograph and the selected one side by side.

    The selected photograph is previewed in the browser, from the chosen file, and the button
    next to it drops the choice. The script behind it also keeps the file through a refused
    submission, which a file input cannot do by itself.
    """

    def __init__(self, attrs=None):
        super().__init__(
            attrs={"accept": ACCEPTED_PHOTOGRAPH_TYPES, "data-photograph-file": "", **(attrs or {})}
        )
        self.saved_url = None

    def render(self, name, value, attrs=None, renderer=None):
        saved = (
            format_html(
                '<figure class="photograph-figure"><img class="photograph-preview" src="{}" '
                'alt="Saved photograph"><figcaption>Saved photograph</figcaption></figure>',
                self.saved_url,
            )
            if self.saved_url
            else ""
        )
        caption = (
            "Selected photograph, not saved yet. Saving replaces the saved one."
            if self.saved_url
            else "Selected photograph, not saved yet."
        )
        selected = format_html(
            '<figure class="photograph-figure" data-photograph-selected hidden>'
            '<img class="photograph-preview" alt="Selected photograph" data-photograph-preview>'
            "<figcaption>{} "
            '<button type="button" class="button" data-photograph-cancel>Cancel</button>'
            "</figcaption></figure>",
            caption,
        )

        return format_html(
            '<div class="photograph-upload">{}{}{}</div>',
            saved,
            selected,
            super().render(name, value, attrs, renderer),
        )


class MountainImageForm(forms.ModelForm):
    photograph_file = forms.FileField(
        label="Photograph",
        required=False,
        widget=PhotographFileInput,
        help_text=(
            "A JPEG, PNG or WebP file. Visitors get resized copies without the file's metadata."
        ),
    )
    credit_reviewed = forms.BooleanField(
        label="The author and license also describe the new photograph",
        required=False,
        help_text="Needed only when they have not changed.",
    )

    class Meta:
        model = MountainImageRecord
        fields = IMAGE_FIELDS
        labels = {
            "author": "Author",
            "source_page_url": "Photo page URL",
            "license_name": "License",
            "license_url": "License URL",
        }
        help_texts = {
            "author": "The credit shown to visitors: the photographer or rights holder.",
            "source_page_url": (
                "Optional. The page where the photograph is published. The credit links to it."
            ),
            "license_name": (
                "Optional. The license the photograph is used under. Publish only photographs "
                "you have the right to use."
            ),
            "license_url": "Optional. Needs the license name.",
        }
        widgets = _single_line(*IMAGE_FIELDS)

    def __init__(self, *args, ingestion: PhotographIngestion, media_base_url: str, **kwargs):
        super().__init__(*args, **kwargs)
        self._ingestion = ingestion
        self.photograph_data: bytes | None = None
        _make_optional(self, IMAGE_OPTIONAL)
        _require_public_links(self, IMAGE_LINKS)

        photograph_file = self.fields["photograph_file"]
        if not self.instance._state.adding:
            photograph_file.help_text = (
                "Leave it empty to keep the saved photograph. A new file replaces it, and its "
                "author and license have to be reviewed."
            )
            if self.instance.page_key is not None:
                photograph_file.widget.saved_url = public_url(
                    media_base_url, self.instance.page_key
                )

    def clean_photograph_file(self):
        upload = self.cleaned_data.get("photograph_file")
        if upload is None:
            return None

        # The size is known before reading: a large upload is streamed to a temporary file.
        max_bytes = self._ingestion.limits.max_bytes
        if upload.size > max_bytes:
            raise ValidationError(_too_many_bytes(max_bytes), code="too_many_bytes")

        # A save the use case then refuses validates the same request a second time.
        upload.seek(0)
        data = upload.read()
        try:
            # Only the verdict is wanted: the use case prepares the file again when it saves.
            # Asking here keeps a rejected or unreadable file a field error, shown together with
            # the other fields' errors.
            self._ingestion.prepare(data)
        except PhotographRejected as rejected:
            message = (
                _too_many_bytes(max_bytes)
                if rejected.reason is PhotographRejection.TOO_MANY_BYTES
                else REJECTION_MESSAGES.get(rejected.reason, PHOTOGRAPH_REJECTED)
            )
            raise ValidationError(message, code=rejected.reason.value) from rejected
        except InfrastructureError as error:
            logger.exception("An uploaded photograph could not be processed")
            raise ValidationError(PHOTOGRAPH_NOT_PROCESSED, code="not_processed") from error

        self.photograph_data = data

        return upload

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("license_url") is not None and cleaned.get("license_name") is None:
            if "license_name" not in self.errors:
                self.add_error("license_name", LICENSE_NAME_FOR_URL)

        if self.photograph_data is not None:
            self._require_credit_review(cleaned)

        return cleaned

    def _require_credit_review(self, cleaned):
        if self.instance._state.adding or cleaned.get("credit_reviewed"):
            return

        unchanged = all(
            (cleaned.get(name) or None) == (self.initial.get(name) or None) for name in IMAGE_FIELDS
        )
        if unchanged:
            self.add_error("credit_reviewed", CREDIT_NOT_REVIEWED)


def _too_many_bytes(max_bytes):
    return f"The file is larger than {max_bytes // (1024 * 1024)} MiB."


class MountainImageFormSet(BaseInlineFormSet):
    """Reads the photograph an editor chose or the credit an editor changed. It writes nothing:
    the mountain use cases own the photograph record."""

    def __init__(self, *args, refusal: SaveRefusal | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._refusal = refusal

    def clean(self):
        super().clean()
        if self._refusal is not None:
            self._refusal.apply_to_photograph(self, self.forms[0] if self.forms else None)

    def removes_photograph(self) -> bool:
        return bool(self.deleted_forms)

    def change(self) -> NewPhotograph | PhotographCredit | None:
        """The upload with its credit, the credit alone, or None when the photograph stays."""
        for form in self.forms:
            if form in self.deleted_forms or not form.has_changed():
                continue

            cleaned = form.cleaned_data
            credit = PhotographCredit(
                author=cleaned["author"],
                license_name=cleaned.get("license_name"),
                license_url=cleaned.get("license_url"),
                source_page_url=cleaned.get("source_page_url"),
            )
            if form.photograph_data is None:
                return credit

            return NewPhotograph(
                data=form.photograph_data,
                author=credit.author,
                license_name=credit.license_name,
                license_url=credit.license_url,
                source_page_url=credit.source_page_url,
            )

        return None

    def note_saved(self):
        """Fill in what the admin's history message reads from a saved formset."""
        self.new_objects, self.changed_objects, self.deleted_objects = [], [], []
        for form in self.forms:
            if form in self.deleted_forms:
                self.deleted_objects.append(form.instance)
                continue
            if not form.has_changed():
                continue
            if form in self.initial_forms:
                self.changed_objects.append((form.instance, form.changed_data))
            else:
                self.new_objects.append(form.instance)


def _stored_image(mountain):
    if mountain is None:
        return None
    try:
        return mountain.image
    except MountainImageRecord.DoesNotExist:
        return None


class MountainImageInline(admin.StackedInline):
    model = MountainImageRecord
    form = MountainImageForm
    formset = MountainImageFormSet
    verbose_name = "photograph"
    max_num = 1
    can_delete = True

    class Media:
        js = ("serendipeak/admin/photograph-upload.js",)

    def get_fieldsets(self, request, obj=None):
        image = _stored_image(obj)
        if not self.has_change_permission(request, obj):
            # The upload and review fields are form-only; a read-only user has no form fields.
            main = ["saved_photograph", *IMAGE_CREDIT_FIELDS]
        else:
            main = ["photograph_file", *IMAGE_CREDIT_FIELDS]
            if image is not None:
                main.append("credit_reviewed")
        fieldsets = [
            (None, {"fields": main}),
            ("License", {"fields": IMAGE_LICENSE_FIELDS}),
        ]
        if image is not None:
            fieldsets.append(
                (
                    "Technical details",
                    {"fields": PHOTOGRAPH_DETAIL_FIELDS, "classes": ("collapse",)},
                )
            )

        return fieldsets

    def get_readonly_fields(self, request, obj=None):
        if _stored_image(obj) is None:
            return ()

        return PHOTOGRAPH_DETAIL_FIELDS + ("saved_photograph",)

    @admin.display(description="Photograph")
    def saved_photograph(self, image):
        if image.page_key is None:
            return "No photograph stored"

        return format_html(
            '<figure class="photograph-figure"><img class="photograph-preview" src="{}" '
            'alt="Saved photograph"></figure>',
            public_url(self.media_base_url, image.page_key),
        )

    @admin.display(description="Dimensions")
    def photograph_dimensions(self, image):
        if image.width is None:
            return "Unknown"

        return f"{image.width} × {image.height} pixels"

    @admin.display(description="Stored original (SHA-256)")
    def stored_original(self, image):
        if image.original_sha256 is None:
            return "Not stored yet"

        return format_html(
            '<code title="{}">{}…</code>', image.original_sha256, image.original_sha256[:12]
        )

    def has_view_permission(self, request, obj=None):
        return request.user.has_perm("catalog.view_mountainrecord")

    def has_add_permission(self, request, obj=None):
        return request.user.has_perm("catalog.add_mountainrecord")

    def has_change_permission(self, request, obj=None):
        return request.user.has_perm("catalog.change_mountainrecord")

    def has_delete_permission(self, request, obj=None):
        # Only a draft can lose its photograph: a published mountain has to keep one.
        return (
            obj is not None
            and obj.status == MountainStatus.DRAFT.value
            and request.user.has_perm("catalog.delete_mountainrecord")
        )


class MountainAdmin(admin.ModelAdmin):
    publish_mountain: PublishMountain
    deactivate_mountain: DeactivateMountain
    reactivate_mountain: ReactivateMountain
    change_mountain_camera: ChangeMountainCamera
    change_mountain_location: ChangeMountainLocation
    create_mountain: CreateMountain
    update_mountain: UpdateMountain
    delete_draft_mountain: DeleteDraftMountain
    photograph_ingestion: PhotographIngestion
    media_base_url: str
    web_origin: str

    show_facets = ShowFacets.ALWAYS
    list_display = (
        "english_name",
        "slug",
        "status",
        "continent",
        "country_codes",
        "elevation_meters",
        "region_label",
        "updated_at",
    )
    list_filter = ("status",)
    search_fields = ("name_en", "slug", "region__name_en", "country_links__country__name_en")
    ordering = ("slug",)
    form = MountainForm
    inlines = [MountainImageInline]
    actions = ["publish_selected", "deactivate_selected", "reactivate_selected"]

    class Media:
        css = {"all": ("serendipeak/admin/editorial.css",)}

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return ()

        return (*PUBLICATION_FIELDS, *CAMERA_DIAGNOSTIC_FIELDS)

    def get_fieldsets(self, request, obj=None):
        movable = obj is not None and self.has_change_permission(request, obj)
        mountain = ("Mountain", {"fields": MOVABLE_MOUNTAIN_FIELDS if movable else MOUNTAIN_FIELDS})
        # A model field always wins over a method of the same name, so a user who cannot change
        # the mountain reads the region through a method with another name.
        editable = obj is None or self.has_change_permission(request, obj)
        geography = (
            "Geography",
            {"fields": GEOGRAPHY_FIELDS if editable else READ_ONLY_GEOGRAPHY_FIELDS},
        )
        editorial = ("Editorial", {"fields": EDITORIAL_FIELDS})
        additional = ("Additional data", {"fields": ADDITIONAL_FIELDS, "classes": ("collapse",)})
        if obj is None:
            return [mountain, geography, editorial, additional]

        publication = ("Publication", {"fields": PUBLICATION_FIELDS})
        camera_diagnostics = (
            "Camera",
            {
                "fields": CAMERA_DIAGNOSTIC_FIELDS,
                "description": self._camera_description(request, obj),
            },
        )

        return [publication, mountain, geography, editorial, camera_diagnostics, additional]

    def get_queryset(self, request):
        # The region and its parent are joined here, not through list_select_related, which the
        # changelist ignores once the queryset already selects the continent.
        return with_geography(super().get_queryset(request)).select_related("region__parent")

    @admin.display(description="Name", ordering="name_en")
    def english_name(self, obj):
        return obj.name_en

    @admin.display(description="Region", ordering="region__name_en")
    def region_label(self, obj):
        region = obj.region
        if region is None:
            return "-"

        return (
            region.name_en
            if region.parent is None
            else f"{region.name_en}, {region.parent.name_en}"
        )

    @admin.display(description="Region")
    def region_path(self, obj):
        # What a user who cannot change the mountain sees in place of the selection.
        path = load_region_paths([obj]).get(obj.region_id)
        if path is None:
            return "None"

        return PATH_SEPARATOR.join(ref.name.en for ref in (*path.ancestors, path.region))

    @admin.display(description="Countries")
    def country_codes(self, obj):
        return ", ".join(sorted(link.country_id for link in obj.country_links.all()))

    @admin.display(description="Countries")
    def countries(self, obj):
        # What a user who cannot change the mountain sees in place of the selection.
        links = sorted(
            obj.country_links.all(), key=lambda link: (link.country.name_en, link.country_id)
        )

        return ", ".join(_country_label(link.country) for link in links) or "None"

    def _saved_mountain(self, request, obj):
        # A change that failed validation leaves its unsaved values on the instance. The editor
        # opens on the saved ones, because the camera it proposes is compared with the saved
        # coordinates when it is stored.
        if request.method in SAFE_METHODS:
            return obj

        return MountainRecord.objects.get(pk=obj.pk)

    def _camera_editor_tool(self, request, obj):
        if obj is None or not self.has_change_permission(request, obj):
            return {}

        return {
            "camera_editor_url": camera_editor_url(
                self.web_origin, self._saved_mountain(request, obj)
            ),
            "camera_editor_label": CAMERA_EDITOR_LABEL,
        }

    def _camera_description(self, request, obj):
        description = format_html(
            '<span id="{}"></span>Read-only. The camera is changed only through its '
            "confirmation page, never by this form.",
            CAMERA_ANCHOR,
        )
        if not self.has_change_permission(request, obj):
            return description

        return format_html(
            '{} <a href="{}" rel="noreferrer">{}</a>',
            description,
            camera_editor_url(self.web_origin, self._saved_mountain(request, obj)),
            CAMERA_EDITOR_LABEL,
        )

    @admin.display(description="Publication readiness")
    def publication_readiness(self, obj):
        if obj.status != MountainStatus.DRAFT.value:
            return "Not applicable: only a draft is checked before publishing."

        mountain = to_mountain(obj)
        violations = publication_violations(mountain)
        if not violations:
            return format_html("Ready to publish. {}", STORED_STATE_NOTICE)

        reasons = format_html_join(
            "", "<li>{}</li>", ((capfirst(r),) for r in violation_reasons(violations, mountain))
        )

        return format_html(
            "<p>Not ready to publish. {}</p><ul>{}</ul>", STORED_STATE_NOTICE, reasons
        )

    @admin.display(description="Check")
    def camera_check(self, obj):
        camera = to_camera(obj)
        if camera is None:
            return "No camera yet. A mountain is published only with one."

        violations = camera_violations(camera)
        if not violations:
            return "Complete and within bounds."

        return format_html_join(
            "", "<p>{}</p>", ((CAMERA_VIOLATION_MESSAGES[v],) for v in violations)
        )

    def get_urls(self):
        transition = path(
            "<path:object_id>/transition/<str:kind>/",
            self.admin_site.admin_view(require_POST(self.transition_view)),
            name=f"{self.opts.app_label}_{self.opts.model_name}_transition",
        )
        camera = path(
            "<path:object_id>/camera/",
            self.admin_site.admin_view(require_http_methods(["GET", "POST"])(self.camera_view)),
            name=f"{self.opts.app_label}_{self.opts.model_name}_camera",
        )

        return [transition, camera, *super().get_urls()]

    def camera_view(self, request, object_id):
        if not self.has_change_permission(request):
            raise PermissionDenied
        record = self.get_object(request, unquote(object_id))
        if record is None:
            raise Http404

        if request.method == "POST":
            return self._save_camera(request, record)

        # Showing the confirmation never writes: only its CSRF-protected POST does.
        return self._camera_confirmation(
            request, record, CameraForm(request.GET), LocationForm(request.GET)
        )

    def _save_camera(self, request, record):
        proposed = CameraForm(request.POST)
        expected = CameraForm(request.POST, prefix="expected", absent_allowed=True)
        composed_on = LocationForm(request.POST)
        if not (proposed.is_valid() and expected.is_valid() and composed_on.is_valid()):
            return self._camera_confirmation(request, record, proposed, composed_on, readable=False)

        try:
            self.change_mountain_camera.execute(
                record.pk, proposed.camera(), expected.camera(), composed_on.coordinates()
            )
        except CameraRejected:
            return self._camera_confirmation(request, record, proposed, composed_on)
        except LocationChanged:
            moved = self.get_object(request, str(record.pk))
            if moved is None:
                raise Http404 from None
            return self._stale_location(request, moved)
        except CameraChanged:
            self.message_user(request, CAMERA_CHANGED_MEANWHILE, messages.WARNING)
            carried = {**proposed.cleaned_data, **composed_on.cleaned_data}
            query = urlencode({name: repr(value) for name, value in carried.items()})
            return HttpResponseRedirect(f"{self._url('camera', record)}?{query}")
        except UnknownMountain as unknown:
            raise Http404 from unknown

        self.log_change(request, record, CAMERA_LOG_MESSAGE)
        self.message_user(request, f"The camera of {record.name_en} was changed.", messages.SUCCESS)

        return HttpResponseRedirect(f"{self._url('change', record)}#{CAMERA_ANCHOR}")

    def _stale_location(self, request, record):
        coordinates_now = to_coordinates(record)
        context = {
            **self.admin_site.each_context(request),
            "title": f"Change the camera of {record.name_en}",
            "opts": self.opts,
            "original": record,
            "change_url": self._url("change", record),
            "editor_url": camera_editor_url(self.web_origin, record),
            "stale_location": (
                f"{CAMERA_LOCATION_CHANGED} Its coordinates are now "
                f"{coordinates_now.latitude!r}, {coordinates_now.longitude!r}."
            ),
        }

        return TemplateResponse(
            request,
            "admin/catalog/mountainrecord/camera_confirmation.html",
            context,
            status=409,
        )

    def _camera_confirmation(self, request, record, proposed_form, location_form, readable=True):
        readable = readable and proposed_form.is_valid() and location_form.is_valid()
        if readable and location_form.coordinates() != to_coordinates(record):
            return self._stale_location(request, record)

        current = to_camera(record)
        proposed = proposed_form.camera() if readable else None
        violations = () if proposed is None else camera_violations(proposed)
        savable = proposed is not None and not violations

        context = {
            **self.admin_site.each_context(request),
            "title": f"Change the camera of {record.name_en}",
            "opts": self.opts,
            "original": record,
            "change_url": self._url("change", record),
            "editor_url": camera_editor_url(self.web_origin, record, proposed),
            "is_public": record.status in PUBLIC_STATUS_VALUES,
            "unreadable": proposed is None,
            "unreadable_message": CAMERA_UNREADABLE,
            "rows": comparison_rows(current, proposed),
            "problems": [CAMERA_VIOLATION_MESSAGES[violation] for violation in violations],
            "proposed_form": CameraForm(initial=camera_values(proposed)) if savable else None,
            "expected_form": CameraForm(
                prefix="expected", absent_allowed=True, initial=camera_values(current)
            )
            if savable
            else None,
            "location_form": LocationForm(
                initial={
                    "lat": location_form.cleaned_data["lat"],
                    "lon": location_form.cleaned_data["lon"],
                }
            )
            if savable
            else None,
        }

        return TemplateResponse(
            request,
            "admin/catalog/mountainrecord/camera_confirmation.html",
            context,
            status=200 if savable else 400,
        )

    def _url(self, view, record):
        return reverse(
            f"admin:{self.opts.app_label}_{self.opts.model_name}_{view}", args=[record.pk]
        )

    def transition_view(self, request, object_id, kind):
        if not self.has_publish_permission(request):
            raise PermissionDenied
        use_case = self._use_cases().get(kind)
        if use_case is None:
            raise Http404
        record = self.get_object(request, object_id)
        if record is None:
            raise Http404

        queryset = MountainRecord.objects.filter(pk=record.pk)
        use_case, past_tense = use_case
        done = self._transition(request, queryset, use_case, past_tense)
        if not done:
            self.message_user(request, STORED_STATE_NOTICE, messages.INFO)

        return HttpResponseRedirect(
            reverse(f"admin:{self.opts.app_label}_{self.opts.model_name}_change", args=[record.pk])
        )

    def _use_cases(self):
        return {
            "publish": (self.publish_mountain, "published"),
            "deactivate": (self.deactivate_mountain, "deactivated"),
            "reactivate": (self.reactivate_mountain, "reactivated"),
        }

    def render_change_form(self, request, context, add=False, change=False, form_url="", obj=None):
        offered = TRANSITION_BY_STATUS.get(obj.status) if obj is not None else None
        if offered and self.has_publish_permission(request):
            kind, label = offered
            context["publication_transition"] = {
                "label": label,
                "url": reverse(
                    f"admin:{self.opts.app_label}_{self.opts.model_name}_transition",
                    args=[obj.pk, kind],
                ),
            }

        context.update(self._camera_editor_tool(request, obj))

        return super().render_change_form(request, context, add, change, form_url, obj)

    def get_inline_instances(self, request, obj=None):
        instances = super().get_inline_instances(request, obj)
        for inline in instances:
            inline.media_base_url = self.media_base_url

        return instances

    def get_formset_kwargs(self, request, obj, inline, prefix):
        return {
            **super().get_formset_kwargs(request, obj, inline, prefix),
            "form_kwargs": {
                "ingestion": self.photograph_ingestion,
                "media_base_url": self.media_base_url,
            },
            "refusal": getattr(request, REFUSAL_ATTRIBUTE, None),
        }

    def get_form(self, request, obj=None, change=False, **kwargs):
        form = super().get_form(request, obj, change=change, **kwargs)
        refusal = getattr(request, REFUSAL_ATTRIBUTE, None)
        if refusal is None:
            return form

        return type(form.__name__, (form,), {"refusal": refusal})

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        # Django runs a mutating change view inside one transaction, and the use cases join it.
        # An exception leaves it, so whatever an earlier step wrote rolls back with the step
        # that failed.
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except _SaveRefused as refused:
            # The use case judged the saved state, which no form check could. The page is shown
            # again from the same request with the refusal as form errors, so what was typed is
            # kept.
            setattr(request, REFUSAL_ATTRIBUTE, refused.refusal)

            return super().changeform_view(request, object_id, form_url, extra_context)
        except _SaveAbandoned as abandoned:
            # The tag lets the page's script give the chosen file back, since a redirect
            # re-renders the form from the saved data.
            self.message_user(request, abandoned.message, abandoned.level, extra_tags=abandoned.tag)
            target = (
                reverse(f"admin:{self.opts.app_label}_{self.opts.model_name}_changelist")
                if abandoned.to_changelist
                else request.get_full_path()
            )

            return HttpResponseRedirect(target)

    def save_model(self, request, obj, form, change):
        # Nothing is written here: the mountain row, its countries and its photograph are one
        # write of one use case, and save_related is the first hook that sees the photograph form.
        pass

    def save_related(self, request, form, formsets, change):
        (images,) = formsets
        try:
            if change:
                self._update(request, form, images)
            else:
                self._create(form, images)
        except PhotographNotStored as error:
            logger.exception("An uploaded photograph could not be stored")
            raise _SaveAbandoned(PHOTOGRAPH_NOT_STORED, tag=PHOTOGRAPH_NOT_STORED_TAG) from error
        except UnknownMountain as error:
            raise _SaveAbandoned(
                MOUNTAIN_GONE.format(form.instance.slug), to_changelist=True
            ) from error
        except ApplicationError as error:
            refusal = _refusal_of(error)
            if refusal is None:
                raise
            raise _SaveRefused(refusal) from error

        images.note_saved()

    def _create(self, form, images):
        cleaned = form.cleaned_data
        photograph = images.change()
        if isinstance(photograph, PhotographCredit):
            # A credit describes a file; without one there is nothing to credit.
            raise _SaveRefused(SaveRefusal(photograph={"photograph_file": [PHOTOGRAPH_REQUIRED]}))

        created = self.create_mountain.execute(
            NewMountain(
                slug=cleaned["slug"],
                name=cleaned["name_en"],
                coordinates=Coordinates(
                    latitude=cleaned["latitude"], longitude=cleaned["longitude"]
                ),
                elevation_meters=cleaned["elevation_meters"],
                continent_code=cleaned["continent"].pk,
                photograph=photograph,
                country_codes=tuple(country.pk for country in cleaned["countries"]),
                region_id=cleaned["region"].pk if cleaned["region"] else None,
                summary=cleaned["summary_en"],
                osm_node_id=cleaned["osm_node_id"],
                wikidata_id=cleaned["wikidata_id"],
            )
        )

        # The admin goes on to log and redirect with the instance it built, which now has its
        # identity.
        form.instance.pk = created.id
        form.instance._state.adding = False

    def _update(self, request, form, images):
        cleaned = form.cleaned_data
        obj = form.instance
        change = images.change()

        self.update_mountain.execute(
            obj.pk,
            MountainUpdate(
                slug=cleaned["slug"],
                name=cleaned["name_en"],
                elevation_meters=cleaned["elevation_meters"],
                continent_code=cleaned["continent"].pk,
                country_codes=tuple(country.pk for country in cleaned["countries"]),
                region_id=cleaned["region"].pk if cleaned["region"] else None,
                summary=cleaned["summary_en"],
                osm_node_id=cleaned["osm_node_id"],
                wikidata_id=cleaned["wikidata_id"],
                photograph=change if isinstance(change, NewPhotograph) else None,
                credit=change if isinstance(change, PhotographCredit) else None,
                remove_photograph=images.removes_photograph(),
            ),
        )

        self._move(request, obj, cleaned)

    def get_object(self, request, object_id, from_field=None):
        # Django opens the transaction of a mutating change or delete view before calling this,
        # and keeps it until the view returns. Locking here puts the row lock ahead of every
        # form, formset and permission decision and holds it through the image writes, which
        # is the order DjangoMountainStatusStore uses. A read-only request is not in a
        # transaction, where FOR UPDATE is an error. The lock is FOR NO KEY UPDATE: it still
        # conflicts with publication's FOR UPDATE and with itself, but not with the FOR KEY
        # SHARE a daily_discovery insert takes through its foreign key, so an upload that
        # waits on object storage cannot stall the public API.
        connection = transaction.get_connection(router.db_for_write(self.model))
        if request.method in SAFE_METHODS or not connection.in_atomic_block:
            return super().get_object(request, object_id, from_field)

        field = (
            self.model._meta.pk if from_field is None else self.model._meta.get_field(from_field)
        )
        queryset = self.get_queryset(request).select_for_update(of=("self",), no_key=True)
        try:
            return queryset.get(**{field.name: field.to_python(object_id)})
        except (MountainRecord.DoesNotExist, ValidationError, ValueError):
            return None

    def _move(self, request, obj, cleaned):
        # Inside the change view's transaction: a failure later in the same save, such as the
        # photograph that could not be stored, rolls the move and the cleared camera back too.
        outcome = self.change_mountain_location.execute(
            obj.pk,
            Coordinates(latitude=cleaned["latitude"], longitude=cleaned["longitude"]),
            camera_reset_confirmed=bool(cleaned.get(CAMERA_RESET_FIELD)),
        )
        if outcome is not RelocationOutcome.APPLIED:
            return

        self.log_change(request, obj, CAMERA_CLEARED_LOG_MESSAGE)
        editor = format_html(
            ' (<a href="{}" rel="noreferrer">{}</a>)',
            camera_editor_url(self.web_origin, MountainRecord.objects.get(pk=obj.pk)),
            CAMERA_EDITOR_LABEL,
        )
        self.message_user(request, format_html(COORDINATES_MOVED, editor), messages.WARNING)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and (
            obj is None or obj.status == MountainStatus.DRAFT.value
        )

    def get_deleted_objects(self, objs, request):
        # DeleteDraftMountain removes the photograph record and the country links with the
        # draft, so the collector, which would report them as protected, is not asked.
        (mountain,) = objs
        dependents = []
        if MountainImageRecord.objects.filter(pk=mountain.pk).exists():
            dependents.append("The record of its photograph")
        codes = sorted(
            MountainCountryRecord.objects.filter(mountain=mountain).values_list(
                "country_id", flat=True
            )
        )
        if codes:
            dependents.append(f"Its links to the countries {', '.join(codes)}")
        listed = [f"Mountain: {mountain}", dependents] if dependents else [f"Mountain: {mountain}"]

        return listed, {"mountains": 1}, set(), []

    def delete_view(self, request, object_id, extra_context=None):
        try:
            return super().delete_view(request, object_id, extra_context)
        except _DeleteRefused as refused:
            self.message_user(request, refused.message, messages.ERROR)
            name = "changelist" if refused.to_changelist else "change"
            args = [] if refused.to_changelist else [unquote(object_id)]

            return HttpResponseRedirect(
                reverse(f"admin:{self.opts.app_label}_{self.opts.model_name}_{name}", args=args)
            )

    def delete_model(self, request, obj):
        try:
            self.delete_draft_mountain.execute(obj.pk)
        except UnknownMountain as error:
            raise _DeleteRefused(MOUNTAIN_GONE.format(obj.slug), to_changelist=True) from error
        except MountainNotDraft as error:
            raise _DeleteRefused(NOT_A_DRAFT.format(obj.slug, error.status.value)) from error
        except MountainReferenced as error:
            raise _DeleteRefused(DRAFT_REFERENCED.format(obj.slug)) from error

    def has_publish_permission(self, request):
        return self.has_change_permission(request)

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        actions.pop("delete_selected", None)

        return actions

    @admin.action(description="Publish selected draft mountains", permissions=["publish"])
    def publish_selected(self, request, queryset):
        self._transition(request, queryset, self.publish_mountain, "published")

    @admin.action(description="Deactivate selected active mountains", permissions=["publish"])
    def deactivate_selected(self, request, queryset):
        self._transition(request, queryset, self.deactivate_mountain, "deactivated")

    @admin.action(description="Reactivate selected inactive mountains", permissions=["publish"])
    def reactivate_selected(self, request, queryset):
        self._transition(request, queryset, self.reactivate_mountain, "reactivated")

    def _transition(self, request, queryset, use_case, past_tense):
        done = 0

        for record in queryset.order_by("slug"):
            try:
                use_case.execute(record.id)
            except PublicationRejected as rejected:
                reasons = "; ".join(violation_reasons(rejected.violations, to_mountain(record)))
                self.message_user(
                    request, f"{record.slug} was not {past_tense}: {reasons}.", messages.ERROR
                )
            except InvalidStatusTransition as invalid:
                self.message_user(
                    request,
                    f"{record.slug} was not {past_tense}: it is {invalid.current.value}.",
                    messages.ERROR,
                )
            except UnknownMountain:
                self.message_user(
                    request,
                    f"{record.slug} was not {past_tense}: it no longer exists.",
                    messages.ERROR,
                )
            else:
                done += 1
                self.log_change(request, record, f"Status {past_tense}.")

        if done:
            self.message_user(request, f"{done} mountain(s) {past_tense}.", messages.SUCCESS)

        return done


class DailyDiscoveryAdmin(admin.ModelAdmin):
    list_display = ("date", "mountain", "created_at")
    list_select_related = ("mountain",)
    date_hierarchy = "date"
    ordering = ("-date",)
    search_fields = ("mountain__slug", "mountain__name_en")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
