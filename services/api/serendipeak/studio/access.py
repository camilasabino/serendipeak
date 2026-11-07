from collections.abc import Callable
from enum import StrEnum

STUDIO_PATH_PREFIX = "/studio/"
ACCESS_ATTRIBUTE = "studio_access"


class StudioAccess(StrEnum):
    PUBLIC = "public"
    VIEWER = "viewer"
    EDITOR = "editor"


def declare_access(access: StudioAccess, view: Callable) -> Callable:
    """Record who may call a Studio view.

    The declaration enforces nothing by itself: StudioAccessMiddleware reads it for every request
    under the Studio prefix, and a view without one is refused, so forgetting it closes a page
    instead of opening it.
    """
    setattr(view, ACCESS_ATTRIBUTE, access)

    return view


def is_studio_path(path: str) -> bool:
    return path.startswith(STUDIO_PATH_PREFIX)
