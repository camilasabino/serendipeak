from rest_framework.renderers import JSONRenderer


class ContractJSONRenderer(JSONRenderer):
    charset = "utf-8"
    ensure_ascii = False
