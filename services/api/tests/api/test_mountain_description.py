import json
from datetime import UTC, datetime

import pytest
from django.conf import settings

from serendipeak.catalog.entities import MountainStatus
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.tokens.signed_preview_tokens import SignedPreviewTokens
from tests.support.catalog import catalog_mountain, catalog_of

pytestmark = pytest.mark.django_db

DESCRIPTION = "The first paragraph.\n\nThe second, with a soft\nbreak and an é."
DRAFT_DESCRIPTION = "A draft's text.\n\nSecond."


def served(client, path, **headers):
    response = client.get(path, **headers)

    assert response.status_code == 200
    return json.loads(response.content)


def preview_of(client, entry):
    token = SignedPreviewTokens(settings.PREVIEW_SIGNING_KEY).issue(
        entry.mountain.id, datetime.now(UTC)
    )

    return served(client, "/api/v1/previews/mountain", HTTP_AUTHORIZATION=f"Bearer {token}")


def load(*entries):
    DjangoCatalogStore().load(catalog_of(*entries))


def test_a_mountain_is_served_with_the_paragraphs_of_its_description(client):
    load(catalog_mountain("described-peak", description=DESCRIPTION))

    mountain = served(client, "/api/v1/mountains/described-peak")

    assert mountain["description"] == DESCRIPTION
    assert mountain["summary"] == "Highest mountain outside Asia."


def test_the_description_is_absent_not_null_without_one(client):
    load(catalog_mountain("plain-peak"))

    mountain = served(client, "/api/v1/mountains/plain-peak")

    assert "description" not in mountain


def test_todays_mountain_carries_its_description(client):
    load(catalog_mountain("described-peak", description=DESCRIPTION))

    today = served(client, "/api/v1/mountains/today")

    assert today["mountain"]["description"] == DESCRIPTION


def test_a_random_mountain_carries_its_description(client):
    load(catalog_mountain("described-peak", description=DESCRIPTION))

    assert served(client, "/api/v1/mountains/random")["description"] == DESCRIPTION


def test_an_unlisted_mountain_keeps_its_description(client):
    load(catalog_mountain("old-peak", status=MountainStatus.INACTIVE, description=DESCRIPTION))

    assert served(client, "/api/v1/mountains/old-peak")["description"] == DESCRIPTION


def test_the_preview_of_a_draft_carries_its_description(client):
    draft = catalog_mountain(
        "draft-peak", status=MountainStatus.DRAFT, description=DRAFT_DESCRIPTION
    )
    plain = catalog_mountain("plain-draft", status=MountainStatus.DRAFT)
    load(draft, plain)

    assert preview_of(client, draft)["description"] == DRAFT_DESCRIPTION
    assert "description" not in preview_of(client, plain)


def test_the_index_does_not_carry_the_description(client):
    load(catalog_mountain("described-peak", description=DESCRIPTION))

    entry = served(client, "/api/v1/mountains")["mountains"][0]

    assert "description" not in entry
    assert "summary" not in entry
