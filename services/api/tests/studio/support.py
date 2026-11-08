import io
import re
from dataclasses import replace
from html.parser import HTMLParser

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import resolve, reverse
from PIL import Image

from config.composition import (
    ADMIN_INGESTION_LIMITS,
    build_create_mountain,
    build_update_mountain,
)
from serendipeak.catalog.media.ingestion import PhotographIngestion
from serendipeak.media.pillow_processor import PillowPhotographProcessor
from tests.support.fakes import FakeMediaStore

LOGIN_URL = reverse("studio:login")
LANDING_URL = reverse("studio:landing")
LOGOUT_URL = reverse("studio:logout")
PASSWORD_URL = reverse("studio:password_change")
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "another long passphrase 42"
NEUTRAL_FAILURE = "The username or password is not correct."
THROTTLED = "Too many sign-in attempts. Wait a few minutes and try again."


def sign_in(client, username="camila-sabino", password=PASSWORD, **extra):
    return client.post(LOGIN_URL, {"username": username, "password": password}, **extra)


def csrf_token_of(response):
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', response.content.decode())

    return match.group(1)


def text_of(response):
    return response.content.decode()


class _MountainFormParser(HTMLParser):
    """The values a browser would post for the mountain form, as the page renders them."""

    def __init__(self):
        super().__init__()
        self.values = {}
        self.names = set()
        self._in_form = False
        self._select = None
        self._textarea = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "form" and "mountain-form" in attributes.get("class", ""):
            self._in_form = True
        if not self._in_form:
            return

        name = attributes.get("name")
        if name:
            self.names.add(name)
        if tag == "input" and name:
            kind = attributes.get("type", "text")
            if kind == "checkbox":
                if "checked" in attributes:
                    self._add(name, attributes.get("value", "on"))
            elif kind not in ("submit", "button", "file"):
                self.values[name] = attributes.get("value", "")
        elif tag == "select" and name:
            self._select = name
            self.values.setdefault(name, "")
        elif tag == "option" and self._select and "selected" in attributes:
            self.values[self._select] = attributes.get("value", "")
        elif tag == "textarea" and name:
            self._textarea = name
            self.values[name] = ""

    def _add(self, name, value):
        if name in self.values:
            existing = self.values[name]
            self.values[name] = [*(existing if isinstance(existing, list) else [existing]), value]
        elif name == "countries":
            self.values[name] = [value]
        else:
            self.values[name] = value

    def handle_endtag(self, tag):
        if tag == "form":
            self._in_form = False
        elif tag == "select":
            self._select = None
        elif tag == "textarea":
            # A browser drops the newline that follows the opening tag.
            self.values[self._textarea] = self.values[self._textarea].removeprefix("\n")
            self._textarea = None

    def handle_data(self, data):
        if self._textarea:
            self.values[self._textarea] += data


def form_payload(response, **overrides):
    """What the page's mountain form posts as rendered, with the given fields replaced."""
    parser = _MountainFormParser()
    parser.feed(response.content.decode())
    unknown = set(overrides) - parser.names
    assert not unknown, f"the form has no input named {sorted(unknown)}"

    return {**parser.values, **overrides}


def jpeg(size=(640, 480), colour=(40, 90, 160)):
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="JPEG")

    return buffer.getvalue()


def upload(data=None, name="photograph.jpg", content_type="image/jpeg"):
    return SimpleUploadedFile(name, jpeg() if data is None else data, content_type=content_type)


def use_fake_media_store(monkeypatch, store=None):
    """Make the Studio's creation and edit pages store photographs in a fake, never in the
    configured media store, with the real processor and the Studio's limits."""
    store = store or FakeMediaStore()
    ingestion = PhotographIngestion(PillowPhotographProcessor(), store, ADMIN_INGESTION_LIMITS)
    for name, kwargs in (("studio:mountain_new", {}), ("studio:mountain_edit", {"slug": "any"})):
        initkwargs = resolve(reverse(name, kwargs=kwargs)).func.view_initkwargs
        writes = replace(
            initkwargs["writes"],
            create_mountain=build_create_mountain(ingestion),
            update_mountain=build_update_mountain(ingestion),
        )
        monkeypatch.setitem(initkwargs, "writes", writes)

    return store
