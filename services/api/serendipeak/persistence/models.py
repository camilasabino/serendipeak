import uuid

from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import (
    BooleanField,
    CheckConstraint,
    F,
    FloatField,
    Func,
    Q,
    UniqueConstraint,
)
from django.db.models.functions import Now
from django.db.models.lookups import Range

from serendipeak.catalog import camera, coordinates
from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN, MountainStatus, OsmType
from serendipeak.catalog.public_link import PUBLIC_LINK_PATTERN
from serendipeak.catalog.slug import RESERVED_SLUGS, SLUG_PATTERN

# Plain strings keep the deconstructed constraints equal to the migration.
MOUNTAIN_STATUSES = tuple(status.value for status in MountainStatus)
ACTIVE_STATUS = MountainStatus.ACTIVE.value
OSM_TYPES = tuple(osm_type.value for osm_type in OsmType)


def _has_text(field):
    return Q(**{f"{field}__regex": r"\S"})


def _absent_or_has_text(field):
    return Q(**{f"{field}__isnull": True}) | _has_text(field)


def _is_public_link(field):
    return Q(**{f"{field}__regex": PUBLIC_LINK_PATTERN})


def _absent_or_public_link(field):
    return Q(**{f"{field}__isnull": True}) | _is_public_link(field)


def _absent_or_between(field, minimum, maximum):
    return Q(**{f"{field}__isnull": True}) | Q(
        **{f"{field}__gte": minimum, f"{field}__lte": maximum}
    )


def _all_or_none(*fields):
    return Q(**{f"{field}__isnull": True for field in fields}) | Q(
        **{f"{field}__isnull": False for field in fields}
    )


def _when_active(condition):
    return ~Q(status=ACTIVE_STATUS) | condition


def _location(function, output_field):
    return Func(F("location"), function=function, output_field=output_field)


def _location_coordinate_between(function, minimum, maximum):
    return Q(Range(_location(function, FloatField()), (minimum, maximum)))


class MountainRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    slug = models.TextField()
    name = models.TextField()
    # geography would silently wrap out-of-range coordinates before any CHECK could see them.
    location = gis_models.PointField(srid=4326, spatial_index=False)
    elevation_meters = models.IntegerField()
    prominence_meters = models.IntegerField(null=True)
    range_name = models.TextField(null=True)
    countries = ArrayField(models.TextField(), default=list)
    summary = models.TextField(null=True)
    camera_heading_degrees = models.FloatField(null=True)
    camera_pitch_degrees = models.FloatField(null=True)
    camera_range_meters = models.FloatField(null=True)
    camera_framing_x = models.FloatField(null=True)
    camera_framing_y = models.FloatField(null=True)
    osm_type = models.TextField(null=True)
    osm_id = models.BigIntegerField(null=True)
    wikidata_id = models.TextField(null=True)
    wikipedia_url = models.TextField(null=True)
    status = models.TextField()
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        db_table = "mountain"
        permissions = [("publish_mountain", "Can publish, deactivate and reactivate mountains")]
        constraints = [
            UniqueConstraint(fields=["slug"], name="mountain_slug_key"),
            CheckConstraint(condition=Q(slug__regex=SLUG_PATTERN), name="mountain_slug_format"),
            CheckConstraint(
                condition=~Q(slug__in=sorted(RESERVED_SLUGS)), name="mountain_slug_not_reserved"
            ),
            CheckConstraint(condition=_has_text("name"), name="mountain_name_not_blank"),
            CheckConstraint(
                condition=~Q(_location("ST_IsEmpty", BooleanField())),
                name="mountain_location_not_empty",
            ),
            CheckConstraint(
                condition=_location_coordinate_between(
                    "ST_X", coordinates.LONGITUDE_MIN_DEGREES, coordinates.LONGITUDE_MAX_DEGREES
                ),
                name="mountain_longitude_valid",
            ),
            CheckConstraint(
                condition=_location_coordinate_between(
                    "ST_Y", coordinates.LATITUDE_MIN_DEGREES, coordinates.LATITUDE_MAX_DEGREES
                ),
                name="mountain_latitude_valid",
            ),
            CheckConstraint(
                condition=Q(elevation_meters__gt=0), name="mountain_elevation_positive"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("range_name"), name="mountain_range_name_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("summary"), name="mountain_summary_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("wikipedia_url"),
                name="mountain_wikipedia_url_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_public_link("wikipedia_url"),
                name="mountain_wikipedia_url_public_link",
            ),
            CheckConstraint(
                condition=Q(status__in=MOUNTAIN_STATUSES), name="mountain_status_valid"
            ),
            CheckConstraint(
                condition=_all_or_none(
                    "camera_heading_degrees", "camera_pitch_degrees", "camera_range_meters"
                ),
                name="mountain_camera_complete",
            ),
            CheckConstraint(
                condition=Q(camera_heading_degrees__isnull=True)
                | Q(
                    camera_heading_degrees__gte=camera.HEADING_MIN_DEGREES,
                    camera_heading_degrees__lt=camera.HEADING_MAX_DEGREES_EXCLUSIVE,
                ),
                name="mountain_camera_heading_valid",
            ),
            CheckConstraint(
                condition=_absent_or_between(
                    "camera_pitch_degrees", camera.PITCH_MIN_DEGREES, camera.PITCH_MAX_DEGREES
                ),
                name="mountain_camera_pitch_valid",
            ),
            CheckConstraint(
                condition=_absent_or_between(
                    "camera_range_meters", camera.RANGE_MIN_METERS, camera.RANGE_MAX_METERS
                ),
                name="mountain_camera_range_valid",
            ),
            CheckConstraint(
                condition=_all_or_none("camera_framing_x", "camera_framing_y"),
                name="mountain_camera_framing_complete",
            ),
            CheckConstraint(
                condition=_absent_or_between(
                    "camera_framing_x", camera.FRAMING_MIN, camera.FRAMING_MAX
                ),
                name="mountain_camera_framing_x_valid",
            ),
            CheckConstraint(
                condition=_absent_or_between(
                    "camera_framing_y", camera.FRAMING_MIN, camera.FRAMING_MAX
                ),
                name="mountain_camera_framing_y_valid",
            ),
            CheckConstraint(
                condition=Q(camera_framing_x__isnull=True)
                | Q(camera_heading_degrees__isnull=False),
                name="mountain_camera_framing_requires_camera",
            ),
            CheckConstraint(
                condition=Q(osm_type__isnull=True) | Q(osm_type__in=OSM_TYPES),
                name="mountain_osm_type_valid",
            ),
            CheckConstraint(
                condition=Q(osm_id__isnull=True) | Q(osm_id__gt=0),
                name="mountain_osm_id_positive",
            ),
            CheckConstraint(
                condition=_all_or_none("osm_type", "osm_id"),
                name="mountain_osm_reference_complete",
            ),
            CheckConstraint(
                condition=Q(wikidata_id__isnull=True) | Q(wikidata_id__regex=WIKIDATA_ID_PATTERN),
                name="mountain_wikidata_id_format",
            ),
            CheckConstraint(
                condition=_when_active(Q(camera_heading_degrees__isnull=False)),
                name="mountain_active_has_camera",
            ),
            CheckConstraint(
                condition=_when_active(Q(camera_framing_x__isnull=False)),
                name="mountain_active_has_camera_framing",
            ),
        ]

    def __str__(self):
        return self.slug


class MountainImageRecord(models.Model):
    mountain = models.OneToOneField(
        MountainRecord, primary_key=True, on_delete=models.PROTECT, related_name="image"
    )
    url = models.TextField()
    thumbnail_url = models.TextField(null=True)
    width = models.IntegerField(null=True)
    height = models.IntegerField(null=True)
    creator = models.TextField(null=True)
    attribution = models.TextField()
    license_name = models.TextField(null=True)
    license_url = models.TextField(null=True)
    license_reported = models.TextField(null=True)
    license_election_basis_url = models.TextField(null=True)
    source_page_url = models.TextField()
    source_identifier = models.TextField()
    approved_on = models.DateField(null=True)

    class Meta:
        db_table = "mountain_image"
        constraints = [
            CheckConstraint(condition=_has_text("url"), name="mountain_image_url_not_blank"),
            CheckConstraint(
                condition=_is_public_link("url"), name="mountain_image_url_public_link"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("thumbnail_url"),
                name="mountain_image_thumbnail_url_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_public_link("thumbnail_url"),
                name="mountain_image_thumbnail_url_public_link",
            ),
            CheckConstraint(
                condition=_all_or_none("width", "height"),
                name="mountain_image_dimensions_complete",
            ),
            CheckConstraint(
                condition=Q(width__isnull=True) | Q(width__gt=0),
                name="mountain_image_width_positive",
            ),
            CheckConstraint(
                condition=Q(height__isnull=True) | Q(height__gt=0),
                name="mountain_image_height_positive",
            ),
            CheckConstraint(
                condition=_absent_or_has_text("creator"), name="mountain_image_creator_not_blank"
            ),
            CheckConstraint(
                condition=_has_text("attribution"), name="mountain_image_attribution_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("license_name"),
                name="mountain_image_license_name_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_has_text("license_url"),
                name="mountain_image_license_url_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_public_link("license_url"),
                name="mountain_image_license_url_public_link",
            ),
            CheckConstraint(
                condition=_absent_or_has_text("license_reported"),
                name="mountain_image_license_reported_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_has_text("license_election_basis_url"),
                name="mountain_image_license_election_basis_url_not_blank",
            ),
            CheckConstraint(
                condition=_has_text("source_page_url"),
                name="mountain_image_source_page_url_not_blank",
            ),
            CheckConstraint(
                condition=_is_public_link("source_page_url"),
                name="mountain_image_source_page_url_public_link",
            ),
            CheckConstraint(
                condition=_has_text("source_identifier"),
                name="mountain_image_source_identifier_not_blank",
            ),
        ]

    def __str__(self):
        return self.source_identifier


class DailyDiscoveryRecord(models.Model):
    date = models.DateField(primary_key=True)
    mountain = models.ForeignKey(
        MountainRecord, on_delete=models.PROTECT, related_name="discoveries"
    )
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        db_table = "daily_discovery"

    def __str__(self):
        return self.date.isoformat()
