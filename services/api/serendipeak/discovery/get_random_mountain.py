from collections.abc import Callable

from serendipeak.catalog.entities import Mountain
from serendipeak.catalog.ports import MountainRepository
from serendipeak.discovery.errors import NoEligibleMountains
from serendipeak.errors import InfrastructureError

PickIndex = Callable[[int], int]


class GetRandomMountain:
    def __init__(self, mountains: MountainRepository, pick_index: PickIndex):
        self._mountains = mountains
        self._pick_index = pick_index

    def execute(self, exclude: str = "") -> Mountain:
        candidates = [candidate.slug for candidate in self._mountains.list_active_candidates()]
        if not candidates:
            raise NoEligibleMountains()

        # An exclusion only applies while another active mountain remains, and it is matched
        # exactly: no trimming, no case folding.
        alternatives = [slug for slug in candidates if slug != exclude]
        if alternatives:
            candidates = alternatives

        index = self._pick_index(len(candidates))
        if not 0 <= index < len(candidates):
            raise InfrastructureError(
                f"pick_index returned {index} for {len(candidates)} candidates"
            )

        slug = candidates[index]
        mountain = self._mountains.find_public_by_slug(slug)
        if mountain is None:
            raise InfrastructureError(f"mountain {slug!r} stopped being public during selection")

        return mountain
