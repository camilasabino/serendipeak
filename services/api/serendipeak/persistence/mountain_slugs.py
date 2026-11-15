from uuid import UUID

from serendipeak.persistence.models import MountainRecord, MountainSlugAliasRecord


def slug_is_unavailable(slug: str, mountain_id: UUID | None = None) -> bool:
    """Whether another mountain holds the slug, as its current slug or a former one.

    The mountain being saved is excluded, so it may keep its slug or take back one it used.
    """
    current = MountainRecord.objects.filter(slug=slug)
    former = MountainSlugAliasRecord.objects.filter(slug=slug)
    if mountain_id is not None:
        current = current.exclude(pk=mountain_id)
        former = former.exclude(mountain_id=mountain_id)

    return current.exists() or former.exists()
