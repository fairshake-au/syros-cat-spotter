# Spotted stamps (SYC-505) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every cat's photo on Home and in the Cat-alogue. Stamp the cats this phone has spotted with a see-through passport stamp. Replace "0 of N" with a "Spot your first cat" button before the first sighting. Add a "Not spotted yet" filter.

**Architecture:** The decisions that are easy to get subtly wrong (which hero to show, which heading is true, which filter is really applied, which empty message wins) go into one small pure module, `lib/spotted.ts`, tested without mounting anything. The stamp is its own component, `components/SpottedStamp.tsx`, drawn by `CatCard` when a new `spotted` prop is `true`. The two screens only wire these up and delete the padlock overlays. No server, database or API change.

**Tech Stack:** Expo / React Native (web build via react-native-web), expo-router, react-native-svg, @tanstack/react-query, vitest + @testing-library/react (jsdom), TypeScript.

**Spec:** `docs/specs/spotted-stamps.md` (approved by Samuel 21 Oct 2026, commit 1b0f5560, draft PR fairshake-au/syros-cat-spotter#255). Read it alongside this plan; section numbers below (§) refer to it.

## Before starting

- **Spec PR first.** Merge #255 (doc only) to main, then branch the build off fresh `origin/main` in the session's own worktree. If #255 hasn't merged, branch off `claude/syc-505-spec-decisions` and keep the build PR a draft until #255 merges (repo rule for stacked PRs). (Done that way: the build is #268, stacked on #255.)
- **SYC-502 sequencing.** SYC-502 (first sighting's success screen swallowed by the email screen) must merge before, or in the same release as, this build (spec edge case 9). Check `gh pr list --search SYC-502` before marking the build PR ready.
- **Migrations:** none. Session SYC-396 PR 3.3a holds `0035`; this plan takes no number.
- **Running tests locally:** from `artifacts/cat-spotter`, `ESBUILD_BINARY_PATH=<scratchpad>/package/bin/esbuild pnpm exec vitest run <files>`. Use the darwin esbuild workaround from `npm pack @esbuild/darwin-arm64@<the version in node_modules/.pnpm/esbuild@*>`. Test files must live under `components/`, `lib/`, `hooks/`, `context/` or `server/` (vitest `include`); screen tests import the screen from `../../app/(tabs)/…`, as `components/__tests__/CatPageClaim.test.tsx` does.

## Global Constraints

- Wording: "spotter", never "snapper"; "cat guardian", never "colony carer". French uses "tu" (the i18n test enforces this).
- Every new string exists in `en`, `el` and `fr` (key-parity test in `lib/__tests__/i18n.test.ts`).
- "Unknown is not zero": no stamp, no first-spot button and no "Not spotted yet" chip unless the profile has loaded **with** `spottedCatIds` as an array (`Array.isArray(profile?.spottedCatIds)`, the existing `hasCollectionData`).
- Stamp colours: terracotta `palette.terra700` (#b8552f); wash `rgba(254,252,247,0.55)` (stone000 at 55%); band 100% opaque terra700 with pure white (#ffffff) bold text, 4.8:1.
- Stamp geometry: ring 52pt across before tilt, rotated −14°, bottom-right of the photo, offset `bottom: 14, right: 14` (the 8pt inset measured to the ~63pt tilted outline). The same in light and dark mode. Cards only, not the cat page.
- Band text: 9pt, bold, normal case (no `displayUpperCase`), `maxFontSizeMultiplier={1.1}`, `numberOfLines={1}`; on native also `adjustsFontSizeToFit` with `minimumFontScale={0.75}`. On web the band grows wider than the ring instead (allowed by §3.1); web has no shrink-to-fit.
- The card's `Pressable` stays its outermost element (`PhotoViewerExcluded.test.tsx` clicks `container.firstElementChild`).
- No analytics. No API, OpenAPI or database change.

## Review Focus

1. **Profile request fails while online** (`statsError`): the hero must show the dash, not the first-spot button. Test in Task 4.
2. **Offline after the profile loaded once:** react-query keeps the cached profile, so stamps and the "Not spotted yet" chip stay. Test in Task 5 (`isOnline: false` with profile data present → chip shown).
3. **The spotted list has ids for cats no longer in the list** (a hidden or removed cat): "every cat spotted" must be judged on the cats actually shown, not on counts. Test in Task 5.
4. **Search that is only spaces** counts as "nothing typed" for the well-done message (the list filter already trims). Test in Task 2.
5. **Greek band at the largest text size on web**, and the stamp on a real black and a real pale cat: no clipping at the card's rounded edge, word readable. Browser check in Task 7 (no unit test can see this).

---

### Task 1: Strings

**Files:**
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (en block near line 304, el near 1014, fr near 1697; `homeToCollectEyebrow` near 542 / 1245 / 1929)
- Test: `artifacts/cat-spotter/lib/__tests__/i18n.test.ts` (existing, unchanged)

**Interfaces:**
- Produces these keys, in all three languages, exactly as the spec §3.1–§3.3 tables give them:
  `catSpottedStamp`, `catCardA11ySpotted` (`{name}`), `catCardA11yNotSpotted` (`{name}`), `homeFirstSpotLine` (`{n}`), `homeFirstSpotCta`, `filterNotSpotted`, `filterNotSpottedAllDone`.
- Changes: `homeNearbyEyebrow` en "Cats near you", fr "Près d'ici", el unchanged ("Κοντά σου"); `homeToCollectEyebrow` en "Cats to look out for", el "Γάτες να εντοπίσεις", fr "Chats à repérer".
- `homeSpotToUnlock` stays for now (still used); Task 5 removes it.

- [ ] **Step 1:** Add the seven keys and the two heading changes to `en`, `el`, `fr`. Use the main Greek wording for `filterNotSpotted` ("Δεν τις έχεις εντοπίσει"); the shorter option is for Johnny's review, not this build.
- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/i18n.test.ts`. Expected: PASS (parity, tu-only French, placeholders).
- [ ] **Step 3:** Commit `SYC-505: strings for stamps, first-spot button and Not spotted yet filter`.

### Task 2: The rules, as pure functions

**Files:**
- Create: `artifacts/cat-spotter/lib/spotted.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/spotted.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HomeHero = 'firstSpot' | 'progress' | 'unknown';
  export function homeHeroState(
    profile: { catsSpotted?: number; spottedCatIds?: unknown } | undefined,
  ): HomeHero;
  export function stripHeadingKey(
    hasCoords: boolean,
    cats: ReadonlyArray<{ distanceKm?: number | null }>,
  ): 'homeNearbyEyebrow' | 'homeToCollectEyebrow';
  export type CatalogueFilter = 'all' | 'nearby' | 'homed' | 'notSpotted';
  export function effectiveFilter(filter: CatalogueFilter, hasCollectionData: boolean): CatalogueFilter;
  export function catalogueEmptyKey(args: {
    filter: CatalogueFilter; // the effective filter
    hasCoords: boolean;
    catCount: number; // all cats, before filter and search
    search: string;
  }): 'filterNeedsLocation' | 'noCats' | 'filterNotSpottedAllDone' | 'noCatsSearch';
  ```
- Consumes: `NEARBY_KM` from `@workspace/geo`.

- [ ] **Step 1: Write the failing tests** in `spotted.test.ts`:
  - `homeHeroState`: `undefined` → `'unknown'`; `{ catsSpotted: 0 }` (no list) → `'unknown'`; `{ catsSpotted: 0, spottedCatIds: [] }` → `'firstSpot'`; `{ catsSpotted: 2, spottedCatIds: [1, 2] }` → `'progress'`; `{ spottedCatIds: [] }` (count missing) → `'progress'`.
  - `stripHeadingKey`: `(false, [{ distanceKm: 0.1 }])` → `'homeToCollectEyebrow'`; `(true, [{ distanceKm: NEARBY_KM }])` → `'homeNearbyEyebrow'`; `(true, [{ distanceKm: NEARBY_KM + 0.01 }, { distanceKm: null }])` → `'homeToCollectEyebrow'`; `(true, [])` → `'homeToCollectEyebrow'`.
  - `effectiveFilter`: `('notSpotted', false)` → `'all'`; `('notSpotted', true)` → `'notSpotted'`; `('homed', false)` → `'homed'`.
  - `catalogueEmptyKey`, in precedence order: `{filter:'nearby', hasCoords:false, catCount:5, search:''}` → `'filterNeedsLocation'`; `{filter:'notSpotted', hasCoords:true, catCount:0, search:''}` → `'noCats'`; `{filter:'notSpotted', hasCoords:true, catCount:5, search:''}` → `'filterNotSpottedAllDone'`; the same with `search:'   '` → `'filterNotSpottedAllDone'` (Review Focus 4); the same with `search:'zzz'` → `'noCatsSearch'`; `{filter:'all', hasCoords:true, catCount:5, search:'zzz'}` → `'noCatsSearch'`.
- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/spotted.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/spotted.ts` with the four functions above. `homeHeroState` returns `'unknown'` unless `Array.isArray(profile?.spottedCatIds)`. `stripHeadingKey` is "has coords and **some** cat with a non-null `distanceKm <= NEARBY_KM`". `catalogueEmptyKey` checks `search.trim() === ''`. Give each a one-line comment pointing to the spec section, matching the repo's comment style.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Mutation probe** (silent-failure guard: "unknown is not zero"). Temporarily delete the `Array.isArray` check in `homeHeroState` and confirm the `{ catsSpotted: 0 }` → `'unknown'` test goes red. Temporarily drop `.trim()` and confirm the spaces test goes red. Restore both and re-run green. Commit before probing ([[commit-before-probes]]): commit after Step 4, probe, then restore with `git checkout -- lib/spotted.ts`.
- [ ] **Step 6:** Commit `SYC-505: pure rules for hero, heading, filter and empty message`.

### Task 3: The stamp and the card

**Files:**
- Create: `artifacts/cat-spotter/components/SpottedStamp.tsx`
- Modify: `artifacts/cat-spotter/components/CatCard.tsx`
- Test: `artifacts/cat-spotter/components/__tests__/CatCard.test.tsx` (new; mocks as in `PhotoViewerExcluded.test.tsx`, but with `t` returning the key with `{name}` left in, so labels can be asserted)

**Interfaces:**
- Produces: `export function SpottedStamp(): JSX.Element` (no props; reads `t('catSpottedStamp')`; root has `testID="spotted-stamp"`).
- Produces: `CatCard({ cat, spotted }: { cat: Cat; spotted?: boolean })`.
- Consumes: Task 1 keys.

- [ ] **Step 1: Write the failing tests** (`CatCard.test.tsx`, jsdom):
  - `spotted` true → `getByTestId('spotted-stamp')` exists, and it or its ancestor carries `aria-hidden="true"` (react-native-web's mapping of `importantForAccessibility="no-hide-descendants"` / `accessibilityElementsHidden`).
  - `spotted` false and `spotted` missing → `queryByTestId('spotted-stamp')` is null.
  - The card's outermost element has `role="button"`. Its `aria-label` starts with `catCardA11ySpotted` filled with "Agatha" when true, `catCardA11yNotSpotted` when false, and is just "Agatha" plus the rest when missing (see Step 3 for "the rest").
  - Clicking `container.firstElementChild` still pushes `/cat/[id]` with id `'42'`.
- [ ] **Step 2:** Run `pnpm exec vitest run components/__tests__/CatCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `SpottedStamp`: an absolutely positioned 52×52 View (`bottom: 14, right: 14, transform: [{ rotate: '-14deg' }]`, `pointerEvents="none"`, `importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`). It holds a 2pt terra700 outer ring, a 1pt inner ring inset 3pt, and the 55% wash fill. Centred in it: a react-native-svg paw (`accessible={false}`, 18×18, fill terra700, viewBox `0 0 24 24`, ellipse `cx 12 cy 16 rx 5 ry 4.2`, circles `(5.8,10.5,r2.1) (9.5,6.4,r2.2) (14.5,6.4,r2.2) (18.2,10.5,r2.1)`). Under the paw, the band: terra700 background, 2pt radius, 3pt horizontal padding, white 9pt bold text, the text props in Global Constraints. Let the band's width follow its text and overflow the ring (no `overflow: hidden` on the stamp).
  - `CatCard`: render `{spotted === true && <SpottedStamp />}` inside the photo `View`, after the house badge. On the `Pressable`, add `accessibilityRole="button"` and `accessibilityLabel` = the a11y sentence and the card's visible facts, joined with `'. '`. The sentence is `catCardA11ySpotted`/`catCardA11yNotSpotted` with `{name}` when `spotted` is a boolean, otherwise `cat.name`. The facts are the distance text exactly as displayed (when present) and the "Discovered by …" line as displayed. Factor the existing distance and discoverer expressions into local consts so the visible text and the label can't drift.
- [ ] **Step 4:** Run `CatCard.test.tsx` and `PhotoViewerExcluded.test.tsx`. Expected: PASS both.
- [ ] **Step 5:** Commit `SYC-505: passport stamp on spotted cat cards, with a screen-reader label`.

### Task 4: Home

**Files:**
- Modify: `artifacts/cat-spotter/app/(tabs)/index.tsx` (hero `progressBlock` ~lines 155–175; strip heading ~228; overlay ~247–262; sort comment ~94; `lockOverlay`/`lockIcon`/`lockText` styles)
- Test: `artifacts/cat-spotter/components/__tests__/HomeScreen.spotted.test.tsx` (new)

**Interfaces:**
- Consumes: `homeHeroState`, `stripHeadingKey` (Task 2); `CatCard` `spotted` prop (Task 3); keys from Task 1; `Button` from `@/components/purropolis` (`variant="accent" size="lg" block wrapLabel`; built first as `primary`, changed to `accent` after the browser check showed blue on the blue hero was nearly invisible).

- [ ] **Step 1: Write the failing tests.** Mount `../../app/(tabs)/index`. Mock `useDevice`, `useOffline`, `useLocation`, `useCatsWithCache`, `useGetProfile`/`getGetProfileQueryKey`, `expo-router` (`useRouter → { push }`), `react-native-safe-area-context`, `@/lib/bannerArea`, and stub `OfflineBanner`, `NotificationBell` and `CatCard`. The `CatCard` stub renders `data-testid="card-{id}"` and `data-spotted={String(spotted)}`, following `CatPageClaim.test.tsx`. `t` returns the key. Cases:
  - Profile `{ catsSpotted: 0, spottedCatIds: [], totalCats: 18 }`: text `homeFirstSpotLine` and button `homeFirstSpotCta` present; `homeOfNCats` absent. Clicking the button calls `push('/spot')`.
  - Profile `{ catsSpotted: 2, spottedCatIds: [1, 2], totalCats: 19 }`: `homeOfNCats` present, no `homeFirstSpotCta`; card 1 has `data-spotted="true"`, card 3 has `"false"`.
  - Profile `undefined`: neither `homeFirstSpotCta` nor a progress fill; every card has `data-spotted="undefined"`.
  - Profile `undefined` with `isError: true` and online (Review Focus 1): no `homeFirstSpotCta`.
  - Profile `{ catsSpotted: 0, totalCats: 18 }` with no `spottedCatIds` (an out-of-date server, spec edge case 2): no `homeFirstSpotCta`.
  - No text `homeSpotToUnlock` and no 🔒 in any case above.
  - Heading: coords set and a cat at `distanceKm: 0.2` → `homeNearbyEyebrow`; coords set and every cat at `distanceKm: 40` → `homeToCollectEyebrow`; no coords → `homeToCollectEyebrow`. (`displayUpperCase` uppercases the key; assert on the uppercased key, or mock `@/lib/displayUpperCase` as identity.)
- [ ] **Step 2:** Run the new test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `const hero = homeHeroState(profile)`. When `'firstSpot'`, render in place of `progressBlock`: a `Text` with `homeFirstSpotLine` (`{n}` → `totalCats`, white, `fontSizes.md`) and the `Button` labelled `homeFirstSpotCta`, calling `router.push('/spot')`. Otherwise keep `progressBlock` exactly as now. `'unknown'` already renders the dash.
  - Heading: `displayUpperCase(t(stripHeadingKey(!!coords, cats)))`. Pass the cats shown in the strip (`nearby`), not the whole list (corrected by the final review: with the near cats already spotted, the strip shows far-away cats). Update the comment above it.
  - Strip: `<CatCard cat={cat} spotted={hasCollectionData ? spottedIds.has(cat.id) : undefined} />`; delete the lock overlay block and its three styles. Rewrite the sort comment (~line 94) to say unspotted cats lead the strip because they're the ones to look out for.
- [ ] **Step 4:** Run the Home test and `PhotoViewerExcluded.test.tsx`. Expected: PASS.
- [ ] **Step 5: Mutation probe** (commit Step 4's work first). Temporarily replace the `homeHeroState(profile)` call with `profile?.catsSpotted === 0 ? 'firstSpot' : 'progress'` and confirm the "no `spottedCatIds`" case goes red. This proves the screen really goes through the guarded function. Restore with `git checkout`.
- [ ] **Step 6:** Commit `SYC-505: Home shows photos, stamps and a first-spot button`.

### Task 5: Cat-alogue

**Files:**
- Modify: `artifacts/cat-spotter/app/(tabs)/cats.tsx` (`FilterKey` line 49 → use `CatalogueFilter`; filter memo 83–99; `filters` 112–116; map branch 207–253; empty branch 256–266; overlay 278–289; lock styles)
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (remove `homeSpotToUnlock` from en/el/fr)
- Test: `artifacts/cat-spotter/components/__tests__/CataloguePage.spotted.test.tsx` (new)

**Interfaces:**
- Consumes: `CatalogueFilter`, `effectiveFilter`, `catalogueEmptyKey` (Task 2); `CatCard` `spotted` (Task 3); Task 1 keys.

- [ ] **Step 1: Write the failing tests.** Mount `../../app/(tabs)/cats` with the same mock set as Task 4, plus stubs for `AppMap` (renders `data-testid="map"` and `data-count={markers.length}` or `areas.length`), `NeedsHelpLink` and `OfflineBanner`. Use the real `Chip` if it renders under jsdom, otherwise a stub with a click handler. Cats 1–4; cases:
  - Profile with `spottedCatIds: [1, 2]`: chips in order `filterAll, filterNearMe, filterHasHome, filterNotSpotted`; cards 1, 2 `data-spotted="true"`. Clicking `filterNotSpotted` shows only cards 3 and 4.
  - Profile with `spottedCatIds: []`: chip shown; "Not spotted yet" shows all four cards.
  - Profile `undefined`: no `filterNotSpotted` chip; cards `data-spotted="undefined"`.
  - Select "Not spotted yet", then re-render with profile `undefined`: all four cards show (falls back to All). Re-render with the profile back: only 3 and 4 show again (derived, not reset).
  - `spottedCatIds: [1, 2, 3, 4, 99]` (99 isn't in the list, Review Focus 3) with "Not spotted yet": text `filterNotSpottedAllDone`.
  - Same, then type "zzz" in search: text `noCatsSearch`, not `filterNotSpottedAllDone`.
  - Same all-spotted profile, map view toggled on, "Not spotted yet": the map renders and `filterNotSpottedAllDone` is shown over it.
  - Offline (`isOnline: false`) with profile data present (Review Focus 2): chip shown, stamps shown.
  - No `homeSpotToUnlock` text and no 🔒 anywhere.
- [ ] **Step 2:** Run the new test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `const [filter, setFilter] = useState<CatalogueFilter>('all')`. `const applied = effectiveFilter(filter, hasCollectionData)`. Use `applied` in the filter memo (add `if (applied === 'notSpotted') return !spottedIds.has(c.id);`, adding `spottedIds` to the deps) and for `active` on chips. The chip row appends `{ key: 'notSpotted', label: t('filterNotSpotted') }` only when `hasCollectionData`.
  - `const emptyKey = catalogueEmptyKey({ filter: applied, hasCoords: !!coords, catCount: cats.length, search })`. The list's empty branch shows `t(emptyKey)` (same icon and styles). In the map branch, when `filtered.length === 0 && emptyKey === 'filterNotSpottedAllDone'`, render the 🐾 and message in an absolutely positioned, `pointerEvents="none"` box at the top of the map container, on `colors.card` with the existing `empty` text style.
  - List items: `<CatCard cat={item} spotted={hasCollectionData ? spottedIds.has(item.id) : undefined} />`; delete the overlay and lock styles. Update the comment at lines 74–76 ("locks must depend…") to say stamps and the chip.
  - Remove `homeSpotToUnlock` from all three dictionaries once `grep -rn homeSpotToUnlock artifacts/cat-spotter/app artifacts/cat-spotter/components` is empty.
- [ ] **Step 4:** Run the Catalogue test, the Home test, `CatCard.test.tsx`, `i18n.test.ts` and `PhotoViewerExcluded.test.tsx`. Expected: all PASS. Then `pnpm run typecheck` in `artifacts/cat-spotter`. Expected: no errors.
- [ ] **Step 5: Mutation probe** (commit Step 4's work first). Temporarily pass `filter` instead of `applied` into the filter memo, and confirm the "profile goes away" case goes red. Then temporarily drop `search` from the `catalogueEmptyKey` call (pass `''`), and confirm the "zzz" case goes red. Restore with `git checkout`.
- [ ] **Step 6:** Commit `SYC-505: Cat-alogue stamps and a Not spotted yet filter`.

### Task 6: Comments and the product spec

**Files:**
- Modify: `docs/SPEC.md` §5.1 and §5.2 (exact replacements in spec §9)
- Modify: `artifacts/api-server/src/lib/catHelpers.ts` ~line 655 (comment only: "drives the cards' 'Spotted' stamp and the 'Not spotted yet' filter on Home and the Cat-alog")

- [ ] **Step 1:** Make the two `SPEC.md` replacements word for word from spec §9, and the one comment edit.
- [ ] **Step 2:** Run `git diff --stat`. Expected: only these two files; `catHelpers.ts` diff is comment lines only.
- [ ] **Step 3:** Commit `SYC-505: product spec and server comment no longer describe padlocks`.

### Task 7: See it, then open the PR

- [ ] **Step 1:** Run the full app test suite: `pnpm exec vitest run` in `artifacts/cat-spotter`. Expected: all green. Read any failure's own message before blaming the local esbuild clash ([[local-vitest-esbuild]]).
- [ ] **Step 2: Browser check** (Samuel's rule; Review Focus 5). Run the API and the web app locally as in [[local-preview-with-planted-link]] (scratch DB, made-up cats with real-looking pale and black cat photos). Plant a spotter with 0 resolved sightings, then add one. Check, at 390px and 1280px, in English and Greek: Home as a brand-new spotter; Home after one sighting; the Cat-alogue list with and without "Not spotted yet"; the all-done message in list and map; the stamp on the pale and the black cat; Greek at browser zoom 200% (band not clipped by the card edge). Tap "Spot your first cat" through to Spot. Screenshot each and keep them for the PR.
- [ ] **Step 3:** Remove the scratch DB and stop the local servers by PID.
- [ ] **Step 4:** Open a **draft** PR (`gh pr create --draft`), body linking the spec and SYC-505, screenshots attached, ending with the Claude Code line. Run the adversarial review (see Model delegation) on the draft, fold in findings, re-run Step 1, then `gh pr ready` once (it runs CI). A skipped check is not a pass.

---

## Model delegation

Session model: Opus. Every subagent prompt carries the standard crash-proofing paragraph verbatim and runs in its own worktree (one worktree per agent).

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1: strings | Sonnet | Exact strings copied from the spec tables; Greek/French need care, not judgement | `i18n.test.ts` (parity, tu-only French); session spot-review of the diff against spec tables; Johnny reviews Greek/French later (SYC-346) |
| Task 2: pure rules | Sonnet | Small, fully specified by signatures and test cases | Tests as written here + **mutation probes** in Step 5 (silent-failure guard: unknown is not zero) |
| Task 3: stamp + card | Sonnet | Clear spec; visual detail fully pinned in Global Constraints | `CatCard.test.tsx` + `PhotoViewerExcluded.test.tsx`; visual judged in Task 7 by the session |
| Tasks 4–5: Home and Cat-alogue | Sonnet | Wiring and deletion against named functions; the subtle logic already lives in Task 2 | Screen tests + **mutation probes** (Task 4 Step 5, Task 5 Step 5); typecheck; session re-runs the named test files itself before merge ([[rerun-delegated-tests]]) |
| Task 6: docs + comment | Haiku | Mechanical, word-for-word replacements | Diff spot-review by the session: two files, comments only in `catHelpers.ts` |
| Task 7 Step 2: browser check | Session (Opus) | Judging the stamp's look against the mockups Samuel chose needs the context of this conversation | Screenshots at 390px and 1280px in English and Greek, attached to the PR |
| Whole-branch adversarial review | Opus | Escalated from Sonnet: it has to check the "unknown is not zero" rule end to end across the card, two screens and the lib, and Sonnet built every task | Critic subagent in its own worktree; findings folded in before `gh pr ready` |

**Where else must "unknown is not zero" hold?** All consumers of `hasCollectionData` / `spottedCatIds`, each covered by a test above:
1. Home hero (`homeHeroState`): Tasks 2 and 4.
2. Home strip cards' `spotted` prop: Task 4.
3. Home strip sort (existing, already guarded): unchanged.
4. Cat-alogue cards' `spotted` prop: Task 5.
5. Cat-alogue "Not spotted yet" chip visibility: Task 5.
6. The applied filter (`effectiveFilter`): Tasks 2 and 5.
7. The all-done message: Task 5 (only reachable when the chip is applied).
8. Card screen-reader label (boolean vs missing): Task 3.

No other reader of `spottedCatIds` exists in the app. Checked 21 Oct 2026 with `grep -rln spottedCatIds` over `app`, `components`, `lib`, `hooks` and `context`: only `app/(tabs)/index.tsx`, `app/(tabs)/cats.tsx` and a test fixture in `lib/usernameClaim.test.ts`. Re-run the grep in Task 5 Step 4 and add any new hit to this list.
