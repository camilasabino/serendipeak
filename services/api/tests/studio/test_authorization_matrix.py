import pytest
from django.test import Client, RequestFactory, override_settings
from django.urls import get_resolver, reverse

from serendipeak.accounts.roles import Role
from serendipeak.persistence.models import UserRecord
from serendipeak.studio.access import ACCESS_ATTRIBUTE, StudioAccess, declare_access
from serendipeak.studio.middleware import StudioAccessMiddleware
from tests.studio.support import LOGIN_URL
from tests.support.users import create_user

ANONYMOUS = "anonymous"
INACTIVE = "inactive"
VIEWER = "viewer"
EDITOR = "editor"
ACTORS = (ANONYMOUS, INACTIVE, VIEWER, EDITOR)

UNKNOWN_USER = "6f1f1f0e-0000-4000-8000-000000000001"
ALLOWED = ("status", 200)
FORBIDDEN = ("status", 403)


# Every Studio URL name, the request that exercises it, the access it must declare and the
# outcome for each kind of caller. A URL missing here fails test_the_matrix_lists_every_url,
# so adding a page means deciding who may use it.
MATRIX = {
    "studio:landing": {
        "method": "get",
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/"),
        VIEWER: ALLOWED,
        EDITOR: ALLOWED,
    },
    "studio:mountain_list": {
        "method": "get",
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/"),
        VIEWER: ALLOWED,
        EDITOR: ALLOWED,
    },
    "studio:mountain_detail": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/"),
        VIEWER: ("status", 404),
        EDITOR: ("status", 404),
    },
    "studio:mountain_new": {
        "method": "get",
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/new-mountain/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/new-mountain/"),
        VIEWER: FORBIDDEN,
        EDITOR: ALLOWED,
    },
    "studio:mountain_edit": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/edit/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/edit/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:mountain_camera": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/camera/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/camera/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:mountain_preview": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/preview/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/preview/"),
        VIEWER: ("status", 404),
        EDITOR: ("status", 404),
    },
    "studio:mountain_publish": {
        "method": "post",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", LOGIN_URL),
        INACTIVE: ("redirect", LOGIN_URL),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:mountain_unlist": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/unlist/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/unlist/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:mountain_relist": {
        "method": "post",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", LOGIN_URL),
        INACTIVE: ("redirect", LOGIN_URL),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:mountain_delete": {
        "method": "get",
        "kwargs": {"slug": "no-such-peak"},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/delete/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/mountains/no-such-peak/delete/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:discovery_list": {
        "method": "get",
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/daily-discoveries/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/daily-discoveries/"),
        VIEWER: ALLOWED,
        EDITOR: ALLOWED,
    },
    "studio:user_list": {
        "method": "get",
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/users/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/users/"),
        VIEWER: FORBIDDEN,
        EDITOR: ALLOWED,
    },
    "studio:user_edit": {
        "method": "get",
        "kwargs": {"user_id": UNKNOWN_USER},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/users/{UNKNOWN_USER}/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/users/{UNKNOWN_USER}/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:user_password": {
        "method": "get",
        "kwargs": {"user_id": UNKNOWN_USER},
        "declares": StudioAccess.EDITOR,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/users/{UNKNOWN_USER}/password/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/users/{UNKNOWN_USER}/password/"),
        VIEWER: FORBIDDEN,
        EDITOR: ("status", 404),
    },
    "studio:login": {
        "method": "get",
        "declares": StudioAccess.PUBLIC,
        ANONYMOUS: ALLOWED,
        INACTIVE: ALLOWED,
        VIEWER: ("redirect", "/studio/"),
        EDITOR: ("redirect", "/studio/"),
    },
    "studio:logout": {
        "method": "post",
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", LOGIN_URL),
        INACTIVE: ("redirect", LOGIN_URL),
        VIEWER: ("redirect", LOGIN_URL),
        EDITOR: ("redirect", LOGIN_URL),
    },
    "studio:password_change": {
        "method": "get",
        "declares": StudioAccess.VIEWER,
        ANONYMOUS: ("redirect", f"{LOGIN_URL}?next=/studio/password/"),
        INACTIVE: ("redirect", f"{LOGIN_URL}?next=/studio/password/"),
        VIEWER: ALLOWED,
        EDITOR: ALLOWED,
    },
}


def studio_routes(patterns=None, namespace=None):
    patterns = get_resolver().url_patterns if patterns is None else patterns
    for pattern in patterns:
        if hasattr(pattern, "url_patterns"):
            yield from studio_routes(pattern.url_patterns, pattern.namespace or namespace)
        elif namespace == "studio":
            yield f"studio:{pattern.name}", pattern.callback


def client_for(actor):
    client = Client()
    if actor == ANONYMOUS:
        return client
    if actor == INACTIVE:
        user = create_user("former-editor", Role.EDITOR)
        client.force_login(user)
        UserRecord.objects.filter(pk=user.pk).update(is_active=False)
    else:
        client.force_login(create_user(actor, Role(actor)))

    return client


def test_the_matrix_lists_every_url():
    routes = dict(studio_routes())

    assert set(routes) == set(MATRIX), (
        "every Studio URL must have a row in the authorization matrix; "
        f"missing: {sorted(set(routes) - set(MATRIX))}, stale: {sorted(set(MATRIX) - set(routes))}"
    )


@pytest.mark.parametrize("name", sorted(MATRIX))
def test_every_view_declares_the_access_the_matrix_expects(name):
    callback = dict(studio_routes())[name]

    assert getattr(callback, ACCESS_ATTRIBUTE) is MATRIX[name]["declares"]


def assert_outcome(response, expected):
    kind, value = expected
    if kind == "status":
        assert response.status_code == value
    else:
        assert response.status_code == 302
        assert response.headers["Location"] == value


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize("name", sorted(MATRIX))
def test_each_caller_gets_the_outcome_the_matrix_lists(db, name, actor):
    row = MATRIX[name]
    client = client_for(actor)

    response = getattr(client, row["method"])(reverse(name, kwargs=row.get("kwargs")))

    assert_outcome(response, row[actor])


def test_a_viewer_is_refused_an_editor_only_page_and_an_editor_is_not(db):
    def view(request):
        return None

    declare_access(StudioAccess.EDITOR, view)
    middleware = StudioAccessMiddleware(lambda request: None)

    outcomes = {}
    for role in Role:
        request = RequestFactory().get("/studio/anything/")
        request.user = create_user(f"{role.value}-user", role)
        response = middleware.process_view(request, view, (), {})
        outcomes[role] = None if response is None else response.status_code

    assert outcomes == {Role.EDITOR: None, Role.VIEWER: 403}


@override_settings(ROOT_URLCONF="tests.studio.undeclared_urls")
@pytest.mark.parametrize("actor", ACTORS)
def test_a_view_that_declares_no_access_is_refused_for_everyone(db, actor):
    response = client_for(actor).get("/studio/undeclared/")

    assert response.status_code == 403
    assert b"reached" not in response.content


@pytest.mark.parametrize("actor", ACTORS)
def test_an_unknown_studio_url_is_a_plain_404(db, actor):
    assert client_for(actor).get("/studio/no-such-page/").status_code == 404


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_an_anonymous_write_is_sent_to_sign_in_without_a_return_address(db, method):
    response = getattr(Client(), method)(reverse("studio:password_change"))

    assert response.status_code == 302
    assert response.headers["Location"] == LOGIN_URL


def test_the_public_api_is_not_behind_the_studio_gate(db):
    assert Client().get("/healthz").status_code in (200, 503)


USER_WRITES = (
    ("studio:user_edit", {"role": "viewer", "is_active": "on", "shown": "viewer:active"}),
    ("studio:user_password", {"new_password1": "x", "new_password2": "x"}),
)


@pytest.mark.parametrize("actor", [ANONYMOUS, INACTIVE, VIEWER])
@pytest.mark.parametrize(("name", "data"), USER_WRITES)
def test_only_an_active_editor_can_post_to_the_user_screens(db, name, data, actor):
    target = create_user("target", Role.VIEWER)
    before = UserRecord.objects.values_list("role", "is_active", "password").get(pk=target.pk)

    response = client_for(actor).post(reverse(name, kwargs={"user_id": target.pk}), data)

    assert response.status_code in (302, 403)
    if response.status_code == 302:
        assert response.headers["Location"] == LOGIN_URL
    assert (
        UserRecord.objects.values_list("role", "is_active", "password").get(pk=target.pk) == before
    )


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
@pytest.mark.parametrize(
    ("name", "actor", "status"),
    [
        ("studio:discovery_list", VIEWER, 405),
        ("studio:discovery_list", EDITOR, 405),
        ("studio:user_list", VIEWER, 403),
        ("studio:user_list", EDITOR, 405),
    ],
)
def test_daily_discoveries_and_the_user_list_accept_no_write(db, name, actor, status, method):
    response = getattr(client_for(actor), method)(reverse(name))

    assert response.status_code == status


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_no_user_can_be_deleted_or_replaced_through_the_studio(db, method):
    target = create_user("target", Role.VIEWER)
    client = client_for(EDITOR)

    for name in ("studio:user_edit", "studio:user_password"):
        response = getattr(client, method)(reverse(name, kwargs={"user_id": target.pk}))

        assert response.status_code == 405
    assert UserRecord.objects.filter(pk=target.pk).exists()
