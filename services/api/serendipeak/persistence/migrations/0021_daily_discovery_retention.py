from django.db import migrations

# Mirrors serendipeak.discovery.retention.RETENTION_DAYS; tests keep the two equal.
RETENTION_DAYS = 365

AMEND_FUNCTION = f"""
CREATE OR REPLACE FUNCTION daily_discovery_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND OLD.date < (now() AT TIME ZONE 'UTC')::date - {RETENTION_DAYS} THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'daily_discovery rows are immutable'
        USING ERRCODE = 'restrict_violation';
END;
$$;
"""

RESTORE_FUNCTION = """
CREATE OR REPLACE FUNCTION daily_discovery_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'daily_discovery rows are immutable'
        USING ERRCODE = 'restrict_violation';
END;
$$;
"""


class Migration(migrations.Migration):
    dependencies = [("catalog", "0020_region_final_validation")]

    operations = [migrations.RunSQL(AMEND_FUNCTION, reverse_sql=RESTORE_FUNCTION)]
