from collections.abc import Sequence
from typing import Protocol

from serendipeak.catalog.entities import CandidateMountain, Mountain


class MountainRepository(Protocol):
    def find_public_by_slug(self, slug: str) -> Mountain | None:
        """Return the active or inactive mountain whose slug equals slug exactly, with its image.

        Returns None for an unknown slug and for a draft mountain.
        """

    def list_active_candidates(self) -> Sequence[CandidateMountain]:
        """Return the id and slug of every active mountain, ordered by slug code points.

        Returns an empty sequence when no mountain is active.
        """
