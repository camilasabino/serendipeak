from dataclasses import dataclass

from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.views import View

from serendipeak.accounts.roles import Role
from serendipeak.catalog.create_mountain_region import CreateMountainRegion
from serendipeak.catalog.delete_mountain_region import DeleteMountainRegion
from serendipeak.catalog.get_mountain_region import GetMountainRegion
from serendipeak.catalog.get_region_directory import GetRegionDirectory
from serendipeak.catalog.list_mountain_regions import SEARCH_MAX_LENGTH, ListMountainRegions
from serendipeak.catalog.move_mountain_region import MoveMountainRegion
from serendipeak.catalog.region_changes import (
    RegionInUse,
    RegionNameTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.region_directory import MoveRefusal
from serendipeak.catalog.regions import RegionSlugNotFound, UnknownRegion
from serendipeak.catalog.update_mountain_region import UpdateMountainRegion
from serendipeak.errors import ApplicationError, DomainError
from serendipeak.studio import region_messages as texts
from serendipeak.studio import region_representations as representations
from serendipeak.studio.region_forms import RegionForm, RegionMoveForm
from serendipeak.studio.region_refusals import refuse_in_form


@dataclass(frozen=True, slots=True)
class RegionAdministration:
    """The use cases the Studio's region screens read and write through."""

    list_regions: ListMountainRegions
    get_region: GetMountainRegion
    get_directory: GetRegionDirectory
    create: CreateMountainRegion
    update: UpdateMountainRegion
    move: MoveMountainRegion
    delete: DeleteMountainRegion


def region_not_found(request):
    return render(request, "studio/region_not_found.html", status=404)


def region_gone(request, name):
    messages.error(request, texts.REGION_GONE.format(name))

    return HttpResponseRedirect(reverse("studio:region_list"))


def _detail_redirect(slug):
    return HttpResponseRedirect(reverse("studio:region_detail", args=[slug]))


class RegionListView(View):
    administration: RegionAdministration | None = None

    def get(self, request):
        search = request.GET.get("q", "").strip()[:SEARCH_MAX_LENGTH]
        tree = self.administration.list_regions.execute(search=search)

        return render(
            request,
            "studio/region_list.html",
            representations.list_context(tree, search, Role(request.user.role).can_write),
        )


class RegionDetailView(View):
    administration: RegionAdministration | None = None

    def get(self, request, slug):
        try:
            detail = self.administration.get_region.execute(slug)
        except RegionSlugNotFound:
            return region_not_found(request)

        context = representations.detail_context(detail, Role(request.user.role).can_write)

        return render(request, "studio/region_detail.html", context)


class NewRegionView(View):
    administration: RegionAdministration | None = None

    def get(self, request):
        directory = self.administration.get_directory.execute()
        parent = directory.find(request.GET.get("parent", ""))
        initial_parent = None if parent is None else directory.option(parent.id)
        form = RegionForm(directory=directory, initial_parent=initial_parent)

        return self._page(request, form)

    def post(self, request):
        directory = self.administration.get_directory.execute()
        form = RegionForm(request.POST, directory=directory)
        if not form.is_valid():
            return self._page(request, form)

        try:
            created = self.administration.create.execute(form.new_region())
        except (ApplicationError, DomainError) as error:
            if not refuse_in_form(error, form, directory):
                raise

            return self._page(request, form)

        messages.success(request, f"{created.name.en} was created.")

        return _detail_redirect(created.slug)

    def _page(self, request, form):
        return render(request, "studio/region_form.html", {"form": form, "is_new": True})


class EditRegionView(View):
    administration: RegionAdministration | None = None

    def get(self, request, slug):
        directory = self.administration.get_directory.execute()
        summary = directory.find(slug)
        if summary is None:
            return region_not_found(request)

        form = RegionForm(directory=directory, stored=summary.region)

        return self._page(request, form, directory, summary)

    def post(self, request, slug):
        directory = self.administration.get_directory.execute()
        summary = directory.find(slug)
        if summary is None:
            return region_not_found(request)

        form = RegionForm(request.POST, directory=directory, stored=summary.region)
        if not form.is_valid():
            return self._page(request, form, directory, summary)

        try:
            saved = self.administration.update.execute(summary.id, form.region_update())
        except UnknownRegion:
            return region_gone(request, summary.region.name.en)
        except (ApplicationError, DomainError) as error:
            if not refuse_in_form(error, form, directory):
                raise

            return self._page(request, form, directory, summary)

        messages.success(request, f"{saved.name.en} was saved.")

        return _detail_redirect(saved.slug)

    def _page(self, request, form, directory, summary):
        context = {
            "form": form,
            "is_new": False,
            "summary": summary,
            "region": summary.region,
            "ancestors": directory.ancestors(summary.id),
        }

        return render(request, "studio/region_form.html", context)


class MoveRegionView(View):
    """Choose a destination, then confirm what the move changes, then move.

    Both steps are POSTs to this address. The second repeats the choice and the confirmation, and
    judges the destination again against the taxonomy as it is then.
    """

    administration: RegionAdministration | None = None

    def get(self, request, slug):
        directory = self.administration.get_directory.execute()
        summary = directory.find(slug)
        if summary is None:
            return region_not_found(request)

        form = RegionMoveForm(region=summary, choices=directory.move_choices(summary.id))

        return self._choose(request, form, directory, summary)

    def post(self, request, slug):
        directory = self.administration.get_directory.execute()
        summary = directory.find(slug)
        if summary is None:
            return region_not_found(request)

        form = RegionMoveForm(
            request.POST, region=summary, choices=directory.move_choices(summary.id)
        )
        if not form.is_valid():
            return self._choose(request, form, directory, summary)
        if request.POST.get("confirmed") != "yes":
            return self._confirm(request, form, directory, summary)

        try:
            moved = self.administration.move.execute(summary.id, form.target_id)
        except UnknownRegion as error:
            if error.region_id == summary.id:
                return region_gone(request, summary.region.name.en)
            form.add_error("parent", texts.DESTINATION_UNKNOWN)

            return self._choose(request, form, directory, summary)
        except RegionNameTaken as error:
            parent = directory.summary(error.parent_id)
            label = "The destination" if parent is None else parent.label
            form.add_error("parent", texts.NAME_TAKEN.format(parent=label, name=error.name))

            return self._choose(request, form, directory, summary)
        except RegionWouldDescendFromItself:
            form.add_error(
                "parent",
                texts.UNAVAILABLE.format(texts.move_refusal(MoveRefusal.INSIDE, "")),
            )

            return self._choose(request, form, directory, summary)

        messages.success(
            request,
            texts.moved(moved.name.en, summary.descendant_regions, summary.subtree_mountains),
        )

        return _detail_redirect(moved.slug)

    def _choose(self, request, form, directory, summary):
        context = {
            "form": form,
            "summary": summary,
            "region": summary.region,
            "ancestors": directory.ancestors(summary.id),
        }

        return render(request, "studio/region_move.html", context)

    def _confirm(self, request, form, directory, summary):
        impact = directory.move_impact(summary.id, form.target_id)
        context = {
            "form": form,
            "summary": summary,
            "region": summary.region,
            "ancestors": directory.ancestors(summary.id),
            **representations.move_impact_context(impact),
        }

        return render(request, "studio/region_move_confirm.html", context)


class DeleteRegionView(View):
    administration: RegionAdministration | None = None

    def get(self, request, slug):
        try:
            detail = self.administration.get_region.execute(slug)
        except RegionSlugNotFound:
            return region_not_found(request)

        context = representations.detail_context(detail, can_write=True)
        context["blocked"] = bool(detail.summary.child_regions or detail.summary.direct_mountains)

        return render(request, "studio/region_delete.html", context)

    def post(self, request, slug):
        directory = self.administration.get_directory.execute()
        summary = directory.find(slug)
        if summary is None:
            return region_not_found(request)

        name = summary.region.name.en
        try:
            self.administration.delete.execute(summary.id)
        except UnknownRegion:
            return region_gone(request, name)
        except RegionInUse as refused:
            messages.error(
                request,
                texts.IN_USE.format(
                    name=name,
                    children=texts.plural(refused.child_count, "child region"),
                    mountains=texts.plural(refused.mountain_count, "mountain"),
                ),
            )

            return HttpResponseRedirect(reverse("studio:region_delete", args=[slug]))

        messages.success(request, f"{name} was deleted.")
        parent = directory.summary(summary.region.parent_id) if summary.region.parent_id else None
        if parent is not None:
            return _detail_redirect(parent.slug)

        return HttpResponseRedirect(reverse("studio:region_list"))
