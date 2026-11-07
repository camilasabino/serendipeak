import dataclasses

import pytest

from serendipeak.catalog.localization import LocalizedText


def test_english_is_the_only_required_language():
    text = LocalizedText(en="Mountain")

    assert (text.en, text.es, text.pt) == ("Mountain", None, None)


def test_it_is_a_frozen_value():
    text = LocalizedText(en="Mountain", es="Montaña")

    with pytest.raises(dataclasses.FrozenInstanceError):
        text.en = "Hill"
    assert text == LocalizedText(en="Mountain", es="Montaña", pt=None)
    assert hash(text) == hash(LocalizedText(en="Mountain", es="Montaña"))
