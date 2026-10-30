import datetime

import pytest

from serendipeak.discovery.entities import RecentDiscovery
from serendipeak.discovery.selection import RECENT_WINDOW_DAYS, recent_window, select_daily_slug


def day(value):
    return datetime.date.fromisoformat(value)


def discovery(date, slug):
    return RecentDiscovery(date=day(date), slug=slug)


@pytest.mark.parametrize(
    ("date", "recent", "expected"),
    [
        ("2026-10-02", [], "aconcagua"),
        ("2026-10-04", [], "mount-fuji"),
        ("2026-10-07", [], "denali"),
        ("2026-10-02", [discovery("2026-10-01", "aconcagua")], "mount-fuji"),
        ("2026-10-04", [discovery("2026-10-03", "mount-fuji")], "aconcagua"),
        ("2026-10-02", [discovery("2026-09-01", "aconcagua")], "aconcagua"),
    ],
    ids=[
        "2026-10-02",
        "2026-10-04",
        "2026-10-07",
        "recent aconcagua is skipped",
        "recent mount-fuji is skipped",
        "recent outside the window is ignored",
    ],
)
def test_ported_v1_vectors(date, recent, expected):
    slugs = ["aconcagua", "denali", "mount-fuji"]

    assert select_daily_slug(day(date), slugs, recent) == expected


def test_the_selection_is_deterministic():
    slugs = ["aconcagua", "denali", "mount-fuji", "k2", "matterhorn"]
    first = select_daily_slug(day("2026-10-02"), slugs, [])

    assert {select_daily_slug(day("2026-10-02"), slugs, []) for _ in range(100)} == {first}


@pytest.mark.parametrize("date", ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"])
def test_the_candidate_order_does_not_matter(date):
    catalog = ["aconcagua", "denali", "mount-fuji", "k2", "matterhorn", "kilimanjaro"]
    orders = [
        catalog,
        ["kilimanjaro", "matterhorn", "k2", "mount-fuji", "denali", "aconcagua"],
        ["denali", "kilimanjaro", "aconcagua", "k2", "matterhorn", "mount-fuji"],
    ]
    recent = [discovery("2026-10-01", "denali")]
    expected = select_daily_slug(day(date), catalog, recent)

    assert {select_daily_slug(day(date), order, recent) for order in orders} == {expected}


def test_the_inputs_are_not_mutated():
    slugs = ["denali", "aconcagua", "mount-fuji"]
    recent = [discovery("2026-10-01", "denali")]

    select_daily_slug(day("2026-10-02"), slugs, recent)

    assert slugs == ["denali", "aconcagua", "mount-fuji"]
    assert recent == [discovery("2026-10-01", "denali")]


@pytest.mark.parametrize("offset", range(40))
def test_recent_mountains_are_excluded(offset):
    date = day("2026-10-02") + datetime.timedelta(days=offset)
    recent = [
        RecentDiscovery(date=date - datetime.timedelta(days=1), slug="aconcagua"),
        RecentDiscovery(date=date - datetime.timedelta(days=2), slug="denali"),
        RecentDiscovery(date=date - datetime.timedelta(days=3), slug="mount-fuji"),
    ]

    assert select_daily_slug(date, ["aconcagua", "denali", "mount-fuji", "k2"], recent) == "k2"


@pytest.mark.parametrize(
    ("recent_date", "expected"),
    [
        ("2026-10-03", "denali"),
        ("2026-09-04", "denali"),
        ("2026-09-03", "aconcagua"),
        ("2026-10-04", "aconcagua"),
        ("2026-10-05", "aconcagua"),
    ],
    ids=[
        "the previous day is excluded",
        "the thirtieth previous day is excluded",
        "the thirty-first previous day is ignored",
        "the same date is not history",
        "a future date is not history",
    ],
)
def test_the_recent_window_boundaries(recent_date, expected):
    recent = [discovery(recent_date, "aconcagua")]

    assert select_daily_slug(day("2026-10-04"), ["aconcagua", "denali"], recent) == expected


def test_the_window_is_date_based_with_gaps():
    recent = [
        discovery("2026-08-01", "aconcagua"),
        discovery("2026-08-02", "aconcagua"),
        discovery("2026-08-03", "aconcagua"),
    ]

    assert select_daily_slug(day("2026-10-04"), ["aconcagua", "denali"], recent) == "aconcagua"


def test_every_candidate_is_eligible_again_when_all_are_recent():
    slugs = ["aconcagua", "denali", "mount-fuji"]
    recent = [
        discovery("2026-10-01", "aconcagua"),
        discovery("2026-09-30", "denali"),
        discovery("2026-09-29", "mount-fuji"),
    ]

    assert select_daily_slug(day("2026-10-02"), slugs, recent) == select_daily_slug(
        day("2026-10-02"), slugs, []
    )


@pytest.mark.parametrize("recent", [[], [discovery("2026-10-01", "aconcagua")]])
def test_a_single_candidate_is_always_chosen(recent):
    assert select_daily_slug(day("2026-10-02"), ["aconcagua"], recent) == "aconcagua"


def test_an_empty_candidate_list_is_rejected():
    with pytest.raises(ValueError):
        select_daily_slug(day("2026-10-02"), [], [])


@pytest.mark.parametrize("offset", range(30))
def test_duplicate_candidates_count_once(offset):
    date = day("2026-10-02") + datetime.timedelta(days=offset)
    unique = ["aconcagua", "denali", "mount-fuji"]
    duplicated = ["denali", "aconcagua", "denali", "denali", "mount-fuji", "aconcagua"]

    assert select_daily_slug(date, duplicated, []) == select_daily_slug(date, unique, [])


def test_duplicate_recent_entries_count_once():
    once = [discovery("2026-10-01", "aconcagua")]
    repeated = [
        discovery("2026-10-01", "aconcagua"),
        discovery("2026-09-20", "aconcagua"),
        discovery("2026-10-01", "aconcagua"),
    ]
    slugs = ["aconcagua", "denali"]

    assert select_daily_slug(day("2026-10-02"), slugs, repeated) == select_daily_slug(
        day("2026-10-02"), slugs, once
    )


def test_recent_mountains_outside_the_candidates_are_ignored():
    slugs = ["aconcagua", "denali"]
    recent = [discovery("2026-10-01", "retired-peak")]

    assert select_daily_slug(day("2026-10-02"), slugs, recent) == select_daily_slug(
        day("2026-10-02"), slugs, []
    )


def test_every_candidate_is_reached_within_a_year():
    slugs = ["aconcagua", "denali", "mount-fuji", "k2", "matterhorn"]
    chosen = {
        select_daily_slug(day("2026-01-01") + datetime.timedelta(days=offset), slugs, [])
        for offset in range(365)
    }

    assert chosen == set(slugs)


def test_no_mountain_repeats_within_the_window_when_enough_exist():
    slugs = [f"peak-{index:02d}" for index in range(40)]
    history = []

    for offset in range(400):
        date = day("2026-01-01") + datetime.timedelta(days=offset)
        first, last = recent_window(date)
        chosen = select_daily_slug(date, slugs, history)

        assert all(
            not (first <= previous.date <= last and previous.slug == chosen) for previous in history
        )
        history.append(RecentDiscovery(date=date, slug=chosen))


@pytest.mark.parametrize(
    ("date", "expected"),
    [
        ("2026-10-02", ("2026-09-02", "2026-10-01")),
        ("2026-01-01", ("2025-12-02", "2025-12-31")),
        ("2028-03-01", ("2028-01-31", "2028-02-29")),
    ],
)
def test_the_recent_window_is_the_previous_thirty_dates(date, expected):
    first, last = recent_window(day(date))

    assert (first.isoformat(), last.isoformat()) == expected
    assert (last - first).days + 1 == RECENT_WINDOW_DAYS
