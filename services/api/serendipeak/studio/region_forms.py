from uuid import UUID

from django import forms

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import MountainRegionUpdate, NewMountainRegion
from serendipeak.catalog.region_directory import MoveChoices, RegionDirectory, RegionSummary
from serendipeak.catalog.regions import MountainRegion, RegionOption, derive_region_slug
from serendipeak.studio import region_messages as messages

ROOT = "root"


def _plain_slug(name: str) -> str | None:
    try:
        return derive_region_slug(name)
    except ValueError:
        return None


class _NameFields(forms.Form):
    name_en = forms.CharField(
        label="English name", error_messages={"required": messages.NAME_REQUIRED}
    )
    name_es = forms.CharField(
        label="Spanish name",
        required=False,
        empty_value=None,
        widget=forms.TextInput(attrs={"lang": "es"}),
    )
    name_pt = forms.CharField(
        label="Portuguese name",
        required=False,
        empty_value=None,
        widget=forms.TextInput(attrs={"lang": "pt"}),
    )
    wikidata_id = forms.CharField(
        label="Wikidata id",
        required=False,
        empty_value=None,
        help_text=(
            "The Wikidata item, such as Q5451. Only the format is checked; nothing is looked up."
        ),
    )

    @property
    def name(self) -> LocalizedText:
        return LocalizedText(
            en=self.cleaned_data["name_en"],
            es=self.cleaned_data["name_es"],
            pt=self.cleaned_data["name_pt"],
        )


class RegionForm(_NameFields):
    """A region to create, or the names and the Wikidata item of one to edit.

    The slug and the parent exist only on creation: the slug never changes and the parent changes
    only through a move. The checks here spare an editor a refusal the use case would give anyway;
    the use cases judge the same rules again under their lock.
    """

    parent = forms.ChoiceField(
        label="Parent region",
        required=False,
        help_text="Where the region sits. Leave it empty for a root region.",
    )
    slug = forms.CharField(
        label="Slug",
        required=False,
        widget=forms.TextInput(attrs={"autocapitalize": "none", "spellcheck": "false"}),
        help_text=(
            "The permanent address of the region, unique across all regions and impossible to "
            "change after saving. Leave it empty to derive it from the English name. When the "
            "name exists elsewhere, qualify it with the country or the range, for example "
            "sierra-nevada-spain."
        ),
    )
    confirm_same_name = forms.BooleanField(
        label="This is a different region from those listed above", required=False
    )
    field_order = ("parent", "name_en", "name_es", "name_pt", "slug", "wikidata_id")

    def __init__(
        self,
        data=None,
        *,
        directory: RegionDirectory,
        stored: MountainRegion | None = None,
        initial_parent: RegionOption | None = None,
    ):
        initial = {}
        if stored is not None:
            initial = {
                "name_en": stored.name.en,
                "name_es": stored.name.es or "",
                "name_pt": stored.name.pt or "",
                "wikidata_id": stored.wikidata_id or "",
            }
        elif initial_parent is not None:
            initial = {"parent": str(initial_parent.id)}
        super().__init__(data, initial=initial)
        self._directory = directory
        self.stored = stored
        self.homonyms: tuple[RegionOption, ...] = ()
        self.slug_suggestions: tuple[str, ...] = ()

        if stored is not None:
            for name in ("parent", "slug", "confirm_same_name"):
                del self.fields[name]
            return

        self.fields["parent"].choices = [
            ("", "No parent: a root region"),
            *((str(option.id), option.label) for option in directory.options()),
        ]

    def clean_slug(self):
        return self.cleaned_data["slug"].strip()

    def clean(self):
        cleaned = super().clean()
        name = cleaned.get("name_en")
        if name is None:
            return cleaned
        if self.stored is not None:
            self._judge_rename(name)
            return cleaned

        self._judge_creation(cleaned, name)

        return cleaned

    def _judge_rename(self, name: str) -> None:
        parent = self._parent_of(self.stored.parent_id)
        if parent is not None and self._has_sibling_named(parent, name, excluding=self.stored.id):
            self.add_error("name_en", messages.NAME_TAKEN.format(parent=parent.label, name=name))

    def _parent_of(self, parent_id: UUID | None) -> RegionSummary | None:
        return None if parent_id is None else self._directory.summary(parent_id)

    def _has_sibling_named(
        self, parent: RegionSummary, name: str, *, excluding: UUID | None = None
    ) -> bool:
        # The database compares names ignoring case, and so does this.
        return any(
            child.id != excluding and child.region.name.en.lower() == name.lower()
            for child in self._directory.children(parent.id)
        )

    def _judge_creation(self, cleaned: dict, name: str) -> None:
        parent_id = UUID(cleaned["parent"]) if cleaned.get("parent") else None
        parent = self._parent_of(parent_id)
        if parent_id is not None and parent is None:
            self.add_error("parent", messages.PARENT_UNKNOWN)
            return

        self.slug_suggestions = self._directory.slug_suggestions(name, parent_id)
        slug = cleaned.get("slug", "")
        if not slug and "slug" not in self.errors:
            try:
                cleaned["slug"] = derive_region_slug(name)
            except ValueError:
                self.add_error("slug", messages.SLUG_FROM_NAME)

        if parent is not None and self._has_sibling_named(parent, name):
            self.add_error("name_en", messages.NAME_TAKEN.format(parent=parent.label, name=name))
            return

        self.homonyms = self._directory.same_name_elsewhere(name)
        qualified = cleaned.get("slug") != _plain_slug(name)
        if self.homonyms and not qualified and not cleaned.get("confirm_same_name"):
            if not self.errors:
                self.add_error("confirm_same_name", messages.CONFIRM_SAME_NAME)

    def new_region(self) -> NewMountainRegion:
        parent = self.cleaned_data["parent"]

        return NewMountainRegion(
            slug=self.cleaned_data["slug"],
            name=self.name,
            parent_id=UUID(parent) if parent else None,
            wikidata_id=self.cleaned_data["wikidata_id"],
        )

    def region_update(self) -> MountainRegionUpdate:
        return MountainRegionUpdate(name=self.name, wikidata_id=self.cleaned_data["wikidata_id"])


class _DestinationSelect(forms.Select):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.unavailable: frozenset[str] = frozenset()

    def create_option(self, name, value, label, selected, index, subindex=None, attrs=None):
        option = super().create_option(name, value, label, selected, index, subindex, attrs)
        if value in self.unavailable:
            option["attrs"]["disabled"] = True

        return option


class RegionMoveForm(forms.Form):
    """The destination of a move. Every region is listed, and each one that cannot receive the
    region says why in its label, so the choice is explained rather than silently narrowed."""

    parent = forms.ChoiceField(
        label="New parent",
        widget=_DestinationSelect,
        error_messages={"required": messages.DESTINATION_REQUIRED},
    )

    def __init__(self, data=None, *, region: RegionSummary, choices: MoveChoices):
        super().__init__(data)
        name = region.region.name.en
        self._reasons: dict[str, str] = {}
        options = [("", "Choose a destination")]

        root_label = "No parent: make it a root region"
        if choices.root_refusal is not None:
            reason = messages.move_refusal(choices.root_refusal, name)
            self._reasons[ROOT] = reason
            root_label = f"{root_label} (unavailable: {reason})"
        options.append((ROOT, root_label))

        for target in choices.targets:
            value = str(target.option.id)
            label = target.option.label
            if target.refusal is not None:
                reason = messages.move_refusal(target.refusal, name)
                self._reasons[value] = reason
                label = f"{label} (unavailable: {reason})"
            options.append((value, label))

        self.fields["parent"].choices = options
        self.fields["parent"].widget.unavailable = frozenset(self._reasons)
        self.unavailable_count = len(self._reasons)

    def clean_parent(self):
        value = self.cleaned_data["parent"]
        if value in self._reasons:
            raise forms.ValidationError(messages.UNAVAILABLE.format(self._reasons[value]))

        return value

    @property
    def target_id(self) -> UUID | None:
        value = self.cleaned_data["parent"]

        return None if value == ROOT else UUID(value)
