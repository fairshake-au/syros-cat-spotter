# Team dashboard redesign: implementation plan for phases 2, 3 and 4

**Status:** **Approved by Samuel, 18 Oct 2026** ("approved, start building asap"), after its adversarial review and his scope answers the same day. One combined plan, as Samuel decided on 18 Oct (D1, recorded on SYC-463).

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after every task, and write a checkpoint line to `PROGRESS.md` in your worktree after every task (what's done, what's next). Never hold work only in memory. Do not sub-delegate.**

**Goal:** give Syros Cats' team the rest of the redesigned dashboard, in this order:
- Home: what needs us today;
- colonies as trapping plans;
- named areas the team can edit;
- Find from a photo;
- vet visits, one at a time and a whole round;
- the five working reports;
- the funders' impact report.

**Architecture:** this is the same server-drawn Express dashboard that phases 0 and 1 built.
- Every number is worked out from the records on each request, through one shared "who is counted" module (§9.5).
- Vet visits are a new kind of observation, written in the same transaction as the statements they create.
- Reports are server-drawn SVG with a table beside each chart.
- Two small migrations add the areas table and its history; a third records downloads.

**Tech stack:**
- TypeScript, Express, Drizzle on Postgres (Neon), and Vitest with a throwaway database;
- `sharp` for photos;
- `multer` 2.x, new, for the Find-from-a-photo upload.

**Spec:** `docs/specs/team-dashboard-redesign.md` (approved 15 Oct 2026). Section numbers (§) refer to it. Read it with this plan.
**Earlier plan:** `docs/superpowers/plans/syc-396-team-dashboard-redesign.md` (phases 0 and 1, approved 15 Oct). Its global constraints all still apply, and are repeated below where they matter.
**Linear:** SYC-396 is the parent and SYC-463 is this plan. The slip order is D2 on SYC-396: phase 5 first, then phase 4, then phase 3.3's reports, then Find from a photo.
**Evidence base:** `origin/main` at `97420af3` (18 Oct 2026), read by three code inventories on 18 Oct. Every signature below was read from that commit. **Before starting any PR, re-read every signature it names on the then-current `origin/main`. If one has changed, update the task's code, not the intent.**

---

## Global constraints

Every task's requirements include these.

**Words and facts**
- Sterilisation costs €50–60 per cat. The default standard price is **€60** (Syros Cats' answer, SYC-442, 18 Oct).
- The terms are "cat guardian" and "spotter", never "colony carer" or "snapper".
- Team pages are English only (Decision 12).
  - Pages shared with cat guardians take their words from `lib/teamPages/strings/{en,el,fr}.ts`. `strings.test.ts` enforces that all three have the same keys and the same `{placeholders}`.
  - Greek and French drafts are written by the builder and flagged on SYC-346 for Johnny.
- No text below 12px.
- The same thing is always worded the same way: "Last seen 3 days ago", "% confirmed sterilised".
- Home and the reports never show response times, targets, rankings or per-person figures (D6).

**Who is counted (§9.5).** Every figure, list and report goes through `lib/dashboard/countedCats.ts` (PR 2.0). No PR writes its own "street cat" filter.

**Privacy and security**
- No position, and no person's or colony's name, ever appears in one of our own web addresses. Dates, area keys, colony **numbers** and report keys may.
- Open map links come only from `lib/teamPages/position.ts` with `link: isIslandWide(person)`. A new file that prints positions must be added to `position.guard.source.test.ts` `ALLOWED`, and to `team.guardianView.test.ts` `hers()` if guardians can open it.
- Every team route is declared with `requireTeam(cap)`, or `...formRoute(cap)` for a POST. It calls `setTeamHeaders(res)` before any `await`, and has a row in `routes/team.walk.test.ts` `TABLE`.
- No reader of sites, colonies or `mapping_events` may skip the colony filter. A new reader takes a `Visible` and joins `FILTERED_MODULES`, or is registered in `ISLAND_ONLY_MODULES` with the capability that guards it (`lib/guardianView.source.test.ts`).
- A feeding site's internal `name` never appears in a place label, a printed plan, a CSV or a report. Only `publicLabelOf(site)` may.
- New capabilities are added to `lib/capabilities.ts` `CATALOGUE` **and** to the table in `docs/specs/roles-and-invites.md` §6.2 in the same commit. `capabilities.catalogue.test.ts` compares the two.

**Sterilisation marks** (§12.2) mean sterilisation status and nothing else. Use `MARK_ORDER`, `MARK_COLOUR`, `MARK_WORD` and `markBadge` from `lib/teamPages/marks.ts`. A total that isn't a status is drawn in neutral ink `#1d1d1b` at 55% opacity.

**Migrations.** Three are planned, numbered in the order the PRs are expected to merge (revised after the plan review):
- `named_areas` (PR 2.4);
- `report_downloads` (PR 3.3a, wave 2);
- `vet_settings_history` (PR 3.1b).

They **take the next free numbers when each PR leaves draft**, not fixed numbers. On 18 Oct `main` was already at `0031` (#229), and SYC-45 Slice 1 had claimed `0032`. Each builder re-checks `lib/db/migrations/` on fresh `origin/main` before `gh pr ready`, and regenerates if another migration landed first.

If they merge in another order, the later one is deleted and regenerated, as `lib/db/migrations/README.md` says. Every migration has a commented rollback and passes `migrate:check`. All three are applied to production by Claude before the publish that carries them. Production writes need Samuel to switch the session to "ask" mode first (memory `neon-writes-need-ask-mode`).

**Tests**
- CI runs, in order:
  - `pnpm --filter @workspace/db run migrate:check`;
  - `pnpm --filter @workspace/db test`;
  - `pnpm run typecheck:libs`;
  - `pnpm --filter @workspace/api-server run typecheck`;
  - `pnpm --filter @workspace/api-server test`.
- Locally, use the esbuild workaround (memory `local-vitest-esbuild`). Set:
  - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/catspotter_test`;
  - `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9`;
  - `AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`.
- The test database is shared by every file in a run and is never truncated. Tests seed rows under a per-run prefix, and assert on their own rows or on **deltas**, never on absolute island totals. `observations` is append-only, so tests can't delete them.
- **Every guard against a silent failure gets a mutation probe:** break the site on purpose, watch a named test go red, then restore it. "Tests pass" is not enough for these.
- Never run high-volume port or network loops.

**Process**
- One PR per numbered PR below. Each runs in its own worktree from fresh `origin/main` and opens as a **draft** (`gh pr create --draft`).
- Before `gh pr ready`: the affected tests run locally, the adversarial review's findings are folded in, and screenshots are taken at 390px and 1280px for any page change.
- Samuel merges.

---

## Sequencing and dependencies

```
                         ┌─► 2.1 Home ───────────────────────────────┐
2.0 Counted cats ────────┼─► 2.2 Colonies list ─► 2.3 Planner ─┐      │
                         │                                     ├─► 3.1 Vet visits ─► 3.2 Round
2.4 Named areas ─────────┤                                     │          │
2.5 Find from a photo    │   3.0 Resolver groundwork ──────────┘          │
                         └─► 3.3a Reports area, progress, health ─┬─► 3.3b Coverage, welfare
                                                                  ├─► 3.3c Vet costs (needs 3.1)
                                                                  └─► 4.1 Impact report (needs 3.1, 2.4)
```

**Wave 1 (started 18 Oct, Samuel's choice):** 2.0, 2.1 and 3.0, at most three at once.
- 2.0 is small and merges first.
- **2.1 Home is built on top of 2.0's branch** (stacked), because its headline and Not seen lately use 2.0's counting. It rebases onto `main` once 2.0 merges, and stays a draft until then.
- 2.4 starts when the first of the three finishes, then 2.5.
- 3.0.1 and 3.0.2 touch only the resolver and the observation writer. 3.0.3 also changes `loadTeamCats` in `teamCatList.ts`, so it is committed last in PR 3.0 and rebased on 2.0 before review.

**Wave 2 (once 2.0 merges):** 2.4, 2.5, 2.2, 2.6 and 3.3a, at most three building at once, started as slots free up in that order.
- Only 2.2 touches `colonyPages.ts` in this wave. The Feeding sites link moved into 2.2 for that reason.
- 2.3 starts once 2.2 merges, because both change `lib/teamPages/colonyPages.ts`.
- 3.3a needs 2.4 for its areas version line, but can be built against the read-only list and rebased.
- 3.3a's one-line menu change in `layout.ts` is made after 2.1 merges (2.1 rewrites the menu).
- **Shared lists every PR appends to:** `team.walk.test.ts` `TABLE`, the `guardianView.source.test.ts` lists, `CATALOGUE`, and roles §6.2. These conflict only as adjacent-line rebases. Whoever merges second rebases and re-runs the walk.

**Wave 3:**
- 3.1a (Tasks 3.1.1 and 3.1.3) starts once 3.0 and 2.3 merge. It needs the price setting and `view_vet_costs` from 2.3.
- 3.1b (Task 3.1.2, Vet settings) can start as soon as 2.3 merges, in parallel with 3.0.
- 3.2 and 3.3c follow 3.1.
- 3.3b follows 3.3a.
- 4.1 follows 3.3a and 3.1.

**What else is running.** SYC-44's 6.1, 6.2 and 7.1 change `queuePage.ts` and add the Issues section. PR 2.1 links to that section by the anchor `#issues`, so 7.1's builder must give the section `id="issues"` (agreed through SYC-44). SYC-439 (#229) changes colony creation in `teamColonies.ts`. PR 2.2 rebases on it if #229 merges first.

**Fit to 31 October (D2).** The launch plan has eight building days, from Tue 20 to the freeze on Wed 28. The honest picture:

- **The critical path** is 2.0 → 2.2 → 2.3 → 3.1 → 3.2. That's five PRs in a row, each with a review and a merge by Samuel in his two merge windows a day. It fits only if each one takes about a day and a half.
- **3.1 is the biggest PR,** so it's split:
  - **3.1a** covers the writer, undo, capabilities and the form;
  - **3.1b** covers the Vet settings page and its history (Task 3.1.2). It can be built in parallel from wave 2, because it needs only 2.3's setting.
- **Production migrations** for named areas, downloads and vet settings each need Samuel to switch the session to "ask" mode once. They can share one switch per publish day.
- **Publishes** are on Mon 19, Wed 21, Fri 23 and Mon 26, with the freeze publish on Wed 28 and fixes only on Thu 29 (`mvp-launch-31-oct.md`, merged as #172). A PR reaches the live site only at the next publish after it merges.
- **Samuel will merge on Sat 24 and Sun 25** (one window each day), so 3.3a–c are lined up for that weekend.
- **The test database** is shared by every parallel agent on this Mac. At most three building agents run at once.

**Verdict:**
- **Phase 2:** 2.0–2.4 fit. 2.5 and 2.6 (the map layers Samuel added) fit if their reviews find nothing large. 2.6 is the one to watch, because it changes the map script.
- **Phase 3:** 3.0, 3.1 and 3.2 fit.
- **The first to slip,** in D2's order, are 3.3a–c and 4.1.

Every PR here can go live any day after 31 October without a relaunch.

**Johnny's pack (copy freeze Thu 22).**
- The guardian words in 2.2 and 2.3 are written as soon as each PR starts, and posted to SYC-346 by Thu 22, before the code merges.
- 3.1's guardian line goes in the flagged second pack.
- If 2.3 starts after Thu 22, its guardian words go in the second pack too.

## Decisions this plan makes (within the approved spec)

Each one is a choice the spec leaves open. "What the team sees" says what it means for them.

1. **Home lives at `GET /api/team/home`, and `GET /api/team` stays the Queue.** Signing in lands on Home (`TEAM_HOME` and the sign-in hand-off change). The menu's Queue item keeps its address. *What the team sees:* Home opens first, and every old Queue link and email still works.
2. **Work lists with nothing behind them stay hidden on Home.** "Ask Syros Cats to match it", "Needs an OK" and "Matched by hand" have no records or pages yet (nothing writes `sightings.status = 'awaiting_team'`; confirmation items and SYC-152 are unbuilt).
   - Home gets a counter for `awaiting_team` now, which is always 0 today. Its section shows only when the count is above 0.
   - The other two sections arrive with their own tickets: SYC-152, and a new ticket for the confirmation queue.
   - *What the team sees:* Home never offers a link to a page that doesn't exist.
3. **The menu becomes Home · Cats · Map · Queue · Colonies · Reports · People** (§3.1, folding in SYC-450).
   - "Probably sterilised" becomes "Ear clips to check" (settles SYC-365). It leaves the menu along with Colour check and Feeding sites. Home links the two lists, and Feeding sites is linked from the Colonies list and the Map.
   - Reports appears in the menu with PR 3.3a.
   - The guardian menu is unchanged.
4. **Vet visits are an observation kind, `vet_visit`, not a new table.** Observations are already append-only, dated, attributed and correctable, and kinds are a list in code, so this needs no migration.
5. **A visit's sterilisation statement is `{ sterilised: true, clinic, vetVisitId, reason }`.** Today's `sterilised` value is just `{ sterilised }` plus optional `clinic` and `reason`; the spec's "existing `{ date, costEur }`" doesn't exist in code. The date is the row's `observedAt`, as for every statement. The **cost lives only on the visit**, so there's one source for money.
6. **D8 is done by making the visit's "yes" supersede the guardian's standing "no".**
   - That one row records the yes and marks the guardian row wrong, with the reason "vet visit on 13 Aug 2026". `listGuardianChanges` already shows such rows as "overruled".
   - Undoing the visit retracts that row. A new resolver rule (PR 3.0) makes a **retraction of a superseding row** stand the row it replaced up again, for `sterilised` and `vaccinated` only, so the guardian's statement comes back.
   - *What the team sees:* undo really is undo.
   - **A standing visit's "yes" always prevails** (Samuel, 21 Oct 2026, SYC-543). D8's supersede reaches only a guardian's "no" that stands when the visit is saved, so a team "no" dated after the visit, or any "no" entered later, would still have won. `resolveSterilised` therefore treats a standing `sterilised` row whose value carries `vetVisitId` as deciding the answer, whatever else is recorded. Only standing rows count (`standingRows`), so an undone visit decides nothing and every other answer stands again as before. Every "no" it outweighs is listed in the resolver's `conflicts`, so the team cat page shows it under *Says otherwise*. D8's visible overrule stays, so a guardian is never overruled silently. Cats with no visit keep exactly today's answer.
7. **A statement created by a visit can only be undone through the visit.** The generic "Mark wrong" refuses rows that carry a `vetVisitId`, with the words "This came from a vet visit. Mark the visit wrong instead." Otherwise a cat page and the vet report could disagree.
8. **The standard price is an app setting, `standard_sterilisation_price_eur`, defaulting to 60** (SYC-442). Its changes go into `mapping_events` as a new subject kind, `vet_settings`, the "same add-only history" §10.3 asks for.
   - PR 2.3 reads it for the planner's estimate.
   - PR 3.1 adds the page that changes it.
9. **Named areas move into a `named_areas` table** (migration `named_areas`). The first rows are seeded from today's 22 entries.
   - `areaFor` and `areaByKey` stay synchronous by reading a cache. The cache reloads after any write on this server, and at most 60 seconds later on every other server.
   - Their changes go into `mapping_events` as subject kind `named_area`.
   - `namedAreasAt(asOf)` rebuilds the list as it stood at any moment, so a report names its version and an old report never moves.
   - The public map's "Go to" list (`lib/mapTiles/areas.ts`) is a separate list, and stays untouched.
10. **"As of" means "entered by then".** A report as of time T uses only observations, sightings, cats, colony rows and welfare reports with `createdAt <= T`.
    - Known limit: a sighting entered before T but matched to a cat after T counts as matched, because matches aren't dated. That can move "last seen" lines, but not the impact report's sterilisation, colony or new-cat figures.
    - One exception: a record **redacted** for privacy after T stays gone. Privacy beats reproducibility.
    - The method note already says figures change as records are corrected.
11. **Welfare kinds never overlap on a chart.** Every report is in exactly one kind:
    - **Litter:** any report with kittens, whatever its urgency, so kitten counts are never split;
    - **Urgent:** urgent, without kittens;
    - **Needs attention:** everything else.
12. **Charts are SVG pictures drawn by the server, with no chart script.**
    - Each chart has a `<title>` on every mark for hover, and a "Show as table" `<details>` holding the exact numbers.
    - On a phone, the table is the tap-friendly way to see the numbers.
    - A tooltip script can follow later.
13. **The coverage map is a grid of 250 m squares drawn as SVG, without map pictures.** The squares with sightings trace the island's shape, and area names are written at their centres. It uses `blurPosition`'s 250 m cells from `lib/blur.ts`, so it lines up with the public grid.
14. **"Spend split by what was done" files each visit under its main purpose:** Sterilised if ticked, else Vaccinated, else Treated, else Checked. One visit is never counted twice.
15. **"No guardian" means** no active guardian placement on the colony **and** a blank `guardianName`. A colony whose guardian has no account yet is not flagged.
16. **A visit's clinic is stored by id, from the one clinic list** (`getGuidance("en").vets`, three clinics today). Older statements that have free-text clinics are left as they are.
17. **Find from a photo takes the photo as an ordinary file upload** (`multer`, held in memory only, one file of at most 10 MB). The form therefore works with no script.
    - The daily caps use the shared limiter's UTC day, so the words say "They reset overnight", not "at midnight".
    - The candidates' reference photos are their **display** photo, never a hidden one. The ids come from `catDisplayPhotoIds` (`lib/photoVisibility.ts:103`), and the bytes come from the photo's 640px medium version (`variantFor(id, "medium")`), not the full photo. That keeps 30 candidates small in memory and in the AI call. This also fixes SYC-303 for this route.

## Samuel's decisions on scope (18 Oct 2026)

Samuel answered these in this session on 18 Oct. Each is recorded on SYC-463.

| # | Question | Samuel's answer | What it means for the build |
|---|---|---|---|
| Q1 | When do cat guardians get their two reports (Sterilisation progress and Colony health, for their own colonies)? | **16 Nov** | At launch, the reports are team-only (PR 3.3a). The guardian variant and its Greek and French ship on 16 Nov, ticketed. |
| Q2 | Can the round form create a cat that isn't recorded yet? | **No: add him separately** | The round form adds existing cats only (PR 3.2). A new cat is added the usual way first. A shortcut is ticketed for 16 Nov. |
| Q3 | The map layers (colonies, welfare reports from the last 30 days, "Not looked at yet") and the Colonies list's Map view | **Before launch** | A new **PR 2.6** builds them (SYC-454 comes into the launch scope). |
| H | Should Home show what's on the way? | **Yes: "Home shows upcoming features"** | Home gets a short **Coming soon** line (Task 2.1.2). This changes Decision 2 for this one line only: the line names features, it doesn't link them. |
| W | Can Samuel merge on Sat 24 and Sun 25 Oct? | **Yes, one window each day** | The reports (3.3a–c) are lined up for those windows. The impact report (4.1) still most likely waits for Mon 26 or later. |

---

## Phase 2: what needs us today, and trapping rounds

### PR 2.0: Who is counted, in one place

**What the team sees:** nothing yet. This is the shared base for Home, the colonies and every report. Every figure counts cats the same way (§9.5).

#### Task 2.0.1: Every team cat, unfiltered, from the grid's own loader

**Files:**
- Modify: `artifacts/api-server/src/lib/teamCatList.ts`. Export the loader that `matchTeamCats` uses (`:149`) as `loadTeamCats`, add two fields, and drop merged-away duplicates.
- Test: `artifacts/api-server/src/lib/teamCatList.test.ts`

**Interfaces:**
- Consumes:
  - `loadCatRecords(ids)` (`lib/observations.ts:1003`);
  - `resolveCat` (`lib/resolve.ts:1532`);
  - `currentColonyOf` (`lib/colonyMembership.ts`);
  - `catIdentityTable` (`lib/db/src/schema/observations.ts`, `{ catId, canonicalCatId, supersedesId }`).
- Produces:

```ts
export interface TeamCat extends CatListItem {
  createdAt: Date;                       // cats.created_at: "new to the records"
  snapshot: CatSnapshot;                 // the resolved cat, for figures that need more than the card
  areaKey: string;                       // areaFor(placedAt).key; "off" for Off Syros
}
/** Every cat the team can see, active or not, resolved once. Merged-away halves are left out. */
export async function loadTeamCats(now?: Date): Promise<TeamCat[]>;
```

`listTeamCats` and `allTeamCats` keep their signatures and call `loadTeamCats`, then filter as now.

- [ ] **Step 1: Write the failing tests.**
  - `loadTeamCats` returns a presumed-deceased cat with `lives: "gone"`. The grid's default still hides it.
  - A cat with a `cat_identity` row whose `canonicalCatId` is another cat, and which no newer row supersedes, is **left out**. Its canonical cat stays.
  - `createdAt` equals the inserted `cats.created_at`.
  - `snapshot.sterilised` equals what `resolveCat` gives for the same observations.
  - Copy the seeding helpers `cat`, `say` and `sighted` from this file (`:41-90`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Move the body of `matchTeamCats` up to the point before filtering into `loadTeamCats`.
  - Add one query that reads the merged-away ids:

```sql
select ci.cat_id from cat_identity ci
where ci.canonical_cat_id <> ci.cat_id
  and not exists (select 1 from cat_identity n where n.supersedes_id = ci.id)
```

  - Leave those cats out before resolving.
- [ ] **Step 4: Run the whole `teamCatList.test.ts` and `team.catGrid.test.ts`, and see them pass.**
- [ ] **Step 5: Commit:** `SYC-396 PR 2.0: loadTeamCats, every cat resolved once, merged halves left out`

#### Task 2.0.2: `countedCats`, the §9.5 definitions

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/countedCats.ts`
- Test: `artifacts/api-server/src/lib/dashboard/countedCats.test.ts`. These are pure tests over hand-built `TeamCat` objects, so no database is needed.

**Interfaces:**
- Produces:

```ts
export const NOT_SEEN_LATELY_DAYS = 42;          // 6 weeks, spec §4.3 (Syros Cats may change it: SYC-442)
export type Split = Record<SterilisedMark, number>;
export const isStreet = (c: TeamCat): boolean => c.lives === "street" && c.areaKey !== "off";   // §3.3: Off Syros is never counted
export const isActive = (c: TeamCat): boolean => c.lives !== "gone";
/** Street cats with at least one resolved sighting, last seen NOT_SEEN_LATELY_DAYS or more ago. */
export function notSeenLately(cats: readonly TeamCat[], now: Date): TeamCat[];
export function splitOf(cats: readonly TeamCat[]): Split;          // street cats only
export interface Headline { street: number; split: Split; homed: number; inCare: number; at: Date }
export function headline(cats: readonly TeamCat[], now: Date): Headline;
/** Trapping "To do": street cats not confirmed sterilised, in the planner's order (§9.2). */
export function toDo(cats: readonly TeamCat[]): TeamCat[];
```

- [ ] **Step 1: Write the failing tests** with a `fake(over: Partial<TeamCat>)` builder:
  - `headline` counts only `street` cats in `street` and `split`. Homed and in-care cats are counted separately. `gone` cats appear nowhere.
  - `splitOf` sums to `street` (an invariant test over 200 seeded random cats).
  - `notSeenLately`:
    - a street cat last seen 43 days ago is in;
    - one seen 41 days ago is out;
    - one never sighted (`lastSeenAt: null`) is out;
    - a homed cat seen 100 days ago is out;
  - an Off Syros street cat (the Arizona test report's kind) is in **no** figure: not `street`, not `split`, not `homed`, not `notSeenLately`, not `toDo`. The split, the area totals and the headline must reconcile.
  - `toDo` order: `not_sterilised` first, then `not_known`, then `probably`. Within each group, newest `lastSeenAt` first, with nulls last. A `sterilised` cat is never in the list.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: See them pass.**
- [ ] **Step 5: Mutation probe:** change `isStreet` to `c.lives !== "gone"`. The headline test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.0: countedCats, the spec's who-is-counted rules in one module`

#### Task 2.0.3: The four-part bar

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/marks.ts` (add `markBar`, and its CSS in `MARK_CSS`)
- Test: `artifacts/api-server/src/lib/teamPages/marks.test.ts`

**Interfaces:**
- Produces: `markBar(split: Split, opts?: { label?: string }): string`, which returns trusted HTML.
  - It's one horizontal bar of up to four segments in `MARK_ORDER`. Each segment's width is proportional to its count, with a 2px gap between segments and rounded ends.
  - It's followed by a legend line in which every non-zero part has its shape icon, word and number: "89 Sterilised · 23 Probably · 18 Not known · 12 Not sterilised".
  - The bar carries `role="img"` and an `aria-label` made of the same words.
  - An all-zero split draws an empty outline and the words "No street cats yet".

- [ ] **Step 1: Write the failing tests:**
  - the widths sum to 100%;
  - every non-zero mark's word and number are in the text, so it's never colour alone;
  - the zero case;
  - no segment uses a colour outside `MARK_COLOUR`.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-396 PR 2.0: markBar, the four-part sterilisation bar`

### PR 2.1: Home

**What the team sees:** signing in opens **Home**, a page that reads top to bottom by urgency:
- welfare reports to act on, then "Report an issue" reports;
- the cats to check, with counts and the first photos;
- cats not seen lately;
- the island headline with its four-part bar;
- this month's figures, each against last month.

The menu becomes Home · Cats · Map · Queue · Colonies · People.

#### Task 2.1.1: The Home figures

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/home.ts`
- Test: `artifacts/api-server/src/lib/dashboard/home.test.ts` (database-backed)

**Interfaces:**
- Consumes:
  - `loadTeamCats`, `headline`, `notSeenLately` (PR 2.0);
  - `listWelfareQueue()` (`lib/welfareQueue.ts:343`);
  - `listLikelyForReview()` (`lib/likelyReview.ts:61`);
  - `listColourCheck()` (`lib/colourCheck.ts:92`).
- Produces:

```ts
export const HOME_NEEDS_LIMIT = 5;         // rows shown per Needs-us section
export const HOME_PHOTOS = 4;              // first photos per Cats-to-check list
export const DRAFT_WINDOW_HOURS = 24;
export interface MonthFigures { sightings: number; newCats: number; sterilisations: number }
export interface HomeData {
  needs: { reports: QueueReport[]; reportsTotal: number; unchecked: number; drafts: QueueDraft[]; issuesOpen: number; awaitingMatch: number };
  toCheck: { earClips: { count: number; photos: string[] }; colour: { count: number; photos: string[] } };
  notSeenLately: { cats: TeamCat[]; total: number };
  headline: Headline;
  month: { now: MonthFigures; last: MonthFigures };
}
export async function homeData(now?: Date): Promise<HomeData>;
export async function countAwaitingMatch(): Promise<number>;  // sightings.status = 'awaiting_team'
export async function countOpenIssues(): Promise<number>;     // welfare_reports kind='content', not draft, state in new|looking
export async function monthFigures(from: Date, to: Date, cats: readonly TeamCat[]): Promise<MonthFigures>;
```

- **Months** are calendar months in Athens time. Use the same Athens-date helper as `athensToday()` in `routes/teamCorrections.ts`; move it to `lib/athensTime.ts` if it isn't shared yet.
- **The three month figures:**
  - **sightings:** resolved sightings with `created_at` in the month;
  - **newCats:** `cats.created_at` in the month, merged-away halves excluded;
  - **sterilisations:** cats whose resolved `sterilised` is `confirmed` with `asOf` (the operation date) in the month.
- Vet spend joins in PR 3.1.

- [ ] **Step 1: Write the failing tests.** Assert deltas against a "before" read, because the database is shared:
  - a seeded urgent report shows before a newer "needs attention" report;
  - a draft started 25 hours ago is not in `drafts`, and one started 2 hours ago is;
  - a `kind='content'` row raises `issuesOpen` by 1, and its `done` state doesn't;
  - `awaitingMatch` counts a sighting inserted with `status='awaiting_team'`;
  - `earClips.count` equals `listLikelyForReview().length`;
  - `colour.count` counts only `group === "check"`;
  - a sterilisation dated 3 Oct counts in October's `sterilisations`, even when it was entered on 18 Oct;
  - one dated 28 Sep counts in last month.
- [ ] **Step 2: Fail. Step 3: Implement.** Run the queries in `Promise.all`. Log the elapsed milliseconds at the route (§9.6).
- [ ] **Step 4: Pass. Step 5: Commit:** `SYC-396 PR 2.1: homeData, the figures behind Home`

#### Task 2.1.2: The Home page and its route

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/homePage.ts`, `artifacts/api-server/src/routes/teamHome.ts`
- Modify:
  - `artifacts/api-server/src/routes/index.ts` (register `teamHome` after `team`);
  - `routes/team.walk.test.ts` (one row);
  - `lib/teamAuth/config.ts` (`TEAM_HOME` becomes `…/api/team/home`), plus its other user `middlewares/requireInvitee.ts:46`, and `lib/teamAuth/refuse.ts:108` (`TEAM_HOME_PATH` becomes `/api/team/home`, so "Back home" lands on Home);
  - `routes/team.ts` (the sign-in hand-off and `alreadySignedInAs` land on Home for holders of `view_welfare_queue`).
- Test: `artifacts/api-server/src/routes/team.home.test.ts`

**Interfaces:**
- Produces: `GET /api/team/home`, gated by `requireTeam("view_welfare_queue")`. It's island-wide, so guardians get the walk's default `forbidden`. Also `renderHomePage(d: HomeData, o: { personName: string; now: Date }): string`.

**The page** (§4, in this order). A section shows only when it has something:
1. **Needs us now:**
   - up to 5 reports from `needs.reports`, each one line: the report's photo through the queue's own photo URL (`QueueReport.photo.url`, because report photos have no small versions yet; SYC-403), `placeLabel`, `timeAgo`, and the first 80 characters of the note, escaped. Each links to its row in the Queue, `/api/team#r-<publicId>` (the queue anchors rows as `id="r-…"`, `queuePage.ts:252`). There is no page for a single report;
   - "N reports waiting for a check", from `queue.unchecked.reportsTotal`, linking to the Queue, so reports accepted while the bot check was down are never missed;
   - "See all N in the Queue" → `/api/team`;
   - "Started but not sent (N)", listing the last 24 hours' drafts;
   - "Problems reported with photos or names (N)" → `/api/team#issues`;
   - "Sightings waiting for a match (N)", only when N > 0, linking to `/api/team/cats` until a match page exists.
2. **Cats to check:**
   - "Ear clips to check (N)" → `/api/team/likely`;
   - "Colour check (N)" → `/api/team/colour-check`;
   - each with up to 4 small photos.
3. **Not seen lately:** up to 6 cards (small photo, name, colony, "Last seen 9 weeks ago · Galissas"), then "and N more" linking to `/api/team/cats?lives=street&lastSeen=over3`. The words say it's a prompt to ask the guardian, never a death.
4. **The headline:** "142 street cats known on Syros" as a large figure, then `markBar(headline.split)`, then "As of 18 Oct 2026, 16:40". Below it, the line "Also 31 cats with homes and 4 in care".
5. **This month:** three small figures, each with last month's in brackets: "Sightings 214 (last month 187)".
6. **Coming soon** (Samuel, 18 Oct): one quiet line at the foot of Home, for example "Coming soon: vet visits · reports · Find from a photo · editable areas". It has no links. The list is a constant, `COMING_SOON: { label: string; route: string }[]`, in `homePage.ts`, with one entry per feature that isn't merged yet:

   | Label | Route |
   |---|---|
   | editable areas | `GET /api/team/areas` |
   | Find from a photo | `GET /api/team/cats/find` |
   | trapping plans | `GET /api/team/colonies/:id/plan` |
   | vet visits | `GET /api/team/cats/:id/vet-visit` |
   | reports | `GET /api/team/insights` |
   | the impact report | `GET /api/team/insights/impact` |

   **The PR that builds each route removes its entry.** A test keeps that honest: it fails if any `COMING_SOON` route is in `team.walk.test.ts` `TABLE`, which means the feature has arrived but the line still says "coming". When the list is empty, the line disappears.
- **Nothing to act on:** "Nothing needs you right now." The headline and This month still show.
- **A failed figure:** the section shows "This figure isn't available right now" and the rest of the page still draws. Each section's data is read in its own `try`.

- [ ] **Step 1: Write the failing tests:**
  - a team member gets 200 and the sections in order (assert index order in the HTML);
  - a guardian gets 403;
  - signing in lands on `/api/team/home` (copy the hand-off test from `team.handoff.test.ts`, and update the landing assertions in `team.my.test.ts` and `team.realBrowsers.test.ts`);
  - an empty Needs section is absent;
  - the headline is tested in `renderHomePage` against a hand-built `HomeData`, not by reading the island twice, because the database is shared;
  - **no response time, "open for", per-person count or name of a team member appears anywhere** (a regex list of "minutes open", "response", "by Jacky");
  - a forced throw in one section's loader still renders the page with the fallback line. `homeData` takes its loaders as an optional `deps` argument, so the test injects a throwing one; `vi.spyOn` can't intercept a call inside the same module;
  - the Not-seen-lately cards use `/small` cat thumbnails.
  - **the Coming soon guard:** with a fake `TABLE` entry for `GET /api/team/areas`, the test fails. Without it, it passes. Remove the fake entry afterwards. This is the guard's mutation probe;
  - the Coming soon line holds no `<a`.
- [ ] **Step 2: Fail. Step 3: Implement** following the `routes/teamCorrections.ts:788` GET pattern. **Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** remove the per-section `try` around Needs. The forced-throw test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.1: Home, the first page after signing in`

#### Task 2.1.3: The menu, and "Ear clips to check"

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamPages/layout.ts`: `NavKey` gains `"home"`. The `NAV` array becomes Home `/api/team/home`, Cats, Map, Queue `/api/team`, Colonies, then People when shown. Likely, Colour check and Feeding sites leave it. Their pages pass `active: null`, or the nearest parent: Colour check and Ear clips use `"home"`, and Feeding sites uses `"colonies"`.
  - `lib/teamPages/likelyPage.ts`: the title and heading become "Ear clips to check". The explanation line keeps its wording.
  - (The "Feeding sites" link under the Colonies title is added by PR 2.2, which owns `colonyPages.ts` in this wave. Until 2.2 merges, Feeding sites stays reachable from the Map's layer and from each colony.)
  - The tests that pin menu labels: `lib/teamPages/layout.test.ts`, and any other found by `grep -rn "Probably sterilised" src`.
- Test: `artifacts/api-server/src/lib/teamPages/layout.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the team menu is exactly the six labels in order;
  - the guardian menu is unchanged;
  - `/api/team/likely` is titled "Ear clips to check";
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** then run the whole api-server suite, because menu words appear in many tests.
- [ ] **Step 5: Look at it:** screenshots at 390px and 1280px of Home with seeded data, saved to `docs/screenshots/syc-396-pr-2-1/`. Check: the menu row slides on a phone, nothing else scrolls sideways, tap targets are 44px, and no text is under 12px.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.1: the menu names the team's jobs; Ear clips to check (SYC-365, SYC-450)`

**Linear after merge:** close SYC-365 and SYC-450. File "Home: Needs an OK section once confirmation items exist", and link SYC-152 for "Matched by hand".

### PR 2.2: The Colonies list, with progress and flags

**What the team sees:** each colony card shows its guardian, a four-part progress bar of its street cats with "% confirmed sterilised", the number of cats, the latest sighting, and flags in words: Growing, Kittens reported, No guardian, Not visited lately. The list sorts by name, by fewest confirmed sterilised, or by latest activity. Cat guardians see the same cards for their own colonies, in their language, with the Kittens flag counting only reports tied to their cats.

#### Task 2.2.1: Colony figures

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/colonyFigures.ts`
- Modify: `artifacts/api-server/src/lib/guardianView.source.test.ts` (add the new module to `FILTERED_MODULES`)
- Test: `artifacts/api-server/src/lib/dashboard/colonyFigures.test.ts`

**Interfaces:**
- Consumes: `loadTeamCats`, `splitOf`, `isStreet` (PR 2.0); `Visible`, `colonyFilter`, `covers`, `isIslandWide` (`lib/guardianView.ts`); `listColonies(visible, q)` (`lib/teamColonies.ts:77`).
- Produces:

```ts
export const GROWING_DAYS = 90, GROWING_MIN = 3, KITTENS_DAYS = 60, KITTENS_RADIUS_M = 300, NOT_VISITED_DAYS = 30;
export type ColonyFlag = "growing" | "kittens" | "no_guardian" | "not_visited";
export interface ColonyFigures {
  colonyId: number; street: number; split: Split; confirmedPct: number | null;  // null when street = 0
  catCount: number; latestSightingAt: Date | null; flags: ColonyFlag[];
}
export async function colonyFigures(visible: Visible, opts: { island: boolean }, now?: Date): Promise<Map<number, ColonyFigures>>;
```

**The rules** (§9.1):
- **Growing:** cats whose **first** `colony` observation is this colony **and** whose `cats.created_at` is in the last 90 days number at least 3, and more than in the 90 days before. A cat moved in from another colony has an earlier colony row elsewhere, so it doesn't count.
- **Kittens reported:**
  - **island** viewers: `welfare_reports` with `kind='welfare'`, `is_litter`, not a draft and `submitted_at` in the last 60 days, **either** with `cat_id` in this colony, **or** within 300 m of one of the colony's feeding sites that isn't retired. Copy the SQL haversine from `lib/feedingSiteProximity.ts`;
  - **guardian** viewers: only the reports tied to a cat in the colony (§10.2).
- **No guardian:** no `person_scopes` row with `role='guardian'` for the colony that is unexpired, **and** a blank `guardianName` (Decision 15).
- **Not visited lately:** no resolved sighting of any of the colony's current cats in 30 days. A colony with no cats isn't flagged.

- [ ] **Step 1: Write the failing tests:**
  - **Growing** fires at 3 new cats against 1 in the previous window, not at 3 against 3, and not for 3 cats moved in from another colony;
  - **Kittens:** a litter report 250 m from a site flags the colony for the team but **not** for a guardian of it; a litter report tied to her cat flags it for both; a report 350 m away doesn't flag it; a draft doesn't flag it;
  - **No guardian:** an expired placement with a blank name is flagged; a free-text name isn't;
  - **Not visited:** 31 days is flagged, 29 isn't;
  - a guardian's `Visible` never returns another colony's figures;
  - `confirmedPct` is null with 0 street cats.
- [ ] **Step 2: Fail. Step 3: Implement.** Use one query per rule over all visible colonies, never one per colony. **Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** drop the `opts.island` check on the 300 m branch. The guardian Kittens test **must** go red. Restore it. Also run `guardianView.source.test.ts` with the module left out of `FILTERED_MODULES`: it **must** go red.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.2: colonyFigures with the four flags`

#### Task 2.2.2: The cards and the sort

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamPages/colonyPages.ts`: `renderColoniesPage` takes `figures: Map<number, ColonyFigures>` and `sort`, and draws each card with `markBar`. A "Feeding sites" link sits under the title for island-wide viewers (moved here from 2.1.3, so only this PR touches `colonyPages.ts` in wave 2).
  - `routes/teamColonies.ts`: read `sort` (`name` | `fewest` | `recent`; anything else means `name`), and call `colonyFigures(v.visible, { island: v.island })`.
  - `lib/teamPages/strings/{en,el,fr}.ts`: new keys under `colonies.` for the four flags, "% confirmed sterilised", "Latest sighting", the three sort words, and "No street cats yet".
- Test: `routes/team.colonies.test.ts`, `routes/team.guardianView.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - a card shows its bar, its percentage and its flag words;
  - `?sort=fewest` orders by `confirmedPct` ascending, with nulls last;
  - `?sort=Eleni` falls back to name;
  - a guardian's page shows only her colonies, in her language when Greek is live. Assert the key appears, through `tr`;
  - the JSON variant gains `figures`.
  - Each flag has an icon **and** a word, so it's never colour alone.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `strings.test.ts`.
- [ ] **Step 5: Look at it** at 390px and 1280px, saved to `docs/screenshots/syc-396-pr-2-2/`.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.2: Colonies list shows progress, flags and a sort`

**After merge:** add the new `colonies.` keys to SYC-346's pack list.

### PR 2.3: The trapping planner (after 2.2 merges)

**What the team sees:** a colony page now leads with what a round needs:
- **To do:** every street cat here not confirmed sterilised. "Not sterilised" comes first, then "Not known", then "Probably", most recently seen first in each group. Each cat shows its photo, name, colours, usual place, last seen, and "ear clip seen" where that applies.
- **The estimate:** "7 cats × €60 = €420".
- The colony's feeding sites on a small map.
- A **printable plan**.
- **Done:** the sterilised cats, folded away.

"Take out of this colony" moves into each cat's own small menu. Cat guardians see the To-do list for their colonies, without the estimate, the print or (later) round logging.

#### Task 2.3.1: The standard price setting, and three capabilities

**Files:**
- Modify:
  - `lib/db/src/appSettings/shape.ts`: `SETTING_KEYS` gains `"standard_sterilisation_price_eur"`, and `settingShapeProblem` accepts an integer from 1 to 500.
  - `artifacts/api-server/src/lib/appSettings.ts`: `AppSettings` gains `sterilisationPriceEur: number`, default `60`.
  - `artifacts/api-server/src/lib/capabilities.ts` gains `view_vet_costs: { kind: "island", roles: TEAM }` and `print_trapping_plan: { kind: "island", roles: TEAM }`.
  - `docs/specs/roles-and-invites.md` §6.2 gains the two rows, under "Seeing": `| \`view_vet_costs\` | See vet costs, who paid, and estimates | Island-only | ✓ | ✓ | — |` and `| \`print_trapping_plan\` | Print a colony's trapping plan | Island-only | ✓ | ✓ | — |`.
  - `docs/specs/team-dashboard-redesign.md` §10.3 gains the `print_trapping_plan` row, with a line noting it was added by this plan.
- Test: `lib/db/src/appSettings/dbOps.settings.test.ts` (or a new `shape.test.ts` beside it), `lib/appSettings.test.ts`, `lib/capabilities.catalogue.test.ts`

- [ ] **Step 1: Failing tests:**
  - the shape refuses `0`, `501`, `"55"` and `55.5`;
  - a bad stored value falls back to 60;
  - the catalogue test passes only once **both** files have the rows. Prove it by adding the code row alone first, so the test goes red, then adding the spec row.
- [ ] **Step 2–4: Fail, implement, pass. Step 5: Commit:** `SYC-396 PR 2.3: standard price setting; view_vet_costs and print_trapping_plan`

#### Task 2.3.2: The planner's data

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/trappingPlan.ts`
- Modify: `lib/guardianView.source.test.ts` (`FILTERED_MODULES`)
- Test: `artifacts/api-server/src/lib/dashboard/trappingPlan.test.ts`

**Interfaces:**
- Consumes: `loadTeamCats`, `toDo` (PR 2.0); `catsInColony(colonyId)`; `publicLabelOf`, `placeLabel` (`lib/areas/placeLabel.ts`); `getAppSettings()`.
- Produces:

```ts
export const USUAL_SITE_RADIUS_M = 300;
export interface PlanCat extends TeamCat { usualPlace: string; earClipSeen: boolean }
/** What a guardian's planner may hold: an explicit field list, never a TeamCat with fields hidden.
 * No lastSeen, placedAt, place or snapshot: those carry or derive from sighting positions. */
export interface GuardianPlanCat { id: number; name: string; syr: string; photoPublicId: string | null; coat: CoatColour[]; pattern: CoatPattern | null; mark: SterilisedMark; lastSeenAt: Date | null; usualPlace: string; earClipSeen: boolean }
export function forGuardian(c: PlanCat): GuardianPlanCat;   // copies the listed fields only
export interface TrappingPlan {
  colonyId: number; toDo: PlanCat[] | GuardianPlanCat[]; done: PlanCat[] | GuardianPlanCat[];   // guardian: GuardianPlanCat only
  estimate: { cats: number; priceEur: number; totalEur: number } | null;   // null unless island
  sites: { id: number; lat: number; lng: number; publicLabel: PublicLabel | null }[];
}
export async function trappingPlan(visible: Visible, colonyId: number, opts: { island: boolean }, now?: Date): Promise<TrappingPlan | null>;
```

- **`usualPlace`:** the colony's nearest feeding site that isn't retired, within 300 m of the cat's reference point, gives `placeLabel(site, publicLabelOf(site))`. Otherwise it's `placeLabel(reference point)`.
  - The reference point is the **last sighting for the team**, and the **discovery position (`cats.lat/lng`) for a guardian** (§10.2: never sighting positions).
  - **The site's internal `name` is never read.**
- **`earClipSeen`:** `snapshot.sterilised.clippedTipSightings > 0`.

- [ ] **Step 1: Failing tests:**
  - order and grouping as in `toDo`;
  - a homed cat is never in To do;
  - for a guardian, `usualPlace` uses the discovery position: seed a cat whose last sighting is next to a site with a **public label**, and whose discovery position is 2 km away in another area, and assert the guardian's label is the other area;
  - `estimate` is null for a guardian, and `7 × 60 = 420` for the team;
  - a colony outside `visible` returns null;
  - **no `PlanCat.usualPlace` ever contains a site's internal name:** seed the site named "Vaporia — Eleni's" with the public label "harbour steps";
  - **the serialised guardian plan** (`JSON.stringify` of what the guardian's page and its JSON variant receive) has no `lastSeen`, `placedAt`, `place` or `snapshot` key, and no number with 4 or more decimals.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** make the guardian branch use the last sighting. The guardian `usualPlace` test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.3: trappingPlan, To do, Done and the estimate`

#### Task 2.3.3: The colony page leads with the plan, and the printable plan

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamPages/colonyPages.ts`: `renderColonyPage` takes `plan: TrappingPlan`.
    - New order: To do, the estimate, sites on a small map (`renderMap({ mode: "view", view: fitView(sites), markers, controls: false })` from `lib/teamPages/map.ts:248`, with square site markers), the "Print the plan" link (only if `may("print_trapping_plan")`), Done folded, then the guardian, notes and history as now.
    - "Take out of this colony" moves into a `<details>` menu on each cat row.
  - `routes/teamColonies.ts`: `GET /team/colonies/:id` reads `trappingPlan`. Add `GET /team/colonies/:id/plan`, gated by `requireTeam("print_trapping_plan")`.
  - `lib/teamPages/strings/{en,el,fr}.ts`: the guardian-visible To-do words.
  - `routes/team.walk.test.ts`: a row for `/plan` (team only).
- Create: `artifacts/api-server/src/lib/teamPages/planPrintPage.ts`, a print-first page with `@media print` CSS: photos, names, colour words and place labels, no menu, **no positions and no Open map**, and the footer "Syros Cats · printed 18 Oct 2026 · for the team only".
- Test: `routes/team.colonies.test.ts`, `routes/team.colonyPlan.test.ts`, `routes/team.guardianView.test.ts` (add the colony page to `hers()` if it isn't there)

- [ ] **Step 1: Failing tests:**
  - the To-do section comes before the sites;
  - the estimate shows for the team and never for a guardian;
  - "Every street cat here is sterilised." when To do is empty;
  - `/plan`:
    - holds no `\d+\.\d{4,}` (a coordinate), no map-company address, and no internal site name;
    - a guardian gets 403;
    - the page's own `<title>` doesn't hold the colony name in the address, so the route stays `/colonies/:id/plan`.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `lib/teamPages/positions.source.test.ts` and `lib/teamPages/position.guard.source.test.ts`.
- [ ] **Step 5: Look at it** at 390px and 1280px, and print-preview `/plan` to PDF in Chrome. Check the margins and the white background. Save to `docs/screenshots/syc-396-pr-2-3/`.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.3: the colony page is a trapping planner, with a printable plan`

### PR 2.4: Named areas the team can edit (migration `named_areas`)

**What the team sees:** an **Areas** page, linked from Home's footer and from the Cats filters.
- It lists every named area with its centre and the number of cats nearest it.
- The team can add an area, rename one, or move its centre.
- Each change is kept in a history with who made it and when.
- Every place label and filter uses the new list within a minute.
- Old reports keep the version they used.

#### Task 2.4.1: The table, the seed and the history kinds

**Files:**
- Create: `lib/db/src/schema/namedAreas.ts`, exported from `lib/db/src/schema/index.ts`:

```ts
export const namedAreasTable = pgTable("named_areas", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),         // short key in addresses, e.g. "kini"; never changes
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("named_areas_key_ck", sql`${t.key} ~ '^[a-z][a-z0-9-]{1,30}$'`)]);
```

- Modify: `lib/db/src/schema/mappingEvents.ts`.
  - `MAPPING_SUBJECT_KINDS` gains `"named_area"`.
  - `MAPPING_EVENT_KINDS` gains `"area_added"`, `"area_renamed"`, `"area_moved"` and `"area_retired"`.
- Create: `lib/db/migrations/NNNN_named_areas.sql` (the next free number), generated, then edited by hand:
  - widen `mapping_events_subject_kind_ck` and `mapping_events_kind_ck` to the new values **first**, so the seed events are allowed;
  - insert today's 22 rows from `NAMED_AREAS`, in the same order, with the same keys;
  - write one `area_added` event per row with `actor_system = 'system:migration'`, `after = {key,name,lat,lng}`, and **`at = '2026-10-15T00:00:00Z'`**, the day version 1 was approved. Then `namedAreasAt` for any date from then on gives the seed list. For earlier dates, `namedAreasAt` falls back to `SEED_AREAS` with version 0, so a report reaching back before the table still has areas;
  - a partial unique index on `lower(name) where retired_at is null`, so two areas can't share a name in a race;
  - the key check also refuses `off`, which is reserved for Off Syros;
  - a commented rollback.
- Test: `lib/db/src/migrate/namedAreas.test.ts`. It uses its own throwaway database, applies the migration, and checks 22 rows, 22 events, and that the history trigger still refuses an update.

- [ ] **Step 1: Failing test. Step 2: Fail. Step 3: Implement** with `pnpm --filter @workspace/db run generate --name named_areas`, then the seed SQL. **Step 4: `migrate:check` and the test pass. Step 5: Commit:** `SYC-396 PR 2.4: named_areas table, seeded with the first 22 areas (migration `named_areas`)`

#### Task 2.4.2: The cache, `namedAreasAt` and the writer

**Files:**
- Modify: `artifacts/api-server/src/lib/areas/namedAreas.ts`.
  - `NAMED_AREAS` becomes `SEED_AREAS`, still exported, used for tests and as the fallback before the first load.
  - Add the cache.
- Create: `artifacts/api-server/src/lib/areas/areaWrites.ts`
- Modify:
  - `artifacts/api-server/src/index.ts`: `await loadAreas()` before `listen`;
  - `lib/guardianView.source.test.ts`: `ISLAND_ONLY_MODULES` gains `areaWrites.ts` and `namedAreasAt`, with capability `edit_named_areas`.
- Test: `lib/areas/namedAreas.cache.test.ts`, `lib/areas/areaWrites.test.ts`

**Interfaces:**
- Produces:

```ts
export const AREAS_TTL_MS = 60_000;
export function currentAreas(): readonly NamedArea[];                 // sync, from the cache
export function areasVersion(): number;                               // count of named_area events
export async function loadAreas(): Promise<void>;                     // fills the cache
export function areaFor(lat: number, lng: number): NamedArea | typeof OFF_SYROS;   // unchanged signature, reads the cache
export const areaByKey: (key: unknown) => NamedArea | undefined;     // unchanged signature
export function areaForIn(areas: readonly NamedArea[], lat: number, lng: number): NamedArea | typeof OFF_SYROS;  // pure
export async function namedAreasAt(at: Date): Promise<{ version: number; areas: NamedArea[] }>;
// areaWrites.ts
export type AreaChange =
  | { kind: "add"; key: string; name: string; lat: number; lng: number }
  | { kind: "rename"; key: string; name: string }
  | { kind: "move"; key: string; lat: number; lng: number }
  | { kind: "retire"; key: string };
export async function changeArea(person: Person, change: AreaChange): Promise<void>;
```

- **The cache refreshes** when it's older than `AREAS_TTL_MS`, triggered by the next `areaFor` call, without blocking. It also refreshes at once after `changeArea` on this server.
- **`namedAreasAt(at)`** replays the `named_area` events with `at <= at`, using each event's `after`. `version` is the number of those events.
- **`changeArea`** runs in one transaction: lock the row, check the change, update `named_areas`, then `recordMappingEvent(tx, { subjectKind: "named_area", subjectId: row.id, kind, personId, before, after })`. **`before` and `after` always hold the whole row** (`{key, name, lat, lng, retired}`), for every kind, so `namedAreasAt` can replay from `after` alone.
- **The version** is the number of `named_area` events, starting at 22 for the seed. The old constant `AREAS_VERSION = 1` (`namedAreas.ts:13`) is removed, and every reader moves to `areasVersion()`.
- **`namedAreasAt` reads `mapping_events`,** so it lives in its own module, `lib/areas/areaHistory.ts`. That module is registered in `ISLAND_ONLY_MODULES`, with the capability that guards each route calling it (`edit_named_areas` for the Areas page, `view_reports` for the reports). The cache in `namedAreas.ts` reads only `named_areas`, so the many routes that use `areaFor` stay outside the source test's lists.
- **A failed cache reload** keeps the last good list and logs a warning. It never empties the list.
  - A new or moved centre must be on Syros: inside the box lat 37.36–37.52, lng 24.86–24.99.
  - A name is 2–40 characters, and unique among the areas that aren't retired.

- [ ] **Step 1: Failing tests:**
  - `areaFor` gives the same answers as before for every seed centre;
  - after `changeArea(move)`, `areaFor` at the old centre gives the moved area **on this server immediately**;
  - after a simulated 61 s (`vi.setSystemTime`), a second process-local cache also sees it. Clear the module and load it again;
  - **every test that writes areas uses its own per-run key** (`vt-<RUN>-…`, with the key check relaxed only for the test prefix, through a test-only seed helper) and never moves, renames or retires a seed row. Otherwise every later file in the run would see a moved Kini;
  - `namedAreasAt` before the move gives the old centre and `version` 22; after it, the new centre and `version` 23;
  - a centre at Mykonos (37.45, 25.33) is refused;
  - a duplicate name is refused;
  - a retired area drops out of `currentAreas` but stays in `namedAreasAt` for earlier dates.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** then run every existing `namedAreas*.test.ts`, `placeLabel*.test.ts` and `teamCatList.test.ts` unchanged.
- [ ] **Step 5: Mutation probe:** make `namedAreasAt` ignore `at`. The "before the move" test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.4: areas come from the table, with a cache and a version history`

#### Task 2.4.3: The Areas page and `edit_named_areas`

**Files:**
- Modify:
  - `lib/capabilities.ts` gains `edit_named_areas: { kind: "island", roles: TEAM }`;
  - `docs/specs/roles-and-invites.md` §6.2 gains its row: `| \`edit_named_areas\` | Add, rename or move a named area | Island-only | ✓ | ✓ | — |`.
- Create: `artifacts/api-server/src/lib/teamPages/areasPage.ts`, `artifacts/api-server/src/routes/teamAreas.ts`
- Modify:
  - `routes/index.ts`;
  - `routes/team.walk.test.ts` (`GET /api/team/areas` and `POST /api/team/areas` are team-only);
  - `lib/teamPages/position.guard.source.test.ts` `ALLOWED` gains `areasPage`.
  - `lib/teamPages/positions.source.test.ts`, which this page must pass.
- Test: `routes/team.areas.test.ts`

**The page:**
- One row per area: its name, its centre through `position(lat, lng, { link: isIslandWide(person) })`, the number of active cats nearest it, and "Rename" and "Move centre" forms.
- An "Add an area" form: name, key, and latitude and longitude typed in.
- "Retire", behind `renderConfirmPage`.
- The history below, newest first: "18 Oct 2026, 16:40 · Jacky · moved Kini's centre".
- The footer says: "Each change makes a new version. Reports name the version they used. This is version 23."

- [ ] **Step 1: Failing tests:**
  - a team member can add, rename, move and retire;
  - a guardian gets 403 on GET and POST;
  - a POST without the Origin check is refused (copy from `team.sites.test.ts`);
  - an empty name is named next to its field, and the form keeps what was typed;
  - **no position appears in any of our own `href` or `action` values:** collect every `href` and `action`, drop the Open map links (`https://www.google.com/maps/…`, which D9 allows for island-wide viewers), and assert that none of the rest matches `\d+\.\d{4,}`. A guardian never reaches the page;
  - the Areas page is reachable: Home's footer links it (an edit to `homePage.ts`, so this task rebases on 2.1 if 2.1 has merged; otherwise 2.1 adds the link), and the Cats filters' area select has "Change the areas" beside it (`catGridPage.ts`).
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Screenshots** at 390px and 1280px. **Step 6: Commit:** `SYC-396 PR 2.4: the Areas page`

**After merge:** reply on SYC-442 that the list can now be corrected on the Areas page.

### PR 2.5: Find from a photo

**What the team sees:** on the Cats page, **Find from a photo**.
- Choose or take a photo, then pick an area or a colony, and colours if you can. The page says how many cats that leaves ("34 cats to compare"). Over 30, it asks you to narrow it first.
- It then shows the closest cats beside your photo as **Very likely**, **Possible** or (folded away) **Unlikely**, with the reminder to check the photos yourself.
- From a welfare report, you can tie the report to the cat you pick.
- Each person has 20 searches a day, and the team 100.
- The photo isn't kept.

#### Task 2.5.1: The search itself

**Files:**
- Create: `artifacts/api-server/src/lib/findFromPhoto.ts`
- Test: `artifacts/api-server/src/lib/findFromPhoto.test.ts`. It replaces `matchCatPhoto` with `vi.mock("./matching")`, as the sighting tests do.

**Interfaces:**
- Consumes:
  - `matchCatPhoto(newPhotos, candidates)` (`lib/matching.ts`);
  - `MAX_CANDIDATES = 10` (`lib/candidateSelection.ts:18`);
  - `validatePhotoBase64` (`lib/imageValidation.ts`), which re-encodes the photo and drops EXIF and GPS;
  - `catDisplayPhotoIds` (`lib/photoVisibility.ts:103`) for which photo to use, and `variantFor(photoId, "medium")` (`lib/photoVariants.ts`) for its bytes;
  - `allTeamCats` with `{ area | colony, colours }` (unpaged; `listTeamCats` stops at 48).
- Produces:

```ts
export const FIND_MAX_CATS = 30, FIND_GROUPS = 3, FIND_FINALISTS_PER_GROUP = 3;
export const VERY_LIKELY = 0.8, POSSIBLE = 0.5;
export type Band = "very_likely" | "possible" | "unlikely";
export const bandOf = (score: number): Band => score >= VERY_LIKELY ? "very_likely" : score >= POSSIBLE ? "possible" : "unlikely";
export type FindOutcome =
  | { kind: "too_many"; count: number } | { kind: "none_to_compare" }
  | { kind: "not_a_cat" } | { kind: "matching_down" }
  | { kind: "results"; compared: number; results: { catId: number; score: number; band: Band; reasoning: string }[] };
export async function findFromPhoto(photo: Buffer, filters: Pick<CatListFilters, "area" | "colony" | "colours">, now?: Date): Promise<FindOutcome>;
```

**The steps (§5.2):**
1. Refuse to search without an area or a colony.
2. List the active cats matching the filters. Over 30 gives `too_many`. None gives `none_to_compare`.
3. `validatePhotoBase64(photo.toString("base64"))`. Its re-encoded buffer is what gets sent.
4. Split the cats into groups of up to 10 (at most 3), each candidate with its display photo's bytes, and call `matchCatPhoto([{ role: "first", ... }], group)` once per group. A group whose `isCatPhoto` is false gives `not_a_cat`.
5. Take the best 3 from each group and run **one final round** with them together. The final scores are the ones shown.
6. Any thrown error gives `matching_down`.
- There are never more than 4 AI calls.
- **Nothing is written to `photos`, `sightings` or `observations`.**

- [ ] **Step 1: Failing tests:**
  - 31 cats gives `too_many`, with **no** call to the mock;
  - 25 cats make exactly 3 group calls plus 1 final call;
  - a candidate whose main photo is hidden is sent with its display photo, never the hidden bytes. Assert the mock's arguments;
  - the bands sit at 0.8 and 0.5 exactly;
  - a mock that throws gives `matching_down`;
  - **nothing is stored:** after a search, there's no `photos` row created since the search began, no `sightings` row and no `observations` row. The test checks rows with `created_at >=` the search start, never absolute counts, because the database is shared. The mock also records that no write helper (`writeObservation`, photo insert) was called, through spies on those modules;
  - the buffer sent has no EXIF: feed a JPEG with a GPS tag from `imageValidation.exif.test.ts`'s fixture, and assert `sharp(sent).metadata()` has no `exif`.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probes:**
  - send the raw upload instead of the validated buffer: the EXIF test **must** go red;
  - use `primaryPhotoId` instead of the display photo: the hidden-photo test **must** go red.

  Restore both.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.5: findFromPhoto, narrowed, grouped, with a final round`

#### Task 2.5.2: The page, the upload and the caps

**Files:**
- Modify:
  - `artifacts/api-server/package.json`: add `multer@^2` and `@types/multer`. Check the latest 2.x release and its advisories on the day.
  - `lib/capabilities.ts` gains `find_cat_from_photo: { kind: "island", roles: TEAM }`, and roles §6.2 gains its row: `| \`find_cat_from_photo\` | Search the cats of an area or colony with a photo | Island-only | ✓ | ✓ | — |`.
  - `middlewares/rateLimit.ts`: `declareLimit("find_photo_person", 20, DAY_MS, { sliding: true })` and `declareLimit("find_photo_team", 100, DAY_MS, { sliding: true })`. Sliding windows, as `checkClaimLimit` uses, can't be doubled across a fixed window's edge. Also `checkFindLimits(personId): Promise<"ok" | "person" | "team">`, which consumes both, person first;
  - `lib/teamPages/catGridPage.ts`: a "Find from a photo" link above the grid, carrying the current area or colony. `lib/teamPages/queuePage.ts`: on a report row, "Find this cat from the report's photo" links to the form with `tie=<publicId>`. This edit is coordinated with SYC-44 7.1, which owns `queuePage.ts` this week. If 7.1 hasn't merged, it is left to a follow-up;
  - `routes/teamCats.ts`: the two `/team/cats/find` routes are registered **before** `GET /team/cats/:id` (`teamCats.ts:219`), so `find` is never read as a cat id.
  - `routes/teamCats.ts`: `GET /team/cats/find` (the form and the count) and `POST /team/cats/find` (multipart).
  - `routes/team.walk.test.ts`: two rows, team only.
- Create: `artifacts/api-server/src/lib/teamPages/findPhotoPage.ts`
- Test: `routes/team.findPhoto.test.ts`

**Route details:**
- The POST is `requireOrigin(TEAM_ORIGIN)`, then `requireTeam("find_cat_from_photo")`, then `setTeamHeaders`, then `multer({ storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } }).single("photo")`.
- The filters arrive as form fields and are parsed with `parseCatFilters`.
- The upload is parsed first, because the narrowing fields arrive in the same form. The limits are checked **after** the narrowing check, so a refused narrowing doesn't use up a search, and **before** any AI call.
- A `MulterError` (too large, too many files) is caught by an error handler on this route only. It answers 413 or 400 with the page and words, never the app's generic JSON 500 (`app.ts` `jsonErrorHandler`).
- A `tie` field (a welfare report's `publicId`) is carried through, and each result gets "This is the cat", which posts to the existing tie route with the fields that route expects, including `expectedCatId` (`teamReports.ts:396`).
- The result page is the POST's response, so no address ever holds a result, a photo or a position.
- The words are §5.2's, plus "You've used today's 20 searches. They reset overnight." (Decision 17) and "The team has used today's 100 searches." The cap words show once a cap is reached.
- **"Show unlikely matches"** is a `<details>`.

- [ ] **Step 1: Failing tests:**
  - a guardian gets 403;
  - a team member's 21st search in one day is refused with the words, and the mock isn't called;
  - an upload over 10 MB gets 413 with words, not a crash;
  - a missing area and colony is named next to the field;
  - the response holds the "less sure than the app's matching" sentence;
  - from `?tie=<publicId>`, the "This is the cat" form posts to `/api/team/reports/<publicId>/cat`;
  - **the access log line for the POST holds no file name** (assert on the pino test transport);
  - `team.headers.test.ts` still sees the strict security header on this page, because it has no script.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** swap the limiter order so the team bucket is consumed first. The test "the 21st personal search doesn't use up the team's" **must** go red. Restore it.
- [ ] **Step 6: Probe on the test site after publishing,** with a heads-up to Samuel first, since it calls the paid AI service: one search with a real cat photo in Kini. Record the measured cost per search on SYC-396 (§5.2: "the cap is set after measuring").
- [ ] **Step 7: Commit:** `SYC-396 PR 2.5: Find from a photo on the Cats page`

---

### PR 2.6: Map layers and the Colonies map view (Samuel's Q3; SYC-454)

**What the team sees:** the island Map gets three more layers, each switched on and off like Cats and Feeding sites:
- **Colonies:** each colony's name at its feeding sites;
- **Welfare reports from the last 30 days:** each one as a marker in its kind's colour and shape, with a card saying its kind, how long ago it was sent and its place in words, and "Open in the Queue";
- **Not looked at yet:** the 250 m squares within 500 m of an area centre where nothing has been sighted in the last 90 days, drawn as outlined squares.

The Colonies list gets a **Map** switch that opens the Map with the Colonies layer on. Cat guardians don't get the Map yet (that's SYC-455), so none of this is shown to them.

**Depends on:** 2.0. It also shares coverage squares with 3.3b and welfare kinds with 3.3b, so it builds those two small modules first and 3.3b reuses them. **Files it shares:** `catGridPage.ts` and `routes/teamCats.ts` with 2.5. Whichever merges second rebases.

#### Task 2.6.1: Shared squares and kinds

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/coverageCells.ts` and `artifacts/api-server/src/lib/dashboard/welfareKinds.ts`. These move here from 3.3b's plan. 3.3b imports them and doesn't redefine them.
- Test: `lib/dashboard/coverageCells.test.ts`, `lib/dashboard/welfareKinds.test.ts`

**Interfaces:**
- Produces:

```ts
// welfareKinds.ts: exactly as 3.3b.2 describes, now defined here
export type WelfareKind = "litter" | "urgent" | "attention";
export const WELFARE_ORDER: readonly WelfareKind[];
export const WELFARE_COLOUR: Record<WelfareKind, string>;
export const WELFARE_WORD: Record<WelfareKind, string>;       // "Urgent", "Needs attention", "Kittens"
export const kindOf: (r: { severity: "urgent" | "attention"; isLitter: boolean }) => WelfareKind;
// coverageCells.ts
export const GAP_RADIUS_M = 500, GAP_LOOKBACK_DAYS = 90;
export interface Cell { key: string; south: number; west: number; north: number; east: number; seen: boolean; notLookedAt: boolean }
export async function coverageCells(o: { from: Date | null; to: Date }): Promise<Cell[]>;   // blurPosition's 250 m cells
```

- [ ] **Step 1: Failing tests:** the same cell and gap cases as 3.3b.1 (two sightings in one cell make one cell; 400 m from a centre is a gap, 600 m isn't); `kindOf` puts an urgent litter in `litter`. **Step 2–4: Fail, implement, pass. Step 5: Commit:** `SYC-396 PR 2.6: shared coverage squares and welfare kinds`

#### Task 2.6.2: The three layers

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamPages/catMapPage.ts`: three new data blocks in the signed-in page, read by `readData`, in the same way as `sites`:
    - `colonies`: `{ id, name, sites: [{ lat, lng }] }`, built through a reader that takes `Visible` (team only, so the whole island);
    - `welfare`: `{ publicId, kind, word, ago, place, lat, lng }` for `kind='welfare'`, not drafts, sent in the last 30 days;
    - `gaps`: `{ south, west, north, east }` for each `notLookedAt` cell.
  - Three layer check boxes, off by default, beside Cats and Feeding sites, and the key, which gains the welfare shapes and the outlined gap square.
  - `artifacts/api-server/assets/dashboard-map.js`: three `L.layerGroup()`s fed from those blocks, plus `layerBox(...)` for each.
    - **Colony names** are `L.tooltip`s with `permanent: true` at each site, never circles.
    - **Welfare markers** are squares rotated 45° (diamonds): never circles, which mean cats; never teal, which means sterilisation; never plain squares, which mean feeding sites. Each has its kind's colour **and** its word in the card.
    - **Gaps** are `L.rectangle`s with a 1.5px dashed outline and no fill.
  - `?layer=colonies` turns the Colonies layer on at load. It's read only by the page, and holds no position.
  - `lib/teamPages/colonyPages.ts`: a **Map** link on the Colonies list (island-wide viewers only) to `/api/team/cats?view=map&layer=colonies`. This rebases on 2.2.
  - `lib/guardianView.source.test.ts`: register the colonies-for-map reader.
  - `docs/screenshots/syc-396-pr-2-6/`.
- Test: `routes/team.catMap.test.ts`, `lib/teamPages/catMapPage.test.ts`

- [ ] **Step 1: Failing tests:**
  - the map page's data blocks hold a seeded colony's name, a welfare report from 10 days ago, **not** one from 40 days ago, **not** a draft, and **not** a `content` report;
  - a seeded gap square is in `gaps`;
  - `?layer=colonies` checks the Colonies box;
  - a guardian still gets the walk's `forbidden` on the Map;
  - **no position appears in any of our own addresses** (the same href and action check as 2.4.3);
  - **no feeding site's internal name is in the `colonies` block.** It carries the colony's name and site positions only. Seed "Vaporia — Eleni's" and assert it's absent;
  - the welfare block holds no note text and no reporter details.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass**, plus `positions.source.test.ts`, `team.scriptTags.test.ts` and `team.headers.test.ts` (the Map page keeps its scripts-on header; nothing else changes).
- [ ] **Step 5: Mutation probe:** drop the 30-day bound on the welfare query. The "not one from 40 days ago" test **must** go red. Restore it.
- [ ] **Step 6: Look at it** in Chrome, Safari and Firefox, at 390px and 1280px, with all five layers on. Check that colony names don't hide the cat dots at zoom 15, that the key folds away, and that tapping a welfare marker opens its card. Save to `docs/screenshots/syc-396-pr-2-6/`.
- [ ] **Step 7: Commit:** `SYC-396 PR 2.6: colonies, welfare and gaps layers on the island Map`

**After merge:** close SYC-454 (its guardian part stays on SYC-455).

---

## Phase 3: vet visits and the reports

### PR 3.0: Resolver groundwork (can start in wave 1)

**What the team sees:** nothing yet. This teaches the records three things:
- a vet visit;
- an undo that puts back what it replaced;
- answering "as of" a past moment.

It touches only `lib/observations.ts`, `lib/resolve.ts` and their tests, so it can run alongside phase 2.

#### Task 3.0.1: The `vet_visit` kind, and visit links on statements

**Files:**
- Modify: `artifacts/api-server/src/lib/observations.ts`:
  - `OBSERVATION_KINDS` gains `"vet_visit"`;
  - `validateValue` gets a `vet_visit` case;
  - `sterilised` and `vaccinated` accept an optional `vetVisitId` and `{ retracted: true }`;
  - `ROLES_REFUSED_FOR_KIND.vet_visit = ["public", "guardian", "system"]`;
  - **the writer's retraction checks** (`writeObservation`, `observations.ts:~848-933`, today only for appearance kinds through `isAppearanceKind && isRetraction(...)`) are extended to `sterilised`, `vaccinated` and `vet_visit`:
    - the target exists, is the same kind and the same cat;
    - a retraction may not supersede a retraction, except through `undoVetVisit`'s re-do path, which 3.0 doesn't build;
    - the writer must hold the kind's capability;
  - **only a vet-visit undo may write a retraction of these kinds.** `writeObservation` takes a new input flag, `fromVisitUndo: true`, which only `undoVetVisit` sets. Without it, a `{ retracted: true }` value for these kinds is refused (`RETRACTION_NOT_ALLOWED`). So the generic Mark wrong form and the JSON supersede route (`routes/observations.ts:~96`, which accepts any `value`) can't make a guardian's statement silently come back.
- Test: `artifacts/api-server/src/lib/observations.vetVisit.test.ts`

**Interfaces:**
- Produces:

```ts
export const VISIT_DID = ["sterilised", "vaccinated", "treated", "checked"] as const;
export const PAID_BY = ["syros_cats", "donation", "owner"] as const;
export interface VetVisitValue {
  did: (typeof VISIT_DID)[number][];          // 1–4, distinct; "checked" only alone
  vaccines?: Vaccine[];                        // required iff did has "vaccinated"; same rules as `vaccinated`
  treatedNote?: string;                        // required iff did has "treated"; 1–200
  clinicId: string;                            // one of getGuidance("en").vets ids
  costEur: number | null;                      // 0–2000, two decimals at most
  paidBy: (typeof PAID_BY)[number];
  note?: string;                               // 0–500
}
// sterilised value, accepted shapes:
//   { sterilised: boolean, clinic?: string, reason?: string, vetVisitId?: number }
//   { retracted: true, reason: string }
// vaccinated value gains vetVisitId?: number and the same { retracted: true, reason } shape.
// vet_visit accepts VetVisitValue or { retracted: true, reason }.
```

- [ ] **Step 1: Failing tests**, one `it.each` table per kind:
  - every refusal;
  - `checked` together with `sterilised` is refused;
  - `vaccinated` without `vaccines` is refused;
  - an unknown clinic id is refused;
  - a cost of −1 or 2000.001 is refused;
  - a guardian or public writer of `vet_visit` is refused;
  - every existing `sterilised` and `vaccinated` shape is still accepted, using the existing fixtures in `observations.test.ts`;
  - `{ retracted: true }` for `sterilised` without `fromVisitUndo` is refused, through `writeObservation` **and** through `POST /team/observations/:id/supersede`;
  - a retraction whose target is another cat's row, or another kind, is refused.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus the whole of `observations*.test.ts`.
- [ ] **Step 5: Commit:** `SYC-396 PR 3.0: the vet_visit kind, and visit links on sterilised and vaccinated`

#### Task 3.0.2: Undo restores what it replaced (sterilised and vaccinated only)

**Files:**
- Modify: `artifacts/api-server/src/lib/resolve.ts`. Add `standingRows(observations, kind)`, use it in `resolveSterilised` (`:414`) and `resolveVaccinated` (`:1499`), and add `vet_visit` to `EVIDENCE_SOURCES` (`:57`).
- Modify: `artifacts/api-server/src/lib/observations.ts` `loadCatRecords`. The newest active `vet_visit`'s `observedAt` counts as evidence of life (spec §8.3, amending spine §3.4).
- Modify: `docs/specs/cat-record-data-spine.md` §3.4 gains "a vet visit" in its list.
- Test: `artifacts/api-server/src/lib/resolve.restore.test.ts`

**The rule** (Decision 6):

```ts
/** For "sterilised" | "vaccinated" | "vet_visit". A row stands unless a standing row supersedes it.
 * A `{ retracted: true }` row supersedes its target and asserts nothing itself;
 * when the target it retracts had itself superseded an earlier row, that earlier row stands again.
 * Computed by walking each supersede chain from its newest end. Every other kind keeps `isActive`. */
export function standingRows(observations: readonly Observation[], kind: "sterilised" | "vaccinated" | "vet_visit"): Observation[];
```

The chain logic:
- G ← Y (Y supersedes G with a value) gives **Y** standing.
- G ← Y ← R (R retracts Y) gives **G** standing.
- G ← Y ← R ← R2 (R2 retracts the retraction) gives **Y** standing.
- G ← Y ← Y2 (a correction of the correction) gives **Y2** standing. This is unchanged.

**Why only these kinds:** no stored `sterilised`, `vaccinated` or `vet_visit` row is a retraction today, because the validator refused one until Task 3.0.1. So the new rule can't change any existing cat's answer. Coat and markings keep their own retraction rules (`standingAppearanceRows`).

- [ ] **Step 1: Failing tests:**
  - the four chains above;
  - Decision G still holds: a guardian's standing "no" beats a team "yes" dated earlier, with no visit involved;
  - a visit "yes" that supersedes the guardian's "no" makes the cat `sterilised` / `confirmed`;
  - retracting it brings back the guardian's "no";
  - `resolveVaccinated` drops a retracted record and keeps the others;
  - `loadCatRecords` reports `source: "vet_visit"` when the visit is the newest evidence;
  - **a retraction is never evidence of life:** undoing a visit on a cat last seen 40 months ago leaves it presumed deceased. `loadCatRecords` today calls `consider(o.observedAt, "sterilised")` for every sterilised row (`observations.ts:1103`), so retractions, and the rows they stand down, are skipped;
  - `resolveVaccinated` keeps its order: team rows first, then standing rows (`resolve.ts:1500-1505`);
  - **the other readers agree with the resolver.** These build their own "was this superseded?" set from `supersedesId` and must use `standingRows` for these kinds instead. Each gets a test where G ← Y ← R shows G standing:
    - `lib/guardianChanges.ts:~236` (`replaced` and `contradictsTeamRecord`): an undone visit's "overruled" line is shown as "put back when the visit was undone";
    - `lib/teamCatView.ts:191, 354` (the team cat page's history marks);
    - `lib/guardianStatements.ts:257-277` (the guardian's own view of her answer);
  - **a replay check:** for every cat in a fixture of 300 generated histories, `resolveSterilised` gives the same answer as a frozen copy of the old function kept in the test file. The histories are generated with a seeded generator and include supersede chains of length 1–3, guardian and team rows, and past dates. This only proves that histories **without** retractions are unchanged, which is the claim. The new behaviour is covered by the four chain tests above.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus the whole of `resolve*.test.ts`.
- [ ] **Step 5: Mutation probes:**
  - make a retraction stand nothing back up: the "brings back the guardian's no" test **must** go red;
  - apply the rule to `life_status` too: the replay check over life status (add it) **must** go red.

  Restore both.
- [ ] **Step 6: Commit:** `SYC-396 PR 3.0: undoing a visit's statement puts back what it replaced`

#### Task 3.0.3: Records as they stood at a moment

**Files:**
- Modify: `artifacts/api-server/src/lib/observations.ts`: `loadCatRecords(catIds, exec = db, opts: { asOf?: Date } = {})`.
- Modify: `artifacts/api-server/src/lib/colonyMembership.ts`: `currentColonyOf(catIds, q, opts: { asOf?: Date } = {})`, which leaves out colony rows with `createdAt > asOf`. Without it, a past report would use today's colonies.
- Add: `resolveAt(records: CatRecords, at: Date, now: Date): CatSnapshot`, a pure function that filters one cat's loaded rows to `createdAt <= at` and resolves. Reports that need many points load once and call it per point, instead of loading the island 24 times.
- Modify: `artifacts/api-server/src/lib/teamCatList.ts`: `loadTeamCats(now, opts?: { asOf?: Date })`. With `asOf`, cats with `created_at > asOf`, sightings with `created_at > asOf` and `cat_identity` rows after `asOf` are left out, and `now` defaults to `asOf`.
- Test: `artifacts/api-server/src/lib/asOf.test.ts`

**The rule** (Decision 10): with `asOf`, every observation, sighting and cat with `createdAt > asOf` is left out **before** supersession is worked out. Redacted rows stay as they are now.

- [ ] **Step 1: Failing tests:**
  - a cat sterilised on 10 Oct and corrected to "not sterilised" on 15 Oct reads `sterilised` as of 12 Oct and `not_sterilised` as of 16 Oct;
  - a statement entered on 15 Oct with an operation date of 1 Oct is **absent** as of 12 Oct, because it hadn't been entered yet;
  - a cat created on 14 Oct is absent as of 12 Oct;
  - evidence of life as of 12 Oct ignores a sighting from 13 Oct;
  - with no `asOf`, the output is identical to today's, checked by snapshot over the replay fixture;
  - a cat moved from colony A to B on 15 Oct is in A as of 12 Oct;
  - `resolveAt(records, T)` equals `loadCatRecords(…, { asOf: T })` then `resolveCat`, for 50 random T.
- **Known limit, written into Decision 10 and the method note:** a sighting entered before T but matched to a cat after T counts for that cat as of T, because a sighting's match isn't dated. This can change "last seen" and "presumed" lines, but not sterilisation, colonies or new-cat counts. The reproducibility test (4.1) covers the figures the impact report prints.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** filter by `observedAt` instead of `createdAt`. The "entered on 15 Oct" test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 3.0: loadCatRecords and loadTeamCats as of a moment`

### PR 3.1: Logging a vet visit (3.1a after 3.0 and 2.3 merge; 3.1b after 2.3)

3.1 ships as two PRs, to keep the biggest change reviewable:
- **3.1a** is Tasks 3.1.1 and 3.1.3;
- **3.1b** is Task 3.1.2, the Vet settings page and its history (migration `vet_settings_history`).

**What the team sees:** **Log a vet visit** becomes the main button on the team cat page.
- The form asks for:
  - the date;
  - what was done (Sterilised, Vaccinated with the vaccine picker, Treated with a note, or Checked only);
  - the clinic, from the one list;
  - the cost, pre-filled with the standard €60 when Sterilised is ticked;
  - who paid;
  - a note.
- Saving records the visit and, together with it, the cat's sterilisation and vaccination. If the cat guardian had said "not sterilised", that is marked wrong with the reason "vet visit on 13 Aug 2026", and it shows on the guardian changes list.
- Marking the visit wrong undoes all of it and puts the guardian's answer back.
- The cat page lists the visits.
- A **Vet settings** page changes the standard price, with its history.
- Home's This month gains vet spend.
- Cat guardians see on their cat's page that a visit happened and what was done, without vaccinations or costs.

#### Task 3.1.1: Writing and undoing a visit

**Files:**
- Create: `artifacts/api-server/src/lib/vetVisits.ts`
- Test: `artifacts/api-server/src/lib/vetVisits.test.ts`

**Interfaces:**
- Consumes:
  - `inStatementTransaction(fn)` (`lib/commitStatement.ts:140`);
  - `commitStatement(tx, input, news)` (`:81`);
  - `writeObservation(tx, { …, supersedesId, value: { retracted: true, reason }, fromVisitUndo: true })` for the undo. Undo does **not** go through `supersedeStatement`, because `capabilityFor("vaccinated")` and `capabilityFor("vet_visit")` return null (`teamCorrections.ts:62-70`) and `SUPERSEDE_CAPABILITIES` (`:74`) lacks them. `undoVetVisit` checks `log_vet_visit` itself and locks each row with `lockActiveObservation(tx, id)` (`:150`);
  - `loadCatRecords`, `standingRows`, `authorityLevel` (`lib/resolve.ts:188`);
  - `actingRole`, `can`.
- Produces:

```ts
export interface VisitInput { catId: number; date: string /* YYYY-MM-DD, not in the future */; value: VetVisitValue }
export interface SavedVisit { visitId: number; sterilisedIds: number[]; vaccinatedId: number | null; overruled: number[] }   // one sterilised row per overruled guardian row, or one plain row
/** One transaction: the visit row, then a `sterilised` row (if ticked) that supersedes each standing
 * higher-authority "not sterilised" (D8), else a plain one, then a `vaccinated` row (if ticked). */
export async function logVetVisit(person: Person, input: VisitInput): Promise<SavedVisit>;
/** One transaction: retract the visit and every row whose value.vetVisitId is this visit. */
export async function undoVetVisit(person: Person, visitId: number, reason: string): Promise<{ retracted: number[] }>;
export function standingNotSterilisedAboveTeam(observations: readonly Observation[]): Observation[];
export async function visitsFor(catId: number, opts: { costs: boolean }): Promise<VisitLine[]>;
export interface VisitLine { visitId: number; date: string; did: VetVisitValue["did"]; vaccines?: Vaccine[]; clinicName: string; costEur?: number | null; paidBy?: VetVisitValue["paidBy"]; note?: string; by: string }
```

**Writing a visit** (§8.3, D8):
- The cat row is locked first (`commitStatement` does this for `sterilised`), then the visit is written.
- If Sterilised is ticked:
  - `standingNotSterilisedAboveTeam` finds the active `sterilised` rows with value `false` and `authorityLevel(o) > 1`;
  - **with none,** one `sterilised` row `{ sterilised: true, clinic: clinicName, vetVisitId, reason: "vet visit" }`;
  - **with some,** one such row **superseding each**, with `supersedeReason = "vet visit on <d MMM yyyy>"`;
  - every one of them dated to the visit.
- If Vaccinated is ticked, one `vaccinated` row `{ vaccines, clinic: clinicName, vetVisitId }`. Ticking Vaccinated needs `set_vaccination` as well as `log_vet_visit`, so the visit can't step around the existing vaccination rule.
- The news ("desexed") is sent after the commit, as `commitStatement` already does.
- While the visit stands its "yes" decides the cat's answer, over any "not sterilised" from any level and of any date (Decision 6, SYC-543). D8's supersede is kept so the guardian changes list shows the overrule.

**Undoing a visit:**
- Each row whose value has this `vetVisitId`, and then the visit itself, is superseded by `{ retracted: true, reason }`, all in one transaction.
- The rows to retract are found by `value->>'vetVisitId' = visitId` **and** `cat_id = the visit's cat` **and** a kind in (`sterilised`, `vaccinated`). The validator also refuses a `vetVisitId` that isn't a standing `vet_visit` row of the same cat, so a stray number can't tie two cats together.
- `ALREADY_SUPERSEDED` on any row rolls the whole undo back, with the words "This visit was already undone."

- [ ] **Step 1: Failing tests (database-backed):**
  - a visit with Sterilised makes the cat `sterilised` / `confirmed`, dated to the visit, with `clinic` set;
  - a visit with both Sterilised and Vaccinated writes 3 rows in one transaction. Prove the rollback by making the third write throw: **no** rows remain;
  - D8: with a guardian's standing "no" dated 20 Aug, a visit dated **13 Aug** (before it, so SYC-315 B's "a newer yes wins" can't hide a missing D8) supersedes it. The cat reads `sterilised`, and `listGuardianChanges()` gains an `overruled` entry with the reason "vet visit on 13 Aug 2026";
  - with two guardians' standing "no" rows, `sterilisedIds` has two entries and both are overruled;
  - Vaccinated ticked by someone without `set_vaccination` is refused;
  - undo: the cat reads the guardian's "no" again, the vaccination is gone, and `visitsFor` no longer lists the visit;
  - undoing twice is refused, and the second attempt writes nothing;
  - a guardian calling `logVetVisit` is refused (`log_vet_visit` is island-only);
  - `visitsFor(…, { costs: false })` has no `costEur` and no `paidBy` keys at all;
  - a visit dated in the future is refused.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probes:**
  - skip the D8 supersede and write a plain row: the D8 test **must** go red, because the guardian's "no" still wins;
  - undo only the visit row: the "vaccination is gone" test **must** go red.

  Restore both.
- [ ] **Step 6: Commit:** `SYC-396 PR 3.1: logVetVisit and undoVetVisit, D8 included`

#### Task 3.1.2: Capabilities, the price history and the Vet settings page

**Files:**
- Modify:
  - `lib/capabilities.ts` gains `log_vet_visit` and `edit_vet_settings`, both `{ kind: "island", roles: TEAM }` (`view_vet_costs` came in 2.3);
  - roles §6.2 gains their rows: `| \`log_vet_visit\` | Log a vet visit on a cat | Island-only | ✓ | ✓ | — |` and `| \`edit_vet_settings\` | Change the standard sterilisation price | Island-only | ✓ | ✓ | — |`;
  - `lib/db/src/schema/mappingEvents.ts`: `MAPPING_SUBJECT_KINDS` gains `"vet_settings"`, and `MAPPING_EVENT_KINDS` gains `"price_changed"`.
- Create:
  - `lib/db/migrations/NNNN_vet_settings_history.sql`, which widens the two check constraints, with a rollback;
  - `artifacts/api-server/src/lib/vetSettings.ts` with `setStandardPrice(person, eur)`. One transaction upserts `app_settings` and records `{ subjectKind: "vet_settings", subjectId: 1, kind: "price_changed", before: { eur }, after: { eur } }`. It also clears the `getAppSettings` cache through a new exported `clearAppSettingsCache()` (today only `_resetAppSettingsCacheForTests` exists). If the settings can't be read, the planner's estimate says "The standard price isn't available right now" rather than silently using €55;
  - `artifacts/api-server/src/lib/teamPages/vetSettingsPage.ts`;
  - the routes `GET` and `POST /team/vet-settings` (`edit_vet_settings`) in a new `routes/teamVet.ts`.
- Modify: `lib/guardianView.source.test.ts` `ISLAND_ONLY_MODULES` gains `vetSettings.ts`, with capability `edit_vet_settings`.
- Test: `lib/db/src/migrate/vetSettingsHistory.test.ts`, `routes/team.vetSettings.test.ts`

- [ ] **Step 1: Failing tests:**
  - setting €65 makes the planner's estimate use 65 at once on this server;
  - the history shows "18 Oct 2026 · Jacky · €60 → €65";
  - €0 is refused with words;
  - a guardian gets 403;
  - the migration test checks that a `vet_settings` event is accepted and that an unknown subject kind is still refused.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `migrate:check`. **Step 5: Commit:** `SYC-396 PR 3.1: Vet settings, the standard price with its history (migration `vet_settings_history`)`

#### Task 3.1.3: The form, the cat page, the guardian line and Home's spend

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/vetVisitForm.ts`
- Modify:
  - `routes/teamCats.ts` (or the file that holds the team cat page routes): add `GET /team/cats/:id/vet-visit` (the form), `POST /team/cats/:id/vet-visit` (`...formRoute("log_vet_visit")`) and `POST /team/vet-visits/:visitId/wrong` (`...formRoute("log_vet_visit")`, behind `renderConfirmPage`);
  - `lib/teamPages/catPages.ts`: "Log a vet visit" becomes the full-width main button. The Vet visits evidence section lists `visitsFor(catId, { costs: can(person, "view_vet_costs") })`, each row with "Mark the visit wrong";
  - `routes/teamCorrections.ts` `POST /team/statements/:id/wrong` **and** `routes/observations.ts:197` `POST /team/observations/:id/supersede`: both refuse a row whose value has `vetVisitId` (Decision 7). Put the check in `supersedeStatement` itself, behind an `allowVisitRows` option that only `undoVetVisit` passes, so no third route can skip it;
  - `lib/guardianCatView.ts` `GUARDIAN_CAT_FIELDS` gains `vetVisits: { date, did without "vaccinated" }[]`, and `lib/teamPages/guardianPages.ts` draws "Seen by a vet on 13 Aug 2026: sterilised";
  - `lib/teamPages/strings/{en,el,fr}.ts` gets those words, flagged on SYC-346 as **second pack**;
  - `lib/dashboard/home.ts` `MonthFigures` gains `vetSpendEur`: the sum of `costEur` over standing visits in the month with `paidBy` `syros_cats` or `donation` (§8.4). `homePage.ts` shows it only if `view_vet_costs`;
  - `routes/team.walk.test.ts`: three rows, team only.
- Test: `routes/team.vetVisit.test.ts`, `routes/team.guardianView.test.ts`, `lib/dashboard/home.test.ts`

**The form** (§8.2, §13):
- The date defaults to today in Athens.
- Ticking Sterilised pre-fills the cost with the standard price, without a script: the GET sets it when `?did=sterilised`, and the form's default is Sterilised ticked.
- The clinic is a `<select>` of the clinic list.
- "Paid by" is three radio buttons.
- A missing date or "what was done" is named next to its field, and **everything typed is kept** on a failed save. Re-render with the posted values.

- [ ] **Step 1: Failing tests:**
  - the full round trip from form to save to the cat page shows the visit and "Sterilised: Yes, confirmed by Syros Cats, 13 Aug 2026";
  - a failed save keeps the typed note;
  - "Mark wrong" on the visit's `sterilised` row through the generic route is refused with the Decision 7 words;
  - a guardian's own cat page shows "Seen by a vet on 13 Aug 2026: sterilised", and **no** "vaccin", no "€" and no clinic name;
  - Home's spend counts a €60 Syros Cats visit and leaves out a €70 owner-paid one.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** pass `costs: true` for guardians. The "no €" test **must** go red. Restore it.
- [ ] **Step 6: Screenshots** of the form and the cat page at 390px and 1280px. **Step 7: Commit:** `SYC-396 PR 3.1: Log a vet visit on the cat page`

### PR 3.2: Logging a whole trapping round (after 3.1 merges)

**What the team sees:** on a colony's planner, **Log this round's vet visits** opens one form.
- It lists the colony's cats, each with a tick box.
- They share a date, a clinic and a price, and each cat can change what was done, the cost and who paid.
- "Add a cat not on this list" finds any other cat by name or SYR number.
- Saving logs one visit per ticked cat, all together or not at all.

#### Task 3.2.1: The round

**Files:**
- Modify: `artifacts/api-server/src/lib/vetVisits.ts`. Add `logRound(person, input: RoundInput): Promise<SavedVisit[]>`. It runs one `db.transaction`, locks the cats in ascending id order, and calls the same internal writer as `logVetVisit` for each.
- Create: `artifacts/api-server/src/lib/teamPages/roundForm.ts`
- Modify:
  - `routes/teamColonies.ts`: `GET` and `POST /team/colonies/:id/round` (`log_vet_visit`);
  - `colonyPages.ts`: the planner's "Log this round's vet visits" link, only if `may("log_vet_visit")`;
  - `routes/team.walk.test.ts`.
- Test: `lib/vetVisits.round.test.ts`, `routes/team.round.test.ts`

```ts
export const ROUND_MAX = 40;
export interface RoundInput { colonyId: number; date: string; clinicId: string; priceEur: number | null;
  cats: { catId: number; did: VetVisitValue["did"]; vaccines?: Vaccine[]; costEur?: number | null; paidBy: VetVisitValue["paidBy"] }[] }
```

- Extra cats are added by a `GET` with `?add=<q>`, which re-draws the form with the search results under "Add a cat not on this list", reusing `searchCatsToAdd`. The ticked state is kept in hidden fields. Only an id goes in the address.
- Samuel's Q2: there's no new-cat option. A cat nobody has recorded is added the usual way first.

- [ ] **Step 1: Failing tests:**
  - 3 ticked cats give 3 visits;
  - a refusal on the 3rd (a future date on one override) leaves **no** visits;
  - an added cat from another colony gets its visit and stays in its own colony;
  - over 40 cats is refused with words;
  - a guardian gets 403.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Screenshots. Step 6: Commit:** `SYC-396 PR 3.2: log a whole round's vet visits from the planner`

### PR 3.3a: The Reports area, Sterilisation progress and Colony health (migration `report_downloads`)

**What the team sees:** **Reports** joins the menu. It lists seven reports, with Donations showing "Coming once donations are set up". Each report has a time range at the top. The first two are built here:
- **Sterilisation progress:** the island headline, a line over time of confirmed sterilised against all street cats known, and every colony as a sorted bar.
- **Colony health:** one sortable table.

Every chart has "Show as table", and every table downloads as a spreadsheet file.

#### Task 3.3a.1: Ranges, charts, tables and safe CSV

**Files:**
- Create:
  - `artifacts/api-server/src/lib/reports/range.ts`;
  - `artifacts/api-server/src/lib/reports/charts.ts`;
  - `artifacts/api-server/src/lib/reports/csv.ts`.
- Test: `lib/reports/range.test.ts`, `lib/reports/charts.test.ts`, `lib/reports/csv.test.ts` (all pure)

**Interfaces:**

```ts
// range.ts
export type RangeKey = "month" | "3months" | "year" | "all" | "custom";
export interface Range { key: RangeKey; from: Date | null; to: Date; label: string }   // Athens calendar
export function parseRange(q: unknown, now: Date): Range;    // bad input → "3months"; to never after now
export function weeksIn(r: Range, firstEvent: Date): Date[]; // week starts, Monday, Athens
export function monthsIn(r: Range, firstEvent: Date): Date[];
// charts.ts — every function returns trusted SVG/HTML; widths in viewBox units, rendered at 100%
export function lineChart(o: { series: { label: string; points: { at: Date; value: number }[]; mark?: SterilisedMark; neutral?: true }[]; title: string }): string;
export function barChart(o: { bars: { at: Date; parts: { key: string; label: string; value: number; colour: string }[] }[]; title: string }): string;
export function sortedBars(o: { rows: { label: string; split: Split; href?: string }[]; title: string }): string;
export function tableFor(o: { caption: string; columns: { key: string; label: string; numeric?: true }[]; rows: Record<string, string | number>[] }): string; // inside <details><summary>Show as table</summary>
// csv.ts
export function csvCell(v: string | number | null): string;   // quotes, doubles quotes; text starting = + - @ TAB CR gets a leading '
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, string | number | null>[]): string;   // starts with a UTF-8 BOM, so Greek names open correctly in Excel; CRLF line ends
```

**The chart rules** (§12.3):
- One scale per chart. Lines are 2px, with the series labelled at their ends.
- Faint, solid grid lines. A small gap between bar segments.
- A `<title>` on every mark, holding the exact value and date.
- A text size of at least 12px at a 390px render: the font-size in viewBox units is scaled so it can't go under that.
- `role="img"`, and an `aria-label` that says the chart's title.

- [ ] **Step 1: Failing tests:**
  - `csvCell` gives `'=1+1` for `=1+1`, `'@SUM(A1)` for `@SUM(A1)` and `"'-3"` for `-3` as text, while the **number** `-3` stays `-3`;
  - a cell with a quote and a comma is quoted correctly;
  - `parseRange` gives `3months` for junk, and caps a custom `to` at now;
  - `lineChart` with two series has two `<path>`s, two end labels, and no second axis;
  - every `<text>` in a chart has `font-size` of 12 or more at a 390px width;
  - `tableFor` escapes `<script>` in a cell.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** drop `-` from the escape list. The `-3` text test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 3.3a: report ranges, server-drawn charts, and spreadsheet-safe CSV`

#### Task 3.3a.2: Download records, the capabilities and the Reports area

**Files:**
- Create:
  - `lib/db/src/schema/reportDownloads.ts`: `report_downloads(id serial, person_id uuid not null references people, report text not null, range text not null, at timestamptz default now())`, made append-only by a trigger written in the migration (copy the `mapping_events` trigger from migration 0015; `site_page_reads` has none), with a migration test that an UPDATE and a DELETE are refused;
  - `lib/db/migrations/NNNN_report_downloads.sql`, with a rollback.
- Modify:
  - `lib/capabilities.ts` gains `view_reports: { kind: "placed", roles: EVERYONE }` and `export_report: { kind: "island", roles: TEAM }`;
  - roles §6.2 gains `| \`view_reports\` | See the reports (cat guardians: their colonies' progress and health) | Placed | All | All | Own |` and `| \`export_report\` | Download a report as a spreadsheet | Island-only | ✓ | ✓ | — |`.
- Create:
  - `artifacts/api-server/src/lib/reports/downloads.ts`: `recordDownload(personId, report, range)`, written **before** the response. A failure sends 503 and no file;
  - `artifacts/api-server/src/routes/teamReportsArea.ts`: `GET /team/insights` (the Reports list; see the note below), `GET /team/insights/:report` and `GET /team/insights/:report.csv` (`export_report`).
- Modify:
  - `layout.ts`: `NavKey` gains `"reports"`, and the menu gains Reports → `/api/team/insights` before People;
  - `routes/team.walk.test.ts`.
- Test: `lib/db/src/migrate/reportDownloads.test.ts`, `routes/team.reportsArea.test.ts`

**Why `/insights` and not `/reports`:** `/api/team/reports` and `/api/team/reports/:publicId` are already the welfare queue's JSON and report pages (`routes/teamReports.ts:47`). The menu **label** is still "Reports".

**Samuel's Q1 (16 Nov):** a guardian holding `view_reports` gets 403 on every `/insights` route at launch, and the Reports item isn't in the guardian menu. The guardian variant is ticketed for 16 Nov.

- [ ] **Step 1: Failing tests:**
  - the list shows seven reports, with Donations unlinked and showing its words;
  - a CSV download writes exactly one `report_downloads` row **holding no contents**, with columns `person_id, report, range, at` only;
  - a forced failure in `recordDownload` sends 503 and no CSV body;
  - a guardian gets 403;
  - `team.headers.test.ts`: these pages keep the strict security header, because they have no script.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `migrate:check`. **Step 5: Mutation probe:** move `recordDownload` after `res.send`. The 503 test **must** go red. Restore it. **Step 6: Commit:** `SYC-396 PR 3.3a: the Reports area, view_reports and export_report, downloads recorded (migration `report_downloads`)`

#### Task 3.3a.3: Sterilisation progress and Colony health

**Files:**
- Create:
  - `artifacts/api-server/src/lib/reports/progress.ts`: `progressReport(range, now): Promise<{ headline: Headline; over: { at: Date; confirmed: number; street: number }[]; colonies: { colonyId: number; name: string; split: Split }[]; workedOutAt: Date; ms: number }>`. It loads the island's records **once** and calls `resolveAt` for each point (Task 3.0.3): each month's end, or each week's end for ranges of 3 months or less, capped at 24 points. Colony membership for each point uses `currentColonyOf(…, { asOf })`;
  - `artifacts/api-server/src/lib/reports/colonyHealth.ts`: one row per colony with cats now, the change over 90 days, kittens reported, not seen lately, guardian yes or no, and **last visit**, meaning the latest resolved sighting of any of its cats. It reuses `colonyFigures`. Every column header is a sort link (`?sort=<column>&dir=asc|desc`, with the column names on an allow-list), so it sorts with no script;
  - Home's headline gains its "See Sterilisation progress" link (§4.4), a one-line change to `homePage.ts`;
  - `artifacts/api-server/src/lib/teamPages/reportPages.ts`, which renders the two reports and their CSVs.
- Modify: `lib/guardianView.source.test.ts`, to register `colonyHealth.ts` and `progress.ts` (both read colonies) as island-only (`view_reports`, team) for now. PR 4.1 registers `impact.ts` the same way.
- Test: `lib/reports/progress.test.ts`, `lib/reports/colonyHealth.test.ts`, `routes/team.reportPages.test.ts`

**The words on every report** (§9.3):
- for counts of events in the period (sterilisations, new cats, visits): "Counted by the date of the operation";
- for the progress line: "Each point shows the records as they stood on that date";
- "Figures change as records are corrected";
- "Worked out 18 Oct 2026, 16:40 · last 3 months";
- the named-areas version, from 2.4's `areasVersion()`.
- With no data in the period: "Nothing recorded in this period", with a link to All time.

- [ ] **Step 1: Failing tests:**
  - the progress point for 30 Sep counts a sterilisation **entered** on 1 Oct as not there yet (it uses `asOf`);
  - the colony rows are ordered fewest confirmed first;
  - every chart has a table;
  - each CSV's columns match its table's;
  - a colony name with `=cmd` comes out as `'=cmd` in the CSV.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Screenshots** at 390px and 1280px, and a black-and-white print preview: every part must still read without colour (§12.3). **Step 6: Commit:** `SYC-396 PR 3.3a: Sterilisation progress and Colony health`

### PR 3.3b: Coverage and spotting, and Welfare patterns (after 3.3a)

**What the team sees:**
- **Coverage and spotting:** the island as 250 m squares, shaded where something was sighted in the period, and marked "Not looked at yet" within 500 m of an area centre with no sighting. Beside it, sightings per week and how many spotters sent at least one. Nobody is named.
- **Welfare patterns:** reports per week as bars, split Urgent, Needs attention and Litter. "Started, not sent" reports are counted separately, and so are "Problems reported with photos or names". A table shows the areas with the most reports.

There are no response times and no per-person figures.

#### Task 3.3b.1: Coverage

**Files:**
- Create: `artifacts/api-server/src/lib/reports/coverage.ts`, built on `coverageCells` from PR 2.6 (don't redefine the cells)
- Modify: `lib/teamPages/reportPages.ts`
- Test: `lib/reports/coverage.test.ts`

**Interfaces:**
- Produces: `coverageReport(range, now): Promise<{ cells: { cellLat: number; cellLng: number; seen: boolean; notLookedAt: boolean }[]; perWeek: { at: Date; sightings: number }[]; spotters: number; areasVersion: number }>`.
- **The cells** are `blurPosition(lat, lng)` from `lib/blur.ts` (250 m), over resolved **and** pending sightings in the range.
- **`notLookedAt`** is a cell centre within 500 m of a current area centre with no sighting.
- **`spotters`** counts distinct `device_id` with a sighting in the range. `sightings` has no `account_id`. A deleted spotter's sightings have no device, so they count towards sightings but not spotters, which the page says. It's a count, never a list.
- **The SVG** draws the cells on a plain projection (lng × cos(37.44°)) and writes the area names at their centres (Decision 13). This page draws the cell centres, not exact positions, so it isn't added to the position guard. Its source test still forbids `toFixed` on raw positions.

- [ ] **Step 1: Failing tests:**
  - two sightings in the same cell make one cell;
  - a cell 400 m from Kini's centre with nothing in it is `notLookedAt`, and one 600 m away isn't;
  - `spotters` counts a device once;
  - **the page and the CSV hold no position at all:** the SVG draws each cell as a `<rect>` at whole-number viewBox coordinates worked out on the server, and the CSV lists areas with their counts of looked-at and not-looked-at squares, never cell coordinates. `blurPosition` gives 6 decimals (`blur.ts` `PUBLISHED_DECIMALS`), so cell centres are never printed. Assert no `\d+\.\d{3,}` in either.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-396 PR 3.3b: Coverage and spotting`

#### Task 3.3b.2: Welfare patterns

**Files:**
- Create: `artifacts/api-server/src/lib/reports/welfarePatterns.ts`. It imports `WelfareKind`, `WELFARE_ORDER`, `WELFARE_COLOUR` and `kindOf` from PR 2.6's `lib/dashboard/welfareKinds.ts`; the block below shows their definitions for reference
- Modify: `lib/teamPages/reportPages.ts`
- Test: `lib/reports/welfarePatterns.test.ts`

**Interfaces:**
- Produces:

```ts
export type WelfareKind = "litter" | "urgent" | "attention";
export const WELFARE_ORDER: readonly WelfareKind[] = ["urgent", "attention", "litter"];
export const WELFARE_COLOUR: Record<WelfareKind, string> = { urgent: "#b42318", attention: "#a08000", litter: "#5b4b8a" };
export const kindOf = (r: { severity: "urgent" | "attention"; isLitter: boolean }): WelfareKind => r.isLitter ? "litter" : r.severity === "urgent" ? "urgent" : "attention";
export async function welfarePatterns(range: Range, now: Date): Promise<{ perWeek: { at: Date; counts: Record<WelfareKind, number> }[]; drafts: number; contentReports: number; topAreas: { area: string; count: number }[] }>;
```

- Reports are counted by `coalesce(submitted_at, created_at)` with `kind='welfare'` and `is_draft=false`. Drafts and `kind='content'` are counted separately.
- The SQL selects **no** state, `state_changed_at` or `state_changed_by`. That's D6 made structural.
- The red and amber kinds always come with their word and an icon.
- `WELFARE_COLOUR` is checked against the palette checker (see Model delegation) before merge.

- [ ] **Step 1: Failing tests:**
  - an urgent litter counts as `litter` only;
  - the kinds sum to the total;
  - a content report raises `contentReports` and nothing else;
  - **a source test fails if `welfarePatterns.ts` mentions `state_changed` or `stateChanged`.**
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.** **Step 5: Mutation probe:** add `stateChangedAt` to the select. The source test **must** go red. Restore it. **Step 6: Commit:** `SYC-396 PR 3.3b: Welfare patterns, patterns not performance`

### PR 3.3c: Vet visits and costs (after 3.1 and 3.3a)

**What the team sees:**
- visits and Syros Cats' spend per month;
- spend split by what was done;
- the cost per sterilisation, average and range;
- how many sterilisations have no cost recorded;
- a table of every visit (cat, date, clinic, what was done, cost, who paid), which downloads for the accounts.

#### Task 3.3c.1: The vet report

**Files:**
- Create: `artifacts/api-server/src/lib/reports/vetCosts.ts`
- Modify: `lib/teamPages/reportPages.ts`
- Test: `lib/reports/vetCosts.test.ts`, `routes/team.reportPages.test.ts`

**Interfaces:**
- Produces: `vetCostsReport(range, now): Promise<{ perMonth: { at: Date; visits: number; spendEur: number }[]; byPurpose: Record<"sterilised" | "vaccinated" | "treated" | "checked", number>; perSterilisation: { avg: number; min: number; max: number; n: number } | null; noCost: number; visits: VisitRow[] }>`.
- **Spend** counts only `syros_cats` and `donation` (§8.4). Owner-paid visits are listed in the table, but never added.
- **`byPurpose`** uses Decision 14.
- **`noCost`** counts the standing team `sterilised: true` rows **without** `vetVisitId` in the range, plus visits with Sterilised and `costEur: null`.
- The page and CSV need `view_vet_costs` on top of `view_reports`.

- [ ] **Step 1: Failing tests:**
  - an owner-paid €60 visit appears in `visits` but not in `spendEur`;
  - a Sterilised-and-Vaccinated visit goes under `sterilised` in `byPurpose` only;
  - a sterilisation made with "Update this cat" counts in `noCost`;
  - an undone visit is nowhere.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-396 PR 3.3c: Vet visits and costs`

---

## Phase 4: the impact report

### PR 4.1: The impact report for funders (after 3.3a and 3.1)

**What the team sees:** **Impact report** in Reports. It's one page to print, save as a PDF from the browser, or download as a spreadsheet.
- It states the headline with confidence ("142 street cats known on Syros. 89 confirmed sterilised, …") and is dated to the minute.
- It shows the period's progress, figures for each named area with at least 5 cats, milestones as counts, vaccinations (hidden below 5), and Syros Cats' vet spend.
- It explains plainly how the figures are worked out.
- Running it again for the same "as of" moment gives the same figures.
- **It never shows a cat, a colony, a feeding site or a person.**

#### Task 4.1.1: The figures

**Files:**
- Create: `artifacts/api-server/src/lib/reports/impact.ts`
- Test: `lib/reports/impact.test.ts`

**Interfaces:**
- Consumes: `loadTeamCats(asOf, { asOf })`, `headline`, `splitOf` (PR 2.0); `namedAreasAt(asOf)` and `areaForIn` (PR 2.4); the vet visit loaders (PR 3.1).
- Produces:

```ts
export const MIN_AREA_CATS = 5, MIN_VACCINATED = 5, CAT_MILESTONE_EVERY = 100;
export interface Impact {
  asOf: Date; from: Date | null; areasVersion: number; producedBy: "Syros Cats, from Cat Spotters records";
  headline: Headline;
  progress: { newCats: number; sterilisations: number; coloniesWithSterilisation: number };
  areas: { name: string; street: number; split: Split }[];        // only areas with >= 5 street cats, then one "Elsewhere on Syros"
  milestones: string[];                                             // counts only, e.g. "100th cat recorded"
  vaccinated: number | null;                                        // null when < 5
  spend: { eur: number; perSterilisation: number | null };
}
export async function impactReport(o: { from: Date | null; asOf: Date }): Promise<Impact>;
```

- Everything is read **as of `asOf`** (Decision 10), including the areas, through `namedAreasAt(asOf)`.
- **Milestones:**
  - every 100th cat recorded, where the count crossed a multiple of 100 between `from` and `asOf`;
  - "N colonies fully sterilised this year": colonies with **at least one** street cat where every street cat is confirmed sterilised as of `asOf`, but which weren't as of `from`. A colony with no street cats is never "fully sterilised";
  - **never a colony's name.**
- "Off Syros" cats are counted nowhere.

- [ ] **Step 1: Failing tests:**
  - **reproducible:** compute as of T, add records afterwards (a new cat, a correction to an older one, and a moved area centre), compute as of T again, and require `toEqual` on the whole object;
  - an area with 4 street cats folds into "Elsewhere on Syros";
  - 4 vaccinations give `null`;
  - **no colony, cat, site or person name appears in `JSON.stringify(impact)`**: seed each with a unique marker string (`vt-impact-<RUN>-colony`, and so on) and assert that no marker appears.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Mutation probes:**
  - use `currentAreas()` instead of `namedAreasAt(asOf)`: the reproducible test **must** go red;
  - put a colony name in a milestone: the marker test **must** go red.

  Restore both.
- [ ] **Step 6: Commit:** `SYC-396 PR 4.1: impactReport, reproducible as of a moment`

#### Task 4.1.2: The page, print, PDF and CSV

**Files:**
- Modify:
  - `lib/capabilities.ts` gains `view_impact_report: { kind: "island", roles: TEAM }`, and roles §6.2 gains its row: `| \`view_impact_report\` | Produce the impact report for funders | Island-only | ✓ | ✓ | — |`;
  - `routes/teamReportsArea.ts`: `GET /team/insights/impact` and `GET /team/insights/impact.csv`. `?asOf=YYYY-MM-DDTHH:MM` (Athens) defaults to now, rounded down to the minute and never after now. `?from=YYYY-MM-DD` is optional.
- Create: `artifacts/api-server/src/lib/teamPages/impactPage.ts`.
  - It's a print-first page with an `@media print` sheet: no menu, A4 margins of 15 mm, a white background, and black-and-white-safe bars using the mark shapes.
  - It has no print button, because the strict security header allows no script. Instead, a line at the top says "To keep a copy, use your browser's Print, then Save as PDF." The line is hidden when printed.
  - It carries the method note (§9.4), in plain words, including that a cat recorded twice and not yet merged may be counted twice.
  - Each run's copy names the "as of" moment and gives a link to run it again for the same moment.
- Test: `routes/team.impact.test.ts`

- [ ] **Step 1: Failing tests:**
  - the page shows "As of 18 Oct 2026, 16:40", and the "run again" link carries the same `asOf`;
  - two GETs with the same `asOf`, either side of a new record, give the same HTML body figures;
  - **the page and CSV hold no colony, cat, site or person marker** (seeded as in 4.1.1), no coordinates (`\d+\.\d{4,}`) and no photo URL;
  - a guardian gets 403;
  - the CSV download is recorded.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Look at it:** print to PDF from Chrome at A4. Check the margins and the white background, and that nothing is cut across pages (CLAUDE.md: verify generated documents before handing over). Save the PDF and screenshots to `docs/screenshots/syc-396-pr-4-1/`.
- [ ] **Step 6: Commit:** `SYC-396 PR 4.1: the impact report page, print and spreadsheet`

**Phase 5 (Donations)** stays blocked on James. The Reports list shows "Coming once donations are set up" (PR 3.3a), which the spec intends.

---

## Model delegation

This plan was written on Opus. That was synthesis across the spec, three code inventories run on Sonnet, and Samuel's decisions. Building defaults to Sonnet. Each escalation to Opus is justified in its row.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 2.0 Counted cats and the bar | Sonnet | Pure functions and a loader refactor, with a clear spec | Tests, including the `splitOf` invariant over 200 cats; **mutation probe** on `isStreet`; the session model re-runs `teamCatList.test.ts` and `team.catGrid.test.ts` itself |
| PR 2.1 Home (figures, page, menu) | Sonnet | Server-drawn page following the queue and grid patterns | Tests with delta assertions; **mutation probe** on the per-section `try`; screenshots at 390px and 1280px reviewed by the session model; Sonnet adversarial review in its own worktree |
| PR 2.2 Colonies figures and cards | Sonnet | Clear rules, existing query patterns | Tests per flag; **mutation probes** on the guardian Kittens branch and on `FILTERED_MODULES`; `strings.test.ts`; Sonnet adversarial review |
| PR 2.3 Planner, price setting, printable plan | Sonnet for 2.3.1 and 2.3.3; **Opus** for 2.3.2 | 2.3.2 decides which position a guardian's label is drawn from. A wrong choice leaks sighting positions to guardians silently | **Mutation probe** on the guardian reference point; the internal-name marker test; the catalogue test proven red first; an Opus adversarial review of 2.3.2 |
| PR 2.4 Named areas (migration, cache, page) | **Opus** | A migration that widens `mapping_events` checks, a cache shared across servers, and `namedAreasAt`, which every report's reproducibility rests on | Migration test on its own database; `migrate:check`; **mutation probe** on `namedAreasAt`; Opus adversarial review in its own worktree |
| PR 2.6 Map layers | **Opus** | Changes the map script (the riskiest file in phase 1) and puts exact welfare positions in a page | **Mutation probe** on the 30-day bound; the internal-name and no-address checks; a three-browser check; Opus adversarial review |
| PR 2.5 Find from a photo | **Opus** | A paid AI service with caps, a new upload parser, and photo privacy (EXIF, hidden photos, nothing stored) | **Three mutation probes** (EXIF, display photo, limiter order); the row-count test; one live probe on the test site with a heads-up to Samuel; Opus adversarial review focused on the upload and caps |
| PR 3.0 Resolver groundwork | **Opus** | Changes how sterilisation is resolved for every cat. Restore semantics and "as of" are both silent-failure risks | The **replay check** over 300 generated histories against a frozen copy of the old resolver; **three mutation probes**; Opus adversarial review whose brief is to find a cat whose answer changes |
| PR 3.1a Vet visits | **Opus** | Multi-statement transactions, D8, undo, and cost visibility to guardians | The rollback test; **mutation probes** on D8 (with the visit dated before the guardian's "no"), undo and `costs: false`; Opus adversarial review |
| PR 3.1b Vet settings | Sonnet | One setting, one page, copying the areas history pattern | Migration test; `migrate:check`; Sonnet adversarial review |
| PR 3.2 Round logging | Sonnet | Reuses 3.1's writer in a loop | All-or-nothing test; Sonnet adversarial review |
| PR 3.3a Charts, CSV, downloads, progress, health | Sonnet for the charts and pages; **Opus** for `csv.ts` and `downloads.ts` | CSV escaping and the download record are silent-failure guards: a bad escape or an unrecorded download looks like success | **Mutation probes** on the `-` escape and on record-before-send; migration test; black-and-white print check; palette check of every chart colour (below) |
| PR 3.3b Coverage, welfare | Sonnet | Clear queries and rules | The `state_changed` source test with its **mutation probe**; the no-5-decimals check |
| PR 3.3c Vet costs | Sonnet | Sums over 3.1's records | Tests for owner-paid, purpose and undone visits; session-model diff review |
| PR 4.1 Impact report | **Opus** | Outside readers, privacy limits (no cat, colony, site or person), and reproducibility | The **reproducible** test; marker tests on the figures, page and CSV; **two mutation probes**; Opus adversarial review; the session model checks the A4 PDF itself |
| Greek and French drafts for new guardian words (2.2, 2.3, 3.1) | Sonnet | Translation drafts, flagged on SYC-346 for Johnny | `strings.test.ts` parity; Johnny's check |
| Bulk test-fixture updates (menu words, `NAMED_AREAS` → `SEED_AREAS`) | Haiku | Mechanical find-and-replace | The full api-server suite, re-run by the session model; diff spot-review |
| Adversarial review of every PR | Opus where the row says so, Sonnet otherwise, **one worktree per reviewer** (LIF-79) | Finding what tests miss | The reviewer must make a named test fail, not just read the code; findings are folded in before `gh pr ready` |
| Adversarial review of this plan | Sonnet (SYC-463) | Checking the plan against the spec and the inventories | Findings folded in before Samuel's approval |

**Every agent prompt restates:** "Commit after each task. Write a checkpoint line to PROGRESS.md after each task. Never hold work only in memory. Do not sub-delegate." It also lists the sessions live at the time and the files they hold.

**Re-running tests:** before any merge, the session model re-runs the named test files itself (memory `rerun-delegated-tests`).

**Chart colours:** before PR 3.3a merges, every new colour is run through the dataviz skill's palette validator against the page background (`#f6f4ef`) and white cards:
- the welfare kinds `#b42318`, `#a08000` and `#5b4b8a` (Needs attention was `#8a6d1d` until PR 3.3a's check on 21 Oct 2026: beside Urgent's red it failed colour-blind separation, ΔE 4.0 for deuteranopia. `#a08000` passes every check on both surfaces, ΔE 10.8, and keeps 3:1);
- the neutral total line.

Each must reach at least 3:1. Any that fails is changed in the plan's constant and in the code together.

**Where else must each invariant hold?** This is the consumer list for the silent-failure guards. Each item names a site a builder might forget.
- **Who is counted (§9.5):**
  - Home's headline and Not seen lately;
  - Colonies' bars and flags;
  - the planner's To do and estimate;
  - Sterilisation progress (every point);
  - Colony health;
  - the impact report's headline, areas and milestones;
  - Find from a photo's narrowing count;
  - the Areas page's cat counts.

  All of them go through `countedCats.ts` and `loadTeamCats`.
- **Never a site's internal name:**
  - `usualPlace`;
  - the printed plan;
  - colony health's CSV;
  - coverage (it draws no sites);
  - the impact report;
  - Home's report lines (they use `placeLabel` with no site);
  - the Areas page.
- **No position in our addresses:**
  - the Home links;
  - colony sort links;
  - `/plan`;
  - the Areas forms (body only);
  - Find from a photo (results only in a POST response);
  - the round form's `?add=` (a search term and ids only);
  - report ranges (dates only);
  - the impact report's `asOf`.
- **Guardians see no cost, vaccination, sighting position, other colony or team name:**
  - colony cards (`colonyFigures` with `Visible`);
  - the planner (discovery positions, no estimate);
  - the guardian cat page (`visitsFor` with `costs: false`, vaccinations dropped);
  - the guardian changes list;
  - and, after Q1, the guardian reports.

  Each guardian-visible page is in `hers()` in `team.guardianView.test.ts`.
- **"As of" means entered by then:**
  - progress points;
  - the impact report;
  - `namedAreasAt`;
  - colony health's 90-day change (it uses `asOf` 90 days back).
- **Statements from a visit change only through the visit:**
  - the generic Mark wrong route;
  - the JSON supersede route (`POST /team/observations/:id/supersede`, `routes/observations.ts:197`). It gets the same refusal and the same test.
- **D6, patterns not performance:**
  - Home;
  - Welfare patterns (source test);
  - Colony health (no per-guardian figures beyond "guardian yes or no");
  - the impact report.

## How the plan review was handled (18 Oct 2026)

A Sonnet critic checked the draft against the spec, the earlier plan and the code: about 60 claims, with file and line evidence. It found 6 blockers, 8 major and 3 other groups of issues. Each is handled in the plan above:

| # | Finding | Handled in |
|---|---|---|
| 1 | Home linked to report pages that don't exist; it missed unchecked reports | 2.1.2: links to `/api/team#r-<id>`; an "N reports waiting for a check" line; queue photo URLs |
| 2 | The restore rule was only in the resolver; the writer, three other readers and evidence of life disagreed | 3.0.1 (writer checks, `fromVisitUndo` only); 3.0.2 (other readers, retractions never evidence, vaccinated order) |
| 3 | Undo couldn't use `supersedeStatement`; `vetVisitId` wasn't tied to a cat; one sterilised id where several are possible | 3.1.1: undo through `writeObservation`, a cat-scoped lookup, `sterilisedIds[]`, the validator checks the link |
| 4 | `namedAreasAt` would be empty before the migration; the checks weren't widened; the version was ambiguous | 2.4.1: widen first, seed events dated 15 Oct, a fallback for older dates; 2.4.2: one version rule, full-row events |
| 5 | "As of" ignored colony membership; progress loaded the island 24 times; vacuous "fully sterilised" | 3.0.3 (`currentColonyOf` as of, `resolveAt`); 3.3a.3 (load once); 4.1.1 (at least one street cat); Decision 10's known limit |
| 6 | A guardian's planner carried sighting positions in the `TeamCat` fields | 2.3.2: an explicit `GuardianPlanCat` field list, and a serialised-output test |
| 7–8 | Find from a photo: wrong photo helper, full-size photos, paged list, fixed-window caps, upload errors, route order, entry points, tie fields | 2.5.1 and 2.5.2 |
| 9 | The download log wasn't really append-only | 3.3a.2: its own trigger and a test |
| 10 | The Areas page test contradicted Open map links; nothing linked to the page | 2.4.3 |
| 11 | Wrong cites (sightings `account_id`, blur decimals, test file names, `TEAM_HOME` users) | Corrected where cited |
| 12 | Off Syros was counted | 2.0.2: `isStreet` and a reconcile test |
| 13 | Parallel PRs claimed to share no files did; migration order | Sequencing (waves, shared lists); migrations take the next free number when each PR leaves draft |
| 14 | Source-test registration was missing for new readers | 2.4.2 (`areaHistory.ts`), 3.3a.3, 4.1 |
| 15 | Spec items with no task: the headline link, sortable health columns, vaccination rights, CSV in Greek, area name races, the `off` key | 3.3a.3, 3.1.1, 3.3a.1, 2.4.1 |
| 16 | Tests that would flake or pass wrongly in the shared database | 2.1.2 (injected loaders), 2.4.2 (per-run keys), 2.5.1 (since-start checks) |
| 17 | The schedule was optimistic | "Fit to 31 October": the critical path named, 3.1 split, at most three agents at once, Johnny's pack timing |

One claim was checked and **not** taken: the critic said `catDisplayPhoto` doesn't exist. It does (`photoVisibility.ts:165`), but it returns a URL, not bytes, so the fix (use `catDisplayPhotoIds` plus the medium version) stands anyway.

## Self-review against the spec

- **§3.1 menu:** PR 2.1 (Task 2.1.3); Reports in 3.3a.
- **§3.3 areas:** editable in PR 2.4; versions in `namedAreasAt`. Off Syros is unchanged.
- **§4 Home:**
  - sections 1–5: PR 2.1;
  - vet spend: PR 3.1;
  - Needs an OK, Ask Syros Cats to match it and Matched by hand stay hidden until their records exist (Decision 2, ticketed).
- **§5.2 Find from a photo:**
  - PR 2.5: narrowing, groups of 10 plus a final round, the bands, the words, the caps, EXIF and nothing kept;
  - the reset wording changes slightly (Decision 17).
- **§6.1 extra layers and the §9.1 Map switch:** PR 2.6 (Samuel, Q3: before launch). The welfare layer at the 30-day window; the coverage layer as "Not looked at yet".
- **§7.2 Log a vet visit button:** PR 3.1. **Add a note** stays on SYC-446, outside this plan.
- **§8:**
  - 8.1 team only: PR 3.1;
  - 8.2 fields: PR 3.0 and 3.1;
  - 8.3 one save, undo together, D8, proof of life: PR 3.0 and 3.1;
  - 8.4 money: PR 3.1 and 3.3c;
  - 8.5 rounds: PR 3.2, with Q2 deciding the new-cat option.
- **§9.1:** PR 2.2. **§9.2:** PR 2.3, with round logging in 3.2.
- **§9.3 reports:** 1 and 2 in 3.3a; 3 and 4 in 3.3b; 5 in 3.3c; 6 in 4.1; 7 in 3.3a's list as "Coming once…". Ranges, the date rule, tables and safe recorded CSV: 3.3a.
- **§9.4:** PR 4.1. **§9.5:** PR 2.0. **§9.6:** every loader logs its milliseconds; no cache is added.
- **§9.7:** phase 5, blocked on James.
- **§10.2 guardians:**
  - Colonies list and planner: 2.2, 2.3;
  - vet visits seen: 3.1;
  - reports: Q1;
  - Cats grid and Map: SYC-455, outside this plan;
  - Home and Find from a photo: none, as the spec says.
- **§10.3 capabilities:**
  - `view_vet_costs` and `print_trapping_plan` (new, added by this plan) in 2.3;
  - `edit_named_areas` in 2.4;
  - `find_cat_from_photo` in 2.5;
  - `log_vet_visit` and `edit_vet_settings` in 3.1;
  - `view_reports` and `export_report` in 3.3a;
  - `view_impact_report` in 4.1;
  - history for areas and the price: 2.4, 3.1.
- **§12:** marks and `markBar` (2.0), chart rules (3.3a), feeding sites as squares on the planner map (2.3), 12px checked in each PR's screenshot review, and the palette check (Model delegation).
- **§13 errors and empty states:**
  - Home: 2.1;
  - Find from a photo: 2.5;
  - Colony planner: 2.3;
  - Reports: 3.3a;
  - Vet visit form: 3.1.
- **§14:** no new script anywhere in this plan. Every new page keeps the strict header, and `team.headers.test.ts` checks it.
- **Placeholder scan:** done. Every task names its files, its signatures and its tests.
- **Type consistency:** these names are used consistently across tasks:
  - `TeamCat` and `Split` (2.0), used by 2.1, 2.2, 2.3, 3.3a and 4.1;
  - `VetVisitValue` (3.0), used by 3.1, 3.2 and 3.3c;
  - `Range` (3.3a), used by 3.3b, 3.3c and 4.1;
  - `namedAreasAt` (2.4), used by 3.3a and 4.1.
