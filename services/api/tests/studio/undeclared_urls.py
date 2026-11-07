from django.http import HttpResponse
from django.urls import path

from config.urls import urlpatterns as application_urlpatterns


def undeclared(request):
    return HttpResponse("reached")


urlpatterns = [*application_urlpatterns, path("studio/undeclared/", undeclared)]
