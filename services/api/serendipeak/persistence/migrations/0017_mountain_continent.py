import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0016_country_reference")]

    # The continent stays nullable here, as does the text array of v1 country names: the
    # private geography backfill fills the continent and the links in between, and the next
    # migration refuses to go on until it has.
    operations = [
        migrations.AddField(
            model_name="mountainrecord",
            name="continent",
            field=models.ForeignKey(
                db_column="continent_code",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="mountains",
                to="catalog.continentrecord",
            ),
        ),
    ]
