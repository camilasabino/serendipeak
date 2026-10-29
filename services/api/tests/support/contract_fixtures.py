import json
from pathlib import Path

CONTRACTS_DIR = Path(__file__).resolve().parents[4] / "contracts" / "v1"


def load_fixture(name):
    return json.loads((CONTRACTS_DIR / name).read_text(encoding="utf-8"))


def load_frozen_catalog():
    return load_fixture("catalog.json")["mountains"]
