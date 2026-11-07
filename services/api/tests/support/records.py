from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction

from serendipeak.catalog.country_aliases import legacy_name_of_code
from serendipeak.catalog.entities import ImageDimensions
from serendipeak.catalog.regions import region_id_for_slug
from serendipeak.persistence.models import MountainImageRecord, MountainRecord


def mountain_record(**overrides):
    fields = {
        "slug": "aconcagua",
        "name_en": "Aconcagua",
        "continent_id": "SA",
        "location": Point(-70.0119607, -32.6531487, srid=4326),
        "elevation_meters": 6961,
        "camera_heading_degrees": 66.87,
        "camera_pitch_degrees": -19.85,
        "camera_range_meters": 17132.0,
        "camera_framing_x": -0.0587,
        "camera_framing_y": 0.3857,
        "osm_node_id": 1504741757,
        "wikidata_id": "Q39739",
        "status": "active",
    }
    fields.update(overrides)

    return MountainRecord(**fields)


def image_record(mountain, **overrides):
    fields = {
        "mountain": mountain,
        "author": "Bjørn Christian Tørrissen",
        "license_name": "CC BY-SA 4.0",
        "source_page_url": "https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg",
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
            ImageDimensions(image.width, image.height),
            media_of(image.mountain.slug),
        )
        assert outcome.value == "applied"


def pre_minimal_photograph_columns(entry, raw_image, model):
    """The columns of a seeded photograph as the schema before the minimal photograph kept it.

    The seed's own image record supplies what the photograph row no longer holds, and the
    columns the historical model does not have yet are left out.
    """
    image = entry.mountain.primary_image
    dimensions = image.dimensions
    columns = {
        "mountain_id": entry.mountain.id,
        "width": dimensions.width,
        "height": dimensions.height,
        "creator": raw_image["creator"],
        "attribution": image.author,
        "license_name": image.license_name,
        "license_url": image.license_url,
        "source_page_url": image.source_page_url,
        "source_identifier": raw_image["source_identifier"],
        "legacy_file_url": raw_image["url"],
        "license_reported": raw_image["license_reported"],
        "license_election_basis_url": raw_image["license_election_basis_url"],
        "approved_on": raw_image["approved_on"],
    }
    names = {field.attname for field in model._meta.concrete_fields}

    return {name: value for name, value in columns.items() if name in names}


def columns_at_schema(record, model, *, countries=(), range_name=None):
    """The columns of a mountain row the schema of model has, under the names it has them by.

    Before the localized text and the geography, a mountain row held name, summary and the v1
    country names as text, and no continent; before the regions it held the range name as text.
    """
    names = {field.attname for field in model._meta.concrete_fields}
    columns = {
        field.attname: getattr(record, field.attname)
        for field in record._meta.concrete_fields
        if field.attname in names
    }
    legacy = {
        "name": record.name_en,
        "summary": record.summary_en,
        "countries": list(countries),
        "range_name": range_name,
    }
    columns.update({name: value for name, value in legacy.items() if name in names})

    return columns


def region_ids_of(entry):
    region = entry.mountain.region

    return {} if region is None else {region.region.slug: region_id_for_slug(region.region.slug)}


def legacy_range_name(entry):
    region = entry.mountain.region

    return None if region is None else region.region.name.en


def legacy_country_names(entry):
    return [
        name
        for country in entry.mountain.countries
        if (name := legacy_name_of_code(country.code)) is not None
    ]


def load_committed_catalog_at(target, *, with_media):
    """Loads the committed seed into the schema as of a migration before the minimal photograph.

    The schema is migrated to target first and the rows go in through the historical models, so
    a migration test starts from the data that schema could hold instead of from the current
    one. The seed's own image record fills the columns the photograph row no longer has.
    """
    from serendipeak.persistence.mapping import mountain_record as mountain_record_of
    from tests.support.catalog import committed_seed, load_seed_document, media_of
    from tests.support.migrations import historical_model, migrate_to

    migrate_to(target)
    mountain_model = historical_model(target, "MountainRecord")
    image_model = historical_model(target, "MountainImageRecord")
    raw = {raw["slug"]: raw["image"] for raw in load_seed_document()["content"]["mountains"]}
    entries = committed_seed().mountains

    mountain_model.objects.bulk_create(
        mountain_model(
            **columns_at_schema(
                mountain_record_of(entry, region_ids_of(entry)),
                mountain_model,
                countries=legacy_country_names(entry),
                range_name=legacy_range_name(entry),
            )
        )
        for entry in entries
    )
    images = []
    for entry in entries:
        slug = entry.mountain.slug
        columns = pre_minimal_photograph_columns(entry, raw[slug], image_model)
        if with_media:
            media = media_of(slug)
            columns.update(
                original_key=media.original_key,
                original_sha256=media.original_sha256,
                page_key=media.page_key,
                viewer_key=media.viewer_key,
            )
        images.append(image_model(**columns))
    image_model.objects.bulk_create(images)

    return image_model
