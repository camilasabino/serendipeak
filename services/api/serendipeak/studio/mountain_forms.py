import re
from dataclasses import dataclass
from uuid import UUID

from django import forms

from serendipeak.catalog import coordinates as coordinate_bounds
from serendipeak.catalog.entities import (
    WIKIDATA_ID_PATTERN,
    Coordinates,
    Mountain,
    MountainStatus,
    PrimaryImage,
)
from serendipeak.catalog.get_mountain_form_options import MountainFormOptions
from serendipeak.catalog.mountain_update import MountainUpdate
from serendipeak.catalog.new_mountain import (
    NewMountain,
    NewPhotograph,
    PhotographCredit,
    credit_violations,
)
from serendipeak.catalog.relocation import RelocationOutcome, judge_relocation
from serendipeak.catalog.slug import is_valid_slug
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH, summary_violations
from serendipeak.studio import mountain_messages as messages

ACCEPTED_PHOTOGRAPH_TYPES = "image/jpeg,image/png,image/webp"
CREDIT_FIELDS = ("author", "source_page_url", "license_name", "license_url")
_WIKIDATA_ID = re.compile(WIKIDATA_ID_PATTERN)


@dataclass(frozen=True, slots=True)
class PhotographChange:
    """What the photograph part of the form asks for. With neither a file, a credit nor a
    removal, the stored photograph and its credit stay as they are."""

    photograph: NewPhotograph | None = None
    credit: PhotographCredit | None = None
    remove: bool = False


def initial_of(mountain: Mountain, options: MountainFormOptions) -> dict:
    """The values of the stored mountain, as the form shows them.

    The coordinates are written as the shortest text that reads back as the same number, because
    a change of location is detected by exact comparison.
    """
    region_slug = None if mountain.region is None else mountain.region.region.slug

    return {
        "name": mountain.name.en,
        "slug": mountain.slug,
        "latitude": repr(mountain.coordinates.latitude),
        "longitude": repr(mountain.coordinates.longitude),
        "elevation_meters": mountain.elevation_meters,
        "continent": mountain.continent.code,
        "region": next(
            (str(option.id) for option in options.regions if option.slug == region_slug), ""
        ),
        "countries": [country.code for country in mountain.countries],
        "summary": "" if mountain.summary is None else mountain.summary.en,
        "osm_node_id": mountain.osm_node_id,
        "wikidata_id": mountain.wikidata_id or "",
    }


def credit_of(image: PrimaryImage) -> PhotographCredit:
    return PhotographCredit(
        author=image.author,
        license_name=image.license_name,
        license_url=image.license_url,
        source_page_url=image.source_page_url,
    )


def photograph_initial_of(image: PrimaryImage | None) -> dict:
    if image is None:
        return {}

    return {name: getattr(image, name) or "" for name in CREDIT_FIELDS}


class MountainForm(forms.Form):
    name = forms.CharField(label="Name", error_messages={"required": messages.NAME_REQUIRED})
    slug = forms.CharField(
        label="Slug",
        widget=forms.TextInput(attrs={"autocapitalize": "none", "spellcheck": "false"}),
        error_messages={"required": messages.SLUG_MESSAGE},
    )
    latitude = forms.FloatField(
        label="Latitude",
        help_text=(
            f"Degrees, {coordinate_bounds.LATITUDE_MIN_DEGREES:g} to "
            f"{coordinate_bounds.LATITUDE_MAX_DEGREES:g}."
        ),
    )
    longitude = forms.FloatField(
        label="Longitude",
        help_text=(
            f"Degrees, {coordinate_bounds.LONGITUDE_MIN_DEGREES:g} to "
            f"{coordinate_bounds.LONGITUDE_MAX_DEGREES:g}."
        ),
    )
    confirm_camera_reset = forms.BooleanField(
        label="Clear the camera if the coordinates change",
        required=False,
        help_text=(
            "Tick it when you change the latitude or longitude. The saved camera is composed on "
            "the current location, so it is cleared with the move and has to be set again in the "
            "camera editor."
        ),
    )
    elevation_meters = forms.IntegerField(label="Elevation (m)")
    continent = forms.ChoiceField(
        label="Continent",
        help_text="Where the summit lies. It is chosen, never derived from the countries.",
    )
    region = forms.ChoiceField(
        label="Region",
        required=False,
        help_text="The most specific region known, shown with the regions above it.",
    )
    countries = forms.MultipleChoiceField(
        label="Countries",
        required=False,
        widget=forms.CheckboxSelectMultiple,
        help_text="A mountain may have none, for example while it is a new draft.",
    )
    summary = forms.CharField(
        label="Summary",
        required=False,
        empty_value=None,
        widget=forms.Textarea(attrs={"rows": 3, "maxlength": SUMMARY_MAX_LENGTH}),
        help_text=(
            f"One sentence of at most {SUMMARY_MAX_LENGTH} characters, with a capitalized first "
            "word and a final period."
        ),
    )
    osm_node_id = forms.IntegerField(label="OpenStreetMap node id", required=False)
    wikidata_id = forms.CharField(
        label="Wikidata id",
        required=False,
        empty_value=None,
        help_text="The Wikidata item, such as Q39739.",
    )

    def __init__(
        self, *args, options: MountainFormOptions, stored: Mountain | None = None, **kwargs
    ):
        if stored is not None:
            kwargs.setdefault("initial", initial_of(stored, options))
        super().__init__(*args, **kwargs)
        self.stored = stored
        self._options = options
        self.fields["continent"].choices = [
            ("", "Select a continent"),
            *((continent.code, continent.name.en) for continent in options.continents),
        ]
        self.fields["region"].choices = [
            ("", "No region"),
            *((str(region.id), region.label) for region in options.regions),
        ]
        self.fields["countries"].choices = [
            (country.code, f"{country.name.en} ({country.code})") for country in options.countries
        ]

        if stored is None:
            del self.fields["confirm_camera_reset"]
            return

        if stored.status is MountainStatus.ACTIVE:
            # A disabled field reads its initial value, so a forged post cannot move the mountain.
            for name in ("latitude", "longitude"):
                self.fields[name].disabled = True
            self.fields["latitude"].help_text = messages.ACTIVE_LOCATION_LOCKED
            del self.fields["confirm_camera_reset"]
        if stored.status is not MountainStatus.DRAFT:
            self.fields["slug"].help_text = messages.SLUG_CHANGES_PUBLIC_ADDRESS

    def clean_slug(self):
        slug = self.cleaned_data["slug"]
        if not is_valid_slug(slug):
            raise forms.ValidationError(messages.SLUG_MESSAGE)

        return slug

    def clean_latitude(self):
        latitude = self.cleaned_data["latitude"]
        if (
            not coordinate_bounds.LATITUDE_MIN_DEGREES
            <= latitude
            <= (coordinate_bounds.LATITUDE_MAX_DEGREES)
        ):
            raise forms.ValidationError(messages.LATITUDE_MESSAGE)

        return latitude

    def clean_longitude(self):
        longitude = self.cleaned_data["longitude"]
        if (
            not coordinate_bounds.LONGITUDE_MIN_DEGREES
            <= longitude
            <= (coordinate_bounds.LONGITUDE_MAX_DEGREES)
        ):
            raise forms.ValidationError(messages.LONGITUDE_MESSAGE)

        return longitude

    def clean_elevation_meters(self):
        elevation = self.cleaned_data["elevation_meters"]
        if elevation <= 0:
            raise forms.ValidationError(messages.ELEVATION_MESSAGE)

        return elevation

    def clean_summary(self):
        summary = self.cleaned_data["summary"]
        if summary is None:
            return None
        violations = summary_violations(summary)
        if violations:
            raise forms.ValidationError(
                [messages.SUMMARY_MESSAGES[violation] for violation in violations]
            )

        return summary

    def clean_osm_node_id(self):
        osm_node_id = self.cleaned_data["osm_node_id"]
        if osm_node_id is not None and osm_node_id <= 0:
            raise forms.ValidationError(messages.OSM_NODE_ID_MESSAGE)

        return osm_node_id

    def clean_wikidata_id(self):
        wikidata_id = self.cleaned_data["wikidata_id"]
        if wikidata_id is not None and not _WIKIDATA_ID.fullmatch(wikidata_id):
            raise forms.ValidationError(messages.WIKIDATA_MESSAGE)

        return wikidata_id

    def clean(self):
        cleaned = super().clean()
        if self.stored is not None and {"latitude", "longitude"} <= cleaned.keys():
            self._judge_relocation(cleaned)

        return cleaned

    def _judge_relocation(self, cleaned):
        # The use case judges the same rule again under its lock; asking here keeps the editor
        # from losing the typed values to a refusal that was foreseeable.
        outcome = judge_relocation(
            self.stored.status,
            self.stored.coordinates,
            Coordinates(latitude=cleaned["latitude"], longitude=cleaned["longitude"]),
            bool(cleaned.get("confirm_camera_reset")),
        )
        if outcome is RelocationOutcome.CONFIRMATION_REQUIRED:
            self.add_error("confirm_camera_reset", messages.CAMERA_RESET_REQUIRED)

    @property
    def coordinates(self) -> Coordinates:
        return Coordinates(
            latitude=self.cleaned_data["latitude"], longitude=self.cleaned_data["longitude"]
        )

    @property
    def camera_reset_confirmed(self) -> bool:
        return bool(self.cleaned_data.get("confirm_camera_reset"))

    @property
    def moves_the_mountain(self) -> bool:
        return self.stored is not None and self.coordinates != self.stored.coordinates

    def _region_id(self) -> UUID | None:
        region = self.cleaned_data["region"]

        return UUID(region) if region else None

    def new_mountain(self, change: PhotographChange) -> NewMountain:
        cleaned = self.cleaned_data

        return NewMountain(
            slug=cleaned["slug"],
            name=cleaned["name"],
            coordinates=self.coordinates,
            elevation_meters=cleaned["elevation_meters"],
            continent_code=cleaned["continent"],
            country_codes=tuple(cleaned["countries"]),
            region_id=self._region_id(),
            summary=cleaned["summary"],
            osm_node_id=cleaned["osm_node_id"],
            wikidata_id=cleaned["wikidata_id"],
            photograph=change.photograph,
        )

    def mountain_update(self, change: PhotographChange) -> MountainUpdate:
        cleaned = self.cleaned_data

        return MountainUpdate(
            slug=cleaned["slug"],
            name=cleaned["name"],
            elevation_meters=cleaned["elevation_meters"],
            continent_code=cleaned["continent"],
            country_codes=tuple(cleaned["countries"]),
            region_id=self._region_id(),
            summary=cleaned["summary"],
            osm_node_id=cleaned["osm_node_id"],
            wikidata_id=cleaned["wikidata_id"],
            photograph=change.photograph,
            credit=change.credit,
            remove_photograph=change.remove,
        )


class PhotographForm(forms.Form):
    """The photograph card: a file, its credit and, on a draft, its removal.

    It reads what the editor asked for and judges the credit with the domain rules. The file is
    processed by the use case when the mountain is saved, never here.
    """

    file = forms.FileField(
        label="Photograph",
        required=False,
        widget=forms.FileInput(
            attrs={"accept": ACCEPTED_PHOTOGRAPH_TYPES, "data-photograph-file": ""}
        ),
        help_text="A JPEG, PNG or WebP file. Visitors get resized copies without its metadata.",
    )
    author = forms.CharField(
        label="Author",
        required=False,
        help_text=(
            "Needed with a photograph. The credit shown to visitors: the photographer or rights "
            "holder."
        ),
    )
    source_page_url = forms.CharField(
        label="Photo page URL",
        required=False,
        empty_value=None,
        help_text="The page where the photograph is published. The credit links to it.",
    )
    license_name = forms.CharField(
        label="License",
        required=False,
        empty_value=None,
        help_text=(
            "The license the photograph is used under. Publish only photographs you have the "
            "right to use."
        ),
    )
    license_url = forms.CharField(
        label="License URL", required=False, empty_value=None, help_text="Needs the license name."
    )
    credit_reviewed = forms.BooleanField(
        label="The author and license also describe the new photograph",
        required=False,
        help_text="Needed only when they have not changed.",
    )
    remove = forms.BooleanField(
        label="Remove the photograph",
        required=False,
        help_text="A draft may have none. Publishing it needs one again.",
    )

    def __init__(
        self,
        *args,
        stored: PrimaryImage | None,
        removable: bool,
        max_bytes: int,
        **kwargs,
    ):
        kwargs.setdefault("prefix", "photograph")
        kwargs.setdefault("initial", photograph_initial_of(stored))
        super().__init__(*args, **kwargs)
        self.stored = stored
        self._max_bytes = max_bytes
        self._data: bytes | None = None
        self._change = PhotographChange()
        if not (removable and stored is not None):
            del self.fields["remove"]
        if stored is None:
            del self.fields["credit_reviewed"]
        else:
            self.fields["file"].help_text = (
                "Leave it empty to keep the saved photograph. A new file replaces it, and its "
                "author and license have to be reviewed."
            )

    def clean_file(self):
        upload = self.cleaned_data.get("file")
        if upload is None:
            return None
        # The size is known before reading, so an oversized upload is refused unread.
        if upload.size > self._max_bytes:
            raise forms.ValidationError(messages.too_many_bytes(self._max_bytes))
        self._data = upload.read()

        return upload

    def clean(self):
        cleaned = super().clean()
        if "file" in self.errors:
            return cleaned

        has_file = cleaned.get("file") is not None
        if cleaned.get("remove"):
            if has_file:
                self.add_error("file", messages.REMOVE_AND_REPLACE)
            else:
                self._change = PhotographChange(remove=True)

            return cleaned

        credit = PhotographCredit(
            author=cleaned.get("author") or "",
            license_name=cleaned.get("license_name"),
            license_url=cleaned.get("license_url"),
            source_page_url=cleaned.get("source_page_url"),
        )
        if has_file:
            self._judge_upload(credit, cleaned)
        elif self.stored is None:
            if any(cleaned.get(name) for name in CREDIT_FIELDS):
                self.add_error("file", messages.PHOTOGRAPH_REQUIRED)
        elif credit != credit_of(self.stored):
            self._judge_credit(credit)

        return cleaned

    def _judge_upload(self, credit, cleaned):
        if not self._refuse_credit(credit):
            if (
                self.stored is not None
                and not cleaned.get("credit_reviewed")
                and credit == credit_of(self.stored)
            ):
                self.add_error("credit_reviewed", messages.CREDIT_NOT_REVIEWED)
                return
            self._change = PhotographChange(
                photograph=NewPhotograph(
                    data=self._data,
                    author=credit.author,
                    license_name=credit.license_name,
                    license_url=credit.license_url,
                    source_page_url=credit.source_page_url,
                )
            )

    def _judge_credit(self, credit):
        if not self._refuse_credit(credit):
            self._change = PhotographChange(credit=credit)

    def _refuse_credit(self, credit) -> bool:
        violations = credit_violations(credit)
        for violation in violations:
            name, message = messages.PHOTOGRAPH_VIOLATION_FIELDS[violation]
            self.add_error(name, message)

        return bool(violations)

    @property
    def change(self) -> PhotographChange:
        return self._change
