import logging
import re

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation, ShowFacets
from django.contrib.admin.utils import unquote
from django.contrib.gis.geos import Point
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import router, transaction
from django.forms.models import BaseInlineFormSet
from django.http import Http404, HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join
from django.utils.http import urlencode
from django.utils.text import capfirst
from django.views.decorators.http import require_http_methods, require_POST

from serendipeak.catalog import camera as camera_bounds
from serendipeak.catalog import coordinates
from serendipeak.catalog.camera import CameraViolation, camera_violations
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.entities import (
    WIKIDATA_ID_PATTERN,
    CameraFraming,
    CanonicalCamera,
    MountainStatus,
    OsmType,
)
from serendipeak.catalog.errors import (
    CameraChanged,
    CameraRejected,
    InvalidStatusTransition,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    UnknownMountain,
)
from serendipeak.catalog.media.ingestion import PhotographIngestion, PreparedPhotograph
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.public_link import is_public_link
from serendipeak.catalog.publication import (
    PublicationViolation,
    PublicLinkField,
    publication_violations,
    unsafe_public_links,
)
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.catalog.slug import RESERVED_SLUGS, is_valid_slug
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH, SummaryViolation, summary_violations
from serendipeak.errors import InfrastructureError
from serendipeak.persistence.mapping import to_camera, to_mountain, to_mountain_with_image
from serendipeak.persistence.models import MountainImageRecord, MountainRecord

logger = logging.getLogger(__name__)

PUBLISH_PERMISSION = "catalog.publish_mountain"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS", "TRACE")

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
    PublicLinkField.WIKIPEDIA_URL: "the Wikipedia link",
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
CREDIT_NOT_REVIEWED = (
    "The author and license are those of the photograph being replaced. Update them, or confirm "
    "that they also describe the new photograph."
)

CAMERA_VIOLATION_MESSAGES = {
    CameraViolation.OUT_OF_BOUNDS: (
        f"The heading is from {camera_bounds.HEADING_MIN_DEGREES:g} to below "
        f"{camera_bounds.HEADING_MAX_DEGREES_EXCLUSIVE:g} degrees, the pitch from "
        f"{camera_bounds.PITCH_MIN_DEGREES:g} to {camera_bounds.PITCH_MAX_DEGREES:g} degrees and "
        f"the range from {camera_bounds.RANGE_MIN_METERS:g} to "
        f"{camera_bounds.RANGE_MAX_METERS:g} meters."
    ),
    CameraViolation.FRAMING_MISSING: "The framing is missing.",
    CameraViolation.FRAMING_OUT_OF_BOUNDS: (
        f"The framing x and y are from {camera_bounds.FRAMING_MIN:g} to "
        f"{camera_bounds.FRAMING_MAX:g}."
    ),
}
CAMERA_UNREADABLE = (
    "The camera to save could not be read. Open this page from the camera editor again."
)
CAMERA_CHANGED_MEANWHILE = (
    "The camera was changed by someone else after this page was opened. Nothing was saved; "
    "compare it with yours and confirm again."
)
CAMERA_LOG_MESSAGE = "Camera changed."
CAMERA_ANCHOR = "camera"

OPTIONAL_TEXT = ("range_name", "summary", "wikipedia_url")
CAMERA_FIELDS = (
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
)
IMAGE_CREDIT_FIELDS = ("author", "source_page_url")
IMAGE_LICENSE_FIELDS = ("license_name", "license_url")
IMAGE_FIELDS = (*IMAGE_CREDIT_FIELDS, *IMAGE_LICENSE_FIELDS)
IMAGE_OPTIONAL = ("source_page_url", *IMAGE_LICENSE_FIELDS)
IMAGE_LINKS = ("source_page_url", "license_url")
CAMERA_DIAGNOSTIC_FIELDS = (*CAMERA_FIELDS, "camera_check")
PHOTOGRAPH_DETAIL_FIELDS = ("photograph_dimensions", "stored_original")
PUBLIC_STATUS_VALUES = frozenset({MountainStatus.ACTIVE.value, MountainStatus.INACTIVE.value})
MOUNTAIN_FIELDS = ("name", "slug", "latitude", "longitude", "elevation_meters")
EDITORIAL_FIELDS = ("summary", "range_name", "countries")
ADDITIONAL_FIELDS = ("prominence_meters", "osm_type", "osm_id", "wikidata_id", "wikipedia_url")
PUBLICATION_FIELDS = ("status", "created_at", "updated_at", "publication_readiness")
COLUMN_OF_FORM_FIELD = {"latitude": "location", "longitude": "location"}
NEVER_FORM_WRITTEN = frozenset({"status", *CAMERA_FIELDS})
_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)


def _make_optional(form, names):
    for name in names:
        field = form.fields[name]
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


def violation_reasons(violations, mountain):
    reasons = []
    for violation in violations:
        if violation == PublicationViolation.LINK_NOT_HTTPS:
            reasons.extend(
                f"{PUBLIC_LINK_LABELS[field]} does not use https://"
                for field in unsafe_public_links(mountain)
            )
        else:
            reasons.append(VIOLATION_MESSAGES[violation])

    return reasons


def _clean_summary(value):
    if value is None:
        return value
    violations = summary_violations(value)
    if violations:
        raise ValidationError([SUMMARY_MESSAGES[violation] for violation in violations])

    return value


class MountainForm(forms.ModelForm):
    latitude = forms.FloatField(
        help_text=f"Degrees, {coordinates.LATITUDE_MIN_DEGREES:g} to "
        f"{coordinates.LATITUDE_MAX_DEGREES:g}."
    )
    longitude = forms.FloatField(
        help_text=f"Degrees, {coordinates.LONGITUDE_MIN_DEGREES:g} to "
        f"{coordinates.LONGITUDE_MAX_DEGREES:g}."
    )
    elevation_meters = forms.IntegerField(min_value=1)
    osm_type = forms.TypedChoiceField(
        required=False,
        empty_value=None,
        choices=[("", "---------"), *((osm.value, osm.value) for osm in OsmType)],
    )
    osm_id = forms.IntegerField(required=False, min_value=1)
    wikidata_id = forms.CharField(required=False, empty_value=None)

    class Meta:
        model = MountainRecord
        fields = (
            "slug",
            "name",
            "elevation_meters",
            "prominence_meters",
            "range_name",
            "countries",
            "summary",
            "wikipedia_url",
            "osm_type",
            "osm_id",
            "wikidata_id",
        )
        widgets = {
            **_single_line("slug", "name", "range_name", "wikipedia_url"),
            "summary": _summary_textarea(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _make_optional(self, (*OPTIONAL_TEXT, "prominence_meters", "countries"))
        _require_public_links(self, ("wikipedia_url",))

        location = self.instance.location
        if location is not None:
            self.initial.setdefault("latitude", location.y)
            self.initial.setdefault("longitude", location.x)

    def clean_slug(self):
        slug = self.cleaned_data["slug"]
        if not is_valid_slug(slug):
            reserved = ", ".join(sorted(RESERVED_SLUGS))
            raise ValidationError(
                f"Use lowercase letters and digits separated by single hyphens; {reserved} "
                "are reserved."
            )

        return slug

    def clean_summary(self):
        return _clean_summary(self.cleaned_data.get("summary"))

    def clean_wikidata_id(self):
        wikidata_id = self.cleaned_data.get("wikidata_id")
        if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
            raise ValidationError("Use the Wikidata item id, such as Q39739.")

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
        self._check_osm_reference(cleaned)

        if "latitude" in cleaned and "longitude" in cleaned:
            self.instance.location = Point(cleaned["longitude"], cleaned["latitude"], srid=4326)

        return cleaned

    def _check_osm_reference(self, cleaned):
        if "osm_type" in self.errors or "osm_id" in self.errors:
            return
        if (cleaned.get("osm_type") is None) != (cleaned.get("osm_id") is None):
            self.add_error("osm_id", "The OpenStreetMap type and id go together.")


class CameraForm(forms.Form):
    """A camera carried by the confirmation page: the proposed one, or the current one that it
    must still equal when the page is posted."""

    heading = forms.FloatField(widget=forms.HiddenInput)
    pitch = forms.FloatField(widget=forms.HiddenInput)
    range = forms.FloatField(widget=forms.HiddenInput)
    fx = forms.FloatField(widget=forms.HiddenInput)
    fy = forms.FloatField(widget=forms.HiddenInput)

    POSE = ("heading", "pitch", "range")
    FRAMING = ("fx", "fy")

    def __init__(self, *args, absent_allowed=False, **kwargs):
        super().__init__(*args, **kwargs)
        if absent_allowed:
            for field in self.fields.values():
                field.required = False

    def clean(self):
        cleaned = super().clean()
        present = {name for name in self.fields if cleaned.get(name) is not None}
        if not self.errors and present not in ({*self.POSE, *self.FRAMING}, set(self.POSE), set()):
            raise ValidationError("The camera is incomplete.", code="incomplete")

        return cleaned

    def camera(self) -> CanonicalCamera | None:
        values = self.cleaned_data
        if values.get("heading") is None:
            return None

        return CanonicalCamera(
            heading_degrees=values["heading"],
            pitch_degrees=values["pitch"],
            range_meters=values["range"],
            framing=None
            if values.get("fx") is None
            else CameraFraming(x=values["fx"], y=values["fy"]),
        )


def _camera_values(camera: CanonicalCamera | None) -> dict[str, float | None]:
    framing = None if camera is None else camera.framing

    return {
        "heading": None if camera is None else camera.heading_degrees,
        "pitch": None if camera is None else camera.pitch_degrees,
        "range": None if camera is None else camera.range_meters,
        "fx": None if framing is None else framing.x,
        "fy": None if framing is None else framing.y,
    }


CAMERA_ROW_LABELS = {
    "heading": "Heading (degrees)",
    "pitch": "Pitch (degrees)",
    "range": "Range (meters)",
    "fx": "Framing x",
    "fy": "Framing y",
}


def _camera_rows(current: CanonicalCamera | None, proposed: CanonicalCamera | None):
    current_values = _camera_values(current)
    proposed_values = _camera_values(proposed)

    return [
        {
            "label": label,
            "current": current_values[name],
            "proposed": proposed_values[name],
            "changed": current_values[name] != proposed_values[name],
        }
        for name, label in CAMERA_ROW_LABELS.items()
    ]


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
        self.prepared_photograph: PreparedPhotograph | None = None
        _make_optional(self, IMAGE_OPTIONAL)
        _require_public_links(self, IMAGE_LINKS)

        photograph_file = self.fields["photograph_file"]
        if self.instance._state.adding:
            photograph_file.required = True
        else:
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

        try:
            self.prepared_photograph = self._ingestion.prepare(upload.read())
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

        return upload

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("license_url") is not None and cleaned.get("license_name") is None:
            if "license_name" not in self.errors:
                self.add_error("license_name", LICENSE_NAME_FOR_URL)

        if self.prepared_photograph is not None:
            _use_photograph(self.instance, self.prepared_photograph)
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


def _use_photograph(image, prepared):
    # The formset judges this prospective instance, and nothing is stored until every form is
    # valid.
    media = prepared.media
    image.original_key = media.original_key
    image.original_sha256 = media.original_sha256
    image.page_key = media.page_key
    image.viewer_key = media.viewer_key
    image.width = prepared.dimensions.width
    image.height = prepared.dimensions.height


class MountainImageFormSet(BaseInlineFormSet):
    def clean(self):
        # The admin validates inline formsets after the mountain form has applied its cleaned
        # values to the locked instance, so this is the one point that sees the whole
        # prospective mountain: stored row, form changes and photograph.
        super().clean()
        if any(self.errors) or self.instance.status not in PUBLIC_STATUS_VALUES:
            return

        prospective = to_mountain_with_image(self.instance, self._prospective_image())
        violations = publication_violations(prospective)
        if violations:
            raise ValidationError(
                [
                    f"Not allowed on a published mountain: {reason}."
                    for reason in violation_reasons(violations, prospective)
                ]
            )

    def photographs_to_store(self) -> list[PreparedPhotograph]:
        return [
            form.prepared_photograph
            for form in self.forms
            if form.prepared_photograph is not None and not self._should_delete_form(form)
        ]

    def _prospective_image(self):
        image = None
        for form in self.forms:
            if self._should_delete_form(form):
                continue
            if form in self.initial_forms or form.has_changed():
                image = form.instance

        return image


def _stored_image(mountain):
    if mountain is None:
        return None
    try:
        return mountain.image
    except MountainImageRecord.DoesNotExist:
        return None


class _PhotographNotStored(Exception):
    pass


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
        return () if _stored_image(obj) is None else PHOTOGRAPH_DETAIL_FIELDS

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
    photograph_ingestion: PhotographIngestion
    media_base_url: str

    show_facets = ShowFacets.ALWAYS
    list_display = ("name", "slug", "status", "elevation_meters", "range_name", "updated_at")
    list_filter = ("status",)
    search_fields = ("name", "slug", "range_name")
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
        mountain = ("Mountain", {"fields": MOUNTAIN_FIELDS})
        editorial = ("Editorial", {"fields": EDITORIAL_FIELDS})
        additional = ("Additional data", {"fields": ADDITIONAL_FIELDS, "classes": ("collapse",)})
        if obj is None:
            return [mountain, editorial, additional]

        publication = ("Publication", {"fields": PUBLICATION_FIELDS})
        camera_diagnostics = (
            "Camera",
            {
                "fields": CAMERA_DIAGNOSTIC_FIELDS,
                "description": format_html(
                    '<span id="{}"></span>Read-only. The camera is changed only through its '
                    "confirmation page, never by this form.",
                    CAMERA_ANCHOR,
                ),
            },
        )

        return [publication, mountain, editorial, camera_diagnostics, additional]

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
        return self._camera_confirmation(request, record, CameraForm(request.GET))

    def _save_camera(self, request, record):
        proposed = CameraForm(request.POST)
        expected = CameraForm(request.POST, prefix="expected", absent_allowed=True)
        if not (proposed.is_valid() and expected.is_valid()):
            return self._camera_confirmation(request, record, proposed, readable=False)

        try:
            self.change_mountain_camera.execute(record.pk, proposed.camera(), expected.camera())
        except CameraRejected:
            return self._camera_confirmation(request, record, proposed)
        except CameraChanged:
            self.message_user(request, CAMERA_CHANGED_MEANWHILE, messages.WARNING)
            query = urlencode({name: repr(value) for name, value in proposed.cleaned_data.items()})
            return HttpResponseRedirect(f"{self._url('camera', record)}?{query}")
        except UnknownMountain as unknown:
            raise Http404 from unknown

        self.log_change(request, record, CAMERA_LOG_MESSAGE)
        self.message_user(request, f"The camera of {record.name} was changed.", messages.SUCCESS)

        return HttpResponseRedirect(f"{self._url('change', record)}#{CAMERA_ANCHOR}")

    def _camera_confirmation(self, request, record, proposed_form, readable=True):
        current = to_camera(record)
        proposed = proposed_form.camera() if readable and proposed_form.is_valid() else None
        violations = () if proposed is None else camera_violations(proposed)
        savable = proposed is not None and not violations

        context = {
            **self.admin_site.each_context(request),
            "title": f"Change the camera of {record.name}",
            "opts": self.opts,
            "original": record,
            "change_url": self._url("change", record),
            "is_public": record.status in PUBLIC_STATUS_VALUES,
            "unreadable": proposed is None,
            "unreadable_message": CAMERA_UNREADABLE,
            "rows": _camera_rows(current, proposed),
            "problems": [CAMERA_VIOLATION_MESSAGES[violation] for violation in violations],
            "proposed_form": CameraForm(initial=_camera_values(proposed)) if savable else None,
            "expected_form": CameraForm(
                prefix="expected", absent_allowed=True, initial=_camera_values(current)
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

        return super().render_change_form(request, context, add, change, form_url, obj)

    def get_formset_kwargs(self, request, obj, inline, prefix):
        return {
            **super().get_formset_kwargs(request, obj, inline, prefix),
            "form_kwargs": {
                "ingestion": self.photograph_ingestion,
                "media_base_url": self.media_base_url,
            },
        }

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        # Django runs a mutating change view inside one transaction. The exception leaves it,
        # so the mountain update rolls back with the photograph that could not be stored. The
        # tag lets the page's script give the chosen file back, since a redirect re-renders
        # the form from the saved data.
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except _PhotographNotStored:
            logger.exception("An uploaded photograph could not be stored")
            self.message_user(
                request,
                PHOTOGRAPH_NOT_STORED,
                messages.ERROR,
                extra_tags=PHOTOGRAPH_NOT_STORED_TAG,
            )

            return HttpResponseRedirect(request.get_full_path())

    def save_formset(self, request, form, formset, change):
        # PostgreSQL and the media store share no transaction. The objects go first, under new
        # immutable keys, and the row references them only afterwards, so a committed row never
        # points to a missing object; a failure leaves unreferenced objects at worst.
        for prepared in formset.photographs_to_store():
            try:
                self.photograph_ingestion.store(prepared)
            except InfrastructureError as error:
                raise _PhotographNotStored from error

        formset.save()

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

    def save_model(self, request, obj, form, change):
        if not change:
            obj.status = MountainStatus.DRAFT.value
            super().save_model(request, obj, form, change)
            return

        # Fields are written selectively so the whole row is not rewritten from the form's
        # copy; the status, the camera and anything else outside the form are never part of
        # this UPDATE.
        columns = dict.fromkeys(COLUMN_OF_FORM_FIELD.get(name, name) for name in form.fields)
        owned = [column for column in columns if column not in NEVER_FORM_WRITTEN]

        obj.updated_at = timezone.now()
        obj.save(update_fields=[*owned, "updated_at"])

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and (
            obj is None or obj.status == MountainStatus.DRAFT.value
        )

    def has_publish_permission(self, request):
        return request.user.has_perm(PUBLISH_PERMISSION)

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
    search_fields = ("mountain__slug", "mountain__name")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
