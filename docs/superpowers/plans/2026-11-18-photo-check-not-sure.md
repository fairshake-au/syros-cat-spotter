# Photo check "not sure": implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The photo check answers cat, not a cat, or not sure. "Not sure" sends the spotter to a new screen instead of straight to naming, so a dark sock can't become a cat without a person saying so.

**Architecture:** There are three PRs, in order.
1. **PR A** adds the new prompt and the answer reader as a stand-alone module, plus a read-only test script that runs old and new prompts on real photos in Replit. Nothing in the app changes.
2. **PR B** (server) switches the live check to the new module and adds two record columns. It also sends the phone `catCheck`, replays it correctly, clears `photo_seen` on photo removal, adds the launch side counts and the team tag.
3. **PR C** (app) carries `catCheck` through every hand-off and adds the "not sure" screen.

PR B is safe for older apps on its own, because `isCatPhoto` stays true for "unsure".

**Tech stack:** TypeScript, Express (api-server), drizzle and raw SQL migrations (`lib/db`), Expo / React Native (cat-spotter), orval codegen (`lib/api-spec`), vitest.

**Spec:** [`docs/specs/photo-check-not-sure.md`](../../specs/photo-check-not-sure.md). It was approved 18 Nov 2026 with D1 A, D2 A, D3 A (tag only), D4 as written and D5 A.

## Global Constraints

- Three answers, exact strings: `"cat"`, `"not_cat"`, `"unsure"`.
- `isCatPhoto` is `true` unless the check said `not_cat`.
- `no_cat_in_any_photo` is true only for `not_cat`.
- The "cat" parts rule: at least one of face, eyes, ears or tail; or any two parts from the list. Fur alone, or fur plus paws alone, is not enough. The parts list is fixed: `face, eyes, ears, whiskers, tail, paws, fur`.
- `photoSeen` covers animals and objects only. It never goes to the phone, the API schema or the server log. It is stored trimmed to at most 120 characters.
- Copy is in English, Greek and French. New screen (EN):
  - title "Is there a cat in this photo?"
  - body "We couldn't see a cat clearly. A closer or brighter photo helps us match it to the right cat."
  - button "Take another photo"
  - link "Yes, there's a cat"
- Team tag (EN): "Photo check wasn't sure this was a cat." It uses the existing amber `tag warn` style.
- Single owners (project rules): the migration, `artifacts/cat-spotter/lib/i18n.ts` and `artifacts/api-server/src/lib/teamPages/strings/*.ts` are owned by this build session. Ask Samuel only if another session holds them when the build starts.
- Generate the migration on fresh `origin/main` (`lib/db/migrations/README.md`). It's 0059 or whatever is next at the time.
- Every PR opens as a draft. Run affected tests locally, then `gh pr ready`, and wait for a real "Test and build" pass. Never merge a draft. Never `--auto`.
- Test data: no wall clock and no random digits. Cat names in tests are letters only.
- Commit after each task, and write a one-line checkpoint in `.claude/checkpoint.md` (what's done, what's next). Restate this in every agent prompt.

## Review Focus

1. **A "not sure" spot replayed from the record comes back as "cat".** This was the review's blocker. It applies to the lost-reply resend and to "Check again". Test: Task B3.
2. **An older installed app gets `isCatPhoto: true` with an extra field it ignores, and behaves exactly as today.** Test: Task B3 (the response shape), Task C1 (a missing `catCheck` is derived).
3. **A spot saved on the phone before the update has no `catCheck`.** Reopening it must not crash or show the wrong screen. Test: Task C1 (`readCatCheck` with `undefined`).
4. **A spot from a cat page that's "not sure" must show the not-sure screen before "Is this {name}?"** Otherwise a sock skips it. Test: Task C3.
5. **The model returns `"Cat "`, `"UNSURE"`, `"maybe"`, both old and new fields, or a "cat" with only `["fur","paws"]`.** Each must read as the spec says, not as a failed check. Test: Task A1.

---

## PR A: the new check as a module, plus the test script

### Task A1: Prompt builder and answer reader

**Files:**
- Create: `artifacts/api-server/src/lib/photoCheck.ts`
- Test: `artifacts/api-server/src/lib/photoCheck.test.ts`

**Interfaces:**
- Produces:
  - `type CatCheck = "cat" | "not_cat" | "unsure"`
  - `const CAT_PARTS = ["face","eyes","ears","whiskers","tail","paws","fur"] as const`
  - `buildCheckPrompt(opts: { photos: NewPhotoInput[]; candidates: { catId: number; name: string }[] }): string`
  - `readCheckAnswer(raw: string, many: boolean): { catCheck: CatCheck; photoSeen: string | null; mixedCats: boolean; matches: MatchOutput["matches"] }`. It throws `"AI matching returned unparseable output"` exactly as today when there's no JSON object.
  - `enoughCatParts(parts: unknown): boolean`

  `NewPhotoInput` and `MatchOutput` are imported from `matching.ts`.

- [ ] **Step 1: Write failing tests** in `photoCheck.test.ts`:
  - `readCheckAnswer('{"catCheck":"Cat ","catPartsSeen":["face"]}', false).catCheck === "cat"` (capitals and spaces ignored)
  - `"UNSURE"` → `"unsure"`; `"maybe"` → `"unsure"`
  - `{"catCheck":"cat","catPartsSeen":["fur","paws"]}` → `"unsure"` (the server double-check)
  - `{"catCheck":"cat","catPartsSeen":["whiskers","paws"]}` → `"cat"`
  - `{"catCheck":"cat"}` with no parts list → `"unsure"`
  - old shape `{"anyCat":true}` → `"cat"`; `{"anyCat":false}` → `"not_cat"`; `{"isCatPhoto":"true"}` → `"cat"`
  - `{"catCheck":"not_cat","anyCat":true}` → `"not_cat"` (catCheck wins)
  - `photoSeen` of 200 characters is trimmed to 120; a missing one gives `null`
  - `mixedCats` is false when `many` is false, whatever the model says
  - the existing match-filtering behaviour (non-numeric catId dropped, confidence clamped 0–1) carries over
  - `buildCheckPrompt` with no candidates contains neither `"known cats"` nor `"0 images"`
  - its first sentence doesn't contain `"expert"`; `"catCheck"` appears before `"matches"` in the JSON template; the people/text/plates exclusion is present
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server exec vitest run src/lib/photoCheck.test.ts`. Expect FAIL (module missing). Use the darwin esbuild workaround from memory if vitest can't start.
- [ ] **Step 3: Implement** both functions. The prompt follows spec §4, points 1–6:
  - neutral opening
  - the fixed JSON order `photoSeen, catPartsSeen, catCheck, mixedCats, matches`
  - each answer's meaning
  - the several-photos rule
  - the matching section (with the "expert" framing) only when there are candidates

  Answer reading follows spec §4, point 7. Then apply `enoughCatParts` to downgrade "cat" to "unsure".
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit `SYC-866: the new photo check prompt and answer reader (not wired in)`.

### Task A2: Read-only test script

**Files:**
- Create: `artifacts/api-server/src/scripts/photoCheckEval.ts`
- Create: `artifacts/api-server/src/scripts/photoCheckEval/labels.json`, the hand labels: `{ photoId: number, label: "cat"|"not_cat"|"skip", half: "tune"|"held" }[]`
- Create: `artifacts/api-server/src/scripts/photoCheckEval/extra/`, Samuel's D5 photos with location and other metadata stripped (`exiftool -all= -overwrite_original`, then confirm `exiftool -gps:all` prints nothing)
- Test: `artifacts/api-server/src/scripts/photoCheckEval.test.ts`

**Interfaces:**
- Consumes:
  - `buildCheckPrompt` and `readCheckAnswer` (A1)
  - today's `matchCatPhoto` (the "old" answer)
  - the same OpenAI client and `VISION_MODEL`
- Produces:
  - `pickTestSet(rows: SpotRow[], seed: string): number[]`. The rule is spec §7: night spots by Athens sunset/sunrise, a seeded sample to about 40, a few multi-photo spots, and every `no_cat_in_any_photo` photo. It's deterministic for a given seed.
  - `worstOf(answers: CatCheck[], truth: "cat"|"not_cat"): CatCheck`
  - `scoreHeld(results): { passed: boolean; lines: string[] }`. This is the D4 bar: no confirmed non-cat comes back "cat"; no cat comes back "not_cat"; at most 1 in 5 night cats come back "unsure".
  - CLI: `pnpm --filter @workspace/db exec tsx ../../artifacts/api-server/src/scripts/photoCheckEval.ts --half tune|held [--prompt-file <path>]`

- [ ] **Step 1: Write failing tests:**
  - `pickTestSet` is stable for one seed and always includes photo 62 and every not-a-cat photo
  - `worstOf(["cat","unsure","cat"], "not_cat") === "cat"`
  - `worstOf(["cat","unsure","cat"], "cat") === "unsure"`
  - `scoreHeld` fails when one non-cat reads "cat", fails at 2 of 9 night cats "unsure", and passes at 1 of 5
  - the printed lines contain no name, lat/lng or `photoSeen` text: assert against a fixture row holding `"Whiskerbeard"` and `37.44`
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The database is read-only: open the session the way `calibrateDuplicateSweep` does.
  - Run each photo 3 times, in two variants: no candidates, and the 3 darkest nearby known cats attached.
  - `--prompt-file` swaps the prompt text so tuning doesn't need a new PR.
  - `photoSeen` goes to `./photo-check-eval-out.json` only. That file is added to `.gitignore`.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit, open PR A as a draft, run the affected tests, mark it ready, wait for a real pass, then merge.

### Task A3: Prove the prompt (no code PR unless tuning changes the prompt)

- [ ] **Step 1:** Ask Samuel to pull main in Replit's Git pane.
- [ ] **Step 2:** Probe that the Replit connector can run a command in the workspace. If it can't, give Samuel one copy-paste command for the Replit shell.
- [ ] **Step 3:** Check that the workspace's `DATABASE_URL` host is Neon `production`, without printing the URL.
- [ ] **Step 4:** Label the set by hand. View each photo through `/api/photos/<public_id>` and write the labels into `labels.json`, marked `tune` or `held` by the seeded split.
- [ ] **Step 5:** Run `--half tune`, and tune with `--prompt-file` until it passes.
- [ ] **Step 6:** Run `--half held` once. If it fails, tune again on the tune half, then re-run held.
- [ ] **Step 7:** Copy the passing prompt back into `buildCheckPrompt` in a small PR (A1's tests still pass). Post the held-half result lines on SYC-866.

---

## PR B: server

### Task B1: Migration and schema

**Files:**
- Create: `lib/db/migrations/00NN_sighting_matches_cat_check.sql`, generated per the README. It adds `cat_check text NULL` with a check constraint (`cat`, `not_cat`, `unsure`) and `photo_seen text NULL` with a check on `char_length(photo_seen) <= 120`. The rollback block uses `-- --` comment lines.
- Modify: `lib/db/src/schema/sightingMatches.ts`, adding `catCheck` and `photoSeen`.

- [ ] **Step 1:** Run `pnpm --filter @workspace/db run migrate:check` and `lib/db`'s `runner.test`. Expect the new migration to apply and roll back.
- [ ] **Step 2:** Commit.

### Task B2: Live check uses the new module

**Files:**
- Modify: `artifacts/api-server/src/lib/matching.ts`. Replace the inline prompt and parsing (lines 79–85 and 131–163) with `buildCheckPrompt` and `readCheckAnswer`.
- Test: `artifacts/api-server/src/lib/matching.test.ts`

**Interfaces:**
- Produces: `MatchOutput` gains `catCheck: CatCheck` and `photoSeen: string | null`, and `isCatPhoto = catCheck !== "not_cat"`. Existing mocks returning only `{ isCatPhoto, matches }` still type-check: make the two fields optional, and have readers derive `catCheck` as `isCatPhoto ? "cat" : "not_cat"` via a helper `catCheckOf(o: MatchOutput): CatCheck` exported from `photoCheck.ts`.

- [ ] **Step 1: Failing tests:**
  - a mocked model answer `{"catCheck":"unsure",...}` gives `isCatPhoto: true, catCheck: "unsure"`
  - the logger spy never receives `photoSeen` text
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, plus the existing `matching.test.ts` still passes.
- [ ] **Step 5:** Commit.

### Task B3: Record, response and replay

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts`:
  - `computeMatchCandidates` and `recordMatch` write `cat_check` and `photo_seen`, and overwrite both on a repeat send
  - `storedAnswer()` (around 813–843) and the recheck select (around 893–899) read `cat_check`
  - the response adds `catCheck`
- Modify: `lib/api-spec/openapi.yaml`. Add optional `catCheck` (enum of the three) to the upload/match response, then run `pnpm --filter @workspace/api-spec run codegen`.
- Test: `sightings.matchRecord.test.ts`, `sightings.recheck.test.ts`, `sightings.upload.test.ts`

- [ ] **Step 1: Failing tests:**
  - an "unsure" upload stores `cat_check='unsure'`, `no_cat_in_any_photo=false`, `photo_seen` trimmed, and returns `{isCatPhoto:true, catCheck:"unsure"}`
  - a replayed request for the same spot returns `catCheck:"unsure"`, not `"cat"`
  - a "Check again" whose first reply was lost also returns `"unsure"`
  - a repeat send with a new answer overwrites both columns
  - no response body or generated schema contains `photoSeen` or `photo_seen`: grep the generated client in the test
  - a failed check leaves both columns null
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Run all `sightings.*.test.ts`. Expect PASS.
- [ ] **Step 5:** Commit.

### Task B4: Photo removal clears `photo_seen`

**Files:**
- Modify: `lib/db/src/photoRemoval/remove.ts` (`removePhoto`, in its existing transaction)
- Test: `lib/db/src/photoRemoval/remove.test.ts`, `artifacts/api-server/src/routes/photoRemoval.matching.test.ts`

- [ ] **Step 1: Failing test:** after `removePhoto`, every `sighting_matches` row for a sighting that used that photo has `photo_seen IS NULL`, while `cat_check` is kept. The other sightings' rows are untouched.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** Commit.

### Task B5: Launch side counts and team tag

**Files:**
- Modify: `artifacts/api-server/src/lib/reports/launchMeasures.ts`. Add `unsureFinished` and `unsureNotFinished` side counts; `matchGroup` is unchanged.
- Modify: `artifacts/api-server/src/lib/teamPages/catHistory.ts`. Add the tag next to line 801, and have `routineSighting` (line 202) return false when `catCheck === "unsure"`.
- Modify: `artifacts/api-server/src/lib/teamPages/strings/{en,el,fr}.ts` (the new tag string).
- Test: `launchMeasures.test.ts`, `launchMeasures.db.test.ts`, `catHistory.test.ts`, `strings.test.ts`

- [ ] **Step 1: Failing tests:**
  - side counts with 2 finished and 1 unfinished unsure spot give 2 and 1, and the existing groups' numbers are unchanged
  - an unsure sighting renders the tag text in en, el and fr
  - an unsure sighting among routine ones is not folded
- [ ] **Step 2–4:** FAIL, implement, PASS. Then run the whole api-server suite (the welfare-guard memory).
- [ ] **Step 5:** Commit. Open PR B as a draft, then review (below), ready, and merge.
- [ ] **Step 6:** Production migration before Samuel republishes ("don't republish yet" until it's applied). Then publish, check `/api/healthz` shows the new commit, and confirm one live spot stores `cat_check`.

---

## PR C: app

### Task C1: `catCheck` through every hand-off

**Files:**
- Modify:
  - `artifacts/cat-spotter/lib/reviewParams.ts`
  - `lib/keptAtSend.ts`
  - `lib/offlineQueue.ts`
  - `lib/waitingCard.ts` (`sent` gains `catCheck?`)
  - `lib/recentPhotos.ts`
  - `context/OfflineContext.tsx`
  - `app/(tabs)/spot.tsx`
  - `components/ReviewReadyBanner.tsx`
- Create: `artifacts/cat-spotter/lib/catCheck.ts`, containing `type CatCheck` and `readCatCheck(v: { catCheck?: unknown; isCatPhoto?: boolean }): CatCheck`
- Test: `lib/__tests__/catCheck.test.ts`, plus the existing `reviewParams`, `keptAtSend`, `offlineQueue` and `OfflineContext` tests

- [ ] **Step 1: Failing tests:**
  - `readCatCheck({isCatPhoto:true}) === "cat"`; `readCatCheck({isCatPhoto:false}) === "not_cat"`; `readCatCheck({}) === "cat"`
  - `readCatCheck({catCheck:"unsure", isCatPhoto:true}) === "unsure"`; an unknown string gives `"unsure"`
  - review params round-trip `catCheck`; a queued item saved without it still reads
  - a kept-at-send unsure spot is kept (`isCatPhoto !== false`)
- [ ] **Step 2–4:** FAIL, implement, PASS. Run `grep -rn "isCatPhoto" artifacts/cat-spotter --include='*.ts' --include='*.tsx'` and confirm every non-test hit either passes `catCheck` alongside or is a pure yes/no test.
- [ ] **Step 5:** Commit.

### Task C2: Translations

**Files:**
- Modify: `artifacts/cat-spotter/lib/i18n.ts`. Add four keys: `review.unsure.title`, `.body`, `.retake` and `.yesCat`, with the EN copy from Global Constraints, plus EL and FR.
- [ ] Run the i18n completeness test. Expect PASS. Commit.

### Task C3: The "not sure" screen

**Files:**
- Modify: `artifacts/cat-spotter/app/review.tsx`:
  - a new branch before the "Is this {name}?" step (around 765–785), reusing the "No cat found" layout (around 727) and its compact photo tips
  - `ResultScreen` gains `'unsure'` and the nudge decision treats it as no-nudge
  - `openedOn` (around 278) always reopens at unsure until "Yes" is tapped *and* the spot is finished
- Test: the review screen tests, next to `reviewRoutes.test.ts` and `reviewFeedNudge.test.ts`

- [ ] **Step 1: Failing tests:**
  - an unsure result shows the title and both actions, and shows the first photo for a multi-photo spot
  - "Take another photo" discards the card exactly like the not-a-cat retake (same call)
  - "Yes, there's a cat" from a cat-page spot goes to "Is this {name}?"; from a plain spot, to the look-alikes, or to naming when there are none
  - close, then reopen, starts at the unsure screen, including after "Yes" but before finishing
  - no feeding nudge after unsure, even after "Yes"
  - the waiting-card record counts it as shown
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** Check in the browser pane at 390px and desktop, in EN, EL and FR, in light and dark, using a planted unsure result. Save screenshots for the PR.
- [ ] **Step 6:** Commit. Open PR C as a draft, then review, ready, and merge. After merge: the web app goes live on publish. Note on SYC-866 that installed apps need the next store build.

### After PR C is live

- Note on SYC-632: when built, it must let "not sure" spots through.
- Ask Samuel before removing cat #32 (Captain Sprout). Then the team removes it the usual way.

---

## Model delegation

The session runs on Opus. Per Samuel's rule, the coordinator moves to Sonnet once this plan is approved; Opus stays for review and judgement.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| A1 prompt and reader | Sonnet | clear spec, exact tests listed | tests; **mutation probe**: delete the parts-rule downgrade and confirm the `["fur","paws"]` test goes red (a silent sock-through guard) |
| A2 test script | Sonnet | standard script, pattern exists | tests, including the no-names/no-positions output test; spot review of the printed output by the coordinator |
| A3 labelling, tuning, held run | Opus (coordinator escalates) | judging photos and tuning a prompt is judgement, and it decides whether we ship | held half run once; D4 bar computed by `scoreHeld`, not by eye; result posted on SYC-866 |
| B1 migration | Haiku | two columns, known pattern | `migrate:check` + `runner.test` |
| B2–B3 server check, record, replay | Sonnet | multi-file but fully specified | tests; **mutation probe** on `storedAnswer`: make it ignore `cat_check` and confirm the replay test goes red (the review's blocker); adversarial review of PR B |
| B4 photo removal | Sonnet | small, privacy-sensitive | **mutation probe**: drop the clear and confirm the test goes red |
| B5 launch counts, team tag, strings | Sonnet | standard | tests; whole api-server suite |
| C1 hand-offs | Sonnet | many files, one pattern | tests; the `isCatPhoto` grep sweep in Step 4 lists every consumer |
| C2 translations | Sonnet | Greek and French copy needs care beyond Haiku | i18n test; coordinator reads the EL and FR lines |
| C3 screen | Sonnet | UI flow with clear tests | tests; **mutation probe**: put the unsure branch after "Is this {name}?" and confirm the order test goes red; browser check at 390px and desktop |
| Adversarial review of PR B and PR C | Opus | review is the judgement step; it caught 2 blockers in the spec | independent critic in its own worktree; findings folded in before ready |

**Every place "not sure" must hold** (the consumers of the invariant, not just the guards):
- `matching.ts` → `computeMatchCandidates` → `recordMatch`
- `storedAnswer` and the recheck select
- the upload response and openapi
- `findFromPhoto.ts:259` (unchanged: it stops only on `!isCatPhoto`)
- `launchMeasures.ts`
- `catHistory.ts`
- `photoRemoval/remove.ts`
- on the phone, every `isCatPhoto` hit listed in C1

Nothing else reads `no_cat_in_any_photo` (grep, 18 Nov: `launchMeasures.ts`, `sightings.ts` and the schema only).
