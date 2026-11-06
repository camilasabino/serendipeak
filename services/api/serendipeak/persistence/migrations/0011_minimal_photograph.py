from django.db import migrations, models

# What the photograph row keeps is what visitors and editors use: the media, its dimensions,
# the author, the page it comes from, and the license. The records of the v1 import (the file
# URL, the license as reported, its election basis and the approval date) and the Commons file
# title are not catalog data: the seed and the photograph manifest keep them, and a fresh
# bootstrap restores the 73 photographs without them. The creator is dropped because the
# author is the credit shown to visitors, and so is the creator link, which nothing used.
#
# Applied to a populated database, this loses those columns for good. Reversing brings them
# back empty and fails while a photograph has no media, a source page or an author.
PUBLIC_LINK = "^https://[^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000/?#@]+([/?#][^\\u0009-\\u000d\\u001c-\\u0020\\u0085-\\u0085\\u00a0-\\u00a0\\u1680-\\u1680\\u2000-\\u200a\\u2028-\\u2029\\u202f-\\u202f\\u205f-\\u205f\\u3000-\\u3000]*)?$"

REMOVED_CONSTRAINTS = (
    "mountain_image_legacy_file_url_not_blank",
    "mountain_image_legacy_file_url_https",
    "mountain_image_has_media_or_legacy_file_url",
    "mountain_image_creator_not_blank",
    "mountain_image_creator_url_not_blank",
    "mountain_image_creator_url_public_link",
    "mountain_image_license_reported_not_blank",
    "mountain_image_license_election_basis_url_not_blank",
    "mountain_image_source_identifier_not_blank",
    "mountain_image_attribution_not_blank",
    "mountain_image_source_page_url_not_blank",
    "mountain_image_source_page_url_public_link",
)
REMOVED_FIELDS = (
    "legacy_file_url",
    "source_identifier",
    "creator",
    "creator_url",
    "license_reported",
    "license_election_basis_url",
    "approved_on",
)


def _absent_or(field, lookup, value):
    return models.Q((f"{field}__isnull", True), (f"{field}__{lookup}", value), _connector="OR")


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0010_renditions_share_version"),
    ]

    operations = [
        *(
            migrations.RemoveConstraint(model_name="mountainimagerecord", name=name)
            for name in REMOVED_CONSTRAINTS
        ),
        *(
            migrations.RemoveField(model_name="mountainimagerecord", name=name)
            for name in REMOVED_FIELDS
        ),
        migrations.RenameField(
            model_name="mountainimagerecord", old_name="attribution", new_name="author"
        ),
        migrations.AlterField(
            model_name="mountainimagerecord",
            name="source_page_url",
            field=models.TextField(null=True),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=models.Q(("author__regex", "\\S")),
                name="mountain_image_author_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("source_page_url", "regex", "\\S"),
                name="mountain_image_source_page_url_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainimagerecord",
            constraint=models.CheckConstraint(
                condition=_absent_or("source_page_url", "regex", PUBLIC_LINK),
                name="mountain_image_source_page_url_public_link",
            ),
        ),
    ]
