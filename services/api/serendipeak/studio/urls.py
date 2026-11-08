from django.urls import path

from serendipeak.accounts.login_throttle import AdmitLoginAttempt, ClearLoginFailures
from serendipeak.catalog.change_mountain_camera import ChangeMountainCamera
from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.get_mountain_detail import GetMountainDetail
from serendipeak.catalog.get_mountain_form_options import GetMountainFormOptions
from serendipeak.catalog.issue_preview_token import IssuePreviewToken
from serendipeak.catalog.list_mountains import ListMountains
from serendipeak.studio.access import StudioAccess, declare_access
from serendipeak.studio.camera_views import CameraConfirmationView
from serendipeak.studio.mountain_views import (
    DeleteDraftView,
    EditMountainView,
    MountainTransitionView,
    MountainWrites,
    NewMountainView,
)
from serendipeak.studio.preview_views import MountainPreviewView
from serendipeak.studio.views import (
    LandingView,
    MountainDetailView,
    MountainListView,
    StudioLoginView,
    StudioLogoutView,
    StudioPasswordChangeView,
)


def studio_urlpatterns(
    *,
    admit_login_attempt: AdmitLoginAttempt,
    clear_login_failures: ClearLoginFailures,
    trusted_proxy_hops: int,
    list_mountains: ListMountains,
    get_mountain_detail: GetMountainDetail,
    get_mountain_form_options: GetMountainFormOptions,
    writes: MountainWrites,
    change_camera: ChangeMountainCamera,
    issue_preview: IssuePreviewToken,
    media_base_url: str,
    web_origin: str,
    max_photograph_bytes: int,
):
    """The Studio routes, each declaring who may call it. Mounted under /studio/."""
    mountain_form = {
        "get_mountain_detail": get_mountain_detail,
        "get_form_options": get_mountain_form_options,
        "writes": writes,
        "media_base_url": media_base_url,
        "web_origin": web_origin,
        "max_photograph_bytes": max_photograph_bytes,
    }

    return [
        path(
            "",
            declare_access(StudioAccess.VIEWER, LandingView.as_view()),
            name="landing",
        ),
        path(
            "mountains/",
            declare_access(
                StudioAccess.VIEWER,
                MountainListView.as_view(
                    list_mountains=list_mountains, media_base_url=media_base_url
                ),
            ),
            name="mountain_list",
        ),
        # Outside mountains/ because any valid slug, "new" included, is a mountain's address there.
        path(
            "new-mountain/",
            declare_access(StudioAccess.EDITOR, NewMountainView.as_view(**mountain_form)),
            name="mountain_new",
        ),
        path(
            "mountains/<str:slug>/",
            declare_access(
                StudioAccess.VIEWER,
                MountainDetailView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    media_base_url=media_base_url,
                    web_origin=web_origin,
                ),
            ),
            name="mountain_detail",
        ),
        path(
            "mountains/<str:slug>/edit/",
            declare_access(StudioAccess.EDITOR, EditMountainView.as_view(**mountain_form)),
            name="mountain_edit",
        ),
        path(
            "mountains/<str:slug>/camera/",
            declare_access(
                StudioAccess.EDITOR,
                CameraConfirmationView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    change_camera=change_camera,
                    web_origin=web_origin,
                    http_method_names=["get", "post", "options"],
                ),
            ),
            name="mountain_camera",
        ),
        path(
            "mountains/<str:slug>/preview/",
            declare_access(
                StudioAccess.VIEWER,
                MountainPreviewView.as_view(
                    issue_preview=issue_preview,
                    web_origin=web_origin,
                    http_method_names=["get", "options"],
                ),
            ),
            name="mountain_preview",
        ),
        path(
            "mountains/<str:slug>/publish/",
            declare_access(
                StudioAccess.EDITOR,
                MountainTransitionView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    use_case=writes.publish,
                    target_key="published",
                    done="is published",
                    http_method_names=["post", "options"],
                ),
            ),
            name="mountain_publish",
        ),
        path(
            "mountains/<str:slug>/unlist/",
            declare_access(
                StudioAccess.EDITOR,
                MountainTransitionView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    use_case=writes.deactivate,
                    source=MountainStatus.ACTIVE,
                    target_key="unlisted",
                    done="is unlisted",
                    confirmation_template="studio/mountain_unlist.html",
                    http_method_names=["get", "post", "options"],
                ),
            ),
            name="mountain_unlist",
        ),
        path(
            "mountains/<str:slug>/list/",
            declare_access(
                StudioAccess.EDITOR,
                MountainTransitionView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    use_case=writes.reactivate,
                    target_key="published",
                    done="is listed again",
                    http_method_names=["post", "options"],
                ),
            ),
            name="mountain_relist",
        ),
        path(
            "mountains/<str:slug>/delete/",
            declare_access(
                StudioAccess.EDITOR,
                DeleteDraftView.as_view(
                    get_mountain_detail=get_mountain_detail,
                    delete_draft=writes.delete_draft,
                    media_base_url=media_base_url,
                ),
            ),
            name="mountain_delete",
        ),
        path(
            "login/",
            declare_access(
                StudioAccess.PUBLIC,
                StudioLoginView.as_view(
                    admit_attempt=admit_login_attempt,
                    clear_failures=clear_login_failures,
                    trusted_proxy_hops=trusted_proxy_hops,
                ),
            ),
            name="login",
        ),
        path(
            "logout/",
            declare_access(StudioAccess.VIEWER, StudioLogoutView.as_view()),
            name="logout",
        ),
        path(
            "password/",
            declare_access(StudioAccess.VIEWER, StudioPasswordChangeView.as_view()),
            name="password_change",
        ),
    ]
