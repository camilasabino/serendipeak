from django.db import migrations, models

OSM_NODE = "node"


def convert_osm_reference_to_node_id(apps, schema_editor):
    mountains = apps.get_model("catalog", "MountainRecord").objects.using(
        schema_editor.connection.alias
    )

    not_nodes = mountains.filter(osm_type__isnull=False).exclude(osm_type=OSM_NODE)
    slugs = sorted(not_nodes.values_list("slug", flat=True))
    if slugs:
        raise RuntimeError(
            f"OpenStreetMap reference of {', '.join(slugs)} is not a node and has no "
            "osm_node_id equivalent; nothing was migrated."
        )

    mountains.filter(osm_type=OSM_NODE).update(osm_node_id=models.F("osm_id"))


def convert_node_id_to_osm_reference(apps, schema_editor):
    mountains = apps.get_model("catalog", "MountainRecord").objects.using(
        schema_editor.connection.alias
    )

    mountains.filter(osm_node_id__isnull=False).update(
        osm_type=OSM_NODE, osm_id=models.F("osm_node_id")
    )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0011_minimal_photograph")]

    # Reversing restores the dropped columns empty, except the OpenStreetMap reference: the
    # prominence and the Wikipedia link of existing rows are not recoverable from the database
    # (the seed still holds them).
    operations = [
        migrations.AddField(
            model_name="mountainrecord",
            name="osm_node_id",
            field=models.BigIntegerField(null=True),
        ),
        migrations.RunPython(convert_osm_reference_to_node_id, convert_node_id_to_osm_reference),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_osm_type_valid",
        ),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_osm_id_positive",
        ),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_osm_reference_complete",
        ),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_wikipedia_url_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_wikipedia_url_public_link",
        ),
        migrations.RemoveField(model_name="mountainrecord", name="osm_type"),
        migrations.RemoveField(model_name="mountainrecord", name="osm_id"),
        migrations.RemoveField(model_name="mountainrecord", name="prominence_meters"),
        migrations.RemoveField(model_name="mountainrecord", name="wikipedia_url"),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("osm_node_id__isnull", True), ("osm_node_id__gt", 0), _connector="OR"
                ),
                name="mountain_osm_node_id_positive",
            ),
        ),
    ]
