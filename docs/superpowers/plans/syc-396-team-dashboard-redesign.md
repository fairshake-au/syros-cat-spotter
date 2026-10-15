# Team dashboard redesign: implementation plan (phases 0 and 1 in detail)

**Status:** Approved by Samuel, 15 October 2026.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after every task, and write a checkpoint line to `PROGRESS.md` in your worktree after every task (what's done, what's next). Never hold work only in memory.**

**Goal:** Build the approved team dashboard redesign. The team finds cats by look and place, sees every cat on one island map, plans trapping rounds, and gets honest reports. This plan covers phase 0 (SYC-395) and phase 1 step by step, and phases 2–5 as an outline.

**Architecture:**
- **Pages.** It stays the server-drawn Express dashboard in `artifacts/api-server`. Every page works with no script.
- **Scripts.** Small first-party scripts (a Leaflet map, instant filters) are served from our own server, on four pages only, under a page-specific security header.
- **Data.** Everything is worked out from the observation records on each request. There's no stored status.

**Tech stack:**
- TypeScript, Express, Drizzle ORM on Postgres (Neon), and Vitest with a throwaway test database.
- `sharp` (already a dependency) for photo versions.
- Leaflet 1.9.4, vendored and served first-party.

**Spec:** `docs/specs/team-dashboard-redesign.md` (approved by Samuel, 15 Oct 2026). Read it with this plan. Section numbers below (§) refer to it.

**Linear:** SYC-396 is the parent. SYC-395 is phase 0.

## Global constraints

Every task's requirements include these.

**Words and facts**
- Sterilisation costs €50–60 per cat. The default standard price is €55.
- The terms are "cat guardian" and "spotter". Never "colony carer" or "snapper".
- Team pages are English only (Decision 12). Words used by guardian-shared pages go in `lib/teamPages/strings/{en,el,fr}.ts`. `strings.test.ts` enforces key parity across the three.
- No text below 12px.
- The same thing is always worded the same way, e.g. "Last seen 3 days ago".

**Privacy and security**
- No position, and no person's or colony's name, ever appears in one of our own web addresses.
- The one exception is D9's outbound **Open map** link. It's built only by `lib/teamPages/position.ts`, and shown only when `isIslandWide(person)` (from `lib/guardianView.ts`, which arrives with #194).
  - Never `visibleColonyIds(person) === null`, which is always false on #194.
  - Never for cat guardians, never on an owner's home position, never in anything public.
- Map pictures always come through our own server. The server never logs which map square was asked for (add any new picture path to `MAP_TILE_IN_PATH` in `lib/logger.ts`).
- Every team route is declared with `requireTeam(cap)`, or `...formRoute(cap)` for a POST. It calls `setTeamHeaders(res)` before any `await`, and has a row in `routes/team.walk.test.ts` `TABLE`.
- No reader of sites or colonies may skip the colony filter (`lib/guardianView.source.test.ts`, from #194).

**Sterilisation marks** (§12.2). These four marks mean sterilisation status and nothing else.

| State | Shape | Colour |
|---|---|---|
| Sterilised | filled circle | `#0a4d59` |
| Probably | half-filled circle | `#2f7884` |
| Not known | empty ring | `#6a949b` |
| Not sterilised | ring with a slash | `#a6540a` |

- Map dots carry a 2px light ring and a 1px dark outline.
- Feeding sites are **squares**, never circles and never teal.

**Tests**
- CI runs, in this order:
  - `pnpm --filter @workspace/db run migrate:check`;
  - `pnpm --filter @workspace/db test`;
  - `pnpm run typecheck:libs`;
  - `pnpm --filter @workspace/api-server run typecheck`;
  - `pnpm --filter @workspace/api-server test`.
- There is no lint step.
- **Running tests on the Mac.** Use the esbuild workaround: `ESBUILD_BINARY_PATH=<scratchpad>/package/bin/esbuild` (see memory `local-vitest-esbuild`). Set:
  - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/catspotter_test`;
  - `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9`;
  - `AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`.
- **Never run high-volume port or network loops.** Prove a network bug in a few requests.
- **Every guard against a silent failure gets a mutation probe:** break the site on purpose, watch a named test go red, then restore it. "Tests pass" is not enough for these guards (see Model delegation).

**Process**
- One PR per numbered PR below.
- Each PR runs in its own worktree, branched from fresh `origin/main`.
- Each PR gets an adversarial review before merge. Samuel merges.

---

## Sequencing and dependencies

```
#194 (SYC-209 PR 4.1, open) ──► PR 0.1 Retire confirm ──► PR 0.2 Open map links
#191 (SYC-2 PR 3.1, open)  ──► PR 1.3 Cats grid (colour words) ──► PR 1.4 cat page summary
PR 1.1 named areas ─┬─► PR 1.3 ─► PR 1.5 Map ─► PR 1.6 menu and shell
PR 1.2 photo sizes ─┘
```

- **PR 1.1 and PR 1.2 can start now,** in parallel. They touch no file that #191 or #194 changes.
- **PR 0.1 and PR 0.2 start once #194 merges.** The SYC-209 session will message when it does. #194 changes `words.ts` to the catalogue `t(key, lang?, vars?)` and rewrites `sitePages.ts`.
- **PR 1.3 and PR 1.4 start once #191 merges.** It adds the colour words and the Appearance section, and changes `TeamCatView`.
- **Before starting any PR,** re-read every signature it names on the then-current `origin/main`. If one has changed, update the task's code, not the intent.

## Decisions this plan makes (within the approved spec)

1. **The Map lives on the Cats page,** as `GET /api/team/cats?view=map`. The menu's "Map" item opens it. `GET /api/team/map` stays as the SYC-287 tap-check page, untouched with its tests. That honours §6.1 "one switch between Grid and Map, filters stay".
2. **Named areas ship read-only in phase 1.** `lib/areas/namedAreas.ts` holds version 1 of the list in code. The editable Areas page, the `edit_named_areas` capability and the history table come in phase 2. Until then, Syros Cats' corrections are made by a code change. *What the team sees:* places are named correctly from the start; editing the list arrives with Home.
3. **"Checked in person" waits for its record.** The guardian field check (`record_field_check`) exists as a capability, but nothing writes or reads it. Badges therefore show "Probably" without "checked in person" until a field-check record exists. That record is filed as a follow-up ticket; it's not built here.
4. **Scripts are served by `GET /api/team/assets/:file`.** The files are fixed and versioned by name (e.g. `dashboard-map.3f9a1c.js`), served `Cache-Control: public, max-age=31536000, immutable` with no session needed. Only files from a fixed allow-list are served.
5. **The security header becomes `setTeamHeaders(res, { scripts?: boolean })`.** The default stays byte-for-byte today's string. `scripts: true` adds `script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:`. Only the Cats (grid and map) and Reports pages pass it.
6. **Photo versions are made on first request,** stored in a new `photo_variants` table (migration 0027) with `ON DELETE CASCADE` from `photos`. Spec §11's "12-month shrink" and "remove_photo" have no code yet (checked 15 Oct). Hook points are left as comments in `photoVariants.ts`, which those features must call.
7. **The map picture limit is per person:** a new `sharedLimiter` bucket keyed by person id, 300 squares per 10 minutes.

---

## Phase 0: SYC-395 (starts after #194 merges)

### PR 0.1: "Are you sure?" before Retire this site

**What the team sees:** pressing "Retire this site" now shows a page with the site's name and Yes / Cancel. Pressing Yes again on an already-retired site says "This site is already retired."

#### Task 0.1.1: Retire confirm page

**Files:**
- Modify: `artifacts/api-server/src/routes/teamSites.ts` (the `POST /team/sites/:id/retire` handler, about `:598`)
- Modify: `artifacts/api-server/src/lib/teamSiteWrites.ts` (`retireSite` result: add `{kind:"already_retired"}`)
- Modify: `artifacts/api-server/src/lib/teamPages/strings/en.ts`, `el.ts`, `fr.ts` (new `sure.retire.*` keys)
- Test: `artifacts/api-server/src/routes/team.sites.test.ts` (new `describe("retire confirm")`)

**Interfaces:**
- Consumes:
  - `renderConfirmPage(o: ConfirmPageOptions): string` (`lib/teamPages/confirm.ts:34`).
  - `ReasonForm` (`routes/teamSites.ts:263`).
  - The site reader that takes a `Visible` (on #194, `siteView(visible, id)`; re-check the name).
- Produces: `ReasonForm` gains `confirm: z.literal("1").optional()`. `retireSite(...)` returns `Promise<Failure | {kind:"saved"} | {kind:"already_retired"}>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("retire confirm (SYC-395 D1)", () => {
  it("a browser POST without confirm shows the Are you sure page and retires nothing", async () => {
    const site = await seedFeedingSite({ name: "Kini steps — test" });
    const res = await form(`/api/team/sites/${site.id}/retire`, team.cookie)
      .send({ updatedAt: site.updatedAt.toISOString(), reason: "Bowls gone" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Retire Kini steps — test?");
    expect(res.text).toContain('name="confirm" value="1"');
    expect(res.text).toContain('name="reason" value="Bowls gone"');
    const [row] = await db.select().from(feedingSitesTable).where(eq(feedingSitesTable.id, site.id));
    expect(row.retiredAt).toBeNull();
  });

  it("with confirm=1 it retires the site", async () => {
    const site = await seedFeedingSite({ name: "Kini steps — test 2" });
    const res = await form(`/api/team/sites/${site.id}/retire`, team.cookie)
      .send({ confirm: "1", updatedAt: site.updatedAt.toISOString(), reason: "Bowls gone" });
    expect(res.status).toBe(303);
    const [row] = await db.select().from(feedingSitesTable).where(eq(feedingSitesTable.id, site.id));
    expect(row.retiredAt).not.toBeNull();
  });

  it("a second Yes says the site is already retired", async () => {
    const site = await seedFeedingSite({ name: "Kini steps — test 3" });
    const body = { confirm: "1", updatedAt: site.updatedAt.toISOString(), reason: "x" };
    await form(`/api/team/sites/${site.id}/retire`, team.cookie).send(body);
    const again = await form(`/api/team/sites/${site.id}/retire`, team.cookie).send(body).redirects(1);
    expect(again.text).toContain("This site is already retired.");
    expect(again.text).not.toContain("someone already changed this");
  });

  it("a missing site answers 404 before any confirm page", async () => {
    const res = await form(`/api/team/sites/999999999/retire`, team.cookie)
      .send({ updatedAt: new Date().toISOString(), reason: "x" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/team.sites.test.ts -t "retire confirm"`
Expected: FAIL. The first test gets 303, not 200.

- [ ] **Step 3: Add the words** to `strings/en.ts`, and the same keys to `el.ts` and `fr.ts` (English text is acceptable there until SYC-291, as the catalogue falls back):

```ts
"sure.retire.title": "Retire {name}?",
"sure.retire.line1": "It disappears from the map and the list. Its history stays.",
"sure.retire.line2": "You can bring it back later with Restore.",
"sure.retire.yes": "Yes, retire it",
"sure.cancel": "Cancel",
"site.alreadyRetired": "This site is already retired.",
```

- [ ] **Step 4: Implement**
  - In `retireSite`, return `{ kind: "already_retired" }` when `retiredAt !== null`, before the freshness check.
  - In the route:

```ts
const ReasonForm = z.object({ updatedAt: stampField, reason: reasonField, confirm: z.literal("1").optional() });

router.post("/team/sites/:id/retire", ...formRoute("edit_feeding_site"), async (req, res) => {
  const id = siteIdOf(req); if (id === null) return notFound(req, res);
  const parsed = ReasonForm.safeParse(req.body ?? {});
  if (!parsed.success) return badForm(req, res, id, fieldsOf(parsed.error));
  const person = teamPerson(res);
  const site = await siteView(visibleColonyIds(person), id);
  if (site === null) return notFound(req, res);
  if (isFormPost(req) && !parsed.data.confirm && site.retiredAt === null) {
    const { t } = wordsIn(pageLangFor(person));
    res.status(200).type("html").send(renderConfirmPage({
      title: t("sure.retire.title", undefined, { name: site.name }),
      lines: [t("sure.retire.line1"), t("sure.retire.line2")],
      action: `/api/team/sites/${id}/retire`,
      fields: { updatedAt: parsed.data.updatedAt, reason: parsed.data.reason },
      yes: t("sure.retire.yes"), cancelHref: `/api/team/sites/${id}`, cancelLabel: t("sure.cancel"),
      personName: person.name, active: "sites",
    }));
    return;
  }
  const out = await retireSite(person.id, id, parsed.data.updatedAt, parsed.data.reason);
  if (out.kind === "already_retired") return answer(req, res, id, back, out, { notice: "site.alreadyRetired" });
  answer(req, res, id, back, out, { saved: "retired" });
});
```

  If `answer()` has no `notice` option, add one that shows a catalogue key in the page's notice banner. Follow how `saved:` is shown today.

- [ ] **Step 5: Run the tests and see them pass.** Then run the whole of `team.sites.test.ts` and `strings/strings.test.ts`.
- [ ] **Step 6: Commit:** `git commit -m "SYC-395 PR 0.1: Are you sure? before Retire this site"`

### PR 0.2: Open map links for island-wide team members (D9)

**What the team sees:** every position on the dashboard (cat first-recorded spot, sightings, colony centre, feeding site, queue report, add and move pages) reads as 5 decimal places with an **Open map** link, for island-wide team members only. Cat guardians see the position (where they already may) with no link. The queue no longer needs the "near a feeding site" rule.

#### Task 0.2.1: Replace the map-link guard first (red before green)

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/positions.source.test.ts`
- Delete: `artifacts/api-server/src/lib/teamPages/noMapLinks.source.test.ts`, after the new test covers everything it did
- Modify: `artifacts/api-server/src/lib/teamPages/position.guard.source.test.ts` (`ALLOWED` grows as each file is converted)

- [ ] **Step 1: Write the new source test.** It scans both `lib/teamPages/` and `routes/` non-test `.ts` files.

```ts
const MAP_COMPANIES = ["google.com/maps", "maps.apple.com", "maps.google.", "goo.gl/maps", "geo:", "waze.com", "openstreetmap.org/?mlat"];
const RAW_PRINT = [/\.toFixed\(/, /\$\{[^}]*\blat\}\s*,\s*\$\{[^}]*\blng\}/, /\bfmtPos\(/];
const ALLOWED_RAW = new Set(["lib/teamPages/position.ts", "lib/mapTiles/geometry.ts"]);

for (const file of sourceFiles(["lib/teamPages", "routes"])) {
  it(`${file} prints positions only through position()`, () => {
    const src = read(file);
    if (file !== "lib/teamPages/position.ts")
      for (const m of MAP_COMPANIES) expect(src, `${file} names ${m}`).not.toContain(m);
    if (!ALLOWED_RAW.has(file))
      for (const re of RAW_PRINT) expect(re.test(src), `${file} prints a raw position (${re})`).toBe(false);
  });
}
```

- [ ] **Step 2: Run it.** Expected: FAIL, naming each file that prints positions today:
  - `catPages.ts` (`place()`);
  - `colonyPages.ts:123,252`;
  - `sitePages.ts` and `siteFormPages.ts` (`fmtPos`);
  - `queuePage.ts:91-100`;
  - `routes/teamMap.ts:45`.

  That list is this PR's to-do list.
- [ ] **Step 3: Commit the failing test on its own,** so the reviewer sees red before green: `git commit -m "SYC-395 PR 0.2: positions source test (red)"`.

#### Task 0.2.2: Convert every position print, one file per commit

**Files:**
- Modify: `catPages.ts`, `colonyPages.ts`, `sitePages.ts`, `siteFormPages.ts`, `queuePage.ts`, `routes/teamMap.ts` and `routes/team.ts`.
- Each page's render options gain `island: boolean`, which the route passes as `isIslandWide(person)`.

**Interfaces:**
- Consumes: `position(lat, lng, { link }): string` (trusted HTML) and `isIslandWide(person): boolean`.
- Produces: every page renderer that prints a position takes `island: boolean` in its options.

For each file:

- [ ] **Step 1:** Replace the raw print with `position(lat, lng, { link: island })`. Never pass `link: true` for `cat.homeLat/homeLng` (the owner's home, D5). Pass `{ link: false }` there, always.
- [ ] **Step 2:** Add the file to `ALLOWED` in `position.guard.source.test.ts`, using a path relative to `src/`, e.g. `"lib/teamPages/catPages.ts"`.
- [ ] **Step 3:** Run `positions.source.test.ts`, the file's route tests and `position.test.ts`. Update tests that asserted raw unrounded coordinates (e.g. `team.cats.test.ts` seeds `37.4451234`) to the 5-decimal form `37.44512`.
- [ ] **Step 4:** Commit: `git commit -m "SYC-395 PR 0.2: <file> prints positions through position()"`.

**For `queuePage.ts` and `routes/team.ts`:**
- Delete the `NearSites` type, the `near` parameters and the call to `queueNearFeedingSites`.
- Delete `queueNearFeedingSites` from `lib/welfareQueue.ts`, and its tests in `team.queuePage.test.ts:484-490`.
- Keep `lib/feedingSiteProximity.ts`, because the alert email uses it (SYC-385).

#### Task 0.2.3: Guardian-view tests and the gate probe

**Files:**
- Modify: `artifacts/api-server/src/routes/team.guardianView.test.ts`. It already has `MAP_COMPANIES` (a regex) and Eleni's pages. Add the new assertions there.

- [ ] **Step 1: Write the tests.**

```ts
it.each(["/api/team/sites", `/api/team/sites/${eleniSite.id}`, "/api/team/colonies", `/api/team/colonies/${eleniColony}`])(
  "a cat guardian's %s has no map-company address", async (path) => {
    const res = await get(path, eleni.cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(MAP_COMPANIES);
  });

it.each(["/api/team/sites", `/api/team/colonies/${eleniColony}`, `/api/team/cats/${cat.id}`])(
  "an island-wide team member's %s has Open map links", async (path) => {
    const res = await get(path, team.cookie);
    expect(res.text).toMatch(/google\.com\/maps\/search\/\?api=1/);
  });

it("an owner's home position never has a link, even for the team", async () => {
  const owned = await seedOwnedCat({ homeLat: 37.44, homeLng: 24.94 });
  const res = await get(`/api/team/cats/${owned.id}`, team.cookie);
  expect(res.text).not.toContain(encodeURIComponent("37.44000,24.94000"));
});
```

- [ ] **Step 2: Mutation probe (required).** Temporarily change one shared page's `island` argument to `true`, then run the guardian test. It **must** go red. Restore. Record the probe's output in the PR description.
- [ ] **Step 3: Second probe.** Add one stray `lat.toFixed(5)` to `colonyPages.ts`. `positions.source.test.ts` **must** go red. Restore.
- [ ] **Step 4: Delete `noMapLinks.source.test.ts`.** The new test covers it, plus `routes/`.
- [ ] **Step 5: Update the docs** these links reverse:
  - `docs/specs/feeding-sites-and-colonies.md` §2.3 and Decision 2;
  - `docs/specs/claiming-a-cat.md` §7;
  - a new `threat_model.md` entry: "Outbound Open map links (D9, 15 Oct 2026): a position goes to Google when an island-wide team member taps; never for guardians, owners' homes or the public."
- [ ] **Step 6: Commit:** `git commit -m "SYC-395 PR 0.2: guardian-view tests, gate probes, docs"`

---

## Phase 1: find cats by look and place, and see them on a map

### PR 1.1: Named areas and place labels (can start now)

**What the team sees:** nothing on its own. It's the "where" that every later screen uses.

#### Task 1.1.1: The named-areas list and nearest-centre lookup

**Files:**
- Create: `artifacts/api-server/src/lib/areas/namedAreas.ts`
- Test: `artifacts/api-server/src/lib/areas/namedAreas.test.ts`

**Interfaces:**
- Produces:

```ts
export interface NamedArea { key: string; name: string; lat: number; lng: number }
export const AREAS_VERSION = 1;
export const NAMED_AREAS: readonly NamedArea[];
export const OFF_SYROS = { key: "off", name: "Off Syros" } as const;
export function areaFor(lat: number, lng: number): NamedArea | typeof OFF_SYROS;
export function areaByKey(key: unknown): NamedArea | undefined;
```

- [ ] **Step 1: Write the failing test**

```ts
import { areaFor, areaByKey, NAMED_AREAS, OFF_SYROS } from "./namedAreas";

describe("named areas (spec §3.3)", () => {
  it("puts a point in the area whose centre is nearest", () => {
    expect(areaFor(37.4447, 24.9417).key).toBe("ermoupoli");
    expect(areaFor(37.4436, 24.8889).key).toBe("kini");   // centres from lib/mapTiles/areas.ts
  });
  it("is Off Syros more than 2 km from every centre", () => {
    expect(areaFor(37.28745, -109.54176)).toBe(OFF_SYROS); // the Arizona test report
    expect(areaFor(37.60, 24.94)).toBe(OFF_SYROS);
  });
  it("has unique keys made only of a-z and hyphens (they go in web addresses)", () => {
    const keys = NAMED_AREAS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z-]+$/);
  });
  it("finds an area by key and refuses anything else", () => {
    expect(areaByKey("kini")?.name).toBe("Kini");
    expect(areaByKey("37.4,24.9")).toBeUndefined();
    expect(areaByKey(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `pnpm --filter @workspace/api-server exec vitest run src/lib/areas/namedAreas.test.ts`. Expected: cannot find module.
- [ ] **Step 3: Implement.** Start from the 7 entries in `lib/mapTiles/areas.ts` and add the other villages. Centres come from OpenStreetMap place nodes. **Check each against the map before committing** (an Opus or session spot check, see Model delegation).

```ts
import { haversineKm } from "../catHelpers";

export interface NamedArea { key: string; name: string; lat: number; lng: number }
export const AREAS_VERSION = 1;
export const OFF_SYROS = { key: "off", name: "Off Syros" } as const;
const MAX_KM = 2;

export const NAMED_AREAS: readonly NamedArea[] = [
  // The first 7 are copied exactly from lib/mapTiles/areas.ts (checked 15 Oct 2026).
  { key: "ermoupoli", name: "Ermoupoli", lat: 37.4447, lng: 24.9417 },
  { key: "vaporia", name: "Vaporia", lat: 37.4447, lng: 24.9475 },
  { key: "kini", name: "Kini", lat: 37.4436, lng: 24.8889 },
  { key: "galissas", name: "Galissas", lat: 37.4226, lng: 24.8825 },
  { key: "finikas", name: "Finikas", lat: 37.3976, lng: 24.8783 },
  { key: "posidonia", name: "Posidonia", lat: 37.3889, lng: 24.8874 },
  { key: "azolimnos", name: "Azolimnos", lat: 37.4105, lng: 24.9594 },
  // ADD: Ano Syros, Vari, Mega Gialos, Fabrika, Manna, Chroussa, Kini–Galissas inland villages.
  // Take each centre from its OpenStreetMap place node (look it up; never type from memory).
  // Record the node id in a comment beside each entry so a reviewer can check it.
];

export function areaFor(lat: number, lng: number): NamedArea | typeof OFF_SYROS {
  let best: NamedArea | null = null, bestKm = Infinity;
  for (const a of NAMED_AREAS) {
    const km = haversineKm(lat, lng, a.lat, a.lng);
    if (km < bestKm) { best = a; bestKm = km; }
  }
  return best !== null && bestKm <= MAX_KM ? best : OFF_SYROS;
}

export const areaByKey = (key: unknown): NamedArea | undefined =>
  typeof key === "string" ? NAMED_AREAS.find((a) => a.key === key) : undefined;
```

  The 7 existing centres are copied exactly. Each added village's centre comes from its OpenStreetMap place node, with the node id in a comment beside it. Spec §16 Q2 asks Syros Cats to correct the list.
  Add one test per added village: its own centre maps to itself. Add a test that Ermoupoli and Vaporia (about 500 m apart) each keep their own centre.
- [ ] **Step 4: Run it and see it pass.** If a village's own centre maps to a different area, two centres are too close. Check both against the map.
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.1: named areas v1 and nearest-centre lookup"`

#### Task 1.1.2: Place labels

**Files:**
- Create: `artifacts/api-server/src/lib/areas/placeLabel.ts`
- Test: `artifacts/api-server/src/lib/areas/placeLabel.test.ts`

**Interfaces:**
- Consumes: `areaFor`.
- Produces: `placeLabel(p: { lat: number; lng: number }, publicSiteLabel?: string | null): string`. It returns e.g. "Kini" or "Kini, harbour steps". It **never** takes a site's internal name.

- [ ] **Step 1: Write the failing test**

```ts
it("is the area name alone", () => expect(placeLabel({ lat: 37.4436, lng: 24.8889 })).toBe("Kini"));
it("adds a public label", () => expect(placeLabel({ lat: 37.4436, lng: 24.8889 }, "harbour steps")).toBe("Kini, harbour steps"));
it("is Off Syros off the island", () => expect(placeLabel({ lat: 37.28745, lng: -109.54176 })).toBe("Off Syros"));
it("ignores a blank public label", () => expect(placeLabel({ lat: 37.4436, lng: 24.8889 }, "  ")).toBe("Kini"));
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**

```ts
import { areaFor } from "./namedAreas";
export function placeLabel(p: { lat: number; lng: number }, publicSiteLabel?: string | null): string {
  const area = areaFor(p.lat, p.lng).name;
  const extra = publicSiteLabel?.trim();
  return extra ? `${area}, ${extra}` : area;
}
```

- [ ] **Step 4: Source guard (silent-failure guard).** Add `lib/areas/placeLabel.source.test.ts`. It fails if any file passes a feeding site's `.name` (as opposed to `.publicLabel`) into `placeLabel(`:

```ts
for (const file of sourceFiles(["lib", "routes"])) {
  it(`${file} never builds a place label from a site's internal name`, () => {
    expect(read(file)).not.toMatch(/placeLabel\([^)]*\.name\b/);
  });
}
```

  **Mutation probe:** add `placeLabel(p, site.name)` to a scratch line in `catPages.ts`. The test goes red. Restore.
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.1: place labels from named areas and public labels only"`

### PR 1.2: Small and medium photo versions (can start now)

**What the team sees:** lists and grids load quickly, even on island mobile data.

#### Task 1.2.1: The `photo_variants` table (migration 0027)

**Files:**
- Create: `lib/db/src/schema/photoVariants.ts`
- Modify: `lib/db/src/schema/index.ts` (add `export * from "./photoVariants";`)
- Create (generated): `lib/db/migrations/0027_photo_variants.sql` and its `meta/` snapshot

- [ ] **Step 1: Schema.** Follow the `mapTiles.ts` pattern for `bytea`:

```ts
export const photoVariantsTable = pgTable("photo_variants", {
  photoId: integer("photo_id").notNull().references(() => photosTable.id, { onDelete: "cascade" }),
  size: text("size").notNull(),           // "small" | "medium"
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.photoId, t.size] }), check("photo_variants_size_ck", sql`${t.size} in ('small','medium')`)]);
```

- [ ] **Step 2: Generate:** `pnpm --filter @workspace/db run generate --name photo_variants`. Add `-- rollback-begin` / `DROP TABLE "photo_variants";` / `-- rollback-end`.
- [ ] **Step 3: Run `pnpm --filter @workspace/db run migrate:check` and `pnpm --filter @workspace/db test`.** Expected: PASS.
- [ ] **Step 4: Commit:** `git commit -m "SYC-396 PR 1.2: photo_variants table (0027)"`

#### Task 1.2.2: Making a version

**Files:**
- Create: `artifacts/api-server/src/lib/photoVariants.ts`
- Test: `artifacts/api-server/src/lib/photoVariants.test.ts`, `photoVariants.exif.test.ts`

**Interfaces:**
- Produces:
  - `export const VARIANT_WIDTH = { small: 160, medium: 640 } as const; export type VariantSize = keyof typeof VARIANT_WIDTH;`
  - `export async function variantFor(photoId: number, size: VariantSize): Promise<Buffer | null>`. It reads the stored version, or makes, stores and returns it. It returns null when the photo is missing.
  - `export async function makeVariant(original: Buffer, size: VariantSize): Promise<Buffer>`. A pure function.

- [ ] **Step 1: Write the failing tests**

```ts
it("makes a JPEG no wider than the size", async () => {
  const out = await makeVariant(await fixtureJpeg(1536, 1024), "small");
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("jpeg"); expect(meta.width).toBe(160);
});
it("never enlarges", async () => {
  const meta = await sharp(await makeVariant(await fixtureJpeg(100, 80), "medium")).metadata();
  expect(meta.width).toBe(100);
});
it("stores it once and reuses it", async () => {
  const photo = await seedPhoto(await fixtureJpeg(800, 600));
  const a = await variantFor(photo.id, "small"); const b = await variantFor(photo.id, "small");
  expect(a?.equals(b!)).toBe(true);
  expect(await db.select().from(photoVariantsTable).where(eq(photoVariantsTable.photoId, photo.id))).toHaveLength(1);
});
```

  In `photoVariants.exif.test.ts`, copy the fixture approach from `lib/imageValidation.exif.test.ts`. That's a GPS-tagged JPEG made with `sharp(...).withMetadata({ exif: { GPS: ... } })`. Assert `(await sharp(out).metadata()).exif` is `undefined` for **both** sizes.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**

```ts
export async function makeVariant(original: Buffer, size: VariantSize): Promise<Buffer> {
  // Never withMetadata(): sharp drops EXIF (and GPS) by default. The exif test guards this.
  return sharp(original).rotate().resize({ width: VARIANT_WIDTH[size], withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}

export async function variantFor(photoId: number, size: VariantSize): Promise<Buffer | null> {
  const [hit] = await db.select({ bytes: photoVariantsTable.bytes }).from(photoVariantsTable)
    .where(and(eq(photoVariantsTable.photoId, photoId), eq(photoVariantsTable.size, size)));
  if (hit) return hit.bytes;
  const [p] = await db.select({ data: photosTable.data }).from(photosTable).where(eq(photosTable.id, photoId));
  if (!p) return null;
  const bytes = await makeVariant(Buffer.from(p.data, "base64"), size);
  await db.insert(photoVariantsTable).values({ photoId, size, bytes }).onConflictDoNothing();
  return bytes;
}
// Hook points (spec §11). Nothing calls these yet, because neither feature exists (checked 15 Oct 2026):
//  - remove_photo: deleting the photos row cascades to its versions.
//  - 12-month shrink: must call clearVariants(photoId) after shrinking.
export async function clearVariants(photoId: number): Promise<void> {
  await db.delete(photoVariantsTable).where(eq(photoVariantsTable.photoId, photoId));
}
```

- [ ] **Step 4: Run the tests and see them pass. Mutation probe:** add `.withMetadata()` to `makeVariant`. The exif test **must** go red. Restore.
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.2: make and store photo versions without location data"`

#### Task 1.2.3: The version route, with the same checks as the photo

**Files:**
- Modify: `artifacts/api-server/src/routes/teamReports.ts` (next to `GET /team/photos/:publicId`, `:114-150`)
- Modify: `artifacts/api-server/src/routes/team.walk.test.ts` (`TABLE` row; allow the cache header for this route only)
- Test: `artifacts/api-server/src/routes/team.photoVariants.test.ts`

**Interfaces:**
- Produces: `GET /api/team/photos/:publicId/:size`, where `size` is `small` or `medium`. It goes through the same `requireTeam("view_exact_location", { target: photoTargets(publicId) })`. A hidden photo is refused unless the person holds `hide_photo`. It's served as `image/jpeg` with `Cache-Control: private, max-age=86400`.

- [ ] **Step 1: Write the failing tests**
  - 200 and JPEG for the team;
  - 404 for `size=large`;
  - a hidden photo is refused for a member without `hide_photo` (use `hidePhoto` from `test/roleKit.ts`);
  - a guardian gets 403 for a cat outside their colonies and 200 inside;
  - the response is never `public`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Copy the existing handler's capability, target and hidden checks exactly. Factor them into one `servablePhoto(req, res)` helper that both routes call, so they can't drift apart. Then `res.set("Cache-Control", "private, max-age=86400").type("jpeg").send(await variantFor(photo.id, size))`.
- [ ] **Step 4: Route-walk.** Add the row `"GET /api/team/photos/:publicId/:size": { why: "photo versions, same checks as the photo", except: ... }`, matching the photo route's row. In the walk's `no-store` assertion, add this route to the named cache exemption next to `map-tiles`.
  - **Mutation probe:** delete the hidden-photo check from `servablePhoto`. The hidden-photo test **must** go red. Restore.
- [ ] **Step 5: Use it.** In `searchTeamCats` (`lib/teamCatView.ts`), change `thumbnailUrl` to `${teamPhotoUrl(publicId)}/small`. Run `team.cats.test.ts`.
- [ ] **Step 6: Commit:** `git commit -m "SYC-396 PR 1.2: serve small and medium photo versions"`

### PR 1.3: The Cats grid (after #191 merges)

**What the team sees:** Cats opens on every cat as a photo grid. You can filter by colour, area, colony, sterilised, where it lives and last seen, or search by name. It's an ordinary form that works without a script. A small script makes the filters apply instantly. Tie mode, for matching a welfare report to a cat, still works.

#### Task 1.3.1: The team cat list (data)

**Files:**
- Create: `artifacts/api-server/src/lib/teamCatList.ts`
- Test: `artifacts/api-server/src/lib/teamCatList.test.ts`

**Interfaces:**
- Consumes:
  - `loadCatRecords(ids)` (`lib/observations.ts:951`);
  - `resolveCat(obs, evidenceOfLife, now): CatSnapshot` (`lib/resolve.ts:1387`);
  - `currentColonyOf(ids)` (`lib/colonyMembership.ts`);
  - `areaFor`, `placeLabel`;
  - colour words from #191 (`strings/en.ts`, coat keys; re-check their names after merge).
- Produces:

```ts
export type SterilisedMark = "sterilised" | "probably" | "not_sterilised" | "not_known";
export type Lives = "street" | "homed" | "in_care" | "gone";
export interface CatListFilters {
  colours?: CoatColour[]; area?: string; colony?: number; sterilised?: SterilisedMark[];
  lives?: Lives[]; lastSeen?: "week" | "month" | "1to3" | "over3" | "never"; q?: string;
  sort?: "recent" | "newest" | "name"; page?: number;
}
export interface CatListItem {
  id: number; name: string; syr: string; photoPublicId: string | null; coat: CoatColour[];
  colonyId: number | null; mark: SterilisedMark; lives: Lives; lastSeenAt: Date | null;
  lastSeen: { lat: number; lng: number } | null; place: string; notSeenSince: string | null;
}
export const PAGE_SIZE = 48;
export function markOf(s: CatSnapshot["sterilised"]): SterilisedMark;
export function livesOf(s: CatSnapshot): Lives;
export async function listTeamCats(f: CatListFilters, now?: Date): Promise<{ items: CatListItem[]; total: number }>;
```

- [ ] **Step 1: Write the failing tests** for `markOf` (pure). It must cover the fourth state, which the adversarial review found missing:

```ts
it.each([
  [{ value: true, confidence: "confirmed" }, "sterilised"],
  [{ value: true, confidence: "likely" }, "probably"],
  [{ value: false, confidence: "confirmed" }, "not_sterilised"],
  [{ value: null, confidence: "unknown" }, "not_known"],
  [{ value: true, confidence: "reported" }, "not_known"],
])("markOf(%o) is %s", (s, want) => expect(markOf({ ...s, asOf: "", clippedTipSightings: 0 } as never)).toBe(want));
```

  Also write `livesOf` cases: a presumed-deceased street cat is `gone`, and `deceased` is `gone`. Then the DB-backed tests for `listTeamCats`:
  - all cats with no filters, newest-seen first;
  - colour filter;
  - area filter (uses the **last sighting**, else the discovery position);
  - sterilised filter including `not_sterilised`;
  - `gone` hidden by default;
  - a cat with no colony is included;
  - `q` matches name and SYR exactly as `searchTeamCats` does;
  - page 2 starts at item 49.

  Seed with `seedCat` from `test/roleKit.ts`, plus direct inserts into `sightingsTable` and `observationsTable`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **Reads:** one query for cats (`id, name, primaryPhotoId → photos.publicId`, never `photos.data`); `loadCatRecords(allIds)`; `currentColonyOf(allIds)`; and one query for each cat's newest **resolved** sighting position:

```sql
select distinct on (cat_id) cat_id, lat, lng, created_at
from sightings where status = 'resolved' and cat_id is not null
order by cat_id, created_at desc
```

  - **Per cat:** run `resolveCat`, then build the item.
  - **Then:** filter, sort and page in memory (spec §9.6, hundreds of cats). Log the elapsed time with `req.log` at the route (spec §9.6 "each page records how long it took").
  - Reuse `searchTeamCats`'s name folding by exporting its `foldName`. Don't copy it.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.3: listTeamCats with the four sterilisation marks"`

#### Task 1.3.2: Filters from the web address, safely

**Files:**
- Create: `artifacts/api-server/src/lib/teamCatFilters.ts`
- Test: `artifacts/api-server/src/lib/teamCatFilters.test.ts`

**Interfaces:**
- Produces: `parseCatFilters(query: unknown): CatListFilters` and `filtersToQuery(f: CatListFilters): string`. Unknown values are dropped silently. `area` must pass `areaByKey`. `colony` must be a positive integer. `q` is capped at `QUERY_MAX` (100).

- [ ] **Step 1: Write the failing tests:**
  - a round trip;
  - junk dropped;
  - `area=37.4,24.9` dropped;
  - `colony=Eleni` dropped;
  - **no output ever contains a digit pattern like a coordinate:** `expect(filtersToQuery(f)).not.toMatch(/\d+\.\d{3,}/)` over a fuzz of 200 random filter objects made with a seeded generator.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement with zod.** Step 4: see them pass. **Step 5: Commit.**

#### Task 1.3.3: The grid page (no script)

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/catGridPage.ts`
- Create: `artifacts/api-server/src/lib/teamPages/marks.ts`. This holds the badge HTML and CSS for the four marks. It's shared later by the map and the reports.
- Modify: `artifacts/api-server/src/routes/teamCats.ts` (`GET /team/cats`)
- Modify: `artifacts/api-server/src/lib/teamPages/layout.ts` (CSS for `.catgrid`, `.mark-*`)
- Test: `artifacts/api-server/src/routes/team.catGrid.test.ts`, `artifacts/api-server/src/lib/teamPages/marks.test.ts`

**Interfaces:**
- Produces:
  - `markBadge(m: SterilisedMark): string`, which returns trusted HTML: an icon span plus the word;
  - `MARK_WORD: Record<SterilisedMark, string>` = `{ sterilised: "Sterilised", probably: "Probably", not_sterilised: "Not sterilised", not_known: "Not known" }`;
  - `renderCatGridPage(o: { items: CatListItem[]; total: number; filters: CatListFilters; personName: string; tie?: TieMode; now: Date; colonies: { id: number; name: string }[] }): string`.

- [ ] **Step 1: Write the failing tests**
  - `marks.test.ts`: each mark has its word, and its own class (`mark-sterilised` and so on). It's never colour alone: the word is always in the text.
  - `team.catGrid.test.ts`:
    - an empty `GET /api/team/cats` lists cats (not the old "Type a name" prompt);
    - `?colours=ginger` narrows;
    - `?q=SYR-0004` still finds by number;
    - `?tie=<publicId>` still shows the "This is the cat" buttons (copy the assertions from `team.queuePage.test.ts`);
    - the "No cats match these filters" state shows with "Clear filters";
    - thumbnails use `/small`;
    - the page holds no `script` tag yet;
    - the guardian outcome is unchanged from today's walk row (`forbidden`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **The form.** A `<form method="get">` with:
    - the name box;
    - colour checkboxes styled as chips;
    - selects for area (from `NAMED_AREAS`) and colony;
    - checkboxes for sterilised and lives;
    - a select for last seen;
    - a "Show cats" button.
  - **On a phone** the filters sit in a `<details><summary>Filters (n)</summary>`, with the active ones listed under it as chips. Each chip is an `<a>` to the same address without that filter.
  - **The grid.** `<ul class="catgrid">` of cards: photo, name, SYR, colour words, colony, `markBadge`, "Last seen …", and a tag.
  - **Paging.** "Show more" is a link to `page=n+1`.
  - Keep `renderCatSearchPage` until no caller uses it, then delete it in this task.
- [ ] **Step 4: Run them and see them pass,** then run the whole of `team.cats.test.ts` and `team.queuePage.test.ts`.
- [ ] **Step 5: Look at it.** Render at 390px and 1280px with `docs/screenshots/syc-209-pr-3-1/screenshots.mjs` as the pattern. Save to `docs/screenshots/syc-396-pr-1-3/`. Check: nothing scrolls sideways, tap targets are 44px, and no text is under 12px.
- [ ] **Step 6: Commit:** `git commit -m "SYC-396 PR 1.3: Cats opens on every cat as a filterable grid"`

#### Task 1.3.4: Instant filters (first script) and the security header variant

**Files:**
- Modify: `artifacts/api-server/src/lib/teamAuth/refuse.ts` (`setTeamHeaders(res, opts?)`)
- Create: `artifacts/api-server/src/routes/teamAssets.ts`, and `artifacts/api-server/assets/dashboard-grid.js` (plain ES2019, no build step)
- Modify: `artifacts/api-server/build.mjs` (copy `assets/` into `dist/assets/`, with content-hash names written to `dist/assets/manifest.json`)
- Modify: `artifacts/api-server/src/routes/index.ts` (register the assets router), `routes/team.headers.test.ts`, `routes/team.walk.test.ts`
- Test: `artifacts/api-server/src/routes/team.assets.test.ts`

**Interfaces:**
- Produces:
  - `setTeamHeaders(res: Response, opts?: { scripts?: boolean }): void`.
  - `assetUrl(name: "dashboard-grid.js" | "dashboard-map.js" | "leaflet.css"): string`, which returns the hashed path.
  - `GET /api/team/assets/:file`, which serves only manifest entries.

- [ ] **Step 1: Write the failing tests**
  - `team.headers.test.ts`: every response **except** `GET /api/team/cats` still has exactly today's string. `GET /api/team/cats` has today's string plus `script-src 'self'; connect-src 'self'` and `img-src 'self' blob:`, and **no** `'unsafe-eval'` and no other host.
  - `team.assets.test.ts`:
    - a manifest file gets 200 with `immutable`;
    - `../package.json`, `%2e%2e%2f` and an unknown name get 404;
    - no `Set-Cookie`.
  - `team.walk.test.ts`: a row for `GET /api/team/assets/:file`, which doesn't need a session (`why: "first-party scripts, public bytes"`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **The header.** The default string must stay byte-for-byte the same:

```ts
const BASE = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const WITH_SCRIPTS = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
export function setTeamHeaders(res: Response, opts: { scripts?: boolean } = {}): void {
  // …existing headers unchanged…
  res.setHeader("Content-Security-Policy", opts.scripts ? WITH_SCRIPTS : BASE);
}
```

  - **The grid script.** `dashboard-grid.js` listens for `change` on the filter form. It fetches `location.pathname + "?" + params` with `Accept: text/html`, and swaps the `.catgrid` and count from the response. It updates the address with `history.replaceState`. If anything fails, it does nothing, and the form's button still works.
- [ ] **Step 4: Run them and see them pass. Mutation probe:** make `setTeamHeaders` always return `WITH_SCRIPTS`. `team.headers.test.ts` **must** go red. Restore.
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.3: first-party scripts on the Cats page only"`

### PR 1.4: The team cat page summary (after #191 merges)

**What the team sees:**
- The answer first: a facts row (sterilised, lives, colour, colony, last seen, vaccinated, health) in plain words.
- A small map of the cat's sightings.
- The buttons "Update this cat" and "Add a note". "Log a vet visit" joins them as the main button in phase 3. It's left out until then rather than shown as a dead button.
- The evidence below, folded away. Routine sightings in the history are grouped into one line.

#### Task 1.4.1: The facts row

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/catFacts.ts`
- Modify: `artifacts/api-server/src/lib/teamPages/catPages.ts` (`renderCatPage`)
- Test: `artifacts/api-server/src/lib/teamPages/catFacts.test.ts`, `routes/team.cats.test.ts`

**Interfaces:**
- Consumes: `TeamCatView` (after #191), `markOf`, `MARK_WORD`, `placeLabel`.
- Produces: `catFacts(v: TeamCatView, now: Date): { label: string; html: string }[]`.

- [ ] **Step 1: Write the failing tests,** one per §7.1 wording. Each value must say its uncertainty in words, with no separate confidence tag:
  - confirmed: "Yes, confirmed by Syros Cats, 13 Aug 2026";
  - likely with clipped-ear count 3: "Probably: clipped ear seen in 3 photos";
  - confirmed false: "No, Syros Cats' records";
  - unknown: "Not known";
  - presumed deceased with `notSeenSince` 2026-06: "No longer with us" plus "Not seen since Jun 2026" (always month **and** year);
  - colour from the machine: "read from the photo"; from a team member: "set by <name>";
  - last seen "3 days ago · Kini, harbour steps";
  - the page no longer contains `class="tag"` confidence pills next to these values;
  - the #192 words "What we know about this cat" and "Update this cat" remain (`catPages.words.test.ts` keeps passing).
- [ ] **Steps 2–4:** see them fail, implement, see them pass.
- [ ] **Step 5: Commit:** `git commit -m "SYC-396 PR 1.4: plain-word facts row on the team cat page"`

#### Task 1.4.2: Layout, folded evidence and grouped sightings

**Files:**
- Modify: `catPages.ts` and `layout.ts` (replace `.twocol` with `.catsummary`; keep `HISTORY_SHOWN = 20`)
- Test: `catPages.history.test.ts`, `routes/team.cats.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Twenty consecutive spotter sightings with no change between them render as **one** line, "Seen 20 times by spotters between … and …, looking well". Expanding it lists them.
  - A colony change between two runs splits them into two groups.
  - Vet-visit, status, colour, name and note rows are never grouped.
  - "Make a feeding site here" and "Show on the map" sit inside a `<details>` menu on each sighting.
  - "Take out of this colony" is not repeated per cat on colony pages. That one is a colony page change; include it here, because it shares the menu component.
- [ ] **Steps 2–4:** see them fail, implement, see them pass.
- [ ] **Step 5: Look at it** at 390px and 1280px, and save to `docs/screenshots/syc-396-pr-1-4/`.
- [ ] **Step 6: Commit.**

The cat page's small sightings map uses the same composed map picture as today, with numbered markers, so it needs no script. Tapping it opens `/api/team/cats?view=map&focus=<id>` (PR 1.5).

### PR 1.5: The island Map

**What the team sees:**
- The menu's "Map" (or the Grid/Map switch) shows every active cat at its last-seen spot, as the four marks, grouped when zoomed out.
- You can drag and pinch. Feeding sites appear as squares when that layer is on.
- Tapping a cat shows its card and "Where else it's been seen".
- Without the script, the same page shows the button map with the cats as markers.

#### Task 1.5.1: Single-square map tokens and the token request

**Files:**
- Modify: `lib/mapTiles/tileToken.ts` (a new `VERSION` byte for a single square; `size` fixed at 256)
- Modify: `routes/teamMap.ts`:
  - `POST /team/map-squares`: body `{ z, xMin, xMax, yMin, yMax }`. It returns `{ tokens: Record<"z/x/y", token> }` for allowed squares only, capped at 64 per call.
  - `GET /team/map-square/:token`: it uses `getTilePng`.
- Modify: `lib/logger.ts` (add `map-square` to `MAP_TILE_IN_PATH`), and `lib/limits.ts` (a new per-person bucket, `map_squares`, 300 per 10 minutes)
- Test: `routes/team.mapSquares.test.ts`, `lib/mapTiles/tileToken.test.ts`, `lib/logger.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the token round trip for a single square;
  - an old 2×2 token can't be read as a square, and the reverse;
  - squares outside `ISLAND_BOX` get no token;
  - the 65th square in one call is refused;
  - the 301st square for one person in 10 minutes gets 429, while a second person is unaffected;
  - the request log for `/api/team/map-square/<token>` shows `[redacted]`;
  - the POST body holds square numbers, never a latitude or longitude;
  - nothing positional is in any URL. Assert the token route's path matches `TOKEN_RE` only.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: See them pass.**
  - **Mutation probe:** remove `map-square` from `MAP_TILE_IN_PATH`. The logger test **must** go red. Restore.
  - **Second probe:** key the limiter by IP instead of person. The two-person test **must** go red. Restore.
- [ ] **Step 5: Commit.**

#### Task 1.5.2: Cat positions for the map (signed-in POST)

**Files:**
- Modify: `routes/teamCats.ts`. `POST /team/cats/positions` takes the same filters as the grid, in the **body**. It returns `{ cats: { id, name, mark, lat, lng, place, lastSeenAt, photo }[] }`, built from `listTeamCats` with no paging.
- Test: `routes/team.catPositions.test.ts`

- [ ] **Steps:**
  - It needs `view_exact_location`, and a guardian gets 403 (guardians are "alongside", §10.2).
  - Filters arrive in the body, never the query (assert that a `?area=kini` query string is ignored).
  - Answers carry `no-store`.
  - Add a walk-table row.
  - Commit.

#### Task 1.5.3: The map page, its script and the no-script fallback

**Files:**
- Create: `lib/teamPages/catMapPage.ts`, and `assets/dashboard-map.js`
- Vendor: `assets/leaflet.js` and `assets/leaflet.css` (1.9.4, copied from the npm package by `build.mjs`). Add `leaflet@1.9.4` as a devDependency of api-server.
- Modify: `routes/teamCats.ts`. `GET /team/cats?view=map` renders `catMapPage` with `setTeamHeaders(res, { scripts: true })`.
- Modify: `lib/teamPages/map.ts`. `MapMarker.look` gains the four marks and `"cluster"`, drawn by `marks.ts` CSS, so the no-script map can show cats.
- Test: `routes/team.catMap.test.ts`

- [ ] **Step 1: Write the failing tests.** The page:
  - holds a `<div id="island-map">` and a no-script `renderMap` fallback inside `<noscript>`;
  - loads only `assetUrl(...)` scripts;
  - has the legend with all four marks and their words, and the square feeding-site key;
  - has the layer checkboxes;
  - has the Grid/Map switch keeping the filters (the link's query equals the grid's);
  - a `focus=<id>` brings that cat's sightings trail into the page data.
- [ ] **Step 2: See them fail. Step 3: Implement.** The `dashboard-map.js` script:
  - Builds Leaflet with a custom `GridLayer` whose `createTile` gets its token from a batched `POST /api/team/map-squares` for the visible range, then sets `img.src = "/api/team/map-square/" + token`.
  - Loads cats from `POST /api/team/cats/positions` with the form's filters.
  - Draws each cat as a `divIcon` with the mark class, a 2px light ring and a 1px dark outline (the §12.2 CSS from `marks.ts`).
  - Groups nearby cats with a simple grid clustering of its own (about 40 lines, no plugin). Each group shows a count and a ring split by mark.
  - Opens a card or sheet on tap, with "Where else it's been seen", which draws numbered sightings from the `focus` data.
  - Draws feeding sites as square markers when that layer is on, from the existing site reader with `visibleColonyIds(person)`.
  - **When tiles fail,** shows "Map pictures aren't loading. The cats are still shown." over a plain island outline (§6.3, §13).
- [ ] **Step 4: Browser check (required, since this is a script):**
  - Run `docs/screenshots/syc-209-pr-3-1/layout-and-tap-check.mjs`, adapted to `/api/team/cats?view=map`, at 320, 360, 375, 390 and 1280px in Chromium, WebKit and Firefox.
  - Check: dots are visible on land and sea; a tap opens the card; nothing scrolls sideways; and the no-script fallback works with JavaScript disabled.
  - Save screenshots to `docs/screenshots/syc-396-pr-1-5/`.
- [ ] **Step 5: Commit.**

### PR 1.6: Menu and shell

**What the team sees:**
- The menu reads Home · Cats · Map · Queue · Colonies · Reports · People.
  - In phase 1, Home is still the Queue and Reports isn't shown yet. Items appear as their screens ship.
- "Signed in as" and Sign out move into the menu bar.
- There's a skip link and a visible focus outline (SYC-366).

#### Task 1.6.1: Menu, skip link, Sign out in the bar

**Files:**
- Modify: `lib/teamPages/layout.ts`:
  - `NAV` and `NavKey` gain `"map"`;
  - `renderPage` moves "Signed in as" and Sign out into `<nav class="bar">`;
  - add `<a class="skip" href="#main">Skip to the page</a>`;
  - add a `:focus-visible` outline.
- Test: `lib/teamPages/layout.test.ts` (create if missing), and the existing page tests that assert "Signed in as" placement.

- [ ] **Steps:**
  - Write the failing tests:
    - the menu order;
    - Map links to `/api/team/cats?view=map`;
    - the skip link is the first focusable element;
    - "Signed in as" sits inside the `nav.bar`;
    - the guardian nav (#194's `GUARDIAN_NAV`) is unchanged.
  - Implement, and check at 390px (the menu slides sideways, with Sign out at the end) and at 1280px.
  - Commit. Mark SYC-366 Done in the PR description, since its basics are covered.

---

## Phases 2–5: outline

Each phase gets its own detailed plan, written when the phase before it has merged, because each builds on the interfaces above.

| Phase | PRs (outline) | Depends on |
|---|---|---|
| 2 | **2.1 Home.** The sections of §4, with links to Ask Syros Cats to match it, Needs an OK, Colour check, Ear clips to check (the renamed Probably sterilised, SYC-365) and Report an issue counts. The headline uses the §9.5 "who is counted" definitions, as one shared `countedCats()` module with its own tests. **2.2 Colonies list** with progress bars and the Growing / Kittens reported / No guardian / Not visited lately flags. **2.3 The trapping planner** on the colony page. **2.4 Named areas editable:** an Areas page, `edit_named_areas` added to roles §6.2 and `capabilities.ts`, and an add-only history. **2.5 Find from a photo:** `find_cat_from_photo`; narrowing to 30 or fewer, groups of 10 plus a final round, thresholds 0.8 and 0.5; a per-person cap of 20 a day and a team cap of 100; EXIF stripped before sending. | Phase 1 |
| 3 | **3.1 Vet visits:** the `vet_visit` observation; one transaction writing the derived `sterilised` and `vaccinated` rows; undo together; D8 marking a standing guardian "not sterilised" wrong, onto the recent guardian changes list; capabilities `log_vet_visit`, `view_vet_costs` and `edit_vet_settings`; the standard price with history; amending spine §3.4 (proof of life). **3.2 Round logging.** **3.3 Reports:** Sterilisation progress (the "as of" re-resolve), Colony health, Coverage and spotting (250 m squares near area centres), Welfare patterns (Urgent / Needs attention / Litter; content reports apart), and Vet visits and costs. Also CSV downloads (formula-safe and recorded) and `view_reports` and `export_report`. | Phase 2 |
| 4 | **4.1 The impact report:** reproducible "as of" (records with `createdAt <= asOf`); areas with 5 or more cats only; milestones as counts; vaccination count hidden below 5; the method note; print, PDF and CSV; `view_impact_report`. | Phase 3 |
| 5 | **5.1 Donations,** once James's route is settled. | James |
| Alongside | The guardian additions in §10.2, each shipped with the phase that builds its screen, with route-walk rows and guardian-view tests. | Each phase |

---

## Model delegation

The session runs on Opus, so the default is downward delegation. Escalations are justified per row.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 0.1 Retire confirm | Sonnet | Small, follows the Remove-owner pattern exactly | Its tests, plus a full `team.sites.test.ts` and `strings.test.ts` run; session-model diff review |
| PR 0.2 Open map links | Sonnet for the conversions; **Opus** for the source and guardian tests | The conversions are mechanical across 7 files. The guards are silent-failure guards against a privacy leak, so they need judgment about what they could miss | **Two mutation probes** (force `island: true`, then a stray `toFixed`), each must go red. An enumeration of every position print (Task 0.2.1's red list is the inventory). Adversarial review (Opus) |
| PR 1.1 Named areas and place labels | Sonnet | Pure functions with a clear spec | Tests; the **mutation probe** on the `.name` source guard; the session model checks every added village centre against its OpenStreetMap node id before merge |
| PR 1.2 Photo versions | Sonnet | Standard sharp and DB work with known patterns | Tests; **mutation probes** on EXIF (`withMetadata`) and on the hidden-photo check; `migrate:check` |
| PR 1.3 data and grid (1.3.1–1.3.3) | Sonnet | A clear spec, with existing resolver and roleKit patterns | Tests, including the four-mark table and the coordinate-free fuzz; screenshots at 390 and 1280 reviewed by the session model |
| PR 1.3 security header and assets (1.3.4) | **Opus** | Changes the dashboard's security header and adds the first served scripts, where a subtle mistake widens the attack surface | **Mutation probe** (header always wide, must go red); an adversarial review focused on CSP and path traversal |
| PR 1.4 Cat page summary | Sonnet | Rendering work against fixed wording | Tests per §7.1 wording; `catPages.words.test.ts`; screenshots reviewed |
| PR 1.5 Map (tokens, limiter, script) | **Opus** | Security-sensitive (tokens, logging redaction, per-person limits) plus the first real client script across three browsers | **Mutation probes** (redaction, limiter key); a three-browser layout and tap check; an adversarial review (Opus, its own worktree) |
| PR 1.6 Menu and shell | Haiku for the CSS and markup moves; Sonnet for the tests | Mechanical once the order is set | Tests; screenshots at 390 and 1280 |
| Bulk test-fixture updates (5-decimal positions) | Haiku | Mechanical find-and-replace in test expectations | The full api-server suite run by the session model; diff spot-review |
| Adversarial review of every PR | Opus, **one worktree per reviewer** (LIF-79) | Finding what tests miss needs the strongest reasoning; a shared tree contaminates results | The reviewer must try to make a named test fail, not just read; findings are folded in before merge |
| Phase 2–5 detailed plans | Session model (Opus) | Each needs synthesis across the spec and the merged code | Samuel approves each plan |

**Every agent prompt restates:** "Commit after each task. Write a checkpoint line to PROGRESS.md after each task. Never hold work only in memory. Do not sub-delegate."

**Re-running tests:** before any merge, the session model re-runs the named test files itself (memory `rerun-delegated-tests`). A delegated "tests pass" is not trusted on its own.

**Where else must each invariant hold?** This is the consumer list for the silent-failure guards:
- **No position in our addresses:**
  - the grid query string (Task 1.3.2);
  - the positions POST (body only);
  - map-square tokens;
  - the Map and Grid switch links;
  - the "Show more" link;
  - the filter-chip removal links;
  - the photo-version route.
- **Open map only for island-wide viewers:** every page in Task 0.2.2's list, plus every later page that prints a position. The source test forces them through `position()`.
- **Never a site's internal name in a label:**
  - `placeLabel` callers;
  - CSV exports (phase 3);
  - the printable plan (phase 2);
  - the impact report (phase 4).
- **Hidden photos stay hidden:** the photo route, the version route (shared `servablePhoto`), grid cards, map cards and the cat page strip.

## Self-review against the spec

- **§3.1 menu:** PR 1.6 (Home and Reports appear in phases 2 and 3).
- **§3.2:**
  - place labels: PR 1.1;
  - Open map: PR 0.2;
  - Sign out in the bar: PR 1.6;
  - small pictures: PR 1.2;
  - empty states: PRs 1.3 and 1.5, then each later phase.
- **§3.3 areas:** PR 1.1 (read-only), then 2.4 (editable).
- **§4:** phase 2.
- **§5.1:** PR 1.3.
- **§5.2:** phase 2.5.
- **§6:**
  - 6.1–6.2: PR 1.5;
  - 6.3 (tokens, limits, fallback): PR 1.5;
  - layers for colonies, welfare and gaps arrive with phases 2 and 3 data. Phase 1 ships Cats and Feeding sites.
- **§7:** PR 1.4. The Log a vet visit button is live in phase 3.
- **§8:** phase 3.
- **§9:** phases 2–5.
- **§10.2 guardians:** alongside. §10.3 capabilities: added in the phase that first needs each one.
- **§11:** PR 1.2. The retention and remove hooks are documented, because no code exists to attach to.
- **§12 design rules:**
  - `marks.ts` (PR 1.3);
  - the map styling (PR 1.5);
  - 12px and wording, checked in each PR's screenshot review;
  - SYC-366: PR 1.6.
- **§13 errors:** each PR covers its own screens.
- **§14 security rule:** PR 1.3.4.
- **§15 phase 0:** PRs 0.1 and 0.2.
- **Known gap, accepted and ticketed:** "checked in person" waits for a field-check record (Decisions this plan makes, item 3).
