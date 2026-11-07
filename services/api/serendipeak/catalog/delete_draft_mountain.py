from uuid import UUID

from serendipeak.catalog.ports import DraftMountainDeletionStore


class DeleteDraftMountain:
    def __init__(self, deletions: DraftMountainDeletionStore):
        self._deletions = deletions

    def execute(self, mountain_id: UUID) -> None:
        """Delete a draft mountain with its photograph record and country links.

        Raises UnknownMountain, MountainNotDraft for an active, inactive or otherwise public
        mountain, and MountainReferenced for one that a daily discovery refers to. Nothing is
        deleted for any of them. Stored photograph objects stay in storage.
        """
        self._deletions.delete_draft(mountain_id)
