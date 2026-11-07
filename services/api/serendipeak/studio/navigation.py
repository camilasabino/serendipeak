from dataclasses import dataclass

from serendipeak.accounts.roles import Role
from serendipeak.studio.access import StudioAccess


@dataclass(frozen=True, slots=True)
class NavigationItem:
    label: str
    url_name: str
    access: StudioAccess


NAVIGATION = (NavigationItem("Overview", "studio:landing", StudioAccess.VIEWER),)


def navigation_for(role: Role) -> tuple[NavigationItem, ...]:
    return tuple(
        item for item in NAVIGATION if item.access is not StudioAccess.EDITOR or role.can_write
    )
