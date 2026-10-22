# Plan: SYC-569 design review fixes (SYC-571, SYC-573, SYC-574) in one PR

**Spec:** `docs/specs/design-review-fixes-oct22.md`, approved by Samuel on 22 Oct 2026 ("approved, write the plan").
**Branch and worktree:** `claude/app-design-review-ffb35e`, in `.claude/worktrees/next-dashboard-feature-a6c287`. It's already at `origin/main` 278c0d6b, plus the spec commits.
**PR:** one draft PR. There's one commit or more per part, in the order Part 1 → Part 3 → Part 2. Each commit keeps the suites it touches green.
**Checkpoint file:** `docs/superpowers/plans/syc-569-checkpoint.md`. It's updated and committed after every task, recording what's done and what's next.

## Ground rules for every task (restated in every agent prompt)

- **Commit after each item.** Write the checkpoint file, commit, then move on. Never hold work only in memory.
- Assert `pwd` is this worktree before the first write. Don't touch the primary checkout or any other worktree. Don't push, merge or switch branch.
- Commit before running any probe that restores with `git checkout` (memory: commit before probes).
- Run vitest locally with the esbuild workaround (`ESBUILD_BINARY_PATH` from a scratchpad `npm pack`, per memory).
- No high-volume network loops.
- No outside effects:
  - no live site writes;
  - no emails;
  - local previews block every non-localhost request.
- Re-run the delegated tests yourself; never trust a "tests pass" report. Grep that the claimed tests exist (memory: re-run delegated tests).

---

## Part 1: text for a few people, shown to everyone (SYC-571)

### T1.1 The cat-page link and sheet
- **Files:** `artifacts/cat-spotter/app/cat/[id].tsx`, a new `components/ClaimAskSheet.tsx`, and `lib/i18n.ts` (en, el, fr).
- **Work:**
  - Replace the `claimNewPhone` branch (`[id].tsx:~347`) and the `claimNotMetHint` branch (`:~376`) with a `ClaimAskLink`. Its text is `claimAskLink`, its role is button, and it has a 44pt tap height. It opens `ClaimAskSheet` with mode `street` or `homed`.
  - The sheet: title, body, the email address as selectable text plus a mailto link, an OK button, and focus trapped while it's open (the SYC-483 pattern).
  - Remove the keys `claimNotMetHint` and `claimNewPhone`. Add the keys `claimAskLink`, `claimAskTitle`, `claimAskStreet`, `claimAskHomed` and `claimAskSpotNow`. `claimAskSpotNow` isn't used until T2.6.
- **Tests:**
  - Rewrite `components/__tests__/CatPageClaim.test.tsx` lines ~180, 215 and 223, plus "a cat with a home shows neither".
  - Add a sheet test for each mode.
  - Check there's no link for the owner, or for a cat in care or that has died.
  - The i18n key-parity test passes.
- **Docs:** update `docs/specs/claiming-a-cat.md` §4.1 (the table's two rows) and §6 (the "copy on the cat's page and in the help" sentence) to point at the new spec, noting the 22 Oct reversal.

### T1.2 Ear-tip wording
- **Files:** `lib/i18n.ts` and `components/SightingQuestions.tsx`.
- **Work:**
  - Order: question, then `earTipWhy` (replacing the `earTipUsuallyLeft` line), then the photo, then the caption, then the answers.
  - Remove `earTipUsuallyLeft` in all three languages.
- **Tests:** the existing `SightingQuestions` tests, updated, with the order asserted in both hosts (the review screen and `MoreToAdd`).

### T1.3 Three more lines
- **`keepSafeWarning`:** new copy. Update `docs/specs/email-capture.md` lines ~143 and ~548.
- **`deleteDoneEmail`:**
  - remove it from `components/DeleteMyDataDone.tsx:39` and from the dictionaries;
  - update the quote in `email-capture.md` §6.3.
- **`reportCheckBlocked`:**
  - new copy;
  - check that both `ReportWizard` and `ReportIssueSheet` have a visible send or retry control that "send again" refers to, and if not, adjust the wording to name what exists;
  - `ReportAdvice.test.tsx:225` still finds the domain.

### T1.4 Dashboard map note
- **Files:** `artifacts/api-server/src/lib/teamPages/strings/{en,el,fr}.ts` (`sites.mapHint`, `new.mapNote`), `catMapPage.ts` (`teamOnlyHint()` moves into strings), and the site pages that render them.
- **Work:** "This map is only for the team." stays visible, and the rest goes inside `<details><summary>Why does the map work like this?</summary>…</details>`.
- **Tests:** the team page tests assert the visible line and the `<details>` on the sites map, the new-site map and the cats map.

### T1.5 Greek and French drafts for Part 1
- **Work:** draft el (Greek capitals without accents, SYC-159) and fr (*tu*) for every key added or changed in T1.1–T1.4.
- **Record:** a list for Johnny's second pack, in `docs/superpowers/plans/syc-569-second-pack.md`, giving each key, the English, the el draft and the fr draft.

**Part 1 commit gate:**
- cat-spotter vitest for the touched suites, including i18n parity;
- api-server team page tests;
- `pnpm run typecheck`.

---

## Part 3: maps open on the cats (SYC-573)

### T3.1 `fitRegion`
- **File:** `artifacts/cat-spotter/lib/cellShape.ts`.
- **Work:** a pure function, `fitRegion(cells, { width, height, marginCells: 1, maxZoom: 16, minZoom: 12 })`, that returns `{ latitude, longitude, zoom, latitudeDelta, longitudeDelta }`. It uses both spans and the Web Mercator maths that matches `mapTiles.ts`.
- **Tests** (`lib/__tests__/cellShape.test.ts`):
  - one cell (capped at 16);
  - a spread;
  - a wide east–west spread in a short box;
  - no cells (returns null, so the caller uses the island);
  - the zoom floor at 12.

### T3.2 App map fits and labels
- **Files:** `components/AppMap.web.tsx`, `components/AppMap.tsx` and `app/(tabs)/cats.tsx`.
- **Work:**
  - **A `fitKey` prop.** Web re-derives centre and zoom when it changes, measured with `onLayout`, without remounting. Native calls `animateToRegion`.
  - **In `cats.tsx`:**
    - drop the `key={coords…}` remount;
    - compute `fitKey` from the filter chip plus the settled search value (the existing debounce, or 400ms);
    - pass areas with `count`.
  - **Area labels:**
    - "N cats" when there's more than one cat and the square is at least 40px wide on screen;
    - an accessibility label on every square ("{name}'s area" or "Area with N cats");
    - plural forms in el and fr.
  - **Web tap on a shared square:** filter the strip to those cats and show a "Show all" chip. Native keeps opening the first cat (SYC-580).
- **Tests:**
  - a new `AppMap.web` test: a refit happens on a `fitKey` change and not on new areas data;
  - a `cats.tsx` test: typing doesn't change `fitKey` before the debounce, and a location fix doesn't remount;
  - labels and a11y labels;
  - the strip filter and Show all.

### T3.3 Dashboard island map fits once
- **File:** `artifacts/api-server/src/assets/dashboard-map.js`.
- **Work:**
  - track a user move with a `movestart` that isn't programmatic (a flag set around this code's own `fitBounds`/`setView` calls), and a "Go to" press;
  - on the first positions answer, with no `focus` and no user move, call `fitBounds(catBounds.pad(0.15), { maxZoom: 16 })`;
  - never refit on later `loadCats` calls.
- **Tests:**
  - wherever the dashboard map JS is tested today (find it; if it's only page-level, add a small jsdom test with a Leaflet stub);
  - it fits once;
  - it doesn't fit with focus set, after a move, or on a filter change;
  - with no cats, it stays on the island.

### T3.4 Greek and French drafts for Part 3
Add the "N cats" plurals and the area labels to the second-pack list.

**Part 3 commit gate:** cat-spotter vitest for the touched suites, the dashboard map test, and typecheck.

---

## Part 2: "I've spotted {name}" (SYC-574)

### T2.1 Server, schema and API
- **Schema** (`lib/db/src/schema/sightingMatches.ts`): add `cat_page` to `PICKED_FROM`.
- **Migration:**
  - generate it with `pnpm --filter @workspace/db run generate --name picked_from_cat_page`, which needs `DATABASE_URL` set (a scratch one is fine);
  - check the SQL drops and re-adds `sighting_matches_picked_from_ck`;
  - add the rollback, commented: `-- UPDATE "sighting_matches" SET "picked_from" = NULL WHERE "picked_from" = 'cat_page';`, then the narrow check restored.
- **API:**
  - add `cat_page` to `lib/api-spec/openapi.yaml`'s enum;
  - run `pnpm --filter @workspace/api-spec run codegen`, which regenerates zod and the client.
- **Server** (`routes/sightings.ts`):
  - `labelChoice` (`:~502-528`) records `pickedFrom` on every row when it is `cat_page`, including `choice: 'suggested'`;
  - the rules for other values stay exactly as they are;
  - the label type is widened.
- **Tests:**
  - `migrate:check`, plus `pnpm --filter @workspace/db test` (the rollback restores the schema) against a local Postgres;
  - sightings tests: `cat_page` is recorded on suggested and hand-pick rows, the label decision is unchanged, and other `pickedFrom` values behave as before;
  - zod accepts `cat_page`.
- **Mutation probe** (silent failure: a label row is lost without an error). Make `labelChoice` drop `pickedFrom` on suggested rows again, and confirm the new test goes red. Restore it and commit.

### T2.2 The button on the cat page
- **File:** `app/cat/[id].tsx`.
- **Work:**
  - a primary "I've spotted {name}" button under the status lines, above `NeedsHelpLink`;
  - hidden when the cat is in care or has died;
  - it pushes `/spot?for={id}`.
- **Tests:** shown or hidden by life status, and the right route.

### T2.3 The hint on the Spot screen
- **File:** `app/(tabs)/spot.tsx`.
- **Work:**
  - read `for` with `useLocalSearchParams`, copy it into state, and clear it with `router.setParams({ for: undefined })`;
  - the banner, with the photo, the name and a ✕ labelled "Stop spotting {name}", built from tokens;
  - the hint's lifetime follows spec §2.2's table;
  - an online send passes `hintCatId` to `buildReviewParams`;
  - a queued send sets `hintCatId` on the `PendingSighting` after `queuedSighting` builds it.
- **Tests:**
  - every row of the lifetime table;
  - the param doesn't come back through the tab bar;
  - tests 6a and 6b and the `OfflineContext` exact-body test, all unchanged and green.

### T2.4 Plumbing
- **Files:** `lib/reviewParams.ts` and `lib/offlineQueue.ts` (the type).
- **Work:**
  - `hintCatId` goes in both the builder and the parser's kept fields, accepted only if it's a positive integer;
  - `review.tsx` reads `hintCatId` from the route, or, for a queued item, from the queue item it looks up by `localId`.
- **Tests:**
  - the round trip in `reviewParams`;
  - bad values are dropped;
  - a queued item opened through the `ReviewReadyBanner` path still shows the question.

### T2.5 The "Is this {name}?" step
- **File:** `app/review.tsx`.
- **Work:**
  - a first step before the four screens, unless `isCatPhoto` is false;
  - both photos side by side, Yes and No, accessibility labels;
  - Yes calls `resolveSighting` with `pickedFrom: 'cat_page'`. Its success goes to the success screen. A refusal shows in the step's own message slot, not `confirm()`'s picker or send slots, and Yes becomes "Carry on";
  - No (or Carry on) goes to the screen the result would have opened, and `openedOn`/`useResultNudge` record that screen;
  - the candidate list is never reordered or filtered by the hint.
- **Tests:**
  - the question shows for matches, no candidates and couldn't-check, but not for not-a-cat;
  - the order of the following list is unchanged;
  - a refusal shows on the step, and Carry on goes to the right screen.
- **Mutation probe** (a silent privacy leak). Make the question appear only when the hinted cat is among the candidates, and the leak test goes red. Reorder the candidates by the hint, and it goes red too. Restore and commit.
- **Every consumer of the "the hint never changes what the matcher shows" rule:**
  - the matches list render (`review.tsx:~984`);
  - the naming screen's subtitle;
  - `CatPicker`'s nearby list, if opened after No;
  - the success screen;
  - the analytics fields (`openedOn`).

  Each is checked in the T2.5 tests or noted as unaffected.

### T2.6 "Spot {name} now" in the claim sheet
`ClaimAskSheet`'s street mode gets the `claimAskSpotNow` button, with the same push as T2.2. It has a test.

### T2.7 Greek and French drafts for Part 2
Add the button, banner, ✕ label, question, Yes/No, Carry on and refusal lines to the second-pack list.

**Part 2 commit gate:**
- all of cat-spotter vitest;
- the api-server sightings suites;
- the db tests;
- `migrate:check`;
- typecheck.

---

## Integration and checks (session model)

### T4.1 Full local suites
Run the full local suites: cat-spotter vitest, api-server vitest (in-process, a few requests only), db tests, `migrate:check` and `pnpm run typecheck`.

### T4.2 Local preview with data
Set up the app and API locally against a scratch database seeded with cats, including three in one cell and one in care. Block every non-localhost request, and use `PRELAUNCH_GATE=off`. Check at 390px and 1280px, in light and dark:
- the cat page link and the sheet in both modes;
- the ear-tip order;
- the keep-safe line;
- the delete done screen;
- the report-blocked message;
- the Cat-alogue map opening fitted, the "3 cats" label, the strip filter and Show all;
- the full "I've spotted" flow, using a local photo with matching stubbed: banner, ✕, Yes, No, a `NOT_NEARBY` refusal, and the offline-queued path;
- the dashboard cats map fitting once, and the `<details>` note, with a planted `__Host-cs_team` cookie on `/api/healthz` (memory: dashboard preview cookie host).

Screenshots are saved to `docs/screenshots/syc-569/`.

### T4.3 Adversarial review of the branch
Run it in its own worktree, per LIF-79, against the spec. The reviewer tries to refute:
- the privacy claim;
- the hint lifetime;
- the migration and rollback;
- the map refit rules.

Fold the findings in.

### T4.4 Open the draft PR
Open it with `gh pr create --draft`. The PR body lists:
- the three parts;
- the decisions;
- the deploy order: migrate on production → `verify-history` → a `run_sql` constraint check → Samuel republishes;
- the screenshots;
- the second-pack list.

Bind the PR (ccd_pr). Mark it ready once review fixes are in, then wait for a CI run that actually succeeded.

### T4.5 Linear
Comment on SYC-571, SYC-573 and SYC-574 with the PR link. Put the second-pack list on SYC-346 as a comment, flagged "added after the 22 Oct freeze".

---

## Model delegation

The active model is Opus. Each `Agent` call states its tier. Work goes in this worktree, one agent at a time, because Parts 1 and 3 both touch `i18n.ts` and Parts 1 and 2 both touch `[id].tsx`.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| T1.1–T1.4: Part 1 copy, sheet and dashboard note | Sonnet | Clear spec, standard component and copy work | Deterministic: the touched suites, i18n parity and typecheck, re-run by me. Spot review of the diff by me. Browser check in T4.2 |
| T1.5, T3.4, T2.7: Greek and French drafts | Sonnet | Translation drafting against settled rules; Johnny reviews natively anyway | Structured list validated against the en keys (the parity test). Spot-check of Greek capitals and French *tu* by me. Johnny's native review (SYC-346 second pack) |
| T3.1: `fitRegion` | Sonnet | A pure function with a precise contract | Deterministic: unit tests including the edge cases. Spot review of the maths by me |
| T3.2–T3.3: app map refit, labels, strip filter; dashboard fit-once | Sonnet | Standard component work against explicit rules | Tests for every refit rule, re-run by me. Browser probe in T4.2. Covered by the T4.3 adversarial review |
| T2.1: migration, API enum, codegen, `labelChoice` | **Opus** | A silent-failure path (a label row lost without an error), a production migration and a rollback, and codegen across packages | `migrate:check` and the db rollback test. **Mutation probe** on `labelChoice`. Re-run by me |
| T2.2–T2.6: button, hint lifetime, plumbing, the review step | **Opus** | Several files with subtle interactions (tab params, the queue, three review entry points) and a privacy rule that must hold | Tests for every lifetime row and entry point. **Mutation probes** on the leak test. Enumeration of every consumer (T2.5). Browser probe in T4.2. Adversarial review in T4.3 |
| T4.1–T4.2: suites and browser checks | Session (Opus) | Integration and judgement across parts | n/a |
| T4.3: adversarial review of the branch | **Opus**, in its own worktree | Hostile review of a privacy rule and a migration; it needs the strongest reasoning, and its own tree so mutation probes don't contaminate this one | Its findings are verified by me before they're folded in |
| T4.4–T4.5: PR and Linear | Session | Short and judgement-light, but must be accurate | n/a |

No Haiku work: there's no bulk mechanical package here.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| The migration number collides with another branch before merge | Regenerate on rebase (migrations README) |
| The copy freeze has passed | The second pack, as SYC-346 allows |
| The app ships before the migration | Deploy order in the PR body. Claude says "don't republish yet" until the `run_sql` check passes. A missed migration only loses label rows silently; it doesn't break resolves (spec §2.5) |
| The web map's OSM tile use goes up | Refit only on a chip change or a settled search, never per keystroke |
