import re
from pathlib import Path

from django.conf import settings
from django.test import Client, override_settings
from django.urls import reverse

from tests.studio.support import (
    LANDING_URL,
    LOGIN_URL,
    NEUTRAL_FAILURE,
    PASSWORD,
    PASSWORD_URL,
    sign_in,
    text_of,
)
from tests.support.users import create_user


def test_the_overview_has_the_page_skeleton_of_an_accessible_document(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    assert body.startswith("<!doctype html>")
    assert '<html lang="en">' in body
    assert '<meta name="viewport" content="width=device-width, initial-scale=1">' in body
    assert '<meta name="robots" content="noindex, nofollow">' in body
    assert "<title>Overview · SerendiPeak Studio</title>" in body
    assert '<a class="skip-link" href="#content">' in body
    assert '<main id="content"' in body
    assert body.count("<h1") == 1
    assert "/static/studio/studio.css" in body


def test_the_header_names_the_product_and_marks_the_current_page(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    assert "SerendiPeak" in body
    assert '<span class="brand__product">Studio</span>' in body
    assert '<nav class="app-nav" aria-label="Studio">' in body
    assert re.search(
        r'<a class="app-nav__link" href="/studio/" aria-current="page">Overview</a>', body
    )


def test_view_site_opens_the_web_app_in_a_new_tab_without_opener_access(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    link = re.search(r'<a class="app-account__link" href="([^"]+)"([^>]*)>View site', body)
    assert link.group(1) == settings.WEB_ORIGIN
    assert 'target="_blank"' in link.group(2)
    assert 'rel="noopener"' in link.group(2)
    assert "(opens in a new tab)" in body


def test_the_account_area_shows_who_is_signed_in_and_signs_out_with_a_post_form(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    assert "Signed in as </span>editor" in body
    assert '<span class="role-tag">Editor</span>' in body
    assert f'href="{PASSWORD_URL}"' in body
    form = re.search(
        r'<form class="app-account__form" method="post" action="([^"]+)">(.*?)</form>', body, re.S
    )
    assert form.group(1) == reverse("studio:logout")
    assert "csrfmiddlewaretoken" in form.group(2)
    assert "Sign out" in form.group(2)


def test_the_overview_tells_each_role_what_it_can_do(editor_client, viewer_client):
    assert "As an Editor you can read and change" in text_of(editor_client.get(LANDING_URL))
    assert "As a Viewer you can read" in text_of(viewer_client.get(LANDING_URL))


def overview_sections(response):
    return re.findall(r'<a class="section-link" href="([^"]+)">([^<]+)<', text_of(response))


def test_the_overview_offers_every_section_an_editor_can_use(editor_client):
    assert overview_sections(editor_client.get(LANDING_URL)) == [
        (reverse("studio:mountain_list"), "Mountains"),
        (reverse("studio:region_list"), "Regions"),
        (reverse("studio:discovery_list"), "Daily discoveries"),
        (reverse("studio:user_list"), "Users"),
    ]


def test_the_overview_hides_users_from_a_viewer(viewer_client):
    response = viewer_client.get(LANDING_URL)

    assert [label for _, label in overview_sections(response)] == [
        "Mountains",
        "Regions",
        "Daily discoveries",
    ]
    assert reverse("studio:user_list") not in text_of(response).split("</header>", 1)[1]


def test_the_overview_has_no_instructional_catalog_copy(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    assert "Browse mountains" not in body
    assert "Catalog editing" not in body


def test_the_overview_points_to_the_mountains_and_to_no_other_editorial_interface(editor_client):
    body = text_of(editor_client.get(LANDING_URL))

    assert f'href="{reverse("studio:mountain_list")}"' in body
    assert "Django Admin" not in body
    assert "/admin/" not in body


def test_the_sign_in_page_has_no_navigation_and_labels_its_fields(db):
    body = text_of(Client().get(LOGIN_URL))

    assert "<title>Sign in · SerendiPeak Studio</title>" in body
    assert 'class="app-nav"' not in body
    assert "Sign out" not in body
    assert re.search(r'<label class="field__label" for="id_username">Username</label>', body)
    assert re.search(r'<label class="field__label" for="id_password">Password</label>', body)
    assert 'id="id_username"' in body
    assert "autofocus" in body


def test_a_refused_sign_in_summarizes_the_problem_and_wires_the_fields_for_assistive_tech(db):
    create_user("camila-sabino", password=PASSWORD)

    body = text_of(sign_in(Client(), "camila-sabino", "wrong password!"))

    assert 'aria-labelledby="error-summary-title"' in body
    assert "There is a problem" in body
    assert body.count(NEUTRAL_FAILURE) == 1
    assert 'value="wrong password!"' not in body
    assert 'value="camila-sabino"' in body


def test_a_field_error_is_linked_from_the_summary_and_described_by_the_input(editor_client):
    response = editor_client.post(
        PASSWORD_URL,
        {"old_password": "wrong", "new_password1": "tz4k9wqe", "new_password2": "tz4k9wqe"},
    )
    body = text_of(response)

    assert 'href="#id_old_password"' in body
    assert 'id="id_old_password_error"' in body
    old_password = re.search(r'<input[^>]*id="id_old_password"[^>]*>', body).group(0)
    assert 'aria-invalid="true"' in old_password
    assert "id_old_password_error" in old_password


def test_help_text_is_linked_to_its_input(editor_client):
    body = text_of(editor_client.get(PASSWORD_URL))

    new_password = re.search(r'<input[^>]*id="id_new_password1"[^>]*>', body).group(0)
    assert 'id="id_new_password1_helptext"' in body
    assert "id_new_password1_helptext" in new_password
    assert 'autocomplete="new-password"' in new_password


def test_messages_are_labelled_in_words_not_only_in_color(db):
    create_user("camila-sabino", password=PASSWORD)
    client = Client()
    sign_in(client)
    client.post(reverse("studio:logout"))

    body = text_of(client.get(LOGIN_URL))

    assert '<li class="message message--info">' in body
    assert '<span class="message__label">Info</span>' in body
    assert 'role="status"' in body


@override_settings(ROOT_URLCONF="tests.studio.undeclared_urls")
def test_the_forbidden_page_is_rendered_inside_the_shell(editor_client):
    response = editor_client.get("/studio/undeclared/")
    body = text_of(response)

    assert response.status_code == 403
    assert "You are not allowed to do that" in body
    assert 'class="app-nav"' in body
    assert "<title>Not allowed · SerendiPeak Studio</title>" in body


def test_the_sign_in_page_has_no_explanatory_copy_and_keeps_its_branding(db):
    body = text_of(Client().get(LOGIN_URL))

    assert "back office" not in body
    assert "Sign in to review" not in body
    assert '<span class="brand__name">SerendiPeak</span>' in body
    assert '<h1 class="page-title" id="sign-in-title">Sign in</h1>' in body
    assert body.count("<h1") == 1


def test_every_page_loads_the_theme_script_before_the_body_and_the_switch_is_labelled(
    editor_client, db
):
    for response in (editor_client.get(LANDING_URL), Client().get(LOGIN_URL)):
        body = text_of(response)
        head = body.split("</head>", 1)[0]

        assert re.search(r'<script src="/static/studio/theme\.js"></script>', head)
        assert 'role="group" aria-label="Theme"' in body
        assert body.count('data-theme-option="light"') == 1
        assert body.count('data-theme-option="dark"') == 1
        assert "<style" not in body
        assert " onclick=" not in body


def test_the_theme_script_stores_only_an_explicit_choice_and_survives_blocked_storage():
    script = (Path(__file__).parents[2] / "serendipeak/studio/static/studio/theme.js").read_text(
        encoding="utf-8"
    )

    assert 'const STORAGE_KEY = "studio-theme"' in script
    assert 'apply(readStored() ?? "dark")' in script
    assert "try {" in script
    assert "eval(" not in script
