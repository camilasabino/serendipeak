import pytest
from django.db import DEFAULT_DB_ALIAS, OperationalError, connection, connections


@pytest.fixture
def database_unavailable(monkeypatch):
    def fail_to_connect(self):
        raise OperationalError("connection refused: secret-host:5432")

    monkeypatch.setattr(type(connections[DEFAULT_DB_ALIAS]), "ensure_connection", fail_to_connect)


@pytest.mark.django_db
def test_healthz_returns_ok_when_database_is_available(client):
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/json; charset=utf-8"
    assert response.content == b'{"status":"ok"}'


@pytest.mark.django_db
def test_postgis_extension_is_available():
    with connection.cursor() as cursor:
        cursor.execute("SELECT PostGIS_Version()")
        version = cursor.fetchone()[0]

    assert version.startswith("3.6")


def test_healthz_returns_503_when_database_is_unavailable(client, database_unavailable):
    response = client.get("/healthz")

    assert response.status_code == 503
    assert response["Content-Type"] == "application/json; charset=utf-8"
    assert response.content == b'{"status":"database unavailable"}'


def test_healthz_rejects_unsafe_methods(client):
    assert client.post("/healthz").status_code == 405


def test_healthz_does_not_leak_error_details(client, database_unavailable):
    assert b"secret-host" not in client.get("/healthz").content
