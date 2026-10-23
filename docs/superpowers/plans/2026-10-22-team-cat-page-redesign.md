# Team cat page redesign: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard's page for one cat (`renderCatPage`) as the approved design describes: a one-screen summary, one History list, quieter risky actions, plain words. Then add "Add a note" and the "Health note" fact.

**Architecture:** The page stays server-rendered HTML with no script. Every fold is `<details>` and every filter is a link. `catPages.ts` keeps the page assembly. Two pieces move into focused files: the History rows (`catHistory.ts`) and the summary's buttons (`catActions.ts`). The data shape (`TeamCatView`) gains one field (`vetVisitId`). The only new route is `POST /api/team/cats/:id/note`.

**Tech stack:** TypeScript, Express, Drizzle/Postgres, Vitest. HTML is built as template strings and escaped through `escapeHtml`. The CSS lives in `lib/teamPages/layout.ts`.

**Spec:** `docs/specs/team-cat-page-redesign.md` (approved 22 Oct 2026). Read it with `docs/specs/team-dashboard-redesign.md` §7 and §12. The mockup is `docs/specs/assets/team-cat-page-redesign/mockup.html`, and the review notes are `docs/reviews/team-cat-page-redesign-adversarial-review.md`.

**Linear:** SYC-602. Each PR closes the folded-in tickets it covers: PR 1 closes SYC-459 items 1, 2 and 5; PR 2 closes item 3 and SYC-331; PR 3 closes SYC-521 (except its "Probably" naming point) and SYC-469; PR 4 closes SYC-446.

## Global constraints

- Team pages are English only (Decision 12). No text below 12px. Tap targets are at least 44px (§12.1).
- Every part of the page works without JavaScript. Use `<details>`, links and forms only, and add no `<script>`.
- Keep #192's words: "What we know about this cat" (it now heads the facts panel), "Since", "Why we think so", "Says otherwise", "Date it happened", "History", "change". Never use "statement" in visible text (`catPages.words.test.ts` pins this).
- Keep the sterilised fact words exactly as `catFacts.ts` has them, including "Not known".
- No visible text shows a record number (`#301`) or a model name. Element ids such as `id="s-301"` stay, so links still land.
- Red (`risky`) is only for: Take out of this colony, Remove owner, This cat has died, Hide from the public, Mark the visit wrong.
- Capability gates are unchanged unless a task says otherwise. Each form and menu item is drawn only when `may(...)` allows it, using exactly today's checks.
- Every PR opens as a **draft** (`gh pr create --draft`). Run the affected tests locally first: the ESBUILD_BINARY_PATH workaround and dummy `AI_INTEGRATIONS_*` vars are in project memory. Then `gh pr ready` once. Wait for a CI run that succeeds; a skipped run is not a pass. PRs land in order 1 → 2 → 3 → 4. Each later PR stays a draft until the one below merges.
- Before each PR goes ready, take screenshots at 390px and 1280px from a scratch render (like `docs/screenshots/syc-396-pr-1-4/render-fixture.ts.txt`). Save them under `docs/screenshots/syc-602-pr-N/`.
- A new file that names `welfare_reports` must join the `welfareKindGuard` ALLOWLIST. Run the full api-server suite before `gh pr ready`.
- Commit after each task. Write a checkpoint note in the worktree (`.syc-602-progress.md`, never committed) saying what's done and what's next.

## Review Focus

These are inputs no task's main tests touch but that a team member will meet. Each has a test in the task named.

1. **A cat with nothing:** no photo, no sightings, no colony, no history, nothing known. The page must still render every section's empty state with no stray headings. This is the `bare` fixture in Task 1.1, re-run in each PR's page test.
2. **A viewer who may do nothing:** a read-only person sees no "Update this cat", no ⋯ items that write, no "Add a note", and no cost on a vet visit. Covered by Task 1.3, Task 2.3 and Task 4.1.
3. **Landing back after a save or after signing in again** (`done`, `at`, `p`, `kept`) where the form is inside a closed fold. The fold must be drawn open and the notice must be outside any closed fold. Covered by Task 1.3, Task 2.3 and Task 3.1.
4. **A long history:** 25+ entries with a routine run cut by the 20-row limit, plus a "Why we think so" link to an entry outside the first 20 or outside the current filter. Covered by Task 2.2 and Task 2.3.
5. **Team notes never leave the team.** A guardian's cat page, the public cat API and the guardian JSON never contain a team note's text. Covered by Task 4.2.

## Model delegation

| Work | Tier | Why | Assurance |
|---|---|---|---|
| PR 1 (summary, facts, buttons, map, layout) | Sonnet | Mostly moving existing builders and CSS, against pinned tests and a mockup. | Tests; the controller re-runs the named test files; 390px and 1280px screenshots compared with the mockup; adversarial review (Sonnet, own worktree). |
| PR 2 (one History list) | **Opus** | The join rules (sightings, visits, routine runs, the cut-off, evidence links under filters) interact. A wrong guess silently hides or duplicates evidence the team relies on. | Pure-function tests on `historyRows` with the Review Focus cases; adversarial review (Sonnet, own worktree). |
| PR 3 (photos menu, coat fold, reports) | Sonnet | Re-wiring existing forms; clear words from the spec. | Tests including the guardian-language tests unchanged; screenshots; adversarial review. |
| PR 4 (Add a note, Health note) | Sonnet | Follows the rename route's pattern exactly. | Route test plus a walk-test row; the leak tests in Review Focus 5; adversarial review with a security brief. |
| Screenshot renders, test re-runs | Haiku | Mechanical. | The controller looks at every screenshot. |

Each implementer and reviewer works in its own worktree. Each commits after every task, and the agent prompt says so word for word. Reviewers don't share a tree (LIF-79).

## File structure

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/teamPages/__fixtures__/catView.ts` | **New.** `statement(id, over)` and `catView(over)` test builders, plus `richCatView()` (the mockup's Mavros) and `bareCatView()`. Used by every new test. |
| `artifacts/api-server/src/lib/teamPages/catFacts.ts` | Facts gain a grey source line, an Owner row and "Why we think so". |
| `artifacts/api-server/src/lib/teamPages/catActions.ts` | **New.** The four buttons and the Update this cat list. The forms move here from `catPages.ts`. |
| `artifacts/api-server/src/lib/teamPages/catHistory.ts` | **New.** `historyRows` (pure) and `renderHistory`. `isRoutine`, `groupHistory` and `runWords` move here from `catPages.ts` and are re-exported from there so existing imports still work. |
| `artifacts/api-server/src/lib/teamPages/catPages.ts` | Assembles the new order. Loses the old Sightings, Vet visits and "What we know" sections. |
| `artifacts/api-server/src/lib/teamPages/appearancePage.ts` | Team variant becomes the Coat and markings fold. |
| `artifacts/api-server/src/lib/teamPages/map.ts` | Markers can carry a text label ("2–4"); `fitView` centres the points. |
| `artifacts/api-server/src/lib/teamPages/layout.ts` | CSS for the new layout. |
| `artifacts/api-server/src/lib/teamCatView.ts` | `TeamStatement.vetVisitId`; a `describeStatement` case for `team_note`. |
| `artifacts/api-server/src/lib/teamCorrections.ts` | `addTeamNote`. |
| `artifacts/api-server/src/routes/teamCorrections.ts` | `POST /api/team/cats/:id/note`. |
| `artifacts/api-server/src/routes/teamCats.ts` | Reads `?show=` and `?open=`. |

---

## PR 1: the summary, the facts and the buttons (spec §3.1–3.4, §4)

### Task 1.1: test fixtures and the facts panel

**Files:**
- Create: `src/lib/teamPages/__fixtures__/catView.ts`
- Modify: `src/lib/teamPages/catFacts.ts`
- Test: `src/lib/teamPages/catFacts.test.ts` (extend)

**Interfaces:**
- Produces: `interface CatFact { label: string; html: string; source?: string; why?: string }`; `catFacts(v, now, opts: { byId: Map<number, TeamStatement>; shown: Shown }): CatFact[]`; `renderCatFacts(v, now, opts): string`. Export `type Shown` from `catPages.ts` and move `statementHref` into `catFacts.ts` (it's used by both).
- Produces (fixtures): `statement(id: number, over?: Partial<TeamStatement>): TeamStatement`, `catView(over?: DeepPartial<TeamCatView>): TeamCatView`, `richCatView(): TeamCatView`, `bareCatView(): TeamCatView`.

- [ ] **Step 1: Write the failing tests** in `catFacts.test.ts`:
  - `it("gives Lives a source line naming who set it")`: a life_status statement by team member "Maria" on 14 Oct 2026 → the Lives fact's `source` is `"Set by Maria, 14 Oct 2026"`. By a spotter → `"Set by a spotter"`. No supporting statement → `"Worked out from the sightings"`.
  - `it("gives Last seen a count since the first sighting")`: 21 sightings, the oldest in Apr 2026, now 17 Oct 2026 → `source === "Seen 21 times since April"`. The oldest in Nov 2025 → `"Seen 21 times since Nov 2025"`. One sighting → `"Seen once"`.
  - `it("shows an Owner row only when there is an owner or an orphaned home")`: `owner.has` → label `"Owner"`, html contains `"Has an owner"` and the home note. `homePin` set → `"Home pin"` text. No owner → no Owner fact.
  - `it("puts Why we think so under Sterilised and Lives, linking into History")`: `why` contains `<summary>Why we think so</summary>`, `"Since"`, and an `href="#s-298"` link whose text is the statement's words, not `#298`. With a conflicting id, it contains `"Says otherwise"`. With asOf at the epoch, no "Since".
  - `it("keeps the colony's old name")`: `colony.wasName = "Vaporia"` → html contains `(was “Vaporia”)`.
  - `it("keeps the cat guardian's confirmation line under Sterilised")`: as today's `guardianConfirmed`, now inside `why`.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm exec vitest run src/lib/teamPages/catFacts.test.ts` in `artifacts/api-server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move `recordBlock`'s rows into `why`.
  - Move `guardianConfirmed` and the clipped-ear row into Sterilised's `why`.
  - Move the presumed-dead note into Lives' `why`.
  - `renderCatFacts` draws each fact as `<div class="fact"><dt>…</dt><dd>html<span class="how">source</span>why</dd></div>` inside `<dl class="catfacts">`, under an `<h2 class="sr">What we know about this cat</h2>`.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "SYC-602 PR 1: facts panel with sources, Owner row and Why we think so"`

### Task 1.2: the name line, the status line and the notices

**Files:** Modify `src/lib/teamPages/catPages.ts`. Test: `src/lib/teamPages/catPages.summary.test.ts` (new).

**Interfaces:** Produces `statusLine(v: TeamCatView, now: Date): string` in `catFacts.ts`.

- [ ] **Step 1: Failing tests**:
  - `it("says when the cat joined our records")`: page contains `SYR-0042 · on our records since 3 Apr 2026`.
  - `it("puts the status line under the name")`: in order, the html contains the sterilisation mark, `Lives on the street`, the colony link, and `Last seen 4 days ago`. A cat with no colony leaves the colony out; it doesn't say "No colony" in the line.
  - `it("puts notices above the name, never inside a fold")`: with `recentGuardianMark` set, the `Recently marked` notice comes before `<h1` and isn't inside any `<details>`. The same holds for the death notice and the hidden-main-photo note.
  - `it("keeps the description as one line under the facts")`.
- [ ] **Step 2: Run and see them fail** (`vitest run src/lib/teamPages/catPages.summary.test.ts`).
- [ ] **Step 3: Implement.** `renderPage`'s `afterTitle` carries the SYR line and `statusLine`. The notices move to `beforeTitle`, after the back link.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.**

### Task 1.3: the buttons and "Update this cat"

**Files:** Create `src/lib/teamPages/catActions.ts`. Modify `catPages.ts`: `correctionForms`, `colonyForm` and `summaryAndActions` move out. Test: `src/lib/teamPages/catActions.test.ts` (new).

**Interfaces:**
- Produces `renderCatActions(v: TeamCatView, may: (c: Capability) => boolean, opts: { notice: string; colonies: { id: number; name: string }[]; kept?: { formKey: string; fields: KeptFields }; done?: string }): string`.
- Produces `UPDATE_DONE: ReadonlySet<string>`, the `done` keys whose notice goes at the top of the opened Update list: `life`, `sterilised`, `renamed`, `unchanged`, `ownerRemoved`, `ownerRemovedKept`, `ownerGone`, `lifeOwnerKept`, `colony`, `colonyOut`, `colonyAlready`.

- [ ] **Step 1: Failing tests**:
  - `it("draws the four buttons in order")`: the html has `Log a vet visit`, then `<details class="update"><summary>Update this cat</summary>`, then the died form, in that order. `Add a note` is absent until PR 4.
  - `it("lists the forms in the spec's order and words")`: inside `.update`, in order: `Where the cat lives`, `Whether sterilised`, `Coat and markings` (a link to `?open=coat#appearance`), `Change the colony`, `Take out of this colony` (class `risky`, only when the cat has a colony), `Rename the cat`, `Remove owner` (class `risky`, only with an owner or orphaned home and `remove_owner` plus `set_life_status`).
  - `it("draws nothing a person may not do")`: with `may = () => false` there is no `.update`, no vet button and no died button.
  - `it("opens the list and the form when the page comes back to it")`: `kept.formKey === "life:42"` → `<details class="update" open>` and the life form's `<details open>`. `done = "colony"` → the list is open and the notice is its first child. `done = "visit"` → the list stays closed.
  - `it("keeps the died button apart and hides it for a dead cat")`: as today's SYC-513 test, now against `renderCatActions`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Reuse today's form bodies unchanged. Only the summaries' words change, and "Take out of this colony" becomes its own `<details>` with the existing form. "How changes work" moves to PR 2's History footer. Until PR 2 lands, keep it at the end of `renderCatActions`.
- [ ] **Step 4: Run and see them pass.** Also run `catPages.words.test.ts`, `catPages.kept.test.ts`, `team.died.test.ts` and `team.removeOwner.test.ts`. Update their expected words to the spec's new words only where the spec changed them: "Update where the cat lives" → "Where the cat lives", "Update whether sterilised" → "Whether sterilised", "Colony" → "Change the colony", and `>Update this cat</h2>` → `<summary>Update this cat</summary>`. Don't change any other expectation.
- [ ] **Step 5: Commit.**

### Task 1.4: the small map (SYC-459 items 1 and 5)

**Files:** Modify `src/lib/teamPages/map.ts` and `catPages.ts` (`sightingsMap`). Test: `src/lib/teamPages/dashboardMap.fit.test.ts` (extend) and `catPages.summary.test.ts`.

**Interfaces:** `MapMarker` gains `text?: string`, drawn instead of `n` when set. Produces `mergeSameSpot(markers: MapMarker[]): MapMarker[]` in `map.ts`.

- [ ] **Step 1: Failing tests**:
  - `it("draws one marker per spot with the range of its numbers")`: sightings 2, 3 and 4 at the same lat/lng to 5 decimal places → one marker with text `"2–4"`. Numbers 2, 5 and 7 at one spot → `"2, 5, 7"`.
  - `it("centres the points among the views that fit them all")`: points clustered at a view's left edge → `fitView` returns the fitting view whose centre is nearest the points' centre.
  - Caption: it starts with the newest sighting's place (`placeLabel`, as Last seen uses). With 41 sightings it adds `Newest 30 of 41`. The link reads `Open the map` and keeps `?view=map&focus=<id>`.
  - Each marker links to its History row: `#sg-<sightingId>` now means the sighting row's id in PR 2. Until then it keeps today's target.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** **Step 4: Run and see them pass**, plus `dashboardMap.*.test.ts`. **Step 5: Commit.**

### Task 1.5: layout, page order and jump links

**Files:** Modify `layout.ts` (CSS) and `catPages.ts` (`renderCatPage` order). Test: `catPages.summary.test.ts` and `catPages.history.test.ts` (its wide-layout case).

- [ ] **Step 1: Failing tests**:
  - `it("orders the summary for a phone")`: in source order, the photo (`catmain`), the strip, `catfacts`, `publicline`, the actions, `catmap`, then `<nav class="jump"`.
  - `it("has jump links, none marked as selected")`: `href="#history"`, `href="#photos"` and `href="#appearance"`, plus `href="#issue-strip"` only when there are reports. No `aria-current`.
  - `it("dims hidden photos in the strip")` (SYC-459 item 2): a hidden photo's `<li>` has class `hidden`, and its alt says `hidden from the public`.
  - Bare fixture (Review Focus 1): renders with no `<h2>` that has nothing under it.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Desktop from 1000px uses `grid-template-areas:"photo id id" "photo facts actions" "map facts actions"` with columns `340px 1fr 260px`, as in the mockup. The phone layout is one column in source order. `.jump` is `position:sticky; top:env(safe-area-inset-top,0px)`. Remove the old `.catsummary` rules. Keep the classes other pages share.
- [ ] **Step 4: Run the full `src/lib/teamPages` folder and `src/routes/team.*.test.ts`. Everything passes.**
- [ ] **Step 5: Screenshots** at 390px and 1280px, of `richCatView()`, `bareCatView()` and a read-only viewer, into `docs/screenshots/syc-602-pr-1/`. Compare them with the mockup. **Commit.** Open the draft PR.

---

## PR 2: one History list (spec §3.5, decision D1)

### Task 2.1: `vetVisitId` on each history entry

**Files:** Modify `src/lib/teamCatView.ts`. Test: `src/lib/vetVisits.test.ts` or `src/lib/observations.vetVisit.test.ts` (extend; whichever already builds a visit).

**Interfaces:** `TeamStatement.vetVisitId: number | null`. On a `vet_visit` entry it is the same number as that visit's `VisitLine.visitId`. On the `sterilised` and `vaccinated` entries the visit wrote, it is their `value.vetVisitId`. Everywhere else it's null. Check how `visitsFor` derives `visitId` before writing the mapping. The test must prove the two match on a real logged visit.

- [ ] **Step 1: Failing test** `it("ties a visit's own entries to it by vetVisitId")`: log a visit (sterilised and vaccinated) through `logVetVisit`, load `teamCatView`. Three entries carry the visit's `visitId`. A plain team sterilisation entry carries null.
- [ ] **Step 2: Run and see it fail.** **Step 3: Implement. Add `vetVisitId: null` to the fixture's `statement` default.** **Step 4: Run and see it pass.** **Step 5: Commit.**

### Task 2.2: `historyRows`, a pure function

**Files:** Create `src/lib/teamPages/catHistory.ts`. Test: `src/lib/teamPages/catHistory.test.ts` (new).

**Interfaces:**
```ts
export type HistoryShow = "all" | "sightings" | "visits" | "changes";
export type HistoryRow =
  | { type: "sighting"; sighting: TeamCatView["sightings"][number]; entries: TeamStatement[] }
  | { type: "visit"; visit: VisitLine | null; entries: TeamStatement[] }  // visit null: an undone visit
  | { type: "entry"; entry: TeamStatement }
  | { type: "run"; rows: Extract<HistoryRow, { type: "sighting" }>[] };
export function historyRows(v: TeamCatView, visits: VisitLine[], show: HistoryShow): HistoryRow[];
export function historyCounts(v: TeamCatView, visits: VisitLine[]): Record<HistoryShow, number>;
```

The rules:
- Entries with the same `sightingId` join that sighting's row. A sighting with no entries is still a row.
- Entries with the same `vetVisitId` join that visit's row.
- A sighting row is routine when every entry in it is `isRoutine`.
- Two or more routine sighting rows in a row make a `run`.
- Rows are ordered newest first by `observedAt` (a sighting's `at`).
- `historyCounts`: `sightings` counts `v.sightings`; `visits` counts visit rows; `changes` counts every other row, notes included; `all` counts rows before grouping into runs.

- [ ] **Step 1: Failing tests**, each a small fixture:
  - `it("joins a sighting's entries into one row")`: a sighting with an ear tip entry and a food-and-water entry → one sighting row with both.
  - `it("joins a visit's own changes into the visit row")`: no separate sterilised row.
  - `it("never groups a sighting that recorded something that isn't routine")`: a sighting with a clipped ear stays out of runs.
  - `it("filters without losing counts")`: `show: "visits"` → only visit rows. The counts are the same whichever filter is set.
  - `it("keeps an undone visit, crossed out")`: a visit whose entries are all replaced or retracted → a row with `visit: null`.
- [ ] **Step 2: Run and see them fail.** **Step 3: Implement.** Move `isRoutine`, `groupHistory` and `runWords` here and re-export them from `catPages.ts`. **Step 4: Run and see them pass**, plus `catPages.history.test.ts`. **Step 5: Commit.**

### Task 2.3: draw History; drop the old Sightings and Vet visits

**Files:** Modify `catHistory.ts` (`renderHistory`), `catPages.ts` and `routes/teamCats.ts`. Test: `catHistory.test.ts`, `catPages.history.test.ts` and `routes/team.cats.test.ts`.

**Interfaces:**
- `renderHistory(v, visits, opts: { show: HistoryShow; all: boolean; at?: number; notice: string; may; kept?; now: Date; island: boolean }): string`.
- `CatPageOptions` gains `show?: HistoryShow`. The route reads `?show=` (`sightings`, `visits` or `changes`; anything else means `all`).

Each row carries its anchor ids:
- a sighting row is `id="sg-<sightingId>"`;
- each joined entry keeps an inner `id="s-<id>"`;
- a visit row is `id="vv-<visitId>"`.

- [ ] **Step 1: Failing tests**:
  - `it("draws a sighting row with its menu")`: `Seen in <place>`, the joined words, the author, the thumbnail. A `⋯` `rowMenu` holds `Show on the map` (island only), `Make a feeding site here`, and `Mark wrong: ear tip clipped` per markable entry.
  - `it("draws a visit row; cost only with view_vet_costs")`: the visit is drawn without `€` when the `VisitLine` has no `costEur` key. `Mark the visit wrong` is in the menu, `risky`.
  - `it("never shows a record number")`: page text (tags stripped) has no `#\d+`. `Corrects` reads `Corrects the change of 14 Oct`.
  - `it("offers no Mark wrong on the system's own colony correction")` (SYC-331): author kind `system`, kind `colony` → no Mark wrong.
  - `it("counts the whole run even when the list is cut")` (SYC-459 item 3): cut at `HISTORY_SHOWN` **rows** (not entries). A run that crosses the cut is drawn whole, with its full count.
  - `it("links Why we think so to the full, unfiltered list when the entry isn't shown")`: with `show: "visits"`, a facts link to a sighting's entry is `?history=all#s-<id>`. `?history=all` keeps working.
  - `it("opens the row's menu and fold on landing")`: `at` = a joined entry → its sighting row's menu is open with the notice inside the row, not inside a closed fold. The same for `kept.formKey === "wrong:<id>"`.
  - `it("puts the visit notices at the top of History")`: `done = "visit"`.
  - Route: `GET /api/team/cats/:id?show=visits` → 200, with only visit rows. `?show=nonsense` → the same as all.
  - The page no longer has `<h2>Sightings` or `<h2 id="vet-visits">`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** The filter links are `<a href="?show=…#history">` with counts. "How changes work" moves to the foot of History, with the same words. The rows' Mark wrong forms reuse `wrongForm`.
- [ ] **Step 4: Run the full api-server suite. Everything passes.** **Step 5: Screenshots** into `docs/screenshots/syc-602-pr-2/`. **Commit.** Open the draft PR.

---

## PR 3: photos, Coat and markings, reports (spec §3.6–3.7, §3.1 Reports)

### Task 3.1: the photos grid with menus

**Files:** Modify `catPages.ts` (`galleryItem`, `photoStrip`). Test: `routes/team.extraPhotos.test.ts` and `catPages.summary.test.ts`.

- [ ] **Step 1: Failing tests**:
  - `it("puts Hide from the public in each photo's menu")`: there is no top-level `hide risky` button. Each figure's `rowMenu` holds `Open full size` and `Hide from the public` (`risky`, `hide_photo`) or `Show to the public again` (`restore_photo`). Each keeps today's `sr` text naming which photo.
  - `it("labels a hidden photo with who and when")`: `Hidden · Maria, 3 Oct`, plus the reason.
  - `it("opens the photo's menu and shows the notice on landing")`: `photo = "<publicId>"` with `done = "hidden"` → that figure's menu is open and the notice is visible.
  - The heading reads `Photos (4)`, and the first caption reads `Main photo`.
- [ ] **Steps 2–4: Run and see them fail, implement, run and see them pass**, plus `photoVisibility.test.ts`. **Step 5: Commit.**

### Task 3.2: the Coat and markings fold

**Files:** Modify `appearancePage.ts` (team variant only), `catPages.ts` and `routes/teamCats.ts` (`?open=coat`). Test: `appearancePage.languages.test.ts` (must stay green, unchanged), `teamCoatWords.test.ts` and `catPages.summary.test.ts`.

**Interfaces:**
- `renderAppearanceSection(v, may, done, opts?: { fold?: boolean; open?: boolean })`. Only the team cat page passes `fold: true`.
- `CatPageOptions` gains `openCoat?: boolean`, set by `?open=coat`.

- [ ] **Step 1: Failing tests**:
  - `it("folds the section with a one-line summary")`: `<details class="fold" id="appearance">`, with the summary `Grey tabby, white paws` and `Read from the photo on 3 Apr · Maria agreed on 5 Apr`.
  - `it("opens by itself when it should")`: open when `done` is any appearance key, when `checkReasons` isn't empty, when `guardianDisagrees`, or when `openCoat`. Otherwise closed.
  - `it("says what each button agrees with")`: `Yes, the coat is right`, `Yes, the markings are right`, `Change the coat or markings`. Never a bare `That's right`. Never `Update the colour` (SYC-469).
  - `it("shows no confidence tags, record numbers or model names")`: none of `likely`, `reported`, `not known` as tags, `#\d+`, or `model ` (SYC-521).
  - `it("keeps Mark wrong on each coat change that counts")`: as today, with the photo.
  - The guardian page's coat words are unchanged: `guardianPages.coat.test.ts` passes untouched.
- [ ] **Steps 2–4.** **Step 5: Commit.**

### Task 3.3: the reports box and section

**Files:** Modify `catPages.ts` (`issueStrip`). Test: `routes/team.issues*.test.ts` (whichever covers the strip) and `catPages.summary.test.ts`.

**Interfaces:** Produces `openReportsBox(strip): string`, drawn above the facts.

- [ ] **Step 1: Failing tests**:
  - With one `new` report: an amber box `1 open report: <reason> · <time>` linking to `/api/team?open=<id>#r-<id>`, above `catfacts`. The full list sits in `#issue-strip` beside Photos, unchanged in content.
  - With only closed reports: no box, and the section is still there.
  - With `issues: null`: neither the box nor the section.
- [ ] **Steps 2–4.** **Step 5: Screenshots** into `docs/screenshots/syc-602-pr-3/`. **Commit.** Open the draft PR.

---

## PR 4: Add a note and the Health note (spec §3.1–3.2, SYC-446)

### Task 4.1: the route

**Files:** Modify `lib/teamCorrections.ts` (`addTeamNote`), `routes/teamCorrections.ts`, `lib/teamCatView.ts` (`describeStatement` `team_note` case) and `catActions.ts` (button and form). Tests: `routes/team.note.test.ts` (new) and `routes/team.walk.test.ts` (add a row).

**Interfaces:**
- `addTeamNote(person: Person, input: { catId: number; text: string }): Promise<{ statementId: number }>`. It throws `notAuthorised` without `add_team_note`. It writes `kind: "team_note"`, `value: { text }`, `accountId: person.id`, and `roleAtTime` from the person, as `renameCat` does.
- Route: `POST /api/team/cats/:id/note`, using `...formRoute("add_team_note")`. It takes a `text` of 1–2000 characters, trimmed. On success it redirects 303 to `catPage(catId, "note")`. Add `DONE.note = "Saved. The note is in the history below."`
- `describeStatement("team_note", { text })` returns `Note (team only): “<text>”`.

- [ ] **Step 1: Failing tests**:
  - A team member posts a note → 303, and the history has the note.
  - Empty or 2001-character text → 400 with `formProblem`, and nothing is written.
  - A cat guardian, or someone without `add_team_note` → 403.
  - Walk row: `"POST /api/team/cats/:id/note": { why: "add_team_note, island-only" }`.
  - The `Add a note` button and form are drawn only with `add_team_note`. `catPageFormKeys` gains `note:<cat>` for re-fill after sign-in.
- [ ] **Steps 2–4.** Call `setTeamHeaders` before any `await`. **Step 5: Commit.**

### Task 4.2: the Health note fact and the leak guard

**Files:** Modify `catFacts.ts` and `catHistory.ts` (note row tag). Add a `team_note` Mark wrong if the statements route supports retracting it: check `routes/teamCorrections.ts`'s `/team/statements/:id/wrong` first. If it doesn't, add a `{ kind: "team_note" }` correction that writes `{ retracted: true }` superseding the note, gated on `add_team_note`. Tests: `catFacts.test.ts`, `routes/team.note.test.ts`, `routes/team.guardianView.test.ts` and `routes/cats.publicDetail.test.ts`.

**Interfaces:** `healthNoteOf(v: TeamCatView): TeamStatement | null` is the newest `team_note` entry with no `replacedBy` and not retracted.

- [ ] **Step 1: Failing tests**:
  - The facts include `Health note` with the text and the source `Maria, 2 Oct 2026 · team only` when a standing note exists. A newer note wins. A note marked wrong drops out, and the next older standing note shows instead.
  - The History note row shows the `team only` tag.
  - **Leak guard (Review Focus 5):** write a team note with a unique marker text. Then `GET` the guardian's cat page for a guardian of that cat's colony, `GET /api/cats/:id` (public JSON), and the guardian JSON. None contains the marker.
- [ ] **Steps 2–4.** **Step 5: Screenshots** into `docs/screenshots/syc-602-pr-4/`. **Commit.** Open the draft PR.

---

## After each PR

Run an adversarial review (Sonnet, its own worktree), fold the findings in, mark the PR ready, wait for green CI, then `/ship`: merge, move the Linear tickets, clean up the worktree. Check main's push CI on the merge commit. After PR 4, move SYC-602 to Done.
