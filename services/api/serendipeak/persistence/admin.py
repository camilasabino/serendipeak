import logging
import re

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation, ShowFacets
from django.contrib.gis.geos import Point
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import router, transaction
from django.forms.models import BaseInlineFormSet
from django.http import Http404, HttpResponseRedirect
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join
from django.utils.text import capfirst
from django.views.decorators.http import require_POST

from serendipeak.catalog import coordinates
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN, MountainStatus, OsmType
from serendipeak.catalog.errors import (
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
from serendipeak.persistence.mapping import to_mountain, to_mountain_with_image
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
    PublicationViolation.IMAGE_ATTRIBUTION_MISSING: "the photograph attribution is missing",
    PublicationViolation.IMAGE_SOURCE_PAGE_URL_MISSING: "the photograph source page is missing",
    PublicationViolation.IMAGE_DIMENSIONS_MISSING: "the photograph dimensions are missing",
    PublicationViolation.SUMMARY_INVALID: "the summary breaks the summary rules",
    PublicationViolation.LINK_NOT_HTTPS: "a public link does not use https://",
}
PUBLIC_LINK_LABELS = {
    PublicLinkField.WIKIPEDIA_URL: "the Wikipedia link",
    PublicLinkField.IMAGE_SOURCE_PAGE_URL: "the photograph source page",
    PublicLinkField.IMAGE_LICENSE_URL: "the photograph license URL",
    PublicLinkField.IMAGE_CREATOR_URL: "the photograph creator URL",
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
PHOTOGRAPH_NOT_STORED = "The photograph could not be stored. Nothing was changed."
LICENSE_NAME_FOR_URL = "Add the license name of this license URL."

OPTIONAL_TEXT = ("range_name", "summary", "wikipedia_url")
CAMERA_FIELDS = (
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
)
IMAGE_CREDIT_FIELDS = (
    "source_page_url",
    "attribution",
    "creator",
    "creator_url",
    "license_name",
    "license_url",
)
IMAGE_OPTIONAL = ("creator", "creator_url", "license_name", "license_url")
IMAGE_LINKS = ("source_page_url", "creator_url", "license_url")
PHOTOGRAPH_DETAIL_FIELDS = ("photograph_dimensions", "stored_original")
LEGACY_PROVENANCE_FIELDS = (
    "source_identifier",
    "legacy_file_url",
    "license_reported",
    "license_election_basis_url",
    "approved_on",
)
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


class PhotographFileInput(forms.FileInput):
    """A file input shown with the stored page rendition and a local preview of the chosen file."""

    def __init__(self, attrs=None):
        super().__init__(
            attrs={"accept": ACCEPTED_PHOTOGRAPH_TYPES, "data-photograph-file": "", **(attrs or {})}
        )
        self.stored_url = None

    def render(self, name, value, attrs=None, renderer=None):
        stored = (
            format_html(
                '<img class="photograph-preview" src="{}" alt="Current photograph">',
                self.stored_url,
            )
            if self.stored_url
            else ""
        )

        return format_html(
            '<div class="photograph-upload">{}<img class="photograph-preview" alt="Chosen '
            'photograph" data-photograph-preview hidden>{}</div>',
            stored,
            super().render(name, value, attrs, renderer),
        )


class MountainImageForm(forms.ModelForm):
    photograph_file = forms.FileField(
        label="Photograph file",
        required=False,
        widget=PhotographFileInput,
        help_text=(
            "A JPEG, PNG or WebP file. Visitors get resized copies without the file's metadata."
        ),
    )

    class Meta:
        model = MountainImageRecord
        fields = IMAGE_CREDIT_FIELDS
        labels = {
            "source_page_url": "Source page URL",
            "creator_url": "Creator URL",
            "license_url": "License URL",
        }
        help_texts = {
            "source_page_url": "The page the photograph comes from.",
            "attribution": "The credit shown to visitors.",
            "creator_url": "Where the credit links to.",
        }
        widgets = _single_line(*IMAGE_CREDIT_FIELDS)

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
            photograph_file.label = "Replace photograph"
            photograph_file.help_text = (
                "Leave empty to keep the current photograph. A new file replaces it and clears "
                "its legacy provenance; update the credit to match."
            )
        if self.instance.page_key is not None:
            photograph_file.widget.stored_url = public_url(media_base_url, self.instance.page_key)

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

        return cleaned


def _too_many_bytes(max_bytes):
    return f"The file is larger than {max_bytes // (1024 * 1024)} MiB."


def _use_photograph(image, prepared):
    # The formset judges this prospective instance, and nothing is stored until every form is
    # valid. The legacy provenance belongs to the photograph being replaced, so it goes too.
    media = prepared.media
    image.original_key = media.original_key
    image.original_sha256 = media.original_sha256
    image.page_key = media.page_key
    image.viewer_key = media.viewer_key
    image.width = prepared.dimensions.width
    image.height = prepared.dimensions.height
    for name in LEGACY_PROVENANCE_FIELDS:
        setattr(image, name, None)


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


def _present_legacy_fields(image):
    return tuple(name for name in LEGACY_PROVENANCE_FIELDS if getattr(image, name) is not None)


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
        js = ("serendipeak/admin/photograph-preview.js",)

    def get_fieldsets(self, request, obj=None):
        photograph = (None, {"fields": ("photograph_file", *IMAGE_CREDIT_FIELDS)})
        image = _stored_image(obj)
        if image is None:
            return [photograph]

        details = (
            "Photograph details",
            {"fields": PHOTOGRAPH_DETAIL_FIELDS, "classes": ("collapse",)},
        )
        legacy = _present_legacy_fields(image)
        if not legacy:
            return [photograph, details]

        legacy_provenance = (
            "Legacy provenance",
            {
                "fields": legacy,
                "classes": ("collapse",),
                "description": "Recorded for the photograph imported from the legacy catalog. "
                "Replacing the photograph clears it.",
            },
        )

        return [photograph, details, legacy_provenance]

    def get_readonly_fields(self, request, obj=None):
        image = _stored_image(obj)
        if image is None:
            return ()

        return (*PHOTOGRAPH_DETAIL_FIELDS, *_present_legacy_fields(image))

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

        return (*PUBLICATION_FIELDS, *CAMERA_FIELDS)

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
                "fields": CAMERA_FIELDS,
                "description": "Read-only. The mountain form never changes the camera.",
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

    def get_urls(self):
        transition = path(
            "<path:object_id>/transition/<str:kind>/",
            self.admin_site.admin_view(require_POST(self.transition_view)),
            name=f"{self.opts.app_label}_{self.opts.model_name}_transition",
        )

        return [transition, *super().get_urls()]

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
        # so the mountain update rolls back with the photograph that could not be stored.
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except _PhotographNotStored:
            logger.exception("An uploaded photograph could not be stored")
            self.message_user(request, PHOTOGRAPH_NOT_STORED, messages.ERROR)

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
