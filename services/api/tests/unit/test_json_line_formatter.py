import json
import logging
import sys

from config.logging import JsonLineFormatter


def record(message, *args, exc_info=None):
    return logging.LogRecord(
        name="serendipeak.httpapi.errors",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=args,
        exc_info=exc_info,
    )


def test_a_record_is_one_json_line():
    line = JsonLineFormatter().format(record("Unhandled error on %s %s", "GET", "/peak/ø"))
    entry = json.loads(line)

    assert "\n" not in line
    assert set(entry) == {"time", "level", "logger", "message"}
    assert entry["time"].endswith("+00:00")
    assert entry["level"] == "ERROR"
    assert entry["logger"] == "serendipeak.httpapi.errors"
    assert entry["message"] == "Unhandled error on GET /peak/ø"


def test_the_traceback_stays_inside_the_line():
    try:
        raise RuntimeError("database unavailable")
    except RuntimeError:
        line = JsonLineFormatter().format(record("failed", exc_info=sys.exc_info()))

    assert "\n" not in line
    assert "RuntimeError: database unavailable" in json.loads(line)["exception"]
