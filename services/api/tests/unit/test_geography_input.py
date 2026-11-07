import copy
import uuid

import pytest

from serendipeak.catalog.errors import GeographyBackfillRejected, InvalidGeographyInput
from serendipeak.catalog.geography_input import (
    StoredGeography,
    geography_content_sha256,
    parse_geography_input,
    plan_backfill,
)
from tests.support.geography import geography_document, invented_id, parse_document, reference

KNOWN = frozenset(reference().countries)
ONE, TWO, THREE = (invented_id(label) for label in ("one", "two", "three"))


def document(*entries):
    return geography_document(entries)


def parse(doc, expected=None):
    return parse_geography_input(doc, expected_sha256=expected or doc["content_sha256"])


def refreshed(doc):
    doc["content_sha256"] = geography_content_sha256(doc)
    return doc


def stored(mountain_id, slug, legacy=("Argentina",), continent=None, countries=()):
    return StoredGeography(
        id=mountain_id,
        slug=slug,
        legacy_country_names=None if legacy is None else tuple(legacy),
        continent_code=continent,
        country_codes=tuple(countries),
    )


class TestParsing:
    def test_a_valid_input_is_read_with_sorted_country_codes(self):
        parsed = parse(document((ONE, "alpha-peak", "SA", ["CL", "AR"])))

        [alpha] = parsed.mountains
        assert (alpha.id, alpha.slug, alpha.continent_code) == (ONE, "alpha-peak", "SA")
        assert alpha.country_codes == ("AR", "CL")

    def test_the_checksum_covers_everything_but_itself(self):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        first = geography_content_sha256(doc)

        doc["content_sha256"] = "0" * 64
        assert geography_content_sha256(doc) == first

        doc["mountains"][0]["continent"] = "NA"
        assert geography_content_sha256(doc) != first

    def test_an_input_without_mountains_is_valid(self):
        assert parse(document()).mountains == ()

    @pytest.mark.parametrize("expected", ["", "abc", "A" * 64, "0" * 63, None])
    def test_the_expected_checksum_has_to_be_a_lowercase_sha256(self, expected):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))

        with pytest.raises(InvalidGeographyInput, match="expected checksum is not"):
            parse_geography_input(doc, expected_sha256=expected)

    def test_a_document_with_another_checksum_than_expected_is_refused(self):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))

        with pytest.raises(InvalidGeographyInput, match="does not have the expected checksum"):
            parse(doc, "0" * 64)

    def test_a_document_edited_after_it_was_frozen_is_refused(self):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        frozen = doc["content_sha256"]
        doc["mountains"][0]["continent"] = "EU"

        with pytest.raises(InvalidGeographyInput, match="does not match the content"):
            parse(doc, frozen)

    @pytest.mark.parametrize("draft_checksum", [None, ""])
    def test_a_draft_without_a_checksum_is_refused(self, draft_checksum):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        doc["content_sha256"] = draft_checksum

        with pytest.raises(InvalidGeographyInput):
            parse(doc, "0" * 64)

    @pytest.mark.parametrize(
        "change",
        [
            lambda d: d.update(format="serendipeak.other"),
            lambda d: d.update(version=2),
            lambda d: d.update(extra=1),
            lambda d: d.pop("mountains"),
            lambda d: d.update(mountains={}),
            lambda d: d.update(mountains="alpha"),
        ],
    )
    def test_a_document_of_another_shape_is_refused(self, change):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        change(doc)

        with pytest.raises(InvalidGeographyInput):
            parse(refreshed(doc))

    @pytest.mark.parametrize("document_value", [None, [], "text", 3])
    def test_a_document_that_is_not_an_object_is_refused(self, document_value):
        with pytest.raises(InvalidGeographyInput, match="must be an object"):
            parse_geography_input(document_value, expected_sha256="0" * 64)

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("slug", "Alpha Peak"),
            ("slug", "today"),
            ("slug", 3),
            ("id", "not-a-uuid"),
            ("id", 7),
            ("continent", "ZZ"),
            ("continent", None),
            ("continent", "eu"),
            ("countries", "AR"),
            ("countries", ["ar"]),
            ("countries", ["ARG"]),
            ("countries", [None]),
            ("countries", ["AR", "AR"]),
        ],
    )
    def test_a_mountain_entry_that_breaks_a_rule_is_refused(self, field, value):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        doc["mountains"][0][field] = value

        with pytest.raises(InvalidGeographyInput):
            parse(refreshed(doc))

    @pytest.mark.parametrize("missing", ["id", "slug", "continent", "countries"])
    def test_a_mountain_entry_with_a_missing_member_is_refused(self, missing):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        del doc["mountains"][0][missing]

        with pytest.raises(InvalidGeographyInput, match="missing keys"):
            parse(refreshed(doc))

    def test_an_unknown_member_of_an_entry_is_refused(self):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]))
        doc["mountains"][0]["region"] = "andes"

        with pytest.raises(InvalidGeographyInput, match="unexpected keys"):
            parse(refreshed(doc))

    @pytest.mark.parametrize(
        ("second", "message"),
        [
            ((ONE, "beta-peak", "SA", []), "ids are not unique"),
            ((TWO, "alpha-peak", "SA", []), "slugs are not unique"),
        ],
    )
    def test_ids_and_slugs_are_unique(self, second, message):
        doc = document((ONE, "alpha-peak", "SA", ["AR"]), second)

        with pytest.raises(InvalidGeographyInput, match=message):
            parse(doc)

    def test_every_approved_continent_code_is_accepted(self):
        entries = [
            (invented_id(code), f"peak-{code.lower()}", code, [])
            for code in ("AF", "AN", "AS", "EU", "NA", "OC", "SA")
        ]

        assert len(parse(document(*entries)).mountains) == 7


class TestPlanning:
    def plan(self, entries, rows, known=KNOWN):
        return plan_backfill(parse_document(geography_document(entries)), rows, known)

    def test_an_input_that_covers_the_mountains_plans_their_changes(self):
        plan = self.plan(
            [(ONE, "alpha-peak", "SA", ["AR"]), (TWO, "beta-peak", "EU", ["CH", "IT"])],
            [
                stored(ONE, "alpha-peak"),
                stored(TWO, "beta-peak", legacy=("Switzerland", "Italy")),
            ],
        )

        assert plan.checked == 2
        assert [(c.slug, c.continent, c.added_countries) for c in plan.changes] == [
            ("alpha-peak", (None, "SA"), ("AR",)),
            ("beta-peak", (None, "EU"), ("CH", "IT")),
        ]
        assert plan.unchanged == 0

    def test_a_catalog_that_already_holds_the_input_has_nothing_to_change(self):
        plan = self.plan(
            [(ONE, "alpha-peak", "SA", ["AR"])],
            [stored(ONE, "alpha-peak", continent="SA", countries=["AR"])],
        )

        assert (plan.checked, plan.changes, plan.unchanged) == (1, (), 1)

    def test_only_what_differs_is_reported(self):
        plan = self.plan(
            [(ONE, "alpha-peak", "NA", ["AR", "CL"])],
            [
                stored(
                    ONE,
                    "alpha-peak",
                    legacy=("Argentina", "Chile"),
                    continent="SA",
                    countries=["AR", "PE"],
                )
            ],
        )

        [change] = plan.changes
        assert change.continent == ("SA", "NA")
        assert (change.added_countries, change.removed_countries) == (("CL",), ("PE",))

    def test_antarctica_is_the_one_link_without_a_legacy_name(self):
        plan = self.plan([(ONE, "ice-peak", "AN", ["AQ"])], [stored(ONE, "ice-peak", legacy=())])

        assert plan.changes[0].added_countries == ("AQ",)

    def test_a_country_that_is_not_antarctica_needs_a_legacy_name(self):
        with pytest.raises(GeographyBackfillRejected, match="do not match the stored names"):
            self.plan([(ONE, "alpha-peak", "SA", ["AR", "CL"])], [stored(ONE, "alpha-peak")])

    def test_a_missing_country_is_a_disagreement_too(self):
        with pytest.raises(GeographyBackfillRejected, match="do not match the stored names"):
            self.plan([(ONE, "alpha-peak", "SA", [])], [stored(ONE, "alpha-peak")])

    def test_a_legacy_name_outside_the_alias_table_is_named(self):
        with pytest.raises(GeographyBackfillRejected, match="Atlantis"):
            self.plan(
                [(ONE, "alpha-peak", "SA", ["AR"])],
                [stored(ONE, "alpha-peak", legacy=("Argentina", "Atlantis"))],
            )

    def test_a_country_unknown_to_the_reference_data_is_named(self):
        with pytest.raises(GeographyBackfillRejected, match="alpha-peak: country AR is not"):
            self.plan(
                [(ONE, "alpha-peak", "SA", ["AR"])],
                [stored(ONE, "alpha-peak")],
                known=frozenset({"CL"}),
            )

    def test_agreement_is_skipped_once_the_legacy_names_are_gone(self):
        plan = self.plan(
            [(ONE, "alpha-peak", "SA", ["AR", "CL"])],
            [stored(ONE, "alpha-peak", legacy=None, continent="SA", countries=["AR", "CL"])],
        )

        assert plan.changes == ()

    def test_a_mountain_missing_from_the_input_is_named(self):
        with pytest.raises(GeographyBackfillRejected) as raised:
            self.plan(
                [(ONE, "alpha-peak", "SA", ["AR"])],
                [stored(ONE, "alpha-peak"), stored(TWO, "beta-peak")],
            )

        assert raised.value.problems == (f"mountain beta-peak ({TWO}) has no entry",)

    def test_an_entry_without_a_mountain_is_stale_and_named(self):
        with pytest.raises(GeographyBackfillRejected) as raised:
            self.plan(
                [(ONE, "alpha-peak", "SA", ["AR"]), (THREE, "gone-peak", "EU", [])],
                [stored(ONE, "alpha-peak")],
            )

        assert raised.value.problems == (f"entry gone-peak ({THREE}) matches no mountain",)

    def test_an_entry_whose_slug_is_another_mountains_is_refused(self):
        with pytest.raises(GeographyBackfillRejected, match="entry beta-peak is the entry of"):
            self.plan([(ONE, "beta-peak", "SA", ["AR"])], [stored(ONE, "alpha-peak")])

    def test_every_problem_is_reported_not_only_the_first(self):
        with pytest.raises(GeographyBackfillRejected) as raised:
            self.plan(
                [(THREE, "gone-peak", "EU", [])],
                [stored(ONE, "alpha-peak"), stored(TWO, "beta-peak")],
            )

        assert len(raised.value.problems) == 3

    def test_the_input_is_not_changed_by_planning(self):
        doc = geography_document([(ONE, "alpha-peak", "SA", ["AR"])])
        before = copy.deepcopy(doc)

        self.plan([(ONE, "alpha-peak", "SA", ["AR"])], [stored(ONE, "alpha-peak")])

        assert doc == before

    def test_ids_are_matched_not_slugs_alone(self):
        other = uuid.UUID(int=99)

        with pytest.raises(GeographyBackfillRejected):
            self.plan([(other, "alpha-peak", "SA", ["AR"])], [stored(ONE, "alpha-peak")])
