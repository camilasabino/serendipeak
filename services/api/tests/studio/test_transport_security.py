import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import Client

from tests.studio.production_settings import load_production_settings
from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    NEW_PASSWORD,
    PASSWORD,
    PASSWORD_URL,
    csrf_token_of,
)
from tests.support.users import create_user

HOST = "testserver"
PUBLIC_ORIGIN = f"https://{HOST}"
# The proxy forwards the public Host header untouched and states the scheme it received.
THROUGH_PROXY = {"x-forwarded-proto": "https", "host": HOST}
APPLIED_SETTINGS = (
    "SECURE_PROXY_SSL_HEADER",
    "CSRF_TRUSTED_ORIGINS",
    "SECURE_SSL_REDIRECT",
    "SECURE_REDIRECT_EXEMPT",
    "SECURE_HSTS_SECONDS",
    "SESSION_COOKIE_SECURE",
    "CSRF_COOKIE_SECURE",
)


@pytest.fixture
def load(monkeypatch):
    return lambda **overrides: load_production_settings(monkeypatch, **overrides)


@pytest.fixture
def deploy(load, settings):
    """Applies the settings a production environment produces to the running application."""

    def apply(**overrides):
        loaded = load(**overrides)
        for name in APPLIED_SETTINGS:
            setattr(settings, name, loaded[name])

        return Client(enforce_csrf_checks=True)

    return apply


def sign_in_form(client, **extra):
    page = client.get(LOGIN_URL, **extra)

    return csrf_token_of(page)


def post_credentials(client, token, *, headers):
    return client.post(
        LOGIN_URL,
        {"username": "camila-sabino", "password": PASSWORD, "csrfmiddlewaretoken": token},
        headers=headers,
    )


def test_one_trusted_proxy_makes_the_forwarded_scheme_believed_and_redirects(load):
    loaded = load()

    assert loaded["SECURE_PROXY_SSL_HEADER"] == ("HTTP_X_FORWARDED_PROTO", "https")
    assert loaded["SECURE_SSL_REDIRECT"] is True
    assert loaded["SECURE_REDIRECT_EXEMPT"] == [r"^healthz$"]
    assert loaded["CSRF_TRUSTED_ORIGINS"] == []
    assert loaded["SECURE_HSTS_SECONDS"] == 0


def test_cookies_are_secure_http_only_lax_and_scoped_to_the_studio(load):
    loaded = load()

    for kind in ("SESSION", "CSRF"):
        assert loaded[f"{kind}_COOKIE_SECURE"] is True
        assert loaded[f"{kind}_COOKIE_HTTPONLY"] is True
        assert loaded[f"{kind}_COOKIE_SAMESITE"] == "Lax"
        assert loaded[f"{kind}_COOKIE_PATH"] == "/studio/"
        assert loaded.get(f"{kind}_COOKIE_DOMAIN") is None


def test_an_unset_environment_name_is_production(load):
    loaded = load(APP_ENV=None)

    assert loaded["DEBUG"] is False
    assert loaded["SESSION_COOKIE_SECURE"] is True
    assert loaded["CSRF_COOKIE_SECURE"] is True


def test_a_misspelt_development_name_is_production(load):
    assert load(APP_ENV="dev")["DEBUG"] is False


def test_without_a_trusted_proxy_the_forwarded_scheme_is_ignored(load):
    loaded = load(TRUSTED_PROXY_HOPS="0", CSRF_TRUSTED_ORIGINS="https://api.example")

    assert loaded["SECURE_PROXY_SSL_HEADER"] is None
    assert loaded["SECURE_SSL_REDIRECT"] is False
    assert loaded["CSRF_TRUSTED_ORIGINS"] == ["https://api.example"]


def test_https_must_be_recognised_one_way_or_the_other(load):
    with pytest.raises(ImproperlyConfigured, match="HTTPS to be recognised"):
        load(TRUSTED_PROXY_HOPS="0")


def test_several_explicit_origins_are_accepted(load):
    loaded = load(CSRF_TRUSTED_ORIGINS="https://a.example,https://b.example:8443")

    assert loaded["CSRF_TRUSTED_ORIGINS"] == ["https://a.example", "https://b.example:8443"]


@pytest.mark.parametrize(
    "value",
    [
        "*",
        "https://*.example",
        "http://a.example",
        "https://a.example/",
        "https://a.example/studio",
        "https://user@a.example",
        "a.example",
        "https://a.example?x=1",
        "https://a.example:port",
    ],
)
def test_a_trusted_origin_must_be_one_bare_https_origin(load, value):
    with pytest.raises(ImproperlyConfigured, match="CSRF_TRUSTED_ORIGINS"):
        load(CSRF_TRUSTED_ORIGINS=value)


def test_redirecting_can_be_switched_off_explicitly(load):
    assert load(SECURE_SSL_REDIRECT="0")["SECURE_SSL_REDIRECT"] is False


def test_redirecting_without_a_trusted_proxy_would_loop_and_is_refused(load):
    with pytest.raises(ImproperlyConfigured, match="SECURE_SSL_REDIRECT"):
        load(
            TRUSTED_PROXY_HOPS="0",
            CSRF_TRUSTED_ORIGINS="https://api.example",
            SECURE_SSL_REDIRECT="1",
        )


@pytest.mark.parametrize("value", ["yes", "true", "2", "-1"])
def test_the_redirect_switch_is_zero_or_one(load, value):
    with pytest.raises(ImproperlyConfigured, match="SECURE_SSL_REDIRECT"):
        load(SECURE_SSL_REDIRECT=value)


def test_hsts_is_opt_in_and_never_covers_subdomains_or_preload(load):
    loaded = load(SECURE_HSTS_SECONDS="300")

    assert loaded["SECURE_HSTS_SECONDS"] == 300
    assert loaded["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is False
    assert loaded["SECURE_HSTS_PRELOAD"] is False


def test_hsts_without_a_trusted_proxy_would_never_be_sent_and_is_refused(load):
    with pytest.raises(ImproperlyConfigured, match="SECURE_HSTS_SECONDS"):
        load(
            TRUSTED_PROXY_HOPS="0",
            CSRF_TRUSTED_ORIGINS="https://api.example",
            SECURE_HSTS_SECONDS="300",
        )


@pytest.mark.parametrize("value", ["-1", "soon", "1.5"])
def test_a_malformed_hsts_period_is_refused(load, value):
    with pytest.raises(ImproperlyConfigured, match="SECURE_HSTS_SECONDS"):
        load(SECURE_HSTS_SECONDS=value)


@pytest.mark.parametrize(
    "value",
    [None, "", "*", "api.example,*", ".example.com", "https://api.example", "api.example:443"],
)
def test_the_allowed_hosts_must_be_exact_names(load, value):
    with pytest.raises(ImproperlyConfigured, match="ALLOWED_HOSTS"):
        load(ALLOWED_HOSTS=value)


def test_exact_hosts_are_accepted(load):
    loaded = load(ALLOWED_HOSTS="api.example,healthcheck.railway.app")

    assert loaded["ALLOWED_HOSTS"] == ["api.example", "healthcheck.railway.app"]


def test_local_http_keeps_working(load):
    loaded = load(
        APP_ENV="development",
        TRUSTED_PROXY_HOPS=None,
        ALLOWED_HOSTS=None,
        WEB_ORIGIN="http://localhost:3000",
        MEDIA_STORE="filesystem",
        MEDIA_ROOT=".media",
        MEDIA_PUBLIC_BASE_URL="http://localhost:8000/media",
    )

    assert loaded["SECURE_PROXY_SSL_HEADER"] is None
    assert loaded["SECURE_SSL_REDIRECT"] is False
    assert loaded["SECURE_HSTS_SECONDS"] == 0
    assert loaded["SESSION_COOKIE_SECURE"] is False
    assert loaded["CSRF_COOKIE_SECURE"] is False
    assert loaded["CSRF_TRUSTED_ORIGINS"] == []


def test_a_local_http_origin_may_be_trusted(load):
    loaded = load(
        APP_ENV="development",
        TRUSTED_PROXY_HOPS=None,
        WEB_ORIGIN="http://localhost:3000",
        MEDIA_STORE="filesystem",
        MEDIA_ROOT=".media",
        MEDIA_PUBLIC_BASE_URL="http://localhost:8000/media",
        CSRF_TRUSTED_ORIGINS="http://localhost:8000",
    )

    assert loaded["CSRF_TRUSTED_ORIGINS"] == ["http://localhost:8000"]


def test_the_sign_in_form_posted_from_the_public_origin_works(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    token = sign_in_form(client, headers=THROUGH_PROXY)

    response = post_credentials(client, token, headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN})

    assert response.status_code == 302
    assert response["Location"] == LANDING_URL


def test_the_framework_alone_refuses_that_post(db, deploy, settings):
    create_user("camila-sabino", password=PASSWORD)
    deploy()
    settings.SECURE_PROXY_SSL_HEADER = None
    settings.SECURE_SSL_REDIRECT = False
    client = Client(enforce_csrf_checks=True)
    token = sign_in_form(client)

    response = post_credentials(client, token, headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN})

    assert response.status_code == 403


def test_the_cookies_are_secure_and_scoped_to_the_studio(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    token = sign_in_form(client, headers=THROUGH_PROXY)
    csrf_cookie = client.cookies["studio_csrftoken"]

    response = post_credentials(client, token, headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN})
    session_cookie = response.cookies["studio_sessionid"]

    for cookie in (csrf_cookie, session_cookie):
        assert cookie["secure"]
        assert cookie["httponly"]
        assert cookie["samesite"] == "Lax"
        assert cookie["path"] == "/studio/"
        assert not cookie["domain"]


def test_a_signed_in_form_posted_from_the_public_origin_works(db, deploy):
    user = create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    client.force_login(user)
    token = csrf_token_of(client.get(PASSWORD_URL, headers=THROUGH_PROXY))

    response = client.post(
        PASSWORD_URL,
        {
            "old_password": PASSWORD,
            "new_password1": NEW_PASSWORD,
            "new_password2": NEW_PASSWORD,
            "csrfmiddlewaretoken": token,
        },
        headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN},
    )

    assert response.status_code == 302
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)


def test_a_post_without_an_origin_falls_back_to_a_matching_https_referer(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    token = sign_in_form(client, headers=THROUGH_PROXY)

    response = post_credentials(
        client, token, headers={**THROUGH_PROXY, "referer": f"{PUBLIC_ORIGIN}/studio/login/"}
    )

    assert response.status_code == 302


@pytest.mark.parametrize(
    "forged",
    [
        {"origin": "https://evil.example"},
        {"origin": f"http://{HOST}"},
        {"origin": f"https://{HOST}.evil.example"},
        {"origin": f"https://evil.example@{HOST}"},
        {"origin": "null"},
        {"referer": "https://evil.example/studio/login/"},
        {"referer": f"http://{HOST}/studio/login/"},
        {},
    ],
)
def test_a_forged_request_is_refused_even_with_a_valid_token(db, deploy, forged):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    token = sign_in_form(client, headers=THROUGH_PROXY)

    response = post_credentials(client, token, headers={**THROUGH_PROXY, **forged})

    assert response.status_code == 403
    assert "studio_sessionid" not in response.cookies


@pytest.mark.parametrize("token", ["", "short", "x" * 64])
def test_a_missing_or_invalid_token_is_refused_from_the_public_origin(db, deploy, token):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()
    sign_in_form(client, headers=THROUGH_PROXY)

    response = post_credentials(client, token, headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN})

    assert response.status_code == 403


def test_a_token_from_another_session_is_refused(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    other_token = sign_in_form(deploy(), headers=THROUGH_PROXY)
    client = deploy()
    sign_in_form(client, headers=THROUGH_PROXY)

    response = post_credentials(
        client, other_token, headers={**THROUGH_PROXY, "origin": PUBLIC_ORIGIN}
    )

    assert response.status_code == 403


def test_a_forwarded_scheme_other_than_https_is_not_secure(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()

    response = client.get(LOGIN_URL, headers={**THROUGH_PROXY, "x-forwarded-proto": "http"})

    assert response.status_code == 301
    assert response["Location"] == f"{PUBLIC_ORIGIN}{LOGIN_URL}"


@pytest.fixture
def listed(deploy):
    return lambda: deploy(TRUSTED_PROXY_HOPS="0", CSRF_TRUSTED_ORIGINS=PUBLIC_ORIGIN)


def test_a_listed_origin_is_accepted_whatever_the_forwarded_header_says(db, listed):
    create_user("camila-sabino", password=PASSWORD)
    client = listed()
    token = sign_in_form(client)

    response = post_credentials(client, token, headers={"origin": PUBLIC_ORIGIN})

    assert response.status_code == 302


def test_an_unlisted_origin_is_refused(db, listed):
    create_user("camila-sabino", password=PASSWORD)
    client = listed()
    token = sign_in_form(client)

    response = post_credentials(client, token, headers={"origin": "https://evil.example"})

    assert response.status_code == 403


def test_the_forwarded_scheme_is_not_believed(db, listed):
    client = listed()

    response = client.get(LOGIN_URL, headers=THROUGH_PROXY)

    assert response.status_code == 200
    assert "Strict-Transport-Security" not in response


def test_plain_http_is_sent_to_https_before_anything_is_served(db, deploy):
    client = deploy()

    response = client.get(LOGIN_URL)

    assert response.status_code == 301
    assert response["Location"] == f"{PUBLIC_ORIGIN}{LOGIN_URL}"


def test_a_post_over_plain_http_is_not_processed(db, deploy):
    create_user("camila-sabino", password=PASSWORD)
    client = deploy()

    response = client.post(LOGIN_URL, {"username": "camila-sabino", "password": PASSWORD})

    assert response.status_code == 301
    assert "studio_sessionid" not in response.cookies


def test_the_health_check_is_never_redirected(db, deploy):
    client = deploy()

    response = client.get("/healthz")

    assert response.status_code == 200


def test_a_request_through_the_proxy_is_served_once(db, deploy):
    client = deploy()

    response = client.get(LOGIN_URL, headers=THROUGH_PROXY)

    assert response.status_code == 200


def test_hsts_is_sent_on_secure_requests_only(db, deploy):
    client = deploy(SECURE_HSTS_SECONDS="300")

    secure = client.get(LOGIN_URL, headers=THROUGH_PROXY)
    api = client.get("/api/v1/mountains/unknown", headers=THROUGH_PROXY)

    assert secure["Strict-Transport-Security"] == "max-age=300"
    assert api["Strict-Transport-Security"] == "max-age=300"


def test_no_hsts_unless_asked_for(db, deploy):
    client = deploy()

    response = client.get(LOGIN_URL, headers=THROUGH_PROXY)

    assert "Strict-Transport-Security" not in response


def test_the_public_api_gains_no_header_from_the_security_middleware(db, deploy):
    client = deploy()

    response = client.get("/api/v1/mountains/unknown", headers=THROUGH_PROXY)

    for name in ("Referrer-Policy", "Cross-Origin-Opener-Policy", "X-Content-Type-Options"):
        assert name not in response
