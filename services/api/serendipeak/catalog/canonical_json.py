import hashlib
import json


def canonical_json(value: object) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def content_sha256(content: object) -> str:
    return hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()
