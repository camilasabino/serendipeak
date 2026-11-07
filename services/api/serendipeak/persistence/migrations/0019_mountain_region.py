import uuid

import django.db.models.deletion
import django.db.models.expressions
import django.db.models.functions.text
from django.db import migrations, models
from django.db.models import Q

# Every structure write of the region tree takes this transaction-level advisory lock, so the
# trigger below and any writer that wants a stable tree serialize on the same key.
STRUCTURE_LOCK_KEY = 4737260011

CREATE_TRIGGERS = f"""
CREATE FUNCTION mountain_region_reject_identity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'the id and the slug of a mountain region never change'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER mountain_region_identity_immutable
BEFORE UPDATE ON mountain_region
FOR EACH ROW
WHEN (OLD.id IS DISTINCT FROM NEW.id OR OLD.slug IS DISTINCT FROM NEW.slug)
EXECUTE FUNCTION mountain_region_reject_identity_change();

CREATE FUNCTION mountain_region_reject_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    descends_from_itself boolean;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- A query inside a volatile function takes its own snapshot, so after waiting for the lock
    -- it sees every move the lock holder committed. UNION keeps the walk finite even over data
    -- that already holds a cycle.
    PERFORM pg_advisory_xact_lock({STRUCTURE_LOCK_KEY});

    WITH RECURSIVE ancestors(id) AS (
        SELECT NEW.parent_id
        UNION
        SELECT region.parent_id
        FROM mountain_region region
        JOIN ancestors ON region.id = ancestors.id
        WHERE region.parent_id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO descends_from_itself;

    IF descends_from_itself THEN
        RAISE EXCEPTION 'mountain region % cannot descend from itself', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER mountain_region_no_cycle
BEFORE UPDATE OF parent_id ON mountain_region
FOR EACH ROW EXECUTE FUNCTION mountain_region_reject_cycle();
"""

DROP_TRIGGERS = """
DROP TRIGGER mountain_region_no_cycle ON mountain_region;
DROP FUNCTION mountain_region_reject_cycle();
DROP TRIGGER mountain_region_identity_immutable ON mountain_region;
DROP FUNCTION mountain_region_reject_identity_change();
"""


class Migration(migrations.Migration):
    dependencies = [("catalog", "0018_geography_final_validation")]

    # The table and the nullable region_id arrive empty and without touching the mountains: the
    # regions and the assignments come from the private geography backfill, and the next
    # migration drops range_name once every range name has its region.
    operations = [
        migrations.CreateModel(
            name="MountainRegionRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, primary_key=True, serialize=False)),
                ("slug", models.TextField()),
                ("name_en", models.TextField()),
                ("name_es", models.TextField(null=True)),
                ("name_pt", models.TextField(null=True)),
                ("wikidata_id", models.TextField(null=True)),
                (
                    "parent",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="children",
                        to="catalog.mountainregionrecord",
                    ),
                ),
            ],
            options={"db_table": "mountain_region"},
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.UniqueConstraint(fields=("slug",), name="mountain_region_slug_key"),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=Q(slug__regex=r"^[a-z0-9]+(-[a-z0-9]+)*$"),
                name="mountain_region_slug_format",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=~Q(parent=models.F("id")), name="mountain_region_not_its_own_parent"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=Q(name_en__regex=r"\S"), name="mountain_region_name_en_not_blank"
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=Q(name_es__isnull=True) | Q(name_es__regex=r"\S"),
                name="mountain_region_name_es_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=Q(name_pt__isnull=True) | Q(name_pt__regex=r"\S"),
                name="mountain_region_name_pt_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.CheckConstraint(
                condition=Q(wikidata_id__isnull=True) | Q(wikidata_id__regex=r"^Q[1-9][0-9]*$"),
                name="mountain_region_wikidata_id_format",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.UniqueConstraint(
                fields=("wikidata_id",),
                condition=Q(wikidata_id__isnull=False),
                name="mountain_region_wikidata_id_key",
            ),
        ),
        migrations.AddConstraint(
            model_name="mountainregionrecord",
            constraint=models.UniqueConstraint(
                django.db.models.expressions.F("parent"),
                django.db.models.functions.text.Lower("name_en"),
                condition=Q(parent__isnull=False),
                name="mountain_region_sibling_name_key",
            ),
        ),
        migrations.AddField(
            model_name="mountainrecord",
            name="region",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="mountains",
                to="catalog.mountainregionrecord",
            ),
        ),
        migrations.RunSQL(CREATE_TRIGGERS, reverse_sql=DROP_TRIGGERS),
    ]
