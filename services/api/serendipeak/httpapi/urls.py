from django.urls import path, register_converter

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.slug import RESERVED_SLUGS
from serendipeak.httpapi.views import MountainBySlugView


class MountainPathSlugConverter:
    regex = "[^/]+"

    def to_python(self, value: str) -> str:
        # Reserved words name routes of their own (today, random), never a mountain.
        if value in RESERVED_SLUGS:
            raise ValueError(value)
        return value

    def to_url(self, value: str) -> str:
        return value


register_converter(MountainPathSlugConverter, "mountain_slug")


def mountain_urlpatterns(*, get_mountain: GetMountainBySlug):
    return [
        path(
            "api/v1/mountains/<mountain_slug:slug>",
            MountainBySlugView.as_view(get_mountain=get_mountain),
        ),
    ]
