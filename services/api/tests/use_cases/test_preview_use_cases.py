import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.errors import (
    InvalidPreviewToken,
    MountainNotInDraft,
    MountainSlugNotFound,
    PreviewUnavailable,
)
from serendipeak.catalog.get_mountain_preview import GetMountainPreview
from serendipeak.catalog.issue_preview_token import IssuePreviewToken
from serendipeak.tokens.signed_preview_tokens import PREVIEW_LIFETIME, SignedPreviewTokens
from tests.support.catalog import mountain
from tests.support.fakes import InMemoryMountainCatalogReader, ManualClock

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
DRAFT = mountain("draft-peak", status=MountainStatus.DRAFT, camera=None, primary_image=None)
OTHER_DRAFT = mountain("other-draft", status=MountainStatus.DRAFT)
PUBLISHED = mountain("aconcagua")
UNLISTED = mountain("old-peak", status=MountainStatus.INACTIVE)


def build(*mountains, clock=None):
    reader = InMemoryMountainCatalogReader(mountains)
    tokens = SignedPreviewTokens("k" * 40)
    clock = clock or ManualClock(NOW)

    return IssuePreviewToken(reader, tokens, clock), GetMountainPreview(reader, tokens, clock)


def test_a_draft_gets_a_token_that_reads_back_that_draft():
    issue, read = build(DRAFT, OTHER_DRAFT)

    grant = issue.execute("draft-peak")

    assert grant.slug == "draft-peak"
    assert read.execute(grant.token) == DRAFT


@pytest.mark.parametrize("slug", ["unknown-peak", "Draft-Peak", "a/b", "\x00", "a" * 10_000])
def test_issuing_for_an_unknown_or_malformed_slug_is_not_found(slug):
    issue, _ = build(DRAFT)

    with pytest.raises(MountainSlugNotFound):
        issue.execute(slug)


@pytest.mark.parametrize("slug", ["aconcagua", "old-peak"])
def test_a_public_mountain_gets_no_token(slug):
    issue, _ = build(PUBLISHED, UNLISTED)

    with pytest.raises(MountainNotInDraft):
        issue.execute(slug)


def test_a_token_is_for_one_mountain_only():
    issue, read = build(DRAFT, OTHER_DRAFT)

    assert read.execute(issue.execute("other-draft").token) == OTHER_DRAFT


def test_a_token_stops_working_after_fifteen_minutes():
    clock = ManualClock(NOW)
    issue, read = build(DRAFT, clock=clock)
    token = issue.execute("draft-peak").token

    clock.advance(PREVIEW_LIFETIME - timedelta(seconds=1))
    assert read.execute(token) == DRAFT

    clock.advance(timedelta(seconds=1))
    with pytest.raises(InvalidPreviewToken):
        read.execute(token)


@pytest.mark.parametrize("token", ["", "garbage", "a:b:c"])
def test_a_token_that_is_not_ours_is_refused(token):
    _, read = build(DRAFT)

    with pytest.raises(InvalidPreviewToken):
        read.execute(token)


def test_a_token_for_a_deleted_mountain_is_unavailable():
    issue, _ = build(DRAFT)
    token = issue.execute("draft-peak").token
    _, read = build()

    with pytest.raises(PreviewUnavailable) as raised:
        read.execute(token)

    assert raised.value.mountain_id == DRAFT.id


def test_a_token_stops_reading_a_mountain_once_it_is_published():
    issue, _ = build(DRAFT)
    token = issue.execute("draft-peak").token
    _, read = build(replace(DRAFT, status=MountainStatus.ACTIVE))

    with pytest.raises(PreviewUnavailable):
        read.execute(token)


def test_an_unknown_id_in_a_valid_token_is_unavailable_not_an_error():
    tokens = SignedPreviewTokens("k" * 40)
    token = tokens.issue(uuid.uuid4(), NOW)
    _, read = build(DRAFT)

    with pytest.raises(PreviewUnavailable):
        read.execute(token)
