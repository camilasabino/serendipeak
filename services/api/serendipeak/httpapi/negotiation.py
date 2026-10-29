from rest_framework.negotiation import BaseContentNegotiation


class JsonOnlyNegotiation(BaseContentNegotiation):
    # v1 answers JSON whatever the Accept header says; DRF would answer 406 instead.
    def select_renderer(self, request, renderers, format_suffix=None):
        renderer = renderers[0]

        return renderer, renderer.media_type

    def select_parser(self, request, parsers):
        return None
