from django.db import migrations


def validate_regions(apps, schema_editor):
    alias = schema_editor.connection.alias
    mountain = apps.get_model("catalog", "MountainRecord").objects.using(alias)

    without_region = list(
        mountain.filter(range_name__isnull=False, region__isnull=True)
        .order_by("slug")
        .values_list("slug", flat=True)
    )
    renamed = [
        record.slug
        for record in mountain.filter(range_name__isnull=False, region__isnull=False)
        .select_related("region")
        .order_by("slug")
        if record.region.name_en != record.range_name
    ]

    problems = []
    if without_region:
        problems.append(f"range name without a region: {', '.join(without_region)}")
    if renamed:
        problems.append(f"region name differs from the range name: {', '.join(renamed)}")
    if problems:
        raise RuntimeError(
            f"The regions are incomplete ({'; '.join(problems)}). Run apply_geography_backfill "
            "with the private geography input, then migrate again; nothing was migrated."
        )


def restore_range_names(apps, schema_editor):
    alias = schema_editor.connection.alias
    mountain = apps.get_model("catalog", "MountainRecord").objects.using(alias)

    for record in mountain.filter(region__isnull=False).select_related("region"):
        mountain.filter(pk=record.pk).update(range_name=record.region.name_en)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0019_mountain_region")]

    # Validates and then drops what the backfill replaced. On a database without mountains there
    # is nothing to validate. Reversing gives every mountain with a region the English name of
    # that region as its range name; the hierarchy is not recoverable from a flat name.
    operations = [
        migrations.RunPython(validate_regions, restore_range_names),
        migrations.RemoveConstraint(
            model_name="mountainrecord", name="mountain_range_name_not_blank"
        ),
        migrations.RemoveField(model_name="mountainrecord", name="range_name"),
    ]
