from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from uuid import uuid4

from serendipeak.accounts.access import Access, AccessChangeContext, AccessViolation, Account
from serendipeak.accounts.entities import User
from serendipeak.accounts.errors import PasswordRejected, UsernameTaken
from serendipeak.accounts.ports import AccessChange, AccessChangeOutcome
from serendipeak.catalog.bootstrap.ports import AttachOutcome, CatalogSeed, CatalogSnapshot
from serendipeak.catalog.entities import (
    PUBLIC_STATUSES,
    CandidateMountain,
    ImageDimensions,
    MountainStatus,
)
from serendipeak.catalog.errors import (
    CatalogAlreadyPopulated,
    PhotographRejected,
    PhotographRejection,
)
from serendipeak.catalog.media.keys import require_media_key
from serendipeak.catalog.media.ports import PhotographFormat, ProcessedPhotograph
from serendipeak.catalog.ports import CameraChange, StatusChange, StatusChangeOutcome
from serendipeak.discovery.entities import DailyMountain, RecentDiscovery
from serendipeak.errors import InfrastructureError


class InMemoryGeographyReference:
    def read(self):
        from tests.support.geography import reference

        return reference()


class InMemoryGeographyStore:
    """Stands in for the Django adapter of the backfill and draft ports."""

    def __init__(self, mountains=(), known_countries=None):
        from tests.support.geography import reference

        self._rows = {mountain.id: mountain for mountain in mountains}
        self._known = frozenset(known_countries or reference().countries)
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
        plan = plan_backfill(geography, list(self._rows.values()), self._known)
        if dry_run:
            return plan

        by_slug = {entry.slug: entry for entry in geography.mountains}
        for change in plan.changes:
            entry = by_slug[change.slug]
            self.writes += 1
            self._rows[entry.id] = replace(
                self._rows[entry.id],
                continent_code=entry.continent_code,
                country_codes=entry.country_codes,
            )

        return plan

    def read_mountains(self):
        return tuple(sorted(self._rows.values(), key=lambda row: row.slug))


class InMemoryCatalogStore:
    def __init__(self):
        self._mountains = {}
        self._discoveries = {}

    def load(self, seed: CatalogSeed):
        if self._mountains:
            raise CatalogAlreadyPopulated()

        self._mountains.update((entry.mountain.id, entry) for entry in seed.mountains)
        self._discoveries.update((discovery.date, discovery) for discovery in seed.discoveries)

    def snapshot(self):
        return CatalogSnapshot(
            mountains=tuple(
                sorted(self._mountains.values(), key=lambda entry: entry.mountain.slug)
            ),
            discoveries=tuple(sorted(self._discoveries.values(), key=lambda item: item.date)),
        )

    def attach_media(self, mountain_id, expected_dimensions, media):
        entry = self._mountains.get(mountain_id)
        image = None if entry is None else entry.mountain.primary_image
        if image is None:
            return AttachOutcome.NOT_FOUND
        if image.media is not None:
            return AttachOutcome.ALREADY_ATTACHED if image.media == media else AttachOutcome.STALE
        if image.dimensions != expected_dimensions:
            return AttachOutcome.STALE

        self.replace(
            replace(
                entry,
                mountain=replace(entry.mountain, primary_image=replace(image, media=media)),
            )
        )

        return AttachOutcome.APPLIED

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

    def get(self, user_id):
        return self._users[user_id]

    @staticmethod
    def _access_of(user):
        return Access(user.role, user.is_active)


class InMemoryMountainCameraStore:
    def __init__(self, mountains=()):
        self._mountains = {mountain.id: mountain for mountain in mountains}
        self.calls = 0

    def replace_camera(self, mountain_id, camera, expected):
        self.calls += 1
        mountain = self._mountains.get(mountain_id)
        if mountain is None:
            return CameraChange.NOT_FOUND
        if mountain.camera != expected:
            return CameraChange.STALE

        self._mountains[mountain_id] = replace(mountain, camera=camera)

        return CameraChange.APPLIED

    def mountain(self, mountain_id):
        return self._mountains[mountain_id]


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


class FakeSourceImageFetcher:
    def __init__(self, files=None, failures=None):
        self.files = dict(files or {})
        self.failures = dict(failures or {})
        self.fetched = []

    def fetch(self, url):
        self.fetched.append(url)
        if url in self.failures:
            raise self.failures[url]

        return self.files[url]
