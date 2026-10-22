# SYC-603: Dashboard Home redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the team dashboard's Home page as three parts, in this order: Today, Where to trap next, How we're doing. "Not seen lately" is removed.

**Architecture:**
- Home stays server-drawn and needs no scripts.
- `lib/dashboard/home.ts` gathers the figures. Each part is its own `Section` that can fail without taking down the rest.
- A new pure module, `lib/dashboard/trapNext.ts`, ranks colonies from the per-colony figures `colonyFigures` already works out.
- `lib/teamPages/homePage.ts` draws the page. The two-column desktop layout is plain CSS in `layout.ts`.

**Tech Stack:** TypeScript, Express, Drizzle and Postgres, Vitest with supertest. The code lives in `artifacts/api-server`.

**Spec:** `docs/specs/team-dashboard-redesign.md` §4 (approved by Samuel on 22 Oct 2026), D12, and the review record in §17.1. Mockup, option D: https://claude.ai/artifact/AcJLPG2dAW72caG4C8VHmn

## Global Constraints

- Home is island-wide only. The route keeps `requireTeam("view_welfare_queue")`, and a cat guardian gets a 403, as now.
- **No per-person figures (D6).** Home shows no response times and no "open for", and names no team member.
- Every value goes through `escapeHtml`. That includes colony names, places, report notes and euro amounts.
- Sterilisation marks are always a shape and a word (§12.2). The bars come from `markBar` only.
- **Tap targets** are at least 44px tall (§12.5).
- **Layout widths:**
  - Two columns from **1000px**.
  - Tiles four to a row from **560px**; two to a row below that.
- The standard price is read from Vet settings through `standardPriceNow()`. The literal `€60` never appears in Home's source.
- The percentage uses `wholePct` from `colonyFigures.ts`. It is never floored.
- Wording:
  - "cat guardian", never "colony carer"; "spotter" only.
  - Plain English; team pages are in English only.
- PRs open as drafts (`gh pr create --draft`). Run the affected tests locally, then mark the PR ready once with `gh pr ready`.
- **Local tests** use the `local-vitest-esbuild` memory workaround, plus:
  - `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9`
  - `AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`
  - a local Postgres `DATABASE_URL`

## Review Focus

1. **A report that is both urgent and a litter report** gets one line carrying both words, "Urgent" and "Kittens", and counts once in every count. Test: Task 1 `needs: an urgent litter report is one line, counted once`; Task 2 `a report both urgent and kittens shows both words`.
2. **More than 5 urgent or kitten reports.** "See all N" counts all of them, and "More reports" counts only the rest. Test: Task 1 `needs: seven lines of kind cap at five; linesTotal 7; otherOpen excludes them`.
3. **The Queue read fails while every check list is empty.** The page must say "This figure isn't available right now" and never "Nothing waiting right now". Test: Task 2 `a failed Queue read never says nothing is waiting`.
4. **A colony with nothing to do, or with no street cats** never ranks. Ties go to the colony with kittens first, then by name. A name containing `<` is escaped. Tests: Task 1 `rankTrapNext …` cases; Task 2 escaping case.
5. **Vet settings changes the price**, for example to €55. The cost and the key line follow it. Test: Task 2 `the price comes from Vet settings, not a fixed 60`.
6. **One sterilised cat among 300** shows "1%", never "0%" (`wholePct`). Test: Task 2 `one sterilised in 300 reads 1%`.

---

## File map

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/dashboard/trapNext.ts` | **Create.** Pure ranking for "Where to trap next". |
| `artifacts/api-server/src/lib/dashboard/trapNext.test.ts` | **Create.** Unit tests for the ranking. |
| `artifacts/api-server/src/lib/dashboard/colonyFigures.ts` | Add an optional `cats` to `opts`, so Home's loaded cats are reused. |
| `artifacts/api-server/src/lib/dashboard/home.ts` | New `HomeNeeds` and `HomeToCheck`; drop Not seen lately; add `trapNext`. |
| `artifacts/api-server/src/lib/dashboard/home.test.ts` | Update to the new data shape. |
| `artifacts/api-server/src/lib/teamPages/homePage.ts` | Rewrite into Today, Where to trap next and How we're doing. |
| `artifacts/api-server/src/lib/teamPages/colonyPages.ts` | Export `flagChip` so Home can draw the Kittens reported flag. |
| `artifacts/api-server/src/lib/teamPages/layout.ts` | Home CSS: add `.hgrid`, `.htiles`, `.htile`, `.trow`; drop `.hstrip`. |
| `artifacts/api-server/src/routes/team.home.test.ts` | Rewrite the render tests to the new page. |
| `artifacts/api-server/src/routes/teamHome.ts` | No change. It already passes `visibleColonyIds(person)` and `costs`. |

---

### Task 1: Home's figures — needs, check counts, and the colony ranking

**Files:**
- Create: `artifacts/api-server/src/lib/dashboard/trapNext.ts`, `artifacts/api-server/src/lib/dashboard/trapNext.test.ts`
- Modify: `artifacts/api-server/src/lib/dashboard/colonyFigures.ts` (`colonyFigures` signature, around line 241)
- Modify: `artifacts/api-server/src/lib/dashboard/home.ts`
- Test: `artifacts/api-server/src/lib/dashboard/home.test.ts`

**Interfaces:**
- Consumes these existing functions:
  - `colonyFigures(visible, opts, now)` and `ColonyFigures` from `colonyFigures.ts`
  - `toDo(cats)` from `countedCats.ts`
  - `allColonyChoices(visible)` from `colonyCats.ts`
  - `standardPriceNow(): Promise<number>` from `vetSettings.ts`
  - `QueueReport` (`severity`, `isLitter`, `at`) from `welfareQueue.ts`
- Produces the following.

`trapNext.ts`:
```ts
export const TRAP_NEXT_LIMIT = 3;
export interface TrapColony {
  colonyId: number; name: string;
  toDo: number;        // street − split.sterilised
  street: number; sterilised: number; split: Split;
  kittens: boolean;    // figures.flags includes "kittens"
}
export function rankTrapNext(
  figures: ReadonlyMap<number, ColonyFigures>,
  names: ReadonlyMap<number, string>,
  limit?: number,      // default TRAP_NEXT_LIMIT
): TrapColony[];
```
- A colony with no name in `names` is skipped, because it isn't visible.
- `toDo` 0 is never listed.
- Sort order: `toDo` descending, then `kittens` first, then `name.localeCompare`, then `colonyId`.

`colonyFigures.ts`: `opts` gains `cats?: readonly TeamCat[]`. When `cats` is given, it is used instead of calling `loadTeamCats(now, { asOf })`. Passing both `cats` and `asOf` throws `Error("colonyFigures: cats and asOf are exclusive")`.

`home.ts`, the new shapes:
```ts
export const HOME_LINES_LIMIT = 5;           // replaces HOME_NEEDS_LIMIT
export interface HomeNeeds {
  lines: QueueReport[];   // open, checked, urgent OR isLitter; urgent first, then newest; ≤ HOME_LINES_LIMIT
  linesTotal: number;     // all such reports
  otherOpen: number;      // queue.open.length − linesTotal
  unchecked: number; issuesOpen: number; awaitingMatch: number;   // as now
}
export interface HomeToCheck { earClips: number; colour: number }   // counts only; photo strips go
export interface TrapNext {
  colonies: TrapColony[];  // rankTrapNext output
  colonyCount: number;     // every colony on the island (for the empty states)
  noColony: number;        // toDo(cats with colonyId === null).length
  priceEur: number;        // standardPriceNow()
}
export interface HomeData {
  needs: Section<HomeNeeds>; toCheck: Section<HomeToCheck>;
  trapNext: Section<TrapNext>;
  headline: Section<Headline>;
  month: Section<{ now: MonthFigures; last: MonthFigures }>;
  at: Date;
}
```
- `HomeDeps` gains `colonyFigures` and `standardPriceNow`.
- `homeData(now, deps, visible)` keeps its signature.
- The `trapNext` section:
  - awaits `catsOnce`;
  - calls `d.colonyFigures(visible, { island: true, cats }, now)`, `d.allColonyChoices(visible)` and `d.standardPriceNow()` together;
  - throws when `visible` is undefined, so it fails closed and the page says the figure isn't available.
- Removed: `NotSeenLately`, `HOME_NOT_SEEN`, `HOME_PHOTOS` and the Not-seen-lately read. `notSeenLately` stays in `countedCats.ts` for the Cats filter.

- [ ] **Step 1: Write the failing tests.** In `trapNext.test.ts`, build figures by hand with a helper `fig(id, split, flags = [])`:
  - `rankTrapNext ranks by most to do`: three colonies with to-do 2, 9 and 5 come out in the order 9, 5, 2.
  - `rankTrapNext breaks ties: kittens first, then name`: to-do 4 for "Vari", 4 for "Kini" and 4 for "Azolimnos" with kittens come out as Azolimnos, Kini, Vari.
  - `rankTrapNext never lists a colony with nothing to do`: `split` of 6 sterilised and 0 others gives `[]`. `street` 0 gives `[]`.
  - `rankTrapNext counts probably as to do`: `{sterilised:1, probably:2, not_known:1, not_sterilised:3}` gives `toDo` 6.
  - `rankTrapNext stops at three and skips colonies it can't name`.

  In `home.test.ts`, add with fake deps (the existing `pure()` and `fakeQueue()` helpers):
  - `needs: lines are urgent and kitten reports, urgent first then newest`: open reports are urgent at 09:00, attention+litter at 11:00, attention at 12:00, and urgent at 10:00. Expect line ids in the order urgent-10, urgent-09, litter-11. `linesTotal` 3, `otherOpen` 1.
  - `needs: an urgent litter report is one line, counted once`: `linesTotal` 1, `otherOpen` 0.
  - `needs: seven lines of kind cap at five; linesTotal 7; otherOpen excludes them`.
  - `toCheck is counts only`: `{ earClips: likely.length, colour: <check group count> }`.
  - `trapNext reuses Home's loaded cats`: `loadTeamCats` is called exactly once across the whole of `homeData`. Assert with a counting fake, and pass a fake `colonyFigures` that records `opts.cats`.
  - `trapNext without visible fails closed`: `homeData(NOW, pure({...}))` with no `visible` gives `trapNext.ok === false`.
  - `trapNext noColony counts street cats with no colony that aren't sterilised`.
  - Delete the Not-seen-lately and photo-strip assertions in `home.test.ts`.

- [ ] **Step 2: Run them and see them fail.**
  Run: `cd artifacts/api-server && npx vitest run src/lib/dashboard/trapNext.test.ts src/lib/dashboard/home.test.ts`
  Expected: FAIL, with "Cannot find module './trapNext'" and type or property errors on `lines`, `trapNext` and `toCheck`.

- [ ] **Step 3: Implement.**
  - Write `rankTrapNext` in `trapNext.ts`.
  - Add the `cats` option to `colonyFigures`.
  - Reshape `home.ts` to the interfaces above.
  - Sort `lines` with `(urgent ? 0 : 1)` first, then `at` descending, then `id`. Don't rely on the Queue's order.
  - Set `colonyCount` to `allColonyChoices(visible).length`.

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npx vitest run src/lib/dashboard/trapNext.test.ts src/lib/dashboard/home.test.ts src/lib/dashboard/colonyFigures.test.ts`
  Expected: PASS. `colonyFigures.test.ts` must stay green, because its callers don't pass `cats`.

- [ ] **Step 5: Mutation probe on the double load.** Make the `trapNext` section call `d.loadTeamCats(now)` again. Confirm `trapNext reuses Home's loaded cats` goes red, then restore it.

- [ ] **Step 6: Commit.**
```bash
git add artifacts/api-server/src/lib/dashboard
git commit -m "SYC-603: Home's figures: urgent and kitten report lines, check counts, Where to trap next ranking"
```

---

### Task 2: Draw the new Home

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/homePage.ts` (full rewrite of the section functions; keep `UNAVAILABLE`, `AREAS_LINE`, `VET_SETTINGS_LINE`, `asOf`)
- Modify: `artifacts/api-server/src/lib/teamPages/colonyPages.ts`: `export function flagChip` (no behaviour change)
- Modify: `artifacts/api-server/src/lib/teamPages/layout.ts`: the Home CSS block, around lines 376–392
- Test: `artifacts/api-server/src/routes/team.home.test.ts`

**Interfaces:**
- Consumes `HomeData`, `HomeNeeds`, `HomeToCheck`, `TrapNext` and `TrapColony` from Task 1.
- Also consumes:
  - `markBar(split, { label })` from `marks.ts`
  - `wholePct` from `colonyFigures.ts`
  - `euroText` from `euros.ts`
  - `flagChip(wordsIn("en"), "kittens")` from `colonyPages.ts`
- Produces `renderHomePage(d: HomeData, o: { personName: string; now: Date; costs?: boolean }): string`, with the same signature as now, and these exports:
  - `NOTHING_WAITING = "Nothing waiting right now."`, which replaces `NOTHING_NEEDS_YOU`
  - `UNAVAILABLE`
  - `AREAS_LINE`
  - `VET_SETTINGS_LINE`

**Page structure.** DOM order is reading order, so the CSS grid needs no `order` or areas:
```html
<div class="hgrid">
  <section id="today">…</section>
  <div class="hside"><section id="trap">…</section><section id="progress">…</section></div>
</div>
AREAS_LINE VET_SETTINGS_LINE
```

**Exact words.** `n` is a number; the first form is singular, the second plural.

| Where | Words |
|---|---|
| Headings | `Today` · `Where to trap next` · `How we're doing` |
| Report line | as now (`reportLine`), plus `<span class="tag kittens">Kittens</span>` when `isLitter`; both tags when both |
| Beyond 5 lines | `See all {linesTotal} urgent and kitten reports in the Queue` → `/api/team` |
| Spam check | `<p class="notice">` holding `{n} report(s) arrived while our spam check was down` → `/api/team#unchecked` |
| Tile: other reports | `{n} more report` / `more reports` when there are lines above it; `{n} open report` / `open reports` when there are none → `/api/team` |
| Tile: issues | `{n} problem with a photo or name` / `problems with photos or names` → `/api/team#issues` |
| Tile: sightings | `{n} sighting to match` / `sightings to match` → `/api/team/cats` |
| Tile: ear clips | `{n} ear clip to check` / `ear clips to check` → `/api/team/likely` |
| Tile: colour | `{n} cat for the colour check` / `cats for the colour check` → `/api/team/colour-check` |
| Nothing | `NOTHING_WAITING` |
| Trap row | `<a href="/api/team/colonies/{id}"><strong>{name}</strong></a>` · `{toDo} to do · up to {euroText(toDo*priceEur)}` · `markBar(split, { label: "Street cats" })` · `{street} street cat(s) · {sterilised} sterilised` · `flagChip` when `kittens` |
| Trap key | `To do: street cats not sterilised, not known, or probably sterilised. At the standard price of {euroText(priceEur)} a cat.` |
| No colony | `Plus 1 street cat to do that isn't in a colony.` / `Plus {n} street cats to do that aren't in a colony.` |
| Trap link | `See all colonies` → `/api/team/colonies` |
| No colonies | `No colonies yet. Grouping cats into colonies lets you plan trapping rounds.` plus the link `Create a colony` → `/api/team/colonies#create` |
| All done | `Every colony's street cats are sterilised.` |
| Progress big | `<p class="hbig"><strong>{street}</strong> street cat(s) · {wholePct(split.sterilised, street)}% confirmed sterilised</p>` |
| No street cats | `No street cats recorded yet` (the progress section shows only this line) |
| Month line | `{n} sterilisation(s) this month ({last} last month)`, plus with `costs` ` · {euroText(spend)} vet spend, paid by Syros Cats or by donations` |
| Small print | `As of {asOf}`; the homes and care line as now |
| Progress link | `See Sterilisation progress` → `/api/team/insights/progress` |

**Rules when a read fails:**
- `needs` not ok: `UNAVAILABLE` takes the place of the lines, the spam-check notice and the first three tiles.
- `toCheck` not ok: `UNAVAILABLE` takes the place of the last two tiles.
- `NOTHING_WAITING` shows only when both reads are ok and every count is 0.
- `trapNext` not ok: the section shows its heading and `UNAVAILABLE`.
- `headline` not ok: the progress section shows its heading and `UNAVAILABLE`.
- `month` not ok: only the month line becomes `UNAVAILABLE`.

**CSS:**
- `.hgrid{display:grid;gap:0 32px}`, with `@media (min-width:1000px){.hgrid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}}`.
- `ul.htiles` is a grid of `repeat(2,minmax(0,1fr))`, changing to `repeat(4,minmax(0,1fr))` from 560px.
- `a.htile` is a white card with a border, `min-height:44px` and a large tabular number.
- `.trow` is a white card.
- Delete `.hstrip`.
- Don't touch `.catgrid`, which the Cats grid uses.

- [ ] **Step 1: Write the failing tests.** In `team.home.test.ts`, update `full()` to the new `HomeData` and add these. Remove the tests that cover Not seen lately, the photo strips and the "This month" figures list.
  - `draws Today, Where to trap next, How we're doing in that order`: check `indexOf('id="today"') < indexOf('id="trap"') < indexOf('id="progress"')`, and that the page has no `id="notseen"` and no "Not seen lately".
  - `urgent and kitten lines link to the Queue with ?open=`.
  - `a report both urgent and kittens shows both words`.
  - `tiles show only when above zero, with the number and words in one link`: for example the page contains `>4</span> <span>ear clips to check` inside one `<a class="htile"`, and a zero issues count gives no "problems with" text.
  - `a failed Queue read never says nothing is waiting`: `needs: {ok:false}` with toCheck counts 0 gives a page that contains `UNAVAILABLE` and not `NOTHING_WAITING`.
  - `with nothing waiting, Today says so and the other parts still draw`.
  - `trap rows: name links to the colony, to do, up to €, bar, kittens flag`: assert `9 to do · up to €540`, `href="/api/team/colonies/12"` and `Kittens reported`.
  - `the price comes from Vet settings, not a fixed 60`: `priceEur: 55` gives `up to €495` and `€55 a cat`. Also read the source: `readFileSync(homePage.ts)` doesn't match `/€\s?60/`.
  - `no colonies, and all done, each say so`.
  - `one sterilised in 300 reads 1%`.
  - `vet spend shows only with costs`.
  - `a colony name is escaped`: the name `<b>x</b>` must never reach the page raw.
  - Keep the D6 test, the guardian 403, the Areas and Vet settings links, and the route test, updating its order assertion to `today`, `trap` and `progress`.

- [ ] **Step 2: Run them and see them fail.**
  Run: `npx vitest run src/routes/team.home.test.ts`
  Expected: FAIL, because `id="today"` isn't found and `NOTHING_WAITING` isn't exported.

- [ ] **Step 3: Implement.** Rewrite `homePage.ts` to the table above. Export `flagChip`, and add the CSS. Delete the now-unused imports: `lastSeenWords`, `notSeenWords`, `teamPhotoUrl` and `TeamCat`.

- [ ] **Step 4: Run the tests and see them pass.**
  Run: `npx vitest run src/routes/team.home.test.ts src/lib/dashboard src/lib/teamPages`
  Expected: PASS.

- [ ] **Step 5: Mutation probe.** In the render, change the `NOTHING_WAITING` condition to ignore `needs.ok`. Confirm `a failed Queue read never says nothing is waiting` goes red, then restore it.

- [ ] **Step 6: Run the whole api-server suite** (the welfare-kind allow-list and copy guards live elsewhere).
  Run: `npx vitest run`
  Expected: every failure is checked against its own error, and none is new.

- [ ] **Step 7: Commit.**
```bash
git add artifacts/api-server/src
git commit -m "SYC-603: Home draws Today, Where to trap next and How we're doing; Not seen lately leaves"
```

---

### Task 3: See it, then open the PR

**Files:** `docs/screenshots/syc-603/` (new screenshots only)

- [ ] **Step 1: Run a local preview** with data, following the memories `dashboard-preview-cookie-host` and `local-preview-with-planted-link`:
  - a scratch database seeded with at least one urgent report, one kitten report, three colonies with cats to do (one of them with kittens), and one sterilisation this month;
  - `PRELAUNCH_GATE=off`;
  - Playwright aborting every request that isn't to localhost.
- [ ] **Step 2: Screenshot `/api/team/home` at 390px and at 1280px.**
  - Check the two columns at 1280 and the single column at 390.
  - Check there is no sideways scroll at 390 and that the tiles sit two to a row.
  - Save the screenshots as `docs/screenshots/syc-603/390-home.png` and `docs/screenshots/syc-603/1280-home.png`.
- [ ] **Step 3: Commit the screenshots.** Push the branch, then open a draft PR `SYC-603: dashboard Home redesign`. Link the spec PR #292, the mockup and the screenshots.

---

## Model delegation

The session model is Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1: data and ranking | Sonnet | Interfaces, sort rules and tests are all pinned above. It's standard TypeScript. | The named unit tests; the Step 5 mutation probe (a silent double load); the session model re-runs the named test files itself (memory `rerun-delegated-tests`); spot review of the diff |
| Task 2: rendering and CSS | Sonnet | The exact copy table, the failure rules and the tests are pinned. | The named render tests; the Step 5 mutation probe (a silent "Nothing waiting" on failure); a full suite run re-run by the session model; screenshots in Task 3 |
| Task 3: preview and screenshots | Session model (Opus) | Needs judgment on the live look at two widths, and the preview setup relies on several session memories. | Probe verification: the screenshots themselves, attached to the PR |
| Per-task reviews (subagent-driven) | Sonnet | Checks the diff against this plan and the spec | The reviewer's findings are re-checked by the session model before acting on them |
| Final whole-branch adversarial review (`/ship`) | Opus | One step above the implementers. The risk is a safety regression on Home: a missed urgent or kitten report, or a failure that looks like a quiet day. | Independent critic in its own worktree; findings folded in before `gh pr ready` |

No Haiku work: nothing here is bulk or mechanical enough.
