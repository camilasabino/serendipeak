import re

from django.urls import reverse

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
