import re
from dataclasses import dataclass, replace

from django.urls import resolve, reverse

from serendipeak.persistence.mapping import region_record
from serendipeak.persistence.models import MountainRecord, MountainRegionRecord
from tests.support.records import mountain_record
from tests.support.region_taxonomy import TAXONOMY, id_of

LIST_URL = reverse("studio:region_list")
NEW_URL = reverse("studio:region_new")


def detail_url(slug):
    return reverse("studio:region_detail", kwargs={"slug": slug})


def edit_url(slug):
    return reverse("studio:region_edit", kwargs={"slug": slug})


def move_url(slug):
    return reverse("studio:region_move", kwargs={"slug": slug})


def delete_url(slug):
    return reverse("studio:region_delete", kwargs={"slug": slug})


def seed(regions=TAXONOMY, mountains=()):
    """Save the regions, parents first, and the mountains as (slug, region slug, status)."""
    for entry in regions:
        region_record(entry).save(force_insert=True)
    for slug, region, status in mountains:
        mountain_record(
            slug=slug,
            name_en=slug.replace("-", " ").title(),
            region_id=id_of(region),
            status=status,
        ).save()


def parents():
    """Every region's parent slug, by slug."""
    return dict(MountainRegionRecord.objects.values_list("slug", "parent__slug"))


def region_of(slug):
    return MountainRegionRecord.objects.get(slug=slug)


def mountain_regions():
    return dict(MountainRecord.objects.values_list("slug", "region__slug"))


def messages_of(response):
    return re.findall(r'<span class="message__text">(.*?)</span>', response.content.decode(), re.S)


@dataclass
class FrozenDirectory:
    """Stands in for GetRegionDirectory: answers with a directory read earlier, as a page that
    was loaded before a colleague's change would have it."""

    directory: object

    def execute(self):
        return self.directory


def use_directory(monkeypatch, directory, url_name, **kwargs):
    initkwargs = resolve(reverse(url_name, kwargs=kwargs)).func.view_initkwargs
    administration = replace(initkwargs["administration"], get_directory=FrozenDirectory(directory))
    monkeypatch.setitem(initkwargs, "administration", administration)
