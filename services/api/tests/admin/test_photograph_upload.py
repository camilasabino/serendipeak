import hashlib
import io
import re
import struct
import zlib

import pytest
from django.conf import settings
from django.contrib.admin.models import LogEntry
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
from serendipeak.persistence.admin import (
    CREDIT_NOT_REVIEWED,
    PHOTOGRAPH_NOT_STORED,
    PHOTOGRAPH_NOT_STORED_TAG,
)
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
    "image-0-author": "Sébastien Goldberg",
    "image-0-license_name": "Unsplash License",
    "image-0-license_url": "https://unsplash.com/license",
}
NEW_MOUNTAIN = {
    "slug": "new-peak",
    "name_en": "New Peak",
    "latitude": "46.5",
    "longitude": "8.5",
    "elevation_meters": "3500",
    "continent": "EU",
}


def selected_figure(html):
    return re.search(r"<figure[^>]*data-photograph-selected[^>]*>", html).group(0)


def messages_of(response):
    return [str(message) for message in response.context["messages"]]


def puts(store):
    return [call for call in store.calls if call[0].startswith("put")]


def change_url(entry):
    return reverse("admin:catalog_mountainrecord_change", args=[entry.mountain.id])


def transition_url(entry, kind):
    return reverse("admin:catalog_mountainrecord_transition", args=[entry.mountain.id, kind])


def stored_image(entry):
    return MountainImageRecord.objects.get(pk=entry.mountain.id)


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


def replace_photograph(client, entry, data, *, reviewed=True, **overrides):
    page = client.get(change_url(entry))
    fields = {"image-0-photograph_file": upload(data), **overrides}
    if reviewed:
        fields.setdefault("image-0-credit_reviewed", "on")

    return client.post(change_url(entry), form_payload(page, **fields))


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
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(BARE_DRAFT)
        data = gps_jpeg()
        page = editor_client.get(change_url(BARE_DRAFT))

        response = editor_client.post(
            change_url(BARE_DRAFT),
            form_payload(page, **{"image-0-photograph_file": upload(data), **UNSPLASH_CREDIT}),
        )

        assert response.status_code == 302
        image = stored_image(BARE_DRAFT)
        original_key, page_key, viewer_key = keys_of(data)
        assert (image.original_key, image.page_key, image.viewer_key) == keys_of(data)
        assert image.original_sha256 == hashlib.sha256(data).hexdigest()
        assert (image.width, image.height) == (1600, 1200)
        assert media_store.originals[original_key] == (data, "image/jpeg")
        for key in (page_key, viewer_key):
            rendition, content_type = media_store.public[key]
            assert content_type == "image/jpeg"
            assert b"Exif" not in rendition and b"Camera maker" not in rendition
            assert not Image.open(io.BytesIO(rendition)).getexif()

        published = editor_client.post(transition_url(BARE_DRAFT, "publish"))

        assert published.status_code == 302
        assert MountainRecord.objects.get(pk=BARE_DRAFT.mountain.id).status == "active"
        served = editor_client.get("/api/v1/mountains/bare-peak").json()["primaryImage"]
        assert served["url"] == f"{MEDIA_BASE_URL}/{viewer_key}"
        assert served["thumbnailUrl"] == f"{MEDIA_BASE_URL}/{page_key}"
        assert served["sourcePageUrl"] == UNSPLASH_CREDIT["image-0-source_page_url"]
        assert (served["width"], served["height"]) == (1600, 1200)
        assert served["author"] == "Sébastien Goldberg"
        assert not {"attribution", "creator", "creatorUrl", "sourceIdentifier"} & set(served)

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

    def test_the_change_page_shows_the_saved_photograph_and_asks_for_the_essentials(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page_key = ACTIVE.mountain.primary_image.media.page_key

        html = editor_client.get(change_url(ACTIVE)).content.decode()

        assert f'src="{MEDIA_BASE_URL}/{page_key}"' in html
        assert "Saved photograph" in html
        assert 'accept="image/jpeg,image/png,image/webp"' in html
        assert 'enctype="multipart/form-data"' in html
        assert "serendipeak/admin/photograph-upload.js" in html
        assert "Author" in html and "Photo page URL" in html
        assert "hidden" in selected_figure(html)

    def test_the_form_asks_for_the_photograph_the_author_the_page_and_the_license(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        context = editor_client.get(change_url(ACTIVE)).context
        form = next(iter(context["inline_admin_formsets"][0]))
        fieldsets = list(form)

        assert [(fieldset.name, fieldset.is_collapsible) for fieldset in fieldsets] == [
            (None, False),
            ("License", False),
            ("Technical details", True),
        ]
        main, license = (
            [
                field.field.name if hasattr(field.field, "name") else field.field["name"]
                for line in fieldset
                for field in line
            ]
            for fieldset in fieldsets[:2]
        )
        assert main == ["photograph_file", "author", "source_page_url", "credit_reviewed"]
        assert license == ["license_name", "license_url"]

    def test_only_the_author_and_the_photograph_are_required(self, editor_client, load_catalog):
        load_catalog(BARE_DRAFT)
        fields = (
            editor_client.get(change_url(BARE_DRAFT))
            .context["inline_admin_formsets"][0]
            .formset.forms[0]
            .fields
        )

        assert {name for name, field in fields.items() if field.required} == {
            "photograph_file",
            "author",
        }

    def test_a_photograph_without_media_offers_no_saved_preview(self, editor_client, load_catalog):
        awaiting = seeded_mountain("awaiting-peak", status=MountainStatus.DRAFT)
        load_catalog(awaiting)

        html = editor_client.get(change_url(awaiting)).content.decode()

        assert "Saved photograph" not in html
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


class TestOptionalPageAndLicense:
    OWN_PHOTOGRAPH = {
        "image-0-author": "Camila Sabino",
        "image-0-source_page_url": "",
        "image-0-license_name": "",
        "image-0-license_url": "",
    }

    def test_a_photograph_needs_neither_a_page_nor_a_license_to_be_saved_and_published(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(BARE_DRAFT)
        page = editor_client.get(change_url(BARE_DRAFT))

        response = editor_client.post(
            change_url(BARE_DRAFT),
            form_payload(
                page, **{"image-0-photograph_file": upload(jpeg()), **self.OWN_PHOTOGRAPH}
            ),
        )

        assert response.status_code == 302
        image = stored_image(BARE_DRAFT)
        assert (image.source_page_url, image.license_name, image.license_url) == (None, None, None)
        assert editor_client.post(transition_url(BARE_DRAFT, "publish")).status_code == 302
        served = editor_client.get("/api/v1/mountains/bare-peak").json()["primaryImage"]
        assert served["author"] == "Camila Sabino"
        assert not {"sourcePageUrl", "license", "licenseUrl"} & set(served)

    def test_a_page_does_not_stand_in_for_a_license(self, editor_client, load_catalog, media_store):
        load_catalog(BARE_DRAFT)
        page = editor_client.get(change_url(BARE_DRAFT))

        response = editor_client.post(
            change_url(BARE_DRAFT),
            form_payload(
                page,
                **{
                    "image-0-photograph_file": upload(jpeg()),
                    **self.OWN_PHOTOGRAPH,
                    "image-0-source_page_url": "https://example.com/the-photograph",
                },
            ),
        )

        assert response.status_code == 302
        image = stored_image(BARE_DRAFT)
        assert image.license_name is None
        assert editor_client.post(transition_url(BARE_DRAFT, "publish")).status_code == 302

    def test_an_author_is_required(self, editor_client, load_catalog, media_store):
        load_catalog(BARE_DRAFT)
        page = editor_client.get(change_url(BARE_DRAFT))

        response = editor_client.post(
            change_url(BARE_DRAFT),
            form_payload(
                page,
                **{
                    "image-0-photograph_file": upload(jpeg()),
                    **self.OWN_PHOTOGRAPH,
                    "image-0-author": " ",
                },
            ),
        )

        assert response.status_code == 200
        assert list(image_errors_of(response)) == ["author"]
        assert media_store.calls == []

    def test_a_published_photograph_may_drop_its_page_and_its_license(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                **{
                    "image-0-source_page_url": "",
                    "image-0-license_name": "",
                    "image-0-license_url": "",
                },
            ),
        )

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert (image.source_page_url, image.license_name, image.license_url) == (None, None, None)


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
        assert [operation for operation, _ in puts(store)] == [
            "put_original",
            "put_public",
            "put_public",
        ]
        assert store.rows_seen == [previous, previous, previous]
        image = stored_image(entry)
        assert image.original_sha256 == hashlib.sha256(data).hexdigest()
        assert (image.width, image.height) == (3000, 2000)
        assert MountainRecord.objects.get(pk=entry.mountain.id).status == entry.mountain.status

    def test_a_replacement_saves_the_reviewed_author_page_and_license(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, jpeg(), **UNSPLASH_CREDIT)

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.author == UNSPLASH_CREDIT["image-0-author"]
        assert image.source_page_url == UNSPLASH_CREDIT["image-0-source_page_url"]
        assert image.license_name == UNSPLASH_CREDIT["image-0-license_name"]
        assert image.license_url == UNSPLASH_CREDIT["image-0-license_url"]

    def test_a_replacement_bumps_updated_at_and_records_the_change(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        replace_photograph(editor_client, ACTIVE, jpeg())

        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert record.updated_at > ACTIVE.updated_at
        assert "Photograph" in LogEntry.objects.get().get_change_message()

    def test_saving_without_a_file_keeps_the_current_photograph(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE), form_payload(page, **{"image-0-author": "New credit"})
        )

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256
        assert image.author == "New credit"
        assert media_store.calls == []

    def test_a_replacement_the_gate_refuses_changes_no_row(
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
        image = stored_image(INACTIVE)
        assert image.original_sha256 == INACTIVE.mountain.primary_image.media.original_sha256


class TestCreditReview:
    def test_a_replacement_that_keeps_the_previous_credit_unreviewed_is_refused(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, jpeg(), reviewed=False)

        assert response.status_code == 200
        assert image_errors_of(response) == {"credit_reviewed": [CREDIT_NOT_REVIEWED]}
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256

    def test_confirming_that_the_credit_still_applies_saves_the_replacement(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        data = jpeg()

        response = replace_photograph(editor_client, ACTIVE, data, reviewed=True)

        assert response.status_code == 302
        image = stored_image(ACTIVE)
        assert image.original_sha256 == hashlib.sha256(data).hexdigest()
        assert image.author == ACTIVE.mountain.primary_image.author

    @pytest.mark.parametrize(
        "change",
        [
            {"image-0-author": "Another photographer"},
            {"image-0-source_page_url": "https://unsplash.com/photos/another"},
            {"image-0-license_name": "CC BY 4.0"},
            {"image-0-license_url": "https://creativecommons.org/licenses/by/4.0/"},
        ],
    )
    def test_changing_any_credit_field_is_a_review(self, editor_client, load_catalog, change):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, jpeg(), reviewed=False, **change)

        assert response.status_code == 302

    def test_the_credit_alone_can_change_without_a_file_or_a_review(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE), form_payload(page, **{"image-0-author": "Corrected credit"})
        )

        assert response.status_code == 302

    def test_adding_a_photograph_asks_for_no_review(self, editor_client):
        html = editor_client.get(ADD_URL).content.decode()

        assert "credit_reviewed" not in html


class TestARefusedSubmissionStoresNothing:
    """The chosen file is kept by the page in the browser; the server keeps nothing for it."""

    def test_a_refused_save_stores_no_object_and_keeps_what_was_typed(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(
            editor_client,
            ACTIVE,
            jpeg((3000, 2000)),
            **{"image-0-author": "", "summary_en": "Typed."},
        )

        assert response.status_code == 200
        assert "author" in image_errors_of(response)
        html = response.content.decode()
        assert "Typed." in html
        assert "hidden" in selected_figure(html)
        assert media_store.calls == []

    def test_a_refusal_by_another_form_stores_no_object_either(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(ACTIVE)

        response = replace_photograph(editor_client, ACTIVE, jpeg(), slug="Not A Slug")

        assert response.status_code == 200
        assert media_store.calls == []
        assert stored_image(ACTIVE).original_sha256 == (
            ACTIVE.mountain.primary_image.media.original_sha256
        )

    def test_a_refusal_by_the_publication_gate_stores_no_object(
        self, editor_client, load_catalog, media_store
    ):
        load_catalog(INACTIVE)
        MountainRecord.objects.filter(pk=INACTIVE.mountain.id).update(
            camera_framing_x=None, camera_framing_y=None
        )

        response = replace_photograph(editor_client, INACTIVE, jpeg())

        assert response.status_code == 200
        assert media_store.calls == []

    def test_a_refused_new_mountain_stores_no_object(self, editor_client, media_store):
        payload = form_payload(
            editor_client.get(ADD_URL),
            **{**NEW_MOUNTAIN, "slug": ""},
            **{"image-0-photograph_file": upload(jpeg()), **UNSPLASH_CREDIT},
        )

        response = editor_client.post(ADD_URL, payload)

        assert response.status_code == 200
        assert media_store.calls == []
        assert not MountainRecord.objects.exists()

    def test_the_page_carries_the_script_that_keeps_the_chosen_file(
        self, editor_client, load_catalog
    ):
        load_catalog(ACTIVE)

        html = replace_photograph(editor_client, ACTIVE, jpeg(), slug="").content.decode()

        assert "serendipeak/admin/photograph-upload.js" in html
        assert "data-photograph-cancel" in html

    def test_a_new_photograph_still_needs_a_file(self, editor_client):
        response = editor_client.post(
            ADD_URL,
            form_payload(editor_client.get(ADD_URL), **NEW_MOUNTAIN, **UNSPLASH_CREDIT),
        )

        assert response.status_code == 200
        assert list(image_errors_of(response)) == ["photograph_file"]
        assert image_errors_of(response)["photograph_file"] == ["This field is required."]


class TestStorageFailure:
    @pytest.mark.parametrize("failing", ["original", "viewer"])
    def test_a_failed_store_changes_nothing_and_says_so(
        self, editor_client, load_catalog, media_store, failing
    ):
        load_catalog(ACTIVE)
        data = jpeg()
        original_key, page_key, viewer_key = keys_of(data)
        media_store.failing_keys = {original_key if failing == "original" else viewer_key}
        page = editor_client.get(change_url(ACTIVE))

        response = editor_client.post(
            change_url(ACTIVE),
            form_payload(
                page,
                summary_en="Edited.",
                **{"image-0-photograph_file": upload(data), "image-0-credit_reviewed": "on"},
            ),
            follow=True,
        )

        assert response.status_code == 200
        assert response.redirect_chain == [(change_url(ACTIVE), 302)]
        assert messages_of(response) == [PHOTOGRAPH_NOT_STORED]
        tags = [message.tags for message in response.context["messages"]]
        assert tags == [f"{PHOTOGRAPH_NOT_STORED_TAG} error"]
        record = MountainRecord.objects.get(pk=ACTIVE.mountain.id)
        assert (record.summary_en, record.updated_at) == (
            ACTIVE.mountain.summary.en,
            ACTIVE.updated_at,
        )
        image = stored_image(ACTIVE)
        assert image.original_sha256 == ACTIVE.mountain.primary_image.media.original_sha256
        assert image.author == ACTIVE.mountain.primary_image.author
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
            (
                png_claiming(5_000, 5_000),
                "The file is damaged or incomplete.",
            ),
        ],
        ids=[
            "not-an-image",
            "gif",
            "tiff",
            "animated",
            "truncated",
            "too-many-pixels",
            "fewer-pixels-than-declared",
        ],
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
