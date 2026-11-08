from runpy import run_path

from tests.studio.production_settings import SETTINGS_FILE, load_production_settings

WHITENOISE = "whitenoise.middleware.WhiteNoiseMiddleware"
GUNICORN_CONFIGURATION = SETTINGS_FILE.parents[1] / "gunicorn.conf.py"


def test_production_serves_static_files_through_whitenoise_right_after_the_security_middleware(
    monkeypatch,
):
    loaded = load_production_settings(monkeypatch)

    assert loaded["MIDDLEWARE"][:2] == [
        "django.middleware.security.SecurityMiddleware",
        WHITENOISE,
    ]


def test_production_collects_hashed_compressed_static_files_into_the_static_root(monkeypatch):
    loaded = load_production_settings(monkeypatch)

    assert loaded["STORAGES"]["staticfiles"]["BACKEND"] == (
        "whitenoise.storage.CompressedManifestStaticFilesStorage"
    )
    assert loaded["STATIC_ROOT"] == SETTINGS_FILE.parent.parent / "staticfiles"


def test_development_keeps_the_framework_static_handling(monkeypatch):
    loaded = load_production_settings(
        monkeypatch,
        APP_ENV="development",
        MEDIA_STORE="filesystem",
        MEDIA_ROOT=".media",
        MEDIA_PUBLIC_BASE_URL="http://localhost:8000/media",
    )

    assert WHITENOISE not in loaded["MIDDLEWARE"]
    assert loaded["STORAGES"]["staticfiles"]["BACKEND"] == (
        "django.contrib.staticfiles.storage.StaticFilesStorage"
    )


def test_gunicorn_binds_the_port_the_platform_injects(monkeypatch):
    monkeypatch.setenv("PORT", "4321")

    assert run_path(str(GUNICORN_CONFIGURATION))["bind"] == "[::]:4321"


def test_gunicorn_creates_no_control_socket_in_the_working_directory():
    assert run_path(str(GUNICORN_CONFIGURATION))["control_socket_disable"] is True


def test_gunicorn_allows_in_flight_requests_to_finish_on_shutdown():
    configuration = run_path(str(GUNICORN_CONFIGURATION))

    assert configuration["graceful_timeout"] == 30
    assert configuration["timeout"] == 120


def test_gunicorn_never_derives_the_request_scheme_from_a_header(monkeypatch):
    # Django alone decides whether a request is HTTPS, from TRUSTED_PROXY_HOPS.
    assert run_path(str(GUNICORN_CONFIGURATION))["secure_scheme_headers"] == {}
