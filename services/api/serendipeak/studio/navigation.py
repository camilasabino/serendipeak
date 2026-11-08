from dataclasses import dataclass

from serendipeak.accounts.roles import Role
from serendipeak.studio.access import StudioAccess


@dataclass(frozen=True, slots=True)
class NavigationItem:
    label: str
    url_name: str
    access: StudioAccess
    # Pages that belong to the section, so the item stays marked on them.
    section_url_names: tuple[str, ...] = ()


NAVIGATION = (
    NavigationItem("Overview", "studio:landing", StudioAccess.VIEWER),
    NavigationItem(
        "Mountains",
        "studio:mountain_list",
        StudioAccess.VIEWER,
        section_url_names=("studio:mountain_detail",),
    ),
)


def navigation_for(role: Role) -> tuple[NavigationItem, ...]:
    return tuple(
        item for item in NAVIGATION if item.access is not StudioAccess.EDITOR or role.can_write
    )
