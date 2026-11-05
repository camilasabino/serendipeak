from django.urls import path, register_converter
from django.views.decorators.cache import cache_control

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.slug import RESERVED_SLUGS
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.views import MountainBySlugView, RandomMountainView, TodaysMountainView


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


def mountain_urlpatterns(
    *,
    get_mountain: GetMountainBySlug,
    get_todays_mountain: GetTodaysMountain,
    get_random_mountain: GetRandomMountain,
    media_base_url: str,
):
    # The wrapper also covers the error responses, which DRF returns from inside the view.
    no_store = cache_control(no_store=True)

    return [
        path(
            "api/v1/mountains/today",
            no_store(
                TodaysMountainView.as_view(
                    get_todays_mountain=get_todays_mountain, media_base_url=media_base_url
                )
            ),
        ),
        path(
            "api/v1/mountains/random",
            no_store(
                RandomMountainView.as_view(
                    get_random_mountain=get_random_mountain, media_base_url=media_base_url
                )
            ),
        ),
        path(
            "api/v1/mountains/<mountain_slug:slug>",
            MountainBySlugView.as_view(get_mountain=get_mountain, media_base_url=media_base_url),
        ),
    ]
