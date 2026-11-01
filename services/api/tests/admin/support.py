from html.parser import HTMLParser


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
