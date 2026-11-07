from django.db import migrations

# Mirrors serendipeak.persistence.mountain_region_store.STRUCTURE_LOCK_KEY; tests keep the two
# equal, and equal to the key that 0019 took.
STRUCTURE_LOCK_KEY = 4737260011

REQUIRE_READ_COMMITTED = f"""
CREATE OR REPLACE FUNCTION mountain_region_reject_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    descends_from_itself boolean;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- The walk below must see the moves that committed while this transaction waited for the
    -- lock. That holds only when each statement takes its own snapshot, as READ COMMITTED does;
    -- REPEATABLE READ and SERIALIZABLE would walk the tree as it was when the transaction began
    -- and could close a cycle. A refusal is better than a silent, wrong answer.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'the parent of a mountain region changes only under READ COMMITTED'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;

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
"""

RESTORE_PREVIOUS = f"""
CREATE OR REPLACE FUNCTION mountain_region_reject_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    descends_from_itself boolean;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;

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
"""


class Migration(migrations.Migration):
    dependencies = [("catalog", "0021_daily_discovery_retention")]

    # Replaces only the function body; the trigger and the lock key are those of 0019, which
    # stays as applied. No data changes.
    operations = [migrations.RunSQL(REQUIRE_READ_COMMITTED, reverse_sql=RESTORE_PREVIOUS)]
