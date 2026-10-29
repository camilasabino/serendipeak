from django.db import migrations

CREATE_TRIGGER = """
CREATE FUNCTION daily_discovery_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'daily_discovery rows are immutable'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER daily_discovery_immutable
BEFORE UPDATE OR DELETE ON daily_discovery
FOR EACH ROW EXECUTE FUNCTION daily_discovery_reject_change();
"""

DROP_TRIGGER = """
DROP TRIGGER daily_discovery_immutable ON daily_discovery;
DROP FUNCTION daily_discovery_reject_change();
"""


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]

    operations = [migrations.RunSQL(CREATE_TRIGGER, reverse_sql=DROP_TRIGGER)]
