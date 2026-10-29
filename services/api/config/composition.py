from pathlib import Path

from serendipeak.catalog.bootstrap.bootstrap_catalog import BootstrapCatalog
from serendipeak.catalog.bootstrap.check_catalog import CheckCatalog
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.persistence.catalog_store import DjangoCatalogStore

SERVICE_ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = SERVICE_ROOT / "seed" / "legacy-catalog-v1.json"
FROZEN_CATALOG_PATH = SERVICE_ROOT.parents[1] / "contracts" / "v1" / "catalog.json"


def build_bootstrap_catalog() -> BootstrapCatalog:
    store = DjangoCatalogStore()
    return BootstrapCatalog(store, VerifyCatalog(store))


def build_verify_catalog() -> VerifyCatalog:
    return VerifyCatalog(DjangoCatalogStore())


def build_check_catalog() -> CheckCatalog:
    return CheckCatalog(DjangoCatalogStore())
