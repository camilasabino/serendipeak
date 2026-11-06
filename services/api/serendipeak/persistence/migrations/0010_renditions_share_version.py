from django.db import migrations, models
from django.db.models import Value
from django.db.models.functions import Replace


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0009_rendition_version_r2"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("page_key__isnull", True),
                    ("viewer_key", Replace("page_key", Value("/page-"), Value("/viewer-"))),
                    _connector="OR",
                ),
                name="mountain_image_renditions_share_version",
            ),
        ),
    ]
