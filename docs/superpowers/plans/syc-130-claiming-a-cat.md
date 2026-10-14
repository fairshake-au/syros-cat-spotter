# SYC-130 "This is my cat": Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved by Samuel, 13 Oct 2026. Nothing is built yet.

**Goal:** Only a person who has met a street cat, says they live on Syros, says the cat is theirs, and pins their home within 1 km of where the map shows the cat can claim it. Claims end by the owner letting go or the team removing the owner.

**Architecture:** One server function, `claimEligibility`, decides who may claim. Both the claim route and a new `canClaim` field on the cat's detail use it, so the app and the server always agree. Withdrawing a claim writes a `life_status` observation `{ withdrawn: true }` that supersedes the owner's `homed`. The resolver already ignores a record with no status, so the cat falls back to whatever stood before. The home pin is two new owner-and-team-only columns on `cats`. "Remove owner" is one new team form and route.

**Tech Stack:** Express + drizzle (`artifacts/api-server`), Postgres migrations (`lib/db`), OpenAPI + orval (`lib/api-spec`), Expo/React Native + web (`artifacts/cat-spotter`), vitest + supertest.

**Spec:** `docs/specs/claiming-a-cat.md` (approved by Samuel, 13 Oct 2026; decisions D1–D13 from 8 Oct 2026), with its reviews `docs/specs/reviews/claiming-a-cat-review.md` and `claiming-a-cat-review-2.md`.

## Global Constraints

These hold in every task:

- **Who may claim:** the cat's derived life status is `street` and it has no owner; and this phone has a resolved sighting of it (or of a cat merged into it), whose match choice is `suggested`, `hand_pick`, `new_cat` or `unlabelled`, and which is still on the cat chosen at match time. A spot whose choice wasn't recorded (saving it failed) counts like `unlabelled` (Samuel, 14 Oct 2026). (Spec §3, D1, D3.)
- **Order of checks:** rules 1 and 2 first, then the confirmations and the pin. Refusals never say how far, or in which direction, the pin is out. (§3, §11)
- **The pin:** within **1 km** (≤ 1000 m) of `blurPosition(cat.lat, cat.lng)`, never the exact position or any sighting. (D11)
- **Refusals:**
  - `NOT_MET` 403;
  - `ALREADY_HOMED` 409;
  - `NOT_ON_STREET` 409;
  - `NOT_CONFIRMED` 422;
  - `PIN_TOO_FAR` 422;
  - an invalid pin is a plain 400;
  - the rate limit is 429.

  The app reads `code` from the body. (§4.4)
- **Same owner claiming again:** 200, with nothing written and no message. (§3 rule 4)
- **Claim limit:** **5 attempts per phone per 24 hours**, refusals included. Re-claiming the same cat within **7 days** of letting it go is refused with 429 `CLAIM_COOLDOWN`. (§11)
- **The home note and pin:**
  - only the owner and the team see them; on the team side, only people with `view_exact_location` see the pin;
  - never in a public payload, a message or a log;
  - the pin is stored to 5 decimal places;
  - both are cleared on let-go and Remove owner, and **kept on deletion** (D9, D13, §5).
- **Messages:** the "has a home" push goes out on a cat's **first** claim only, and never includes the note. Let-go and removal tell nobody. (§8)
- **Wording:** verbatim from spec §4 and §6, name-first (no "he", "she" or "her"). French uses "tu". Terms are "cat guardian" and "spotter".
- **Builds on #97 (SYC-63)**, which must be merged first: `severPerson`, the deleted-device marker and the nullable spotter fields.
- **Migrations:** numbered at merge time, never by hand (`lib/db/migrations/README.md`).

---

## File structure

| File | Responsibility | New or changed |
|---|---|---|
| `lib/db/src/schema/cats.ts` | `homeLat`, `homeLng` columns, plus a check that both are set or neither | changed |
| `lib/db/migrations/NNNN_cat_home_pin.sql` | Generated, with the hand-written rollback | new |
| `artifacts/api-server/src/lib/observations.ts` | Accept a `life_status` withdrawal only when it supersedes a `homed` | changed |
| `artifacts/api-server/src/lib/claiming.ts` | `claimEligibility`, `pinWithinReach`, `newestActiveOwnerHomed`, `withdrawOwnerClaim` | new |
| `artifacts/api-server/src/lib/catHelpers.ts` | `homeDescription` and `homePin` only for the owner tier; `deriveCatStatuses` takes an optional executor | changed |
| `artifacts/api-server/src/lib/observations.ts` (`loadCatRecords`) | Optional executor, so the claim reads status inside its transaction | changed |
| `artifacts/api-server/src/middlewares/rateLimit.ts` | `checkClaimLimit` (per device, 5 per 24 h) | changed |
| `artifacts/api-server/src/routes/cats.ts` | The claim route rewritten; `POST /cats/:catId/let-go`; `canClaim` on the detail; `POST /cats` removed | changed |
| `artifacts/api-server/src/lib/capabilities.ts` | `remove_owner` | changed |
| `artifacts/api-server/src/lib/teamCatView.ts` | `owner: { has, homeDescription, homePin }` | changed |
| `artifacts/api-server/src/lib/teamPages/catPages.ts` | "Has an owner" and the Remove owner form | changed |
| `artifacts/api-server/src/routes/teamCorrections.ts` | `POST /team/cats/:id/remove-owner`; the life-status form offers removal | changed |
| `lib/api-spec/openapi.yaml` plus generated clients | `CatClaim` v2, `CatLetGo`, `canClaim`, `homePin`; `registerCat` removed | changed |
| `artifacts/cat-spotter/components/ClaimCatSheet.tsx` | The two-step claim; "doesn't live with me any more" | changed |
| `artifacts/cat-spotter/app/cat/[id].tsx` | Uses `canClaim`, the hint line, the offline state | changed |
| `artifacts/cat-spotter/context/DeviceContext.tsx` | `ownedCatIds` comes from the server whenever online | changed |
| `artifacts/cat-spotter/lib/i18n.ts` | New strings in en, el and fr; "Adopt" removed | changed |

---

### Task 1: The home pin columns

**Files:**
- Modify: `lib/db/src/schema/cats.ts`
- Create (generated): `lib/db/migrations/NNNN_cat_home_pin.sql`, plus `meta/`
- Test: `lib/db/src/migrate/catHomePin.test.ts`

**Interfaces:**
- Produces: `catsTable.homeLat`, `catsTable.homeLng` (`double precision`, nullable), and the constraint `cats_home_pin_ck`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/db/src/migrate/catHomePin.test.ts — same throwaway-database pattern as deletionUnlinks.test.ts
import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

const baseUrl = process.env.DATABASE_URL!;
const url = (db: string) => { const u = new URL(baseUrl); u.pathname = `/${db}`; return u.toString(); };
const name = `homepin_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
});
afterAll(async () => { await c.end(); await admin.query(`drop database if exists "${name}"`); await admin.end(); });

const insertCat = (lat: number | null, lng: number | null) =>
  c.query(
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id, home_lat, home_lng)
     values ($1, 1, 37.44, 24.94, 'dev-a', $2, $3) returning id`,
    [`pin-${crypto.randomBytes(3).toString("hex")}`, lat, lng],
  );

describe("cats home pin", () => {
  it("allows both or neither", async () => {
    await expect(insertCat(null, null)).resolves.toBeTruthy();
    await expect(insertCat(37.44123, 24.94123)).resolves.toBeTruthy();
  });
  it("refuses one without the other", async () => {
    await expect(insertCat(37.44, null)).rejects.toThrow(/cats_home_pin_ck/);
    await expect(insertCat(null, 24.94)).rejects.toThrow(/cats_home_pin_ck/);
  });
});
```

- [ ] **Step 2: Run it, and confirm it fails**

Run: `cd lib/db && DATABASE_URL=postgres://localhost/postgres npx vitest run src/migrate/catHomePin.test.ts`
Expected: FAIL with `column "home_lat" of relation "cats" does not exist`.

- [ ] **Step 3: Add the columns to the schema**

In `lib/db/src/schema/cats.ts`, after `homeDescription`:

```ts
    // Where the owner says the cat lives (claiming-a-cat.md §5): seen only by
    // the owner and the team, never public, kept on deletion (D13).
    homeLat: doublePrecision("home_lat"),
    homeLng: doublePrecision("home_lng"),
```

and in the table's constraints:

```ts
    check(
      "cats_home_pin_ck",
      sql`(${table.homeLat} is null) = (${table.homeLng} is null)`,
    ),
```

- [ ] **Step 4: Generate the migration, then add the rollback by hand**

Run: `pnpm --filter @workspace/db run generate --name cat_home_pin` (on macOS, prefix `ESBUILD_BINARY_PATH`; see CHECKPOINT). At the end of the generated file, add:

```sql
-- rollback-begin
-- ALTER TABLE "cats" DROP CONSTRAINT "cats_home_pin_ck";
-- ALTER TABLE "cats" DROP COLUMN "home_lng";
-- ALTER TABLE "cats" DROP COLUMN "home_lat";
-- rollback-end
```

- [ ] **Step 5: Run the test and `migrate:check`, and confirm both pass**

Run: `npx vitest run src/migrate/catHomePin.test.ts && DATABASE_URL=postgres://localhost/<scratch> pnpm run migrate:check`
Expected: 2 passed; `migrate:check ok`.

- [ ] **Step 6: Commit**

```bash
git add lib/db && git commit -m "SYC-130: owner-and-team home pin on cats"
```

---

### Task 2: A life-status withdrawal

**Files:**
- Modify: `artifacts/api-server/src/lib/observations.ts` (in `writeObservation`, before `validateValue`)
- Test: `artifacts/api-server/src/lib/observations.withdrawal.test.ts`

**Interfaces:**
- Produces: the value `WITHDRAWN = { withdrawn: true } as const`, exported from `observations.ts`. A `life_status` row with this value is valid **only** with a `supersedesId` that points at an active `life_status` `{ status: "homed" }` row for the same cat. The resolver ignores it, because `parseLifeStatus` returns null for it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, afterAll } from "vitest";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { writeObservation, WITHDRAWN } from "./observations";
import { resolveLifeStatus } from "./resolve";

afterAll(async () => { await pool.end(); });

async function cat() {
  const [c] = await db.insert(catsTable).values({
    name: `Wd${Date.now()}${Math.random()}`.slice(0, 40), primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "dev-w",
  }).returning();
  return c!;
}
const at = (s: string) => new Date(s);

describe("life_status withdrawal", () => {
  it("withdraws an owner's homed, so the status falls back to what stood before", async () => {
    const c = await cat();
    await writeObservation(db, { catId: c.id, kind: "life_status", value: { status: "in_care" }, accountId: "system:legacy-backfill", roleAtTime: "staff", observedAt: at("2026-10-01") });
    const homed = await writeObservation(db, { catId: c.id, kind: "life_status", value: { status: "homed" }, deviceId: "dev-w", roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: at("2026-10-02") });
    await writeObservation(db, { catId: c.id, kind: "life_status", value: WITHDRAWN, deviceId: "dev-w", roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: at("2026-10-03"), supersedesId: homed.id, supersedeReason: "owner let go" });
    const rows = await db.select().from(observationsTable).where(eq(observationsTable.catId, c.id));
    expect(resolveLifeStatus(rows, null, at("2026-10-04")).value).toBe("in_care");
  });

  it("refuses a withdrawal with nothing to supersede", async () => {
    const c = await cat();
    await expect(writeObservation(db, { catId: c.id, kind: "life_status", value: WITHDRAWN, deviceId: "dev-w", roleAtTime: "public", observedAt: at("2026-10-03") }))
      .rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses withdrawing anything but a homed statement", async () => {
    const c = await cat();
    const street = await writeObservation(db, { catId: c.id, kind: "life_status", value: { status: "street" }, accountId: "system:legacy-backfill", roleAtTime: "staff", observedAt: at("2026-10-01") });
    await expect(writeObservation(db, { catId: c.id, kind: "life_status", value: WITHDRAWN, deviceId: "dev-w", roleAtTime: "public", observedAt: at("2026-10-03"), supersedesId: street.id }))
      .rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });
});
```

(`system:legacy-backfill` is a recognised system author, which stands in for a team statement here. Use whichever system author `SYSTEM_AUTHOR_SET` allows.)

- [ ] **Step 2: Run the tests, and confirm they fail**

Run: `cd artifacts/api-server && <test env> npx vitest run src/lib/observations.withdrawal.test.ts`
Expected: FAIL, because `WITHDRAWN` is not exported and `validateValue` refuses `{ withdrawn: true }`.

- [ ] **Step 3: Implement**

In `observations.ts`:

```ts
/** A claim withdrawn (claiming-a-cat.md §6, §7): supersedes a homed, asserts nothing. */
export const WITHDRAWN = { withdrawn: true } as const;

function isWithdrawal(kind: ObservationKind, value: unknown): boolean {
  return kind === "life_status" && isPlainObject(value) && value["withdrawn"] === true
    && Object.keys(value).length === 1;
}
```

At the top of `writeObservation`, replace `validateValue(input.kind, input.value);` with:

```ts
  if (isWithdrawal(input.kind, input.value)) {
    if (input.supersedesId == null) {
      refuse("MALFORMED_VALUE", "a life_status withdrawal must supersede a homed statement");
    }
    const [target] = await tx
      .select({ catId: observationsTable.catId, kind: observationsTable.kind, value: observationsTable.value })
      .from(observationsTable)
      .where(eq(observationsTable.id, input.supersedesId));
    const homed = target && target.catId === input.catId && target.kind === "life_status"
      && isPlainObject(target.value) && target.value["status"] === "homed";
    if (!homed) refuse("MALFORMED_VALUE", "a life_status withdrawal must supersede a homed statement");
  } else {
    validateValue(input.kind, input.value);
  }
```

- [ ] **Step 4: Run the tests and the existing observation tests, and confirm they pass**

Run: `npx vitest run src/lib/observations.withdrawal.test.ts src/lib/observations.test.ts src/lib/resolve.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "SYC-130: a life_status withdrawal supersedes a homed and asserts nothing"
```

---

### Task 3: Who may claim, and the pin's reach

**Files:**
- Create: `artifacts/api-server/src/lib/claiming.ts`
- Modify: `artifacts/api-server/src/lib/observations.ts` (`loadCatRecords(catIds, exec = db)`), `artifacts/api-server/src/lib/catHelpers.ts` (`deriveCatStatuses(cats, exec = db)` passes `exec` to `loadCatRecords` and to its own queries)
- Test: `artifacts/api-server/src/lib/claiming.test.ts`

**Interfaces:**
- Consumes: `blurPosition` (`lib/blur.ts`), `haversineKm` (`@workspace/geo`), `deriveCatStatuses`, `DbOrTx`.
- Produces:
  - `type ClaimRefusal = "NOT_MET" | "ALREADY_HOMED" | "NOT_ON_STREET"`
  - `claimEligibility(exec: DbOrTx, input: { catId: number; deviceId: string }): Promise<{ ok: true } | { ok: false; code: ClaimRefusal } | { ok: "owner" }>`
  - `pinWithinReach(cat: { lat: number; lng: number }, pin: { lat: number; lng: number }): boolean` (≤ 1000 m from `blurPosition(cat)`)
  - `CLAIM_PIN_REACH_M = 1000`
  - `newestActiveOwnerHomed(exec, catId, deviceId | null): Promise<number | null>` (the observation id)
  - `clearOwner(exec, catId): Promise<void>` (owner link, owner name, home note, pin)
  - `letGoWithinDays(exec, catId, deviceId, days): Promise<boolean>` (this phone withdrew its own claim on this cat within `days`)

- [ ] **Step 1: Write the failing tests**

```ts
import { afterAll, describe, expect, it } from "vitest";
import { db, pool, catsTable, sightingsTable, sightingMatchesTable, catIdentityTable } from "@workspace/db";
import { claimEligibility, pinWithinReach, CLAIM_PIN_REACH_M } from "./claiming";
import { blurPosition } from "./blur";
import { writeObservation } from "./observations";

afterAll(async () => { await pool.end(); });
const dev = () => `dev-claim-${Math.random().toString(36).slice(2, 10)}`;

async function streetCat(discoverer = "dev-someone") {
  const [c] = await db.insert(catsTable).values({ name: `Cl${Math.random()}`.slice(0, 30), primaryPhotoId: 0, lat: 37.4441, lng: 24.9412, discovererDeviceId: discoverer }).returning();
  return c!;
}
async function sighting(catId: number, deviceId: string, choice: string | null) {
  const [s] = await db.insert(sightingsTable).values({ catId, deviceId, photoId: 0, lat: 37.44, lng: 24.94, status: "resolved" }).returning();
  if (choice) await db.insert(sightingMatchesTable).values({ sightingId: s!.id, choice, chosenCatId: catId, chosenAt: new Date(), suggestedRank: choice === "suggested" ? 1 : null });
  return s!;
}

describe("claimEligibility", () => {
  it.each(["suggested", "hand_pick", "new_cat", "unlabelled"])("a %s sighting qualifies", async (choice) => {
    const c = await streetCat(); const d = dev();
    await sighting(c.id, d, choice);
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({ ok: true });
  });
  it("no sighting: NOT_MET", async () => {
    const c = await streetCat();
    expect(await claimEligibility(db, { catId: c.id, deviceId: dev() })).toEqual({ ok: false, code: "NOT_MET" });
  });
  it("a sighting moved to another cat after matching doesn't count", async () => {
    const c = await streetCat(); const other = await streetCat(); const d = dev();
    const s = await sighting(c.id, d, "suggested");
    await db.update(sightingMatchesTable).set({ chosenCatId: other.id }).where(eqSighting(s.id));
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({ ok: false, code: "NOT_MET" });
  });
  it("a sighting of a cat merged into this one counts", async () => {
    const c = await streetCat(); const merged = await streetCat(); const d = dev();
    await sighting(merged.id, d, "suggested");
    await db.insert(catIdentityTable).values({ catId: merged.id, canonicalCatId: c.id, reason: "test" });
    expect(await claimEligibility(db, { catId: c.id, deviceId: d })).toEqual({ ok: true });
  });
  it("a homed cat: ALREADY_HOMED; in care: NOT_ON_STREET; this phone already owner: owner", async () => {
    const d = dev();
    const homed = await streetCat(); await sighting(homed.id, d, "suggested");
    await writeObservation(db, { catId: homed.id, kind: "life_status", value: { status: "homed" }, accountId: "system:legacy-backfill", roleAtTime: "staff", observedAt: new Date() });
    expect(await claimEligibility(db, { catId: homed.id, deviceId: d })).toEqual({ ok: false, code: "ALREADY_HOMED" });

    const care = await streetCat(); await sighting(care.id, d, "suggested");
    await writeObservation(db, { catId: care.id, kind: "life_status", value: { status: "in_care" }, accountId: "system:legacy-backfill", roleAtTime: "staff", observedAt: new Date() });
    expect(await claimEligibility(db, { catId: care.id, deviceId: d })).toEqual({ ok: false, code: "NOT_ON_STREET" });

    const mine = await streetCat(); await db.update(catsTable).set({ ownerDeviceId: d }).where(eqCat(mine.id));
    expect(await claimEligibility(db, { catId: mine.id, deviceId: d })).toEqual({ ok: "owner" });
  });
});

describe("pinWithinReach", () => {
  const cat = { lat: 37.4441, lng: 24.9412 };
  const centre = blurPosition(cat.lat, cat.lng);
  const north = (m: number) => ({ lat: centre.lat + m / 111_320, lng: centre.lng });
  it("measures from the public cell centre, inclusive at 1 km", () => {
    expect(pinWithinReach(cat, north(CLAIM_PIN_REACH_M - 1))).toBe(true);
    expect(pinWithinReach(cat, north(CLAIM_PIN_REACH_M + 2))).toBe(false);
  });
});
```

(`eqSighting` and `eqCat` are local helpers wrapping `eq(sightingMatchesTable.sightingId, id)` and `eq(catsTable.id, id)`.)

- [ ] **Step 2: Run the tests, and confirm they fail**

Run: `npx vitest run src/lib/claiming.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `claiming.ts`**

```ts
import { catsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { haversineKm } from "@workspace/geo";
import { blurPosition } from "./blur";
import { deriveCatStatuses } from "./catHelpers";
import type { DbOrTx } from "./observations";

/** claiming-a-cat.md D11: the pin must be within this of the cat's public position. */
export const CLAIM_PIN_REACH_M = 1000;
export type ClaimRefusal = "NOT_MET" | "ALREADY_HOMED" | "NOT_ON_STREET";
export type Eligibility = { ok: true } | { ok: "owner" } | { ok: false; code: ClaimRefusal };

/** §3 rules 1 and 2, and rule 4's "already the owner". Pure reads; the caller locks. */
export async function claimEligibility(
  exec: DbOrTx,
  { catId, deviceId }: { catId: number; deviceId: string },
): Promise<Eligibility> {
  const [cat] = await exec.select({ id: catsTable.id, ownerDeviceId: catsTable.ownerDeviceId })
    .from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) return { ok: false, code: "NOT_MET" };
  if (cat.ownerDeviceId === deviceId) return { ok: "owner" };
  if (cat.ownerDeviceId !== null) return { ok: false, code: "ALREADY_HOMED" };

  const status = (await deriveCatStatuses([{ id: catId, ownerDeviceId: null }], exec)).get(catId)!;
  if (status.lifeStatus === "homed") return { ok: false, code: "ALREADY_HOMED" };
  if (status.lifeStatus !== "street") return { ok: false, code: "NOT_ON_STREET" };

  // §3 rule 2: a resolved sighting from this phone, of this cat or a cat merged
  // into it, still on the cat chosen at match time (or with no record, which is
  // `unlabelled`), matched in any way the app allows (D1).
  const met = await exec.execute<{ n: number }>(sql`
    select count(*)::int as n
      from sightings s
      left join sighting_matches m on m.sighting_id = s.id
     where s.device_id = ${deviceId}
       and s.status = 'resolved'
       and s.cat_id in (select ${catId} union select cat_id from cat_identity where canonical_cat_id = ${catId})
       and (m.sighting_id is null
            or (m.chosen_cat_id = s.cat_id
                and m.choice in ('suggested', 'hand_pick', 'new_cat', 'unlabelled')))
  `);
  return (met.rows[0]?.n ?? 0) > 0 ? { ok: true } : { ok: false, code: "NOT_MET" };
}

/** D11: within 1 km of the cat's PUBLIC position, never the exact one (review 2, HIGH-1). */
export function pinWithinReach(cat: { lat: number; lng: number }, pin: { lat: number; lng: number }): boolean {
  const centre = blurPosition(cat.lat, cat.lng);
  return haversineKm(centre, pin) * 1000 <= CLAIM_PIN_REACH_M;
}

/** The owner's newest homed statement that nothing supersedes yet, or null. */
export async function newestActiveOwnerHomed(exec: DbOrTx, catId: number, deviceId: string | null): Promise<number | null> {
  const r = await exec.execute<{ id: number }>(sql`
    select o.id from observations o
     where o.cat_id = ${catId} and o.kind = 'life_status' and o.value->>'status' = 'homed'
       and o.authority_scope = 'owner_of_this_cat'
       and (${deviceId}::text is null or o.device_id = ${deviceId})
       and not exists (select 1 from observations x where x.supersedes_id = o.id)
     order by o.observed_at desc, o.id desc limit 1`);
  return r.rows[0]?.id ?? null;
}

/** §11: re-claiming the same cat within `days` of letting it go is refused. */
export async function letGoWithinDays(exec: DbOrTx, catId: number, deviceId: string, days: number): Promise<boolean> {
  const r = await exec.execute<{ n: number }>(sql`
    select count(*)::int as n from observations
     where cat_id = ${catId} and kind = 'life_status' and device_id = ${deviceId}
       and value = '{"withdrawn": true}'::jsonb
       and created_at > now() - make_interval(days => ${days})`);
  return (r.rows[0]?.n ?? 0) > 0;
}

/** Clears everything that made someone this cat's owner (§6, §7). */
export async function clearOwner(exec: DbOrTx, catId: number): Promise<void> {
  await exec.update(catsTable).set({
    ownerDeviceId: null, ownerName: null, homeDescription: null, homeLat: null, homeLng: null,
  }).where(eq(catsTable.id, catId));
}
```

Thread `exec` through `deriveCatStatuses(cats, exec = db)` and `loadCatRecords(catIds, exec = db)`, replacing each `db.` with `exec.` inside them (review 1, F15).

- [ ] **Step 4: Run the tests, plus the catHelpers and observations suites, and confirm they pass**

Run: `npx vitest run src/lib/claiming.test.ts src/lib/catHelpers.derivedStatus.test.ts src/lib/observations.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "SYC-130: claimEligibility, the pin's reach, and clearing an owner"
```

---

### Task 4: The claim route, `canClaim`, and the owner-only note and pin

**Files:**
- Modify: `artifacts/api-server/src/routes/cats.ts`, `artifacts/api-server/src/lib/catHelpers.ts` (the serialiser), `artifacts/api-server/src/middlewares/rateLimit.ts`, `lib/api-spec/openapi.yaml`, and the generated clients
- Test: `artifacts/api-server/src/routes/cats.claim.v2.test.ts`; update `routes/cats.claim.test.ts` to the new body, keeping its idempotency and race tests

**Interfaces:**
- Consumes: Task 3's exports and `verifyDeviceSecret`/`deviceSecretMatches` (`lib/deviceAuth.ts`).
- Produces:
  - **OpenAPI `CatClaim`:** `{ deviceId: string; livesOnSyros: true; livesInMyHome: true; homePin: { lat: number; lng: number }; homeNote?: string ≤ 200 }`.
  - **`CatDetail.canClaim`:** a boolean, true only for a proven device that `claimEligibility` passes.
  - **`Cat.homePin`:** `{ lat, lng } | null`, owner tier only.
  - **`Cat.homeDescription`:** owner tier only; null otherwise.
  - **`checkClaimLimit(deviceId: string): boolean`:** 5 per 24 h.

- [ ] **Step 1: Write the failing route tests**

These are the essential cases. Each seeds a street cat plus a qualifying sighting through the helpers in Task 3's test, using a new device id and secret per test:

```ts
const body = (deviceId: string, over: Record<string, unknown> = {}) => ({
  deviceId, livesOnSyros: true, livesInMyHome: true,
  homePin: blurPosition(37.4441, 24.9412), homeNote: "Blue door", ...over,
});
const claim = (catId: number, d: { id: string; secret: string }, over = {}) =>
  request(app).post(`/api/cats/${catId}/claim`).set("X-Device-Secret", d.secret).send(body(d.id, over));

it("claims, writes homed, links the owner, stores the pin and note", async () => { /* 200; cats.owner_device_id = d.id; home_lat set; one homed observation */ });
it("NOT_MET 403 before anything about the pin, whatever pin is sent", async () => {
  const res = await claim(c.id, stranger, { homePin: { lat: 0, lng: 0 } });
  expect(res.status).toBe(403); expect(res.body.code).toBe("NOT_MET");
});
it("NOT_CONFIRMED 422 when either box is missing", async () => { /* livesOnSyros: false → 422 NOT_CONFIRMED; same for livesInMyHome */ });
it("PIN_TOO_FAR 422 with no distance or direction in the body", async () => {
  const res = await claim(c.id, d, { homePin: { lat: 37.47, lng: 24.94 } });
  expect(res.status).toBe(422); expect(res.body).toEqual({ error: expect.any(String), code: "PIN_TOO_FAR" });
});
it("400 for a pin that isn't a position", async () => { /* homePin: { lat: 200, lng: 0 } → 400 */ });
it("same owner again: 200, no second observation, no push", async () => { /* … */ });
it("first claim pushes without the note; a later claim of the same cat after let-go pushes nothing", async () => { /* spy sendPushNotification; body has no "Blue door" */ });
it("public payload never has homeDescription or homePin; the owner's does", async () => { /* GET /cats/:id with and without X-Device-Id + secret */ });
it("canClaim is true only for a proven device that may claim", async () => { /* no headers → false; stranger proven → false; met device proven → true */ });
it("the 6th attempt in 24 h is 429, refusals included", async () => { /* 5 NOT_CONFIRMED then a valid one → 429 */ });
it("the claim body is never logged", async () => { /* capture logs as me.delete.test.ts does; no "Blue door", no home_lat value */ });
```

Write each body in full, following `routes/me.delete.test.ts` (#97) for seeding, log capture and the push spy.

- [ ] **Step 2: Run the tests, and confirm they fail**

Expected: FAIL, because the old body schema is still in place.

- [ ] **Step 3: Implement**

1. **The OpenAPI spec.** Replace the `CatClaim` schema. Add `homePin` (nullable) to `Cat` and `canClaim` (boolean) to `CatDetail`. Document 403, 409, 422 and 429 with `code`. Regenerate: `pnpm --filter @workspace/api-spec run codegen`.
2. **The rate limit.** In `rateLimit.ts`, add `checkClaimLimit`, a copy of the `checkDeviceMatchLimit` pattern with `CLAIM_LIMIT = 5` and `CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000`, with its own map, sweep and `_resetClaimLimitForTests`.
3. **The serialiser.** In `serialiseCat`, the `exact` branch already decides the owner tier. Set:
   ```ts
   homeDescription: exact ? cat.homeDescription : null,
   homePin: exact && cat.homeLat !== null && cat.homeLng !== null ? { lat: cat.homeLat, lng: cat.homeLng } : null,
   ```
   Add `homeLat` and `homeLng` to `CatSource`. Every caller passes them from the row.
4. **The claim route**, in this order:
   ```ts
   router.post("/cats/:catId/claim", async (req, res) => {
     const catId = Number(req.params.catId); if (!Number.isInteger(catId)) return void res.status(404).json({ error: "Not found" });
     const parsed = ClaimCatBody.safeParse(req.body);           // homePin lat ∈ [-90,90], lng ∈ [-180,180]
     if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });
     const body = parsed.data;
     if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;
     if (!checkClaimLimit(body.deviceId)) return void res.status(429).json({ error: "Too many requests. Please try again later.", code: "CLAIM_LIMIT" });
     const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
     if (!cat) return void res.status(404).json({ error: "Not found" });

     const pre = await claimEligibility(db, { catId, deviceId: body.deviceId });
     if (pre.ok === "owner") return void res.json(await catPayload(cat, await sightingsCountFor(catId), new Date(), { tier: "owner", deviceId: body.deviceId }));
     if (pre.ok === false) return void res.status(pre.code === "NOT_MET" ? 403 : 409).json({ error: REFUSAL_TEXT[pre.code], code: pre.code });
     if (body.livesOnSyros !== true || body.livesInMyHome !== true) return void res.status(422).json({ error: REFUSAL_TEXT.NOT_CONFIRMED, code: "NOT_CONFIRMED" });
     if (!pinWithinReach(cat, body.homePin)) return void res.status(422).json({ error: REFUSAL_TEXT.PIN_TOO_FAR, code: "PIN_TOO_FAR" });
     const note = (body.homeNote ?? "").trim().slice(0, 200) || null;
     if (note && containsOffensiveLanguage(note)) return void res.status(400).json({ error: "Home note contains offensive language", code: "OFFENSIVE_NOTE" });
     if (await letGoWithinDays(db, catId, body.deviceId, 7)) return void res.status(429).json({ error: "Too many requests. Please try again later.", code: "CLAIM_COOLDOWN" });

     const result = await db.transaction(async (tx) => {
       await tx.execute(sql`select id from cats where id = ${catId} for update`);
       const again = await claimEligibility(tx, { catId, deviceId: body.deviceId });   // §5: re-checked under the lock
       if (again.ok !== true) return again;
       const firstEver = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from observations where cat_id = ${catId} and kind = 'life_status' and authority_scope = 'owner_of_this_cat' and value->>'status' = 'homed'`)).rows[0]!.n === 0;
       const [row] = await tx.update(catsTable).set({
         ownerDeviceId: body.deviceId, homeDescription: note,
         homeLat: Number(body.homePin.lat.toFixed(5)), homeLng: Number(body.homePin.lng.toFixed(5)),
       }).where(eq(catsTable.id, catId)).returning();
       await writeObservation(tx, { catId, kind: "life_status", value: { status: "homed" }, deviceId: body.deviceId, roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: new Date() });
       return { ok: true as const, row: row!, firstEver };
     });
     if (result.ok !== true) return void res.status(result.ok === "owner" ? 200 : result.code === "NOT_MET" ? 403 : 409).json(result.ok === "owner" ? {} : { error: REFUSAL_TEXT[result.code], code: result.code });
     if (result.firstEver) void notifyCatSpotters(catId, body.deviceId, { title: `${result.row.name} has a home!`, body: `${result.row.name} now has a home.`, data: { type: "cat_claimed", catId } });
     res.json(await catPayload(result.row, await sightingsCountFor(catId), new Date(), { tier: "owner", deviceId: body.deviceId }));
   });
   ```
   `letGoWithinDays` comes from Task 3. `REFUSAL_TEXT` holds the English fallbacks from spec §4.4; the app shows its own translated line, chosen by `code`.

   **The owner's later edits to the note (PATCH).** Today `PATCH /cats/:catId` stores `homeDescription` without the offensive-language check. Add it (`containsOffensiveLanguage`, 400 `OFFENSIVE_NOTE`), and keep its push free of the note; it already is ("home details were updated"). Test both in `cats.claim.test.ts`'s PATCH cases.
5. **`canClaim`.** In `GET /cats/:catId`, read `X-Device-Id`. If `deviceSecretMatches(req, id)`, set `canClaim = (await claimEligibility(db, { catId, deviceId: id })).ok === true`; otherwise `false`. Add it to the response.
6. **Logging.** Confirm the request logger never logs bodies (`app.ts` `pinoHttp` `serializers.req`). The log test locks this in.

- [ ] **Step 4: Run the claim tests and the whole api-server suite, and confirm they pass**

Run: `npx vitest run src/routes/cats.claim.v2.test.ts src/routes/cats.claim.test.ts && npx vitest run`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "SYC-130: the claim checks who has met the cat, the confirmations and the home pin"
```

---

### Task 5: The owner lets go

**Files:**
- Modify: `artifacts/api-server/src/routes/cats.ts`, `lib/api-spec/openapi.yaml` (`POST /cats/{catId}/let-go`, `CatLetGo { deviceId }`), and the clients
- Test: `artifacts/api-server/src/routes/cats.letGo.test.ts`

**Interfaces:**
- Consumes: `newestActiveOwnerHomed`, `clearOwner`, `WITHDRAWN`.
- Produces: `POST /api/cats/:catId/let-go` → 200 with the public payload; 403 `NOT_OWNER`; 404.

- [ ] **Step 1: Write the failing tests**
  - The owner lets go. Afterwards:
    - the cat's link, note and pin are null;
    - a withdrawal supersedes the owner's `homed`;
    - `lifeStatus` is `street`;
    - with a team `in_care` recorded before the claim, it reads `in_care`;
    - no push is sent;
    - `GET /profiles/:id` no longer lists the cat in `ownedCatIds`.
  - A non-owner gets 403 `NOT_OWNER`, and nothing changes.
  - Re-claiming the same cat within 7 days gets 429 `CLAIM_COOLDOWN`. After 7 days it succeeds: set the withdrawal's `created_at` back 8 days in the test.
- [ ] **Step 2: Run them, and confirm they fail** (404 route).
- [ ] **Step 3: Implement**
  ```ts
  router.post("/cats/:catId/let-go", async (req, res) => {
    const catId = Number(req.params.catId); if (!Number.isInteger(catId)) return void res.status(404).json({ error: "Not found" });
    const body = LetGoCatBody.parse(req.body);
    if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;
    const done = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from cats where id = ${catId} for update`);
      const [cat] = await tx.select().from(catsTable).where(eq(catsTable.id, catId));
      if (!cat) return "missing" as const;
      if (cat.ownerDeviceId !== body.deviceId) return "not_owner" as const;
      const homedId = await newestActiveOwnerHomed(tx, catId, body.deviceId);
      if (homedId !== null) {
        await writeObservation(tx, { catId, kind: "life_status", value: WITHDRAWN, deviceId: body.deviceId, roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: new Date(), supersedesId: homedId, supersedeReason: "owner: doesn't live with me any more" });
      }
      await clearOwner(tx, catId);
      return "ok" as const;
    });
    if (done === "missing") return void res.status(404).json({ error: "Not found" });
    if (done === "not_owner") return void res.status(403).json({ error: "Only the cat's owner can do this", code: "NOT_OWNER" });
    const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    res.json(await catPayload(cat!, await sightingsCountFor(catId), new Date(), PUBLIC_VIEWER));
  });
  ```
- [ ] **Step 4: Run the tests, and confirm they pass.**
- [ ] **Step 5: Commit** `SYC-130: an owner can say the cat doesn't live with them any more`.

---

### Task 6: The team removes an owner

**Files:**
- Modify: `artifacts/api-server/src/lib/capabilities.ts` (add `"remove_owner"` after `"set_life_status"`), `lib/teamCatView.ts`, `lib/teamPages/catPages.ts`, `routes/teamCorrections.ts`, `lib/teamCorrections.ts` (`recordTeamStatement` accepts an optional `exec`)
- Test: `artifacts/api-server/src/routes/team.removeOwner.test.ts`

**Interfaces:**
- Produces:
  - `TeamCatView.owner: { has: boolean; homeDescription: string | null; homePin: { lat: number; lng: number } | null }`. `homePin` is filled only when the viewer can `view_exact_location`.
  - `POST /api/team/cats/:id/remove-owner`, a form with `status` (`street` | `in_care` | `deceased`, default `street`), `reason` and an optional `date`.

- [ ] **Step 1: Write the failing tests.** Follow `routes/team.corrections.test.ts` (sign-in fixtures, origin header, 303 redirect):
  - **The team page shows "Has an owner" and the note,** and shows the pin only to someone with `view_exact_location`. It never shows the device id.
  - **Remove owner** clears the link, note and pin. It supersedes the owner's newest active `homed` with a staff withdrawal, records the chosen status as a team statement signed by the person, and sends no push. The old owner's `GET /cats/:id` with secret no longer has `locationPrecision: "exact"`.
  - **An owner with no `homed` row** (a legacy claim): Remove owner still clears the link and records the chosen status.
  - **Permissions:** without `remove_owner` (stub `can`), or without `set_life_status`, the action is refused and nothing changes.
  - **The life-status form on an owned cat** has the checkbox "Also remove the owner", ticked by default. Saving "Lives on the street" with it ticked does both.
- [ ] **Step 2: Run them, and confirm they fail.**
- [ ] **Step 3: Implement**
  - **`teamCatView`:** select `ownerDeviceId`, `homeDescription`, `homeLat` and `homeLng`. Fill `owner`, and fill `homePin` only when `can(person, "view_exact_location")`. Pass the person in, as the page already does for its forms.
  - **`catPages.ts`:** in "What the records say", add a row "Owner": "Has an owner" or "No owner". When there is an owner, add "Where the owner says the cat lives" (the note), and "Home pin" via `place(lat, lng)` when present.
  - **`correctionForms`:** when `v.owner.has && may("remove_owner") && may("set_life_status")`, add:
    ```ts
    forms.push(
      `<details><summary>Remove owner</summary><form method="post" action="${base}/remove-owner">` +
        '<p class="hint">Ends this claim. The owner stops seeing the exact spot and getting alerts. Nobody is told.</p>' +
        '<fieldset><legend class="label">The cat now…</legend>' + lifeChoices("status", "ro", "street", ["street", "in_care", "deceased"]) + "</fieldset>" +
        dateInput("ro-date", "Date the team knows of", "(needed for “No longer with us”)") + reasonInput("ro-why") +
        '<button type="submit">Remove owner</button></form></details>',
    );
    ```
    Extend `lifeChoices` with an optional allowed-values list, defaulting to all four.
  - **The route:** `formRoute("remove_owner")`, then also require `can(person, "set_life_status")`. In one transaction:
    1. lock the cat;
    2. `newestActiveOwnerHomed(tx, catId, null)`, and if there is one, write a staff withdrawal superseding it (`accountId: person.id`, `roleAtTime: "staff"`);
    3. `clearOwner(tx, catId)`;
    4. `recordTeamStatement(person, { catId, kind: "life_status", value: { status }, reason, observedAt }, tx)`.

    Then 303 to `catPage(catId, "life")`.
  - **The life-status form:** when the cat has an owner, render `<label class="choice"><input type="checkbox" name="removeOwner" value="1" checked> Also remove the owner</label>`. When it's ticked and the status isn't `homed`, the route runs the same transaction as Remove owner.
- [ ] **Step 4: Run them, and confirm they pass.** Also run `team.corrections.test.ts` and `team.cats.test.ts`.
- [ ] **Step 5: Commit** `SYC-130: the team can see an owner and remove one`.

---

### Task 7: Remove the register-without-spotting route

**Files:**
- Modify:
  - `artifacts/api-server/src/routes/cats.ts` (delete `router.post("/cats", …)`);
  - `lib/api-spec/openapi.yaml` (delete `registerCat` and `CatRegistration`), then regenerate;
  - `artifacts/cat-spotter/lib/i18n.ts` (delete the unused register keys at lines ~71, 460 and 837 in en, el and fr);
  - the tests that use it as a fixture: `cats.register.test.ts` (delete), `cats.moderation.test.ts`, `cats.deviceAuth.test.ts`, `cats.foldedNames.test.ts`, `publicPayload.blur.test.ts`, #97's `me.delete.test.ts` (it sends `POST /api/cats` in test 7, so change that to assert 404), and SYC-3's `keepSafe.takeover.test.ts` (its moved-phone probe list has a `POST /cats` row; delete that row, because the list test checks every device-secret check in `routes/*.ts` has a probe and the route will be gone);
  - the docs: `docs/SPEC.md:159`, `threat_model.md:44`.

**Interfaces:** none new. The fixtures switch to direct `db.insert(catsTable)`.

- [ ] **Step 1:** For each fixture use, replace the `POST /api/cats` call with a direct insert of the same fields, and keep each test's assertion. Run each file. It passes against the old route, because nothing has been removed yet.
- [ ] **Step 2:** Delete the route and the OpenAPI entry, then regenerate. Add the test `POST /api/cats → 404` to `cats.claim.v2.test.ts`.
- [ ] **Step 3:** Run the whole api-server suite and every typecheck (`npx tsc --build`, then each package's `typecheck`). Expected: green.
- [ ] **Step 4:** Commit `SYC-130: remove the register-without-spotting route (D7)`.

---

### Task 8: The app

**Files:**
- Modify:
  - `artifacts/cat-spotter/components/ClaimCatSheet.tsx`;
  - `artifacts/cat-spotter/app/cat/[id].tsx`;
  - `artifacts/cat-spotter/context/DeviceContext.tsx`;
  - `artifacts/cat-spotter/lib/i18n.ts`.
- Tests:
  - `components/__tests__/ClaimCatSheet.test.tsx` (new);
  - `components/__tests__/CatPageClaim.test.tsx` (new);
  - `context/__tests__/DeviceContext.ownedCats.test.tsx` (new).

**Interfaces:**
- Consumes: the regenerated `useClaimCat` (new body), `useLetGoCat`, `CatDetail.canClaim`, `Cat.homePin`, and `LocationPicker` (`{ latitude, longitude, onChange }`).

- [ ] **Step 1: Add the strings** (en verbatim from spec §4.2–§4.4 and §6; el and fr drafts, French in "tu"; Greek and French "Adopt" removed):
  ```ts
  claimCat: 'This is my cat',
  claimNotMetHint: 'Is this your cat? Spot {name} with the camera first, then you can say {name} lives with you.',
  claimConfirmTitle: 'Is {name} your cat?',
  claimConfirmBody: 'Only say yes if you live on Syros and {name} is yours: {name} lives with you, and you’re the one who gives {name} food, water and care every day.',
  claimGuardianLine: 'Looking after street cats? That makes you a cat guardian, not an owner, so please don’t say yes here.',
  claimTrustLine: 'Everyone using the app will see that {name} has a home. We trust our community: if {name} turns out not to be yours, Syros Cats will take this off.',
  claimLiveOnSyros: 'I live on Syros',
  claimYes: 'Yes, {name} lives with me',
  claimWhereTitle: 'Where does {name} live?',
  claimWhereHint: 'Put the pin on your home, or',
  claimUseHere: 'Use where I am now',
  claimNoteLabel: 'Anything else that helps find {name}?',
  claimNotePlaceholder: 'e.g. the blue house by the church',
  claimPrivateLine: 'Only you and Syros Cats will see the pin and the note.',
  claimDone: 'Done',
  claimRefusedNotMet: 'Spot {name} with the camera first, then you can say {name} lives with you.',
  claimRefusedHomed: '{name} already has a home.',
  claimRefusedNotStreet: '{name} can’t be marked as yours right now.',
  claimRefusedTooFar: 'That’s a long way from where {name} is usually seen. Move the pin to where {name} lives. If {name} really lives there, write to Syros Cats.',
  claimRefusedNotConfirmed: 'Only people who live on Syros can say a cat lives with them.',
  claimRefusedLater: 'Please try again later.',
  claimNeedsConnection: 'You need a connection to do this.',
  letGo: '{name} doesn’t live with me any more',
  letGoConfirm: '{name} will no longer show as having a home, and you won’t be {name}’s owner in the app.',
  claimNewPhone: 'Got a new phone? Ask Syros Cats to remove the old owner, then you can say {name} lives with you again.',
  ```
- [ ] **Step 2: Write the failing component tests**
  - **`ClaimCatSheet`, screen 1:** "Yes" is disabled until "I live on Syros" is ticked, and Cancel calls `onClose`.
  - **`ClaimCatSheet`, screen 2:** "Done" is disabled until the pin has been placed. That means `onChange` firing from the picker, or "Use where I am now" with a mocked location.
  - **The request:** `useClaimCat` is called with `{ deviceId, livesOnSyros: true, livesInMyHome: true, homePin, homeNote }`.
  - **Refusals:** each `code` (`NOT_MET`, `ALREADY_HOMED`, `NOT_ON_STREET`, `PIN_TOO_FAR`, `NOT_CONFIRMED`, 429) shows its line.
  - **The cat page:**
    - `canClaim: true` shows the button;
    - a street cat with `canClaim: false` shows the hint line;
    - a homed cat shows neither;
    - offline, the button is disabled with the connection line.
  - **The owner's edit sheet** shows "{name} doesn't live with me any more", confirms, and calls `useLetGoCat`.
  - **`DeviceContext`:** online, a server profile without a cat removes it from `ownedCatIds` and from storage.
  - **No pronouns:** the en strings above contain no `\b(he|she|her|him|his)\b`. Assert it with a regex in `i18n.test.ts`.
- [ ] **Step 3: Implement**
  - **`ClaimCatSheet` claim mode** becomes two screens, held in local state (`step: 1 | 2`).
    - Screen 1 shows `claimConfirmBody`, `claimGuardianLine`, `claimTrustLine`, a checkbox `claimLiveOnSyros`, and the buttons.
    - Screen 2 shows `LocationPicker`, starting at the cat's public `lat`/`lng`, with `onChange` setting `pin` and `pinPlaced = true`.
    - It also has a "Use where I am now" button (expo-location `getCurrentPositionAsync`; on web, `navigator.geolocation`), the note input, `claimPrivateLine`, and Done (disabled until `pinPlaced`).
    - **The pre-check:** if `haversineKm(blurPosition(cat), pin) > 1` using the cat's public position, which is exactly what the server measures, show `claimRefusedTooFar` and don't send. Import `haversineKm` from `@workspace/geo`, and compare against the cat's own public `lat`/`lng`, which is already the cell centre.
    - **Edit mode** keeps the note editor and adds the `letGo` button, with its confirmation, which calls `useLetGoCat`. On success it removes the id from `ownedCatIds`.
  - **The cat page.** Always send `X-Device-Id` on the detail request; the secret is attached automatically. Then:
    - show the button when `data.canClaim`;
    - show the hint line when `!cat.hasHome && !data.canClaim`;
    - use `useOffline().isOnline` for the disabled state;
    - show `claimNewPhone` under "Has a home" when `!isOwner`.

    The `isClaimed` and `isOwner` logic stays.
  - **`DeviceContext`:** when the profile loads online, replace the owned list with `profile.ownedCatIds` (don't merge) and save it. The local list stays only as the offline fast start.
- [ ] **Step 4: Run the app suite and typecheck, and confirm they pass.**
- [ ] **Step 5: Commit** `SYC-130: "This is my cat" in two screens, letting go, and owned cats from the server`.

---

### Task 9: Deletion keeps the note and pin (D13)

**Files:**
- Test: add to `artifacts/api-server/src/routes/me.delete.test.ts` (#97)

- [ ] **Step 1: Write the test.** A claimed cat with a note and pin, whose owner deletes their data:
  - **Cleared:** `owner_device_id` and `owner_name`.
  - **Kept:** `home_description`, `home_lat` and `home_lng`.
  - **The public payload** has neither.
  - **The team view** shows the note, and the pin to someone with `view_exact_location`.
  - **Afterwards,** another phone that met the cat gets `ALREADY_HOMED`.
  - **The whole-database scan** still finds no trace of the device id.
- [ ] **Step 2: Run it.** It should pass without any code change, because `severPerson` only clears the owner link and name. If it fails, fix `severPerson`, not the test.
- [ ] **Step 3: Commit** `SYC-130: deletion keeps the home note and pin for the team (D13)`.

---

### Task 10: Mutation probes, the browser check, and the PR

- [ ] **Step 1: Run the mutation probes.** Copy the SYC-63 scratchpad harness pattern (break, run the named file, restore). Each must turn a named test red:

| Break | Expected failing test |
|---|---|
| remove the "met it" `exists` clause (always ok) | `claimEligibility` NOT_MET, `cats.claim.v2` NOT_MET |
| check only `ownerDeviceId`, not the derived status | ALREADY_HOMED after deletion (Task 9), NOT_ON_STREET |
| measure the pin from the exact `cat.lat/lng` instead of `blurPosition` | `pinWithinReach` boundary test |
| move the pin check before `claimEligibility` | "NOT_MET before anything about the pin" |
| drop `homeDescription: exact ? … : null` | "public payload never has homeDescription" |
| drop `clearOwner` from Remove owner | Remove owner: exact spot gone |
| drop the `firstEver` guard | "a later claim … pushes nothing" |
| let the withdrawal skip its supersedes check | "refuses a withdrawal with nothing to supersede" |

- [ ] **Step 2: Check it by hand,** with a local API and Postgres, plus the web build in the browser pane at 390 px and at desktop:
  - claim as a phone that has met the cat (both screens, the pin, "Use where I am now");
  - try as one that hasn't (the hint line);
  - try a pin too far away;
  - let go;
  - on the team dashboard, see "Has an owner", the note and the pin, use Remove owner, and confirm the old owner's exact spot is gone.
- [ ] **Step 3: Get the Greek and French reviewed.** Add the new keys to SYC-4.
- [ ] **Step 4: Open the PR.** Rebase onto main, run every suite (api-server, app, `lib/db`, `migrate:check`), and open the PR with the probe table and screenshots. Mark SYC-130 In Review.

---

## Model delegation

This session runs on Opus. Each package below runs as a subagent in its own worktree. Each commits after every step and keeps a `CHECKPOINT.md`. None spawns another agent.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1: the home pin columns and migration | Sonnet | Mechanical schema plus generated SQL, with a clear pattern (#97's migration) | `migrate:check`; the migration test; rollback cycle via `pnpm --filter @workspace/db test` |
| Task 2: the withdrawal | **Opus** | Changes what `writeObservation` accepts on the append-only record. A wrong rule either blocks every let-go or lets anything be "withdrawn" | Tests, plus the **mutation probe** "skip its supersedes check"; diff spot review by the session model |
| Task 3: `claimEligibility`, `pinWithinReach`, threading `exec` | **Opus** | The privacy-critical rule. A wrong join lets strangers claim; a wrong distance basis leaks exact positions (review 2, HIGH-1) | Tests; **mutation probes** (rows 1–4 of the Task 10 table); an adversarial review by a separate Sonnet critic in its own worktree |
| Task 4: the claim route, `canClaim`, the owner-only fields, the rate limit | **Opus** | Order of checks, transaction and lock, first-claim push, no-oracle refusals: silent-failure territory | Tests; **mutation probes** (rows 4, 5, 7); the log test; the critic as above |
| Task 5: letting go | Sonnet | Clear spec, and it reuses Task 3's helpers | Tests; diff spot review by the session model |
| Task 6: the team side | Sonnet | Server-rendered forms following #99's patterns exactly | Tests; **mutation probe** (row 6); a browser check of the dashboard |
| Task 7: removing `POST /cats` | Haiku | Mechanical deletion and fixture rewrites across known files | Full api-server suite plus every typecheck; a diff spot review that no assertion was weakened |
| Task 8: the app screens, strings and owned cats | Sonnet | Standard React Native with a clear spec and existing components | Tests; the pronoun regex; the browser check at 390 px and desktop; the copy diffed word for word against spec §4 |
| Task 9: the deletion test | Sonnet | One test against #97 | The test itself, and the whole-database scan staying green |
| Task 10: probes, the browser check, final review | Opus (session), plus a **Sonnet critic** in its own worktree for the adversarial pass at `/ship` | Synthesis and judgment | The probe table; the browser pass; the critic's findings folded in before merge |

**Every place the invariant must hold.** "Only an eligible phone becomes an owner, and the note and pin never leave the owner and the team." These are the consumers, and each is covered by a task:
1. the claim route (Task 4);
2. `canClaim` on the detail (Task 4);
3. `serialiseCat`, for both `homeDescription` and `homePin` (Task 4);
4. `listCatsWithStats`, which uses the same serialiser at the public tier (Task 4's public-payload test covers the list too: add a `GET /cats` assertion);
5. the resolve response's inline cat, which is the public tier (same test, via a resolve);
6. the claim push (Task 4);
7. the PATCH owner edit, which gains the note check it lacks today and must never push the note (Task 4);
8. the team cat view and page (Task 6);
9. `severPerson` (Task 9);
10. the request logs (Task 4).

## Order and dependencies

The order is #97 merged, then Task 1, then 2, then 3, then 4. Tasks 5, 6 and 7 can run in parallel after Task 4. Task 8 needs Tasks 4, 5 and 7 (the regenerated client). Task 9 needs #97 and Task 4. Task 10 comes last.

**Production.** The migration goes through `db-ops` migrate **before** the server code is published. It is additive, so old code is unaffected.
