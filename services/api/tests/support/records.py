from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction

from serendipeak.catalog.entities import ImageDimensions
from serendipeak.persistence.models import MountainImageRecord, MountainRecord


def mountain_record(**overrides):
    fields = {
        "slug": "aconcagua",
        "name": "Aconcagua",
        "location": Point(-70.0119607, -32.6531487, srid=4326),
        "elevation_meters": 6961,
        "camera_heading_degrees": 66.87,
        "camera_pitch_degrees": -19.85,
        "camera_range_meters": 17132.0,
        "camera_framing_x": -0.0587,
        "camera_framing_y": 0.3857,
        "osm_type": "node",
        "osm_id": 1504741757,
        "wikidata_id": "Q39739",
        "status": "active",
    }
    fields.update(overrides)

    return MountainRecord(**fields)


def image_record(mountain, **overrides):
    fields = {
        "mountain": mountain,
        "legacy_file_url": "https://upload.wikimedia.org/wikipedia/commons/4/4e/Aconcagua2016.jpg",
        "attribution": "Bjørn Christian Tørrissen",
        "source_page_url": "https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
        "source_identifier": "File:Aconcagua2016.jpg",
    }
    fields.update(overrides)

    return MountainImageRecord(**fields)


def insert_error(record):
    try:
        with transaction.atomic():
            record.save(force_insert=True)
    except IntegrityError as error:
        return error.__cause__.diag
    raise AssertionError("insert was accepted")


def attach_committed_media():
    """Materializes every stored photograph the way the command does: through the writer."""
    from serendipeak.persistence.photograph_media_writer import DjangoPhotographMediaWriter
    from tests.support.catalog import media_of

    writer = DjangoPhotographMediaWriter()
    for image in MountainImageRecord.objects.select_related("mountain"):
        outcome = writer.attach_media(
            image.mountain_id,
            image.legacy_file_url,
            ImageDimensions(image.width, image.height),
            media_of(image.mountain.slug),
        )
        assert outcome.value == "applied"
