from functools import wraps

from django.urls import path, register_converter
from django.utils.cache import patch_cache_control
from django.views.decorators.cache import cache_control

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.catalog.get_mountain_index import GetMountainIndex
from serendipeak.catalog.get_mountain_preview import GetMountainPreview
from serendipeak.catalog.slug import RESERVED_SLUGS
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.views import (
    MountainBySlugView,
    MountainIndexView,
    MountainPreviewView,
    RandomMountainView,
    TodaysMountainView,
)


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

# Short enough that a newly published or deactivated mountain reaches visitors within minutes,
# without a deployment of the web.
MOUNTAIN_INDEX_MAX_AGE_SECONDS = 300


def noindex(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        response = view(*args, **kwargs)
        response["X-Robots-Tag"] = "noindex"

        return response

    return wrapped


def cached_when_successful(view, *, max_age: int):
    """Let browsers and shared caches keep a successful answer; an error is never stored, so a
    failure clears as soon as the API recovers."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        response = view(*args, **kwargs)
        if response.status_code == 200:
            patch_cache_control(response, public=True, max_age=max_age)
        else:
            patch_cache_control(response, no_store=True)

        return response

    return wrapped


def mountain_urlpatterns(
    *,
    get_mountain: GetMountainBySlug,
    get_index: GetMountainIndex,
    get_todays_mountain: GetTodaysMountain,
    get_random_mountain: GetRandomMountain,
    get_preview: GetMountainPreview,
    media_base_url: str,
):
    # The wrapper also covers the error responses, which DRF returns from inside the view.
    no_store = cache_control(no_store=True)

    return [
        # Unpublished data: never cached and never indexed, error answers included.
        path(
            "api/v1/previews/mountain",
            noindex(
                cache_control(private=True, no_store=True)(
                    MountainPreviewView.as_view(
                        get_preview=get_preview, media_base_url=media_base_url
                    )
                )
            ),
        ),
        path(
            "api/v1/mountains",
            cached_when_successful(
                MountainIndexView.as_view(get_index=get_index),
                max_age=MOUNTAIN_INDEX_MAX_AGE_SECONDS,
            ),
        ),
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
