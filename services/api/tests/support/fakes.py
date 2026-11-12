from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from uuid import uuid4

from serendipeak.accounts.access import Access, AccessChangeContext, AccessViolation, Account
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import PasswordRejected, UsernameTaken
from serendipeak.accounts.ports import AccessChange, AccessChangeOutcome, RecordedLoginAttempt
from serendipeak.catalog.bootstrap.ports import CatalogSnapshot
from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CandidateMountain,
    ImageDimensions,
    Mountain,
    MountainStatus,
)
from serendipeak.catalog.errors import (
    CatalogAlreadyPopulated,
    MountainHasNoPhotograph,
    MountainNotDraft,
    MountainReferenced,
    PhotographRejected,
    PhotographRejection,
    PublicationRejected,
    SlugTaken,
    UnknownContinent,
    UnknownCountries,
    UnknownMountain,
)
from serendipeak.catalog.get_mountain_preview import GetMountainPreview
from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.media.keys import require_media_key
from serendipeak.catalog.media.ports import PhotographFormat, ProcessedPhotograph
from serendipeak.catalog.ports import (
    CameraChange,
    CountedRegion,
    GeographyOptions,
    StatusChange,
    StatusChangeOutcome,
)
from serendipeak.catalog.region_changes import (
    RegionInUse,
    RegionNameTaken,
    RegionSlugTaken,
    RegionWikidataTaken,
    RegionWouldDescendFromItself,
)
from serendipeak.catalog.regions import MountainRegion, UnknownRegion, build_region_path
from serendipeak.catalog.relocation import RelocationOutcome
from serendipeak.discovery.entities import DailyMountain, DiscoveryHistoryEntry, RecentDiscovery
from serendipeak.errors import InfrastructureError
from tests.support.catalog import index_entry_of
from tests.support.geography import reference as geography_reference


class InMemoryGeographyReference:
    def read(self):
        from tests.support.geography import reference

        return reference()


class InMemoryGeographyStore:
    """Stands in for the Django adapter of the backfill and draft ports."""

    def __init__(self, mountains=(), known_countries=None, regions=None):
        from tests.support.geography import reference

        self._rows = {mountain.id: mountain for mountain in mountains}
        self._known = frozenset(known_countries or reference().countries)
        self.regions = regions
        self.reads = 0
        self.writes = 0

    def target(self):
        from serendipeak.catalog.bootstrap.ports import BackfillTarget

        return BackfillTarget(
            database="memory", host="local", port="none", migration="0017_mountain_continent"
        )

    def backfill(self, geography, *, dry_run):
        from serendipeak.catalog.geography_input import plan_backfill

        self.reads += 1
        plan = plan_backfill(geography, list(self._rows.values()), self._known, self.regions)
        if dry_run:
            return plan

        if plan.new_regions:
            self.writes += 1
            self.regions = [
                *self.regions,
                *(region for region in geography.regions if region.slug in plan.new_regions),
            ]
        by_slug = {entry.slug: entry for entry in geography.mountains}
        for change in plan.changes:
            entry = by_slug[change.slug]
            self.writes += 1
            self._rows[entry.id] = replace(
                self._rows[entry.id],
                continent_code=entry.continent_code,
                country_codes=entry.country_codes,
                region_slug=entry.region_slug
                if change.region is not None
                else (self._rows[entry.id].region_slug),
            )

        return plan

    def read_mountains(self):
        return tuple(sorted(self._rows.values(), key=lambda row: row.slug))


class InMemoryCatalogStore:
    def __init__(self):
        self._mountains = {}
        self._discoveries = {}
        self._regions = ()

    def load(self, catalog: CatalogSnapshot):
        if self._mountains:
            raise CatalogAlreadyPopulated()

        self._regions = catalog.regions
        self._mountains.update((entry.mountain.id, entry) for entry in catalog.mountains)
        self._discoveries.update((discovery.date, discovery) for discovery in catalog.discoveries)

    def snapshot(self):
        return CatalogSnapshot(
            mountains=tuple(
                sorted(self._mountains.values(), key=lambda entry: entry.mountain.slug)
            ),
            discoveries=tuple(sorted(self._discoveries.values(), key=lambda item: item.date)),
            regions=self._regions,
        )

    def replace(self, entry):
        self._mountains[entry.mountain.id] = entry

    def media_of(self, mountain_id):
        return self._mountains[mountain_id].mountain.primary_image.media


class InMemoryMountainRepository:
    def __init__(self, mountains=()):
        self._mountains = {mountain.slug: mountain for mountain in mountains}

    def find_public_by_slug(self, slug):
        mountain = self._mountains.get(slug)
        if mountain is None or mountain.status not in PUBLIC_STATUSES:
            return None

        return mountain

    def list_active_candidates(self):
        return tuple(
            CandidateMountain(id=mountain.id, slug=mountain.slug)
            for slug, mountain in sorted(self._mountains.items())
            if mountain.status is MountainStatus.ACTIVE
        )

    def list_active_index(self):
        return tuple(
            index_entry_of(mountain)
            for slug, mountain in sorted(self._mountains.items())
            if mountain.status is MountainStatus.ACTIVE
        )


class InMemoryMountainCatalogReader:
    def __init__(self, mountains=()):
        self._mountains = {mountain.slug: mountain for mountain in mountains}

    def list_all(self):
        return tuple(self._mountains.values())

    def find_by_slug(self, slug):
        return self._mountains.get(slug)

    def find_by_id(self, mountain_id):
        return next(
            (mountain for mountain in self._mountains.values() if mountain.id == mountain_id),
            None,
        )


class InMemoryGeographyOptionsReader:
    """Holds the reference continents and countries and the regions it is given."""

    def __init__(self, regions=()):
        self._regions = tuple(regions)

    def read(self):
        reference = geography_reference()

        return GeographyOptions(
            continents=tuple(reference.continents.values()),
            countries=tuple(reference.countries.values()),
            regions=self._regions,
        )


class InMemoryMountainStatusStore:
    def __init__(self, mountains=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}

    def change_status(self, mountain_id, transition, gate):
        mountain = self._mountains.get(mountain_id)
        if mountain is None:
            return StatusChange(StatusChangeOutcome.NOT_FOUND, None)
        if mountain.status is not transition.source:
            return StatusChange(StatusChangeOutcome.WRONG_STATUS, mountain.status)

        violations = tuple(gate(mountain))
        if violations:
            return StatusChange(StatusChangeOutcome.REJECTED, mountain.status, violations)

        self._mountains[mountain_id] = replace(mountain, status=transition.target)

        return StatusChange(StatusChangeOutcome.APPLIED, transition.target)

    def replace(self, mountain):
        self._mountains[mountain.id] = mountain

    def status_of(self, mountain_id):
        return self._mountains[mountain_id].status


class InMemoryUserStore:
    """Stands in for the Django adapter; its password policy is only the minimum length."""

    MINIMUM_PASSWORD_LENGTH = 8

    def __init__(self, users=()):
        self._users = {user.id: user for user in users}
        self.passwords = {}

    def create(self, username, role, password):
        if len(password) < self.MINIMUM_PASSWORD_LENGTH:
            raise PasswordRejected(("This password is too short.",))
        if any(user.username == username for user in self._users.values()):
            raise UsernameTaken(username)

        user = User(
            id=uuid4(),
            username=username,
            role=role,
            is_active=True,
            last_login=None,
            date_joined=datetime.now(UTC),
        )
        self._users[user.id] = user

        return user

    def change_access(self, actor_id, target_id, desired, rule):
        target = self._users.get(target_id)
        if target is None:
            return AccessChange(AccessChangeOutcome.NOT_FOUND)

        actor = self._users.get(actor_id)
        if actor is None:
            return AccessChange(
                AccessChangeOutcome.REFUSED, violation=AccessViolation.ACTOR_NOT_EDITOR
            )

        violation = rule(
            AccessChangeContext(
                actor=Account(actor.id, self._access_of(actor)),
                target=Account(target.id, self._access_of(target)),
                desired=desired,
                active_editors=sum(
                    self._access_of(u).is_active_editor for u in self._users.values()
                ),
            )
        )
        if violation is not None:
            return AccessChange(AccessChangeOutcome.REFUSED, violation=violation)

        changed = replace(target, role=desired.role, is_active=desired.is_active)
        self._users[target.id] = changed

        return AccessChange(AccessChangeOutcome.APPLIED, user=changed)

    def set_password(self, actor_id, target_id, password):
        target = self._users.get(target_id)
        if target is None:
            return AccessChange(AccessChangeOutcome.NOT_FOUND)
        if len(password) < self.MINIMUM_PASSWORD_LENGTH:
            raise PasswordRejected(("This password is too short.",))

        actor = self._users.get(actor_id)
        if actor is None or not self._access_of(actor).is_active_editor:
            return AccessChange(
                AccessChangeOutcome.REFUSED, violation=AccessViolation.ACTOR_NOT_EDITOR
            )

        self.passwords[target_id] = password

        return AccessChange(AccessChangeOutcome.APPLIED, user=target)

    def get(self, user_id):
        return self._users[user_id]

    def list_all(self):
        return tuple(self._users.values())

    def find_by_id(self, user_id):
        return self._users.get(user_id)

    @staticmethod
    def _access_of(user):
        return Access(user.role, user.is_active)


class InMemoryLoginAttemptLog:
    def __init__(self):
        self._attempts = {}
        self._next_id = 1

    def record(self, *, username_key, address, at, window_start):
        self._attempts = {
            attempt_id: attempt
            for attempt_id, attempt in self._attempts.items()
            if attempt[2] >= window_start
        }
        attempt_id = self._next_id
        self._next_id += 1
        self._attempts[attempt_id] = (username_key, address, at)
        in_window = self._attempts.values()

        return RecordedLoginAttempt(
            attempt_id=attempt_id,
            by_username=sum(attempt[0] == username_key for attempt in in_window),
            by_address=sum(attempt[1] == address for attempt in in_window),
        )

    def discard(self, attempt_id):
        self._attempts.pop(attempt_id, None)

    def forget_username(self, username_key):
        self._attempts = {
            attempt_id: attempt
            for attempt_id, attempt in self._attempts.items()
            if attempt[0] != username_key
        }

    def stored(self):
        return len(self._attempts)


class ManualClock:
    """A clock the test moves by hand."""

    def __init__(self, now):
        self._now = now

    def now(self):
        return self._now

    def advance(self, delta):
        self._now += delta


class InMemoryMountainCameraStore:
    def __init__(self, mountains=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self.calls = 0

    def replace_camera(self, mountain_id, camera, expected, expected_coordinates):
        self.calls += 1
        mountain = self._mountains.get(mountain_id)
        if mountain is None:
            return CameraChange.NOT_FOUND
        if mountain.coordinates != expected_coordinates:
            return CameraChange.LOCATION_CHANGED
        if mountain.camera != expected:
            return CameraChange.STALE

        self._mountains[mountain_id] = replace(mountain, camera=camera)

        return CameraChange.APPLIED

    def mountain(self, mountain_id):
        return self._mountains[mountain_id]


class InMemoryMountainLocationStore:
    def __init__(self, mountains=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self.calls = 0

    def relocate(self, mountain_id, coordinates, rule):
        self.calls += 1
        mountain = self._mountains.get(mountain_id)
        if mountain is None:
            return RelocationOutcome.NOT_FOUND

        outcome = rule(mountain.status, mountain.coordinates)
        if outcome is RelocationOutcome.APPLIED:
            self._mountains[mountain_id] = replace(mountain, coordinates=coordinates, camera=None)

        return outcome

    def mountain(self, mountain_id):
        return self._mountains[mountain_id]


class InMemoryMountainCreationStore:
    """Holds the reference data of tests.support.geography and the given regions."""

    def __init__(self, mountains=(), regions=()):
        self._mountains = {mountain.slug: mountain for mountain in mountains}
        self._regions = {region.id: region for region in regions}
        self.calls = 0

    def create_draft(self, mountain, image):
        self.calls += 1
        reference = geography_reference()
        wanted = set(mountain.country_codes)
        if mountain.slug in self._mountains:
            raise SlugTaken(mountain.slug)
        if mountain.continent_code not in reference.continents:
            raise UnknownContinent(mountain.continent_code)
        if mountain.region_id is not None and mountain.region_id not in self._regions:
            raise UnknownRegion(mountain.region_id)
        if wanted - reference.countries.keys():
            raise UnknownCountries(tuple(sorted(wanted - reference.countries.keys())))

        created = Mountain(
            id=uuid4(),
            slug=mountain.slug,
            name=LocalizedText(en=mountain.name),
            status=MountainStatus.DRAFT,
            coordinates=mountain.coordinates,
            elevation_meters=mountain.elevation_meters,
            continent=reference.continents[mountain.continent_code],
            countries=tuple(
                sorted(
                    (reference.countries[code] for code in wanted),
                    key=lambda country: (country.name.en, country.code),
                )
            ),
            region=None
            if mountain.region_id is None
            else build_region_path(mountain.region_id, self._regions),
            summary=None if mountain.summary is None else LocalizedText(en=mountain.summary),
            camera=None,
            primary_image=image,
            osm_node_id=mountain.osm_node_id,
            wikidata_id=mountain.wikidata_id,
        )
        self._mountains[created.slug] = created

        return created

    def mountain(self, slug):
        return self._mountains.get(slug)


def _prospective_image(current, image, update):
    if image is not None:
        return image
    if update.remove_photograph:
        return None
    if update.credit is None:
        return current.primary_image
    if current.primary_image is None:
        raise MountainHasNoPhotograph(current.id)

    return replace(
        current.primary_image,
        author=update.credit.author,
        license_name=update.credit.license_name,
        license_url=update.credit.license_url,
        source_page_url=update.credit.source_page_url,
    )


class InMemoryMountainUpdateStore:
    """Holds the reference data of tests.support.geography and the given regions."""

    def __init__(self, mountains=(), regions=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self._regions = {region.id: region for region in regions}
        self.calls = 0

    def update(self, mountain_id, update, gate, image=None):
        self.calls += 1
        current = self._mountains.get(mountain_id)
        if current is None:
            raise UnknownMountain(mountain_id)

        reference = geography_reference()
        wanted = set(update.country_codes)
        if any(m.slug == update.slug and m.id != mountain_id for m in self._mountains.values()):
            raise SlugTaken(update.slug)
        if update.continent_code not in reference.continents:
            raise UnknownContinent(update.continent_code)
        if update.region_id is not None and update.region_id not in self._regions:
            raise UnknownRegion(update.region_id)
        if wanted - reference.countries.keys():
            raise UnknownCountries(tuple(sorted(wanted - reference.countries.keys())))

        stored_summary = current.summary or LocalizedText(en="")
        prospective = replace(
            current,
            slug=update.slug,
            name=replace(current.name, en=update.name),
            elevation_meters=update.elevation_meters,
            continent=reference.continents[update.continent_code],
            countries=tuple(
                sorted(
                    (reference.countries[code] for code in wanted),
                    key=lambda country: (country.name.en, country.code),
                )
            ),
            region=None
            if update.region_id is None
            else build_region_path(update.region_id, self._regions),
            summary=None if update.summary is None else replace(stored_summary, en=update.summary),
            osm_node_id=update.osm_node_id,
            wikidata_id=update.wikidata_id,
            primary_image=_prospective_image(current, image, update),
        )
        violations = tuple(gate(prospective))
        if violations:
            raise PublicationRejected(violations)

        self._mountains[mountain_id] = prospective

        return prospective

    def mountain(self, mountain_id):
        return self._mountains[mountain_id]


class InMemoryDraftMountainDeletionStore:
    def __init__(self, mountains=(), referenced_ids=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self._referenced_ids = set(referenced_ids)
        self.calls = 0

    def delete_draft(self, mountain_id):
        self.calls += 1
        current = self._mountains.get(mountain_id)
        if current is None:
            raise UnknownMountain(mountain_id)
        if current.status is not MountainStatus.DRAFT:
            raise MountainNotDraft(mountain_id, current.status)
        if mountain_id in self._referenced_ids:
            raise MountainReferenced(mountain_id)

        del self._mountains[mountain_id]

    def mountain(self, mountain_id):
        return self._mountains.get(mountain_id)


class InMemoryMountainRegionStore:
    """Stands in for the Django adapter of the region writes. Every operation judges before it
    writes, so a refusal leaves the taxonomy as it was. mountain_region_ids holds the region of
    each mountain that has one."""

    def __init__(self, regions=(), mountain_region_ids=()):
        self._regions = {region.id: region for region in regions}
        self._mountain_region_ids = list(mountain_region_ids)
        self.calls = 0

    def create(self, region):
        self.calls += 1
        parent_id = region.parent_id
        if parent_id is not None and parent_id not in self._regions:
            raise UnknownRegion(parent_id)
        if any(other.slug == region.slug for other in self._regions.values()):
            raise RegionSlugTaken(region.slug)
        if parent_id is not None and self._has_child_named(parent_id, region.name.en):
            raise RegionNameTaken(parent_id, region.name.en)
        self._require_free_wikidata(region.wikidata_id)

        stored = MountainRegion(
            id=uuid4(),
            slug=region.slug,
            name=region.name,
            parent_id=parent_id,
            wikidata_id=region.wikidata_id,
        )
        self._regions[stored.id] = stored

        return stored

    def update(self, region_id, update):
        self.calls += 1
        current = self._known(region_id)
        parent_id = current.parent_id
        if parent_id is not None and self._has_child_named(
            parent_id, update.name.en, excluding=region_id
        ):
            raise RegionNameTaken(parent_id, update.name.en)
        self._require_free_wikidata(update.wikidata_id, excluding=region_id)

        stored = replace(current, name=update.name, wikidata_id=update.wikidata_id)
        self._regions[region_id] = stored

        return stored

    def move(self, region_id, parent_id):
        self.calls += 1
        current = self._known(region_id)
        if current.parent_id == parent_id:
            return current
        if parent_id is not None:
            self._known(parent_id)
            if self._is_inside(parent_id, region_id):
                raise RegionWouldDescendFromItself(region_id, parent_id)
            if self._has_child_named(parent_id, current.name.en, excluding=region_id):
                raise RegionNameTaken(parent_id, current.name.en)

        stored = replace(current, parent_id=parent_id)
        self._regions[region_id] = stored

        return stored

    def delete(self, region_id):
        self.calls += 1
        self._known(region_id)
        children = sum(1 for other in self._regions.values() if other.parent_id == region_id)
        mountains = self._mountain_region_ids.count(region_id)
        if children or mountains:
            raise RegionInUse(region_id, children, mountains)

        del self._regions[region_id]

    def region(self, region_id):
        return self._regions.get(region_id)

    def regions(self):
        return dict(self._regions)

    def _known(self, region_id):
        region = self._regions.get(region_id)
        if region is None:
            raise UnknownRegion(region_id)

        return region

    def _is_inside(self, region_id, ancestor_id):
        current = region_id
        while current is not None:
            if current == ancestor_id:
                return True
            current = self._regions[current].parent_id

        return False

    def _has_child_named(self, parent_id, name, excluding=None):
        return any(
            other.parent_id == parent_id
            and other.id != excluding
            and other.name.en.lower() == name.lower()
            for other in self._regions.values()
        )

    def _require_free_wikidata(self, wikidata_id, excluding=None):
        if wikidata_id is not None and any(
            other.wikidata_id == wikidata_id and other.id != excluding
            for other in self._regions.values()
        ):
            raise RegionWikidataTaken(wikidata_id)


class InMemoryMountainRegionReader:
    """Holds the regions and the mountains it is given, as a RegionMountain each. read_all and
    list_mountains count the calls, so a test can see how many reads a screen made."""

    def __init__(self, regions=(), mountains=()):
        self._regions = tuple(regions)
        self._mountains = tuple(mountains)
        self.reads = 0
        self.mountain_reads = 0

    def read_all(self):
        self.reads += 1

        return tuple(
            CountedRegion(
                region=region,
                direct_mountains=sum(1 for item in self._mountains if item.region_id == region.id),
            )
            for region in self._regions
        )

    def list_mountains(self, region_ids):
        self.mountain_reads += 1
        wanted = set(region_ids)

        return tuple(item for item in self._mountains if item.region_id in wanted)


class InMemoryDailyDiscoveryRepository:
    def __init__(self, mountains=(), discoveries=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self._mountain_ids = {discovery.date: discovery.mountain_id for discovery in discoveries}

    def find_by_date(self, day):
        mountain_id = self._mountain_ids.get(day)
        if mountain_id is None:
            return None

        return DailyMountain(date=day, mountain=self._mountains[mountain_id])

    def list_recent(self, first, last):
        return tuple(
            RecentDiscovery(date=day, slug=self._mountains[mountain_id].slug)
            for day, mountain_id in sorted(self._mountain_ids.items())
            if first <= day <= last
        )

    def insert_or_get(self, day, mountain_id):
        if day not in self._mountain_ids:
            if mountain_id not in self._mountains:
                raise InfrastructureError(f"no mountain has the id {mountain_id}")
            self._mountain_ids[day] = mountain_id

        return self.find_by_date(day)

    def delete_before(self, cutoff):
        expired = [day for day in self._mountain_ids if day < cutoff]
        for day in expired:
            del self._mountain_ids[day]

        return len(expired)


class InMemoryDiscoveryHistoryReader:
    def __init__(self, entries=()):
        self._entries = tuple(entries)

    def list_between(self, first, last):
        return tuple(entry for entry in self._entries if first <= entry.date <= last)


def discovery_entry(day, slug="aconcagua", status=MountainStatus.ACTIVE):
    return DiscoveryHistoryEntry(
        date=day,
        mountain_slug=slug,
        mountain_name=slug.replace("-", " ").title(),
        mountain_status=status,
        recorded_at=datetime.combine(day, datetime.min.time(), tzinfo=UTC),
    )


@dataclass
class FixedClock:
    day: date

    def today(self):
        return self.day


class RecordingPickIndex:
    def __init__(self, *indexes):
        self._indexes = list(indexes)
        self.counts = []

    def __call__(self, count):
        self.counts.append(count)

        return self._indexes.pop(0)


class FakeMediaStore:
    def __init__(self):
        self.originals = {}
        self.public = {}
        self.calls = []
        self.failing = False
        self.failing_keys = set()

    def put_original(self, key, data, content_type):
        self._record("put_original", key)
        self._fail_on(key)
        self.originals.setdefault(key, (data, content_type))

    def put_public(self, key, data, content_type):
        self._record("put_public", key)
        self._fail_on(key)
        self.public.setdefault(key, (data, content_type))

    def has_original(self, key):
        self._record("has_original", key)

        return key in self.originals

    def has_public(self, key):
        self._record("has_public", key)

        return key in self.public

    def read_original(self, key):
        self._record("read_original", key)
        if key not in self.originals:
            raise InfrastructureError(f"no original is stored under {key}")

        return self.originals[key][0]

    def _record(self, operation, key):
        require_media_key(key)
        if self.failing:
            raise InfrastructureError(f"{operation} failed")
        self.calls.append((operation, key))

    def _fail_on(self, key):
        if key in self.failing_keys:
            raise InfrastructureError(f"storing {key} failed")


class FakePhotographProcessor:
    def __init__(self, result=None, rejection=None):
        self._result = result
        self._rejection = rejection
        self.processed = []

    def process(self, data):
        self.processed.append(data)
        if self._rejection is not None:
            raise PhotographRejected(self._rejection)

        return self._result


class SyntheticPhotographProcessor:
    """Accepts b"WIDTHxHEIGHT" optionally followed by ":anything", as a JPEG of that size."""

    def process(self, data):
        size, _, _ = data.partition(b":")
        width, separator, height = size.partition(b"x")
        if not separator or not width.isdigit() or not height.isdigit():
            raise PhotographRejected(PhotographRejection.NOT_AN_IMAGE)

        return ProcessedPhotograph(
            format=PhotographFormat.JPEG,
            dimensions=ImageDimensions(width=int(width), height=int(height)),
            page_jpeg=b"page " + data,
            viewer_jpeg=b"viewer " + data,
        )


def unused_preview():
    """A preview use case for routes under test that never reach it."""
    return GetMountainPreview(InMemoryMountainCatalogReader(), object(), ManualClock(None))
