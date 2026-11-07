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


def record_with_fields(**fields):
    entry = record("login_failed")
    entry.fields = fields

    return entry


def test_structured_fields_are_added_when_a_call_supplies_them():
    entry = json.loads(JsonLineFormatter().format(record_with_fields(address="203.0.113.7")))

    assert entry["fields"] == {"address": "203.0.113.7"}


def test_the_readable_format_appends_the_fields_to_the_message():
    from config.logging import ReadableFormatter

    line = ReadableFormatter("{levelname} {message}", style="{").format(
        record_with_fields(address="203.0.113.7", role="editor")
    )

    assert line == "ERROR login_failed address=203.0.113.7 role=editor"
