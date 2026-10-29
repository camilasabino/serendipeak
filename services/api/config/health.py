import json
import logging

from django.db import DatabaseError, connection
from django.http import HttpResponse
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


def json_response(payload, status):
    return HttpResponse(
        json.dumps(payload, separators=(",", ":")),
        status=status,
        content_type="application/json; charset=utf-8",
    )


@require_GET
def healthz(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        logger.exception("Health check could not reach the database")
        return json_response({"status": "database unavailable"}, 503)

    return json_response({"status": "ok"}, 200)
