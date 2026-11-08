from dataclasses import dataclass
from urllib.parse import urlencode

from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CanonicalCamera,
    Mountain,
    MountainStatus,
    PrimaryImage,
)
from serendipeak.catalog.get_mountain_detail import MountainDetail
from serendipeak.catalog.list_mountains import MountainList
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.media.keys import public_url
from serendipeak.catalog.publication import (
    PublicationViolation,
    PublicLinkField,
    unsafe_public_links,
)
from serendipeak.catalog.regions import PATH_SEPARATOR, RegionPath, RegionRef
from serendipeak.catalog.summary import SUMMARY_MAX_LENGTH


@dataclass(frozen=True, slots=True)
class StatusPresentation:
    key: str
    label: str
    meaning: str


STATUS_PRESENTATION = {
    MountainStatus.DRAFT: StatusPresentation(
        "draft", "Draft", "Not on the site. Only the Studio shows it."
    ),
    MountainStatus.ACTIVE: StatusPresentation(
        "published", "Published", "On the site and eligible to be the mountain of the day."
    ),
    MountainStatus.INACTIVE: StatusPresentation(
        "unlisted",
        "Unlisted",
        "Reachable by its link, but never picked as the mountain of the day.",
    ),
}
STATUS_BY_KEY = {presentation.key: status for status, presentation in STATUS_PRESENTATION.items()}

VIOLATION_REASONS = {
    PublicationViolation.SLUG_INVALID: "The slug is not valid.",
    PublicationViolation.COORDINATES_OUT_OF_RANGE: "The coordinates are out of range.",
    PublicationViolation.ELEVATION_NOT_POSITIVE: "The elevation is not positive.",
    PublicationViolation.CAMERA_MISSING: "The camera is missing.",
    PublicationViolation.CAMERA_OUT_OF_BOUNDS: "The camera is out of bounds.",
    PublicationViolation.CAMERA_FRAMING_MISSING: "The camera framing is missing.",
    PublicationViolation.CAMERA_FRAMING_OUT_OF_BOUNDS: "The camera framing is out of bounds.",
    PublicationViolation.PRIMARY_IMAGE_MISSING: "The photograph is missing.",
    PublicationViolation.IMAGE_MEDIA_MISSING: "The photograph file is not stored yet.",
    PublicationViolation.IMAGE_AUTHOR_MISSING: "The photograph author is missing.",
    PublicationViolation.IMAGE_LICENSE_URL_WITHOUT_LICENSE: (
        "The photograph license link needs the license name."
    ),
    PublicationViolation.IMAGE_DIMENSIONS_MISSING: "The photograph dimensions are missing.",
    PublicationViolation.SUMMARY_INVALID: "The summary breaks the summary rules.",
    PublicationViolation.LINK_NOT_HTTPS: "A public link does not use https://.",
}
UNSAFE_LINK_REASONS = {
    PublicLinkField.IMAGE_SOURCE_PAGE_URL: "The photograph page link does not use https://.",
    PublicLinkField.IMAGE_LICENSE_URL: "The photograph license link does not use https://.",
}

LANGUAGES = (("es", "Spanish"), ("pt", "Portuguese"))


def status_presentation(status: MountainStatus) -> StatusPresentation:
    return STATUS_PRESENTATION[status]


def violation_reasons(mountain: Mountain, violations) -> list[str]:
    reasons = []
    for violation in violations:
        if violation is PublicationViolation.LINK_NOT_HTTPS:
            reasons.extend(UNSAFE_LINK_REASONS[field] for field in unsafe_public_links(mountain))
        else:
            reasons.append(VIOLATION_REASONS[violation])

    return reasons


def concise_region(region: RegionPath | None) -> str:
    """The region and its nearest ancestor, so a row stays short whatever the depth."""
    if region is None:
        return ""
    if not region.ancestors:
        return region.region.name.en

    return f"{region.ancestors[-1].name.en}{PATH_SEPARATOR}{region.region.name.en}"


def localized_path(refs: tuple[RegionRef, ...], language: str) -> str | None:
    """The path in a language, with English standing in for a node that has no translation, or
    None when no node has one, because then it would only repeat the English path."""
    names = [getattr(ref.name, language) for ref in refs]
    if not any(names):
        return None

    return PATH_SEPARATOR.join(name or ref.name.en for name, ref in zip(names, refs, strict=True))


def translations(text: LocalizedText | None) -> list[dict]:
    if text is None:
        return []

    return [
        {"code": code, "language": language, "text": value}
        for code, language in LANGUAGES
        if (value := getattr(text, code))
    ]


def photograph_url(media_base_url: str, image: PrimaryImage | None) -> str | None:
    if image is None or image.media is None:
        return None

    return public_url(media_base_url, image.media.page_key)


def site_url(web_origin: str, mountain: Mountain) -> str | None:
    if mountain.status not in PUBLIC_STATUSES:
        return None

    return f"{web_origin}/mountains/{mountain.slug}"


def list_rows(listing: MountainList, media_base_url: str) -> list[dict]:
    return [
        {
            "slug": entry.mountain.slug,
            "name": entry.mountain.name.en,
            "elevation": entry.mountain.elevation_meters,
            "status": status_presentation(entry.mountain.status),
            "thumbnail": photograph_url(media_base_url, entry.mountain.primary_image),
            "continent": entry.mountain.continent.name.en,
            "region": concise_region(entry.mountain.region),
            "countries": [country.name.en for country in entry.mountain.countries],
            "reasons": violation_reasons(entry.mountain, entry.violations),
            "is_draft": entry.mountain.status is MountainStatus.DRAFT,
        }
        for entry in listing.entries
    ]


def filter_chips(listing: MountainList, selected: MountainStatus | None, search: str) -> list[dict]:
    options = [(None, "All", listing.total)] + [
        (status, presentation.label, listing.counts[status])
        for status, presentation in STATUS_PRESENTATION.items()
    ]

    return [
        {
            "label": label,
            "count": count,
            "current": status is selected,
            "query": _query(status, search),
        }
        for status, label, count in options
    ]


def _query(status: MountainStatus | None, search: str) -> str:
    pairs = {}
    if search:
        pairs["q"] = search
    if status is not None:
        pairs["status"] = status_presentation(status).key

    return urlencode(pairs)


def camera_rows(camera: CanonicalCamera | None) -> list[tuple[str, str]]:
    if camera is None:
        return []
    rows = [
        ("Heading", f"{camera.heading_degrees:g}°"),
        ("Pitch", f"{camera.pitch_degrees:g}°"),
        ("Range", f"{camera.range_meters:,.0f} m"),
    ]
    if camera.framing is not None:
        rows.append(("Framing", f"x {camera.framing.x:g}, y {camera.framing.y:g}"))

    return rows


def photograph_context(mountain: Mountain, media_base_url: str) -> dict | None:
    image = mountain.primary_image
    if image is None:
        return None

    return {
        "url": photograph_url(media_base_url, image),
        "width": None if image.dimensions is None else image.dimensions.width,
        "height": None if image.dimensions is None else image.dimensions.height,
        "author": image.author,
        "license_name": image.license_name,
        "license_url": image.license_url,
        "source_page_url": image.source_page_url,
    }


def detail_context(
    detail: MountainDetail, *, media_base_url: str, web_origin: str, can_write: bool
) -> dict:
    mountain = detail.mountain
    region = mountain.region
    refs = () if region is None else (*region.ancestors, region.region)

    return {
        "mountain": mountain,
        "can_write": can_write,
        "is_draft": mountain.status is MountainStatus.DRAFT,
        "is_published": mountain.status is MountainStatus.ACTIVE,
        "is_unlisted": mountain.status is MountainStatus.INACTIVE,
        "status": status_presentation(mountain.status),
        "name_translations": translations(mountain.name),
        "summary_translations": translations(mountain.summary),
        "continent_translations": translations(mountain.continent.name),
        "region_refs": refs,
        "region_translations": [
            {"code": code, "language": language, "text": path}
            for code, language in LANGUAGES
            if (path := localized_path(refs, code))
        ],
        "reasons": violation_reasons(mountain, detail.violations),
        "photograph": photograph_context(mountain, media_base_url),
        "camera_rows": camera_rows(mountain.camera),
        "site_url": site_url(web_origin, mountain),
        "latitude": f"{mountain.coordinates.latitude:.5f}",
        "longitude": f"{mountain.coordinates.longitude:.5f}",
        "wikidata_url": (
            None
            if mountain.wikidata_id is None
            else f"https://www.wikidata.org/wiki/{mountain.wikidata_id}"
        ),
    }


def form_context(
    mountain_form,
    photograph_form,
    *,
    mountain: Mountain | None,
    violations,
    media_base_url: str,
) -> dict:
    """The creation page (no mountain) or the edit page of a stored one."""
    is_new = mountain is None
    forms = [mountain_form, photograph_form]

    return {
        "mountain_form": mountain_form,
        "photograph_form": photograph_form,
        "forms": forms,
        "has_errors": any(form.errors for form in forms),
        "mountain": mountain,
        "is_new": is_new,
        "title": "New mountain" if is_new else mountain.name.en,
        "status": None if is_new else status_presentation(mountain.status),
        "is_draft": is_new or mountain.status is MountainStatus.DRAFT,
        "reasons": [] if is_new else violation_reasons(mountain, violations),
        "photograph": None if is_new else photograph_context(mountain, media_base_url),
        # A page that comes back refused already holds edits the server does not have.
        "unsaved_on_load": any(form.is_bound and form.errors for form in forms),
        "max_summary_length": SUMMARY_MAX_LENGTH,
    }


def deletion_context(mountain: Mountain, media_base_url: str) -> dict:
    return {
        "mountain": mountain,
        "is_draft": mountain.status is MountainStatus.DRAFT,
        "status": status_presentation(mountain.status),
        "photograph": photograph_context(mountain, media_base_url),
        "country_names": [country.name.en for country in mountain.countries],
    }
