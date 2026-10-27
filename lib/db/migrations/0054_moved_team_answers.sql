-- SYC-150 PR 3.1 (which-cat-is-which.md §9.5; Samuel, 27 Oct 2026): a move takes
-- the team's answer about the photo with it. The team's "mark wrong" of a
-- spotter's answer carries no sighting id, so withdrawing it from the old cat
-- needs the observations insert rule to accept a row that supersedes a row of
-- the moved sighting. Everything else in the function is 0053's, word for word.
CREATE OR REPLACE FUNCTION "observations_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  -- The only columns redaction may touch. Every other column must stay
  -- byte-for-byte what it was (compared as text, so even a jsonb value's
  -- numeric representation cannot change).
  exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'device_id', 'account_id', 'value'];
  value_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Written by a move: only with that move, in this transaction.
    IF NEW.sighting_move_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "sighting_moves" m
         WHERE m.id = NEW.sighting_move_id
           AND current_setting('app.sighting_move_id', true) = NEW.sighting_move_id::text
           AND m.txid = txid_current()
           AND m.sighting_id = NEW.sighting_id
      ) THEN
        RAISE EXCEPTION 'observations: a row naming a move needs that move, recorded in this transaction (move %)', NEW.sighting_move_id;
      END IF;
      -- It replaces a row of the moved sighting (§9.5), or the team's answer
      -- that marked one wrong: a copy sits on the
      -- cat the sighting moved to, a withdrawal on the replaced row's own
      -- cat (review of #377, L4).
      IF NOT EXISTS (
        SELECT 1 FROM "sighting_moves" m
          JOIN "observations" o ON o.id = NEW.supersedes_id
         WHERE m.id = NEW.sighting_move_id
           AND (o.sighting_id = m.sighting_id
                -- Or the team's answer that marked such a row wrong, with no
                -- sighting of its own (Samuel, 27 Oct 2026: a move takes the
                -- team's answer with it).
                OR EXISTS (SELECT 1 FROM "observations" p
                            WHERE p.id = o.supersedes_id
                              AND p.sighting_id = m.sighting_id))
           AND NEW.cat_id IN (m.to_cat_id, o.cat_id)
      ) THEN
        RAISE EXCEPTION 'observations: a moved statement replaces a row of the moved sighting, on that row''s cat or the cat it moved to (move %)', NEW.sighting_move_id;
      END IF;
      RETURN NEW;
    END IF;
    -- A row arrives attributed. Only redaction may take its author away.
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'observations: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'observations are append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  -- Redaction keeps the value, except that a note's text may be emptied (§8.3).
  value_ok := NEW.value::text = OLD.value::text
    OR (OLD.kind = 'note' AND NEW.value = '{}'::jsonb);

  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     AND value_ok
     AND NEW.device_id IS NULL
     AND NEW.account_id IS NULL
     AND (
       -- First redaction: stamped, with a reason, the author cleared.
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND coalesce(NEW.redaction_reason, '') <> '')
       -- Already redacted: running deletion again is safe, and may still
       -- empty a note it missed; the stamp and reason never change.
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'observations are append-only: the only permitted update is redaction (id %)', OLD.id;
END
$$;
-- rollback-begin
-- -- SYC-150 PR 3.1. Roll the app back first: its moves write team answers this would refuse.
-- -- The function goes back to 0053's definition.
-- CREATE OR REPLACE FUNCTION "observations_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
-- DECLARE
--   -- The only columns redaction may touch. Every other column must stay
--   -- byte-for-byte what it was (compared as text, so even a jsonb value's
--   -- numeric representation cannot change).
--   exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'device_id', 'account_id', 'value'];
--   value_ok boolean;
-- BEGIN
--   IF TG_OP = 'INSERT' THEN
--     -- Written by a move: only with that move, in this transaction.
--     IF NEW.sighting_move_id IS NOT NULL THEN
--       IF NOT EXISTS (
--         SELECT 1 FROM "sighting_moves" m
--          WHERE m.id = NEW.sighting_move_id
--            AND current_setting('app.sighting_move_id', true) = NEW.sighting_move_id::text
--            AND m.txid = txid_current()
--            AND m.sighting_id = NEW.sighting_id
--       ) THEN
--         RAISE EXCEPTION 'observations: a row naming a move needs that move, recorded in this transaction (move %)', NEW.sighting_move_id;
--       END IF;
--       -- It replaces a row of the moved sighting (§9.5): a copy sits on the
--       -- cat the sighting moved to, a withdrawal on the replaced row's own
--       -- cat (review of #377, L4).
--       IF NOT EXISTS (
--         SELECT 1 FROM "sighting_moves" m
--           JOIN "observations" o ON o.id = NEW.supersedes_id
--          WHERE m.id = NEW.sighting_move_id
--            AND o.sighting_id = m.sighting_id
--            AND NEW.cat_id IN (m.to_cat_id, o.cat_id)
--       ) THEN
--         RAISE EXCEPTION 'observations: a moved statement replaces a row of the moved sighting, on that row''s cat or the cat it moved to (move %)', NEW.sighting_move_id;
--       END IF;
--       RETURN NEW;
--     END IF;
--     -- A row arrives attributed. Only redaction may take its author away.
--     IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
--       RAISE EXCEPTION 'observations: a new row cannot arrive already redacted';
--     END IF;
--     RETURN NEW;
--   END IF;
--   IF TG_OP = 'DELETE' THEN
--     RAISE EXCEPTION 'observations are append-only: delete is not allowed (id %)', OLD.id;
--   END IF;
--
--   -- Redaction keeps the value, except that a note's text may be emptied (§8.3).
--   value_ok := NEW.value::text = OLD.value::text
--     OR (OLD.kind = 'note' AND NEW.value = '{}'::jsonb);
--
--   IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
--      AND value_ok
--      AND NEW.device_id IS NULL
--      AND NEW.account_id IS NULL
--      AND (
--        -- First redaction: stamped, with a reason, the author cleared.
--        (OLD.redacted_at IS NULL
--          AND NEW.redacted_at IS NOT NULL
--          AND coalesce(NEW.redaction_reason, '') <> '')
--        -- Already redacted: running deletion again is safe, and may still
--        -- empty a note it missed; the stamp and reason never change.
--        OR (OLD.redacted_at IS NOT NULL
--          AND NEW.redacted_at = OLD.redacted_at
--          AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
--      )
--   THEN
--     RETURN NEW;
--   END IF;
--   RAISE EXCEPTION 'observations are append-only: the only permitted update is redaction (id %)', OLD.id;
-- END
-- $$;
-- rollback-end
