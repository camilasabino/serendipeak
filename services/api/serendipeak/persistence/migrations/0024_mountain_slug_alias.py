import django.db.models.deletion
import django.db.models.functions.datetime
from django.db import migrations, models

# A slug is claimed under an advisory lock keyed by its text, so the writers that could give two
# mountains the same slug, one as current and one as former, take turns. The prefix keeps the
# keys apart from the other advisory locks of the schema.
CREATE_TRIGGERS = """
CREATE FUNCTION mountain_slug_hold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    new_key bigint := hashtextextended('mountain_slug:' || NEW.slug, 0);
    old_key bigint;
    former_holder uuid;
BEGIN
    -- The checks below must see what committed while this transaction waited for the lock, which
    -- holds only when each statement takes its own snapshot, as READ COMMITTED does. A refusal
    -- is better than a silent, wrong answer.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'the slug of a mountain changes only under READ COMMITTED'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;

    -- Both slugs of a rename are locked in key order, so two renames cannot wait on each other.
    IF TG_OP = 'UPDATE' THEN
        old_key := hashtextextended('mountain_slug:' || OLD.slug, 0);
        PERFORM pg_advisory_xact_lock(LEAST(old_key, new_key));
        PERFORM pg_advisory_xact_lock(GREATEST(old_key, new_key));
    ELSE
        PERFORM pg_advisory_xact_lock(new_key);
    END IF;

    SELECT mountain_id INTO former_holder FROM mountain_slug_alias WHERE slug = NEW.slug;
    IF FOUND THEN
        IF former_holder <> NEW.id THEN
            RAISE EXCEPTION 'the slug % was used by another mountain', NEW.slug
                USING ERRCODE = 'unique_violation', CONSTRAINT = 'mountain_slug_alias_pkey';
        END IF;

        -- A mountain taking back its own former slug: that slug is current again, and is a former
        -- one again when the mountain next changes it.
        DELETE FROM mountain_slug_alias WHERE slug = NEW.slug;
    END IF;

    -- A draft has no public address to preserve. No mountain returns to draft, so a draft never
    -- had one.
    IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
        INSERT INTO mountain_slug_alias (slug, mountain_id) VALUES (OLD.slug, OLD.id)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER mountain_slug_hold_on_insert
BEFORE INSERT ON mountain
FOR EACH ROW EXECUTE FUNCTION mountain_slug_hold();

CREATE TRIGGER mountain_slug_hold_on_update
BEFORE UPDATE OF slug ON mountain
FOR EACH ROW WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
EXECUTE FUNCTION mountain_slug_hold();

CREATE FUNCTION mountain_slug_alias_reject_current() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'the former slugs of a mountain change only under READ COMMITTED'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('mountain_slug:' || NEW.slug, 0));

    IF EXISTS (SELECT 1 FROM mountain WHERE slug = NEW.slug AND id <> NEW.mountain_id) THEN
        RAISE EXCEPTION 'the slug % is the current slug of another mountain', NEW.slug
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'mountain_slug_alias_pkey';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER mountain_slug_alias_unclaimed
BEFORE INSERT OR UPDATE ON mountain_slug_alias
FOR EACH ROW EXECUTE FUNCTION mountain_slug_alias_reject_current();
"""

DROP_TRIGGERS = """
DROP TRIGGER mountain_slug_alias_unclaimed ON mountain_slug_alias;
DROP FUNCTION mountain_slug_alias_reject_current();
DROP TRIGGER mountain_slug_hold_on_update ON mountain;
DROP TRIGGER mountain_slug_hold_on_insert ON mountain;
DROP FUNCTION mountain_slug_hold();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0023_login_attempt"),
    ]

    # Only adds a table and triggers: no mountain row is read or written, so existing ids, slugs
    # and content are untouched. Reversing drops the table and with it every recorded alias.
    operations = [
        migrations.CreateModel(
            name="MountainSlugAliasRecord",
            fields=[
                ("slug", models.TextField(primary_key=True, serialize=False)),
                (
                    "created_at",
                    models.DateTimeField(db_default=django.db.models.functions.datetime.Now()),
                ),
                (
                    "mountain",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="former_slugs",
                        to="catalog.mountainrecord",
                    ),
                ),
            ],
            options={
                "db_table": "mountain_slug_alias",
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("slug__regex", "^[a-z0-9]+(-[a-z0-9]+)*$")),
                        name="mountain_slug_alias_slug_format",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("slug__in", ["random", "today"]), _negated=True),
                        name="mountain_slug_alias_slug_not_reserved",
                    ),
                ],
            },
        ),
        migrations.RunSQL(CREATE_TRIGGERS, reverse_sql=DROP_TRIGGERS),
    ]
