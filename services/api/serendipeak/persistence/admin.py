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
from serendipeak.catalog.errors import InvalidStatusTransition, PublicationRejected, UnknownMountain
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
from serendipeak.persistence.mapping import to_mountain, to_mountain_with_image
from serendipeak.persistence.models import MountainImageRecord, MountainRecord

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
    PublicationViolation.IMAGE_URL_MISSING: "the photograph URL is missing",
    PublicationViolation.IMAGE_ATTRIBUTION_MISSING: "the photograph attribution is missing",
    PublicationViolation.IMAGE_SOURCE_PAGE_URL_MISSING: "the photograph source page is missing",
    PublicationViolation.IMAGE_SOURCE_IDENTIFIER_MISSING: "the photograph identifier is missing",
    PublicationViolation.IMAGE_LICENSE_NAME_MISSING: "the photograph license name is missing",
    PublicationViolation.IMAGE_LICENSE_URL_MISSING: "the photograph license URL is missing",
    PublicationViolation.IMAGE_PUBLIC_DOMAIN_CREATOR_MISSING: (
        "a public domain photograph needs its creator"
    ),
    PublicationViolation.IMAGE_DIMENSIONS_MISSING: "the photograph dimensions are missing",
    PublicationViolation.SUMMARY_INVALID: "the summary breaks the summary rules",
    PublicationViolation.LINK_NOT_HTTPS: "a public link does not use https://",
}
PUBLIC_LINK_LABELS = {
    PublicLinkField.WIKIPEDIA_URL: "the Wikipedia link",
    PublicLinkField.IMAGE_URL: "the photograph URL",
    PublicLinkField.IMAGE_THUMBNAIL_URL: "the photograph thumbnail URL",
    PublicLinkField.IMAGE_SOURCE_PAGE_URL: "the photograph source page",
    PublicLinkField.IMAGE_LICENSE_URL: "the photograph license URL",
}
PUBLIC_LINK_MESSAGE = "Use an https:// link."

OPTIONAL_TEXT = ("range_name", "summary", "wikipedia_url")
CAMERA_FIELDS = (
    "camera_heading_degrees",
    "camera_pitch_degrees",
    "camera_range_meters",
    "camera_framing_x",
    "camera_framing_y",
)
IMAGE_OPTIONAL = (
    "thumbnail_url",
    "creator",
    "license_name",
    "license_url",
    "license_reported",
    "license_election_basis_url",
    "approved_on",
)
IMAGE_LINKS = ("url", "thumbnail_url", "source_page_url", "license_url")
PUBLIC_STATUS_VALUES = frozenset({MountainStatus.ACTIVE.value, MountainStatus.INACTIVE.value})
IMAGE_FROZEN = (
    "url",
    "thumbnail_url",
    "width",
    "height",
    "source_page_url",
    "source_identifier",
    "license_reported",
    "license_election_basis_url",
    "approved_on",
)
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


class MountainImageForm(forms.ModelForm):
    width = forms.IntegerField(required=False, min_value=1)
    height = forms.IntegerField(required=False, min_value=1)

    class Meta:
        model = MountainImageRecord
        fields = (
            "url",
            "thumbnail_url",
            "width",
            "height",
            "source_page_url",
            "source_identifier",
            "creator",
            "attribution",
            "license_name",
            "license_url",
            "license_reported",
            "license_election_basis_url",
            "approved_on",
        )
        widgets = _single_line(
            "url",
            "thumbnail_url",
            "source_page_url",
            "source_identifier",
            "creator",
            "attribution",
            "license_name",
            "license_url",
            "license_reported",
            "license_election_basis_url",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _make_optional(self, [name for name in IMAGE_OPTIONAL if name in self.fields])
        _require_public_links(self, IMAGE_LINKS)

    def clean(self):
        cleaned = super().clean()
        if "width" in self.fields and "height" in self.fields:
            if (cleaned.get("width") is None) != (cleaned.get("height") is None):
                self.add_error("height", "The width and height go together.")

        return cleaned


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

    def _prospective_image(self):
        image = None
        for form in self.forms:
            if self._should_delete_form(form):
                continue
            if form in self.initial_forms or form.has_changed():
                image = form.instance

        return image


def _has_image(mountain):
    return mountain is not None and hasattr(mountain, "image")


class MountainImageInline(admin.StackedInline):
    model = MountainImageRecord
    form = MountainImageForm
    formset = MountainImageFormSet
    verbose_name = "photograph"
    max_num = 1
    can_delete = True

    def get_readonly_fields(self, request, obj=None):
        return IMAGE_FROZEN if _has_image(obj) else ()

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

    def get_object(self, request, object_id, from_field=None):
        # Django opens the transaction of a mutating change or delete view before calling this,
        # and keeps it until the view returns. Locking here puts the row lock ahead of every
        # form, formset and permission decision and holds it through the image writes, which
        # is the order DjangoMountainStatusStore uses. A read-only request is not in a
        # transaction, where FOR UPDATE is an error.
        connection = transaction.get_connection(router.db_for_write(self.model))
        if request.method in SAFE_METHODS or not connection.in_atomic_block:
            return super().get_object(request, object_id, from_field)

        field = (
            self.model._meta.pk if from_field is None else self.model._meta.get_field(from_field)
        )
        queryset = self.get_queryset(request).select_for_update(of=("self",))
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
