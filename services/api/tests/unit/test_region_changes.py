import pytest

from serendipeak.catalog.localization import LocalizedText
from serendipeak.catalog.region_changes import (
    MountainRegionUpdate,
    MountainRegionViolation,
    NewMountainRegion,
    new_region_violations,
    normalized_new_region,
    normalized_region_update,
    region_update_violations,
    trimmed,
)

V = MountainRegionViolation


def new(slug="andes", en="Andes", es=None, pt=None, wikidata_id=None):
    return NewMountainRegion(
        slug=slug, name=LocalizedText(en=en, es=es, pt=pt), wikidata_id=wikidata_id
    )


def test_a_valid_region_has_no_violations():
    region = new(es="Andes", pt="Andes", wikidata_id="Q5456")

    assert new_region_violations(region) == ()


@pytest.mark.parametrize("slug", ["", "Andes", "two words", "-andes", "andes-", "a--b", "ándes"])
def test_a_slug_that_breaks_the_slug_rule_is_a_violation(slug):
    assert new_region_violations(new(slug=slug)) == (V.SLUG_INVALID,)


def test_every_blank_name_is_reported_and_absent_translations_are_not():
    assert new_region_violations(new(en="", es="", pt="")) == (
        V.NAME_EN_BLANK,
        V.NAME_ES_BLANK,
        V.NAME_PT_BLANK,
    )
    assert new_region_violations(new(es=None, pt=None)) == ()


@pytest.mark.parametrize("wikidata_id", ["", "q5456", "Q0", "Q", "Q05456", "P31", " Q1"])
def test_a_malformed_wikidata_id_is_a_violation(wikidata_id):
    assert new_region_violations(new(wikidata_id=wikidata_id)) == (V.WIKIDATA_ID_INVALID,)


def test_violations_are_collected_not_short_circuited():
    assert new_region_violations(new(slug="Bad Slug", en="", wikidata_id="x")) == (
        V.SLUG_INVALID,
        V.NAME_EN_BLANK,
        V.WIKIDATA_ID_INVALID,
    )


def test_names_are_trimmed_so_whitespace_only_text_is_blank():
    name = trimmed(LocalizedText(en="  Andes ", es="   ", pt=None))

    assert name == LocalizedText(en="Andes", es="", pt=None)
    assert new_region_violations(normalized_new_region(new(en="  ", es="  "))) == (
        V.NAME_EN_BLANK,
        V.NAME_ES_BLANK,
    )


def test_an_update_is_judged_on_names_and_wikidata_only():
    update = MountainRegionUpdate(name=LocalizedText(en="Andes", pt=" "), wikidata_id="nope")

    assert region_update_violations(normalized_region_update(update)) == (
        V.NAME_PT_BLANK,
        V.WIKIDATA_ID_INVALID,
    )
    assert not hasattr(update, "slug")
    assert not hasattr(update, "parent_id")
