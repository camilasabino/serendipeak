import hashlib
import io
import struct
import zlib

import pytest
from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.contrib.messages import get_messages
from django.urls import reverse
from PIL import ExifTags, Image

from serendipeak.catalog.entities import MountainStatus
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.ingestion import IngestionLimits, PhotographIngestion
from serendipeak.catalog.media.ports import PhotographFormat
from serendipeak.errors import InfrastructureError
from serendipeak.media.filesystem_media_store import (
    ORIGINALS_DIRECTORY,
    PUBLIC_DIRECTORY,
    FilesystemMediaStore,
)
from serendipeak.media.pillow_processor import PillowPhotographProcessor
from serendipeak.persistence.admin import PHOTOGRAPH_NOT_STORED
from serendipeak.persistence.models import MountainImageRecord, MountainRecord
from tests.admin.support import form_payload, jpeg, upload, use_fake_media_store
from tests.support.catalog import catalog_mountain, seeded_mountain
from tests.support.fakes import FakeMediaStore

pytestmark = pytest.mark.django_db

ADD_URL = reverse("admin:catalog_mountainrecord_add")
MEDIA_BASE_URL = settings.MEDIA_PUBLIC_BASE_URL
BARE_DRAFT = catalog_mountain("bare-peak", status=MountainStatus.DRAFT, primary_image=None)
DRAFT = catalog_mountain("draft-peak", status=MountainStatus.DRAFT)
ACTIVE = catalog_mountain("aconcagua")
INACTIVE = catalog_mountain("old-peak", status=MountainStatus.INACTIVE)
UNSPLASH_CREDIT = {
    "image-0-source_page_url": "https://unsplash.com/photos/a-mountain-at-dawn",
    "image-0-attribution": "Sébastien Goldberg",
    "image-0-creator": "Sébastien Goldberg",
    "image-0-creator_url": "https://unsplash.com/@sebastiengoldberg",
    "image-0-license_name": "Unsplash License",
    "image-0-license_url": "https://unsplash.com/license",
}
NEW_MOUNTAIN = {
    "slug": "new-peak",
    "name": "New Peak",
    "latitude": "46.5",
    "longitude": "8.5",
    "elevation_meters": "3500",
}


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def transition_url(entry, kind):
    return reverse("admin:catalog_mountainrecord_transition", args=[entry.mountain.id, kind])


def stored_image(entry):
    return MountainImageRecord.objects.get(pk=entry.mountain.id)


def messages_of(response):
    return [str(message) for message in get_messages(response.wsgi_request)]


def image_errors_of(response):
    formset = response.context["inline_admin_formsets"][0].formset

    return {name: list(errors) for name, errors in formset.forms[0].errors.items()}


def inline_errors_of(response):
    return list(response.context["inline_admin_formsets"][0].formset.non_form_errors())


def gps_jpeg(size=(1600, 1200)):
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Camera maker"
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "S",
        ExifTags.GPS.GPSLatitude: (32.0, 39.0, 11.0),
    }

    return jpeg(size, exif=exif.tobytes())


def encoded(image, image_format, **options):
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)

    return buffer.getvalue()


def png_claiming(width, height):
    data = encoded(Image.new("RGB", (1, 1)), "PNG")
    header = b"IHDR" + struct.pack(">II", width, height) + data[24:29]

    return data[:12] + header + struct.pack(">I", zlib.crc32(header)) + data[33:]


def keys_of(data):
    sha256 = hashlib.sha256(data).hexdigest()

    return (
        keys.original_key(sha256, PhotographFormat.JPEG),
        keys.page_key(sha256),
        keys.viewer_key(sha256),
    )


def replace_photograph(client, entry, data, **overrides):
    page = client.get(change_url(entry))

    return client.post(
        change_url(entry),
        form_payload(page, **{"image-0-photograph_file": upload(data), **overrides}),
    )


class RowObservingStore(FakeMediaStore):
    """Records the checksum the image row holds, inside the request's transaction, whenever an
    object is stored."""

    def __init__(self, mountain_id):
        super().__init__()
        self.mountain_id = mountain_id
        self.rows_seen = []

    def put_original(self, key, data, content_type):
        self._observe()
        super().put_original(key, data, content_type)

    def put_public(self, key, data, content_type):
        self._observe()
        super().put_public(key, data, content_type)

    def _observe(self):
        row = MountainImageRecord.objects.filter(pk=self.mountain_id)
        self.rows_seen.append(row.values_list("original_sha256", flat=True).first())


class TestUpload:
    def test_a_draft_gets_an_uploaded_photograph_and_is_published_with_it(
        self, publisher_client, load_catalog, media_store
    ):
        load_catalog(BARE_DRAFT)
        data = gps_jpeg()
        page = publisher_client.get(change_url(BARE_DRAFT))

        response = publisher_client.post(
            change_url(BARE_DRAFT),
            form_payload(page, **{"image-0-photograph_file": upload(data), **UNSPLASH_CREDIT}),
        )

        assert response.status_code == 302
        image = stored_image(BARE_DRAFT)
        original_key, page_key, viewer_key = keys_of(data)
        assert (image.original_key, image.page_key, image.viewer_key) == keys_of(data)
        assert image.original_sha256 == hashlib.sha256(data).hexdigest()
        assert (image.width, image.height) == (1600, 1200)
        assert image.creator_url == UNSPLASH_CREDIT["image-0-creator_url"]
        assert (image.legacy_file_url, image.source_identifier) == (None, None)
        assert media_store.originals[original_key] == (data, "image/jpeg")
        for key in (page_key, viewer_key):
            rendition, content_type = media_store.public[key]
            assert content_type == "image/jpeg"
            assert b"Exif" not in rendition and b"Camera maker" not in rendition
            assert not Image.open(io.BytesIO(rendition)).getexif()

        published = publisher_client.post(transition_url(BARE_DRAFT, "publish"))

        assert published.status_code == 302
        assert MountainRecord.objects.get(pk=BARE_DRAFT.mountain.id).status == "active"
        served = publisher_client.get("/api/v1/mountains/bare-peak").json()["primaryImage"]
        assert served["url"] == f"{MEDIA_BASE_URL}/{viewer_key}"
        assert served["thumbnailUrl"] == f"{MEDIA_BASE_URL}/{page_key}"
        assert served["creatorUrl"] == UNSPLASH_CREDIT["image-0-creator_url"]
        assert (served["width"], served["height"]) == (1600, 1200)
        assert "sourceIdentifier" not in served

    def test_a_new_mountain_is_created_with_an_uploaded_photograph(
        self, editor_client, media_store
    ):
        data = jpeg((800, 600))
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **{"image-0-photograph_file": upload(data), **UNSPLASH_CREDIT},
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 302
        image = MountainImageRecord.objects.get(mountain__slug="new-peak")
        assert image.original_key == keys_of(data)[0]
        assert set(keys_of(data)) == set(media_store.originals) | set(media_store.public)

    def test_the_change_page_previews_the_stored_page_rendition_and_accepts_only_images(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page_key = ACTIVE.mountain.primary_image.media.page_key

        html = editor_client.get(change_url(ACTIVE)).content.decode()

        assert f'src="{MEDIA_BASE_URL}/{page_key}"' in html
        assert 'accept="image/jpeg,image/png,image/webp"' in html
        assert 'enctype="multipart/form-data"' in html
        assert "serendipeak/admin/photograph-preview.js" in html
        assert "Replace photograph" in html

    def test_a_photograph_without_media_offers_no_stored_preview(self, editor_client, load_catalog):
        awaiting = seeded_mountain("awaiting-peak", status=MountainStatus.DRAFT)
        load_catalog(awaiting)

        html = editor_client.get(change_url(awaiting)).content.decode()

        assert "Current photograph" not in html
        assert "Not stored yet" in html

    def test_a_license_url_needs_its_license_name(self, editor_client, load_catalog, media_store):
        load_catalog(BARE_DRAFT)
        page = editor_client.get(change_url(BARE_DRAFT))

        response = editor_client.post(
            change_url(BARE_DRAFT),
            form_payload(
                page,
                **{
                    "image-0-photograph_file": upload(jpeg()),
                    **UNSPLASH_CREDIT,
                    "image-0-license_name": "",
                },
            ),
        )

        assert response.status_code == 200
        assert "license_name" in image_errors_of(response)
        assert not MountainImageRecord.objects.filter(pk=BARE_DRAFT.mountain.id).exists()
        assert media_store.originals == {} and media_store.public == {}


def test_an_upload_reaches_a_real_filesystem_store(
    editor_client, load_catalog, monkeypatch, tmp_path
):
    load_catalog(ACTIVE)
    use_fake_media_store(monkeypatch, FilesystemMediaStore(tmp_path))
    data = gps_jpeg()
    original_key, page_key, viewer_key = keys_of(data)

    response = replace_photograph(editor_client, ACTIVE, data)

    assert response.status_code == 302
    assert (tmp_path / ORIGINALS_DIRECTORY / original_key).read_bytes() == data
    assert not (tmp_path / PUBLIC_DIRECTORY / original_key).exists()
    for key in (page_key, viewer_key):
        rendition = (tmp_path / PUBLIC_DIRECTORY / key).read_bytes()
        assert not Image.open(io.BytesIO(rendition)).getexif()
    assert stored_image(ACTIVE).viewer_key == viewer_key


class TestReplacement:
    @pytest.mark.parametrize("entry", [ACTIVE, INACTIVE])
    def test_every_object_is_stored_before_the_row_references_it(
        self, editor_client, load_catalog, monkeypatch, entry
    ):
        load_catalog(entry)
        store = use_fake_media_store(monkeypatch, RowObservingStore(entry.mountain.id))
        previous = entry.mountain.primary_image.media.original_sha256
        data = jpeg((3000, 2000))

        response = replace_photograph(editor_client, entry, data)

        assert response.status_code == 302
        assert [operation for operation, _ in store.calls if operation.startswith("put")] == [
            "put_original",
            "put_public",
            "put_public",
        ]
        assert store.rows_seen == [previous, previous, previous]
        image = stored_image(entry)
        assert image.original_sha256 == hashlib.sha256(data).hexdigest()
        assert (image.width, image.height) == (3000, 2000)
        assert MountainRecord.objects.get(pk=entry.mountain.id).status == entry.mountain.status

    def test_a_replacement_clears_the_legacy_provenance_and_keeps_the_posted_credit(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, jpeg(), **UNSPLASH_CREDIT)

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.legacy_file_url is None
        assert image.source_identifier is None
        assert image.license_reported is None
        assert image.license_election_basis_url is None
        assert image.approved_on is None
        assert image.attribution == UNSPLASH_CREDIT["image-0-attribution"]
        assert image.source_page_url == UNSPLASH_CREDIT["image-0-source_page_url"]
        assert image.license_name == UNSPLASH_CREDIT["image-0-license_name"]
        html = editor_client.get(change_url(ACTIVE)).content.decode()
        assert "Legacy provenance" not in html

    def test_a_replacement_bumps_updated_at_and_records_the_change(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        data = jpeg()

        replace_photograph(editor_client, ACTIVE, data)

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert record.updated_at > ACTIVE.updated_at
        short_checksum = hashlib.sha256(data).hexdigest()[:12]
        assert LogEntry.objects.get().get_change_message() == (
            f"Changed Replace photograph for mountain image record “SHA-256 {short_checksum}”."
        )

    def test_saving_without_a_file_keeps_the_current_photograph(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE), form_payload(page, **{"image-0-attribution": "New credit"})
        )

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256
        assert image.source_identifier == ACTIVE.mountain.primary_image.source_identifier
        assert image.attribution == "New credit"
        assert media_store.calls == []

    def test_a_replacement_the_gate_refuses_stores_nothing(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(INACTIVE)
        MountainRecord.objects.filter(pk=INACTIVE.mountain.id).update(
            camera_framing_x=None, camera_framing_y=None
        )

        response = replace_photograph(editor_client, INACTIVE, jpeg())

        assert response.status_code == 200
        assert inline_errors_of(response) == [
            "Not allowed on a published mountain: the camera framing is missing."
        ]
        assert media_store.originals == {} and media_store.public == {}
        image = stored_image(INACTIVE)
        assert image.original_sha256 == INACTIVE.mountain.primary_image.media.original_sha256


class TestStorageFailure:
    @pytest.mark.parametrize("failing", ["original", "viewer"])
    def test_a_failed_store_changes_nothing_and_reports_it(
        self, editor_client, load_catalog, media_store, failing
    ):
        load_catalog(ACTIVE)
        data = jpeg()
        original_key, page_key, viewer_key = keys_of(data)
        media_store.failing_keys = {original_key if failing == "original" else viewer_key}
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            form_payload(page, summary="Edited.", **{"image-0-photograph_file": upload(data)}),
            follow=True,
        )

        assert response.status_code == 200
        assert response.redirect_chain == [(change_url(ACTIVE), 302)]
        assert messages_of(response) == [PHOTOGRAPH_NOT_STORED]
        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (record.summary, record.updated_at) == (
            ACTIVE.mountain.summary,
            ACTIVE.updated_at,
        )
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256
        assert image.source_identifier == ACTIVE.mountain.primary_image.source_identifier
        assert not LogEntry.objects.exists()
        if failing == "viewer":
            assert set(media_store.originals) == {original_key}
            assert set(media_store.public) == {page_key}

    def test_a_failed_store_while_adding_creates_nothing(self, editor_client, media_store):
        media_store.failing = True
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **{"image-0-photograph_file": upload(jpeg()), **UNSPLASH_CREDIT},
        )

        response = editor_client.post(ADD_URL, payload, follow=True)

        assert response.redirect_chain == [(ADD_URL, 302)]
        assert messages_of(response) == [PHOTOGRAPH_NOT_STORED]
        assert not MountainRecord.objects.exists()
        assert not MountainImageRecord.objects.exists()


class TestRejectedFiles:
    @pytest.mark.parametrize(
        ("data", "message"),
        [
            (b"not an image at all", "The file is not an image. Use a JPEG, PNG or WebP file."),
            (encoded(Image.new("RGB", (40, 30)), "GIF"), "Use a JPEG, PNG or WebP file."),
            (encoded(Image.new("RGB", (40, 30)), "TIFF"), "Use a JPEG, PNG or WebP file."),
            (
                encoded(
                    Image.new("RGB", (40, 30)),
                    "WEBP",
                    save_all=True,
                    append_images=[Image.new("RGB", (40, 30), (200, 0, 0))],
                ),
                "Use a still photograph, not an animated image.",
            ),
            (jpeg((400, 300))[:300], "The file is damaged or incomplete."),
            (png_claiming(10_000, 10_000), "The photograph has too many pixels to be processed."),
        ],
        ids=["not-an-image", "gif", "tiff", "animated", "truncated", "too-many-pixels"],
    )
    def test_each_rejected_file_is_a_field_error_and_nothing_is_stored(
        self, editor_client, load_catalog, media_store, data, message
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, data)

        assert response.status_code == 200
        assert image_errors_of(response) == {"photograph_file": [message]}
        assert media_store.calls == []
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256

    def test_a_file_over_the_byte_limit_is_refused_before_it_is_read(
        self, editor_client, load_catalog, monkeypatch, media_store
    ):
        load_catalog(ACTIVE)
        model_admin = editor_client.get(change_url(ACTIVE)).resolver_match.func.model_admin
        monkeypatch.setattr(
            model_admin,
            "photograph_ingestion",
            PhotographIngestion(
                PillowPhotographProcessor(),
                media_store,
                IngestionLimits(max_bytes=2 * 1024 * 1024),
            ),
        )

        response = replace_photograph(editor_client, ACTIVE, b"\xff" * (2 * 1024 * 1024 + 1))

        assert response.status_code == 200
        assert image_errors_of(response) == {"photograph_file": ["The file is larger than 2 MiB."]}
        assert media_store.calls == []

    def test_a_processing_failure_is_a_field_error_not_a_server_error(
        self, editor_client, load_catalog, monkeypatch, media_store
    ):
        class FailingProcessor:
            def process(self, data):
                raise InfrastructureError("the photograph renditions could not be rendered")

        load_catalog(ACTIVE)
        model_admin = editor_client.get(change_url(ACTIVE)).resolver_match.func.model_admin
        monkeypatch.setattr(
            model_admin,
            "photograph_ingestion",
            PhotographIngestion(
                FailingProcessor(), media_store, IngestionLimits(max_bytes=1024 * 1024)
            ),
        )

        response = replace_photograph(editor_client, ACTIVE, jpeg())

        assert response.status_code == 200
        assert image_errors_of(response) == {
            "photograph_file": [
                "The photograph could not be processed. Try again or use another file."
            ]
        }
        assert media_store.calls == []

    def test_a_rejected_file_on_a_new_photograph_creates_nothing(self, editor_client, media_store):
        payload = form_payload(
            editor_client.get(ADD_URL),
            **NEW_MOUNTAIN,
            **{"image-0-photograph_file": upload(b"GIF89a"), **UNSPLASH_CREDIT},
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert "photograph_file" in image_errors_of(response)
        assert not MountainRecord.objects.exists()
        assert media_store.calls == []


class TestPublishedPhotograph:
    def test_forging_a_clear_of_the_file_keeps_the_media(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            {**form_payload(page), "image-0-photograph_file-clear": "on"},
        )

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256

    def test_a_published_photograph_cannot_be_removed(self, editor_client, load_catalog):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE), {**form_payload(page), "image-0-DELETE": "on"}
        )

        assert response.status_code == 302
        assert MountainImageRecord.objects.filter(pk=ACTIVE.mountain.id).exists()
