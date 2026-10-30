from rest_framework.response import Response
from rest_framework.views import APIView

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.representations import represent_daily_mountain, represent_mountain


class MountainBySlugView(APIView):
    get_mountain: GetMountainBySlug | None = None

    def get(self, request, slug):
        mountain = self.get_mountain.execute(slug)

        return Response(represent_mountain(mountain))


class TodaysMountainView(APIView):
    get_todays_mountain: GetTodaysMountain | None = None

    def get(self, request):
        daily = self.get_todays_mountain.execute()

        return Response(represent_daily_mountain(daily))
