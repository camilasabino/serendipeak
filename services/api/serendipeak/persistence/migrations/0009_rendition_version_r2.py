from django.db import migrations, models
from django.db.models import F, Value
from django.db.models.functions import Concat

# Rows and objects of rendition version r1 stay valid; new photographs get r2. Reversing
# narrows the constraints back to r1, which fails while a photograph carries r2 renditions.


def _absent_or_named(field, *names):
    return models.Q(
        (f"{field}__isnull", True),
        *(
            (
                field,
                Concat(
                    Value("photographs/"),
                    F("original_sha256"),
                    Value(f"/{name}"),
                    output_field=models.TextField(),
                ),
            )
            for name in names
        ),
        _connector="OR",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0008_source_agnostic_photograph"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_page_key_matches_sha256",
        ),
        migrations.RemoveConstraint(
            model_name="mountainimagerecord",
            name="mountain_image_viewer_key_matches_sha256",
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_named("page_key", "page-r1.jpg", "page-r2.jpg"),
                name="mountain_image_page_key_matches_sha256",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or_named("viewer_key", "viewer-r1.jpg", "viewer-r2.jpg"),
                name="mountain_image_viewer_key_matches_sha256",
            ),
        ),
    ]
