from django.db import migrations, models

# Reversing restores NOT NULL on legacy_file_url and source_identifier, which fails while an
# uploaded photograph lacks them, and drops creator_url with every credit link it holds.
PUBLIC_LINK = "^https://[^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000/?#@]+([/?#][^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000]*)?$"


def _absent_or(field, lookup, value):
    return models.Q((f"{field}__isnull", True), (f"{field}__{lookup}", value), _connector="OR")


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0007_owned_photograph_delivery"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_source_identifier_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_legacy_file_url_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_legacy_file_url_https",
        ),
        migrations.AddField(
            model_name="mountainimagerecord",
            name="creator_url",
            field=models.TextField(null=True),
        ),
        migrations.AlterField(
            model_name="mountainimagerecord",
            name="legacy_file_url",
            field=models.TextField(null=True, verbose_name="legacy file URL"),
        ),
        migrations.AlterField(
            model_name="mountainimagerecord",
            name="license_election_basis_url",
            field=models.TextField(null=True, verbose_name="license election basis URL"),
        ),
        migrations.AlterField(
            model_name="mountainimagerecord",
            name="source_identifier",
            field=models.TextField(null=True),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("legacy_file_url", "regex", "\\S"),
                name="mountain_image_legacy_file_url_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("legacy_file_url", "regex", PUBLIC_LINK),
                name="mountain_image_legacy_file_url_https",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("legacy_file_url__isnull", False),
                    ("original_key__isnull", False),
                    _connector="OR",
                ),
                name="mountain_image_has_media_or_legacy_file_url",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("creator_url", "regex", "\\S"),
                name="mountain_image_creator_url_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("creator_url", "regex", PUBLIC_LINK),
                name="mountain_image_creator_url_public_link",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("license_url__isnull", True),
                    ("license_name__isnull", False),
                    _connector="OR",
                ),
                name="mountain_image_license_url_requires_license_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("source_identifier", "regex", "\\S"),
                name="mountain_image_source_identifier_not_blank",
            ),
        ),
    ]
