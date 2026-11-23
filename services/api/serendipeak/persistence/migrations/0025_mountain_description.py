from django.db import migrations, models


def _absent_or_has_text(field):
    return models.Q((f"{field}__isnull", True), (f"{field}__regex", "\\S"), _connector="OR")


class Migration(migrations.Migration):
    dependencies = [("catalog", "0024_mountain_slug_alias")]

    # Additive: the three columns are nullable and every existing row keeps them null, so no row
    # is rewritten and the checks hold for all of them. Reversing drops the columns and the texts
    # in them.
    operations = [
        migrations.AddField(
            model_name="mountainrecord", name="description_en", field=models.TextField(null=True)
        ),
        migrations.AddField(
            model_name="mountainrecord", name="description_es", field=models.TextField(null=True)
        ),
        migrations.AddField(
            model_name="mountainrecord", name="description_pt", field=models.TextField(null=True)
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("description_en"),
                name="mountain_description_en_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("description_es"),
                name="mountain_description_es_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("description_pt"),
                name="mountain_description_pt_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("description_en__isnull", False),
                    models.Q(("description_es__isnull", True), ("description_pt__isnull", True)),
                    _connector="OR",
                ),
                name="mountain_description_translation_requires_english",
            ),
        ),
    ]
