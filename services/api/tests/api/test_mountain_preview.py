import json
import logging
from datetime import UTC, datetime, timedelta

import pytest
from django.conf import settings
from django.core import signing

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.draft_mountain_deletion_store import DjangoDraftMountainDeletionStore
from serendipeak.tokens.signed_preview_tokens import SignedPreviewTokens
from tests.support.catalog import catalog_mountain, catalog_of, fixture_catalog_with_media
from tests.support.contract_fixtures import load_fixture

URL = "/api/v1/previews/mountain"
CONTENT_TYPE = "application/json; charset=utf-8"
NOT_FOUND = load_fixture("error-mountain-not-found.json")
UNAUTHORIZED = {"error": {"code": "PREVIEW_NOT_AUTHORIZED", "message": "Preview is not authorized"}}

COMPLETE = catalog_mountain("complete-draft", status=MountainStatus.DRAFT)
BARE = catalog_mountain(
    "bare-draft", status=MountainStatus.DRAFT, camera=None, primary_image=None, summary=None
)
PUBLISHED = catalog_mountain("published-peak")


@pytest.fixture
def catalog(db):
    DjangoCatalogStore().load(
        catalog_of(*fixture_catalog_with_media().mountains, COMPLETE, BARE, PUBLISHED)
    )


def token_for(entry, *, key=None, age=timedelta(0)):
    return SignedPreviewTokens(key or settings.PREVIEW_SIGNING_KEY).issue(
        entry.mountain.id, datetime.now(UTC) - age
    )


def preview(client, token):
    return client.get(URL, HTTP_AUTHORIZATION=f"Bearer {token}")


def body(response):
    return json.loads(response.content)


def assert_private(response):
    assert response["Content-Type"] == CONTENT_TYPE
    assert set(response["Cache-Control"].replace(" ", "").split(",")) == {"private", "no-store"}
    assert response["X-Robots-Tag"] == "noindex"


def test_a_draft_is_served_in_the_public_representation_with_its_saved_data(catalog, client):
    response = preview(client, token_for(COMPLETE))

    assert response.status_code == 200
    assert_private(response)
    served = body(response)
    assert served["slug"] == "complete-draft"
    assert served["id"] == str(COMPLETE.mountain.id)
    assert served["camera"]["headingDegrees"] == COMPLETE.mountain.camera.heading_degrees
    assert served["primaryImage"]["author"]
    assert served["summary"] == "Highest mountain outside Asia."


def test_a_draft_with_neither_camera_nor_photograph_is_served_without_them(catalog, client):
    response = preview(client, token_for(BARE))

    assert response.status_code == 200
    served = body(response)
    assert served["slug"] == "bare-draft"
    assert "camera" not in served
    assert "primaryImage" not in served
    assert "summary" not in served
    assert served["region"] is not None


def test_the_same_draft_stays_a_404_on_every_public_route(catalog, client):
    token = token_for(COMPLETE)
    assert preview(client, token).status_code == 200

    public = client.get("/api/v1/mountains/complete-draft")

    assert public.status_code == 404
    assert body(public) == NOT_FOUND
    assert "Authorization" not in public.headers
    assert "complete-draft" not in client.get("/api/v1/mountains/random").content.decode()


def test_a_token_reads_only_its_own_mountain(catalog, client):
    response = preview(client, token_for(COMPLETE))

    assert body(response)["slug"] == "complete-draft"
    assert body(preview(client, token_for(BARE)))["slug"] == "bare-draft"


def test_a_published_mountain_is_not_served_through_a_preview(catalog, client):
    response = preview(client, token_for(PUBLISHED))

    assert response.status_code == 404
    assert body(response) == NOT_FOUND
    assert_private(response)


def test_a_token_for_a_deleted_draft_is_not_found(catalog, client):
    token = token_for(COMPLETE)
    DjangoDraftMountainDeletionStore().delete_draft(COMPLETE.mountain.id)

    response = preview(client, token)

    assert response.status_code == 404
    assert body(response) == NOT_FOUND
    assert_private(response)


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "",
        "Bearer",
        "Bearer ",
        "Basic abc",
        "bearer lower",
        "Bearer garbage",
        "Bearer " + "a" * 5000,
        "Bearer \x00",
    ],
)
def test_a_missing_or_malformed_credential_is_refused_uniformly(catalog, client, authorization):
    headers = {} if authorization is None else {"HTTP_AUTHORIZATION": authorization}

    response = client.get(URL, **headers)

    assert response.status_code == 401
    assert body(response) == UNAUTHORIZED
    assert_private(response)


@pytest.mark.parametrize(
    "case",
    ["expired", "other-key", "tampered", "salt-less"],
)
def test_every_kind_of_bad_token_gets_the_same_answer(catalog, client, case):
    token = {
        "expired": lambda: token_for(COMPLETE, age=timedelta(minutes=15, seconds=5)),
        "other-key": lambda: token_for(COMPLETE, key="x" * 40),
        "tampered": lambda: token_for(COMPLETE)[:-2] + "AA",
        "salt-less": lambda: signing.dumps(
            {"mountain": str(COMPLETE.mountain.id), "scope": "mountain-preview"},
            key=settings.PREVIEW_SIGNING_KEY,
        ),
    }[case]()

    response = preview(client, token)

    assert response.status_code == 401
    assert body(response) == UNAUTHORIZED
    assert_private(response)


def test_a_token_still_works_just_before_it_expires(catalog, client):
    assert preview(client, token_for(COMPLETE, age=timedelta(minutes=14))).status_code == 200


def test_a_preview_is_three_queries_and_a_refusal_none(catalog, client, django_assert_num_queries):
    token = token_for(COMPLETE)

    with django_assert_num_queries(3):
        assert preview(client, token).status_code == 200

    with django_assert_num_queries(0):
        assert preview(client, "garbage").status_code == 401


def test_the_credential_stays_out_of_the_logs(catalog, client, caplog):
    caplog.set_level(logging.DEBUG)
    token = token_for(COMPLETE)

    preview(client, token)
    preview(client, token + "x")

    assert token not in caplog.text


def test_the_endpoint_accepts_only_get(catalog, client):
    token = token_for(COMPLETE)

    for method in ("post", "put", "patch", "delete"):
        response = getattr(client, method)(URL, HTTP_AUTHORIZATION=f"Bearer {token}")

        assert response.status_code == 405
        assert "complete-draft" not in response.content.decode()


def test_the_credential_in_the_query_string_is_not_accepted(catalog, client):
    response = client.get(f"{URL}?token={token_for(COMPLETE)}")

    assert response.status_code == 401
