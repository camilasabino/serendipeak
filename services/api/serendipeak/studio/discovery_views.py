from django.shortcuts import render
from django.views import View

from serendipeak.discovery.history import ListDailyDiscoveries
from serendipeak.studio import discovery_representations


class DiscoveryListView(View):
    """The record of each day's mountain. Read only: a discovery is history, so there is no
    edit, no delete and no detail page, and the only write is the public site choosing a day."""

    list_discoveries: ListDailyDiscoveries | None = None

    def get(self, request):
        history = self.list_discoveries.execute()

        return render(
            request, "studio/discovery_list.html", discovery_representations.list_context(history)
        )
