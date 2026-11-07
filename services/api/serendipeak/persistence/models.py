import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.gis.db import models as gis_models
from django.db import models
from django.db.models import (
    BooleanField,
    CheckConstraint,
    F,
    FloatField,
    Func,
    Q,
    UniqueConstraint,
    Value,
)
from django.db.models.functions import Concat, Now, Replace
from django.db.models.lookups import Range

from serendipeak.accounts.roles import Role
from serendipeak.accounts.username import USERNAME_PATTERN, USERNAME_RULE
from serendipeak.catalog import camera, coordinates
from serendipeak.catalog.entities import WIKIDATA_ID_PATTERN, MountainStatus
from serendipeak.catalog.geography import CONTINENT_CODES, COUNTRY_CODE_PATTERN
from serendipeak.catalog.media import keys
from serendipeak.catalog.media.keys import MEDIA_KEY_PATTERN, SHA256_PATTERN
from serendipeak.catalog.public_link import PUBLIC_LINK_PATTERN
from serendipeak.catalog.slug import RESERVED_SLUGS, SLUG_PATTERN

# Plain strings keep the deconstructed constraints equal to the migration.
MOUNTAIN_STATUSES = tuple(status.value for status in MountainStatus)
ACTIVE_STATUS = MountainStatus.ACTIVE.value


def _has_text(field):
    return Q(**{f"{field}__regex": r"\S"})


def _absent_or_has_text(field):
    return Q(**{f"{field}__isnull": True}) | _has_text(field)


def _is_public_link(field):
    return Q(**{f"{field}__regex": PUBLIC_LINK_PATTERN})


def _absent_or_public_link(field):
    return Q(**{f"{field}__isnull": True}) | _is_public_link(field)


def _absent_or_matching(field, pattern):
    return Q(**{f"{field}__isnull": True}) | Q(**{f"{field}__regex": pattern})


def _absent_or_between(field, minimum, maximum):
    return Q(**{f"{field}__isnull": True}) | Q(
        **{f"{field}__gte": minimum, f"{field}__lte": maximum}
    )


def _absent_or_derived_from_checksum(field, names, *, prefix_only=False):
    # Mirrors catalog.media.keys, which builds the same keys from the checksum. A new
    # rendition version needs a migration that replaces these constraints.
    condition = Q(**{f"{field}__isnull": True})
    for name in names:
        derived = Concat(
            Value(keys.KEY_PREFIX),
            F("original_sha256"),
            Value(f"/{name}"),
            output_field=models.TextField(),
        )
        condition |= Q(**{f"{field}__startswith" if prefix_only else field: derived})

    return condition


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


class ContinentRecord(models.Model):
    """Reference data: loaded by a migration, never written by the application."""

    code = models.TextField(primary_key=True)
    name_en = models.TextField()
    name_es = models.TextField()
    name_pt = models.TextField()

    class Meta:
        db_table = "continent"
        constraints = [
            CheckConstraint(condition=Q(code__in=CONTINENT_CODES), name="continent_code_valid"),
            UniqueConstraint(fields=["name_en"], name="continent_name_en_key"),
            CheckConstraint(condition=_has_text("name_en"), name="continent_name_en_not_blank"),
            CheckConstraint(condition=_has_text("name_es"), name="continent_name_es_not_blank"),
            CheckConstraint(condition=_has_text("name_pt"), name="continent_name_pt_not_blank"),
        ]

    def __str__(self):
        return self.name_en


class CountryRecord(models.Model):
    """Reference data: loaded by a migration, never written by the application."""

    code = models.TextField(primary_key=True)
    name_en = models.TextField()
    name_es = models.TextField()
    name_pt = models.TextField()
    continent = models.ForeignKey(
        ContinentRecord,
        on_delete=models.PROTECT,
        db_column="continent_code",
        related_name="countries",
    )

    class Meta:
        db_table = "country"
        constraints = [
            CheckConstraint(
                condition=Q(code__regex=COUNTRY_CODE_PATTERN), name="country_code_format"
            ),
            UniqueConstraint(fields=["name_en"], name="country_name_en_key"),
            CheckConstraint(condition=_has_text("name_en"), name="country_name_en_not_blank"),
            CheckConstraint(condition=_has_text("name_es"), name="country_name_es_not_blank"),
            CheckConstraint(condition=_has_text("name_pt"), name="country_name_pt_not_blank"),
        ]

    def __str__(self):
        return self.name_en


class MountainRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    slug = models.TextField()
    name_en = models.TextField()
    name_es = models.TextField(null=True)
    name_pt = models.TextField(null=True)
    # geography would silently wrap out-of-range coordinates before any CHECK could see them.
    location = gis_models.PointField(srid=4326, spatial_index=False)
    elevation_meters = models.IntegerField()
    continent = models.ForeignKey(
        ContinentRecord,
        on_delete=models.PROTECT,
        db_column="continent_code",
        related_name="mountains",
    )
    range_name = models.TextField(null=True)
    summary_en = models.TextField(null=True)
    summary_es = models.TextField(null=True)
    summary_pt = models.TextField(null=True)
    camera_heading_degrees = models.FloatField(null=True)
    camera_pitch_degrees = models.FloatField(null=True)
    camera_range_meters = models.FloatField(null=True)
    camera_framing_x = models.FloatField(null=True)
    camera_framing_y = models.FloatField(null=True)
    osm_node_id = models.BigIntegerField(null=True)
    wikidata_id = models.TextField(null=True)
    status = models.TextField()
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())

    class Meta:
        db_table = "mountain"
        constraints = [
            UniqueConstraint(fields=["slug"], name="mountain_slug_key"),
            CheckConstraint(condition=Q(slug__regex=SLUG_PATTERN), name="mountain_slug_format"),
            CheckConstraint(
                condition=~Q(slug__in=sorted(RESERVED_SLUGS)), name="mountain_slug_not_reserved"
            ),
            CheckConstraint(condition=_has_text("name_en"), name="mountain_name_en_not_blank"),
            CheckConstraint(
                condition=_absent_or_has_text("name_es"), name="mountain_name_es_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("name_pt"), name="mountain_name_pt_not_blank"
            ),
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
                condition=_absent_or_has_text("summary_en"), name="mountain_summary_en_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("summary_es"), name="mountain_summary_es_not_blank"
            ),
            CheckConstraint(
                condition=_absent_or_has_text("summary_pt"), name="mountain_summary_pt_not_blank"
            ),
            CheckConstraint(
                condition=Q(summary_en__isnull=False)
                | Q(summary_es__isnull=True, summary_pt__isnull=True),
                name="mountain_summary_translation_requires_english",
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
                condition=Q(osm_node_id__isnull=True) | Q(osm_node_id__gt=0),
                name="mountain_osm_node_id_positive",
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


class MountainCountryRecord(models.Model):
    pk = models.CompositePrimaryKey("mountain_id", "country_id")
    # The primary key serves the lookups by mountain and the index below those by country, so
    # the foreign keys need no indexes of their own.
    mountain = models.ForeignKey(
        MountainRecord, on_delete=models.PROTECT, related_name="country_links", db_index=False
    )
    country = models.ForeignKey(
        CountryRecord,
        on_delete=models.PROTECT,
        db_column="country_code",
        related_name="mountain_links",
        db_index=False,
    )

    class Meta:
        db_table = "mountain_country"
        indexes = [models.Index(fields=["country", "mountain"], name="mountain_country_reverse")]

    def __str__(self):
        return f"link to {self.country_id}"


class MountainImageRecord(models.Model):
    mountain = models.OneToOneField(
        MountainRecord, primary_key=True, on_delete=models.PROTECT, related_name="image"
    )
    original_key = models.TextField(null=True)
    original_sha256 = models.TextField(null=True)
    page_key = models.TextField(null=True)
    viewer_key = models.TextField(null=True)
    width = models.IntegerField(null=True)
    height = models.IntegerField(null=True)
    author = models.TextField()
    license_name = models.TextField(null=True)
    license_url = models.TextField(null=True)
    source_page_url = models.TextField(null=True)

    class Meta:
        db_table = "mountain_image"
        constraints = [
            CheckConstraint(
                condition=_all_or_none("original_key", "original_sha256", "page_key", "viewer_key"),
                name="mountain_image_media_complete",
            ),
            CheckConstraint(
                condition=_absent_or_matching("original_key", MEDIA_KEY_PATTERN),
                name="mountain_image_original_key_format",
            ),
            CheckConstraint(
                condition=_absent_or_matching("original_sha256", SHA256_PATTERN),
                name="mountain_image_original_sha256_format",
            ),
            CheckConstraint(
                condition=_absent_or_matching("page_key", MEDIA_KEY_PATTERN),
                name="mountain_image_page_key_format",
            ),
            CheckConstraint(
                condition=_absent_or_matching("viewer_key", MEDIA_KEY_PATTERN),
                name="mountain_image_viewer_key_format",
            ),
            CheckConstraint(
                condition=_absent_or_derived_from_checksum(
                    "original_key", (keys.ORIGINAL_NAME_PREFIX,), prefix_only=True
                ),
                name="mountain_image_original_key_matches_sha256",
            ),
            CheckConstraint(
                condition=_absent_or_derived_from_checksum("page_key", keys.PAGE_NAMES),
                name="mountain_image_page_key_matches_sha256",
            ),
            CheckConstraint(
                condition=_absent_or_derived_from_checksum("viewer_key", keys.VIEWER_NAMES),
                name="mountain_image_viewer_key_matches_sha256",
            ),
            CheckConstraint(
                condition=Q(page_key__isnull=True)
                | Q(viewer_key=Replace("page_key", Value("/page-"), Value("/viewer-"))),
                name="mountain_image_renditions_share_version",
            ),
            CheckConstraint(
                condition=Q(original_key__isnull=True) | Q(width__isnull=False),
                name="mountain_image_media_has_dimensions",
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
            CheckConstraint(condition=_has_text("author"), name="mountain_image_author_not_blank"),
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
                condition=Q(license_url__isnull=True) | Q(license_name__isnull=False),
                name="mountain_image_license_url_requires_license_name",
            ),
            CheckConstraint(
                condition=_absent_or_has_text("source_page_url"),
                name="mountain_image_source_page_url_not_blank",
            ),
            CheckConstraint(
                condition=_absent_or_public_link("source_page_url"),
                name="mountain_image_source_page_url_public_link",
            ),
        ]

    def __str__(self):
        if self.original_sha256 is not None:
            return f"SHA-256 {self.original_sha256[:12]}"

        return "photograph"


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


ROLES = tuple(role.value for role in Role)
VIEW_PERMISSION_PREFIX = "view_"


class UserManager(BaseUserManager):
    # Stored usernames are lowercase by constraint, so folding the typed one makes sign-in
    # case-insensitive without a second index or a lookup that bypasses the unique key.
    def get_by_natural_key(self, username):
        return super().get_by_natural_key(username.lower())


class UserRecord(AbstractBaseUser):
    """An editorial account. Authorization derives from the role alone: there are no per-user
    permissions or groups, and the framework tables that hold them stay unused."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.TextField()
    role = models.TextField(choices=[(value, value.capitalize()) for value in ROLES])
    is_active = models.BooleanField("active", default=True)
    date_joined = models.DateTimeField(db_default=Now(), editable=False)

    objects = UserManager()

    USERNAME_FIELD = "username"

    class Meta:
        db_table = "app_user"
        verbose_name = "user"
        constraints = [
            UniqueConstraint(
                fields=["username"],
                name="user_username_key",
                violation_error_message="A user with this username already exists.",
            ),
            CheckConstraint(
                condition=Q(username__regex=USERNAME_PATTERN),
                name="user_username_format",
                violation_error_message=USERNAME_RULE,
            ),
            CheckConstraint(condition=Q(role__in=ROLES), name="user_role_valid"),
            CheckConstraint(condition=~Q(password=""), name="user_password_not_blank"),
        ]

    # The admin site only reads this flag to decide who may enter, and both roles may.
    @property
    def is_staff(self):
        return self.is_active

    def has_perm(self, perm, obj=None):
        if not self.is_active:
            return False

        return Role(self.role).can_write or perm.rpartition(".")[2].startswith(
            VIEW_PERMISSION_PREFIX
        )

    def has_module_perms(self, app_label):
        return self.is_active
