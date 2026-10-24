# Vet visit batches Implementation Plan (SYC-677)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after every task, and keep `CHECKPOINT.md` in the worktree root (what's done, what's next). Never hold work only in memory. Do not sub-delegate.**

**Goal:** Syros Cats records a batch of vet visits from the photos it received. Each cat is matched by photo or created new, each visit records what was done and what Syros Cats paid, the photos are kept, and spotters can name a new cat that Syros Cats left unnamed.

**Architecture:** An unfinished batch lives in three new tables, with its photos stored in `photos` from the moment they're uploaded. A batch saves in one transaction through #327's `writeVisit` writer: new cats first, then one `vet_visit` per cat, then a link from each kept photo to its visit. A photo with that link (or still staged) is team-only. Spotter naming is one new public endpoint plus a sheet on the app's cat page.

**Tech stack:** TypeScript, Express, Drizzle on Postgres, Vitest with a throwaway database, `multer` (already used by Find from a photo), `sharp`, OpenAPI + orval codegen (`lib/api-spec`), Expo/React Native web app (`artifacts/cat-spotter`) with Jest.

**Spec:** `docs/superpowers/specs/2026-10-24-vet-visit-batches-design.md` (approved by Samuel, 24 Oct 2026; its "Spotters naming a cat" section was added the same day and is approved with this plan). Read it with this plan. Carried-over code: `logRound`, `writeVisit` and `checkVisit` in `artifacts/api-server/src/lib/vetVisits.ts` on branch `claude/syc-621-round` (closed PR #327), with `lib/vetVisits.round.test.ts`.

**Evidence base:** `origin/main` at `a9be9c5b` plus #326, read on 24 Oct 2026. Before each PR, re-read every signature it names on the then-current `origin/main`. Change the task's code, not its intent.

## Global Constraints

- Sterilisation costs €50–60 per cat. The price is always read from Vet settings (`getAppSettings().sterilisationPriceEur`), never hard-coded.
- Say "cat guardian", never "colony carer". The word is "spotter". Plain English. No text below 12px. Team pages are English only (Decision 12).
- In a batch, "what was done" is one or more of Sterilised, Vaccinated and Treated. There is no "Checked only" in a batch, but the stored `VetVisitValue` doesn't change.
- A batch holds at most 40 cats (`ROUND_MAX`).
- Batch photo-search limits: **60 per person a day and 200 for the team**, counted separately from the single-photo page's 20 and 100. A name or SYR lookup is not a search; "search somewhere else" is.
- An unfinished batch is kept for **7 days** from its last change, then removed with its staged photos.
- Batch routes need `log_vet_visit`, `find_cat_from_photo` and `view_vet_costs`. Ticking Vaccinated also needs `set_vaccination`. A cat guardian gets 403 on every batch route.
- No position, and no person's or colony's name, in any address. The batch id, colony number and area key may be in an address.
- Photos are re-encoded on upload, which strips EXIF and GPS (`validatePhotoBase64`).
- Kept batch photos are team-only. The one exception is a **new** cat's first photo, which becomes its public main photo.
- Every team route: `requireTeam(cap)` or `...formRoute(cap)`, `setTeamHeaders(res)` before any `await`, and a row in `routes/team.walk.test.ts` `TABLE`.
- A new lib module that reads sites, colonies or `mapping_events` joins `FILTERED_MODULES` or `ISLAND_ONLY_MODULES` (`lib/guardianView.source.test.ts`). A new file naming `welfare_reports` joins `welfareKindGuard` ALLOWLIST.
- Migrations take the next free number when each PR leaves draft (main is at `0042` on 24 Oct; re-check). Each one has a commented rollback (`-- --` inside the rollback block) and passes `migrate:check` and `lib/db` `runner.test`. Each is applied to production before the publish that reads it ("don't republish yet").
- Every PR opens as a draft. Run the full api-server suite locally before `gh pr ready`. Screenshots at 390px and 1280px for page changes. Every guard against a silent failure gets a mutation probe.
- New app words go into `artifacts/cat-spotter/lib/i18n.ts` in en, el and fr. The el and fr versions are drafts, flagged on SYC-346 (second pack).

## Review Focus

1. **A batch photo leaking to the public or to a cat guardian.** This includes the public photo route, guardian views of the team photo route, display-photo choice, Find reference photos, fingerprints, exports and a cat guardian's cat page. Expected: none of these ever serves or uses a team-only photo. The tests are in Task 2.
2. **Saving twice.** A double-tap on Save, a browser retry, or two people saving the same batch. Expected: one set of visits; the second save says "This batch was already saved." The test is in Task 4.
3. **A batch abandoned with photos in it, or a cleanup run while someone is still working on it.** Expected: only batches untouched for 7 days are removed, with their staged photos; a saved batch's photos are never removed. The test is in Task 3.
4. **A search limit reached halfway through a batch.** Expected: the cats still to match can be found by name or SYR number, and nothing uploaded or typed is lost. The test is in Task 5.
5. **Two spotters naming the same cat at once, or a name that's offensive or already taken.** Expected: exactly one name wins; the loser is told it was just named; refusals use the same words as naming a new cat. The test is in Task 10.

---

## PR split

| PR | Tasks | Migration | Depends on |
|---|---|---|---|
| A: batch store, kept photos, the save | 1–4 | `vet_batches` | #326 merged; brings #327's writer |
| B: the batch pages and matching | 5–8 | none | A |
| C: new cats from a batch | 9 | `cat_name_pending` | B |
| D: spotters naming a cat | 10–12 | none (uses C's column) | C |

A goes first and carries #327's `vetVisits.ts` changes and their tests: cherry-pick commits `d71da075` and the `vetVisits.ts` part of `d3d32cc1` from `claude/syc-621-round`. Each later PR is stacked, stays a draft until the one below it merges, and follows the stacked-PR squash rule (retarget before deleting the base branch).

---

### Task 1: The batch tables and the kept-photo link (migration `vet_batches`)

**Files:**
- Create: `lib/db/migrations/NNNN_vet_batches.sql` and `lib/db/src/schema/vetBatches.ts`
- Modify: `lib/db/src/schema/index.ts` to export it
- Test: `lib/db/src/migrate/vetBatches.test.ts`

**Interfaces:**
- Produces these tables:
  - `vet_batches` (`id` serial, `created_by` uuid → people, `created_at`, `updated_at`, `saved_at` null, `date` text `YYYY-MM-DD`, `clinic_id` text null, `colony_id` int null → colonies, `area_key` text null, `price_eur` numeric(7,2) null, `paid_by` text, `vaccines` jsonb `[]`, `vaccine_other` text, `note` text). Check: `colony_id` and `area_key` are never both set.
  - `vet_batch_cats` (`id` serial, `batch_id` → vet_batches **on delete cascade**, `position` int, `cat_id` int null → cats, `new_cat` jsonb null `{ name: string | null, description: string }`, `confirmed` bool, `did` jsonb `[]`, `treated_note` text, `cost_eur` text (as typed), `paid_by` text (blank means "as the batch"), `note` text, `also_same_day` bool, `suggestions` jsonb null). Check: `cat_id` and `new_cat` are never both set.
  - `vet_batch_photos` (`id` serial, `batch_cat_id` → vet_batch_cats on delete cascade, `photo_id` int → photos, `position` int).
  - `vet_visit_photos` (`photo_id` int primary key → photos, `visit_id` int → observations, `cat_id` int → cats). These are the kept photos. The table is add-only.
- Drizzle tables `vetBatchesTable`, `vetBatchCatsTable`, `vetBatchPhotosTable`, `vetVisitPhotosTable`.

- [ ] **Step 1: Failing migration test:** both rows of each table insert; deleting a batch cascades to its cats and their photo rows, but not to `photos`; a batch with both `colony_id` and `area_key` is refused; a `vet_batch_cats` row with both `cat_id` and `new_cat` is refused.
- [ ] **Step 2: Fail. Step 3: Write the migration with its rollback, then the schema. Step 4:** `pnpm --filter @workspace/db run migrate:check`, `pnpm --filter @workspace/db test` (runner.test included) pass.
- [ ] **Step 5: Commit:** `SYC-677 A: vet_batches tables and the kept-photo link (migration)`

### Task 2: Team-only photos

**Files:**
- Create: `artifacts/api-server/src/lib/teamOnlyPhotos.ts`
- Modify: `src/routes/photos.ts` (`GET /photos/:id`), `src/routes/teamReports.ts` (`servablePhoto`), `src/lib/photoVisibility.ts` (`catDisplayPhotoIds`, `catDisplayPhotos`), `src/lib/findFromPhoto.ts` (`displayPhotoOf`)
- Test: `src/lib/teamOnlyPhotos.test.ts`, `src/routes/photos.teamOnly.test.ts`

**Interfaces:**
- Produces: `teamOnlyPhotoIds(ids: readonly number[], q?: Queryable): Promise<Set<number>>`. A photo is team-only if it has a `vet_visit_photos` row, or a `vet_batch_photos` row in a batch that isn't saved. A new cat's first photo has neither, because Task 4 doesn't link it.

- [ ] **Step 1: Failing tests:**
  - `teamOnlyPhotoIds` returns a staged photo and a kept photo, and not a sighting's photo;
  - `GET /api/photos/<publicId>` of a kept photo answers exactly what an unknown id answers (404, same body);
  - `GET /api/team/photos/<publicId>` serves it to the team, and gives a cat guardian of that cat's colony the same 403 as a hidden photo;
  - `catDisplayPhotoIds` never picks it, even when it is the cat's newest photo;
  - `displayPhotoOf` never uses it as a Find reference.
- [ ] **Step 2: Fail. Step 3: Implement.** Each reader filters through `teamOnlyPhotoIds`. **Step 4: Pass,** plus `team.photoVariants.test.ts` and `team.findPhoto.test.ts`.
- [ ] **Step 5: Mutation probe:** drop the filter from `routes/photos.ts`. The public-route test must go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-677 A: kept vet-visit photos are team-only everywhere`

### Task 3: The batch store

**Files:**
- Create: `artifacts/api-server/src/lib/vetBatches.ts`
- Modify: `lib/guardianView.source.test.ts`, adding `vetBatches.ts` to `ISLAND_ONLY_MODULES` with capability `log_vet_visit`
- Test: `src/lib/vetBatches.test.ts`

**Interfaces:**
- Consumes: `validatePhotoBase64` (`lib/imageValidation.ts`), `getAppSettings`, `ROUND_MAX` (`lib/vetVisits.ts`).
- Produces:

```ts
export const BATCH_KEEP_DAYS = 7;
export const BATCH_PHOTOS_MAX = 6;            // per cat
export interface BatchShared { date: string; clinicId: string | null; colonyId: number | null; areaKey: string | null;
  priceEur: string; paidBy: string; vaccines: string[]; vaccineOther: string; note: string }
export interface BatchCat { id: number; position: number; catId: number | null; newCat: { name: string | null; description: string } | null;
  confirmed: boolean; did: string[]; treatedNote: string; costEur: string; paidBy: string; note: string; alsoSameDay: boolean;
  photos: { photoId: number; publicId: string }[]; suggestions: FindResult[] | null }
export interface Batch { id: number; createdBy: string; savedAt: Date | null; shared: BatchShared; cats: BatchCat[] }
export async function createBatch(person: Person, start: { colonyId?: number; areaKey?: string }, now?: Date): Promise<number>;
export async function getBatch(id: number): Promise<Batch | null>;          // null when absent or removed
export async function updateShared(id: number, shared: BatchShared): Promise<void>;
export async function addCat(id: number, photos: Buffer[]): Promise<{ ok: true; batchCatId: number } | { ok: false; reason: "bad_photo" | "too_many_photos" | "batch_full" | "saved" }>;
export async function updateCat(batchCatId: number, fields: Partial<Omit<BatchCat, "id" | "photos" | "suggestions">>): Promise<void>;
export async function removeCat(batchCatId: number): Promise<void>;           // its staged photos removed too
export async function abandonBatch(id: number): Promise<void>;
export async function removeStaleBatches(now?: Date): Promise<number>;     // untouched BATCH_KEEP_DAYS, unsaved
```

- Every write sets `updated_at`. A write to a saved batch is refused.
- `createBatch` fills `priceEur` from Vet settings, `paidBy: "syros_cats"`, and today's date in Athens.
- Removing a staged photo hard-deletes its `photos` row, because it was never published.

- [ ] **Step 1: Failing tests:**
  - the round trip: create, add 2 cats with 3 photos and 1 photo, update, read back;
  - a 41st cat gives `batch_full`, and a 7th photo gives `too_many_photos`;
  - a non-image gives `bad_photo` and stores nothing;
  - a stored photo has no EXIF (read it back with `sharp().metadata()`);
  - `removeStaleBatches(now + 7 days + 1 minute)` removes an untouched unsaved batch and its staged photos, and keeps a batch touched 6 days ago and a saved batch (Review Focus 3);
  - `removeCat` deletes its staged photos.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5:** Run `removeStaleBatches` daily with the server's existing scheduled jobs (find where `setInterval` or cron jobs are started in `src/index.ts`, and follow that pattern). Log only the count.
- [ ] **Step 6: Commit:** `SYC-677 A: the batch store, kept for 7 days`

### Task 4: Saving a batch

**Files:**
- Modify: `artifacts/api-server/src/lib/vetVisits.ts`, adding `saveBatch`
- Test: `src/lib/vetVisits.batch.test.ts`

**Interfaces:**
- Consumes: `writeVisit`, `checkVisit`, `lockCat`, `ROUND_MAX` (from #327); `readVisitForm` (`lib/teamPages/vetVisitForm.ts`) to read each cat; `Batch` (Task 3).
- Produces:

```ts
export type BatchProblem = { batchCatId: number | null; field: string; words: string };
export async function saveBatch(person: Person, batchId: number, now?: Date):
  Promise<{ ok: true; visits: SavedVisit[] } | { ok: false; problems: BatchProblem[] }>;
```

- One transaction:
  1. Lock the batch row (`select … for update`). If it's already saved, return `{ problem: "This batch was already saved." }`.
  2. Read each cat through `readVisitForm`. The cost is the cat's own if typed, else the batch price when Sterilised is ticked. `paidBy` is the cat's, else the batch's. "Checked only" is refused with "Tick Sterilised, Vaccinated or Treated."
  3. Refuse: an unconfirmed cat ("Confirm who this cat is."); the same `cat_id` twice (both entries named); a cat with a visit on the batch's date when `also_same_day` is false ("Mimi already has a vet visit on 24 Oct."). Today `new_cat` is refused with "New cats arrive in a later update"; Task 9 replaces that.
  4. Lock the cats in ascending id order. Then `writeVisit` for each cat, and one `vet_visit_photos` row per photo.
  5. Set `saved_at`.
- If any problem is found, nothing is written.

- [ ] **Step 1: Failing tests:**
  - 3 confirmed cats give 3 visits, 5 kept photos and `saved_at` set;
  - D8: a guardian's "not sterilised" is overruled (the reason "vet visit on 24 Oct 2026");
  - an unconfirmed cat, a duplicate cat, and a same-day visit without `also_same_day` each save nothing and name the cat;
  - a same-day visit with `also_same_day` saves;
  - **saving twice**, including two `saveBatch` calls started together (`Promise.all`), gives one set of visits, and the second answer is "This batch was already saved." (Review Focus 2);
  - a failure while writing the third visit leaves no visits and no kept photos.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `vetVisits.test.ts` and `vetVisits.round.test.ts`.
- [ ] **Step 5: Mutation probe:** skip the `saved_at` check. The two-saves test must go red. Restore it.
- [ ] **Step 6: Commit:** `SYC-677 A: saving a batch in one transaction`

**PR A:** draft, Sonnet adversarial review of the diff, full suite, migration number re-checked, then `gh pr ready` once #326 has merged.

---

### Task 5: Matching a batch cat by photo, with its own limits

**Files:**
- Modify: `src/middlewares/rateLimit.ts`, adding the batch buckets
- Create: `src/lib/vetBatchSearch.ts`
- Test: `src/lib/vetBatchSearch.test.ts`, `src/middlewares/rateLimit.batch.test.ts`

**Interfaces:**
- Produces:

```ts
export const BATCH_FIND_PERSON_LIMIT = 60, BATCH_FIND_TEAM_LIMIT = 200;
export async function checkBatchFindLimits(personId: string, now?: number): Promise<FindLimit>;   // same shape as checkFindLimits
export async function batchFindLimitReached(personId: string, now?: number): Promise<FindLimit>;
export type BatchScope = "batch" | "island" | { colonyId: number } | { areaKey: string };
export async function searchBatchCat(person: Person, batchCatId: number, scope: BatchScope, now?: Date): Promise<FindOutcome>;
```

- `searchBatchCat` reads the cat's **first** staged photo's bytes from `photos.data` and calls `findFromPhoto(bytes, filters, now, { gate })`, where `gate` is `checkBatchFindLimits`. It stores `found` results in `vet_batch_cats.suggestions`. `"batch"` means the batch's colony or area, else the whole island.

- [ ] **Step 1: Failing tests:**
  - 60 batch searches by one person pass and the 61st is refused `"person"`;
  - batch searches don't touch the 20/100 counters, and single-page searches don't touch the batch counters;
  - a refused search stores no suggestions and keeps the cat's photos and fields (Review Focus 4);
  - the stored suggestions hold no photo bytes and no position (no 4+ decimal number).
- Stub the matching service as `team.findPhoto.test.ts` does.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass.**
- [ ] **Step 5: Commit:** `SYC-677 B: batch photo search with its own daily limits`

### Task 6: The batch pages

**Files:**
- Create: `src/lib/teamPages/vetBatchPages.ts` and `src/routes/teamVetBatches.ts` (mounted in `routes/index.ts`)
- Modify: `src/routes/team.walk.test.ts`, `src/lib/teamPages/layout.ts` (CSS only)
- Test: `src/routes/team.vetBatches.test.ts`

**Routes.** Every POST is `...formRoute("log_vet_visit")` plus a `view_vet_costs` and `find_cat_from_photo` check. Every GET is `requireTeam("log_vet_visit")` plus the same checks.

| Route | Does |
|---|---|
| `GET /team/vet-batches/new?colony=N` or `?area=key` | creates a batch, 303 to it |
| `GET /team/vet-batches/:id` | the batch page |
| `POST /team/vet-batches/:id` | saves the shared fields |
| `POST /team/vet-batches/:id/cats` | multipart: one cat, 1–6 photos (`multer`, memory, 10 MB each, field `photos`) |
| `POST /team/vet-batches/:id/cats/:catRow/search` | `scope=batch|island|colony:N|area:key` |
| `POST /team/vet-batches/:id/cats/:catRow/lookup` | name or SYR number (`searchCatsToAdd`); no search used |
| `POST /team/vet-batches/:id/cats/:catRow/confirm` | `catId=N` (or `new` once Task 9 lands) |
| `POST /team/vet-batches/:id/cats/:catRow` | what was done, cost, paid by, treated note, note, `alsoSameDay` |
| `POST /team/vet-batches/:id/cats/:catRow/remove` | removes the cat |
| `POST /team/vet-batches/:id/save` | `saveBatch`; on success 303 to the colony (if set) or Home with `?done=batch` |
| `POST /team/vet-batches/:id/abandon` | through `renderConfirmPage`, then removes the batch |

**The page** (server-drawn, no script):
- **For every cat in this batch:** date, clinic, colony or area, price (with the Vet settings hint), paid by, vaccines, note, and **Save these** (it saves these fields).
- **The cats:** one card each, in order, with:
  - its photos as thumbnails;
  - its state: *Not matched yet*, *Matched: Mimi SYR-0040*, or *New cat*;
  - when not matched: **Find this cat** (with the scope choice) and **Look up by name or SYR number**;
  - the suggestions as cards with **This is the cat**;
  - after matching: Sterilised, Vaccinated and Treated boxes, what for, this cat's cost, paid by, note, the same-day warning and its tick box, and **Remove from batch**.
- **Add a cat:** a multipart form with `<input type="file" name="photos" accept="image/*" multiple>`.
- **Save the batch's visits**, with each problem shown at its cat.
- Words are fixed English, as in `vetVisitForm.ts`. Each card has `id="bc-<catRow>"`, and every POST answers with a 303 back to `#bc-<catRow>`, so a reload never resubmits.

- [ ] **Step 1: Failing tests:**
  - a guardian gets 403 on every route (walk rows);
  - the full round trip, with the matching service stubbed: create from a colony; add two cats; search one and confirm the suggestion; look up the other by SYR number and confirm it; set Sterilised; save. Two visits exist, and the planner shows "saved";
  - a failed save keeps everything, and shows "Confirm who this cat is." at that card;
  - a POST with no Origin is refused;
  - nothing typed or uploaded appears in an address (check every `Location` header);
  - a crafted `did=vaccinated` without `set_vaccination` is refused.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `team.walk.test.ts` and `guardianView.source.test.ts`.
- [ ] **Step 5: Screenshots** at 390px and 1280px (an empty batch, one matched and one unmatched cat, a failed save) into `docs/screenshots/syc-677/`, using the fixture method in `docs/screenshots/syc-621/`.
- [ ] **Step 6: Commit:** `SYC-677 B: the batch pages`

### Task 7: Ways in

**Files:**
- Modify: `src/lib/teamPages/colonyPages.ts` (the planner: **Record vet visits** → `/api/team/vet-batches/new?colony=N`, only with `log_vet_visit`, team only), `src/lib/teamPages/homePage.ts` (**Record vet visits** in Home's links), and the unsaved batches list.
- Modify: `src/lib/teamPages/vetBatchPages.ts`, adding `renderBatchList` at `GET /team/vet-batches`: unsaved batches, newest first, with their date, colony or area, number of cats, and who started them.
- Test: `src/routes/team.vetBatches.test.ts` (extend), `colonyPages` tests

- [ ] **Step 1: Failing tests:**
  - the planner link appears for the team and never for a cat guardian;
  - Home links to the list;
  - an unsaved batch is listed, and a saved one isn't.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-677 B: Record vet visits from the planner and Home`

### Task 8: The kept photos on the cat page

**Files:**
- Modify: `src/lib/vetVisits.ts` (`VisitLine` gains `photos: { publicId: string }[]`, only with `costs: true`), and `src/lib/teamPages/catPages.ts` (thumbnails in each visit, linking to `/api/team/photos/<publicId>`)
- Test: `src/routes/team.vetVisit.test.ts` (extend)

- [ ] **Step 1: Failing tests:**
  - the team's cat page shows a saved batch visit's photos;
  - a cat guardian's own cat page (`guardianPages.ts`) shows the visit line and **no** photo.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-677 B: a visit's photos on the team cat page`

**PR B:** stacked on A. Same gates as A.

---

### Task 9: New cats from a batch (migration `cat_name_pending`)

**Files:**
- Create: `lib/db/migrations/NNNN_cat_name_pending.sql`, adding `cats.name_pending boolean not null default false`, with its rollback
- Modify: `lib/db/src/schema/cats.ts`, `src/lib/vetVisits.ts` (`saveBatch`), `src/lib/teamPages/vetBatchPages.ts` (the "None of these: a cat we haven't recorded" form), `src/routes/teamVetBatches.ts` (`confirm` with `catId=new`)
- Test: `src/lib/vetVisits.batchNewCat.test.ts`

**Interfaces:**
- `new_cat` is `{ name: string | null, description: string }`. `name: null` means "Leave it for spotters".
- The team-desk device id is `TEAM_DESK_DEVICE = "syros-cats-team"`, exported from `vetVisits.ts`. It is the `discoverer_device_id` of a cat Syros Cats created.

Inside `saveBatch`, before the visits, for each new cat:
1. Check the name, if one was given: `isBlankName`, `containsOffensiveLanguage`, `catNamed`. Each refusal uses the same words as `routes/sightings.ts`.
2. Insert the cat:
   - `primaryPhotoId` is its first photo, which is **not** linked in `vet_visit_photos`, so it becomes public;
   - its position is the colony centre (`colonies.lat/lng`), else the area centre (`areaByKey`), else refuse with "Choose a colony or an area for this batch";
   - `discovererDeviceId` is `TEAM_DESK_DEVICE`.
3. If no name was given, insert with a temporary unique name, then set `name = syrNumber(id)` and `name_pending = true`.
4. Write a `name` statement (team) when named. Write a `colony` statement when the batch has a colony.
5. Then its visit, as for any cat.

- [ ] **Step 1: Failing tests:**
  - a named new cat is created with its first photo public (the public photo route serves it) and its other photos team-only, and it is in the batch's colony;
  - an unnamed new cat is stored as its SYR number with `name_pending` set;
  - an offensive or taken name refuses the whole batch with the existing words;
  - a batch with no colony and no area and a new cat is refused;
  - the new cat's position is the colony centre, never a number in any page or address.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `migrate:check`, `lib/db` tests and the full suite. **Step 5: Screenshot** the new-cat form. **Step 6: Commit:** `SYC-677 C: new cats from a batch, named now or left for spotters (migration)`

**PR C:** stacked on B. Migrate production before the publish ("don't republish yet").

---

### Task 10: The public naming endpoint

**Files:**
- Modify: `lib/api-spec/openapi.yaml`, adding `POST /cats/{catId}/name` with body `{ deviceId, name }`. Then run `pnpm --filter @workspace/api-spec run codegen`.
- Modify: `src/routes/cats.ts`, adding the handler; `src/lib/catHelpers.ts` (`serialiseCat` gains `namePending: boolean`, and while pending `name` is the SYR number)
- Test: `src/routes/cats.nameByspotter.test.ts`

**Behaviour:**
- `verifyDeviceSecret` first, as `/cats/:catId/claim` does.
- Then, in one transaction with the cat row locked:
  - 404 for an unknown or redacted cat;
  - **409 `ALREADY_NAMED`** when `name_pending` is false;
  - the blank, offensive and taken checks with the same codes as naming a new cat (`BLANK_NAME_BODY`, `OFFENSIVE_NAME`, `nameTakenBody`);
  - update `name` and clear `name_pending`;
  - write a `name` statement with this device's id.
- Answer 200 with the serialised cat.
- `Cache-Control: PER_PHONE`, and the same rate limiter as `/cats/name-suggestions`.

- [ ] **Step 1: Failing tests:**
  - naming works once; a second naming gets 409 `ALREADY_NAMED`;
  - **two namings at once (`Promise.all`)** give exactly one 200 and one 409 (Review Focus 5);
  - an offensive name and a taken name are refused with the existing codes;
  - naming a cat that isn't pending gets 409;
  - a wrong device secret gets the same answer as on `claim`;
  - the public cat answer has `namePending: true` and `name` equal to the SYR number before naming.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass,** plus `pnpm run typecheck:libs`.
- [ ] **Step 5: Mutation probe:** drop the row lock. The two-at-once test must go red (run it 10 times). Restore it.
- [ ] **Step 6: Commit:** `SYC-677 D: spotters can name a cat Syros Cats left unnamed`

### Task 11: "Name this cat" in the app

**Files:**
- Create: `artifacts/cat-spotter/components/NameThisCat.tsx`, a sheet with a name box, **Suggest names** (the existing `/cats/name-suggestions` hook) and **Save the name**
- Modify: `artifacts/cat-spotter/app/cat/[id].tsx` (while `namePending`: the title "No name yet", the SYR number, and a **Name this cat** button opening the sheet); `artifacts/cat-spotter/lib/i18n.ts` (en, el, fr); and wherever a cat's name is drawn in lists or on the map, which shows "No name yet" when `namePending`
- Test: `artifacts/cat-spotter/components/__tests__/NameThisCat.test.tsx`

- [ ] **Step 1: Failing tests:**
  - the button shows only while `namePending`;
  - saving calls the endpoint and the page shows the new name;
  - a 409 `ALREADY_NAMED` shows "Someone has just named this cat" and refreshes it;
  - offensive and taken refusals show the same words as the new-cat name step;
  - offline, the button explains that naming needs a connection.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass** (`pnpm --filter cat-spotter test`). **Step 5: Screenshots** at 390px in the web preview. **Step 6:** Post the new words to SYC-346. **Step 7: Commit:** `SYC-677 D: Name this cat on the cat page`

### Task 12: "No name yet" on the dashboard, and the team naming it

**Files:**
- Modify: `src/lib/teamCatList.ts` (`TeamCat` gains `namePending`), the cat grid card, the planner rows and the team cat page header ("No name yet · SYR-0123"). The team cat page gets a **Name this cat** form that clears `name_pending` (`POST /team/cats/:id/name`, `...formRoute("edit_cat_facts")`, or the capability the team uses for names today: check `capabilities.ts`).
- Test: `src/routes/team.catName.test.ts`

- [ ] **Step 1: Failing tests:**
  - a pending cat shows "No name yet" on the grid, the planner and its page;
  - the team names it, `name_pending` clears, and a spotter's naming then gets 409;
  - a cat guardian can't use the route;
  - there's a walk row.
- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass. Step 5: Commit:** `SYC-677 D: No name yet on the dashboard; the team can name it`

**PR D:** stacked on C. The full api-server suite and the cat-spotter suite pass. Samuel's Replit publish carries the app and the server together.

---

## Model delegation

| Work | Tier | Why | Assurance |
|---|---|---|---|
| Tasks 1, 3, 7, 12 (schema, store, links, labels) | Sonnet | Mechanical, following set patterns | Each task's failing-first tests; migration runner tests; spot review by the session |
| Task 2 (team-only photos) | **Opus** | A missed reader leaks private photos silently, across five readers in four files | Mutation probe on the public route; the per-reader tests; Opus adversarial review of PR A |
| Task 4 (saving a batch) and Task 9 (new cats) | **Opus** | Transactions, D8, locks and unique names: a wrong order double-counts money or blocks a save | The two-saves race test and its mutation probe; the rollback test; adversarial review |
| Tasks 5, 6, 8 (search, pages) | Sonnet | Follows Find from a photo and the round form | Route tests; screenshots at 390px and 1280px; a Sonnet adversarial review |
| Task 10 (public endpoint) | **Opus** | A public write with a race | The two-at-once test and its mutation probe; adversarial review |
| Task 11 (app sheet) | Sonnet | UI following NameStep's patterns | Jest tests; 390px screenshots; Samuel's look in the web preview |
| el/fr drafts | Sonnet | Translation drafts | `strings.test.ts` and i18n parity; Johnny's check (SYC-346) |
| Each PR's adversarial review | Sonnet, except A and D, which get Opus | A and D carry the privacy and race risks | Findings folded in before `gh pr ready` |

## Self-review notes

- **Spec coverage:**
  - Steps 1–6 of the design: Tasks 3, 6, 5 and 6, 6 and 4, 4, 2 and 8.
  - A new cat: Task 9.
  - Spotters naming: Tasks 10–12.
  - Limits: Task 5.
  - Permissions: Task 6.
  - 7-day hold: Task 3.
  - Same-day warning: Task 4.
  - Team-only photos: Task 2.
  - #327 carried over: PR A.
- **Names used across tasks:** `Batch`, `BatchCat`, `saveBatch`, `searchBatchCat`, `teamOnlyPhotoIds`, `TEAM_DESK_DEVICE`, `name_pending` / `namePending`.
