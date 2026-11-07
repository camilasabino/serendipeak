from django.db import migrations, models


def _has_text(field):
    return models.Q((f"{field}__regex", "\\S"))


def _absent_or_has_text(field):
    return models.Q((f"{field}__isnull", True), (f"{field}__regex", "\\S"), _connector="OR")


class Migration(migrations.Migration):
    dependencies = [("catalog", "0013_user_record_and_role_permissions")]

    # The English columns are the old ones renamed, so no text is copied. Reversing drops the
    # Spanish and Portuguese columns, which nothing writes yet.
    operations = [
        migrations.RemoveConstraint(model_name="mountainrecord", name="mountain_name_not_blank"),
        migrations.RemoveConstraint(model_name="mountainrecord", name="mountain_summary_not_blank"),
        migrations.RenameField(model_name="mountainrecord", old_name="name", new_name="name_en"),
        migrations.RenameField(
            model_name="mountainrecord", old_name="summary", new_name="summary_en"
        ),
        migrations.AddField(
            model_name="mountainrecord", name="name_es", field=models.TextField(null=True)
        ),
        migrations.AddField(
            model_name="mountainrecord", name="name_pt", field=models.TextField(null=True)
        ),
        migrations.AddField(
            model_name="mountainrecord", name="summary_es", field=models.TextField(null=True)
        ),
        migrations.AddField(
            model_name="mountainrecord", name="summary_pt", field=models.TextField(null=True)
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_has_text("name_en"), name="mountain_name_en_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("name_es"), name="mountain_name_es_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("name_pt"), name="mountain_name_pt_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("summary_en"), name="mountain_summary_en_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("summary_es"), name="mountain_summary_es_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_has_text("summary_pt"), name="mountain_summary_pt_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainrecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("summary_en__isnull", False),
                    models.Q(("summary_es__isnull", True), ("summary_pt__isnull", True)),
                    _connector="OR",
                ),
                name="mountain_summary_translation_requires_english",
            ),
        ),
    ]
