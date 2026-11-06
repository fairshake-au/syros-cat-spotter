# Area names on cats (SYC-810, app half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each public cat's named area on Catalogue and Home cards and on the cat page, make the Catalogue's search find areas, and add a "No home" filter.

**Architecture:** `serialiseCat` gains `areaKey` and `areaName`, always worked out from the published cell centre. The app renders them through one small helper, `lib/areaNames.ts`, which also holds the Greek names. One draft PR, in the order below.

**Tech Stack:** Express and TypeScript API, Expo/React Native app, Vitest, Orval-generated clients.

**Spec:** `docs/superpowers/specs/2026-11-04-area-names-on-cats-design.md` (approved 6 Nov 2026).

## Global Constraints

- The area comes from the published cell centre, **never from the exact position and never from the owner's home pin** (spec §3).
- Everyone sees the same area name for a cat, the owner included.
- Wording stays a plain place name. Never "Lives in Kini", "Home in Kini" or "Around Kini".
- No database changes. If one turns up, stop and ask Samuel.
- This session owns `artifacts/cat-spotter/lib/i18n.ts`. New strings go in en, el and fr.
- Every PR opens as a draft. **A security review is required before merge.**
- Test cat names use letters only, never random hex or `Date.now()`.

## Review Focus

Each line has its test in the task that owns the code.

1. A cat whose exact spot and cell centre fall in different areas gets the cell centre's area, for the public and for its owner (Task 1).
2. A homed cat whose home pin is in another area gets the cell centre's area (Task 1).
3. A phone holding cached cats with no `areaName` or `hasHome` field keeps "Discovered by" and leaves those cats out of No home (Tasks 3, 4).
4. A long Greek or French area name stays on one line on the card, and the spoken label keeps it whole (Task 3).
5. An area the team adds later has no Greek name on the list, so the app falls back to the server's name (Task 2).

---

### Task 1: The API sends the area

**Files:**
- Modify: `artifacts/api-server/src/lib/areas/namedAreas.ts:3` (import `haversineKm` from `@workspace/geo`, which removes the circular import)
- Modify: `artifacts/api-server/src/lib/catHelpers.ts` (`CatWithStats`, `serialiseCat`)
- Modify: `lib/api-spec/openapi.yaml`, then regenerate with `pnpm --filter @workspace/api-spec run codegen`
- Test: `artifacts/api-server/src/lib/catHelpers.area.test.ts` (new), plus one route test each for `GET /cats`, `GET /cats/:id` and the resolve response

**Interfaces:**
- Produces: `areaKey?: string | null` and `areaName?: string | null` on the public cat. Both optional in `openapi.yaml`.

- [ ] **Step 1: Write the failing tests**

Names and assertions:
- `the public and the owner get the same area for one cat`: same `CatSource`, public viewer and owner viewer, `expect(owner.areaName).toBe(pub.areaName)`.
- `a cat near a border gets its cell centre's area`: pick an exact position where `areaFor(exact).key !== areaFor(blurPosition(exact)).key`, and assert `areaKey` equals the second.
- `a homed cat gets the cell centre's area, whatever its pin says`: `homeLat`/`homeLng` set inside another area, `hasHome: true`, and `areaKey` equals the cell centre's. Run for both viewers.
- `a cell more than 2km from every centre has no area`: `areaKey` and `areaName` are null.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run src/lib/catHelpers.area.test.ts` from `artifacts/api-server`.
Expected: FAIL, `areaName` undefined.

- [ ] **Step 3: Implement**

In `serialiseCat`, compute `const cell = blurPosition(cat.lat, cat.lng)` once. Pass only `cell.lat` and `cell.lng` to `areaFor`, and map `OFF_SYROS` to null for both fields. Reuse `cell` for the public position.

- [ ] **Step 4: Prove the rule can fail**

Mutation probe: temporarily pass `cat.lat, cat.lng` to `areaFor`, and confirm the border test goes red. Then pass `cat.homeLat, cat.homeLng`, and confirm the pin test goes red. Restore.

- [ ] **Step 5: Run and commit**

Run the new file and `src/routes/cats*.test.ts`. Expected: PASS. Commit.

### Task 2: The app's area helper and strings

**Files:**
- Create: `artifacts/cat-spotter/lib/areaNames.ts`, `artifacts/cat-spotter/lib/areaNames.test.ts`
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (`catAreaSomewhere`: "Somewhere on Syros", `filterNoHome`: "No home", `filterNoHomeEmpty`: "No cats without a home here.")

**Interfaces:**
- Produces:
  - `areaLabel(cat: { areaKey?: string | null; areaName?: string | null }, lang: 'en' | 'el' | 'fr'): string | null`: the shown name, Greek from the list, else `areaName`.
  - `cardPlace(cat, lang, t): { kind: 'area' | 'island' | 'none'; text: string | null }`. `none` when the `areaName` field is missing or the cat is off the island.
  - `areaSearchText(cat, lang): string`: shown name and server name joined.

- [ ] **Step 1: Write the failing tests**

`kini in Greek shows the Greek name`; `a key not on the list falls back to the server's name`; `no area on the island is 'island'`; `no area off the island is 'none'`; `a cat with no areaName field is 'none'`; `the Greek list covers all 21 seed keys`.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**

The Greek list is keyed by the 21 keys in `seedAreas.ts`. "On the island" uses the same numbers as `SYROS_BOX` in `areas/areaWrites.ts`, held as a constant here. Mark the Greek list as a draft in a comment.

- [ ] **Step 4: Run and commit**

### Task 3: Cards and the cat page

**Files:**
- Modify: `artifacts/cat-spotter/components/CatCard.tsx`, `artifacts/cat-spotter/components/catPage/AboutTab.tsx:103-118`
- Test: their existing test files

**Interfaces:**
- Consumes: `cardPlace`, `areaLabel` from Task 2.

- [ ] **Step 1: Write the failing tests**

CatCard: each row of the spec §4.2 table, plus a homed cat showing both badge and area; the spoken label contains the area and not "Discovered by" when there's an area; `numberOfLines={1}` on the row.
AboutTab: area bold with description as the quiet line; description only as today; neither shows no row.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**

Card: the "Discovered by" row becomes the place row when `kind !== 'none'`, with a `map-pin` icon hidden from screen readers. Cat page: the `where` row's `bold` is the area and its quiet line is the description.

- [ ] **Step 4: Run and commit**

### Task 4: Search and the No home filter

**Files:**
- Modify: `artifacts/cat-spotter/lib/spotted.ts:29,40-52`, `artifacts/cat-spotter/app/(tabs)/cats.tsx:94-111,143-148`
- Test: `artifacts/cat-spotter/lib/spotted.test.ts`, the Catalogue's test file

**Interfaces:**
- Consumes: `areaSearchText` from Task 2.
- Produces: `'noHome'` in `CatalogueFilter`; `'filterNoHomeEmpty'` in `catalogueEmptyKey`'s return type.

- [ ] **Step 1: Write the failing tests**

`noHome with nothing left and no search says filterNoHomeEmpty`; `noHome with a search keeps noCatsSearch`; `a cached cat with no hasHome field is left out` (`c.hasHome === false`); `"Kini" and "Κίνι" both find a Kini cat`; `"Kini" plus No home leaves out homed cats`.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement**, placing the chip after "Has a home".

- [ ] **Step 4: Run and commit**

### Task 5: The Areas page warning

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/areasPage.ts` (not `layout.ts`)
- Test: its existing test file

- [ ] **Step 1: Add a test** that the page says: "These names show in the public app. Use places only, never people or feeding sites."

- [ ] **Step 2: Add the line above the add form. Run and commit.**

### Task 6: Checks, then the draft PR

- [ ] **Step 1:** Run the full API and app test suites and both typechecks, with no pipe hiding the exit code. A SYC-804 failure counts only after reading its diff.
- [ ] **Step 2:** Browser checks from spec §9, at 390px and desktop, in en, el and fr, with seeded local data. Abort every non-localhost request first.
- [ ] **Step 3:** Open the draft PR. List the two checks before live: the 21 live names and the Greek list.
- [ ] **Step 4:** Run the independent review and the security review. Fold in findings. Merge waits for Samuel.
- [ ] **Step 5:** File the post-launch line to Jacky or Susan in Linear.

## Model delegation

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1, the API | Sonnet | Clear spec and a small change | Tests, plus the mutation probe in Step 4, plus session diff review. This guards a silent leak, so tests alone aren't enough |
| Tasks 2–5, the app and Areas line | Sonnet | Standard components with exact tests | Tests re-run by the session, plus diff review |
| Greek name list | Session (Opus 5.5) | Needs care with Greek place names | Flagged as a draft. A Greek speaker checks it before live |
| Browser checks | Session | Needs judgement on layout | Screenshots at both widths and three languages |
| Security review | Opus, in its own worktree | Escalated: a missed leak can't be taken back once public | Every consumer listed: `GET /cats`, `GET /cats/:id` (`publicCat.ts`), claim, `PATCH`, the resolve response |
