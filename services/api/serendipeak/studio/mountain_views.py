import logging
from dataclasses import dataclass

from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.views import View

from serendipeak.catalog.change_mountain_location import ChangeMountainLocation
from serendipeak.catalog.create_mountain import CreateMountain
from serendipeak.catalog.deactivate_mountain import DeactivateMountain
from serendipeak.catalog.delete_draft_mountain import DeleteDraftMountain
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import (
    InvalidStatusTransition,
    MountainNotDraft,
    MountainReferenced,
    MountainSlugNotFound,
    PhotographNotStored,
    PublicationRejected,
    UnknownMountain,
)
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.get_mountain_form_options import GetMountainFormOptions
from serendipeak.catalog.publish_mountain import PublishMountain
from serendipeak.catalog.reactivate_mountain import ReactivateMountain
from serendipeak.catalog.relocation import RelocationOutcome
from serendipeak.catalog.update_mountain import UpdateMountain
from serendipeak.errors import ApplicationError
from serendipeak.studio import representations, security_log
from serendipeak.studio.mountain_forms import MountainForm, PhotographForm
from serendipeak.studio.refusals import refusal_of

logger = logging.getLogger(__name__)

GONE = "{} no longer exists, so nothing was changed."
COORDINATES_MOVED = (
    "The coordinates were saved and the camera was cleared, because it was composed on the old "
    "location. Set the camera again with the camera editor."
)
COORDINATES_NOT_SAVED = (
    "Your other changes were saved, but the coordinates were not. Check them and save again."
)


@dataclass(frozen=True, slots=True)
class MountainWrites:
    """The use cases the Studio's mountain screens write through."""

    create_mountain: CreateMountain
    update_mountain: UpdateMountain
    change_location: ChangeMountainLocation
    delete_draft: DeleteDraftMountain
    publish: PublishMountain
    deactivate: DeactivateMountain
    reactivate: ReactivateMountain


def not_found(request):
    return render(request, "studio/mountain_not_found.html", status=404)


def mountain_gone(request, name):
    messages.error(request, GONE.format(name))

    return HttpResponseRedirect(reverse("studio:mountain_list"))


class MountainFormView(View):
    """What the creation and the edit screens share: the two forms, their page and the refusals
    a write use case answers with."""

    template_name = "studio/mountain_form.html"
    get_mountain_detail: GetMountainDetail | None = None
    get_form_options: GetMountainFormOptions | None = None
    writes: MountainWrites | None = None
    media_base_url: str = ""
    web_origin: str = ""
    max_photograph_bytes: int = 0

    def _forms(self, request, options, mountain):
        bound = request.method == "POST"
        data = request.POST if bound else None
        files = request.FILES if bound else None
        image = None if mountain is None else mountain.primary_image
        mountain_form = MountainForm(data, options=options, stored=mountain)
        photograph_form = PhotographForm(
            data,
            files,
            stored=image,
            removable=mountain is not None and mountain.status is MountainStatus.DRAFT,
            max_bytes=self.max_photograph_bytes,
        )

        return mountain_form, photograph_form

    def _valid(self, mountain_form, photograph_form) -> bool:
        # Both are judged, so one page shows every error.
        mountain_valid = mountain_form.is_valid()
        photograph_valid = photograph_form.is_valid()

        return mountain_valid and photograph_valid

    def _page(self, request, mountain_form, photograph_form, *, mountain, detail=None):
        context = representations.form_context(
            mountain_form,
            photograph_form,
            mountain=mountain,
            violations=() if detail is None else detail.violations,
            media_base_url=self.media_base_url,
            web_origin=self.web_origin,
        )

        return render(request, self.template_name, context)

    def _refused(self, request, error, mountain_form, photograph_form, *, mountain, detail=None):
        """The page again with the refusal in the forms, or the error itself when it is not one
        an editor can fix by editing the form."""
        refusal = refusal_of(error, max_photograph_bytes=self.max_photograph_bytes)
        if refusal is None:
            raise error
        if isinstance(error, PhotographNotStored):
            logger.error("An uploaded photograph could not be stored", exc_info=error)
        refusal.apply(mountain_form, photograph_form)

        return self._page(request, mountain_form, photograph_form, mountain=mountain, detail=detail)


class NewMountainView(MountainFormView):
    def get(self, request):
        options = self.get_form_options.execute()
        mountain_form, photograph_form = self._forms(request, options, None)

        return self._page(request, mountain_form, photograph_form, mountain=None)

    def post(self, request):
        options = self.get_form_options.execute()
        mountain_form, photograph_form = self._forms(request, options, None)
        if not self._valid(mountain_form, photograph_form):
            return self._page(request, mountain_form, photograph_form, mountain=None)

        try:
            created = self.writes.create_mountain.execute(
                mountain_form.new_mountain(photograph_form.change)
            )
        except (ApplicationError, PhotographNotStored) as error:
            return self._refused(request, error, mountain_form, photograph_form, mountain=None)

        if created.primary_image is None:
            messages.success(
                request,
                f"{created.name.en} was created as a draft. Add a photograph to publish it.",
            )
        else:
            messages.success(request, f"{created.name.en} was created as a draft.")

        return HttpResponseRedirect(reverse("studio:mountain_detail", args=[created.slug]))


class EditMountainView(MountainFormView):
    def get(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        options = self.get_form_options.execute()
        mountain_form, photograph_form = self._forms(request, options, detail.mountain)

        return self._page(
            request, mountain_form, photograph_form, mountain=detail.mountain, detail=detail
        )

    def post(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        mountain = detail.mountain
        options = self.get_form_options.execute()
        mountain_form, photograph_form = self._forms(request, options, mountain)
        if not self._valid(mountain_form, photograph_form):
            return self._page(
                request, mountain_form, photograph_form, mountain=mountain, detail=detail
            )

        try:
            self.writes.update_mountain.execute(
                mountain.id, mountain_form.mountain_update(photograph_form.change)
            )
        except UnknownMountain:
            return mountain_gone(request, mountain.name.en)
        except (ApplicationError, PhotographNotStored) as error:
            return self._refused(
                request, error, mountain_form, photograph_form, mountain=mountain, detail=detail
            )

        return self._relocate(request, mountain, mountain_form)

    def _relocate(self, request, mountain, mountain_form):
        """Move the mountain after its content was saved. The two writes are not one
        transaction, so a refusal here keeps what was saved and says so."""
        slug = mountain_form.cleaned_data["slug"]
        saved = HttpResponseRedirect(reverse("studio:mountain_detail", args=[slug]))
        name = mountain_form.cleaned_data["name"]

        if mountain_form.moves_the_mountain:
            try:
                outcome = self.writes.change_location.execute(
                    mountain.id,
                    mountain_form.coordinates,
                    camera_reset_confirmed=mountain_form.camera_reset_confirmed,
                )
            except UnknownMountain:
                return mountain_gone(request, name)
            except ApplicationError as error:
                if refusal_of(error, max_photograph_bytes=0) is None:
                    raise
                messages.warning(request, COORDINATES_NOT_SAVED)

                return HttpResponseRedirect(reverse("studio:mountain_edit", args=[slug]))
            if outcome is RelocationOutcome.APPLIED:
                messages.warning(request, COORDINATES_MOVED)

        messages.success(request, f"{name} was saved.")

        return saved


class MountainTransitionView(View):
    """Publish, unlist or list again: one status change of one mountain, by a POST.

    Unlisting asks first, with a page that says what it does, because it takes the mountain
    out of the mountain-of-the-day rotation.
    """

    get_mountain_detail: GetMountainDetail | None = None
    use_case: PublishMountain | DeactivateMountain | ReactivateMountain | None = None
    source: MountainStatus | None = None
    target_key: str = ""
    done: str = ""
    confirmation_template: str = ""

    def get(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        if detail.mountain.status is not self.source:
            label = representations.status_presentation(detail.mountain.status).label.lower()
            messages.info(
                request, f"{detail.mountain.name.en} is {label}, so there is nothing to change."
            )

            return HttpResponseRedirect(reverse("studio:mountain_detail", args=[slug]))

        return render(request, self.confirmation_template, {"mountain": detail.mountain})

    def post(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        mountain = detail.mountain
        try:
            self.use_case.execute(mountain.id)
        except UnknownMountain:
            return mountain_gone(request, mountain.name.en)
        except PublicationRejected as rejected:
            messages.error(
                request,
                f"{mountain.name.en} was not changed: "
                + " ".join(representations.violation_reasons(mountain, rejected.violations)),
            )
        except InvalidStatusTransition as invalid:
            messages.error(
                request,
                f"{mountain.name.en} was not changed: it is already "
                f"{representations.status_presentation(invalid.current).label.lower()}.",
            )
        else:
            security_log.log_security_event(
                security_log.PUBLICATION_CHANGED,
                user_id=str(request.user.pk),
                role=request.user.role,
                slug=mountain.slug,
                status=self.target_key,
            )
            messages.success(request, f"{mountain.name.en} {self.done}.")

        return HttpResponseRedirect(reverse("studio:mountain_detail", args=[slug]))


class DeleteDraftView(View):
    get_mountain_detail: GetMountainDetail | None = None
    delete_draft: DeleteDraftMountain | None = None
    media_base_url: str = ""

    def get(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        context = representations.deletion_context(detail.mountain, self.media_base_url)

        return render(request, "studio/mountain_delete.html", context)

    def post(self, request, slug):
        try:
            detail = self.get_mountain_detail.execute(slug)
        except MountainSlugNotFound:
            return not_found(request)

        mountain = detail.mountain
        try:
            self.delete_draft.execute(mountain.id)
        except UnknownMountain:
            return mountain_gone(request, mountain.name.en)
        except MountainNotDraft as refused:
            label = representations.status_presentation(refused.status).label.lower()
            messages.error(
                request,
                f"{mountain.name.en} is {label} and only a draft can be deleted. "
                "Nothing was deleted.",
            )

            return HttpResponseRedirect(reverse("studio:mountain_detail", args=[slug]))
        except MountainReferenced:
            messages.error(
                request,
                f"{mountain.name.en} was shown as the mountain of a day, so it cannot be deleted.",
            )

            return HttpResponseRedirect(reverse("studio:mountain_detail", args=[slug]))

        messages.success(request, f"The draft {mountain.name.en} was deleted.")

        return HttpResponseRedirect(reverse("studio:mountain_list"))
