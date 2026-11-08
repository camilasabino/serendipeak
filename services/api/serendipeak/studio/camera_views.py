from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.utils.http import urlencode
from django.views import View

from serendipeak.catalog.camera import camera_violations
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.entities import PUBLIC_STATUSES, Mountain
from serendipeak.catalog.errors import (
    CameraChanged,
    CameraRejected,
    LocationChanged,
    MountainSlugNotFound,
    UnknownMountain,
)
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.studio import camera_editor_link
from serendipeak.studio.camera_confirmation import (
    CAMERA_CHANGED_MEANWHILE,
    CAMERA_LOCATION_CHANGED,
    CAMERA_UNREADABLE,
    CAMERA_VIOLATION_MESSAGES,
    CameraForm,
    ComposedOnForm,
    camera_values,
    comparison_rows,
)
from serendipeak.studio.mountain_views import mountain_gone, not_found

TEMPLATE = "studio/camera_confirmation.html"


class CameraConfirmationView(View):
    """Confirm and save a camera that the visual editor proposes.

    The GET only shows the proposal beside the stored camera and never writes. The CSRF-protected
    POST saves it, and the use case refuses it if the camera or the coordinates it was composed
    on are not the stored ones any more.
    """

    get_mountain_detail: GetMountainDetail | None = None
    change_camera: ChangeMountainCamera | None = None
    web_origin: str = ""

    def get(self, request, slug):
        mountain = self._mountain(slug)
        if mountain is None:
            return not_found(request)

        return self._confirmation(
            request, mountain, CameraForm(request.GET), ComposedOnForm(request.GET)
        )

    def post(self, request, slug):
        mountain = self._mountain(slug)
        if mountain is None:
            return not_found(request)

        proposed = CameraForm(request.POST)
        expected = CameraForm(request.POST, prefix="expected", absent_allowed=True)
        composed_on = ComposedOnForm(request.POST)
        forms_valid = proposed.is_valid() and expected.is_valid() and composed_on.is_valid()
        if not forms_valid or not self._is_for(mountain, composed_on):
            return self._confirmation(request, mountain, proposed, composed_on, readable=False)

        try:
            self.change_camera.execute(
                mountain.id, proposed.camera(), expected.camera(), composed_on.coordinates()
            )
        except CameraRejected:
            return self._confirmation(request, mountain, proposed, composed_on)
        except LocationChanged:
            moved = self._mountain(slug)
            if moved is None:
                return not_found(request)

            return self._stale_location(request, moved)
        except CameraChanged:
            messages.warning(request, CAMERA_CHANGED_MEANWHILE)

            return HttpResponseRedirect(f"{self._url(slug)}?{self._carried(proposed, composed_on)}")
        except UnknownMountain:
            return mountain_gone(request, mountain.name.en)

        messages.success(request, f"The camera of {mountain.name.en} was changed.")

        return HttpResponseRedirect(f"{reverse('studio:mountain_detail', args=[slug])}#camera")

    @staticmethod
    def _is_for(mountain: Mountain, composed_on: ComposedOnForm) -> bool:
        # A slug renamed after the editor opened can now be another mountain's address.
        return composed_on.is_valid() and composed_on.cleaned_data["mountain"] == mountain.id

    def _mountain(self, slug) -> Mountain | None:
        try:
            return self.get_mountain_detail.execute(slug).mountain
        except MountainSlugNotFound:
            return None

    @staticmethod
    def _url(slug) -> str:
        return reverse("studio:mountain_camera", args=[slug])

    @staticmethod
    def _carried(proposed, composed_on) -> str:
        """The proposal again, as a query. Floats are written with repr so that the same numbers
        come back, which the equality of coordinates and of cameras depends on."""
        values = {**proposed.cleaned_data, **composed_on.cleaned_data}

        return urlencode(
            {
                name: str(value) if name == "mountain" else repr(value)
                for name, value in values.items()
            }
        )

    def _editor_url(self, mountain: Mountain, proposed=None) -> str:
        return camera_editor_link.camera_editor_url(
            self.web_origin,
            mountain_id=mountain.id,
            slug=mountain.slug,
            name=mountain.name.en,
            latitude=mountain.coordinates.latitude,
            longitude=mountain.coordinates.longitude,
            elevation_meters=mountain.elevation_meters,
            stored=mountain.camera,
            proposed=proposed,
        )

    def _context(self, mountain: Mountain, **extra) -> dict:
        return {
            "mountain": mountain,
            "detail_url": reverse("studio:mountain_detail", args=[mountain.slug]),
            **extra,
        }

    def _stale_location(self, request, mountain: Mountain):
        now = mountain.coordinates
        context = self._context(
            mountain,
            editor_url=self._editor_url(mountain),
            stale_location=(
                f"{CAMERA_LOCATION_CHANGED} Its coordinates are now "
                f"{now.latitude!r}, {now.longitude!r}."
            ),
        )

        return render(request, TEMPLATE, context, status=409)

    def _confirmation(self, request, mountain, proposed_form, composed_on, readable=True):
        readable = readable and proposed_form.is_valid() and self._is_for(mountain, composed_on)
        if readable and composed_on.coordinates() != mountain.coordinates:
            return self._stale_location(request, mountain)

        current = mountain.camera
        proposed = proposed_form.camera() if readable else None
        violations = () if proposed is None else camera_violations(proposed)
        savable = proposed is not None and not violations

        context = self._context(
            mountain,
            editor_url=self._editor_url(mountain, proposed),
            is_public=mountain.status in PUBLIC_STATUSES,
            unreadable=proposed is None,
            unreadable_message=CAMERA_UNREADABLE,
            rows=comparison_rows(current, proposed),
            problems=[CAMERA_VIOLATION_MESSAGES[violation] for violation in violations],
            proposed_form=CameraForm(initial=camera_values(proposed)) if savable else None,
            expected_form=CameraForm(
                prefix="expected", absent_allowed=True, initial=camera_values(current)
            )
            if savable
            else None,
            composed_form=ComposedOnForm(
                initial={
                    "lat": composed_on.cleaned_data["lat"],
                    "lon": composed_on.cleaned_data["lon"],
                    "mountain": mountain.id,
                }
            )
            if savable
            else None,
        )

        return render(request, TEMPLATE, context, status=200 if savable else 400)
