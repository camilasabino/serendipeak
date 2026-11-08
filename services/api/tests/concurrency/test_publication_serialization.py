import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection, transaction
from django.db.models.functions import Now

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.ports import StatusChangeOutcome
from serendipeak.catalog.publication import PublicationViolation, publication_violations
from serendipeak.catalog.status_transitions import PUBLISH
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from serendipeak.persistence.mountain_status_store import DjangoMountainStatusStore
from tests.support.catalog import catalog_mountain, catalog_of
from tests.support.concurrency import (
    WAIT_SECONDS,
    a_backend_is_waiting_for_a_row_lock,
    wait_until,
)

pytestmark = pytest.mark.django_db(transaction=True)

DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
CALLERS = 8


@pytest.fixture
def catalog():
    DjangoCatalogStore().load(catalog_of(DRAFT))


def test_a_publication_waits_for_an_edit_in_flight_and_judges_what_it_committed(catalog):
    edit_holds_the_row = threading.Event()
    commit_the_edit = threading.Event()

    def edit_the_photograph():
        try:
            with transaction.atomic():
                MountainRecord.objects.filter(pk=DRAFT.mountain.id).update(updated_at=Now())
                MountainImageRecord.objects.filter(pk=DRAFT.mountain.id).update(
                    original_key=None, original_sha256=None, page_key=None, viewer_key=None
                )
                edit_holds_the_row.set()
                assert commit_the_edit.wait(WAIT_SECONDS)
        finally:
            connection.close()

    def publish():
        try:
            return DjangoMountainStatusStore().change_status(
                DRAFT.mountain.id, PUBLISH, publication_violations
            )
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        edit = pool.submit(edit_the_photograph)
        assert edit_holds_the_row.wait(WAIT_SECONDS)
        publication = pool.submit(publish)

        wait_until(a_backend_is_waiting_for_a_row_lock)
        assert not publication.done()
        commit_the_edit.set()

        change = publication.result(WAIT_SECONDS)
        edit.result(WAIT_SECONDS)

    assert change.outcome is StatusChangeOutcome.REJECTED
    assert change.violations == (PublicationViolation.IMAGE_MEDIA_MISSING,)
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "draft"


def test_concurrent_publications_of_one_draft_apply_exactly_once(catalog):
    start = threading.Barrier(CALLERS)

    def publish(_):
        try:
            start.wait()
            return DjangoMountainStatusStore().change_status(
                DRAFT.mountain.id, PUBLISH, publication_violations
            )
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=CALLERS) as pool:
        outcomes = [change.outcome for change in pool.map(publish, range(CALLERS))]

    assert outcomes.count(StatusChangeOutcome.APPLIED) == 1
    assert outcomes.count(StatusChangeOutcome.WRONG_STATUS) == CALLERS - 1
    assert MountainRecord.objects.get(pk=DRAFT.mountain.id).status == "active"
