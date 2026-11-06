# Dashboard Map first (SYC-812) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the map within the first screen of the dashboard's Map view, fold the filters on every width, quieten the base map, and make "Last seen" and the Filters count honest.

**Architecture:** Server-rendered pages change order and the forced-open CSS rule goes. `dashboard-map.js` refreshes `#mapresults` from the server the way `dashboard-grid.js` refreshes `#catresults`. `buildStyle` gains an opt-in `quiet` option that only the dashboard asks for.

**Tech Stack:** Express server-rendered HTML, plain browser JS, MapLibre, Vitest, Playwright for local checks.

**Spec:** `docs/superpowers/specs/2026-11-04-dashboard-map-first-design.md` (approved 6 Nov 2026; §6 follows its recommendations).

## Global Constraints

- **Starts only after #420 merges,** from fresh `origin/main`, because it needs `layout.ts`.
- Task 1's measurements go to Samuel before Tasks 2–6 go ahead.
- Keep the ids `view-grid` and `view-map`, and `.viewrow .findentrylink`. The Map's script finds them by id.
- `quiet` is off unless asked for, so the app's map and `lib/map-style`'s existing tests stay as they are.
- `lastSeen=quiet` stays valid, so old links keep working.
- No database changes. Every PR opens as a draft.

## Review Focus

Each line has its test in the task that owns the code.

1. After several filter changes on the Map, the chips, the count and "Filters (n)" all match the cats drawn (Task 2).
2. A slow answer arrives after a newer filter change: the newer one wins, on the Map as on Grid (Task 2).
3. A `lastSeen=quiet` link submitted through the form keeps its filter (Task 4).
4. With no JavaScript, the fold opens and "Show cats" still works (Task 1).
5. The Map fails to load: the filters still work by sending the form, as they do today (Task 2).

---

### Task 1: Page order and the fold (prototype first)

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/catMapPage.ts:96-135`, `catGridPage.ts:190-250,336`, `layout.ts:771-774` and the fold's styles at `:645-646`
- Test: `catMapPage` and `catGridPage` render tests, `layout.test.ts`

- [ ] **Step 1: Write the failing tests**

`the map comes before the layer choices and the help line on view=map` (compare `indexOf`); `the forced-open rule is gone` (`layout` output has no `details.filters::details-content`); `the fold has a marker`; `the Grid keeps view-grid and view-map inside #catresults`.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement the order in spec §3.1**

Help line and layer choices go below the map, with "Go to an area", the credit and the privacy note. The fold gets the ▸/▾ marker, and so does "Go to an area".

- [ ] **Step 4: Measure and report to Samuel**

With seeded local data, measure the map's top edge at 390×844 and 1280×800, with no filters on. Target: about 300px at 390px, and at least half of the phone screen is map. Send screenshots and the numbers. **Stop until Samuel has seen them.**

- [ ] **Step 5: Commit**

### Task 2: The Map's script keeps filter state true

**Files:**
- Modify: `artifacts/api-server/assets/dashboard-map.js:625-660`, `catMapPage.ts`
- Test: the map script's test file, plus a Playwright check

**Interfaces:**
- Produces: `refreshResults(qs: string)` inside `dashboard-map.js`. It fetches the page with `view=map`, swaps `#mapresults` and the `#catfilters summary` label from the answer, and doesn't touch the map.

- [ ] **Step 1: Write the failing tests**

`chips are redrawn after a filter change, not deleted`; `the Filters label follows the answer`; `an older answer is ignored`; `a failed fetch leaves the page as it was`.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**

Copy `dashboard-grid.js`'s pattern, including its `controller !== mine` guard and its `res.redirected` check. Remove the lines that delete `.fchips`. The §3.6 note lives inside `#mapresults` on the Map, so it's redrawn too.

- [ ] **Step 4: Run and commit**

### Task 3: No Sort on the Map

**Files:** Modify `catGridPage.ts:248` (`filterForm`, which already takes `map`). Test: `catGridPage` render tests.

- [ ] **Step 1: Test:** `the Map has no Sort control and keeps a chosen sort as a hidden field`; `choosing a cat for a report keeps Sort`.
- [ ] **Step 2: Watch it fail, implement, run, commit.**

### Task 4: "Last seen" that doesn't overlap

**Files:**
- Modify: `artifacts/api-server/src/lib/teamCatList.ts:142`, `catGridPage.ts:221-225` and `LAST_SEEN_WORD`
- Test: `teamCatList.test.ts:224`, `catGridPage` render tests

- [ ] **Step 1: Write the failing tests**

`month means 8 to 30 days`: a cat seen 7 days ago is out, 8 and 30 are in, 31 is out. Build the dates from fixed values, not the wall clock. `the dropdown has no quiet option by default`; `arriving with lastSeen=quiet shows it selected, with its chip`. Update the old `month` test at line 224.

- [ ] **Step 2: Watch them fail**

- [ ] **Step 3: Implement**

`if (band === "month") return days > 7 && days <= 30;`. Labels are exactly as in spec §3.5. Keep `quiet` in `LAST_SEEN`, and draw its option only when `f.lastSeen === "quiet"`.

- [ ] **Step 4: Run and commit**

### Task 5: The honest note

**Files:** Modify `catGridPage.ts:390`, `catMapPage.ts`. Test: both render tests.

- [ ] **Step 1: Test:** `the note says "Not showing cats who are no longer with us." with a Show them link`, on Grid and Map, and `it's gone when that box is ticked`. Check the old words are gone.
- [ ] **Step 2: Watch it fail, implement, run, commit.** "Filters (n)" stays as it is.

### Task 6: The quiet base map

**Files:**
- Modify: `lib/map-style/src/index.ts`, `lib/map-style/src/adjusted.ts`, `artifacts/api-server/src/routes/teamMapData.ts:113`
- Test: `lib/map-style/src/index.test.ts`, the `teamMapData` route test

**Interfaces:**
- Produces: `quiet?: boolean` on `BuildStyleOptions`.

- [ ] **Step 1: Write the failing tests**

`with no quiet option the style is unchanged` (deep equal against the current output); `quiet land is #f4f2ec and water is #cfe7f9`; `quiet keeps every label layer`; `the dashboard's style route asks for quiet`.

- [ ] **Step 2: Watch them fail**

- [ ] **Step 3: Implement** the colours in spec §3.4 as paint overrides applied after `adjustedLayers`.

- [ ] **Step 4: Measure contrast**

From the final colours: labels at least 4.5:1 on land; `#0f4a72`, `#1c77c3`, `#b8552f`, the group ring and feeding-site squares at least 3:1 on land and water. `#d7dee4` relies on its outline. Darken beach and small-place labels if they fall short.

- [ ] **Step 5: Run and commit**

The style is cached for an hour (`STYLE_CACHE`), so a reload may show the old map at first.

### Task 7: Checks, then the draft PR

- [ ] **Step 1:** Run the full API suite, `lib/map-style` tests, and the typechecks with no pipe hiding the exit code.
- [ ] **Step 2:** Browser checks from spec §8, at 390px and 1280px, light and dark, with seeded data. Abort every non-localhost request first, in every call.
- [ ] **Step 3:** Confirm the app's map is unchanged.
- [ ] **Step 4:** Open the draft PR, run the independent review and fold in findings. Merge waits for Samuel.

## Model delegation

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1, page order | Session (Opus 5.5) | Layout judgement, and Samuel sees the result | Render tests, measured at both widths |
| Task 2, the Map's script | Opus sub-agent | Escalated: async ordering, and a mistake hides filter state with no error | Tests, a Playwright run of several filter changes, plus a mutation probe that removes the stale-answer guard |
| Tasks 3–5 | Sonnet | Clear spec and exact tests | Tests re-run by the session, plus diff review |
| Task 6, quiet map | Sonnet | Exact colours given | Tests, measured contrast, a look at every map type |
| Final review | Opus, in its own worktree | Independent read of a large page change | Findings folded in before `gh pr ready` |
