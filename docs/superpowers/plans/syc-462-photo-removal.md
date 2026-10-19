# SYC-462 Photo Removal by Hand: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans and implement this plan task by task, inline (see "Model delegation" for why it isn't subagent-driven). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude remove a photo for good on a privacy request. A team member approves first, the photo is hidden, then deleted, and a search proves it's gone. Underneath that is a real "removed" state in the database, which every part of the app respects.

**Architecture:**
- Migration `0034_photo_removal` (number provisional; §Global constraints) makes `photos.data` nullable and adds `removed_at`, `removed_by` and `removed_reason`, with a check and a restore-refusing trigger.
- One removal function in `lib/db/src/photoRemoval/` does the eligibility checks, the single write, the version delete, the main-photo repoint and the in-transaction byte search.
- A CLI on top of it is run through `db-ops`.
- The api-server's eight picture readers, and two address builders, learn to treat a removed photo as gone.
- Carry-back copies a removed photo as an empty picture.

**Tech stack:** TypeScript, Drizzle ORM and node-postgres (`pg`), Postgres 16, vitest, Express, bash (`scripts/db-ops.sh`) and GitHub Actions (`db-ops.yml`).

**Spec:** `docs/superpowers/specs/syc-462-photo-removal-by-hand.md`, revision 2, commit `a351e3fd`, approved by Samuel on 19 October 2026. The reviews are `…-review.md` and `…-review-2.md`. Read the spec first: this plan argues from it and quotes its section numbers.

## Global constraints

- **Work only in** `/Users/samuelporter/Projects/syros-cat-spotter/.claude/worktrees/adoring-bohr-e8be1c`, on branch `claude/syc-462-photo-removal`. Check `pwd` before the first write of every session. Never write to the primary checkout.
- **Migration number: `0034_photo_removal`, agreed on 19 Oct.** SYC-396 PR 2.4 (#245) holds `0033_named_areas`. PR 3.0, PR 2.1, SYC-443 PR 2 (merged as #242) and SYC-44 PR 6.1 add no migration. Before `gh pr ready`, check `lib/db/migrations/` again on a fresh `origin/main`. If #245 hasn't merged by then, tell that session: whoever merges second regenerates the migration and `meta/_journal.json`. Carry-back's `carryBack.test.ts` (`noHomeInTarget`/`noHomeRows`) may also need a small rebase against #245.
- **Never touch Neon, Replit or the live site.** Tests use throwaway local Postgres databases only (`createThrowawayDatabase`, which refuses `.neon.tech`). The development-branch rehearsal happens after merge, by the parent session, with a heads-up to Samuel first (spec §8.5 step 2).
- **Off limits, owned by another session:** `artifacts/api-server/src/lib/teamPages/`.
- **`removed_reason` format**, the only one accepted:
  ```
  ^(SYC-[0-9]{1,5}|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$
  ```
- **Hide reason for privacy:** exactly `privacy`. It is case-sensitive.
- **The removal marker** is `photos.removed_at IS NOT NULL`, which the database ties to `data IS NULL`. There is no `mime` marker.
- **Command output is public:**
  - It never includes a database address or host, a device id, coordinates, note text, a report reason or a hide reason.
  - It prints photo public ids in full.
- **Words and canonical facts:**
  - Say "cat guardian" and "spotter".
  - Plain English in every user-facing string.
- **Commits:** after each task's green step, end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and update `docs/superpowers/plans/syc-462-checkpoint.md` in the same commit.
- **The PR stays a draft** (#237). Never mark it ready and never merge; `/ship` does both.

## Test environment (needed by every task)

These are the local workarounds from memory (`local-vitest-esbuild`). Darwin esbuild and rollup are stripped by pnpm overrides.

```bash
cd /Users/samuelporter/Projects/syros-cat-spotter/.claude/worktrees/adoring-bohr-e8be1c
SP=/private/tmp/claude-501/-Users-samuelporter-Projects-syros-cat-spotter--claude-worktrees-adoring-bohr-e8be1c/2393769c-364b-4f55-bec2-e2c5ac3f806f/scratchpad
(cd "$SP" && npm pack @esbuild/darwin-arm64@$(node -p "require('./node_modules/esbuild/package.json').version" 2>/dev/null || echo 0.25.0) >/dev/null && tar xzf esbuild-darwin-arm64-*.tgz)
export ESBUILD_BINARY_PATH="$SP/package/bin/esbuild"
for d in node_modules/.pnpm/rollup@*/node_modules/@rollup; do cp -R "$SP/rollup-darwin-arm64" "$d/rollup-darwin-arm64" 2>/dev/null; done
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
export AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key
```

The esbuild version must match the installed `esbuild` package; check it with `ls node_modules/.pnpm | grep ^esbuild@`. Get `@rollup/rollup-darwin-arm64` with an `npm pack` of the matching rollup version, unpacked to `$SP/rollup-darwin-arm64`. A local Postgres 16 must be running (`pg_isready`).

The run commands below are written as `pnpm --filter @workspace/db exec vitest run <file>` and `pnpm --filter @workspace/api-server exec vitest run <file>`, with the variables above exported. **Before Task 1**, run the baseline once:
- `lib/db`'s `photoVisibility.test.ts`
- `api-server`'s `photos.cache.test.ts`
- `api-server`'s `team.photos.test.ts`

Note the counts in the checkpoint.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/db/src/schema/photos.ts` (modify) | Nullable `data`, the three `removed_*` columns, `photos_removed_ck` |
| `lib/db/migrations/0034_photo_removal.sql` + `meta/` (create) | Generated DDL, plus the hand-written trigger and a guarded rollback |
| `lib/db/src/migrate/photoRemoval.test.ts` (create) | T0, T0b, T0c: the migration, the check, the trigger and the rollback guard |
| `lib/db/src/photoRemoval/rules.ts` (create) | Pure helpers: the `photo_ref` pattern, the fingerprint slice |
| `lib/db/src/photoRemoval/eligibility.ts` (create) | Read-only SQL: is it hidden, hidden for privacy, removed; is the approver on the team now |
| `lib/db/src/photoRemoval/standIn.ts` (create) | The stand-in rule in SQL, for the repoint (spec §4.2) |
| `lib/db/src/photoRemoval/search.ts` (create) | The spec §5.5 checks, including the every-column scan |
| `lib/db/src/photoRemoval/remove.ts` (create) | `removePhoto()`: one transaction, named steps, a test-only `skip` |
| `lib/db/src/photoRemoval/hide.ts` (create) | `hidePhotoForPrivacy()` and `restorePhoto()` for the CLI |
| `lib/db/src/photoRemoval/list.ts` (create) | `listCatPhotos()` |
| `lib/db/src/photoRemoval/cli.ts` (create) | Argument parsing, target resolution, printing, exit codes |
| `lib/db/src/photoRemoval/*.test.ts` (create) | T1–T8 and T3; the CLI tests |
| `lib/db/src/appSettings/shape.ts` (modify) | The `photo_removal_on` key |
| `lib/db/src/switchover/carryBack.ts` (modify) | `coalesce(data,'')` for photos |
| `lib/db/package.json`, `scripts/db-ops.sh`, `.github/workflows/db-ops.yml` (modify) | The four commands and the five inputs |
| `api/lib/photoVisibility.ts` (modify) | `hiddenPhotoIds` counts removed photos; `setPhotoVisibility` gets a `removed` outcome; the stand-in skips removed photos |
| `api/routes/photos.ts`, `api/routes/teamReports.ts`, `api/routes/teamPhotos.ts` (modify) | Null guards, `410`, the restore refusal |
| `api/routes/sightings.ts` (modify) | R4, R5, P9 |
| `api/lib/photoVariants.ts` (modify) | Null read; conditional insert with a test hook |
| `api/lib/coatReading/sweep.ts`, `api/lib/teamCatView.ts`, `api/lib/likelyReview.ts` (modify) | Guards and the leave-out rule |
| `api/lib/photoRemoval.app.test.ts` (create) | T9–T12b, T14–T18 |
| `api/lib/photoData.source.test.ts` (create) | T13 |
| `docs/runbooks/photo-removal.md` (create), `docs/runbooks/neon-database.md` and `docs/superpowers/plans/mvp-launch-31-oct.md` (modify) | The runbook, the restore line, the line 58 wording |

`api` means `artifacts/api-server/src`.

---

### Task 1: The migration (spec §4.1)

**Files:**
- Modify: `lib/db/src/schema/photos.ts`
- Create: `lib/db/migrations/0034_photo_removal.sql` and its `lib/db/migrations/meta/*` entries (generated)
- Test: `lib/db/src/migrate/photoRemoval.test.ts`

**Interfaces:**
- Produces:
  - `photosTable.data: string | null`
  - `photosTable.removedAt: Date | null`
  - `photosTable.removedBy: string | null`
  - `photosTable.removedReason: string | null`
  - the DB function and trigger `photo_visibility_events_not_after_removal`

- [ ] **Step 1: Write the failing migration test.** Model it on `lib/db/src/migrate/photoVisibility.test.ts`, which sets up its own database, runs `migrateUp`, and makes one photo and one person.

```ts
// lib/db/src/migrate/photoRemoval.test.ts
import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-462 (spec §4.1): migration 0034. A photo has no picture exactly when it
// is marked removed, with who and why; a removed photo can't be restored.
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => { const u = new URL(baseUrl); u.pathname = `/${db}`; return u.toString(); };
const name = `photo_removal_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let personId: string;
const newPhoto = async () =>
  (await c.query<{ id: number }>(`insert into photos (data) values ('eA==') returning id`)).rows[0]!.id;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
  personId = (await c.query<{ id: string }>(
    `insert into people (email, name, added_by) values ('susan@example.com', 'Susan', 'cli:test') returning id`,
  )).rows[0]!.id;
});
afterAll(async () => { await c.end(); await admin.query(`drop database "${name}" with (force)`); await admin.end(); });

describe("T0b: photos_removed_ck", () => {
  it("accepts a removed photo with no picture, who and why", async () => {
    const id = await newPhoto();
    await c.query(`update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'SYC-1' where id = $2`, [personId, id]);
    const r = await c.query(`select data, removed_reason from photos where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ data: null, removed_reason: "SYC-1" });
  });
  it.each([
    ["no picture, not marked removed", `data = null`],
    ["marked removed, picture still there", `removed_at = now(), removed_by = $P, removed_reason = 'SYC-1'`],
    ["removed without who", `data = null, removed_at = now(), removed_reason = 'SYC-1'`],
    ["removed without why", `data = null, removed_at = now(), removed_by = $P`],
  ])("refuses %s", async (_label, set) => {
    const id = await newPhoto();
    await expect(
      c.query(`update photos set ${set.replace("$P", `'${personId}'`)} where id = $1`, [id]),
    ).rejects.toThrow(/photos_removed_ck/);
  });
  it("and the foreign key refuses removed_by naming no person", async () => {
    const id = await newPhoto();
    await expect(c.query(
      `update photos set data = null, removed_at = now(), removed_by = gen_random_uuid(), removed_reason = 'SYC-1' where id = $1`, [id],
    )).rejects.toThrow(/foreign key/);
  });
});

describe("T0c: a removed photo can't be restored", () => {
  it("refuses a restore event by raw SQL, and still allows a hide", async () => {
    const id = await newPhoto();
    await c.query(`insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, 'hide', $2, $2, 'privacy')`, [id, personId]);
    await c.query(`update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'SYC-1' where id = $2`, [personId, id]);
    await expect(c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id) values ($1, 'restore', $2, $2)`, [id, personId],
    )).rejects.toThrow(/removed for good/);
    await c.query(`insert into photo_visibility_events (photo_id, action, author, person_id) values ($1, 'hide', $2, $2)`, [id, personId]);
  });
  it("still allows restoring a photo that isn't removed", async () => {
    const id = await newPhoto();
    await c.query(`insert into photo_visibility_events (photo_id, action, author, person_id) values ($1, 'hide', $2, $2)`, [id, personId]);
    await c.query(`insert into photo_visibility_events (photo_id, action, author, person_id) values ($1, 'restore', $2, $2)`, [id, personId]);
  });
});
```

T0 (the rollback) is covered by the existing `pnpm --filter @workspace/db test` rollback round-trip (`runner.test.ts`), which rolls every migration back on a database with no removed photo. The guard is tested here:

```ts
describe("T0: the rollback's guard", () => {
  it("refuses, and drops nothing, when a photo is removed", async () => {
    const files = readMigrations(defaultMigrationsFolder());
    const m = files.find((f) => f.name.startsWith("0034_"))!;
    const guard = m.rollbackSql.split("\n").filter((l) => !/^(ALTER|DROP)/i.test(l.trim())).join("\n");
    await expect(c.query(guard)).rejects.toThrow(/removed for good/);
    const cols = await c.query(`select column_name from information_schema.columns where table_name = 'photos' and column_name = 'removed_at'`);
    expect(cols.rowCount).toBe(1);
  });
});
```

Before writing this, check the name of `rollbackSql` on the migration objects in `lib/db/src/migrate/runner.ts`, with `grep -n "rollback" lib/db/src/migrate/runner.ts`, and use the real property name. It is `rollback` there if not `rollbackSql`.

- [ ] **Step 2: Run it and see it fail.** Run `pnpm --filter @workspace/db exec vitest run src/migrate/photoRemoval.test.ts`. Expected: FAIL, because column `removed_at` doesn't exist.

- [ ] **Step 3: Change the schema.**

```ts
// lib/db/src/schema/photos.ts — replace the table definition
import { sql } from "drizzle-orm";
import { check, pgTable, text, serial, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const photosTable = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    // (keep the existing publicId comment block verbatim)
    publicId: text("public_id").notNull().default(sql`gen_random_uuid()::text`),
    // Base64-encoded image. Null only once the photo is removed for good
    // (SYC-462; hosting-and-photo-storage.md §6.5: "null the bytes and mark it
    // removed"). photos_removed_ck ties the two together.
    data: text("data"),
    mime: text("mime").notNull().default("image/jpeg"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // SYC-462 spec §4.1: who removed it, when, and the request it answered
    // (a reference only: SYC-<n> or "hello YYYY-MM-DD #<n>"). The row stays,
    // so every link to it survives.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => peopleTable.id),
    removedReason: text("removed_reason"),
  },
  (table) => [
    uniqueIndex("photos_public_id_unique").on(table.publicId),
    check(
      "photos_removed_ck",
      sql`(${table.removedAt} is null and ${table.removedBy} is null and ${table.removedReason} is null and ${table.data} is not null) or (${table.removedAt} is not null and ${table.removedBy} is not null and ${table.removedReason} is not null and ${table.data} is null)`,
    ),
  ],
);

export type Photo = typeof photosTable.$inferSelect;
```

If `import { peopleTable } from "./people"` makes an import cycle that breaks loading, check first with `grep -n "photos" lib/db/src/schema/people.ts lib/db/src/schema/colonies.ts`. Review 2 found the existing `photoVisibility.ts` cycle works with lazy references, which `.references(() => …)` already is.

- [ ] **Step 4: Generate the migration, then add the trigger and the rollback by hand.**

Run: `pnpm --filter @workspace/db run generate --name photo_removal`. Rename the file to `0034_photo_removal.sql` if the generator numbered it differently, and fix the `meta/_journal.json` tag to match. Read the generated SQL. Expect four statements:
- `ALTER COLUMN "data" DROP NOT NULL`;
- three `ADD COLUMN` statements;
- the FK;
- the CHECK.

Then append:

```sql
--> statement-breakpoint
-- SYC-462 spec §4.1: a removed photo stays hidden for good. Whatever the app
-- does, a restore event for it is refused (a hide is still allowed).
CREATE FUNCTION "photo_visibility_events_not_after_removal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'restore' AND EXISTS (SELECT 1 FROM photos WHERE id = NEW.photo_id AND removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'photo % was removed for good; it can''t be restored', NEW.photo_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "photo_visibility_events_not_after_removal" BEFORE INSERT ON "photo_visibility_events"
  FOR EACH ROW EXECUTE FUNCTION "photo_visibility_events_not_after_removal"();

-- A REMOVED PHOTO'S BYTES CANNOT BE BROUGHT BACK. IF ANY PHOTO IS REMOVED, THIS
-- ROLLBACK FAILS ON PURPOSE (THE GUARD BELOW) AND DROPS NOTHING. SHIP A FIX
-- FORWARD INSTEAD. NEVER ROLL THE APP BACK PAST SYC-462 ONCE A PHOTO IS REMOVED.
-- rollback-begin
-- LOCK TABLE "photos" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "photos" WHERE "data" IS NULL) THEN
--     RAISE EXCEPTION 'photos: a photo was removed for good; refusing to roll back 0034';
--   END IF;
-- END $$;
-- DROP TRIGGER "photo_visibility_events_not_after_removal" ON "photo_visibility_events";
-- DROP FUNCTION "photo_visibility_events_not_after_removal"();
-- ALTER TABLE "photos" DROP CONSTRAINT "photos_removed_ck";
-- ALTER TABLE "photos" DROP CONSTRAINT "photos_removed_by_people_id_fk";
-- ALTER TABLE "photos" DROP COLUMN "removed_reason";
-- ALTER TABLE "photos" DROP COLUMN "removed_by";
-- ALTER TABLE "photos" DROP COLUMN "removed_at";
-- ALTER TABLE "photos" ALTER COLUMN "data" SET NOT NULL;
-- rollback-end
```

Use the FK's real name, from the generated `ADD CONSTRAINT` line. If the guard's message differs from the T0 regex (`removed for good`), make them agree.

- [ ] **Step 5: Run the tests and the schema check.**

```bash
pnpm --filter @workspace/db exec vitest run src/migrate/photoRemoval.test.ts
pnpm --filter @workspace/db run migrate:check
pnpm --filter @workspace/db test
```

Expected: all pass. `migrate:check` must report no drift. `test` includes the rollback round-trip.

- [ ] **Step 6: The type ripple.** Run `pnpm -r --filter @workspace/api-server exec tsc --noEmit`. Expected: errors at exactly the eight reader sites (R1–R7, plus `roleKit`/test kits if they read `data`). **Don't fix them here**; Tasks 2–6 do. Paste the error list into the checkpoint, because it is the ground-truth reader list. If a site appears that isn't in spec §3.1, stop, add it to the spec's table, and give it a guard in the right task.

- [ ] **Step 7: Commit.** Use the message `SYC-462: migration 0034 — photos can be removed for good (check + no-restore trigger)`.

---

### Task 2: Every route treats a removed photo as hidden, and as gone (spec §4.5, §6 items 1, 5 and 7)

**Files:**
- Modify: `api/lib/photoVisibility.ts` (`hiddenPhotoIds`, `displayPhotoRows`)
- Modify: `api/routes/photos.ts:44-69`
- Modify: `api/routes/teamReports.ts:140-208`
- Test: `api/lib/photoRemoval.app.test.ts`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces:
  - `hiddenPhotoIds(ids, q?)` also returns removed photo ids.
  - A test helper, `markRemoved(photoId: number, personId: string): Promise<void>`, in `api/test/removalKit.ts`. It is used by Tasks 2–6.

- [ ] **Step 1: The test helper.**

```ts
// artifacts/api-server/src/test/removalKit.ts
import { eq, sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";

/** Marks a photo removed for good exactly as removePhoto's one write does (spec §4.4 step 2). */
export async function markRemoved(photoId: number, personId: string): Promise<void> {
  await db.update(photosTable)
    .set({ data: null, removedAt: sql`now()`, removedBy: personId, removedReason: "SYC-462" })
    .where(eq(photosTable.id, photoId));
}
```

`personId` comes from `signedPerson("…")` in `roleKit.ts`, which returns `{ id }`.

- [ ] **Step 2: Write the failing tests (T9 part 1 and T18).** Base the test file on `routes/photos.cache.test.ts` (supertest `request(app)`) and `routes/team.photos.test.ts` (the signed-in team cookie). Read both first and copy their setup lines exactly.

```ts
// artifacts/api-server/src/lib/photoRemoval.app.test.ts (first block)
describe("T9/T18: a removed photo is gone from every address", () => {
  it("public address: 404 no-store, even with no hide event (T18)", async () => {
    const cat = await seedCat(null);
    const staff = await signedPerson("t9-staff");
    await markRemoved(cat.photoId, staff.id);
    const r = await request(app).get(`/api/photos/${cat.photoPublicId}`);
    expect(r.status).toBe(404);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await hiddenPhotoIds([cat.photoId])).has(cat.photoId)).toBe(true);
  });
  it("team full photo and both versions: 410 no-store", async () => {
    const cat = await seedCat(null);
    const staff = await signedPerson("t9-team");      // staff holds hide_photo
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    for (const path of ["", "/small", "/medium"]) {
      const r = await request(app).get(`/api/team/photos/${cat.photoPublicId}${path}`).set("Cookie", staff.cookie);
      expect(r.status).toBe(410);
      expect(r.headers["cache-control"]).toContain("no-store");
    }
  });
  it("the cat's public page shows its stand-in, or no photo, and never the removed id", async () => {
    const cat = await seedCat(null);
    const staff = await signedPerson("t9-public");
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const r = await request(app).get(`/api/cats/${cat.id}`);
    expect(JSON.stringify(r.body)).not.toContain(cat.photoPublicId);
  });
});
```

Team requests on this host may need the team-host headers used in `team.photos.test.ts`, such as `Host`, `Origin` or `x-forwarded-*`. Copy them.

- [ ] **Step 3: Run the tests and see them fail.** Run `pnpm --filter @workspace/api-server exec vitest run src/lib/photoRemoval.app.test.ts`. Expected:
- the public address case fails, with a 500 (`Buffer.from(null)`) or a 200;
- the team route fails with a 500.

- [ ] **Step 4: Implement.**

```ts
// api/lib/photoVisibility.ts — hiddenPhotoIds
/** Which of these photos are hidden from the public: their newest event is a
 * hide, or they were removed for good (SYC-462 spec §4.5: removed implies
 * hidden, so every route that asks this treats a removed photo as hidden). */
export async function hiddenPhotoIds(ids: readonly number[], q: Queryable = db): Promise<Set<number>> {
  const newest = await newestEvents(ids, q);
  const out = new Set([...newest].filter(([, e]) => e.action === "hide").map(([id]) => id));
  const unique = [...new Set(ids)];
  if (unique.length) {
    const removed = await q.select({ id: photosTable.id }).from(photosTable)
      .where(and(inArray(photosTable.id, unique), isNotNull(photosTable.removedAt)));
    for (const r of removed) out.add(r.id);
  }
  return out;
}
```

`displayPhotoRows` needs no change: it already asks `hiddenPhotoIds` for both mains and candidates.

```ts
// api/routes/photos.ts — after the hidden check, before Buffer.from
  if (photo.data === null) {
    // Removed for good (SYC-462). hiddenPhotoIds already says hidden; this is the
    // route's own guard (spec §6 item 1), answering exactly as an unknown id.
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
    return;
  }
```

```ts
// api/routes/teamReports.ts — a shared helper next to notFound()
function removedForGood(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).type("text").send("Removed for good.");
}
```

In `servablePhoto`, also select `removedAt`. Return `"removed"` when it is set, before the hidden check, so a hidden-photo viewer gets 410 rather than 403. The callers handle that:

```ts
// servablePhoto(): select({ id, mime, removedAt: photosTable.removedAt }) …
  if (photo.removedAt) { removedForGood(res); return null; }
// GET /team/photos/:publicId — the second read
  if (!full) return notFound(res);
  if (full.data === null) return removedForGood(res);
  res.send(Buffer.from(full.data, "base64"));
```

The size route only needs `servablePhoto`'s check, plus Task 4's `variantFor` returning `null`. Keep `notFound` for that `null`.

- [ ] **Step 5: Run the tests and see them pass.** Run the same file, plus the regression set: `pnpm --filter @workspace/api-server exec vitest run src/routes/photos.cache.test.ts src/routes/photos.etag.test.ts src/routes/photoVisibility.test.ts src/routes/team.photos.test.ts src/routes/team.photoVariants.test.ts`. Expected: PASS.

- [ ] **Step 6: Mutation probes.** Record each in the checkpoint.
  1. Remove the `isNotNull(removedAt)` union from `hiddenPhotoIds`. T18's `hiddenPhotoIds` assertion must go red. Restore it.
  2. Remove the `photo.data === null` guard in `routes/photos.ts`. With probe 1 also removed, the public-address test must go red. Restore both.
  3. Remove the `removedAt` check in `servablePhoto`. The 410 test must go red (it gets a 500 or a 404). Restore it.

- [ ] **Step 7: Commit.** Use the message `SYC-462: removed photos are hidden everywhere and answer 404/410`.

---

### Task 3: Restore is refused for a removed photo (spec §6 item 2; T10, T6)

**Files:**
- Modify: `api/lib/photoVisibility.ts` (`setPhotoVisibility`, `VisibilityOutcome`)
- Modify: `api/routes/teamPhotos.ts:60-111`
- Test: `api/lib/photoRemoval.app.test.ts` (a new block)

**Interfaces:**
- Produces: `VisibilityOutcome` gains `{ kind: "removed"; removedAt: Date }`.

- [ ] **Step 1: Write the failing test (T10).** It goes through the route, both JSON and form. Copy the POST setup from `routes/team.photos.test.ts` for the hide and restore form posts, including any CSRF or Origin headers it sets.

```ts
describe("T10: restore is refused for a removed photo", () => {
  it("JSON: 409 REMOVED, and no event written", async () => {
    const cat = await seedCat(null);
    const staff = await signedPerson("t10-json");
    await hidePhoto(cat.photoId);
    await markRemoved(cat.photoId, staff.id);
    const before = await countEvents(cat.photoId);
    const r = await request(app).post(`/api/team/photos/${cat.photoPublicId}/restore`)
      .set("Cookie", staff.cookie).send({ cat: cat.id });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("REMOVED");
    expect(await countEvents(cat.photoId)).toBe(before);
  });
  it("form: a page that says it was removed for good", async () => {
    // same setup, form-encoded post as team.photos.test.ts does
    // expect(r.status).toBe(409); expect(r.text).toContain("removed for good");
  });
});
```

`countEvents` is a local helper: `select count(*) from photo_visibility_events where photo_id = $1`. Write the form case out in full, copying the form-post lines from `team.photos.test.ts`. Don't leave the comment in.

- [ ] **Step 2: Run the test and see it fail.** Expected: the request hangs or times out (no branch), or the trigger causes a 500.

- [ ] **Step 3: Implement.**

```ts
// photoVisibility.ts
export type VisibilityOutcome =
  | { kind: "changed"; event: PhotoVisibilityEvent }
  | { kind: "already" }
  | { kind: "not_found" }
  | { kind: "not_authorised" }
  /** SYC-462: removed for good; it stays hidden and can't be restored. */
  | { kind: "removed"; removedAt: Date };

// inside the transaction, replacing the lock query:
    const locked = await tx.execute<{ id: number; removed_at: Date | null }>(
      sql`select id, removed_at from photos where public_id = ${input.publicId} for update`,
    );
    const photoId = locked.rows[0]?.id;
    if (photoId === undefined) return { kind: "not_found" } as const;
    const removedAt = locked.rows[0]!.removed_at;
    if (removedAt && input.action === "restore") return { kind: "removed", removedAt } as const;
```

A hide of a removed photo falls through to `already`, because it is always hidden.

```ts
// teamPhotos.ts — a new case in the switch
        case "removed":
          if (!isFormPost(req)) {
            return void res.status(409).json({ error: "Removed for good", code: "REMOVED" });
          }
          return void res.status(409).type("html").send(
            renderPage({
              title: "Removed for good",
              active: "cats",
              personName: teamPerson(res).name,
              body:
                `<p>This photo was removed for good on ${esc(outcome.removedAt.toISOString().slice(0, 10))}. It can't be restored.</p>` +
                `<p><a class="tap" href="${esc(backTo(cat, publicId, "none"))}">Back</a></p>`,
            }),
          );
```

Also add a `default: { const never: never = outcome; throw new Error(String(never)); }` so a future outcome fails the type check instead of hanging.

- [ ] **Step 4: Run the tests and see them pass.** Run the T10 block and `routes/team.photos.test.ts`.

- [ ] **Step 5: Mutation probe.** Remove the `removed` early return. T10 JSON must go red: it gets a 500 from the trigger, not a 409. Restore it.

- [ ] **Step 6: Commit.** Use the message `SYC-462: restoring a removed photo is refused with a plain page`.

---

### Task 4: Small and medium versions are never made from a removed photo (spec §4.3; T15)

**Files:**
- Modify: `api/lib/photoVariants.ts:35-53`
- Test: `api/lib/photoRemoval.app.test.ts`

**Interfaces:**
- Produces: `variantFor(photoId, size)` returns `null` for a removed photo. A test-only hook, `__variantHooks.afterRead?: () => Promise<void>`, is exported for T15.

- [ ] **Step 1: Write the failing tests.**

```ts
describe("T15: versions of a removed photo", () => {
  it("returns null and saves nothing", async () => {
    const cat = await seedCat(null);
    const staff = await signedPerson("t15-a");
    await markRemoved(cat.photoId, staff.id);
    expect(await variantFor(cat.photoId, "small")).toBeNull();
    expect(await countVariants(cat.photoId)).toBe(0);
  });
  it("a removal landing between read and save wins: nothing is saved", async () => {
    const cat = await seedRealJpegCat();   // sharp needs a decodable image: use the fixture __fixtures__ jpeg the variants tests use
    const staff = await signedPerson("t15-b");
    __variantHooks.afterRead = async () => { await markRemoved(cat.photoId, staff.id); };
    try {
      await variantFor(cat.photoId, "small");
    } finally { __variantHooks.afterRead = undefined; }
    expect(await countVariants(cat.photoId)).toBe(0);
  });
});
```

`seedRealJpegCat()` inserts a photo from the JPEG fixture that `photoVariants.test.ts` already uses. Find it with `grep -n "__fixtures__\|readFileSync" artifacts/api-server/src/lib/photoVariants.test.ts`, and link a cat to it the way `seedCat` does.

- [ ] **Step 2: Run the tests and see them fail.** The first fails on a TS error or throws. The second saves a version (count 1).

- [ ] **Step 3: Implement.**

```ts
/** Test-only: lets T15 land a removal between the read and the save. */
export const __variantHooks: { afterRead?: () => Promise<void> } = {};

export async function variantFor(photoId: number, size: VariantSize): Promise<Buffer | null> {
  const [hit] = await db.select({ bytes: photoVariantsTable.bytes }).from(photoVariantsTable)
    .where(and(eq(photoVariantsTable.photoId, photoId), eq(photoVariantsTable.size, size)));
  if (hit) return hit.bytes;
  const [p] = await db.select({ data: photosTable.data }).from(photosTable).where(eq(photosTable.id, photoId));
  // Missing, or removed for good (SYC-462): there is nothing to make a version from.
  if (!p || p.data === null) return null;
  await __variantHooks.afterRead?.();
  let bytes: Buffer;
  try {
    bytes = await makeVariant(Buffer.from(p.data, "base64"), size);
  } catch (err) {
    logger.warn({ err: safeError(err), size }, "photo version could not be made");
    return null;
  }
  // Saved only if the photo still has its picture, in one statement (spec §4.3):
  // a removal that commits while the version was being made wins.
  const saved = await db.execute(sql`
    insert into photo_variants (photo_id, size, bytes)
    select ${photoId}, ${size}, ${bytes}
     where exists (select 1 from photos where id = ${photoId} and data is not null)
    on conflict do nothing`);
  if (saved.rowCount === 0) {
    const [still] = await db.select({ data: photosTable.data }).from(photosTable).where(eq(photosTable.id, photoId));
    if (!still || still.data === null) return null;
  }
  return bytes;
}
```

Also update the hook-point comment at the bottom of the file: removal now deletes the versions itself, in `lib/db/src/photoRemoval/remove.ts`. Keep `clearVariants`, because the shrink job still needs it.

- [ ] **Step 4: Run the tests and see them pass.** Run T15 and `lib/photoVariants.test.ts`, `photoVariants.exif.test.ts` and `routes/team.photoVariants.test.ts`.

- [ ] **Step 5: Mutation probe.** Replace the conditional insert with the old plain insert. The second T15 test must go red. Restore it.

- [ ] **Step 6: Commit.** Use the message `SYC-462: no versions are made from a removed photo, even mid-removal`.

---

### Task 5: Matching, repeat uploads, new cats, the coat reader and the email (spec §6 items 3 and 4; R4–R7, P9; T11, T12, T12b, T16)

**Files:**
- Modify: `api/routes/sightings.ts` (around 276-289, 556-601 and 769-775)
- Modify: `api/lib/coatReading/sweep.ts:210-217`
- Test: `api/lib/photoRemoval.app.test.ts`

**Interfaces:** Consumes `markRemoved`. Produces none.

- [ ] **Step 1: Read how the existing tests mock the matcher and seed a repeat upload.** That's `routes/sightings.dedupe.test.ts`, `sightings.extraPhotos.test.ts` and `sightings.resolve.test.ts`, plus `test/extraPhotoKit.ts:seedSpot` and `test/sightings.ts`. Copy their mocking of `matchCatPhoto` and their upload calls exactly.

- [ ] **Step 2: Write the failing tests.**

```ts
describe("T11/T12/T12b: matching never sends a removed photo", () => {
  it("T12: a new spot near the cat doesn't send its removed main photo", async () => {
    // seedCat at lat/lng near the upload; hide + markRemoved its photo;
    // POST a new sighting nearby with the mocked matcher;
    // expect(mockedMatch.mock.calls.at(-1)![1].map((c) => c.catId)).not.toContain(cat.id);
  });
  it("T11a: a repeat upload whose spot photos are all removed calls no matcher", async () => {
    // seedSpot with sighting_photos rows; markRemoved each; repeat the same upload;
    // expect(r.status).toBe(201); expect(r.body.candidates).toEqual([]); expect(mockedMatch).not.toHaveBeenCalled();
  });
  it("T11b: the same, for a spot with only the older sightings.photo_id", async () => {
    // a sighting seeded with no sighting_photos rows (the pre-SYC-415 shape), photo removed
  });
  it("T12b: resolving as a new cat a spot whose cover was removed gives the cat no main photo", async () => {
    // pending sighting; markRemoved its photo; resolve with newCatName (as sightings.resolve.test.ts does);
    // expect(newCat.primaryPhotoId).toBe(0);
  });
});
describe("T16: the email and the coat reader", () => {
  it("the 'Photo hidden' email for a removed photo has no attachment", async () => {
    // follow issues alert tests (grep -rn "processIssueAlert\|issue_alert" src/lib/issues/*.test.ts src/lib/mail/*.test.ts)
  });
  it("the coat sweep skips a removed photo", async () => {
    // follow coatReadingsWorkflow.test.ts: a cat due for reading whose photo is then removed → status 'photo_gone', no model call
  });
});
```

**Write each body out in full** from the existing tests named in each comment. Don't leave the comments in. This step is done only when every assertion is real.

- [ ] **Step 3: Run the tests and see them fail.** Expected: T12 sends the removed photo (the mock receives it); T11 calls the matcher with an empty picture; T12b gives the photo id; T16's sweep calls the model or crashes.

- [ ] **Step 4: Implement.**

```ts
// sightings.ts ~279 (R4): skip a nearby cat whose main photo has no picture
      if (p && p.data !== null) {
        candidateInputs.push({ catId: cat.id, name: cat.name, photoBase64: p.data, mime: p.mime });
      }
```

The comment at `:297-299` already says "a nearby cat whose photo row is gone was never compared". Extend it to say "or was removed for good".

```ts
// sightings.ts ~556-579 (R5): both reads skip removed photos
      .where(and(eq(sightingPhotosTable.sightingId, existing.id), isNotNull(photosTable.data)))
    let photos: NewPhotoInput[] = rows.map((r) => ({ role: r.role as SightingPhotoRole, photoBase64: r.data!, mime: r.mime }));
    ...
      if (only && only.data !== null) photos = [{ role: "first", photoBase64: only.data, mime: only.mime }];
```

One gap remains. A spot whose `sighting_photos` rows are all removed but whose `sightings.photo_id` is a different, live photo is impossible, because the cover is always one of the spot's photos. So the fallback runs only when there are no rows at all. Keep the code as written: if there were rows and they're all filtered out, `photos` is empty and the fallback runs; the fallback reads the cover, which is one of those rows, and is therefore removed too, so `photos` stays empty. T11a proves this.

```ts
// sightings.ts ~773 (P9): a removed cover never becomes a new cat's main photo
        const [cover] = await tx.select({ removedAt: photosTable.removedAt }).from(photosTable)
          .where(eq(photosTable.id, sighting.photoId));
        ...
            primaryPhotoId: cover && cover.removedAt === null ? sighting.photoId : 0,
```

```ts
// coatReading/sweep.ts ~214
    if (!photo || photo.data === null) {
      result.items.push({ ...item, status: "photo_gone" });
      continue;
    }
```

R6 (`mail/outbox.ts:591`) is already null-safe. Don't change it; T16 pins it.

- [ ] **Step 5: Run the tests and see them pass.** Run this block, then every `routes/sightings*.test.ts`, `lib/coatReading*` / `coatReadingsWorkflow.test.ts` and the `issues*.test.ts` files.

- [ ] **Step 6: Mutation probes.**
  1. Drop the R4 `data !== null`: T12 must go red.
  2. Drop the row filter in R5: T11a must go red.
  3. Drop the fallback's `only.data !== null`: T11b must go red.
  4. Drop the P9 check: T12b must go red.

  Restore each after probing.

- [ ] **Step 7: Commit.** Use the message `SYC-462: matching, repeat uploads, new cats and the coat reader skip removed photos`.

---

### Task 6: Team pages leave a removed photo out (spec §6 item 8), and the source test (T13)

**Files:**
- Modify: `api/lib/teamCatView.ts:586-596` (`photoPublicIds`)
- Modify: `api/lib/likelyReview.ts:148-157`
- Create: `api/lib/photoData.source.test.ts`
- Test: `api/lib/photoRemoval.app.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
describe("T9 part 2: no broken image on the team's pages", () => {
  it("the team cat page draws no <img> for a removed photo", async () => {
    // seedCat; add a second, live photo via a resolved sighting so the gallery isn't empty;
    // hide + markRemoved the main; GET the team cat page as staff (see team.cats.test.ts for the path);
    // expect(r.text).not.toContain(cat.photoPublicId);
  });
  it("the likely-coat page draws no <img> for a removed evidence photo", async () => {
    // follow the likelyReview tests (grep -rln likelyReview src) for seeding an observation with photo_id
  });
});
```

Write the bodies in full from `team.cats.test.ts` and the existing likely-review test. The assertion is that the page HTML doesn't contain the removed photo's public id at all.

```ts
// api/lib/photoData.source.test.ts — T13
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// SYC-462 spec §3.1: the only files that may read a photo's picture. A new
// reader must be added here on purpose, with a removed-photo guard and a test.
const ALLOWED = new Set([
  "routes/photos.ts", "routes/teamReports.ts", "routes/sightings.ts",
  "lib/photoVariants.ts", "lib/mail/outbox.ts", "lib/coatReading/sweep.ts", "lib/spotPhotos.ts",
]);
const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.includes("/test/") ? [p] : [];
});
// A whole-row select from photos, even split over lines: select() … .from(photosTable)
const WHOLE_ROW = /\.select\(\s*\)\s*\.from\(\s*photosTable\s*\)/m;
const DATA = /photosTable\.data\b/;

describe("T13: who reads a photo's picture", () => {
  it.each(files(SRC).map((f) => [path.relative(SRC, f), f]))("%s", (rel, abs) => {
    const text = readFileSync(abs, "utf8");
    if (ALLOWED.has(rel)) return;
    expect(WHOLE_ROW.test(text), `${rel} selects whole photo rows`).toBe(false);
    expect(DATA.test(text), `${rel} reads photosTable.data`).toBe(false);
  });
  it("catches a select split over lines (as at sightings.ts:577-578)", () => {
    expect(WHOLE_ROW.test("await db\n        .select()\n        .from(photosTable)")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests.** T9 part 2 should fail: the page contains the id. T13 should pass. If it fails, the failing file is an unlisted reader: stop and add it to spec §3.1 and to a task.

- [ ] **Step 3: Implement.**

```ts
// teamCatView.ts photoPublicIds
  const rows = await db
    .select({ id: photosTable.id, publicId: photosTable.publicId })
    .from(photosTable)
    // SYC-462 spec §6 item 8: a removed photo has no address, so the page draws no broken image.
    .where(and(inArray(photosTable.id, unique), isNull(photosTable.removedAt)));
```

Do the same `isNull(photosTable.removedAt)` in `likelyReview.ts:154`.

**Every other place that builds a team photo address** (found with `grep -rn "teamPhotoUrl(" api/lib api/routes`, 19 Oct), and why each one is safe:
- **`guardianCatView.ts:148`:** filters through `hiddenPhotoIds`. Task 2 makes that count removed photos, so it's covered with no edit. SYC-443 #242 changed this file, so rebase before touching it.
- **Cats' main photos only**, all safe because the removal repoints every cat whose main photo it was (§4.2), so no main photo is ever a removed one:
  - `colourCheck.ts:142` (also read by Home, SYC-396 PR 2.1);
  - `colonyCats.ts:204`;
  - `teamColonies.ts:315`;
  - `teamCatView.ts:1184` (search thumbnails);
  - `routes/teamCats.ts:208`;
  - `teamPages/catGridPage.ts:255`.
- **P9 (Task 5)** keeps it true for new cats.

T9 part 2 asserts this for the colour check and the guardian cat page as well: a cat whose main photo was removed shows its stand-in, and the page HTML never contains the removed id. Then check every caller of `photoPublicIds` copes with a missing id; it should already, because hidden or missing rows can be absent today. List them with `grep -n "photoPublicIds\|urlFor" api/lib/teamCatView.ts`, and test any gallery-count text if it counts ids.

- [ ] **Step 4: Run the tests and see them pass.** Run this block, plus `team.cats.test.ts`, `team.catGrid.test.ts`, `team.guardianCats.test.ts`, `teamCatList.source.test.ts` and the likely-review tests.

- [ ] **Step 5: Mutation probes.**
  1. Drop the `isNull` in `photoPublicIds`: T9 part 2 (the cat page) must go red.
  2. Add `const x = photosTable.data;` to `lib/colourCheck.ts`: T13 must go red.

  Restore each after probing.

- [ ] **Step 5b: Tell the public app a photo was removed** (agreed with SYC-44 PR 6.1, 19 Oct). On `main` after 6.1 merges, a public sighting carries `photoHidden` (6.1's field, from `hiddenPhotoIds`). That would be true for a removed photo, and the app would say "Photo hidden while Syros Cats take a look", which is wrong for a removal.
  - This PR adds `photoRemoved: boolean` to the public sighting, computed from `photos.removed_at`, in `lib/catHelpers.ts` (`PublicSighting`/`serialiseSighting`), `routes/cats.ts`, `openapi.yaml` and the generated clients.
  - `photoHidden` keeps its meaning. A removed photo is hidden too.
  - The app's tile and its en/el/fr string are **6.1's or SYC-246's**, per the reply below. This PR only sends the field.
  - **If 6.1 hasn't merged when this task starts,** rebase onto its branch's final state, or wait. Don't edit `cats.ts` or `catHelpers.ts` at the same time as 6.1.
  - Test: the public cat detail's sighting for a removed photo has `photoRemoved: true` and `photoUrl: null`.
  - Mutation probe: always send `false`, and the test goes red.

- [ ] **Step 6: Run the api-server type check.** Run `pnpm --filter @workspace/api-server exec tsc --noEmit`. Expected: clean. Any error left over is a reader that Tasks 2–6 missed; fix it with a guard and a test.

- [ ] **Step 7: Commit.** Use the message `SYC-462: team pages leave removed photos out; a source test guards picture readers`.

---

### Task 7: The removal core in `lib/db` (spec §4.2, §4.4, §5.4, §5.5; T1, T2, T2b, T3, T4 core, T5, T8)

**Files:**
- Create: `lib/db/src/photoRemoval/rules.ts`, `eligibility.ts`, `standIn.ts`, `search.ts` and `remove.ts`
- Test: `lib/db/src/photoRemoval/remove.test.ts` and `catalogue.test.ts`

**Interfaces:**
- Produces:

```ts
// rules.ts
export const PHOTO_REF_RE: RegExp;                    // the Global constraints pattern
export function isPhotoRef(s: string): boolean;
export function fingerprint(base64: string): { text: string; bytes: Buffer }; // 64-char slice from the middle
// eligibility.ts
export interface PhotoState { id: number; publicId: string; hiddenNow: boolean; hiddenForPrivacy: boolean; removedAt: Date | null; dataLength: number | null }
export async function photoState(q: pg.ClientBase, publicId: string): Promise<PhotoState | null>;
export async function isTeamMemberNow(q: pg.ClientBase, personId: string): Promise<boolean>;
// standIn.ts
export async function standInFor(q: pg.ClientBase, catId: number, excludePhotoId: number): Promise<number>; // photo id or 0
// search.ts
export type CheckName = "picture" | "versions" | "main_photo" | "hidden" | "record" | "bytes" | "mentions";
export interface SearchLine { check: CheckName; ok: boolean | "not_verified"; detail: string }
export async function searchFor(q: pg.ClientBase, photo: { id: number; publicId: string }, fp: { text: string; bytes: Buffer } | null, opts?: { timeoutMs?: number; skipBytes?: boolean }): Promise<{ lines: SearchLine[]; verdict: "GONE" | "NOT GONE" | "NOT VERIFIED"; ms: number; otherPhotoIds: number[] }>;
// remove.ts
export type RemoveStep = "delete_and_record" | "versions" | "main_photo";
export type RemoveRefusal = "not_found" | "not_hidden" | "not_for_privacy" | "not_team" | "bad_ref" | "switched_off";
export type RemoveResult =
  | { kind: "refused"; why: RemoveRefusal }
  | { kind: "already"; removedAt: Date }
  | { kind: "plan"; plan: RemovalPlan; search: Awaited<ReturnType<typeof searchFor>> }      // dry run
  | { kind: "removed"; plan: RemovalPlan; search: Awaited<ReturnType<typeof searchFor>> };
export interface RemovalPlan { photoId: number; publicId: string; bytes: number; versions: string[]; repoints: { catId: number; to: number }[]; spotPhotos: { sightingId: number; role: string }[]; observations: number; reports: number }
export async function removePhoto(client: pg.Client, input: { publicId: string; by: string; ref: string; apply: boolean; requireSwitch: boolean }, testOnly?: { skip?: RemoveStep; afterCommit?: () => Promise<void> }): Promise<RemoveResult>;
```

- [ ] **Step 1: Write the failing tests.** First T1, T2, T2b, T5 and T8 in `remove.test.ts`. Each `describe` creates its own throwaway database, as `migrate/photoRemoval.test.ts` does (Task 1), and seeds it with raw SQL through `pg.Client`.

```ts
// lib/db/src/photoRemoval/remove.test.ts (core of it)
const PICTURE = Buffer.alloc(3000, 0).map((_, i) => (i * 7 + 13) % 251);   // recognisable, no JPEG header
const B64 = Buffer.from(PICTURE).toString("base64");
const CONTROL = Buffer.from(Buffer.alloc(3000, 0).map((_, i) => (i * 11 + 5) % 241)).toString("base64");

async function seedEverywhere(c: pg.Client, b64: string, label: string) {
  const person = (await c.query(`insert into people (email, name, added_by, accepted_at) values ($1, 'Staff', 'cli:test', now()) returning id`, [`${label}@example.com`])).rows[0].id;
  await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island')`, [person]);
  const p = (await c.query(`insert into photos (data) values ($1) returning id, public_id`, [b64])).rows[0];
  const standIn = (await c.query(`insert into photos (data) values ('c3RhbmQ=') returning id`)).rows[0].id;
  const cat = (await c.query(`insert into cats (name, description, primary_photo_id, lat, lng, discoverer_device_id) values ($1, '', $2, 37.44, 24.94, 'd') returning id`, [`${label} cat`, p.id])).rows[0].id;
  // a resolved sighting whose cover is P, with sighting_photos first; another with P as face is impossible (photo_uq), so a second photo row Pface is NOT P —
  // instead: P is the cover + 'first' of sighting 1; sighting 2 (older, resolved) has the stand-in as cover.
  // … insert sightings (status resolved, cat_id, photo_id), sighting_photos, photo_variants (small, medium), an observation with photo_id P,
  // a welfare_reports row kind 'content' reason 'photo_private' photo_id P, and a privacy hide event authored by `person`.
  return { person, photoId: p.id, publicId: p.public_id, catId: cat, standIn };
}
```

**Write `seedEverywhere` out completely before running anything.** Get each table's required columns with `\d sightings`, `\d sighting_photos`, `\d observations`, `\d welfare_reports` and `\d photo_variants` against the throwaway database, or from `lib/db/src/schema/*.ts`. Every `NOT NULL` column needs a value. `sighting_photos_photo_uq` means a photo belongs to one spot only, so P is the cover and `first` photo of one spot; the "face photo of another spot" case from spec T1 can't happen with the same photo. Seed a *second* photo P2, removed in a separate case, as some spot's `face`, and assert the same things for it. Note this deviation from spec T1's wording in the checkpoint. It is a correction (the unique index makes the spec's case impossible), not a redesign.

```ts
it("T1: removes P from every place, and leaves Q untouched", async () => {
  const P = await seedEverywhere(c, B64, "p");
  const Q = await seedEverywhere(c, CONTROL, "q");
  const r = await removePhoto(c, { publicId: P.publicId, by: P.person, ref: "SYC-462", apply: true, requireSwitch: false });
  expect(r.kind).toBe("removed");
  if (r.kind !== "removed") return;
  expect(r.search.verdict).toBe("GONE");
  // the independent scan, written here, not reusing search.ts:
  expect(await independentScan(c, B64, P.publicId)).toEqual([]);
  expect((await c.query(`select count(*)::int n from photo_variants where photo_id = $1`, [P.photoId])).rows[0].n).toBe(0);
  expect((await c.query(`select primary_photo_id from cats where id = $1`, [P.catId])).rows[0].primary_photo_id).toBe(P.standIn);
  const q = (await c.query(`select data from photos where id = $1`, [Q.photoId])).rows[0];
  expect(q.data).toBe(CONTROL);
  expect((await c.query(`select count(*)::int n from photo_variants where photo_id = $1`, [Q.photoId])).rows[0].n).toBe(2);
  expect((await c.query(`select primary_photo_id from cats where id = $1`, [Q.catId])).rows[0].primary_photo_id).toBe(Q.photoId);
});
```

`independentScan(c, b64, publicId)` is written in the test file itself. It:
- lists `information_schema.columns` in `public` with types `text`, `character varying`, `json`, `jsonb`, `ARRAY` or `bytea`;
- for each column, counts the rows where the text form contains a 40-character slice from a *different* offset than `fingerprint()` uses (`b64.slice(1200, 1240)`), or contains `publicId` (skipping `photos.public_id`);
- returns `table.column` names with hits.

It deliberately differs from `search.ts`, so a bug shared by both can't hide.

```ts
it.each([
  ["delete_and_record", ["picture", "bytes"]],
  ["versions", ["versions"]],
  ["main_photo", ["main_photo"]],
] as const)("T2: skipping %s makes the search say NOT GONE, naming %j", async (skip, failing) => {
  const P = await seedEverywhere(c, B64, `skip-${skip}`);
  const r = await removePhoto(c, { publicId: P.publicId, by: P.person, ref: "SYC-462", apply: true, requireSwitch: false }, { skip });
  if (r.kind !== "removed") throw new Error(r.kind);
  expect(r.search.verdict).toBe("NOT GONE");
  expect(r.search.lines.filter((l) => l.ok !== true).map((l) => l.check)).toEqual(expect.arrayContaining([...failing]));
});
it("T2b: a version saved after the commit is found and deleted", async () => {
  const P = await seedEverywhere(c, B64, "t2b");
  const r = await removePhoto(c, { publicId: P.publicId, by: P.person, ref: "SYC-462", apply: true, requireSwitch: false },
    { afterCommit: async () => { await c.query(`insert into photo_variants (photo_id, size, bytes) values ($1, 'small', '\\x00')`, [P.photoId]); } });
  if (r.kind !== "removed") throw new Error(r.kind);
  expect(r.search.lines.find((l) => l.check === "versions")!.detail).toMatch(/deleted 1/);
  expect((await c.query(`select count(*)::int n from photo_variants where photo_id = $1`, [P.photoId])).rows[0].n).toBe(0);
});
it("T5: a second removal says already, writes nothing", async () => { /* run twice; second kind 'already'; checksum of photos+cats+photo_variants+photo_visibility_events unchanged */ });
it("T8: two at once — one removes, the other says already", async () => { /* two pg.Clients, Promise.all; kinds sorted equal ['already','removed'] */ });
```

T5 and T8 get full bodies. For the checksum use `select md5(string_agg(t::text, '|' order by t::text)) from <table> t` per table.

**T4 (core refusals),** each with a before-and-after checksum:
- `not_hidden`: no hide event.
- `not_for_privacy`:
  - only a `photo_inappropriate` report and a report-authored hide;
  - a team hide with reason null;
  - `privacy` hide, then restore, then a null-reason hide.
- `not_team`: `by` is a person who:
  - never joined (`accepted_at` null);
  - has left;
  - holds only an expired staff scope;
  - holds only a guardian scope.
- `bad_ref`: `"Maria door"`, `"SYC-462 x"`, `"a@b"` and `"0123456789"`.
- `switched_off`: `requireSwitch: true` with `app_settings` having no `photo_removal_on`, or `false`.
- `not_found`.

Successes:
- a dashboard hide (reason null), then a second hide with `privacy`;
- a `photo_private` report only.

**T3 (`catalogue.test.ts`):**

```ts
// The reviewed list, from spec §3.1. A new link to photos or a new byte/json column turns this red.
const PHOTO_LINKS = ["cats.primary_photo_id", "observations.photo_id", "photo_variants.photo_id", "photo_visibility_events.photo_id",
  "sighting_photos.photo_id", "sightings.photo_id", "welfare_reports.photo_id"];
const BYTE_AND_JSON = [/* filled from the first run's output, each reviewed against spec §3.1 and listed here */];
it("T3: every link to photos is reviewed", async () => {
  const fk = await c.query(`select tc.table_name || '.' || kcu.column_name as col from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu using (constraint_name, table_schema)
      join information_schema.constraint_column_usage ccu using (constraint_name, table_schema)
     where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'photos' and tc.table_schema = 'public'`);
  const named = await c.query(`select table_name || '.' || column_name as col from information_schema.columns
     where table_schema = 'public' and (column_name = 'photo_id' or column_name like '%\\_photo\\_id' escape '\\') and table_name <> 'photos'`);
  expect([...new Set([...fk.rows, ...named.rows].map((r) => r.col))].sort()).toEqual(PHOTO_LINKS.sort());
});
```

**The `BYTE_AND_JSON` list is filled in after one run.** Print the columns, check each against spec §3.1's "checked, and holding no photo" list, and paste them in as literal strings. It then fails on any new one. This is the one place where the list comes from a run, and the step isn't finished until the literal list is in the file.

- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @workspace/db exec vitest run src/photoRemoval`. Expected: they fail because the module isn't found.

- [ ] **Step 3: Implement `rules.ts`.**

```ts
export const PHOTO_REF_RE = /^(SYC-[0-9]{1,5}|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$/;
export const isPhotoRef = (s: string) => PHOTO_REF_RE.test(s);
/** A 64-character slice of the base64 from the middle (never the start: a JPEG/EXIF
 * header is shared by many photos from one phone), aligned to 4 so it decodes cleanly. */
export function fingerprint(base64: string): { text: string; bytes: Buffer } {
  if (base64.length <= 64) return { text: base64, bytes: Buffer.from(base64, "base64") };
  const start = Math.floor((base64.length - 64) / 2 / 4) * 4;
  const text = base64.slice(start, start + 64);
  return { text, bytes: Buffer.from(text, "base64") };
}
```

- [ ] **Step 4: Implement `eligibility.ts`.** This is SQL on a `pg.ClientBase`, because the CLI uses `pg` as `people/cli.ts` does.

```ts
export async function photoState(q: pg.ClientBase, publicId: string, lock = false): Promise<PhotoState | null> {
  const r = await q.query(`
    select p.id, p.public_id, p.removed_at, length(p.data) as data_length,
           coalesce((select e.action from photo_visibility_events e where e.photo_id = p.id order by e.id desc limit 1), 'restore') = 'hide' as hidden_now,
           (exists (select 1 from photo_visibility_events h
                     where h.photo_id = p.id and h.action = 'hide' and h.reason = 'privacy'
                       and h.id > coalesce((select max(r.id) from photo_visibility_events r where r.photo_id = p.id and r.action = 'restore'), 0))
            or exists (select 1 from welfare_reports w where w.photo_id = p.id and w.reason = 'photo_private')) as hidden_for_privacy
      from photos p where p.public_id = $1 ${lock ? "for update of p" : ""}`, [publicId]);
  const row = r.rows[0];
  return row ? { id: row.id, publicId: row.public_id, hiddenNow: row.hidden_now, hiddenForPrivacy: row.hidden_for_privacy, removedAt: row.removed_at, dataLength: row.data_length } : null;
}
/** On the team now: joined, not left, staff or management in force (as people.ts's
 * managerRecipient/findAllowedPerson conditions: accepted_at set, left_at null, scopeInForce()). */
export async function isTeamMemberNow(q: pg.ClientBase, personId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return false;
  const r = await q.query(`
    select 1 from people p join person_scopes s on s.person_id = p.id
     where p.id = $1 and p.accepted_at is not null and p.left_at is null
       and s.role in ('staff', 'management') and (s.expires_at is null or s.expires_at > now())
     limit 1`, [personId]);
  return r.rowCount === 1;
}
```

Before writing this, check the column names `accepted_at`, `left_at`, `expires_at` and `role` in `lib/db/src/schema/people.ts` and `personScopes`. `scopeInForce()` (`people.ts:302`) is the source rule; the SQL above must say the same thing. Add a comment pointing to it.

- [ ] **Step 5: Implement `standIn.ts`.** It mirrors `displayPhotoRows` (`api/lib/photoVisibility.ts:119-162`); T14 in Task 9 pins the parity.

```ts
/** The photo the public sees in place of `excludePhotoId` for this cat: the newest cover photo
 * of its resolved sightings that is neither hidden nor removed (newest by created_at, then id),
 * or 0. Mirrors displayPhotoRows in the api-server; T14 pins the two together. */
export async function standInFor(q: pg.ClientBase, catId: number, excludePhotoId: number): Promise<number> {
  const r = await q.query(`
    select p.id from sightings s join photos p on p.id = s.photo_id
     where s.cat_id = $1 and s.status = 'resolved' and p.id <> $2 and p.removed_at is null
       and coalesce((select e.action from photo_visibility_events e where e.photo_id = p.id order by e.id desc limit 1), 'restore') <> 'hide'
     order by s.created_at desc, s.id desc limit 1`, [catId, excludePhotoId]);
  return r.rows[0]?.id ?? 0;
}
```

- [ ] **Step 6: Implement `search.ts`.**

```ts
const SCANNED_TYPES = new Set(["text", "character varying", "json", "jsonb", "ARRAY", "bytea"]);
const KNOWN_SAFE = new Set(["integer", "bigint", "smallint", "boolean", "uuid", "date", "numeric", "real", "double precision",
  "timestamp with time zone", "timestamp without time zone", "interval", "time without time zone"]);

export async function searchFor(q, photo, fp, opts = {}) {
  const t0 = Date.now();
  const lines: SearchLine[] = [];
  const row = (await q.query(`select data is null as no_picture, removed_at, removed_by, removed_reason from photos where id = $1`, [photo.id])).rows[0];
  lines.push({ check: "picture", ok: !!row?.no_picture && !!row.removed_at, detail: row?.no_picture ? "no picture; marked removed" : "the picture is still there" });
  const v = await q.query(`delete from photo_variants where photo_id = $1 returning size`, [photo.id]); // read-only runs pass a read-only tx: see below
  lines.push({ check: "versions", ok: v.rowCount === 0, detail: v.rowCount === 0 ? "none" : `found and deleted ${v.rowCount}` });
  …
}
```

Spell this out in full in the implementation. The rules it must follow:
- **versions:** on a real run, after commit, use `delete … returning`. Run it twice, two seconds apart (spec §5.5 check 2). If the first finds rows, `ok` is `false` with "found and deleted N", so the run is `NOT GONE` and the runbook investigates; the second must find 0. On a dry run, use `select count(*)` only.
- **main_photo:** `select id from cats where primary_photo_id = $1` must be empty.
- **hidden:** the newest event is `hide`.
- **record:** `removed_at`, `removed_by` and `removed_reason` are all set, and `removed_reason ~ PHOTO_REF_RE`.
- **bytes:**
  - Skipped when `fp` is null; the detail then says "checked during the removal run".
  - Otherwise, for every column in `information_schema.columns` (`table_schema = 'public'`):
    - `data_type` in `SCANNED_TYPES`: count rows where `col::text like '%' || $1 || '%'` (text) or `position($2::bytea in col) > 0` (bytea).
    - `data_type` in neither set: that column is reported as unscanned, and the check fails.
  - Each query runs under `set local statement_timeout = <timeoutMs ?? 120000>`. A timeout error (`57014`) gives `ok: "not_verified"`.
  - Hits in `photos.data` of **another** row are collected into `otherPhotoIds`.
- **mentions:** the same scan for `photo.publicId` in text, json and array columns, excluding `photos.public_id`.
- **verdict:** `GONE` if every check is `true`; `NOT VERIFIED` if any is `not_verified` and none is `false`; otherwise `NOT GONE`.

Table and column names come from `information_schema`. Quote them with a `quoteIdent` that doubles `"`, as `switchover/carryBack.ts` does; reuse that function by importing it if it's exported, otherwise copy its three lines.

- [ ] **Step 7: Implement `remove.ts`.**

```ts
export async function removePhoto(client, input, testOnly = {}) {
  if (!isPhotoRef(input.ref)) return { kind: "refused", why: "bad_ref" };
  if (input.requireSwitch) {
    const s = await client.query(`select value from app_settings where key = 'photo_removal_on'`);
    if (s.rows[0]?.value !== true) return { kind: "refused", why: "switched_off" };
  }
  await client.query(input.apply ? "begin" : "begin isolation level repeatable read read only");
  try {
    const st = await photoState(client, input.publicId, input.apply);
    if (!st) { await client.query("rollback"); return { kind: "refused", why: "not_found" }; }
    if (st.removedAt) { await client.query("rollback"); return { kind: "already", removedAt: st.removedAt }; }
    if (!st.hiddenNow) { await client.query("rollback"); return { kind: "refused", why: "not_hidden" }; }
    if (!st.hiddenForPrivacy) { await client.query("rollback"); return { kind: "refused", why: "not_for_privacy" }; }
    if (!(await isTeamMemberNow(client, input.by))) { await client.query("rollback"); return { kind: "refused", why: "not_team" }; }
    const plan = await planFor(client, st);              // bytes, versions, repoints (via standInFor), spot photos, counts
    const dataRow = (await client.query(`select data from photos where id = $1`, [st.id])).rows[0];
    const fp = fingerprint(dataRow.data);
    if (!input.apply) {
      const search = await searchFor(client, st, null, { skipBytes: true });   // read-only view of how things stand
      await client.query("rollback");
      return { kind: "plan", plan, search };
    }
    if (testOnly.skip !== "delete_and_record") {
      await client.query(`update photos set data = null, removed_at = clock_timestamp(), removed_by = $2, removed_reason = $3
                           where id = $1 and removed_at is null`, [st.id, input.by, input.ref]);
    }
    if (testOnly.skip !== "versions") await client.query(`delete from photo_variants where photo_id = $1`, [st.id]);
    if (testOnly.skip !== "main_photo") {
      for (const r of plan.repoints) await client.query(`update cats set primary_photo_id = $2 where id = $1 and primary_photo_id = $3`, [r.catId, r.to, st.id]);
    }
    // Check 5 inside the transaction (spec §4.4 step 5): sees its own writes; the fingerprint can't be lost.
    const bytesLine = await scanBytes(client, st, fp);
    await client.query("commit");
    await testOnly.afterCommit?.();
    const after = await searchFor(client, st, null, { skipBytes: true });
    return { kind: "removed", plan, search: mergeBytes(after, bytesLine) };
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; }
}
```

Export `scanBytes` from `search.ts`, the check 5 part, and use it for `searchFor`'s bytes line too, so there's one scanner. `mergeBytes` puts the in-transaction bytes line into the after-commit lines and recomputes the verdict. On T5's "already" path, a re-run of the search (CLI) passes `fp = null`, so the bytes line reads "checked during the removal run".

- [ ] **Step 8: Run the tests and see them pass.** Run `pnpm --filter @workspace/db exec vitest run src/photoRemoval`. Fill in T3's `BYTE_AND_JSON` from the printed list (see Step 1), then run again.

- [ ] **Step 9: Mutation probes.** T2 already is the per-step probe, automated. Also, by hand:
  1. In `photoState`, change `h.reason = 'privacy'` to `h.action = 'hide'`. The T4 `not_for_privacy` cases must go red.
  2. Remove `p.left_at is null` from `isTeamMemberNow`. The T4 "has left" case must go red.
  3. Make `fingerprint` take the first 64 characters. Add a T1 variant in which P and Q share their first 200 base64 characters (one shared prefix), and confirm it goes red, because Q matches falsely. Keep that variant as a permanent test.

  Restore each after probing.

- [ ] **Step 10: Commit.** Use the message `SYC-462: removePhoto — one transaction, eligibility, repoint, in-transaction byte search`.

---

### Task 8: Hide, restore and list for the CLI (spec §5.1–§5.3; T4 hide cases, T6)

**Files:**
- Create: `lib/db/src/photoRemoval/hide.ts`
- Create: `lib/db/src/photoRemoval/list.ts`
- Test: `lib/db/src/photoRemoval/hide.test.ts`

**Interfaces:**

```ts
export type HideResult = { kind: "hidden" | "privacy_added" | "already"; state: PhotoState } | { kind: "refused"; why: "not_found" | "not_team" | "removed" } | { kind: "plan"; would: "hide" | "add_privacy" | "nothing"; state: PhotoState };
export async function hidePhotoForPrivacy(client: pg.Client, input: { publicId: string; by: string; apply: boolean }): Promise<HideResult>;
export type RestoreResult = { kind: "restored" | "already_public"; state: PhotoState } | { kind: "refused"; why: "not_found" | "not_team" | "removed" } | { kind: "plan"; would: "restore" | "nothing"; state: PhotoState };
export async function restorePhoto(client: pg.Client, input: { publicId: string; by: string; apply: boolean }): Promise<RestoreResult>;
export interface ListedPhoto { publicId: string; uses: string[]; takenAt: Date; hidden: boolean; hiddenForPrivacy: boolean; removedAt: Date | null }
export async function listCatPhotos(client: pg.Client, catId: number): Promise<ListedPhoto[]>;
```

- [ ] **Step 1: Write the failing tests.**
  - Hide a public photo: one `hide` event, `reason = 'privacy'`, `author = person_id = by`.
  - Hide a dashboard-hidden photo (reason null): a second `hide` with `privacy`. At no point is the newest event a `restore`; check it after.
  - Hide when already hidden for privacy: `already`, no write.
  - Hide or restore a removed photo: `refused removed`.
  - Restore: a `restore` event.
  - **T6:** hide then restore leaves `hiddenNow` false. The `photos` row and versions are unchanged (checksum).
  - `not_team` for each bad-person case from T4.
  - Dry runs write nothing.
  - `listCatPhotos`:
    - main photo first in `uses` as `"main photo"`;
    - sighting photos as `"sighting <id> (<role>)"`;
    - newest first by `created_at`;
    - the flags are right;
    - **it returns no reason text** (assert that `JSON.stringify` of the result doesn't contain the seeded reason strings).

- [ ] **Step 2: Run the tests and see them fail.**

- [ ] **Step 3: Implement.** Use the same lock as the app: `select … from photos where public_id = $1 for update`, then `photoState`. Insert with:

```sql
insert into photo_visibility_events (photo_id, action, author, person_id, reason, at)
values ($1, $2, $3::text, $3::uuid, $4, clock_timestamp())
```

- [ ] **Step 4: Run the tests and see them pass.**

- [ ] **Step 5: Commit.** Use the message `SYC-462: hide-for-privacy, restore and list for the photo command`.

---

### Task 9: The CLI, the `db-ops` wiring and the setting (spec §4.6, §5; T7, T4 CLI cases, T14)

**Files:**
- Create: `lib/db/src/photoRemoval/cli.ts`
- Create: `lib/db/src/photoRemoval/cli.test.ts`
- Create: `lib/db/src/photoRemoval/dbOps.photos.test.ts`
- Modify: `lib/db/package.json` (the scripts `"photos": "tsx ./src/photoRemoval/cli.ts"`)
- Modify: `lib/db/src/appSettings/shape.ts`
- Modify: `lib/db/src/appSettings/dbOps.settings.test.ts`
- Modify: `scripts/db-ops.sh`
- Modify: `.github/workflows/db-ops.yml`
- Create: `artifacts/api-server/src/lib/photoRemoval.parity.test.ts` (T14)

**Interfaces:**
- Consumes everything from Tasks 7 and 8.
- Produces: `runPhotosCommand(argv: string[], io: { env: Record<string, string | undefined>; out: (line: string) => void }): Promise<number>`. The exit codes:

| Code | Meaning |
|---|---|
| 0 | done, already, or a dry run |
| 1 | usage error or refused |
| 2 | `NOT GONE` |
| 3 | `NOT VERIFIED` |

- [ ] **Step 1: Read the patterns.** Read `lib/db/src/appSettings/cli.ts` in full; it's the smallest CLI, with `pg.Client`, target resolution and an io object. Read the `run_settings` function in `scripts/db-ops.sh` (lines ~431-447) and its `dbOps.settings.test.ts`. Mirror them exactly.

- [ ] **Step 2: Write the failing tests.**

```ts
// cli.test.ts
it("T7: no output line holds an address, a device id, coordinates, a note or a reason", async () => {
  // seed as T1 with device id 'device-secret-123', lat 37.4441, a note 'note-secret', hide reason 'privacy', report text 'report-secret';
  // run list, hide (dry, real), remove (dry, real) through runPhotosCommand with DATABASE_TARGET=development, NEON_DEV_URL=<throwaway url>;
  const all = lines.join("\n");
  for (const bad of [dbUrl, new URL(dbUrl).host, "device-secret-123", "37.4441", "note-secret", "report-secret", "privacy:"]) expect(all).not.toContain(bad);
});
it("refuses a target mismatch before connecting", async () => { /* DATABASE_TARGET=production, --target development → exit 1, message names the mismatch */ });
it("remove needs confirm=REMOVE and the id twice; otherwise it's a dry run", async () => { /* no --confirm → 'DRY RUN'; --confirm REMOVE with different --photo-confirm → exit 1, 'don't match', nothing changed */ });
it("photo_ref with a name is refused (T4)", async () => { /* --ref 'Maria door' → exit 1 */ });
it("production needs photo_removal_on (T4)", async () => { /* target production + setting absent → exit 1 'switched off' */ });
it("exit 2 on NOT GONE", async () => { /* seed a second photo with P's exact data under another id → remove → exit 2, output names the other id */ });
```

Command line: `photos <list|hide|restore|remove> --target <t> [--photo <id>] [--photo-confirm <id>] [--cat <n>] [--by <uuid>] [--ref <ref>] [--confirm HIDE|RESTORE|REMOVE]`.

The printed shape follows spec §5.4's example, with full ids. The prefix is `photo-remove (DRY RUN: nothing changed) target=…` for a dry run and `photo-remove target=…` for a real run. Then one line per plan item, then one line per search check (`  search: <check> … ok|NOT OK|not verified (<detail>)`), then the verdict and `(<ms> ms)`.

```ts
// photoRemoval.parity.test.ts (api-server) — T14
// For several seeded cats, standInFor(client, cat, mainId) equals the id catDisplayPhotoIds() picks once
// the main is hidden: several candidates; one hidden; one removed; a created_at tie (same timestamp, ids differ); none.
```

Write T14 out in full. Use `roleKit` seeds plus raw inserts of resolved sightings, and a `pg.Client` on `process.env.DATABASE_URL`'s test database. Check `src/test/globalSetup.ts` for how the api-server test DB URL is exposed.

- [ ] **Step 3: Run the tests and see them fail.**

- [ ] **Step 4: Implement.**

**`shape.ts`:** add `"photo_removal_on"` to `SETTING_KEYS`, with this comment:

```ts
// SYC-462 spec §4.6: removal runs on production only once this is true, set after
// the live build is confirmed to include SYC-462. Hiding never needs it.
```

Then add it to the boolean case:

```ts
    case "feed_tap_count":
    case "extra_photos_on":
    case "photo_removal_on":
      return typeof value === "boolean" ? null : "must be true or false";
```

**`db-ops.sh`:** add `run_photos` beside `run_settings`.

```bash
# --- photo-* (SYC-462) -------------------------------------------------------
# Hand removal of a photo on a privacy request (docs/runbooks/photo-removal.md).
# Every writing command is a dry run unless CONFIRM names it; remove also needs
# PHOTO_ID_CONFIRM equal to PHOTO_ID. Output is public: the CLI prints ids,
# cat numbers, dates and yes/no only.
run_photos() {
  local sub="$1" # list | hide | restore | remove
  local out="$WORKDIR/photos.log"
  local status=0
  local args=(--target "$TARGET")
  case "$sub" in
    list) require PHOTO_CAT; args+=(--cat "$PHOTO_CAT") ;;
    hide|restore) require PHOTO_ID; require PHOTO_BY; args+=(--photo "$PHOTO_ID" --by "$PHOTO_BY") ;;
    remove)
      require PHOTO_ID; require PHOTO_BY; require PHOTO_REF
      args+=(--photo "$PHOTO_ID" --by "$PHOTO_BY" --ref "$PHOTO_REF")
      if [ -n "${PHOTO_ID_CONFIRM:-}" ]; then args+=(--photo-confirm "$PHOTO_ID_CONFIRM"); fi
      ;;
  esac
  if [ -n "${CONFIRM:-}" ]; then args+=(--confirm "$CONFIRM"); fi
  (cd "$ROOT" && pnpm --silent --filter @workspace/db run photos -- "$sub" "${args[@]}") \
    >"$out" 2>&1 || status=$?
  grep_no_urls "$out"
  cat "$out"
  return "$status"
}
```

In `main`:

```bash
  photo-list|photo-hide|photo-restore|photo-remove)
    if [ "$TARGET" = "rehearsal" ]; then
      echo "db-ops: $COMMAND only runs against target=development or target=production." >&2
      exit 1
    fi
    require_neon_url
    run_photos "${COMMAND#photo-}"
    ;;
```

The `require` helper, and `run_settings`'s use of `NEON_URL`, show how the CLI gets its address. Pass it exactly as `run_settings` does. Check whether `run_settings` exports `NEON_DEV_URL` and friends or relies on the environment, and do the same.

**`db-ops.yml`:**
- Add `photo-list, photo-hide, photo-restore, photo-remove` to the `command` options.
- Add `photo_removal_on` to `setting_key`.
- Add these inputs, each `type: string, required: false`, with the descriptions given:

| Input | Description |
|---|---|
| `photo_id` | "For photo-*: the photo's public id (from photo-list)" |
| `photo_id_confirm` | "For photo-remove: the same id again" |
| `photo_cat` | "For photo-list: the cat's number" |
| `photo_by` | "For photo-hide/-restore/-remove: the approving team member's people id (from people-list)" |
| `photo_ref` | "For photo-remove: SYC-<n> or 'hello YYYY-MM-DD #<n>'. Never a name" |

- Map them into the Run step's `env:` as `PHOTO_ID`, `PHOTO_ID_CONFIRM`, `PHOTO_CAT`, `PHOTO_BY` and `PHOTO_REF`.
- Extend `confirm`'s description to include HIDE, RESTORE and REMOVE.

**`dbOps.photos.test.ts`:** mirror `dbOps.settings.test.ts`. It runs `bash scripts/db-ops.sh` with `COMMAND=photo-list` and the other variables against a throwaway database, and asserts:
- rehearsal is refused;
- a missing `PHOTO_ID` is refused;
- the output passes `grep_no_urls`.

- [ ] **Step 5: Lint the workflow.** If `actionlint` is installed, run `actionlint .github/workflows/db-ops.yml`. If it isn't, write in the checkpoint and PR that it was **unchecked locally** and that CI's syntax-check job covers it. Count the `workflow_dispatch` inputs: expected 15. The limit is confirmed by the first real dispatch in the rehearsal; that's the parent session's job after merge.

- [ ] **Step 6: Run the tests and see them pass.** Run:
  - `pnpm --filter @workspace/db exec vitest run src/photoRemoval src/appSettings`
  - `pnpm --filter @workspace/api-server exec vitest run src/lib/photoRemoval.parity.test.ts`

- [ ] **Step 7: Commit.** Use the message `SYC-462: the photo command through db-ops (list, hide, restore, remove) and the photo_removal_on switch`.

---

### Task 10: Carry-back copies a removed photo as an empty picture (spec §3.4, §6 item 9; T17)

**Files:**
- Modify: `lib/db/src/switchover/carryBack.ts` (`writeRows`, ~796-806)
- Test: `lib/db/src/switchover/carryBack.test.ts`

- [ ] **Step 1: Write the failing test.** Find how `carryBack.test.ts` builds a "Neon" source at today's schema and an "old" target at the baseline (`grep -n "baseline\|createThrowaway" lib/db/src/switchover/carryBack.test.ts`). Then:
  - add a photo on the source, after the copy, and remove it (data null, `removed_*` set);
  - run carry-back apply;
  - assert it succeeds and the target's row has `data = ''`.

- [ ] **Step 2: Run the test and see it fail.** Expected: a not-null violation on the target.

- [ ] **Step 3: Implement.**

```ts
// writeRows(): a removed photo (SYC-462) has no picture; the old database's photos.data
// is NOT NULL and has no removed_* columns, so it gets an empty picture: the rollback
// still works and the picture still doesn't come back.
const selectExpr = (c: { name: string }) =>
  plan.table === "photos" && c.name === "data" ? `coalesce(t."data", '')` : `t.${quoteIdent(c.name)}`;
  const select = cols.map((c, i) => `${selectExpr(c)}::text as "c${i}"`).join(", ");
```

Check where carry-back *compares* rows to decide inserts and updates; the fingerprint and hash code is near `:514`. A removed photo must hash as changed on the source and still compare cleanly after the apply. Run the carry-back test suite to confirm that a second apply finds nothing to do (its existing idempotence test). If the comparison hashes `data` directly, apply the same `coalesce` there and say so in the commit.

- [ ] **Step 4: Run the tests and see them pass.** Run `pnpm --filter @workspace/db exec vitest run src/switchover`.

- [ ] **Step 5: Mutation probe.** Remove the `coalesce`. T17 must go red. Restore it.

- [ ] **Step 6: Commit.** Use the message `SYC-462: carry-back writes an empty picture for a removed photo`.

---

### Task 11: The runbook and the documentation (spec §7)

**Files:**
- Create: `docs/runbooks/photo-removal.md`
- Modify: `docs/runbooks/neon-database.md`, in three places:
  - the restore section near `:172`: one line;
  - the command list at `:27`: add the four commands;
  - the settings list at `:35`: add `photo_removal_on`.
- Modify: `docs/superpowers/plans/mvp-launch-31-oct.md:58`, the "caches" wording.

- [ ] **Step 1: Write the runbook.** Take spec §7 word for word in substance: the go-live steps 1–4, steps 1–13, the two reply templates, the "after any restore" rule, "if a step fails" and "never roll the app back". Then make each command exact, a real `gh workflow run` line in the form `docs/runbooks/neon-database.md` uses (read its examples first: `db-ops -f target=… -f command=…`):

```bash
gh workflow run db-ops.yml --ref main -f target=production -f command=photo-list -f photo_cat=182
```

Write one line like this for each step. **No secret values.** `photo_by` is a people id, which isn't secret. Add the "ledger" ticket template: the columns, and **no personal data**.

- [ ] **Step 2: The restore line.** Add this to `neon-database.md` under "Restoring to a point in time":

  > **After any restore, snapshot swap or carry-back, re-apply photo removals:** for every row on the "Photo removals" ledger dated after the restore point, run `photo-hide` then `photo-remove` (docs/runbooks/photo-removal.md, "After any restore") before visitors reach the restored database.

- [ ] **Step 3: The launch plan line.** In line 58, replace "(main photo, sighting photo, extra photos, matching reference, small and medium versions, caches)" with:

  > (main photo, sighting photo, extra photos, matching reference, small and medium versions; the photo's addresses stop answering. A copy already saved on a phone can't be reached)

- [ ] **Step 4: Proofread.** Check the plain English, the canonical words ("cat guardian", "spotter"), and that no claim lacks a source: the backup windows say "read in step 10", never a number.

- [ ] **Step 5: Commit.** Use the message `SYC-462: runbook for removing a photo by hand; restore rule in the Neon runbook`.

---

### Task 12: The local rehearsal, the full test runs, and the PR (spec §8.5 step 1)

- [ ] **Step 1: Seed a scratch database.** Create one throwaway database on the local Postgres:

```bash
createdb syc462_scratch
DATABASE_URL=postgres://postgres:postgres@localhost:5432/syc462_scratch pnpm --filter @workspace/db run migrate
```

Seed it with T1's `seedEverywhere`, exported from a small `lib/db/src/photoRemoval/seedScratch.ts` run with `tsx`. Don't commit that file; it lives in the scratchpad.

- [ ] **Step 2: Run the whole flow through `db-ops.sh` itself.** For each step, set `TARGET=development DATABASE_TARGET=development NEON_DEV_URL=postgres://postgres:postgres@localhost:5432/syc462_scratch` and the `COMMAND`/`PHOTO_*`/`CONFIRM` variables, then run `bash scripts/db-ops.sh`. The order:
  1. list;
  2. hide, dry run;
  3. hide;
  4. restore;
  5. hide;
  6. remove, dry run;
  7. remove;
  8. remove again;
  9. list.

  Expected: the real remove ends `GONE`, and the second remove says "already removed". Save the whole output to the scratchpad. It goes into the PR description. It has no secrets: it's local and printed by the hygiene-tested CLI. Still, scan it with `grep -E 'postgres://|localhost'` and redact any line that matches, per memory `log-redaction-not-deletion`.

- [ ] **Step 3: Run the full suites and quote the counts.**

```bash
pnpm --filter @workspace/db test
pnpm --filter @workspace/api-server test
pnpm -r exec tsc --noEmit
```

Expected: all green. Quote the pass and fail counts in the PR. If the full api-server suite is too slow locally, run every file named in Tasks 2–9 and the regression sets, and **say so** in the PR.

- [ ] **Step 4: Ask a Sonnet reviewer, in its own worktree, to re-run the named test files** (memory `rerun-delegated-tests`). This is a read-and-run check, not a review. Compare its counts with Step 3.

- [ ] **Step 5: Finish the PR.**
  - Update `syc-462-checkpoint.md`.
  - Commit and push.
  - Update PR #237's description: what was built, the test counts, the mutation probe log (each probe: the site, the test that went red, restored), the rehearsal output, and what's **unchecked** (actionlint, if it wasn't installed; the GitHub input limit; the production scan time).
  - The PR **stays a draft**.
  - Comment on SYC-462 with the link, and move it to In Review.
  - Send Samuel a push notification.
  - Don't merge. `/ship` runs the adversarial PR review, then the merge.

---

## Model delegation

The active model is **Opus**, inherited from the parent session. The launch plan assigns SYC-462 to Opus for correctness: "A missed copy means the photo isn't really gone".

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Tasks 1–11, all code and docs | **Opus (this session, inline)** | Two standing rules forbid delegating the writing:<ul><li>this chip's rule 9: helper subagents return text and can't write files;</li><li>"no nested background agents from a chip".</li></ul>The work is also correctness-critical, and tightly coupled across the migration, the `lib/db` core and the app readers | Test-first throughout. **Mutation probes** at every silent-failure guard (Tasks 2–7 and 10 list each one). The type checker is the ground-truth reader list (Task 1 Step 6). T13 is the source guard. T3 is the schema catalogue |
| Re-running the named test files independently (Task 12 Step 4) | **Sonnet**, in its own worktree | Mechanical: checkout, run, report counts | Its counts are compared with Opus's Step 3 counts. A mismatch blocks the PR update |
| Adversarial review of the finished PR (at `/ship`, not in this plan's run) | **Sonnet**, in its own worktree (Samuel's default for reviewers) | Fresh eyes on a large diff, and cheaper than Opus | The reviewer must run T1, T2 and T13 itself and attempt one mutation of its own choosing. Findings are folded in before merge |
| The rehearsal on the Neon `development` branch | Parent session (Opus), after merge | It writes to a Neon branch, so it needs Samuel's heads-up. It's outside this chip's "never touch Neon" rule | The workflow output is pasted on SYC-462. The search must say `GONE`. Its duration sets the production timeout |

No Haiku packages. The only mechanical work (the workflow inputs, the settings key) is too entangled with the tests to hand off safely.

**Where else the invariant "a removed photo is never shown, sent or rebuilt" must hold.** This is the consumer list the silent-failure rule asks for, from spec §3.1 and Task 1 Step 6:
- R1–R7;
- P9;
- `photoPublicIds` and `likelyReview`;
- `hiddenPhotoIds`, and so every route that asks it;
- `variantFor`'s save;
- carry-back;
- `setPhotoVisibility`, plus the DB trigger.

A site found later goes into T13's allowlist only with its own guard and test.

## Self-review against the spec

| Spec section | Where this plan covers it |
|---|---|
| §4.1 migration, check, trigger, rollback guard, lock note | Task 1 (lock and retry: Task 11 runbook) |
| §4.2 repoint and parity | Task 7 (`standIn`), Task 9 (T14) |
| §4.3 versions | Task 4, plus Task 7's search |
| §4.4 one write and in-transaction scan | Task 7 |
| §4.5 `hiddenPhotoIds` | Task 2 |
| §4.6 the switch | Task 9; go-live steps in Task 11 |
| §5.1–5.4 commands | Tasks 8 and 9 |
| §5.5 search | Task 7 |
| §5.6 outside checks | Task 11 (runbook) |
| §6 items 1–9 | Tasks 2, 3, 5, 4, 2, 6 and 10 (item 6, `catDisplayPhotos` skipping removed: through `hiddenPhotoIds` in Task 2) |
| §7 | Task 11 |
| §8 T0–T18 | Tasks 1–10; T7 in Task 9 |
| §8.5 rehearsal | Task 12 step 1; step 2 is the parent's, after merge |
| §11 and §12 coordination | Global constraints (migration number); off-limits files |

**Corrections to the spec found while planning,** recorded rather than silently changed:
1. Spec T1's "P as another sighting's face photo" can't happen, because `sighting_photos_photo_uq` lets a photo belong to one spot only. T1 instead seeds a second photo, P2, as a face photo, and removes it in its own case (Task 7 Step 1).
2. Spec §5 says the tool reuses "the people store's own query". `people.ts` has no exported "on the team now" query, so `isTeamMemberNow` writes the same conditions in SQL and points to `scopeInForce()` (Task 7 Step 4). T4 pins the behaviour.

Both go on SYC-462 as a comment when this plan is committed.
