# Adversarial review: SYC-415 plan (docs/superpowers/plans/syc-415-photo-tips-and-extra-photos.md)

Reviewed against the worktree (base f1dc1fb9) and, where noted, origin/main (1eda7d2c). Read-only, except that I ran `git fetch` once to see origin/main (it updates remote refs only; nothing in the tree changed).

VERDICT: Do not approve as written. No database blocker (the driver supports transactions, the migration approach is sound, the append-only trigger does not get in the way). But the plan has 3 Blockers and a long list of Majors where its instructions do not match the real code, and the app-side tests it gives cannot run in this repo.

## Things I checked that are fine
- Driver: lib/db/src/index.ts uses drizzle-orm/node-postgres with a pg.Pool, so `db.transaction` works (already used at routes/sightings.ts:727). Not a blocker.
- Migration: 0027 is the latest (0028 is free on origin/main too); 0027 already contains a data INSERT ... ON CONFLICT DO NOTHING, so migrate:check accepts data statements. FK ON DELETE CASCADE from sighting_photos does not fire the sightings_append_only trigger (it fires on sightings, not on the child; RI cascade runs against sighting_photos). deleteTestSightings (test/sightings.ts) disables the trigger and deletes sightings; the cascade removes sighting_photos rows fine. smallint, primaryKey, uniqueIndex, check are all valid in drizzle pg-core.
- Matcher prompt: nothing snapshots it. No matching.test.ts exists (plan says "create if absent", fine). Existing route tests mock matchCatPhoto as `{isCatPhoto, matches}` so they keep working if the new fields are treated as optional.
- sighting_matches is team-only (no public reader), so adding columns is safe. Neither orval zod nor the server validates response bodies (only health.ts parses a response), so extra response fields cannot trip response validation. Request side: generated CreateSightingBody would strip an unknown `extraPhotos` until the spec is updated, which Task 2.2 does first.
- Cross-checked line refs: sightings.ts POST ~437, computeMatchCandidates 241, dedupe ~523-560, recordMatch 351, teamCatView 660-860, spot.tsx clearPhoto 278/pickPhoto 351/submit ~546, OfflineContext keep list 257, enqueue ~589, remove/replacePhoto ~611/641 all exist and do roughly what the plan says.

## Findings

### 1. [Blocker] App component tests use a library the app does not have, and need setup the plan does not give
Plan: Tasks 1.2, 1.3, 3.4, 4.6 (PhotoTips.test.tsx, PhotoTipsCard.test.tsx, ExtraPhotoBoxes.test.tsx, sighting thumbnails test).
Evidence: artifacts/cat-spotter/package.json has only @testing-library/react and @testing-library/dom (no @testing-library/react-native). vitest.config.ts aliases react-native to react-native-web with environment 'node'; every component test starts with `// @vitest-environment jsdom` and uses `@testing-library/react` (see components/__tests__/NewSpotIntro.test.tsx:1-18: `fireEvent.click`, `container.querySelector('[data-testid=...]')`). The plan's tests import `@testing-library/react-native` and call `fireEvent.press` and `getByLabelText` as RN. They will fail at import. Also: (a) `useLanguage()` throws without a provider (context/LanguageContext.tsx:59); existing tests `vi.mock('@/context/LanguageContext', ...)` (BannerStack.test.tsx:41). Plan's `render(<PhotoTips />)` has no provider or mock. (b) react-native-svg is imported only by FairShakeMark.tsx and has never been rendered in a vitest test; its native internals need a `vi.mock('react-native-svg', ...)` or the cartoon tests will not load. (c) `@expo/vector-icons`, `expo-image` and `@/hooks/useColors` are mocked in every sibling test; the plan does not say so.
Fix: rewrite all component test snippets in the repo's style (jsdom pragma, @testing-library/react, `fireEvent.click` on `data-testid` elements, vi.mock for LanguageContext, react-native-svg, vector-icons, expo-image, useColors). Add one line each saying so. Give testIDs in the component specs. Add an explicit step "mock react-native-svg" to Task 1.2.

### 2. [Blocker] The 413 path does not exist on the server, so the "too-large spot is fixable" guarantee (spec §6.4) is not delivered
Plan: Task 2.2 ("413 description"), Task 4.4 (photoRejection maps 413 to spotTooLarge, test 6).
Evidence: app.ts:79 `express.json({limit:"25mb"})`; jsonErrorHandler (app.ts:~99-128) handles only ZodError (400) and otherwise returns 500 "Something went wrong". body-parser's oversize error (status 413) therefore comes back as a 500 JSON body. No code in api-server mentions 413 (grep). So the app never sees 413: classifySyncFailure treats 500 as a retryable server error, three failures and the spot is 'error'/'server' with no way to remove a photo. Also lib/__tests__/photoRejection.test.ts:20 currently asserts `photoRejectionKey(413) === null` and lib/__tests__/offlineQueue.test.ts:48 asserts 413 is permanent; the plan changes the first without saying so.
Fix: add to Task 2.5 (or 2.2) a change to jsonErrorHandler: `if (err.type === "entity.too.large" || err.status === 413) { res.status(413).json({ error: "This spot is too large to send.", ... }) }` with a test (post a >25 MB body, expect 413 JSON, not 500). Update photoRejection.test.ts line 20 in Task 4.4 and name that test change in the plan.

### 3. [Blocker] Task 4.3 describes a `parseQueue` per-item cleaner that does not exist
Plan: Task 4.3 Step 3 and tests ("an item with extraPhotos role 'tail'... has extraPhotos dropped").
Evidence: lib/queueStore.ts:159-174 `parseQueue` only checks `Array.isArray` and `hasLocalId` per item and returns the items untouched (`return { ok: true, items: value }`). There is no `v`, no `item`, no photoUri validation to extend. The plan's snippet cannot be placed. Without a cleaner a malformed `extraPhotos` (not an array, bad role) reaches syncOne and crashes `.map`, which would stall the whole queue sync.
Fix: say plainly "add a new normaliser applied inside parseQueue's map (or in syncOne via a `readExtras(item)` helper) and test it", or move validation into a pure helper `extrasOf(item): ExtraRef[]` in offlineQueue.ts used by syncOne, keep-list, remove and review.tsx, and test that helper. Never trust the stored shape.

### 4. [Major] Team cat page is server-rendered HTML, not an app screen; Task 3.3 omits the real file and mislabels extras
Plan: Task 3.3 (file list: teamCatView.ts only; Step 3b "find the component ... in artifacts/cat-spotter (team screens)").
Evidence: the team UI is HTML built in artifacts/api-server/src/lib/teamPages/catPages.ts (galleryItem at ~462 prints `Photo i of N` and a Hide button; `sightings` list at ~707). Nothing in cat-spotter renders a team sighting list (grep for TeamCatView in the app: none). Also teamCatView.ts:788 classifies a gallery photo as `mainIds.has(id) ? "main" : sightingIds.has(id) ? "sighting" : "statement"` where `sightingIds` is built from `sightings.map(s => s.photoId)` only (line 780). Extras added to galleryIds will be labelled "statement" unless sightingIds is widened and a role added; `TeamPhoto.source` (line 346) has no role at all. So "marked with their role" cannot happen from the plan's steps.
Fix: add catPages.ts (and its tests catPages.history/words) to Task 3.3: add `role?: "first"|"face"|"body"` to TeamPhoto, include extras in `sightingIds`, show "Face photo"/"Whole body photo" in galleryItem's alt text and caption, show the "may show more than one cat" chip in the server-rendered sightings list (not an Expo screen), and drop the app-side chip + `mayBeMoreThanOneCat` i18n string.

### 5. [Major] Spot screen wiring misses the live-camera path, the old retake test, and the rejected-card UI
Plan: Task 4.6 Step 4.
Evidence:
- spot.tsx has two first-photo setters. pickPhoto (line 379) and captureLivePhoto (lines 427-430), the default shutter, which sets `photoFingerprintRef.current = undefined` and `setPhotoTime({kind:'unread'})`. The plan only wires pickPhoto: with the live shutter there is no fingerprint (so duplicate/already-logged checks against extras silently never fire for camera-first spots), no `takenAtMs` for the two-hour rule (plan introduces `takenAtMs` state but only derives it from `timeInfo` in pickPhoto), and `recheckAfterRetake` never runs after a retake taken with the live camera.
- Existing source test lib/__tests__/spotRetake.test.ts asserts `onRetake={clearPhoto}`, that the `clearPhoto` block clears exactly photo/time/pin, and that the back arrow uses `onPress={clearPhoto}`. Plan splits it into clearPhoto/retakeFirstPhoto and swaps `onRetake` without updating this test (it will fail).
- The queued "rejected" card (spot.tsx ~796-860) shows `t('replacePhoto')` and calls replaceRejectedPhoto, which replaces the FIRST photo. With rejectedRole 'face' that button replaces the wrong photo. The plan adds removeExtraPhoto/replaceExtraPhoto in OfflineContext but never wires a UI to them or says which photo failed on the card.
- `submitFlow.ts:29/80` returns `{kind:'rejected', rejectionKey}` only; plan Step 4 says "on outcome.kind === 'rejected', if rejectedPhotoRole(err) is face or body..." but `err` is not available in spot.tsx. submitFlow.ts needs to carry `role`; it is not in the file map.
Fix: add submitFlow.ts, the rejected-card block, captureLivePhoto, and spotRetake.test.ts to the Task 4.6 file list with concrete steps; define a single `setFirstPhoto(photo, takenAtMs, fingerprint)` used by both setters so the recheck cannot be forgotten, and add a source test that both setters call it.

### 6. [Major] Replacement-key collision will overwrite the first photo when an extra is replaced
Plan: Task 4.4 (`replaceExtraPhoto` uses `replacementPhotoKey(localId, currentRef)`; extras saved as `${localId}-${role}`).
Evidence: lib/pendingPhotos.ts:337-349. replacementPhotoKey computes the next `-r<n>` only from a ref that starts with `${localId}-r`; a ref like `<localId>-face` does not, so n=0 and it returns `<localId>-r1`. Replacing the first photo of the same item also returns `<localId>-r1`. Replace first then replace the face (or the reverse) writes the same key, so one photo silently overwrites the other and both queue slots point at one file. A silent-failure guard with no probe.
Fix: use a per-role replacement key, e.g. `${localId}-${role}-r<n>`, and write a test: replace first, then replace face, then assert two different refs and two different stored contents. Add a mutation probe.

### 7. [Major] Already-logged / reuse and the 2-hour rule have inconsistent inputs
Plan: Tasks 4.1, 4.5, 4.6.
- Fingerprint source: Task 4.6 says the extra is passed through prepareExtraPhoto (2048px re-encode, q0.8) but never says whether the fingerprint stored for it (`extraFingerprints`) is of the picked original or of the prepared bytes. Library pickers return different bytes than the prepared output, so the later "pick that photo as a first photo" check (spec §4.3) only works if it is the ORIGINAL's fingerprint (what pickPhoto computes at pick time). State it, and test it.
- Server duplicate guard `spotPhotoList` compares raw base64 strings, but the first photo is raw/optimised while extras are re-encoded, so the server guard for "extra identical to first" can never fire in practice. Either drop the claim or compare decoded sha256 of the validated buffers inside saveSpotWithPhotos.
- `entryForOutcome` is called with `fingerprint` that is undefined for camera photos today; plan changes spot.tsx to set it always, but the `recentPhotos` doc comment (`Absent for a camera photo`) and tests encode the opposite; update them.
Fix: add these decisions to Tasks 4.1/4.5 with tests.

### 8. [Major] Public payload change breaks two byte-exact snapshots and two guard tests; "update where they list fields" is not a plan
Plan: Task 3.2 Step 4.
Evidence: routes/__snapshots__/cats.publicDetail.p3-2.txt and publicPayload.p6.txt are `toMatchFileSnapshot` byte comparisons of the cat page JSON (publicDetail test line 140-157 also asserts `JSON.stringify(JSON.parse(res.text)) === res.text`). Emitting `extraPhotos: []` on every sighting changes them. publicPayload.p6 is a deliberate public-field guard, so a new public field should be an explicit, reviewed change.
Fix: either omit the key when there are no extras (snapshots stay byte-identical, old caches unaffected) or list the two snapshot files in the file map and require regenerating them with a diff reviewed in the PR. Prefer omit-when-empty.

### 9. [Major] Wrong paths/symbols in PR 3 that will send the implementer to the wrong place
- "Bump the catalogue cache key in artifacts/api-server/src/lib/catalogue.ts:17": that file does not exist. The key is the app's `CATS_CACHE_KEY` in artifacts/cat-spotter/lib/catalogue.ts:17, and it caches the cat LIST, not `GET /cats/:id` detail, so bumping it does not make phones refetch sightings. Drop it (or explain what stale cache holds extraPhotos). It also puts an app change in a "server-only" PR 3.
- "OpenAPI `PublicSighting`": the schema is named `Sighting` (lib/api-spec/openapi.yaml:1039); `PublicSighting` is only the TS interface in catHelpers.ts.
- "through the real hide route (routes/photoVisibility.ts)": that file is lib/photoVisibility.ts; the hide/restore route is routes/teamPhotos.ts (capability via photoTargets), and the team photo viewer is GET /team/photos/:publicId in routes/teamReports.ts:121 which also calls photoTargets. "a report about the extra (routes/reports.ts)" is wrong: reports.ts does not look cats up by photo (only teamReports/teamPhotos use photoTargets). Add a test that a guardian of colony B gets refused on GET /team/photos/<extra of colony A cat> and a guardian of A is served it.
- "Both links cascade ... duplicate cat ids would double the targets": catTargets already dedupes with `new Set` (capabilityTargets.ts:~38); harmless but the stated reason is wrong.

### 10. [Major] Plan is checked against a stale base; origin/main has moved under PR 3's files
Plan header says "Checked against origin/main at ebfcd25f". origin/main is now 1eda7d2c (five merges later). It changed capabilityTargets.ts (+94: `canonicalCats`, merged-cat handling around catsOfPhoto, now ~line 132), routes/cats.ts (-64: public cat helpers moved to lib/publicCat.ts; the sightings select is now ~line 189), lib/api-spec/openapi.yaml (+99) and added routes/issues.ts (the one-report photo hide, #203), teamPages/catPages.ts changes. Line numbers in PR 3 are off by 60-80 lines and `catsOfPhoto`'s new shape (canonical cat) must be respected. Implementers branch from fresh origin/main, so the numbers will not match.
Fix: re-check PR 3 and PR 2.2 against current origin/main, cite symbols not line numbers, and look at the new issues.ts "one-report photo hide" for whether it needs to know extra photos.

### 11. [Major] Missing consumers / silent-failure guards
- Dedupe hit with no `sighting_photos` rows. A sighting created by the OLD server instance during the deploy window (after migration, before the new code serves), or by any test/seed that inserts straight into `sightings` (38 test files do), has no rows. Plan's dedupe branch then takes the `photos.length === 0` path and records `matcherFailed: true`, treating a perfectly good spot as photo-less. Fix: if there are no rows, fall back to `sightings.photo_id` (the plan's own "no photo" branch should key on the photos table row being gone, not on sighting_photos rows being absent) and add a test that inserts a sighting without sighting_photos and repeats the POST.
- mixedCats from a mocked matcher is `undefined` (all existing mocks return `{isCatPhoto, matches}`); Step 5 passes `mixedCats` straight to recordMatch. Use `result.mixedCats === true` in computeMatchCandidates or the stored value is an accident.
- Resolve writes observations with `photoId: sighting.photoId` (sightings.ts:1066) and the new cat's `primaryPhotoId: sighting.photoId` (738): with a face cover, colour/markings answers become evidence tied to the FACE photo, and the coat reader (SYC-161) will read a close-up. Spec accepts the main-photo bet, but not that coat answers and the body photo are never linked. Plan should state it as intentional and file the follow-up (spec §11 item 1) before merge.
- teamCatView's `sightingIds` (see #4) and routes/appSettings.ts:61 (`first sighting arrival` joins photos on s.photo_id; fine, still the cover) are the only other photo_id readers I found; likelyReview, colourCheck, colonyCats, teamColonies read observation/cat photo ids only, outbox reads report photos. No other consumer breaks.
- Mutation probes are missing for: the 413/500 mapping, the hide-extra guard on the team photo GET, the dedupe fallback, the queue normaliser, and the replacement-key collision (#6).

### 12. [Major] Matcher/queue edge: client optimisation and inline extras are not handled
- syncOne's weak-network optimiser (OfflineContext.tsx ~378-390) shrinks only the first photo; the 18 MB budget was calculated before that, fine. But `moveInlinePhotoToStore` (OfflineContext.tsx ~200-250) moves only the first photo out of the list; extras saved inline (store unavailable) stay in the localStorage-backed list forever, and three inline photos can blow the ~5 MB list and fail every later save ("a bad extra never loses a good spot" is not true then). Plan says "keep that extra inline, same rule as first" without the move. Say whether extras are allowed inline at all; on failure to store an extra, refuse the extra at pick time (like an unprepared photo) instead.
- review.tsx uses `queuedItem.photoUri` AND `queuedItem.photoBase64` as a pair in three places (lines 252-253, 697-698, 847-848). Plan Step 5 swaps only the uri expression to the face extra, so SightingPhoto would get the face URI with the first photo's inline base64 (which wins when present). Spell out all three sites and the pairing, and add `coverOf(item)` returning {uri, base64}.

### 13. [Minor] i18n interpolation does not exist
Plan Task 4.6 strings use `{{when}}`, `{{which}}` and `t('extraRemovedAfterRetake', ...)`. `t` in context/LanguageContext.tsx:40 takes one argument and does no interpolation; the repo's convention is single braces plus manual `.replace` (photoTooOld uses `{date}`/`{days}`, i18n.ts:587). The plan's code will not typecheck. Use `{when}`/`{which}` and show the replace call. Also i18n line refs are off (en starts at 11, el 627, fr 1219 vs "110/725/1320"), harmless but should say "the en/el/fr dictionaries".

### 14. [Minor] Settings plumbing is incomplete
- Client `SettingsView` is defined in lib/waitingCard.ts and is what `settings` carries and `chooseForWait` consumes (spot.tsx:192, 532); plan only edits lib/appSettings.ts and the context. Add `extraPhotosOn` to `SettingsView`, `emptySettingsState` and the many test literals, or make it optional.
- OpenAPI: plan makes `AppSettings.extraPhotos` required, which breaks existing app code/tests that build AppSettings objects; make it optional (client already treats missing as false).
- Server caches /app-settings 60 s and the route sends `Cache-Control: public, max-age=60`, and the app persists the last answer; "turning it off hides the boxes within a minute" is not true for a phone that already stored `extraPhotosOn: true`. Say "within minutes, on next launch/refresh".
- Existing `routes/appSettings.test.ts` and `lib/__tests__/appSettings.test.ts` may assert the exact response body; "extend" should say "update existing toEqual".

### 15. [Minor] Plan quality
- Task 2.1 schema code declares both `uniqueIndex("sighting_photos_photo_uq")` and `index("sighting_photos_photo_idx")` on the same column, then the prose says to drop one. Pick one in the code block; migrate:check compares push vs migrate and an implementer copying the block gets a redundant index.
- Task 2.3 DB test "role 'bogus'" will not typecheck against `SightingPhotoRole`; say `as never`.
- "rollback" statement in 2.1 omits that the rolled-back DB keeps `sightings.photo_id` pointing at covers but loses extras' roles (it says so) AND the check that old code never reads sighting_photos (true).
- Task 4.6 Step 3: "use the repo's confirmChoice helper with two options" - confirmChoice (lib/notify.ts:27) is yes/no only and on web is `window.confirm`; there is no three-way chooser. The camera-vs-library choice needs a real component (or two always-visible buttons per box, which also avoids web "picker needs a direct tap" problems). Decide now.
- Spec §3.2 says a lightbulb icon; plan says Feather zap/info (Feather has no lightbulb). Say the deviation or pick the icon.
- Spec coverage table cites "Follow-up comments on SYC-46 and SYC-81 (Task 4.7 Step 4)" but Step 4 only mentions §11 follow-ups and the 29 Oct reminder. Add the two comments.
- Task 2.2 (OpenAPI + codegen) has no row in the model-delegation table; every other package has a tier and assurance. Also "The active model is Opus 5.5" is a claim about the session; drop or verify.
- Task 1.2 SVG `FeGaussianBlur` guidance: react-native-svg 15.12.1 filter support is native-only and partial; on web it is real SVG. The "use opacity if filter missing" fallback has no detection logic; pick opacity only and say so.
- The 29 Oct reminder: spec §8 says two weeks after release; set it relative to the switch-on date, not a fixed date.
- Plain-English section, Decision P1 (options, benefits, risks, recommendation), checkpoint-note and commit-after-each-task wording: all present and acceptable under Samuel's rules.

REVIEW COMPLETE

---

## How each finding was handled (15 October 2026)

Claude checked each blocker against the code before acting:
- the app has `@testing-library/react` only, and its tests use the jsdom pragma;
- `jsonErrorHandler` in `app.ts` handles only `ZodError`;
- `parseQueue` passes items through untouched.

It also rebased onto `1eda7d2c` and found one more consumer the review missed. `routes/issues.ts` `photoOfCat` accepts only a cat's main photo or a sighting's cover, so a report about an extra photo would get 422. That fix is now Task 3.1(d) and Step 4.

| # | Outcome | Where in the plan |
|---|---|---|
| 1 | Fixed. Every app test is in the repo's style: jsdom pragma, `@testing-library/react`, `fireEvent.click` on `data-testid`, mocks for LanguageContext, react-native-svg, vector-icons, expo-image and useColors. | Global Constraints; 1.2, 1.3, 3.4, 4.6 |
| 2 | Fixed. `jsonErrorHandler` maps `entity.too.large` to 413, with a test and a probe. The app's `photoRejection.test.ts` 413 assertion update is named. | 2.2; 4.4 |
| 3 | Fixed. `parseQueue` is left alone; a new `extrasOf()` normaliser is the only reader of stored extras, and it never throws. | 4.3, 4.4 |
| 4 | Fixed. `catPages.ts` added. `TeamPhoto.role`, `sightingIds` widened (extras are not "statement"), and the chip is in the server HTML. The app-side chip and its string were dropped. | 3.3 |
| 5 | Fixed. One `setFirstPhoto` serves both `pickPhoto` and `captureLivePhoto` (source test). `spotRetake.test.ts` update named. `submitFlow` carries `role`. The rejected card offers per-photo replace and remove. | 4.6 |
| 6 | Fixed. `replacementPhotoKey` takes a role (`<localId>-<role>-r<n>`), with a test and a probe. | 4.4 |
| 7 | Fixed. The fingerprint is always the original's. The server duplicate check compares the normalised buffers (sha256), not the raw base64. Camera photos get fingerprints, and the doc comment and tests are updated. | 2.3, 4.1, 4.5, 4.6 |
| 8 | Fixed. `extraPhotos` is omitted when empty, so the snapshots stay byte-identical, and a test asserts that. | 3.2 |
| 9 | Fixed. The non-existent `catalogue.ts` bump was dropped. The schema is `Sighting`. The routes are now correct: `teamPhotos.ts` (hide), `teamReports.ts` (viewer) and `issues.ts` (report). | File map, 3.1, 3.2 |
| 10 | Fixed. Re-checked against `1eda7d2c`; code is cited by symbol. At `1eda7d2c`, `catsOfPhoto` returns raw cat ids, and merged-cat handling (`canonicalCats`) is applied downstream in `targetsOf`/`catTargets`. The new extra-photo query feeds the same path, so extras get the same merged-cat treatment as covers. | Header, 3.1 |
| 11 | Fixed. The dedupe falls back to `sightings.photo_id` (test 6 plus a probe). `mixedCats === true` (test 7 plus a probe). Resolve linking coat answers to the cover is stated as intentional (SYC-417). The missing probes were added for 413, the fallback, the normaliser, the key and the team photo GET. | 2.5, 3.1, coverage table |
| 12 | Fixed. Extras are never kept inline: if the store fails, the extra is dropped with a note (test 9 plus a probe). `coverOf()` keeps the uri and base64 paired, at all three `review.tsx` sites. | 4.3, 4.4, 4.6 |
| 13 | Fixed. Single-brace placeholders with `.replace`. | Global Constraints, 4.6 |
| 14 | Fixed. `SettingsView` in `waitingCard.ts`. `AppSettings.extraPhotos` optional. The switch-off timing claim corrected. The existing `toEqual` updated. | 2.2, 2.6, 4.6, plain-English table |
| 15 | Fixed. Single index. `as never`. A camera/library pair of buttons replaces the non-existent three-way chooser (flagged to Samuel as a small change from the spec). A real lightbulb icon (`MaterialCommunityIcons`). Opacity instead of a filter. The 2.2 delegation row added. A switch-on-relative reminder. The SYC-46/SYC-81 notes were already posted. | throughout |
