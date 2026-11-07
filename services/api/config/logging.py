import json
import logging
from datetime import UTC, datetime


def event_fields(record: logging.LogRecord) -> dict:
    """The structured fields a log call attached with extra={"fields": {...}}."""
    return getattr(record, "fields", None) or {}


class ReadableFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        fields = event_fields(record)
        if not fields:
            return line

        return f"{line} " + " ".join(f"{name}={value}" for name, value in fields.items())


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        fields = event_fields(record)
        if fields:
            entry["fields"] = fields
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            entry["stack"] = self.formatStack(record.stack_info)

        return json.dumps(entry, ensure_ascii=False, default=str)
