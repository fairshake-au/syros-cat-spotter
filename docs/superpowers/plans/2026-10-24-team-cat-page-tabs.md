# Team cat page: header card and tabs, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the layout of the team's cat page (`renderCatPage`) as one header card and CSS-only tabs, with nothing shown twice. Content and words stay as SYC-602 built them, except where the amendment says otherwise.

**Architecture:** The page stays server-rendered HTML with no script. Two new focused files hold the new pieces: `catCard.ts` (the header card) and `catTabs.ts` (the tab row and panels). `catPages.ts` assembles them and loses the old summary columns, jump links and `catcols`. `renderPage` gains a `heading` option so the `<h1>` can sit inside the card. Tabs are links to `#tab-*` panels. CSS shows one panel at a time, inside `@supports selector(:has(a))`.

**Tech stack:** TypeScript, Express, Vitest. CSS lives in `lib/teamPages/layout.ts`, and Playwright does the cross-browser check.

**Spec:** `docs/specs/team-cat-page-tabs.md` (approved 24 Oct 2026), which amends `docs/specs/team-cat-page-redesign.md`. The mockup source is `docs/specs/assets/team-cat-page-tabs/mockup.html`. The review notes are `docs/reviews/team-cat-page-tabs-adversarial-review.md`; finding numbers A1–A10 below refer to them.

**Linear:** SYC-655. One PR.

## Global constraints

- No `<script>`. Every tab, fold and filter is a link, a `<details>` or a form.
- All tab-hiding CSS sits inside `@supports selector(:has(a))`, so a browser without `:has()` shows every panel.
- Team pages are English only. No text under 12px. Tap targets are at least 44px.
- Keep every id other pages link to: `history`, `s-<id>`, `sg-<id>`, `vv-<id>`, `vet-visits`, `photos`, `p-<id>`, `map`, `appearance`, `issue-strip`, `corrections`. Add `tab-history`, `tab-photos`, `tab-map`, `tab-coat`, `tab-reports` and `a-<id>`. Every id on the page is unique.
- Capability gates are unchanged. Reports appears only through `issueStripFor` (`view_welfare_queue`). The Map tab appears only when the cat has sightings.
- Never use "statement" in visible text, and show no `#<number>` or model name.
- Every PR opens as a draft. Run the full api-server suite before `gh pr ready` (welfareKindGuard rule). Don't push and mark the PR ready back to back. Never use `gh pr merge --auto`. Merging is Samuel's call.
- Commit after each task. Keep the checkpoint note `.syc-655-progress.md`, which is never committed.

## Review Focus

1. **Landing on a link target inside a hidden panel.** Opening the page at `#s-<id>`, `#p-<id>` or `#appearance`, and clicking a tab, must show the right panel *and* scroll to the target in Chrome, Safari and Firefox. Covered by Task 5's Playwright matrix.
2. **An older browser without `:has()`.** Every panel shows. Covered by Task 3's CSS test and Task 5's check, which turns off the `@supports` block.
3. **A photo notice for a photo no longer on the page.** It shows above the card. Covered by Task 2.
4. **Coat changes that no longer count.** They still appear somewhere: under Past changes in the Coat tab. Covered by Task 4.
5. **The bare cat and the read-only viewer.** No empty tab, no stray heading, no "5 photos" label with one photo. Covered by Task 2 and Task 3.

## Model delegation

| Work | Tier | Assurance |
|---|---|---|
| Tasks 1–4 | Sonnet | Tests first; the controller re-runs the named files and greps that the claimed tests exist; an adversarial review of the whole PR (Sonnet, its own worktree). |
| Task 5 (Playwright matrix, screenshots) | Sonnet | The controller looks at every screenshot and the matrix output. |

No task needs Opus. The design is settled, and the trickiest piece (Past changes) reuses `entryExtras`.

## File structure

| File | Change |
|---|---|
| `src/lib/teamPages/layout.ts` | `PageOptions.heading?: string` (trusted HTML, drawn instead of the plain `<h1>`). CSS for the card, the tabs and `scroll-margin-top`. Remove `.photostrip`, `.jump`, `.catsummary` and `.catcols` rules no other page uses. |
| `src/lib/teamPages/catCard.ts` | **New.** `renderCatCard(v, may, opts): { heading: string; card: string }`. |
| `src/lib/teamPages/catTabs.ts` | **New.** `renderCatTabs(panels: CatPanel[]): string`, where `CatPanel = { id: "history" \| "photos" \| "map" \| "coat" \| "reports"; label: string; html: string }`. |
| `src/lib/teamPages/catPages.ts` | `renderCatPage` assembles notices, the card and the tabs. Removes `statusLine`, `photoStrip`, `summaryAndActions`, the jump nav and `catcols`. |
| `src/lib/teamPages/catFacts.ts` | Facts render as a grid (`dl.kf`); Health note and Owner get a `wide` class. |
| `src/lib/teamPages/catHistory.ts` | A one-line coat row; the "All" filter without a count; removes `inFold`. |
| `src/lib/teamPages/appearancePage.ts` | The team variant is a plain section with `a-<id>` ids and "Past changes"; removes fold and `openCoat`. |
| `src/routes/teamCats.ts` | Stops reading `?open=coat`. |
| The Queue page builder | Photo-related reports link to `/api/team/cats/<id>#tab-photos` (A7). |

---

### Task 1: a heading slot in the page shell

**Files:** Modify `src/lib/teamPages/layout.ts`. Test: `src/lib/teamPages/layout.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `it("draws the heading option instead of the plain h1")`: with `heading: '<div class="x"><h1>Mavros</h1></div>'`, the body contains it once, has exactly one `<h1`, and `<title>` is still the escaped `title`.
  - Without `heading`, the output is unchanged (a snapshot of an existing page).
- [ ] **Step 2: Run them and see them fail.** `pnpm exec vitest run src/lib/teamPages/layout.test.ts`.
- [ ] **Step 3: Implement.** `heading` replaces `` `<h1>${escapeHtml(opts.title)}</h1>` ``. `beforeTitle` and `afterTitle` keep their places.
- [ ] **Step 4: Run them and see them pass. Step 5: Commit.**

### Task 2: the header card

**Files:** Create `catCard.ts`. Modify `catFacts.ts` and `catPages.ts`. Test: `src/lib/teamPages/catCard.test.ts` (new), and update `catPages.summary.test.ts`.

**Interfaces:**
- `renderCatCard(v: TeamCatView, may, opts: { now: Date; byId; shown; island: boolean; issues?: IssueStrip | null; actions: string }): { heading: string; card: string }`.
- `heading` is `<div class="nameline"><h1>{name}</h1>{mark}</div>`. The mark is the sterilisation icon from `marks.ts`, with its word in a visually hidden span and a `title` attribute. Add an exported `markIconOnly(m)` to `marks.ts`.
- `renderCatPage` passes `heading` to `renderPage`, and puts the card at the start of `body`.

- [ ] **Step 1: Failing tests:**
  - **Card order:** inside `.catcard`, the open-reports box (when there is one), then the photo, then the name, SYR line and facts, then the description and public line, then the actions.
  - **No status line:** there's no `class="statusline"`, and the words "Last seen 5 days ago" appear once, in the facts.
  - **Photo label:** five photos (one hidden) → `<a class="photo" href="#tab-photos">` with the text `5 photos`, at least 44px (a class with `min-height`). One photo → no label. No main photo, but photos on file → the label sits on the placeholder. A hidden main photo → the image has class `ishidden`.
  - **Facts grid:** `dl.kf`. Health note and Owner have class `wide`. Last seen's place is a link to `#tab-map` when there are sightings.
  - **Notices above the card:** the death notice, the guardian mark and the hidden-main-photo note come before `.catcard`. So does the photo notice when `done=hidden` and `photo` names no photo on the page (A7).
  - **Bare cat:** the card renders with "No photo", no label, and no report box.
- [ ] **Step 2: Run and see them fail. Step 3: Implement**, reusing `renderCatFacts`, `openReportsBox` and `renderCatActions`. Remove `statusLine`, `photoStrip` and `summaryAndActions`.
- [ ] **Step 4: Run and see them pass**, plus every `catPages.*.test.ts` and `routes/team.*.test.ts`. Rewrite only the assertions that pin the old layout (A3 lists them).
- [ ] **Step 5: Commit.**

### Task 3: the tabs

**Files:** Create `catTabs.ts`. Modify `catPages.ts` and `layout.ts` (CSS). Test: `src/lib/teamPages/catTabs.test.ts` (new).

**Interfaces:** `renderCatTabs(panels: CatPanel[]): string` draws `<nav class="cattabs" aria-label="Sections of this cat's page">`, a link `href="#tab-<id>"` for each panel, then `<div class="catpanels">` and `<section class="catpanel" id="tab-<id>" aria-labelledby="h-<id>">` for each. Each panel starts with its own heading, `<h2 id="h-<id>">`.

Panels, in order, each only when it has content for this viewer:
- History: `renderHistory`;
- Photos: today's gallery block;
- Map: `sightingsMap` at band 256 (512px), with a heading "Where {name} has been seen". Its notes change from "below" to "in History";
- Coat and markings: Task 4;
- Reports: `issueStrip`, only when the strip isn't null and its total is more than 0.

- [ ] **Step 1: Failing tests:**
  - **Tab row:** labels and links in order, with counts: `History (18)`, `Photos (5)`, `Map`, `Coat and markings`, `Reports (3)`.
  - **Missing panels:** no Map tab without sightings; no Reports tab with `issues: null`.
  - **Panels and ids:** each panel has its heading, and every id in the page is unique. Parse the page with jsdom and compare the count of `[id]` with the set size, on the rich and bare fixtures.
  - **CSS:** the page's CSS contains `@supports selector(:has(a))`, and the rule `.catpanel{display:none}` only inside it. Check this from `layout.ts`'s CSS string, so an older browser hides nothing.
  - **Open-tab words:** the CSS includes `content` text ", open" for the selected tab, in the same pattern as the folds. `scroll-margin-top` covers `.catpanel`, `[id^="s-"]`, `[id^="sg-"]`, `[id^="p-"]`, `[id^="vv-"]` and `[id^="a-"]`. `.cattabs` is `position:sticky`.
  - `id="map"` stays on the map. The old `<nav class="jump"` and `catcols` are gone.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Write the CSS as the spec §3.1 and the review's A6 give it. For each tab, add one `main:has(#tab-x:target, #tab-x :target) a[href="#tab-x"]` rule, plus the default for History.
- [ ] **Step 4: Run and see them pass. Step 5: Commit.**

### Task 4: coat rows in History, the Coat tab, and "All"

**Files:** Modify `catHistory.ts`, `appearancePage.ts`, `catPages.ts` and `routes/teamCats.ts`. Test: `catHistory.test.ts`, `catPages.coat.test.ts`, `teamCoatWords.test.ts`, and `appearancePage.languages.test.ts` (must pass unchanged; the guardian page isn't touched).

- [ ] **Step 1: Failing tests:**
  - **One-line coat row:** a coat or markings change in History renders as one line, `id="s-<id>"`, text `Coat changed to <words>` or `Markings changed to <words>`, linking to `#a-<id>`. It has no ⋯ menu and no Mark wrong form. The filter counts for `changes` and `all` are unchanged.
  - **"All" filter:** the first filter's text is exactly `All`, with no number.
  - **Coat tab:** a plain `<section id="appearance">` with no `<details class="fold">`. Each listed change carries `id="a-<id>"`.
  - **Past changes:** "Past changes" lists every coat and markings change that doesn't count now: replaced, superseded, or marked wrong. Each is crossed out, with its reason, its photo, and "Replaced by …" from the History entry with the same id. Reuse `entryExtras`.
  - **Mark wrong** stays on each change that counts, as today.
  - **`?open=coat`:** the route ignores it. `openCoat` and the fold's open-by-itself rules are gone (grep proves no reference is left).
  - **History hint:** the line "Older and replaced changes are in History" is replaced by "Past changes are listed below."
- [ ] **Steps 2–4: Run and see them fail, implement, run and see them pass. Step 5: Commit.**

### Task 5: Queue link, the browser check and screenshots

**Files:** The Queue page builder (find where report rows link to the cat page). `docs/screenshots/syc-655/check.mjs` (new, like `docs/screenshots/syc-396-pr-1-5/check.mjs`) and its output.

- [ ] **Step 1: Queue link.** A failing test that a photo-related report (the photo reasons in `reasonLabel`) links to `/api/team/cats/<id>#tab-photos`. Implement it, then see it pass.
- [ ] **Step 2: Browser matrix.** Run it in Chromium, WebKit and Firefox, from a fixture render served on localhost, with every non-localhost request aborted. For each of these addresses, record which panel is visible and whether the target is in view:
  - none;
  - `#tab-photos`;
  - `#s-<id>` (a row inside a folded run too);
  - `#sg-<id>`;
  - `#p-<id>`;
  - `#appearance`;
  - `#a-<id>`;
  - `#issue-strip`;
  - `#corrections`;
  - `#nonsense`.
  Then click each tab. Then turn off the `@supports` block and check every panel shows. Save the result as `check-result.json`.
- [ ] **Step 3: Screenshots** at 390px and 1280px: the default page, each tab open, the read-only viewer, and the bare cat. Compare them with the mockup.
- [ ] **Step 4: Run the full api-server suite, then commit.** Open the draft PR, then run the adversarial review.
