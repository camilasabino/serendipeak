from django import forms
from django.core.exceptions import ValidationError

from serendipeak.catalog import camera as camera_bounds
from serendipeak.catalog import coordinates
from serendipeak.catalog.camera import CameraViolation
from serendipeak.catalog.entities import CameraFraming, CanonicalCamera, Coordinates

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
CAMERA_LOCATION_CHANGED = (
    "The coordinates of this mountain changed after the camera editor was opened, so the camera "
    "composed there no longer fits it. Nothing was saved. Reopen the camera editor to compose "
    "the camera again on the current coordinates."
)
CAMERA_CHANGED_MEANWHILE = (
    "The camera was changed by someone else after this page was opened. Nothing was saved; "
    "compare it with yours and confirm again."
)


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


class LocationForm(forms.Form):
    """The coordinates a camera proposal was composed on, carried from the editor through the
    confirmation page to the save, which refuses a mountain that has moved since."""

    lat = forms.FloatField(
        widget=forms.HiddenInput,
        min_value=coordinates.LATITUDE_MIN_DEGREES,
        max_value=coordinates.LATITUDE_MAX_DEGREES,
    )
    lon = forms.FloatField(
        widget=forms.HiddenInput,
        min_value=coordinates.LONGITUDE_MIN_DEGREES,
        max_value=coordinates.LONGITUDE_MAX_DEGREES,
    )

    def coordinates(self) -> Coordinates:
        return Coordinates(latitude=self.cleaned_data["lat"], longitude=self.cleaned_data["lon"])


def camera_values(camera: CanonicalCamera | None) -> dict[str, float | None]:
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


def comparison_rows(current: CanonicalCamera | None, proposed: CanonicalCamera | None):
    current_values = camera_values(current)
    proposed_values = camera_values(proposed)

    return [
        {
            "label": label,
            "current": current_values[name],
            "proposed": proposed_values[name],
            "changed": current_values[name] != proposed_values[name],
        }
        for name, label in CAMERA_ROW_LABELS.items()
    ]


class ComposedOnForm(LocationForm):
    """The coordinates, plus the mountain the camera was composed for. The Studio addresses a
    mountain by a slug that can be renamed, so the proposal also names the mountain itself."""

    mountain = forms.UUIDField(widget=forms.HiddenInput)
