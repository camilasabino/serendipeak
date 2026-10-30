import logging
from collections.abc import Mapping

from rest_framework.response import Response
from rest_framework.views import exception_handler

from serendipeak.catalog.errors import MountainNotFound
from serendipeak.discovery.errors import NoEligibleMountains
from serendipeak.errors import ApplicationError

logger = logging.getLogger(__name__)

INTERNAL_ERROR = (500, "INTERNAL_ERROR", "Internal server error")

APPLICATION_ERROR_RESPONSES: Mapping[type[ApplicationError], tuple[int, str, str]] = {
    MountainNotFound: (404, "MOUNTAIN_NOT_FOUND", "Mountain not found"),
    NoEligibleMountains: (503, "NO_ELIGIBLE_MOUNTAINS", "No mountains are available for discovery"),
}


def error_response(status: int, code: str, message: str) -> Response:
    response = Response({"error": {"code": code, "message": message}}, status=status)
    # django.request skips responses marked as logged. Mapped errors are expected answers and
    # the 500 path already logs its traceback, so neither is logged again at ERROR.
    response._has_been_logged = True

    return response


def api_exception_handler(exception, context):
    mapped = APPLICATION_ERROR_RESPONSES.get(type(exception))
    if mapped is not None:
        return error_response(*mapped)

    framework_response = exception_handler(exception, context)
    if framework_response is not None:
        return framework_response

    request = context["request"]
    logger.error(
        "Unhandled error on %s %s",
        request.method,
        request.path,
        exc_info=exception,
    )

    return error_response(*INTERNAL_ERROR)
