import datetime

from serendipeak.discovery.clock import SystemUtcClock


def test_the_system_clock_reads_the_utc_calendar_date():
    before = datetime.datetime.now(datetime.UTC).date()
    today = SystemUtcClock().today()
    after = datetime.datetime.now(datetime.UTC).date()

    assert type(today) is datetime.date
    assert before <= today <= after
