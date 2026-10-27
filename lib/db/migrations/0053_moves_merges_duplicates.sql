CREATE TABLE "merge_follow_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"merge_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"kind" text NOT NULL,
	"row_created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "merge_follow_changes_kind_ck" CHECK ("merge_follow_changes"."kind" in ('follow', 'unfollow'))
);
--> statement-breakpoint
CREATE TABLE "sighting_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"sighting_id" integer NOT NULL,
	"from_cat_id" integer NOT NULL,
	"to_cat_id" integer NOT NULL,
	"made_new_cat" boolean DEFAULT false NOT NULL,
	"let_spotters_name" boolean DEFAULT false NOT NULL,
	"merge_id" integer,
	"batch_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reason_text" text,
	"source" text NOT NULL,
	"moved_by_account_id" text,
	"role_at_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"txid" bigint DEFAULT txid_current() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "sighting_moves_cats_ck" CHECK ("sighting_moves"."from_cat_id" <> "sighting_moves"."to_cat_id"),
	CONSTRAINT "sighting_moves_spotters_name_ck" CHECK (not "sighting_moves"."let_spotters_name" or "sighting_moves"."made_new_cat"),
	CONSTRAINT "sighting_moves_merge_ck" CHECK (("sighting_moves"."reason" in ('merged', 'merge_undone')) = ("sighting_moves"."merge_id" is not null)),
	CONSTRAINT "sighting_moves_mover_ck" CHECK ("sighting_moves"."moved_by_account_id" is not null or "sighting_moves"."redacted_at" is not null),
	CONSTRAINT "sighting_moves_reason_ck" CHECK ("sighting_moves"."reason" in ('different_markings', 'two_cats', 'wrong_pick', 'other', 'merged', 'merge_undone')),
	CONSTRAINT "sighting_moves_source_ck" CHECK ("sighting_moves"."source" in ('cat_page', 'matched_by_hand', 'report', 'game', 'merge', 'undo')),
	CONSTRAINT "sighting_moves_role_ck" CHECK ("sighting_moves"."role_at_time" in ('staff', 'management'))
);
--> statement-breakpoint
CREATE TABLE "duplicate_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_low" integer NOT NULL,
	"cat_high" integer NOT NULL,
	"decision" text NOT NULL,
	"merge_id" integer,
	"note" text,
	"by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "duplicate_decisions_pair_ck" CHECK ("duplicate_decisions"."cat_low" < "duplicate_decisions"."cat_high"),
	CONSTRAINT "duplicate_decisions_decision_ck" CHECK ("duplicate_decisions"."decision" in ('merged', 'different', 'not_sure', 'merge_undone')),
	CONSTRAINT "duplicate_decisions_merge_ck" CHECK (("duplicate_decisions"."decision" in ('merged', 'merge_undone')) = ("duplicate_decisions"."merge_id" is not null)),
	CONSTRAINT "duplicate_decisions_by_ck" CHECK ("duplicate_decisions"."by_account_id" is not null or "duplicate_decisions"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "duplicate_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_low" integer NOT NULL,
	"cat_high" integer NOT NULL,
	"source" text NOT NULL,
	"says" text NOT NULL,
	"device_id" text,
	"sighting_id" integer,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "duplicate_reports_pair_ck" CHECK ("duplicate_reports"."cat_low" < "duplicate_reports"."cat_high"),
	CONSTRAINT "duplicate_reports_source_ck" CHECK ("duplicate_reports"."source" in ('spotter_question', 'new_cat_check', 'sweep', 'game', 'team')),
	CONSTRAINT "duplicate_reports_says_ck" CHECK ("duplicate_reports"."says" in ('same', 'different', 'not_sure'))
);
--> statement-breakpoint
CREATE TABLE "new_cat_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "new_cat_checks_by_ck" CHECK ("new_cat_checks"."by_account_id" is not null or "new_cat_checks"."redacted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_ck";--> statement-breakpoint
DROP INDEX "points_ledger_once_a_day_uq";--> statement-breakpoint
ALTER TABLE "points_ledger" ALTER COLUMN "sighting_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "reason_text" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "by_account_id" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "role_at_time" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "survivor_chosen" text;--> statement-breakpoint
-- A volatile default (txid_current()) makes ADD COLUMN rewrite the table and
-- stamp every existing row with this migration's transaction id. cat_identity
-- is empty in production (nothing in the app writes it yet, SYC-59), so the
-- rewrite is harmless, and no existing row could pass a guard's
-- "txid = txid_current()" check in a later transaction anyway.
ALTER TABLE "cat_identity" ADD COLUMN "txid" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "sighting_move_id" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_action" text;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_cat_id" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_by_account_id" text;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD COLUMN "duplicate_cat_low" integer;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD COLUMN "duplicate_cat_high" integer;--> statement-breakpoint
CREATE INDEX "merge_follow_changes_merge_idx" ON "merge_follow_changes" USING btree ("merge_id");--> statement-breakpoint
CREATE INDEX "merge_follow_changes_device_idx" ON "merge_follow_changes" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sighting_moves_sighting_idx" ON "sighting_moves" USING btree ("sighting_id","id");--> statement-breakpoint
CREATE INDEX "sighting_moves_merge_idx" ON "sighting_moves" USING btree ("merge_id");--> statement-breakpoint
CREATE INDEX "duplicate_decisions_pair_idx" ON "duplicate_decisions" USING btree ("cat_low","cat_high","id");--> statement-breakpoint
CREATE INDEX "duplicate_reports_pair_idx" ON "duplicate_reports" USING btree ("cat_low","cat_high");--> statement-breakpoint
CREATE INDEX "duplicate_reports_device_idx" ON "duplicate_reports" USING btree ("device_id") WHERE "duplicate_reports"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "new_cat_checks_cat_idx" ON "new_cat_checks" USING btree ("cat_id","id");--> statement-breakpoint
CREATE INDEX "sightings_cat_idx" ON "sightings" USING btree ("cat_id") WHERE "sightings"."cat_id" is not null;--> statement-breakpoint
CREATE INDEX "cat_identity_canonical_idx" ON "cat_identity" USING btree ("canonical_cat_id");--> statement-breakpoint
CREATE INDEX "cat_identity_cat_idx" ON "cat_identity" USING btree ("cat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_duplicate_pair_uq" ON "points_ledger" USING btree ("device_id","duplicate_cat_low","duplicate_cat_high");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_once_a_day_uq" ON "points_ledger" USING btree ("device_id","cat_id","athens_day") WHERE "points_ledger"."sighting_id" is not null and "points_ledger"."points" > 0;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_ck" CHECK (("notifications"."kind" = 'cat' and "notifications"."cat_update_id" is not null)
      or ("notifications"."kind" in ('week_result', 'merged', 'duplicate_points') and "notifications"."cat_update_id" is null and "notifications"."message" is not null));--> statement-breakpoint
ALTER TABLE "cat_identity" ADD CONSTRAINT "cat_identity_survivor_chosen_ck" CHECK ("cat_identity"."survivor_chosen" is null or "cat_identity"."survivor_chosen" in ('default', 'switched'));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_action_ck" CHECK ("sighting_matches"."team_action" IS NULL OR "sighting_matches"."team_action" IN ('matched', 'made_new_cat', 'looks_right', 'different_cat', 'new_cat', 'hidden'));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_step_ck" CHECK (("sighting_matches"."team_action" IS NULL) = ("sighting_matches"."team_at" IS NULL)
        AND ("sighting_matches"."team_action" IS NOT NULL OR "sighting_matches"."team_by_account_id" IS NULL)
        AND ("sighting_matches"."team_action" IS NULL OR "sighting_matches"."team_by_account_id" IS NOT NULL OR "sighting_matches"."redacted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_cat_ck" CHECK (("sighting_matches"."team_cat_id" IS NOT NULL) = coalesce("sighting_matches"."team_action" IN ('matched', 'made_new_cat', 'different_cat', 'new_cat'), false));--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_award_ck" CHECK (("points_ledger"."sighting_id" is not null and "points_ledger"."duplicate_cat_low" is null and "points_ledger"."duplicate_cat_high" is null)
        or ("points_ledger"."sighting_id" is null and "points_ledger"."duplicate_cat_low" is not null and "points_ledger"."duplicate_cat_high" is not null
          and "points_ledger"."duplicate_cat_low" < "points_ledger"."duplicate_cat_high"));--> statement-breakpoint
-- Database guards (which-cat-is-which.md §9.4). Each one proves "in this
-- move" or "in this merge" through a transaction-local setting, never by
-- finding an older row: the writer inserts its row, then calls
-- set_config('app.sighting_move_id', id, true) or
-- set_config('app.cat_merge_id', id, true), and the guard checks the row with
-- that id has txid = txid_current() and matches. txid_current() is the whole
-- transaction's id, the same inside a savepoint; xmin is not used.
--
-- Every function this migration defines or replaces runs with
-- search_path = public, pg_temp (pg_temp last), so a temporary table named
-- sighting_moves, cat_identity or sightings can't stand in for the real one
-- in a guard's lookup (review of #377, M1).
--
-- True when the sighting's cat may change from from_cat to to_cat now:
--   a move:  app.sighting_move_id names a move row of this transaction, for
--            this sighting and these two cats;
--   a merge: app.cat_merge_id names a cat_identity row of this transaction,
--            and a move row of this transaction carries its id, this
--            sighting and these two cats. A merge moves the merged-away
--            cat's sightings to the survivor; its undo (a row naming the cat
--            itself, superseding the merge) moves them from that merge's
--            survivor back to the merged-away cat.
CREATE FUNCTION "sighting_move_is_current"(p_sighting integer, p_from integer, p_to integer)
RETURNS boolean LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  move_setting text := current_setting('app.sighting_move_id', true);
  merge_setting text := current_setting('app.cat_merge_id', true);
BEGIN
  IF coalesce(move_setting, '') <> '' AND EXISTS (
    SELECT 1 FROM "sighting_moves" m
     WHERE m.id = move_setting::integer
       AND m.txid = txid_current()
       AND m.sighting_id = p_sighting
       AND m.from_cat_id = p_from
       AND m.to_cat_id = p_to
  ) THEN
    RETURN true;
  END IF;

  IF coalesce(merge_setting, '') <> '' AND EXISTS (
    SELECT 1 FROM "cat_identity" ci
      JOIN "sighting_moves" m ON m.merge_id = ci.id
     WHERE ci.id = merge_setting::integer
       AND ci.txid = txid_current()
       AND m.txid = txid_current()
       AND m.sighting_id = p_sighting
       AND m.from_cat_id = p_from
       AND m.to_cat_id = p_to
       AND (
         (ci.canonical_cat_id <> ci.cat_id
           AND m.reason = 'merged'
           AND p_from = ci.cat_id
           AND p_to = ci.canonical_cat_id)
         OR (ci.canonical_cat_id = ci.cat_id
           AND m.reason = 'merge_undone'
           AND p_to = ci.cat_id
           AND p_from = (SELECT sup.canonical_cat_id FROM "cat_identity" sup
                          WHERE sup.id = ci.supersedes_id))
       )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END
$$;--> statement-breakpoint
-- A sighting stays append-only. 0046's branches are kept word for word; one
-- is added: a recorded move of a resolved sighting's cat.
CREATE OR REPLACE FUNCTION "sightings_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  -- What a status move may change, and what redaction may change. Every
  -- other column must stay byte-for-byte what it was (compared as text).
  move_exempt text[] := ARRAY['status', 'cat_id', 'area_key', 'on_island'];
  stamp_exempt text[] := ARRAY['area_key', 'on_island'];
  redact_exempt text[] := ARRAY['device_id', 'redacted_at', 'redaction_reason'];
  -- What a move between cats may change (which-cat-is-which.md §9.4).
  recat_exempt text[] := ARRAY['cat_id'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A sighting arrives from a spotter. Only deletion may take them away.
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sightings: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sightings are append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  -- A status move: the cat is set once, and nothing else changes.
  --   pending -> resolved          the spotter picks the cat (routes/sightings.ts)
  --   pending -> awaiting_team     "Ask Syros Cats to match it" (SYC-119)
  --   awaiting_team -> resolved    the team matches it on the spotter's behalf
  -- A place already stamped stays as it is through a move.
  IF (to_jsonb(NEW) - move_exempt)::text = (to_jsonb(OLD) - move_exempt)::text
     AND OLD.cat_id IS NULL
     AND (OLD.area_key IS NULL OR NEW.area_key IS NOT DISTINCT FROM OLD.area_key)
     AND (OLD.on_island IS NULL OR NEW.on_island IS NOT DISTINCT FROM OLD.on_island)
     AND ((NEW.area_key IS NULL) = (NEW.on_island IS NULL))
     AND (
       (OLD.status IN ('pending', 'awaiting_team')
         AND NEW.status = 'resolved'
         AND NEW.cat_id IS NOT NULL)
       OR (OLD.status = 'pending'
         AND NEW.status = 'awaiting_team'
         AND NEW.cat_id IS NULL)
     )
  THEN
    RETURN NEW;
  END IF;

  -- A place stamp (SYC-706): where the spot is, written once to a row that
  -- has none yet (the history backfill), with nothing else changed.
  IF (to_jsonb(NEW) - stamp_exempt)::text = (to_jsonb(OLD) - stamp_exempt)::text
     AND OLD.area_key IS NULL
     AND OLD.on_island IS NULL
     AND NEW.area_key IS NOT NULL
     AND NEW.on_island IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  -- Redaction (§8.5): the spotter cleared, stamped with a reason, nothing
  -- else changed. Running deletion again is safe; the stamp never changes.
  IF (to_jsonb(NEW) - redact_exempt)::text = (to_jsonb(OLD) - redact_exempt)::text
     AND NEW.device_id IS NULL
     AND (
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND coalesce(NEW.redaction_reason, '') <> '')
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;

  -- A move between cats (SYC-150): a resolved sighting's cat changes from
  -- the move row's from_cat_id to its to_cat_id, nothing else changes, and
  -- the move, or the merge that made it, was recorded in this transaction.
  IF (to_jsonb(NEW) - recat_exempt)::text = (to_jsonb(OLD) - recat_exempt)::text
     AND OLD.status = 'resolved'
     AND OLD.cat_id IS NOT NULL
     AND NEW.cat_id IS NOT NULL
     AND NEW.cat_id <> OLD.cat_id
     AND "sighting_move_is_current"(OLD.id, OLD.cat_id, NEW.cat_id)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sightings are append-only: the only permitted updates are a status move, a place stamp, redaction and a recorded move (id %)', OLD.id;
END
$$;--> statement-breakpoint
-- No sighting is ever filed under a merged-away cat (§9.2): not by a resolve,
-- a move or a new row. The cat row is taken FOR SHARE first, so a merge of
-- that cat being committed (its deferred check holds the cat FOR UPDATE) is
-- waited for and then seen.
CREATE FUNCTION "sightings_not_under_merged_away"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.cat_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.cat_id IS NOT DISTINCT FROM OLD.cat_id) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "cats" WHERE id = NEW.cat_id FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM "cat_identity" ci
     WHERE ci.cat_id = NEW.cat_id
       AND ci.canonical_cat_id <> ci.cat_id
       AND NOT EXISTS (SELECT 1 FROM "cat_identity" u WHERE u.supersedes_id = ci.id)
  ) THEN
    RAISE EXCEPTION 'sightings: cat % is merged into another, so nothing is filed under it (sighting %)', NEW.cat_id, NEW.id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sightings_not_under_merged_away" BEFORE INSERT OR UPDATE OF "cat_id" ON "sightings"
  FOR EACH ROW EXECUTE FUNCTION "sightings_not_under_merged_away"();--> statement-breakpoint
-- The other half (§9.2): at commit, a merge still standing is refused while
-- a resolved sighting names the merged-away cat. The merge moves every one to
-- the survivor in its own transaction. The cat row is taken FOR UPDATE, so a
-- resolve of that cat still in flight commits first and is seen here.
CREATE FUNCTION "cat_identity_no_sighting_left"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.canonical_cat_id = NEW.cat_id
     OR EXISTS (SELECT 1 FROM "cat_identity" u WHERE u.supersedes_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM "cats" WHERE id = NEW.cat_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "sightings" s
     WHERE s.cat_id = NEW.cat_id
       AND s.status = 'resolved'
  ) THEN
    RAISE EXCEPTION 'cat_identity: cat % still has resolved sightings; a merge moves every one to the cat it is merged into (merge %)', NEW.cat_id, NEW.id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "cat_identity_no_sighting_left" AFTER INSERT ON "cat_identity"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "cat_identity_no_sighting_left"();--> statement-breakpoint
-- Statements stay append-only. 0001's branches are kept; the insert branch
-- gains one case: a statement a move copied or withdrew (§9.5) carries the
-- move's id, and may arrive already redacted (a deleted spotter's copied
-- answer), only with that move named by app.sighting_move_id, recorded in
-- this transaction, for the statement's own sighting.
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
$$;--> statement-breakpoint
-- Add-only records with one way to change a row: redaction, which clears
-- the column naming a person (the trigger's argument) and stamps
-- redacted_at, nothing else. Running deletion again is safe; the stamp
-- never changes.
CREATE FUNCTION "add_only_but_redaction"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  person text;
  exempt text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is add-only: delete is not allowed (id %)', TG_TABLE_NAME, OLD.id;
  END IF;
  person := TG_ARGV[0];
  exempt := ARRAY[person, 'redacted_at'];
  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     AND to_jsonb(NEW) -> person = 'null'::jsonb
     AND (
       (OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL)
       OR (OLD.redacted_at IS NOT NULL AND NEW.redacted_at = OLD.redacted_at)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is add-only: the only permitted update is redaction (id %)', TG_TABLE_NAME, OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sighting_moves_append_only" BEFORE UPDATE OR DELETE ON "sighting_moves"
  FOR EACH ROW EXECUTE FUNCTION "add_only_but_redaction"('moved_by_account_id');--> statement-breakpoint
CREATE TRIGGER "sighting_moves_no_truncate" BEFORE TRUNCATE ON "sighting_moves"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- A merge is a row and an undo is another row (§9.2); 0001's guard refused
-- every update. Redaction of who merged is now the one update allowed.
DROP TRIGGER "cat_identity_append_only" ON "cat_identity";--> statement-breakpoint
DROP FUNCTION "cat_identity_append_only"();--> statement-breakpoint
CREATE TRIGGER "cat_identity_append_only" BEFORE UPDATE OR DELETE ON "cat_identity"
  FOR EACH ROW EXECUTE FUNCTION "add_only_but_redaction"('by_account_id');--> statement-breakpoint
-- A row that supersedes another (an undo) supersedes a merge of its own cat.
-- Otherwise an undo row on Agatha naming Mimi's merge would undo Mimi's
-- merge, since readers treat any superseded merge as undone; and an undo of
-- an undo (a row naming its own cat) isn't a merge to undo.
CREATE FUNCTION "cat_identity_supersedes_own_cat"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cat_identity" m
     WHERE m.id = NEW.supersedes_id
       AND m.cat_id = NEW.cat_id
       AND m.canonical_cat_id <> m.cat_id
  ) THEN
    RAISE EXCEPTION 'cat_identity: a row supersedes only a merge of its own cat (cat %, supersedes %)', NEW.cat_id, NEW.supersedes_id;
  END IF;
  -- A row naming its own cat is only ever an undo, so it supersedes a merge
  -- (review of #377, L1): alone it undoes nothing, and as a merge setting it
  -- would pull any sighting onto that cat.
  IF NEW.canonical_cat_id = NEW.cat_id AND NEW.supersedes_id IS NULL THEN
    RAISE EXCEPTION 'cat_identity: a row naming its own cat is an undo, and must supersede a merge (cat %)', NEW.cat_id;
  END IF;
  -- Only an undo supersedes (review of #377, L2). A merge row superseding a
  -- merge would re-point the cat and leave its sightings on the old
  -- survivor; to merge elsewhere, undo first, then merge.
  IF NEW.canonical_cat_id <> NEW.cat_id AND NEW.supersedes_id IS NOT NULL THEN
    RAISE EXCEPTION 'cat_identity: only an undo supersedes a row; a merge supersedes nothing (cat %, supersedes %)', NEW.cat_id, NEW.supersedes_id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "cat_identity_supersedes_own_cat" BEFORE INSERT ON "cat_identity"
  FOR EACH ROW EXECUTE FUNCTION "cat_identity_supersedes_own_cat"();--> statement-breakpoint
CREATE TRIGGER "duplicate_reports_add_only" BEFORE UPDATE OR DELETE ON "duplicate_reports"
  FOR EACH ROW EXECUTE FUNCTION "add_only_but_redaction"('device_id');--> statement-breakpoint
CREATE TRIGGER "duplicate_reports_no_truncate" BEFORE TRUNCATE ON "duplicate_reports"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
CREATE TRIGGER "duplicate_decisions_add_only" BEFORE UPDATE OR DELETE ON "duplicate_decisions"
  FOR EACH ROW EXECUTE FUNCTION "add_only_but_redaction"('by_account_id');--> statement-breakpoint
CREATE TRIGGER "duplicate_decisions_no_truncate" BEFORE TRUNCATE ON "duplicate_decisions"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
CREATE TRIGGER "new_cat_checks_add_only" BEFORE UPDATE OR DELETE ON "new_cat_checks"
  FOR EACH ROW EXECUTE FUNCTION "add_only_but_redaction"('by_account_id');--> statement-breakpoint
CREATE TRIGGER "new_cat_checks_no_truncate" BEFORE TRUNCATE ON "new_cat_checks"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- txid is always the inserting transaction's, whatever the writer sends, so a
-- row can't be stamped ahead for a later transaction (review of #377, M2).
-- The add-only guards already refuse changing it afterwards.
CREATE FUNCTION "stamp_txid"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.txid := txid_current();
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sighting_moves_stamp_txid" BEFORE INSERT ON "sighting_moves"
  FOR EACH ROW EXECUTE FUNCTION "stamp_txid"();--> statement-breakpoint
CREATE TRIGGER "cat_identity_stamp_txid" BEFORE INSERT ON "cat_identity"
  FOR EACH ROW EXECUTE FUNCTION "stamp_txid"();

-- rollback-begin
-- -- SYC-150 PR 2.1. Roll the app back first: code that writes moves, merges or duplicates needs all of this.
-- -- Lost on the way down: every move, merge detail, follow change, duplicate report, decision and check;
-- -- the duplicate-finder points rows (profiles.points keeps what they paid); and the merged and
-- -- duplicate_points bell lines, which the old check would refuse.
-- -- The guards go back as 0046 (sightings) and 0001 (observations, cat_identity) left them.
-- DROP TRIGGER "cat_identity_append_only" ON "cat_identity";
-- CREATE FUNCTION "cat_identity_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   -- A merge is a row and an unmerge is another row (§10.3). Nothing changes
--   -- or removes a row, so every merge stays reversible.
--   RAISE EXCEPTION 'cat_identity is append-only: % is not allowed', TG_OP;
-- END
-- $$;
-- CREATE TRIGGER "cat_identity_append_only" BEFORE UPDATE OR DELETE ON "cat_identity"
--   FOR EACH ROW EXECUTE FUNCTION "cat_identity_append_only"();
-- DROP TRIGGER "cat_identity_stamp_txid" ON "cat_identity";
-- DROP TRIGGER "sighting_moves_stamp_txid" ON "sighting_moves";
-- DROP FUNCTION "stamp_txid"();
-- DROP TRIGGER "cat_identity_supersedes_own_cat" ON "cat_identity";
-- DROP FUNCTION "cat_identity_supersedes_own_cat"();
-- DROP TRIGGER "cat_identity_no_sighting_left" ON "cat_identity";
-- DROP FUNCTION "cat_identity_no_sighting_left"();
-- DROP TRIGGER "sightings_not_under_merged_away" ON "sightings";
-- DROP FUNCTION "sightings_not_under_merged_away"();
-- CREATE OR REPLACE FUNCTION "observations_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
-- DECLARE
--   -- The only columns redaction may touch. Every other column must stay
--   -- byte-for-byte what it was (compared as text, so even a jsonb value's
--   -- numeric representation cannot change).
--   exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'device_id', 'account_id', 'value'];
--   value_ok boolean;
-- BEGIN
--   IF TG_OP = 'INSERT' THEN
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
-- CREATE OR REPLACE FUNCTION "sightings_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
-- DECLARE
--   -- What a status move may change, and what redaction may change. Every
--   -- other column must stay byte-for-byte what it was (compared as text).
--   move_exempt text[] := ARRAY['status', 'cat_id', 'area_key', 'on_island'];
--   stamp_exempt text[] := ARRAY['area_key', 'on_island'];
--   redact_exempt text[] := ARRAY['device_id', 'redacted_at', 'redaction_reason'];
-- BEGIN
--   IF TG_OP = 'INSERT' THEN
--     -- A sighting arrives from a spotter. Only deletion may take them away.
--     IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
--       RAISE EXCEPTION 'sightings: a new row cannot arrive already redacted';
--     END IF;
--     RETURN NEW;
--   END IF;
--   IF TG_OP = 'DELETE' THEN
--     RAISE EXCEPTION 'sightings are append-only: delete is not allowed (id %)', OLD.id;
--   END IF;
--
--   -- A status move: the cat is set once, and nothing else changes.
--   --   pending -> resolved          the spotter picks the cat (routes/sightings.ts)
--   --   pending -> awaiting_team     "Ask Syros Cats to match it" (SYC-119)
--   --   awaiting_team -> resolved    the team matches it on the spotter's behalf
--   -- A place already stamped stays as it is through a move.
--   IF (to_jsonb(NEW) - move_exempt)::text = (to_jsonb(OLD) - move_exempt)::text
--      AND OLD.cat_id IS NULL
--      AND (OLD.area_key IS NULL OR NEW.area_key IS NOT DISTINCT FROM OLD.area_key)
--      AND (OLD.on_island IS NULL OR NEW.on_island IS NOT DISTINCT FROM OLD.on_island)
--      AND ((NEW.area_key IS NULL) = (NEW.on_island IS NULL))
--      AND (
--        (OLD.status IN ('pending', 'awaiting_team')
--          AND NEW.status = 'resolved'
--          AND NEW.cat_id IS NOT NULL)
--        OR (OLD.status = 'pending'
--          AND NEW.status = 'awaiting_team'
--          AND NEW.cat_id IS NULL)
--      )
--   THEN
--     RETURN NEW;
--   END IF;
--
--   -- A place stamp (SYC-706): where the spot is, written once to a row that
--   -- has none yet (the history backfill), with nothing else changed.
--   IF (to_jsonb(NEW) - stamp_exempt)::text = (to_jsonb(OLD) - stamp_exempt)::text
--      AND OLD.area_key IS NULL
--      AND OLD.on_island IS NULL
--      AND NEW.area_key IS NOT NULL
--      AND NEW.on_island IS NOT NULL
--   THEN
--     RETURN NEW;
--   END IF;
--
--   -- Redaction (§8.5): the spotter cleared, stamped with a reason, nothing
--   -- else changed. Running deletion again is safe; the stamp never changes.
--   IF (to_jsonb(NEW) - redact_exempt)::text = (to_jsonb(OLD) - redact_exempt)::text
--      AND NEW.device_id IS NULL
--      AND (
--        (OLD.redacted_at IS NULL
--          AND NEW.redacted_at IS NOT NULL
--          AND coalesce(NEW.redaction_reason, '') <> '')
--        OR (OLD.redacted_at IS NOT NULL
--          AND NEW.redacted_at = OLD.redacted_at
--          AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
--      )
--   THEN
--     RETURN NEW;
--   END IF;
--
--   RAISE EXCEPTION 'sightings are append-only: the only permitted updates are a status move, a place stamp and redaction (id %)', OLD.id;
-- END
-- $$;
-- DROP FUNCTION "sighting_move_is_current"(integer, integer, integer);
-- DELETE FROM "notifications" WHERE "kind" IN ('merged', 'duplicate_points');
-- ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_ck";
-- ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_ck" CHECK (("notifications"."kind" = 'cat' and "notifications"."cat_update_id" is not null)
--       or ("notifications"."kind" = 'week_result' and "notifications"."cat_update_id" is null and "notifications"."message" is not null));
-- DELETE FROM "points_ledger" WHERE "sighting_id" IS NULL;
-- ALTER TABLE "points_ledger" DROP CONSTRAINT "points_ledger_award_ck";
-- DROP INDEX "points_ledger_duplicate_pair_uq";
-- DROP INDEX "points_ledger_once_a_day_uq";
-- CREATE UNIQUE INDEX "points_ledger_once_a_day_uq" ON "points_ledger" USING btree ("device_id","cat_id","athens_day") WHERE "points_ledger"."points" > 0;
-- ALTER TABLE "points_ledger" DROP COLUMN "duplicate_cat_high";
-- ALTER TABLE "points_ledger" DROP COLUMN "duplicate_cat_low";
-- ALTER TABLE "points_ledger" ALTER COLUMN "sighting_id" SET NOT NULL;
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_cat_ck";
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_step_ck";
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_action_ck";
-- ALTER TABLE "sighting_matches" DROP COLUMN "redacted_at";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_at";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_by_account_id";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_cat_id";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_action";
-- ALTER TABLE "observations" DROP COLUMN "sighting_move_id";
-- ALTER TABLE "cat_identity" DROP CONSTRAINT "cat_identity_survivor_chosen_ck";
-- DROP INDEX "cat_identity_cat_idx";
-- DROP INDEX "cat_identity_canonical_idx";
-- ALTER TABLE "cat_identity" DROP COLUMN "redacted_at";
-- ALTER TABLE "cat_identity" DROP COLUMN "txid";
-- ALTER TABLE "cat_identity" DROP COLUMN "survivor_chosen";
-- ALTER TABLE "cat_identity" DROP COLUMN "role_at_time";
-- ALTER TABLE "cat_identity" DROP COLUMN "by_account_id";
-- ALTER TABLE "cat_identity" DROP COLUMN "reason_text";
-- DROP INDEX "sightings_cat_idx";
-- DROP TABLE "new_cat_checks";
-- DROP TABLE "duplicate_reports";
-- DROP TABLE "duplicate_decisions";
-- DROP TABLE "sighting_moves";
-- DROP TABLE "merge_follow_changes";
-- DROP FUNCTION "add_only_but_redaction"();
-- rollback-end