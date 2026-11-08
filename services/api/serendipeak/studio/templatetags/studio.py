from django import template
from django.conf import settings

from serendipeak.accounts.roles import Role
from serendipeak.studio.navigation import navigation_for

register = template.Library()


@register.inclusion_tag("studio/components/header.html", takes_context=True)
def studio_header(context):
    request = context["request"]
    user = request.user
    signed_in = user.is_authenticated
    current = request.resolver_match.view_name if request.resolver_match else ""

    return {
        "request": request,
        "signed_in": signed_in,
        "username": user.get_username() if signed_in else "",
        "role": Role(user.role).value.capitalize() if signed_in else "",
        "items": (
            [
                {
                    "label": item.label,
                    "url_name": item.url_name,
                    "current": current in (item.url_name, *item.section_url_names),
                }
                for item in navigation_for(Role(user.role))
            ]
            if signed_in
            else []
        ),
        "web_origin": settings.WEB_ORIGIN,
        "csrf_token": context.get("csrf_token"),
    }
