import datetime
import re

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import resolve, reverse

from serendipeak.catalog.entities import MountainStatus
from serendipeak.discovery.history import ListDailyDiscoveries
from serendipeak.discovery.retention import RETENTION_DAYS
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.discovery_history_reader import DjangoDiscoveryHistoryReader
from tests.studio.support import text_of
from tests.support.catalog import catalog_discovery, catalog_mountain, catalog_of
from tests.support.fakes import FixedClock

URL = reverse("studio:discovery_list")
TODAY = datetime.date(2026, 11, 8)
ACONCAGUA = catalog_mountain("aconcagua")
DENALI = catalog_mountain("denali")
RETIRED = catalog_mountain("retired-peak", status=MountainStatus.INACTIVE)


def days_ago(count):
    return TODAY - datetime.timedelta(days=count)


@pytest.fixture(autouse=True)
def today_is_fixed(monkeypatch):
    initkwargs = resolve(URL).func.view_initkwargs
    monkeypatch.setitem(
        initkwargs,
        "list_discoveries",
        ListDailyDiscoveries(DjangoDiscoveryHistoryReader(), FixedClock(TODAY)),
    )


def load(discoveries, *mountains):
    DjangoCatalogStore().load(
        catalog_of(*(mountains or (ACONCAGUA, DENALI)), discoveries=discoveries)
    )


def rows_of(body):
    return re.findall(r"<tbody>(.*?)</tbody>", body, re.S)[0].split("</tr>")[:-1]


def test_it_lists_the_days_newest_first_with_the_mountain_its_status_and_when_recorded(
    editor_client,
):
    load(
        [
            catalog_discovery(days_ago(2), RETIRED),
            catalog_discovery(TODAY, ACONCAGUA),
            catalog_discovery(days_ago(1), DENALI),
        ],
        ACONCAGUA,
        DENALI,
        RETIRED,
    )

    body = text_of(editor_client.get(URL))
    rows = rows_of(body)

    assert len(rows) == 3
    assert "Sun 8 Nov 2026" in rows[0] and "Today" in rows[0]
    assert 'href="/studio/mountains/aconcagua/"' in rows[0]
    assert "status--published" in rows[0]
    assert "Sat 7 Nov 2026" in rows[1] and "Today" not in rows[1]
    assert "Fri 6 Nov 2026" in rows[2] and 'href="/studio/mountains/retired-peak/"' in rows[2]
    assert "status--unlisted" in rows[2]
    assert "8 Nov 2026, 01:19 UTC" in rows[0]
    assert "3 days recorded." in body


def test_a_viewer_reads_the_same_page(viewer_client, editor_client):
    load([catalog_discovery(TODAY, ACONCAGUA)])

    assert rows_of(text_of(viewer_client.get(URL))) == rows_of(text_of(editor_client.get(URL)))


def test_the_page_offers_nothing_to_change(editor_client):
    load([catalog_discovery(TODAY, ACONCAGUA)])

    body = text_of(editor_client.get(URL))

    table = re.search(r"<table.*</table>", body, re.S).group(0)
    assert "<form" not in table and "<button" not in table and "<input" not in table
    assert re.findall(r'href="([^"]+)"', table) == ["/studio/mountains/aconcagua/"]
    assert not re.search(r"\b(Edit|Delete|Remove|Add)\b", table)


def test_only_the_retention_window_is_shown_at_most_366_rows(
    editor_client, django_assert_num_queries
):
    discoveries = [
        catalog_discovery(days_ago(count), (ACONCAGUA, DENALI)[count % 2])
        for count in range(RETENTION_DAYS + 40)
    ]
    load(discoveries)

    with CaptureQueriesContext(connection) as captured:
        body = text_of(editor_client.get(URL))

    assert len(rows_of(body)) == 366
    assert days_ago(RETENTION_DAYS).strftime("%a %-d %b %Y") in body
    assert days_ago(RETENTION_DAYS + 1).strftime("%a %-d %b %Y") not in body
    assert f"Days before {days_ago(RETENTION_DAYS):%-d %b %Y} are no longer kept." in body
    listing = [q for q in captured.captured_queries if '"daily_discovery"' in q["sql"]]
    assert len(listing) == 1


def test_an_empty_history_says_so(editor_client):
    body = text_of(editor_client.get(URL))

    assert "No days recorded yet" in body
    assert "<table" not in body


def test_the_nav_offers_the_page_to_both_roles_and_marks_it(viewer_client, editor_client):
    for client in (viewer_client, editor_client):
        body = text_of(client.get(URL))

        assert re.search(
            r'<a class="app-nav__link" href="/studio/daily-discoveries/" aria-current="page">'
            r"Daily discoveries</a>",
            body,
        )
