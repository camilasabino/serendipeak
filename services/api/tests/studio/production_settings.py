from pathlib import Path
from runpy import run_path

SETTINGS_FILE = Path(__file__).resolve().parents[2] / "config" / "settings.py"
MEDIA_ENVIRONMENT = {
    "MEDIA_STORE": "s3",
    "MEDIA_PUBLIC_BASE_URL": "https://media.example",
    "MEDIA_S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.example",
    "MEDIA_S3_ACCESS_KEY_ID": "access-key",
    "MEDIA_S3_SECRET_ACCESS_KEY": "secret-key",
    "MEDIA_PUBLIC_BUCKET": "photographs-public",
    "MEDIA_ORIGINALS_BUCKET": "photographs-originals",
}
# What a production deployment behind one TLS-terminating proxy sets, apart from the secrets that
# every test environment already provides.
PRODUCTION_ENVIRONMENT = {
    "APP_ENV": "production",
    "ALLOWED_HOSTS": "testserver",
    "WEB_ORIGIN": "https://web.example",
    "PREVIEW_SIGNING_KEY": "p" * 40,
    "TRUSTED_PROXY_HOPS": "1",
    **MEDIA_ENVIRONMENT,
}
OPTIONAL_SETTINGS = ("CSRF_TRUSTED_ORIGINS", "SECURE_SSL_REDIRECT", "SECURE_HSTS_SECONDS")


def load_production_settings(monkeypatch, **overrides):
    """Runs config/settings.py under the given environment; None removes a variable."""
    for name in OPTIONAL_SETTINGS:
        monkeypatch.delenv(name, raising=False)

    for name, value in {**PRODUCTION_ENVIRONMENT, **overrides}.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    return run_path(str(SETTINGS_FILE))
