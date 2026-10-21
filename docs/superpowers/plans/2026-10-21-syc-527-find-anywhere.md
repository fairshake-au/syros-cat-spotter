# SYC-527: Find from a photo across the whole island, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the team search every cat on the island from one photo. *Anywhere on the island* ships before the 28 October freeze. The looks-like index follows in an early fix release.

**Architecture:** Three pieces, in Samuel's order (Decision 9, "Anywhere now, index when ready"):
1. **Piece 1:** removes the "a place is required" rule, so no place means the whole island. #252's comparison runs unchanged while there are 30 cats or fewer.
2. **Piece 2:** checks that the model runs on Replit.
3. **Piece 3:** adds fingerprints, kept in an ordinary table. Triggers delete them on hide and removal. Over 30 cats, the search shortlists the K closest-looking cats before the AI compares them.

**Tech Stack:** Express + server-drawn pages (`artifacts/api-server`), Drizzle + Postgres (Neon), vitest on the shared local test database. Piece 3 adds `@huggingface/transformers` and `onnxruntime-node` with DINOv2 small (8-bit).

**Spec:** `docs/specs/find-from-a-photo-whole-island.md` v0.3, approved by Samuel on 21 Oct 2026 ("approved, write the plan"). His nine decisions are in its §2 and on SYC-527. It amends `docs/specs/team-dashboard-redesign.md` §5.2.

## Global Constraints

- **Daily caps unchanged:** 20 a person and 100 for the team, per calendar day (`middlewares/rateLimit.ts`, SYC-496).
- **No search ever makes more than 4 AI calls.** A shortlist of 20 makes 3.
- **Nothing that happens before the caps' gate uses up a search.** That covers a refused narrowing, a bad photo, no photos, a model failure and the fingerprint fill.
- **The team's photo is never stored.** Its fingerprint stays in memory only: never in the database, a log line or an error report.
- **A hidden or removed photo never has a fingerprint row** (spec §6.2).
- **No position, person or colony name goes into any address.** *Anywhere* adds no new address field.
- **Team only:** `find_cat_from_photo`. A guardian gets 403. `match_cat_anywhere` stays reserved.
- **Words:** team-only English, not in Johnny's pack (SYC-346). Use "cat guardian", never "colony carer"; "spotter", never "snapper".
- **Pages keep the strict security header,** except the results answer, as #252 has it.
- **PRs open as drafts** (`gh pr create --draft`). Run the affected tests locally first, then `gh pr ready` once. A skipped check isn't a pass.
- **Commit after every task.** Keep `CHECKPOINT.md` in the worktree root up to date.
- **The paid AI service is never called** in tests or checks. The matching service is mocked, as #252's tests do.
- **Local tests** need the esbuild workaround (memory: `ESBUILD_BINARY_PATH` from a scratchpad `npm pack`) and the dummy `AI_INTEGRATIONS_OPENAI_*` values listed in `docs/superpowers/plans/syc-396-phases-2-4.md`.

## Review Focus

1. **The shared test database holds other runs' cats.** A test of "the whole island" must only see its own run's cats, or its counts are random. Tasks 1 and 2 add a test seam (below) and a test that proves the seam is used.
2. **A team member who arrives with an area from the Cats page** must still see that area chosen, not *Anywhere*. Pinned in Task 2.
3. **The island passes 30 cats before the index ships.** *Anywhere* must refuse plainly before the photo step, use no search, and never call the AI. Pinned in Tasks 1 and 2.
4. **A hide racing a fingerprint save.** Whichever commits first, no fingerprint row may survive. Pinned in Task 6.
5. **The search photo's fingerprint must never leak into storage or logs.** That includes `safeError` on a thrown fingerprint error. Pinned in Task 8.

---

# Piece 1: *Anywhere on the island* (before the freeze)

Branch: `claude/syc-527-anywhere`, from fresh `origin/main`, in the session's own worktree. **One PR.** No migration.

**A choice within the spec:** piece 1 counts "cats to compare" as #252 does (active cats, `catsToCompare`), not "cats with a display photo" (spec §3, step 3.3). The rule is stricter: it never lets more than 30 photos reach the AI. It changes with piece 3, which needs the display-photo count anyway.

### Task 1: no place means the whole island (the search)

**Files:**
- Modify: `artifacts/api-server/src/lib/findFromPhoto.ts` (`FindOutcome`, `hasPlace`, `findFromPhoto` step 1)
- Test: `artifacts/api-server/src/lib/findFromPhoto.test.ts`

**Interfaces:**
- Produces: `isWholeIsland(f: FindFilters): boolean`. It is true when `f.area === undefined && f.colony === undefined`, and replaces `hasPlace` (removed).
- Produces: `FindOutcome` without `{ kind: "no_place" }`. Every other kind is unchanged.
- **Test seam:** a `vi.mock("./teamCatList")` passthrough. When the filters have no area and no colony, it returns only cats whose name starts with this run's `PREFIX`, so "the island" is this test's cats. Write it once in the test file and reuse it.

- [ ] **Step 1: Write the failing tests** (they replace "refuses without an area or a colony"):
  - `it("with no place, compares every active cat on the island")`: an island of 12 of this run's cats. The outcome is `results` with `compared === 12`. Exactly 3 calls are made (2 groups plus the final round). The cats passed across all group calls are exactly those 12 ids.
  - `it("with no place and colours, compares the island's cats of those colours")`: island cats are 5 black and 4 ginger; `colours: ["black"]` gives `compared === 5`.
  - `it("with no place and over 30 cats, gives too_many before the gate and the service")`: 31 island cats. The result is `{ kind: "too_many", count: 31 }`; the gate spy is not called; `matchMock` is not called.
  - `it("the island test seam is in use")`: `allTeamCats` is called with no area and no colony, and returns only `PREFIX` cats. This guards Review Focus 1.
- [ ] **Step 2: Run them, and check they fail**

  Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/findFromPhoto.test.ts`

  Expected: the new tests FAIL with `{ kind: "no_place" }`.
- [ ] **Step 3: Implement.** Remove step 1 and the `no_place` kind. Rename `hasPlace` to `isWholeIsland` with the inverted meaning. Update the file's top comment: no place means the whole island (SYC-527 piece 1).
- [ ] **Step 4: Run the file again.** Expected: all pass, #252's tests included.
- [ ] **Step 5: Mutation probe.** Make `findFromPhoto` return `too_many` whenever `isWholeIsland(filters)` is true: "with no place, compares every active cat" goes red. Restore it.
- [ ] **Step 6: Commit** `SYC-527 piece 1: no place means the whole island (search)`.

### Task 2: the page, the route and the words

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/findPhotoPage.ts` (`whereForm`, `countLine`, `Narrowing`, `narrowingOf`, the hint line, `MATCHING_DOWN_WORDS` use)
- Modify: `artifacts/api-server/src/routes/teamCats.ts` (`findFormHtml`'s count, the POST's `no_place` branches, the `hasPlace` import)
- Modify: `docs/specs/team-dashboard-redesign.md` §5.2 (spec §16 of SYC-527's spec: "Where to look: anywhere on the island, a named area, or a colony")
- Test: `artifacts/api-server/src/routes/team.findPhoto.test.ts`

**Interfaces:**
- Consumes: `isWholeIsland` (Task 1).
- Produces: `Narrowing` loses `no_place`, and `ok` and `too_many` gain `island: boolean`. `narrowingOf(count: number, island: boolean): Narrowing`.
- Produces these exact words (constants in `findPhotoPage.ts`):
  - `ANYWHERE_OPTION = "Anywhere on the island"`: the area select's first option, value `""`, replacing "Choose an area".
  - `WHERE_HINT = "Anywhere on the island compares every cat. If you know where the photo was taken, choosing the area is surer."`
  - Island count line: `` `${cats(n)} to compare across the island` ``.
  - `ISLAND_TOO_MANY = "There are now too many cats to compare them all at once. Choose an area or a colony."`
  - Matching down, on the island: `"Matching isn't working right now. Try again in a few minutes, or browse the cats."` A place keeps #252's words.
- The same route test seam as Task 1 (mock `../lib/teamCatList` or `../lib/findFromPhoto`'s `catsToCompare` passthrough, restricted to this run's cats when there's no place).

- [ ] **Step 1: Write the failing tests.** They replace "with no place chosen, says to choose one" and "a missing area and colony is named next to the field":
  - `it("with no place, the form counts the island's cats and offers the photo form")`. GET with no query returns 200. The body contains `<option value="" selected>Anywhere on the island</option>`, `"12 cats to compare across the island"`, `WHERE_HINT`, and the button `"Compare with 12 cats"`.
  - `it("arriving with an area keeps that area chosen, not Anywhere")`. GET `?area=<key>` has `selected` on that area's option, and not on Anywhere (Review Focus 2).
  - `it("a search with no place compares the island's cats")`. POST with only the photo returns 200 with results and `"Compared with 12 cats"`.
  - `it("over 30 island cats, the form says so plainly and offers no photo form")`. With 31 cats, the body has `ISLAND_TOO_MANY` and no `type="file"`.
  - `it("over 30 island cats, a search is refused before the caps and the service")`. The POST returns 400 with `ISLAND_TOO_MANY`. The person's and team's counts are unchanged, and `matchMock` isn't called (Review Focus 3).
  - `it("a cat guardian gets the 403 for the island too")`: a GET and a POST with no place both return 403.
  - Extend `"each non-200 answer of the search carries STRICT_CSP"` with the island's `too_many`.
  - `it("the island form's address carries nothing new")`. The GET form's fields are only `area`, `colony`, `colours` and `tie`, and an empty area adds no field to the address.
- [ ] **Step 2: Run them, and check they fail**

  Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/team.findPhoto.test.ts src/routes/team.findPhoto.counterDown.test.ts`

  Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the words and narrowing in `findPhotoPage.ts`.
  - `findFormHtml` always counts: `catsToCompare(filters, now)`.
  - Remove the POST's `no_place` branches (the early check and the outcome switch).
  - `placeName` returns `"the island"` when `isWholeIsland`.
  - Edit §5.2 in `team-dashboard-redesign.md`: Narrowing, and "the page says plainly". #256 also edits this file, so rebase if it merges first.
- [ ] **Step 4: Run both route files and `src/lib/findFromPhoto.test.ts`.** Expected: all pass.
- [ ] **Step 5: Run the typecheck and the full api-server suite.**

  Run: `pnpm --filter @workspace/api-server run typecheck`, then `pnpm --filter @workspace/api-server exec vitest run`

  Expected: 0 failures. A known flake must pass when run on its own, and the PR says which.
- [ ] **Step 6: Mutation probe.** Make `narrowingOf` ignore `island`. "Over 30 island cats, the form says so plainly" goes red. Restore it.
- [ ] **Step 7: Screenshots** of the island form and the island too-many page at 390 px and 1280 px, from a local server with the AI mocked. Save them to `docs/screenshots/syc-527-piece-1/`.
- [ ] **Step 8: Commit** `SYC-527 piece 1: Anywhere on the island (page, route, words)`. Open a draft PR. Run the Sonnet adversarial review (below). Fold in its findings, then `gh pr ready`. The PR waits for Samuel's `/ship`.

---

# Piece 2: does the model run on Replit? (this week, nothing published)

### Task 3: the Replit check

**Files:** none in the repository. The results go on SYC-527, and the bench script lives in the session's scratchpad.

- [ ] **Step 1: Give Samuel a one-line heads-up.** This step asks the Replit agent to run commands in his Replit workspace. It installs into a temporary folder outside the repository, changes no app file, and publishes nothing.
- [ ] **Step 2: Ask the Replit agent, read-only, for the deployment's machine size** (vCPU and memory per autoscale instance). Record its answer, quoted.
- [ ] **Step 3: Have the Replit agent run the bench** in `/tmp/syc527-bench` on the workspace's Linux machine:
  - `npm i @huggingface/transformers@3.7.5`;
  - load `Xenova/dinov2-small` (`dtype: "q8"`, `device: "cpu"`);
  - fingerprint a synthetic 640×480 JPEG 12 times.

  Report: load ms, the median and the worst ms per photo, and the process's memory before and after loading. Use the scratchpad's `bench.mjs` from this session.
- [ ] **Step 4: Pass or fail, written on SYC-527 with the numbers and where each came from:**
  - extra memory ≤ 200 MB;
  - a fingerprint ≤ 1 s;
  - the package installs on Linux.

  **On a fail,** stop and bring options to Samuel (spec §5): the WebAssembly runtime, or a hosted service with a privacy-policy change.
- [ ] **Step 5:** Note that the workspace machine isn't the autoscale machine. Piece 3's PR re-measures once the code runs on the test site.

---

# Piece 3: the looks-like index (early fix release)

Branch `claude/syc-527-index`, from `origin/main` after piece 1 merges. It starts only once Task 3 passes. **One PR.** It has one migration, whose number is claimed at the start: check `origin/main` and the open branches, then post the number on SYC-396.

### Task 4: the accuracy check (chooses the model and K)

**Files:**
- Create: `artifacts/api-server/src/scripts/fingerprintAccuracy.ts` (read-only)
- Results: a comment on SYC-527, plus `docs/reviews/syc-527-accuracy.md`

**Interfaces:**
- Produces: the chosen `MODEL` (`"dinov2-small-q8"` or `"clip-b32-q8"`) and `K` (10 or 20). Tasks 5 and 8 use them.

- [ ] **Step 1: The smoke test** (spec §8, check 1).
  - **Pairs:** cats with two confirmed, visible photos from different Athens days. The query is the photo that isn't the display photo; the gallery is the display photos of every active cat.
  - **Output:** ranks only.
  - **Where it runs:** through `db-ops` as a read-only command, so photos stay inside the systems that already handle them. **Samuel starts it** (production).
  - **Passes if** every pair ranks in the top 10.
- [ ] **Step 2: The larger set** (check 2). Find a public collection with at least 100 individually known cats, with a licence that allows this use, and record its name and licence. Run it on the Mac only, and never upload it.
  - **Report:** the top-10 and top-20 hit rates for both models, and how often the top 20 is mostly one place.
  - **If no collection fits,** say so and skip check 2.
- [ ] **Step 3: Apply the rules.**
  - **Model:** the better top-20 rate wins; within 5 points, DINOv2 small.
  - **K:** 10 if top-10 is within 2 points of top-20 and the smoke test passes at 10; otherwise 20; and 20 if check 2 was skipped.
- [ ] **Step 4: Commit** the script and the results.

### Task 5: the model on our server

**Files:**
- Create: `artifacts/api-server/models/dinov2-small-q8/` (the model file, its config and its `LICENSE`, about 24 MB)
- Create: `artifacts/api-server/src/lib/fingerprint/model.ts`
- Modify: `artifacts/api-server/package.json`, `artifacts/api-server/build.mjs` (externalise `@huggingface/transformers`), the package-safety test, and `pnpm-workspace.yaml` only if `onnxruntime-node` needs a build step
- Test: `artifacts/api-server/src/lib/fingerprint/model.test.ts`

**Interfaces:**
- Produces: `MODEL_ID: string` (`"dinov2-small-q8/v1"`) and `DIMENSIONS = 384`.
- Produces: `fingerprintOf(jpeg: Buffer): Promise<Float32Array>`. It returns the CLS token, scaled to length 1. The model loads once, lazily, from disk, with `env.allowRemoteModels = false`. It throws `FingerprintUnavailable` if the model can't load.

- [ ] **Step 1: Write the failing tests:**
  - `fingerprintOf` returns 384 numbers of length 1 (within 1e-5).
  - The same photo gives the same numbers twice.
  - A photo and a slightly resized copy are closer than two different photos.
  - With remote models switched off and the model folder renamed, it throws `FingerprintUnavailable` and makes no network request.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.** Add the dependencies, at versions more than a day old.
- [ ] **Step 4: Run the tests.** Then run `pnpm --filter @workspace/api-server run build` and `node dist/index.mjs` with the test environment variables, and check the server starts and doesn't load the model until it's first used.
- [ ] **Step 5: Commit.**

### Task 6: the table, and no fingerprint for a hidden or removed photo

**Files:**
- Modify: `lib/db/src/schema/` (a new `photoFingerprints.ts`, exported)
- Create: `lib/db/migrations/00NN_photo_fingerprints.sql`, with the rollback in comments
- Modify: `lib/db/src/photoRemoval/catalogue.test.ts` (T3: `photo_fingerprints.photo_id`, "deleted") and `lib/db/src/photoRemoval/search.ts` (skip this table's numeric lists)
- Test: `lib/db/src/photoFingerprints.test.ts`, `artifacts/api-server/src/lib/fingerprint/privacy.test.ts`

**Interfaces:**
- Produces the table `photo_fingerprints`:
  - `photo_id integer primary key references photos(id) on delete cascade`;
  - `model text not null`;
  - `vector real[] not null` (a check that its length is 384);
  - `made_at timestamptz not null default now()`.
- Produces two triggers, each of which locks the photo row `for update` and then deletes `photo_fingerprints` where `photo_id` matches:
  - `photo_fingerprints_drop_on_hide`: AFTER INSERT on `photo_visibility_events`, when `NEW.action = 'hide'`;
  - `photo_fingerprints_drop_on_removal`: AFTER UPDATE OF `removed_at` on `photos`, when it changes from null to non-null.

**Every place the invariant must hold** (from origin/main, 21 Oct). The test file names each one:
- writers of hide rows: `setPhotoVisibility` (`lib/photoVisibility.ts`), `applyHideRules` (`lib/issues/hide.ts`) and `lib/db/src/photoRemoval/hide.ts`;
- the remover: `lib/db/src/photoRemoval/remove.ts`;
- writers of fingerprints: only `saveFingerprint` (Task 7). A source test bans any other insert into `photo_fingerprints`.

- [ ] **Step 1: Write the failing tests:**
  - for each of the four paths, a photo with a fingerprint row has none afterwards;
  - restoring a photo doesn't bring a fingerprint back;
  - the T3 catalogue lists the new column;
  - the removal search doesn't flag the numeric list.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.** Write the schema, `pnpm --filter @workspace/db run generate --name photo_fingerprints`, then the triggers by hand in the same file. Run `pnpm --filter @workspace/db test` to prove the rollback.
- [ ] **Step 4: Mutation probes.** Drop each trigger in turn: its path's test goes red. Then remove the catalogue entry: T3 goes red. Restore each.
- [ ] **Step 5: Commit.**

### Task 7: saving, ranking and filling fingerprints

**Files:**
- Create: `artifacts/api-server/src/lib/fingerprint/index.ts`
- Test: `artifacts/api-server/src/lib/fingerprint/index.test.ts`, `artifacts/api-server/src/lib/fingerprint/privacy.test.ts` (the race)

**Interfaces:**
- Consumes: `fingerprintOf` and `MODEL_ID` (Task 5); the table (Task 6); `variantFor(photoId, "medium")`; `hiddenPhotoIds(ids, tx)`.
- Produces:
  - `saveFingerprint(photoId: number, v: Float32Array): Promise<"saved" | "hidden_or_removed">`. In one transaction: `select … from photos where id = $1 for share`, then `hiddenPhotoIds([id], tx)`, then `insert … on conflict (photo_id) do update` only when the model differs.
  - `fingerprintsFor(photoIds: number[]): Promise<Map<number, Float32Array>>`. Rows of the current `MODEL_ID` only.
  - `fillMissing(photoIds: number[], budgetMs: number): Promise<{ made: number; failed: number; left: number[] }>`. Oldest photo id first. One fill at a time per process: a second caller awaits the running fill, then fills what is still missing within its own budget.
  - `rank(query: Float32Array, rows: Map<number, Float32Array>, k: number): number[]`. Photo ids by dot product, largest first; ties go to the lower id.

- [ ] **Step 1: Write the failing tests:**
  - `rank` orders by closeness and breaks ties by id;
  - `fillMissing` stops at the budget and returns what was left, oldest first;
  - two concurrent `fillMissing` calls fingerprint each photo once;
  - `saveFingerprint` on a hidden photo returns `"hidden_or_removed"` and writes nothing.
  - **The race:** start a save that holds `for share` (a test hook after the lock). Commit a hide in another connection: it waits, and afterwards no row exists. Then the other way round: commit the hide first, and the save returns `"hidden_or_removed"`.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Mutation probe.** Remove the `for share` and the re-check: the race test goes red. Restore it.
- [ ] **Step 5: Commit.**

### Task 8: the search uses the shortlist over 30 cats

**Files:**
- Modify: `artifacts/api-server/src/lib/findFromPhoto.ts`, `artifacts/api-server/src/lib/teamPages/findPhotoPage.ts`, `artifacts/api-server/src/routes/teamCats.ts`
- Test: `artifacts/api-server/src/lib/findFromPhoto.test.ts`, `artifacts/api-server/src/routes/team.findPhoto.test.ts`

**Interfaces:**
- Consumes: Task 7's functions, `catDisplayPhotoIds`, and `K` (Task 4).
- Changes `FindOutcome`:
  - `results` gains `shortlist: { of: number } | null` and `leftOut: number`;
  - a new kind `{ kind: "index_down"; count: number }` (no search used).
- The order is spec §3's.
  - **30 or fewer** cats with a display photo: #252's path, untouched.
  - **Over 30:**
    1. `fingerprintOf(upload)` in memory;
    2. `fillMissing(displayIds, 15_000)`;
    3. `rank` to K;
    4. `referencePhotos` for those K cats only;
    5. then the gate;
    6. then the AI.
- Words, exact from spec §9.2–§9.4:
  - the over-30 count line;
  - `LESS_SURE_SHORTLIST`;
  - the results line `"Compared closely with the ${K} of ${N} cats whose photos look most like yours"`;
  - the no-match line;
  - `INDEX_DOWN_WORDS`;
  - the left-out line `"${n} newer cats weren't included this time. Choose an area to include them."`
- Remove Task 2's `ISLAND_TOO_MANY` refusal for the island. A large area also uses the shortlist.
- Logging: the path (`all` or `shortlist`), the cat count, fingerprints made, cats left out, and the fill time in ms. Never a photo id or a vector.

- [ ] **Step 1: Write the failing tests:**
  - at 30 cats, `fingerprintOf` isn't called and #252's calls are unchanged;
  - at 31, `referencePhotos` reads exactly K photos and 3 AI calls are made (K = 20; 1 call if K = 10);
  - `fingerprintOf` throwing gives `index_down`, uses no search and makes no AI call;
  - cats past the fill budget are left out and counted;
  - **upload not stored:** after a search, `photo_fingerprints` has no row except for the display-photo ids of this run's cats (checked by id);
  - **not logged:** a captured logger has no array of 384 numbers and no photo id, including when `fingerprintOf` throws (Review Focus 5);
  - the route shows each new line of words, and the shortlist's results answer keeps #252's header rules.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full api-server suite and both typechecks.**
- [ ] **Step 5: Mutation probes.**
  - Gate before the fill: "index_down uses no search" goes red.
  - Read every cat's photo instead of K: "reads exactly K" goes red.
  - Restore each.
- [ ] **Step 6: Commit.**

### Task 9: the nightly batch

**Files:**
- Create: `artifacts/api-server/src/routes/fingerprintJob.ts` (`POST /api/jobs/fingerprints`), registered as the news job's route is
- Create: `.github/workflows/fingerprints-nightly.yml`, modelled on `news-nightly.yml` (the same host allowlist, `environment: production`, `concurrency`, a `vars.FINGERPRINTS_NIGHTLY_ENABLED` switch, `workflow_dispatch`)
- Test: `artifacts/api-server/src/routes/fingerprintJob.test.ts`

**Interfaces:**
- Consumes: `fillMissing` (Task 7) and `catDisplayPhotoIds`.
- Produces: the route. The token comes from `FINGERPRINT_JOB_TOKEN`, checked the same way the news job's route checks `NEWS_JOB_TOKEN` (`lib/internalAuth.ts`). It fills every active cat's display photo, with a 4-minute budget, and answers `{ made, failed, left }` (counts only).

- [ ] **Step 1: Write the failing tests:**
  - no token or a wrong token gets 401 and does no work;
  - the right token fills the missing fingerprints and answers with counts;
  - a second run makes none;
  - a hidden display photo's stand-in is the one fingerprinted.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit.**
- [ ] **Step 5: The token rollout**, after merge, by the session that publishes (memory: token via a file):
  - make the token into a file with no line break;
  - set it in GitHub's `production` environment and in Replit's secrets;
  - give a one-line heads-up first, and never print or paste its value into a routine or prompt.

  Then, after `/api/healthz` shows the new build and the migration has run (Samuel switches to ask mode):
  - one manual run of the workflow does the backfill;
  - its counts go on SYC-527;
  - then switch the nightly variable on.

---

## Model delegation

The session runs on Opus. Each build is a chip in its own app-made worktree. Sonnet is the default; escalations are justified below.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Piece 1, Tasks 1–2 (Anywhere) | Sonnet | Small, well-specified change to code with full tests; exact words given | The tests above; two mutation probes (Task 1 step 5, Task 2 step 6) that must go red; the full suite and typecheck re-run **by the session itself**, not trusted from the agent (memory: re-run delegated tests); screenshots at 390 px and 1280 px; a Sonnet adversarial review in its own worktree |
| Piece 2, Task 3 (Replit check) | Session model (Opus) | Works in Samuel's Replit workspace through the connector: an outside effect that needs a heads-up and judgement about what the agent may touch | Probe verification: the numbers are quoted from the Replit agent's output, with pass or fail against the stated limits |
| Task 4 (accuracy check) | Sonnet | A read-only script plus a dataset search | Spot review of the script by the session; the ranks are re-computed by the session for two pairs by hand; the dataset licence is quoted in the results |
| Task 5 (model on server) | Sonnet | Packaging work with a clear interface | Tests, plus the session runs the build and starts `dist/index.mjs` itself |
| Tasks 6–7 (table, triggers, locked save, single fill) | **Opus** | Silent-failure guards with concurrency: a missed lock leaves a privacy-relevant row, and every test stays green | **Mutation probes** on each trigger, the catalogue entry and the race lock (each must go red); the named list of every writer above; the Opus adversarial review below |
| Task 8 (shortlist search) | Sonnet | Wiring to interfaces Tasks 5–7 already define | Tests; two mutation probes; the session re-runs the full suite |
| Task 9 (nightly job and workflow) | Sonnet | Copies the news job's pattern | Tests; spot review of the workflow against `news-nightly.yml`'s host allowlist |
| Token rollout and backfill (Task 9 step 5) | Session model | Secrets and production, with a heads-up to Samuel | A probe: the workflow's counts and the route's 401 without the token, checked with curl |
| Piece 1 review | Sonnet critic, own worktree | Small, ordinary change | It writes red tests where it can; findings folded in before `gh pr ready` |
| Piece 3 review | **Opus** critic, own worktree | Privacy, a locking race and a native module on Replit: the hardest review in this work | It must try the race and the "upload never stored" rule with its own tests |

**Every agent prompt restates, word for word:** "Commit after EACH item, not at the end. Keep CHECKPOINT.md in the worktree root current. Never hold work only in memory."

**Agents never call the paid AI service, never write to Neon, and never spawn agents of their own.**

## Order and timing

- **Piece 1:** a build card now (one Sonnet agent). It's small and independent of 2.3.1, 3.1a, 3.1b and 3.3a: no shared files apart from a §5.2 line in the dashboard spec, which #256 also edits. It needs one of Samuel's merge windows before the Mon 26 publish. With three agents already on the test database, it takes the next free slot.
- **Piece 2:** this week, in this session, after Samuel's go on the heads-up.
- **Piece 3:** after piece 1 merges and piece 2 passes, aiming for the first fix release after launch. Its migration and token rollout share an ask-mode switch with that publish.
