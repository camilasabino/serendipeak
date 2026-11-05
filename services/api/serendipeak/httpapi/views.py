from rest_framework.response import Response
from rest_framework.views import APIView

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.discovery.get_random_mountain import GetRandomMountain
from serendipeak.discovery.get_todays_mountain import GetTodaysMountain
from serendipeak.httpapi.representations import represent_daily_mountain, represent_mountain


class MountainBySlugView(APIView):
    get_mountain: GetMountainBySlug | None = None
    media_base_url: str | None = None

    def get(self, request, slug):
        mountain = self.get_mountain.execute(slug)

        return Response(represent_mountain(mountain, self.media_base_url))


class TodaysMountainView(APIView):
    get_todays_mountain: GetTodaysMountain | None = None
    media_base_url: str | None = None

    def get(self, request):
        daily = self.get_todays_mountain.execute()

        return Response(represent_daily_mountain(daily, self.media_base_url))


class RandomMountainView(APIView):
    get_random_mountain: GetRandomMountain | None = None
    media_base_url: str | None = None

    def get(self, request):
        # Only the first exclude value counts, as in v1; QueryDict.get would return the last.
        exclude = next(iter(request.query_params.getlist("exclude")), "")
        mountain = self.get_random_mountain.execute(exclude)

        return Response(represent_mountain(mountain, self.media_base_url))
