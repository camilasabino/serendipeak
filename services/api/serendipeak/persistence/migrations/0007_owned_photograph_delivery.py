from django.db import migrations, models
from django.db.models import F, Value
from django.db.models.functions import Concat

# The rendition names below are the ones of rendition version r1. A new version needs a
# migration that replaces these constraints together with the code that builds the keys.
PUBLIC_LINK = "^https://[^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000/?#@]+([/?#][^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000]*)?$"


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0006_photograph_media"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_url_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_url_public_link",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_thumbnail_url_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_thumbnail_url_public_link",
        ),
        migrations.RenameField(
            model_name="mountainimagerecord",
            old_name="url",
            new_name="legacy_file_url",
        ),
        migrations.RemoveField(
            model_name="mountainimagerecord",
            name="thumbnail_url",
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(("legacy_file_url__regex", "\\S")),
                name="mountain_image_legacy_file_url_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(("legacy_file_url__regex", PUBLIC_LINK)),
                name="mountain_image_legacy_file_url_https",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("original_key__isnull", True),
                    (
                        "original_key__startswith",
                        Concat(
                            Value("photographs/"),
                            F("original_sha256"),
                            Value("/original."),
                            output_field=models.TextField(),
                        ),
                    ),
                    _connector="OR",
                ),
                name="mountain_image_original_key_matches_sha256",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("page_key__isnull", True),
                    (
                        "page_key",
                        Concat(
                            Value("photographs/"),
                            F("original_sha256"),
                            Value("/page-r1.jpg"),
                            output_field=models.TextField(),
                        ),
                    ),
                    _connector="OR",
                ),
                name="mountain_image_page_key_matches_sha256",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("viewer_key__isnull", True),
                    (
                        "viewer_key",
                        Concat(
                            Value("photographs/"),
                            F("original_sha256"),
                            Value("/viewer-r1.jpg"),
                            output_field=models.TextField(),
                        ),
                    ),
                    _connector="OR",
                ),
                name="mountain_image_viewer_key_matches_sha256",
            ),
        ),
    ]
