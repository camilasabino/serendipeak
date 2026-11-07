from collections.abc import Callable
from dataclasses import dataclass

from serendipeak.catalog.bootstrap.ports import BackfillTarget, GeographyBackfillStore
from serendipeak.catalog.geography_input import BackfillPlan, parse_geography_input


@dataclass(frozen=True, slots=True)
class BackfillResult:
    target: BackfillTarget
    plan: BackfillPlan
    applied: bool


class ApplyGeographyBackfill:
    def __init__(self, store: GeographyBackfillStore):
        self._store = store

    def execute(
        self,
        document: object,
        *,
        expected_sha256: str,
        dry_run: bool,
        announce_target: Callable[[BackfillTarget], None],
    ) -> BackfillResult:
        # The input is judged before the database is read: a stale or foreign file never
        # gets as far as a connection. The target is announced before anything else is read.
        geography = parse_geography_input(document, expected_sha256=expected_sha256)

        target = self._store.target()
        announce_target(target)

        plan = self._store.backfill(geography, dry_run=dry_run)

        return BackfillResult(target=target, plan=plan, applied=not dry_run)
