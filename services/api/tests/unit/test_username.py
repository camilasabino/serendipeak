import pytest

from serendipeak.accounts.username import is_valid_username


@pytest.mark.parametrize(
    "username", ["abc", "camila", "camila.sabino", "a-b_c", "0day", "a" + "b" * 31]
)
def test_valid_usernames(username):
    assert is_valid_username(username)


@pytest.mark.parametrize(
    "username",
    [
        "",
        "ab",
        "a" + "b" * 32,
        "Camila",
        "-camila",
        ".camila",
        "ca mila",
        "camila\n",
        "camíla",
        "ｃａｍｉｌａ",
        "ca/mila",
    ],
)
def test_invalid_usernames(username):
    assert not is_valid_username(username)
