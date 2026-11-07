from datetime import date, timedelta

RETENTION_DAYS = 365


def retention_cutoff(today: date) -> date:
    """Return the oldest date still kept: a discovery is kept while its date >= the cutoff."""
    return today - timedelta(days=RETENTION_DAYS)
