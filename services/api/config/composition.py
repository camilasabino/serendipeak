import secrets
from pathlib import Path

from serendipeak.catalog.bootstrap.bootstrap_catalog import BootstrapCatalog
from serendipeak.catalog.bootstrap.check_catalog import CheckCatalog
from serendipeak.catalog.bootstrap.verify_catalog import VerifyCatalog
from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.discovery.clock import SystemUtcClock
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.persistence.catalog_store import DjangoCatalogStore
from serendipeak.persistence.daily_discovery_repository import DjangoDailyDiscoveryRepository
from serendipeak.persistence.mountain_repository import DjangoMountainRepository

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


def build_get_mountain_by_slug() -> GetMountainBySlug:
    return GetMountainBySlug(DjangoMountainRepository())


def build_get_todays_mountain() -> GetTodaysMountain:
    return GetTodaysMountain(
        DjangoMountainRepository(),
        DjangoDailyDiscoveryRepository(),
        SystemUtcClock(),
    )


def build_get_random_mountain() -> GetRandomMountain:
    return GetRandomMountain(DjangoMountainRepository(), secrets.randbelow)
