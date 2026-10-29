from rest_framework.response import Response
from rest_framework.views import APIView

from serendipeak.catalog.get_mountain_by_slug import GetMountainBySlug
from serendipeak.httpapi.representations import represent_mountain


class MountainBySlugView(APIView):
    get_mountain: GetMountainBySlug | None = None

    def get(self, request, slug):
        mountain = self.get_mountain.execute(slug)

        return Response(represent_mountain(mountain))
