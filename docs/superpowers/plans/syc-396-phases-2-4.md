# Team dashboard redesign: implementation plan for phases 2, 3 and 4

**Status:** draft for Samuel's approval on Tue 20 Oct 2026. One combined plan, as Samuel decided on 18 Oct (D1, recorded on SYC-463).

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
- Sterilisation costs €50–60 per cat. The default standard price is **€55**.
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

**Migrations.** Three are planned, numbered in the order the PRs are expected to merge:
- `0031_named_areas` (PR 2.4);
- `0032_vet_settings_history` (PR 3.1);
- `0033_report_downloads` (PR 3.3a).

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

**Wave 1 (from Tue 20, once this plan is approved):** these can run in parallel, with no file collisions between them.
- 2.0 is small and should merge first, on Tue 20 or Wed 21.
- 2.4 and 2.5 don't need 2.0.
- 3.0 touches only the resolver and the observation writer.

**Wave 2 (once 2.0 merges):** 2.1, 2.2 and 3.3a run in parallel.
- 2.3 starts once 2.2 merges, because both change `lib/teamPages/colonyPages.ts`.
- 3.3a needs 2.4 for its areas version line, but can be built against the read-only list and rebased.

**Wave 3:**
- 3.1 starts once 3.0 and 2.3 merge (it needs the price setting and `view_vet_costs` from 2.3).
- 3.2 and 3.3c follow 3.1.
- 3.3b follows 3.3a.
- 4.1 follows 3.3a and 3.1.

**What else is running.** SYC-44's 6.1, 6.2 and 7.1 change `queuePage.ts` and add the Issues section. PR 2.1 links to that section by the anchor `#issues`, so 7.1's builder must give the section `id="issues"` (agreed through SYC-44). SYC-439 (#229) changes colony creation in `teamColonies.ts`. PR 2.2 rebases on it if #229 merges first.

**Fit to 31 October (D2).** The launch plan has eight building days, from Tue 20 to the freeze on Wed 28. Phase 2 (six PRs) and 3.0, 3.1 and 3.2 fit. 3.3a–c and 4.1 are the first to slip, in D2's order. Every PR here can go live any day after 31 October without a relaunch.

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
7. **A statement created by a visit can only be undone through the visit.** The generic "Mark wrong" refuses rows that carry a `vetVisitId`, with the words "This came from a vet visit. Mark the visit wrong instead." Otherwise a cat page and the vet report could disagree.
8. **The standard price is an app setting, `standard_sterilisation_price_eur`, defaulting to 55.** Its changes go into `mapping_events` as a new subject kind, `vet_settings`, the "same add-only history" §10.3 asks for.
   - PR 2.3 reads it for the planner's estimate.
   - PR 3.1 adds the page that changes it.
9. **Named areas move into a `named_areas` table** (migration 0031). The first rows are seeded from today's 22 entries.
   - `areaFor` and `areaByKey` stay synchronous by reading a cache. The cache reloads after any write on this server, and at most 60 seconds later on every other server.
   - Their changes go into `mapping_events` as subject kind `named_area`.
   - `namedAreasAt(asOf)` rebuilds the list as it stood at any moment, so a report names its version and an old report never moves.
   - The public map's "Go to" list (`lib/mapTiles/areas.ts`) is a separate list, and stays untouched.
10. **"As of" means "entered by then".** A report as of time T uses only observations, sightings, cats and welfare reports with `createdAt <= T`.
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
    - The candidates' reference photos are their **display** photo (`catDisplayPhoto`), never a hidden one. This also fixes SYC-303 for this route.

## Questions for Samuel (with the approval)

These change the spec's scope, so they're his.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should cat guardians get their two reports (Sterilisation progress and Colony health, for their own colonies) on 31 Oct, or on 16 Nov? | **16 Nov.** The reports land after Johnny's copy freeze (Thu 22), so their Greek and French would go live unchecked, and the reports are the third thing to slip anyway. The team gets them as soon as they're built. |
| Q2 | Should round logging be able to create a new cat for one trapped on the round that isn't in the records yet (§8.5)? | **Not at launch; 16 Nov.** A new cat needs a photo and a position, which makes it a second form. At launch, the round form can add any existing cat, and a new cat is made the usual way first. |
| Q3 | The Colonies list's Map switch, and the map layers for colonies, welfare reports and "Not looked at yet" (§6.1, §9.1): now or later? | **Later, on SYC-454.** They change the Map's script, the riskiest file in phase 1. The Colonies list and the reports show the same facts as words and tables. |

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
  - `loadCatRecords(ids)` (`lib/observations.ts:1002`);
  - `resolveCat` (`lib/resolve.ts:1532`);
  - `currentColonyOf` (`lib/colonyMembership.ts`);
  - `catIdentityTable` (`lib/db/src/schema/observations.ts`, `{ catId, canonicalCatId, supersedesId }`).
- Produces:

```ts
export interface TeamCat extends CatListItem {
  createdAt: Date;                       // cats.created_at: "new to the records"
  snapshot: CatSnapshot;                 // the resolved cat, for figures that need more than the card
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
export const isStreet = (c: TeamCat): boolean => c.lives === "street";
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
    - a homed cat seen 100 days ago is out.
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
  needs: { reports: QueueReport[]; reportsTotal: number; drafts: QueueDraft[]; issuesOpen: number; awaitingMatch: number };
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
  - `lib/teamAuth/config.ts` (`TEAM_HOME` becomes `…/api/team/home`);
  - `routes/team.ts` (the sign-in hand-off and `alreadySignedInAs` land on Home for holders of `view_welfare_queue`).
- Test: `artifacts/api-server/src/routes/team.home.test.ts`

**Interfaces:**
- Produces: `GET /api/team/home`, gated by `requireTeam("view_welfare_queue")`. It's island-wide, so guardians get the walk's default `forbidden`. Also `renderHomePage(d: HomeData, o: { personName: string; now: Date }): string`.

**The page** (§4, in this order). A section shows only when it has something:
1. **Needs us now:**
   - up to 5 reports from `needs.reports`, each one line: small photo, `placeLabel`, `timeAgo`, and the first 80 characters of the note, escaped. Each links to `/api/team/reports/:publicId`;
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
- **Nothing to act on:** "Nothing needs you right now." The headline and This month still show.
- **A failed figure:** the section shows "This figure isn't available right now" and the rest of the page still draws. Each section's data is read in its own `try`.

- [ ] **Step 1: Write the failing tests:**
  - a team member gets 200 and the sections in order (assert index order in the HTML);
  - a guardian gets 403;
  - signing in lands on `/api/team/home` (copy the hand-off test from `team.signin.test.ts`);
  - an empty Needs section is absent;
  - the headline numbers match `headline()` for the same `now`;
  - **no response time, "open for", per-person count or name of a team member appears anywhere** (a regex list of "minutes open", "response", "by Jacky");
  - a forced throw in `countOpenIssues` (with `vi.spyOn`) still renders the page with the fallback line;
  - thumbnails use `/small`.
- [ ] **Step 2: Fail. Step 3: Implement** following the `routes/teamCorrections.ts:788` GET pattern. **Step 4: Pass.**
- [ ] **Step 5: Mutation probe:** remove the per-section `try` around Needs. The forced-throw test **must** go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.1: Home, the first page after signing in`

#### Task 2.1.3: The menu, and "Ear clips to check"

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamPages/layout.ts`: `NavKey` gains `"home"`. The `NAV` array becomes Home `/api/team/home`, Cats, Map, Queue `/api/team`, Colonies, then People when shown. Likely, Colour check and Feeding sites leave it. Their pages pass `active: null`, or the nearest parent: Colour check and Ear clips use `"home"`, and Feeding sites uses `"colonies"`.
  - `lib/teamPages/likelyPage.ts`: the title and heading become "Ear clips to check". The explanation line keeps its wording.
  - `lib/teamPages/colonyPages.ts`: a "Feeding sites" link under the Colonies title.
  - The tests that pin menu labels: `team.menu.test.ts`, and any snapshot found by `grep -rn "Probably sterilised" src`.
- Test: `artifacts/api-server/src/routes/team.menu.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the team menu is exactly the six labels in order;
  - the guardian menu is unchanged;
  - `/api/team/likely` is titled "Ear clips to check";
  - Feeding sites can be reached from the Colonies page.
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
  - `artifacts/api-server/src/lib/teamPages/colonyPages.ts`: `renderColoniesPage` takes `figures: Map<number, ColonyFigures>` and `sort`, and draws each card with `markBar`.
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
- **The estimate:** "7 cats × €55 = €385".
- The colony's feeding sites on a small map.
- A **printable plan**.
- **Done:** the sterilised cats, folded away.

"Take out of this colony" moves into each cat's own small menu. Cat guardians see the To-do list for their colonies, without the estimate, the print or (later) round logging.

#### Task 2.3.1: The standard price setting, and three capabilities

**Files:**
- Modify:
  - `lib/db/src/appSettings/shape.ts`: `SETTING_KEYS` gains `"standard_sterilisation_price_eur"`, and `settingShapeProblem` accepts an integer from 1 to 500.
  - `artifacts/api-server/src/lib/appSettings.ts`: `AppSettings` gains `sterilisationPriceEur: number`, default `55`.
  - `artifacts/api-server/src/lib/capabilities.ts` gains `view_vet_costs: { kind: "island", roles: TEAM }` and `print_trapping_plan: { kind: "island", roles: TEAM }`.
  - `docs/specs/roles-and-invites.md` §6.2 gains the two rows, under "Seeing": `| \`view_vet_costs\` | See vet costs, who paid, and estimates | Island-only | ✓ | ✓ | — |` and `| \`print_trapping_plan\` | Print a colony's trapping plan | Island-only | ✓ | ✓ | — |`.
  - `docs/specs/team-dashboard-redesign.md` §10.3 gains the `print_trapping_plan` row, with a line noting it was added by this plan.
- Test: `lib/db/src/appSettings/shape.test.ts`, `lib/appSettings.test.ts`, `lib/capabilities.catalogue.test.ts`

- [ ] **Step 1: Failing tests:**
  - the shape refuses `0`, `501`, `"55"` and `55.5`;
  - a bad stored value falls back to 55;
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
export interface TrappingPlan {
  colonyId: number; toDo: PlanCat[]; done: PlanCat[];
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
  - `estimate` is null for a guardian, and `7 × 55 = 385` for the team;
  - a colony outside `visible` returns null;
  - **no `PlanCat.usualPlace` ever contains a site's internal name:** seed the site named "Vaporia — Eleni's" with the public label "harbour steps".
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
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `positions.source.test.ts` and `position.guard.source.test.ts`.
- [ ] **Step 5: Look at it** at 390px and 1280px, and print-preview `/plan` to PDF in Chrome. Check the margins and the white background. Save to `docs/screenshots/syc-396-pr-2-3/`.
- [ ] **Step 6: Commit:** `SYC-396 PR 2.3: the colony page is a trapping planner, with a printable plan`

### PR 2.4: Named areas the team can edit (migration 0031)

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
- Create: `lib/db/migrations/0031_named_areas.sql`, generated, then edited by hand:
  - insert today's 22 rows from `NAMED_AREAS`, in the same order, with the same keys;
  - write one `area_added` event per row with `actor_system = 'system:migration'` and `after = {key,name,lat,lng}`;
  - a commented rollback.
- Test: `lib/db/src/migrate/namedAreas.test.ts`. It uses its own throwaway database, applies the migration, and checks 22 rows, 22 events, and that the history trigger still refuses an update.

- [ ] **Step 1: Failing test. Step 2: Fail. Step 3: Implement** with `pnpm --filter @workspace/db run generate --name named_areas`, then the seed SQL. **Step 4: `migrate:check` and the test pass. Step 5: Commit:** `SYC-396 PR 2.4: named_areas table, seeded with version 1 (migration 0031)`

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
- **`changeArea`** runs in one transaction: lock the row, check the change, update `named_areas`, then `recordMappingEvent(tx, { subjectKind: "named_area", subjectId: row.id, kind, personId, before, after })`.
  - A new or moved centre must be on Syros: inside the box lat 37.36–37.52, lng 24.86–24.99.
  - A name is 2–40 characters, and unique among the areas that aren't retired.

- [ ] **Step 1: Failing tests:**
  - `areaFor` gives the same answers as before for every seed centre;
  - after `changeArea(move)`, `areaFor` at the old centre gives the moved area **on this server immediately**;
  - after a simulated 61 s (`vi.setSystemTime`), a second process-local cache also sees it. Clear the module and load it again;
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
  - **no position appears in any `href` or `action`:** assert `not.toMatch(/[?&][^"]*\d+\.\d{4,}/)` over the page.
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
  - `catDisplayPhoto` (`lib/photoVisibility.ts`);
  - `listTeamCats` with `{ area | colony, colours }`.
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
  - **the row counts of `photos`, `sightings` and `observations` are unchanged after a search;**
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
  - `middlewares/rateLimit.ts`: `declareLimit("find_photo_person", 20, DAY_MS)` and `declareLimit("find_photo_team", 100, DAY_MS)`, plus `checkFindLimits(personId): Promise<"ok" | "person" | "team">`, which consumes both, person first, copying `checkClaimLimit`.
  - `routes/teamCats.ts`: `GET /team/cats/find` (the form and the count) and `POST /team/cats/find` (multipart).
  - `routes/team.walk.test.ts`: two rows, team only.
- Create: `artifacts/api-server/src/lib/teamPages/findPhotoPage.ts`
- Test: `routes/team.findPhoto.test.ts`

**Route details:**
- The POST is `requireOrigin(TEAM_ORIGIN)`, then `requireTeam("find_cat_from_photo")`, then `setTeamHeaders`, then `multer({ storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } }).single("photo")`.
- The filters arrive as form fields and are parsed with `parseCatFilters`.
- The limits are checked **after** the narrowing check, so a refused narrowing costs nothing, and **before** any AI call.
- A `tie` field (a welfare report's `publicId`) is carried through, and each result gets "This is the cat", which posts to the existing tie route.
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
