from dataclasses import dataclass, replace
from datetime import date

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
from serendipeak.catalog.ports import StatusChange, StatusChangeOutcome
from serendipeak.discovery.entities import DailyMountain, RecentDiscovery
from serendipeak.errors import InfrastructureError


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
