import io
from html.parser import HTMLParser

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import resolve, reverse
from PIL import Image

from config.composition import ADMIN_INGESTION_LIMITS
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.media.pillow_processor import PillowPhotographProcessor
from tests.support.fakes import FakeMediaStore


class _FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}
        self.names = set()
        self._select = None
        self._textarea = None
        self._in_content_form = False
        self._form_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "form" and attributes.get("method", "").lower() == "post":
            if attributes.get("id", "").endswith("_form"):
                self._in_content_form = True
        if not self._in_content_form:
            return

        name = attributes.get("name")
        if tag == "input" and name:
            self.names.add(name)
            kind = attributes.get("type", "text")
            if kind in ("checkbox", "radio"):
                if "checked" in attributes:
                    self.values[name] = attributes.get("value", "on")
            elif kind not in ("submit", "button", "file"):
                self.values[name] = attributes.get("value", "")
        elif tag == "select" and name:
            self.names.add(name)
            self._select = name
            self.values.setdefault(name, "")
        elif tag == "option" and self._select and "selected" in attributes:
            self.values[self._select] = attributes.get("value", "")
        elif tag == "textarea" and name:
            self.names.add(name)
            self._textarea = name
            self.values[name] = ""

    def handle_endtag(self, tag):
        if tag == "form":
            self._in_content_form = False
        elif tag == "select":
            self._select = None
        elif tag == "textarea":
            self._textarea = None

    def handle_data(self, data):
        if self._textarea:
            self.values[self._textarea] += data


def form_payload(response, **overrides):
    parser = _FormParser()
    parser.feed(response.content.decode())
    unknown = set(overrides) - parser.names
    assert not unknown, f"the form has no input named {sorted(unknown)}"

    return {**parser.values, **overrides, "_save": "Save"}


def input_names(response):
    parser = _FormParser()
    parser.feed(response.content.decode())

    return parser.names


def use_fake_media_store(monkeypatch, store=None):
    """Make the registered mountain admin store photographs in a fake instead of the configured
    media store, with the real processor and the Admin limits."""
    store = store or FakeMediaStore()
    model_admin = resolve(reverse("admin:catalog_mountainrecord_add")).func.model_admin
    ingestion = PhotographIngestion(PillowPhotographProcessor(), store, ADMIN_INGESTION_LIMITS)
    monkeypatch.setattr(model_admin, "photograph_ingestion", ingestion)

    return store


def jpeg(size=(640, 480), colour=(40, 90, 160), **options):
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="JPEG", **options)

    return buffer.getvalue()


def upload(data, name="photograph.jpg", content_type="image/jpeg"):
    return SimpleUploadedFile(name, data, content_type=content_type)
