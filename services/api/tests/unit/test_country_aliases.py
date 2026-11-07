import pytest

from serendipeak.catalog.country_aliases import (
    ANTARCTICA_CODE,
    LEGACY_COUNTRY_CODES,
    UnknownLegacyCountry,
    codes_of_legacy_names,
    legacy_name_of_code,
    links_agree_with_legacy_names,
)
from serendipeak.catalog.geography import is_country_code
from tests.support.catalog import load_seed_document
from tests.support.geography import reference


def test_the_alias_table_names_every_country_the_seed_uses_and_no_other():
    used = {
        name
        for mountain in load_seed_document()["content"]["mountains"]
        for name in mountain["countries"]
    }

    assert set(LEGACY_COUNTRY_CODES) == used
    assert len(LEGACY_COUNTRY_CODES) == 48


def test_every_alias_is_a_code_of_the_reference_data():
    assert all(is_country_code(code) for code in LEGACY_COUNTRY_CODES.values())
    assert set(LEGACY_COUNTRY_CODES.values()) <= set(reference().countries)
    assert len(set(LEGACY_COUNTRY_CODES.values())) == 48


def test_antarctica_has_no_legacy_name():
    assert ANTARCTICA_CODE in reference().countries
    assert legacy_name_of_code(ANTARCTICA_CODE) is None


@pytest.mark.parametrize(
    ("name", "code"),
    [("Turkey", "TR"), ("People's Republic of China", "CN"), ("Russia", "RU"), ("Iran", "IR")],
)
def test_names_that_the_reference_data_spells_differently_keep_their_code(name, code):
    assert LEGACY_COUNTRY_CODES[name] == code
    assert legacy_name_of_code(code) == name


def test_an_unknown_name_is_reported_with_every_other_unknown_name():
    with pytest.raises(UnknownLegacyCountry) as raised:
        codes_of_legacy_names(["Argentina", "Zed", "Atlantis", "Zed"])

    assert raised.value.names == ("Atlantis", "Zed")


@pytest.mark.parametrize(
    ("codes", "names", "agree"),
    [
        (["AR"], ["Argentina"], True),
        (["AR", "AQ"], ["Argentina"], True),
        (["AQ"], [], True),
        ([], [], True),
        (["AR"], [], False),
        (["AR", "CL"], ["Argentina"], False),
        ([], ["Argentina"], False),
        (["AR"], ["Chile"], False),
    ],
)
def test_links_agree_with_legacy_names(codes, names, agree):
    assert links_agree_with_legacy_names(codes, names) is agree
