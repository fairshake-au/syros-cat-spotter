-- SYC-53 PR 0.3 (roles-and-invites.md §10.1, §15.2): the roles migration.
-- `management` becomes a role, `volunteer` is retired, every placement says
-- where it applies (`reach`), and people gain the invitation columns. It adds
-- NO management rows (plan Decision A1): Samuel, Jacky and Susan are made
-- management afterwards with `people set-roles --add management`, from a
-- list Samuel has approved, so no address is ever in this repository.
--
-- It runs in one transaction with every other pending migration, and it
-- stops with a list, changing nothing, if any existing row would break a new
-- rule. A person decides what each listed row means, and it is run again.
LOCK TABLE "people", "person_scopes" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
-- Step 1 (§15.2 step 1): the old reserved word. writeObservation used to
-- accept `admin`; it is now `management`, so no statement may carry `admin`.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offending
    FROM observations WHERE role_at_time = 'admin';
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'roles_and_invites: these observations have role_at_time = ''admin'', which is retired: %. Nothing was changed. Decide what each means, then run migrate again.', offending;
  END IF;
END $$;--> statement-breakpoint
-- Step 2 (§15.2 step 3): every placement that would break a new check, all
-- of them, not only the first. Ids, roles and colony ids only: never a name
-- or an address.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(
           format('scope %s (person %s, %s%s): %s', s.id, s.person_id, s.role,
                  CASE WHEN s.colony_id IS NULL THEN '' ELSE ', colony ' || s.colony_id END,
                  CASE
                    WHEN s.role = 'volunteer' THEN 'volunteer is retired; the field team holds staff'
                    WHEN s.role = 'guardian' THEN 'a cat guardian needs a colony'
                    WHEN s.role = 'staff' THEN 'the team is island-wide, never tied to a colony'
                    ELSE 'not a role'
                  END),
           '; ' ORDER BY s.id) INTO offending
    FROM person_scopes s
   WHERE s.role = 'volunteer'
      OR (s.role = 'guardian' AND s.colony_id IS NULL)
      OR (s.role = 'staff' AND s.colony_id IS NOT NULL)
      OR s.role NOT IN ('staff', 'guardian', 'vet');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'roles_and_invites: these person_scopes rows break the new rules: %. Nothing was changed. Decide what each means, then run migrate again.', offending;
  END IF;
END $$;--> statement-breakpoint
-- Step 3: the people columns. Everyone already on the list has accepted, so
-- nobody is suddenly "pending" (§15.2 step 4).
ALTER TABLE "people" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "invite_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
UPDATE "people" SET "accepted_at" = "added_at";--> statement-breakpoint
-- Step 4 (§15.2 step 2): reach is set from the data before any check, then
-- made not null with no default, so every later insert has to say.
ALTER TABLE "person_scopes" ADD COLUMN "reach" text;--> statement-breakpoint
UPDATE "person_scopes" SET "reach" = CASE WHEN "colony_id" IS NULL THEN 'island' ELSE 'colony' END;--> statement-breakpoint
ALTER TABLE "person_scopes" ALTER COLUMN "reach" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_scopes" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_scopes" ADD COLUMN "relationship" text;--> statement-breakpoint
ALTER TABLE "person_scopes" ADD COLUMN "granted_by" text;--> statement-breakpoint
ALTER TABLE "person_scopes" ADD COLUMN "granted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing placements were granted when their person was added, by whoever
-- added them (review m5), not "now".
UPDATE "person_scopes" s SET "granted_at" = p."added_at", "granted_by" = p."added_by"
  FROM "people" p WHERE p."id" = s."person_id";--> statement-breakpoint
-- When this migration ran, so the rollback can tell a guardian placement that
-- was already here (the old schema holds it fine) from one written since
-- (review m1). A column comment: it is not part of the compared schema.
DO $$
BEGIN
  EXECUTE format('COMMENT ON COLUMN "person_scopes"."granted_at" IS %L',
                 'roles_and_invites applied at ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;--> statement-breakpoint
-- Step 5: the role list without volunteer and with management, and the
-- checks. The unique (person, role, colony) constraint stays as it is.
ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_role_ck";--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_role_ck" CHECK ("person_scopes"."role" IN ('staff', 'management', 'guardian', 'vet'));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_language_ck" CHECK ("people"."language" IN ('en', 'el', 'fr'));--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_reach_ck" CHECK ("person_scopes"."reach" IN ('island', 'colony'));--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_reach_colony_ck" CHECK (("person_scopes"."reach" = 'colony') = ("person_scopes"."colony_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_guardian_colony_ck" CHECK ("person_scopes"."role" <> 'guardian' OR "person_scopes"."reach" = 'colony');--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_team_island_ck" CHECK ("person_scopes"."role" NOT IN ('staff', 'management') OR "person_scopes"."reach" = 'island');--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_relationship_ck" CHECK ("person_scopes"."relationship" IS NULL OR "person_scopes"."relationship" IN ('feeds', 'owns_here', 'covering'));
-- Step 6: no management rows (Decision A1), and no confirmation_items: that
-- table comes with SYC-53 PR 3.4's own migration (review M7).
--
-- ROLLING BACK THIS MIGRATION AFTER `people set-roles` HAS RUN IS NOT SAFE.
-- ONCE ANYONE HOLDS `management`, OR (FROM SLICE 1) A CAT GUARDIAN IS PLACED
-- OR AN INVITATION IS PENDING, THE OLD SCHEMA CANNOT HOLD THEM: THE OLD ROLE
-- CHECK REFUSES `management`, AND DROPPING `accepted_at` WOULD LET EVERY
-- PENDING INVITEE IN AS IF SHE HAD JOINED. IN PRODUCTION THE PATH IS FIX
-- FORWARD, NOT ROLL BACK.
--
-- So the rollback below refuses, listing every management row, every
-- guardian row granted since this migration ran (one from before it is held
-- fine by the old schema), and every pending person (ids only), and changes
-- nothing. Only a throwaway test database may go further: with
-- `SET catspotter.rollback_deletes = 'on'` in the session AND a database
-- named roles_invites_* (this migration's own tests; nothing in production
-- is either), it deletes those management and guardian rows and marks each
-- pending person as left, printing each count as a NOTICE. Pending people are
-- marked left, not deleted: every person has a strict, append-only
-- person_events history (0016), so a delete could never succeed. That
-- test-only path writes NO `left` event for them (review m3): it is for
-- throwaway databases, never a record anyone keeps. Either way it runs in one
-- transaction and never half-completes. Take a Neon snapshot first, and roll
-- the app back first: its people code reads and writes these columns (see
-- lib/db/migrations/README.md).
-- rollback-begin
-- LOCK TABLE "people", "person_scopes" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- DECLARE
--   management_rows text;
--   guardian_rows text;
--   pending_people text;
--   n integer;
--   applied_at timestamptz;
-- BEGIN
--   applied_at := substring(col_description('person_scopes'::regclass,
--     (SELECT attnum FROM pg_attribute WHERE attrelid = 'person_scopes'::regclass AND attname = 'granted_at'))
--     FROM 'roles_and_invites applied at (.*)$')::timestamptz;
--   IF applied_at IS NULL THEN
--     RAISE EXCEPTION 'roles_and_invites: the record of when this migration ran is missing, so the rollback cannot tell old guardian placements from new ones. Nothing was changed.';
--   END IF;
--   SELECT string_agg(format('scope %s (person %s)', id, person_id), ', ' ORDER BY id) INTO management_rows
--     FROM person_scopes WHERE role = 'management';
--   SELECT string_agg(format('scope %s (person %s, colony %s)', id, person_id, colony_id), ', ' ORDER BY id) INTO guardian_rows
--     FROM person_scopes WHERE role = 'guardian' AND granted_at > applied_at;
--   SELECT string_agg(id::text, ', ' ORDER BY added_at, id) INTO pending_people
--     FROM people WHERE accepted_at IS NULL AND left_at IS NULL;
--   IF management_rows IS NULL AND guardian_rows IS NULL AND pending_people IS NULL THEN
--     RETURN;
--   END IF;
--   IF coalesce(current_setting('catspotter.rollback_deletes', true), '') <> 'on'
--      OR current_database() NOT LIKE 'roles\_invites\_%' THEN
--     RAISE EXCEPTION 'roles_and_invites: ROLLING BACK IS NOT SAFE: it would lose management rows: %; guardian rows: %; pending people: %. Nothing was changed. Fix forward instead.',
--       coalesce(management_rows, 'none'), coalesce(guardian_rows, 'none'), coalesce(pending_people, 'none');
--   END IF;
--   DELETE FROM person_scopes WHERE role = 'management';
--   GET DIAGNOSTICS n = ROW_COUNT;
--   RAISE NOTICE 'roles_and_invites rollback: deleted % management rows', n;
--   DELETE FROM person_scopes WHERE role = 'guardian' AND granted_at > applied_at;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   RAISE NOTICE 'roles_and_invites rollback: deleted % guardian rows', n;
--   UPDATE people SET left_at = now(), left_by = 'system:rollback', session_version = session_version + 1
--    WHERE accepted_at IS NULL AND left_at IS NULL;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   RAISE NOTICE 'roles_and_invites rollback: marked % pending people as left', n;
-- END $$;
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_relationship_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_team_island_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_guardian_colony_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_reach_colony_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_reach_ck";
-- ALTER TABLE "people" DROP CONSTRAINT "people_language_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_role_ck";
-- ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_role_ck" CHECK ("person_scopes"."role" IN ('staff', 'guardian', 'volunteer', 'vet'));
-- ALTER TABLE "person_scopes" DROP COLUMN "granted_at";
-- ALTER TABLE "person_scopes" DROP COLUMN "granted_by";
-- ALTER TABLE "person_scopes" DROP COLUMN "relationship";
-- ALTER TABLE "person_scopes" DROP COLUMN "expires_at";
-- ALTER TABLE "person_scopes" DROP COLUMN "reach";
-- ALTER TABLE "people" DROP COLUMN "language";
-- ALTER TABLE "people" DROP COLUMN "invite_expires_at";
-- ALTER TABLE "people" DROP COLUMN "invite_sent_at";
-- ALTER TABLE "people" DROP COLUMN "accepted_at";
-- rollback-end
