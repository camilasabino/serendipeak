from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("catalog", "0004_public_link_https")]

    # Reversing re-adds the two CHECKs, which fails once an active mountain has been saved
    # without an OpenStreetMap reference or a Wikidata id.
    operations = [
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_active_has_osm_reference",
        ),
        migrations.RemoveConstraint(
            model_name="mountainrecord",
            name="mountain_active_has_wikidata_id",
        ),
    ]
