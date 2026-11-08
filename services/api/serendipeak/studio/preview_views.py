from urllib.parse import urlencode

from django.contrib import messages
from django.http import HttpResponseRedirect
from django.shortcuts import redirect, render
from django.views import View

from serendipeak.catalog.errors import MountainNotInDraft, MountainSlugNotFound
from serendipeak.catalog.issue_preview_token import IssuePreviewToken
from serendipeak.studio import security_log


class MountainPreviewView(View):
    """Hands a signed-in user to the web preview of a draft.

    Issuing writes nothing, so a GET is enough. The token travels in the URL fragment, which the
    browser never sends to any server or as a Referer; the web page exchanges it for a cookie
    and removes it from the address bar.
    """

    issue_preview: IssuePreviewToken | None = None
    web_origin: str = ""

    def get(self, request, slug):
        try:
            grant = self.issue_preview.execute(slug)
        except MountainSlugNotFound:
            return render(request, "studio/mountain_not_found.html", status=404)
        except MountainNotInDraft:
            messages.info(
                request, "This mountain is already public, so there is nothing to preview."
            )

            return redirect("studio:mountain_detail", slug=slug)

        security_log.log_security_event(
            security_log.PREVIEW_ISSUED,
            user_id=str(request.user.pk),
            role=request.user.role,
            slug=grant.slug,
        )
        fragment = urlencode({"token": grant.token, "slug": grant.slug})

        return HttpResponseRedirect(f"{self.web_origin}/preview#{fragment}")
