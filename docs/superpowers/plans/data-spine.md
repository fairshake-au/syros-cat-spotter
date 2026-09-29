# Data spine, steps 2–7: implementation plan (for approval)

**Spec:** `docs/specs/cat-record-data-spine.md` (approved 28 Sep 2026), its review `docs/specs/reviews/cat-record-data-spine-review.md`, and `docs/specs/DECISIONS.md`, which wins over every spec (Part 2c for the spine; Part 2g for the step-1 follow-ups; D4, F2, F3, F4, F6). Sibling specs where they touch the spine: `team-access-and-welfare-queue.md`, `email-capture.md`, `hosting-and-photo-storage.md`, `offline-queue-on-web.md`.
**Linear:** SYC-40 (life status, presumed deceased) and SYC-52 (the confidence engine this makes additive), delivering SYC-41 (blurring), SYC-37 and SYC-74 (the sighting questions) and SYC-75 (the sterilised thin slice) along the way.
**Builds on:** step 1, **done** in PR #17 (`1e88a97`, `docs/superpowers/plans/data-spine-step-1.md`): migration `0001_data_spine_tables` created `observations`, `cat_identity`, `colonies`, `colony_name_history`, `feeding_sites` and the `sightings` redaction columns, with the append-only triggers. This plan starts at §11.2 step 2 and does not re-plan step 1.
**Owned by other plans, and only sequenced here:** step 8, deletion (**SYC-63**, `docs/superpowers/plans/syc-63-self-service-deletion.md`, PR #21, including the deletion schema migration its §5 describes); the staff dashboard's people list and sign-in (**SYC-43 part 1**, `docs/superpowers/plans/syc-43-part-1-people-and-staff-sign-in.md`, PR #20); API tests on a throwaway database (**SYC-111**, filed by the SYC-63 plan). This plan lists what it needs from each and what each needs from it.
**Migration numbers:** none are hardcoded. Chip E's SYC-98 (`photos.public_id`) is `0002`; every other migration takes the next free number when it merges, and the runner refuses one that lands behind another, so the later one regenerates (`lib/db/migrations/README.md`).

**A note on format.** This is a plan for approval, so it carries no application code, schema or SQL. Each PR names its files, the interfaces later PRs rely on, its tests by name, and its rollback. Whoever builds a PR writes the code test-first against those names.

## In plain English

Step 1 built the empty filing cabinet. This plan fills it and starts reading from it:

- **The rules** that turn a cat's statements into "Lives on the street", "Probably sterilised" or "Not seen since June 2024" are written and tested on their own first, with no database, because a wrong answer here looks exactly like a right one.
- **Everything the app already knows** is copied in once: cats marked desexed or adopted through the old admin route, claimed cats (now "Has a home", Samuel's 28 Sep decision), and each cat's current name.
- **The cat page starts saying** what the rules work out.
- **The location leak is closed before the blurring is switched on**, because blurring the map while the matching endpoint still answers questions about exact positions would be a promise that is already false.
- **Spotters get the two quick questions** (ear tip, food and water) and the private note, after their points.
- **Before any of that reaches testers**, the live database has to get the safety rules Replit's publishing may not copy (decision Q1).

Nobody's spot flow gets slower, and nothing a tester has already done is lost.

## Scope

| In | Spec | Ticket |
|---|---|---|
| The resolver: life status, presumed deceased, the sterilised ladder, never crossing attributes | §3, §4.1–4.3, §4.6, §10.2 | SYC-40, SYC-52 (phase-1 rules), SYC-75 |
| One way to write an observation, used by every writer, and the go-forward writes from claim, owner registration, the old admin care route and naming | §3.2, §10.1, §10.3, §11.2 step 4 | SYC-40, SYC-52 |
| Backfill of what exists: legacy care updates, claims, owner registrations, current names | §11.2 steps 2–4 | SYC-40 |
| Showing derived status on the cat page; no pushes about a cat the team has recorded as dead | §3.3, §3.5, §4.2, §10.7 | SYC-40, SYC-75 |
| Closing the nearest-cat oracle and securing the claim | §6.3, §10.6, §11.2 step 5 | SYC-41, SYC-107 |
| Turning on blurring: one serialiser for four emitters, pagination, cache v2, drawing the cell | §2.3, §6.2, §6.4, §6.5, §6.6's label, §10.6, §10.7, §11.2 step 6 | SYC-41 |
| Coarsening sighting pushes | §6.4.4 | SYC-41 |
| The ear-tip and food-and-water questions and the private note | §4.4, §7, §11.2 step 7 | SYC-37, SYC-74 |
| The correction path: team statements, supersede, the *Likely* review list (endpoints only) | §3.5, §4.5, §10.7 | SYC-52 |
| Getting this plan's triggers and backfills into production on Replit | §11.1 | SYC-102 (finding) |

**Out, with where it lives:**

- **Deletion**, step 8: the `DELETE /me` endpoint, the Settings screen, the deletion schema migration and the sightings append-only guard. **SYC-63's plan**, PR #21. The interface points are below.
- **The dashboard**: sign-in, `people`, `person_scopes`, the `requireTeam(capability)` middleware (**SYC-43 part 1**, PR #20); the screens that call the correction endpoints, show notes and food-and-water, manage colonies and feeding sites, the public feeding-sites endpoint and the staff deletion action (**SYC-43**, later parts).
- API tests on a throwaway database: **SYC-111**.
- Writing `welfare_report` / `welfare_outcome` observations: **SYC-42**, through this plan's write service.
- Folding cat names for uniqueness: **SYC-101** (Part 2g, own migration). This plan supplies the shared folding function (PR 1) and sequences its migration.
- The derived "where it's usually seen" position: **SYC-80**, deferred by Samuel. The map says "first spotted around here".
- Records import: **SYC-49 / SYC-82**, optional and post-MVP. The resolver takes an empty import list.
- The nightly notify job and its `notified_status` baseline: **SYC-55 / SYC-45** (`email-capture.md` §5.3). This plan exposes the resolved snapshot the job reads.
- Duplicate merge (**SYC-59**), litters (**SYC-58**), roles beyond staff (**SYC-53**, SYC-24).
- Photo retention: **SYC-81**. It keeps ear-tip and sterilisation evidence photos at full size, found through `observations.photo_id` once PR 7 writes them.
- Opaque photo ids: **SYC-98** (Chip E, in flight). Blurring depends on it (§6.4.4).
- Owner-name remnants (**SYC-69**) and milestone dates (**SYC-73**, deferred by Samuel: this plan orders the work, it doesn't date it).

## Global constraints

Every PR's requirements include these.

- **Nobody edits a status.** Statements are appended to `observations`; status is derived on read (§2). No PR adds a status column to `cats`, whatever an older ticket says (Conflicts, C1).
- **Absence of a visible clipped tip is never negative evidence.** No quantity of spotter "looks whole" or "can't tell" answers moves sterilised at all. Only a team member, a vet or an imported record can say "not sterilised" (§4.1).
- **A confirmed negative is shown publicly** (D4): *"Not sterilised — Syros Cats' records"*.
- **Presumed deceased is never announced.** The cat page says *"Not seen since June 2024"*, never "No longer with us" and never "presumed deceased". Only a live `deceased` statement reads *"No longer with us."* (Part 2c). No push and no email about a death, ever (F4).
- **Public copy** (§3.5, §4.2): *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, *"No longer with us"*, *"Not seen since {Month Year}"*; *"Sterilised — confirmed by Syros Cats"*, *"Probably sterilised — a clipped ear tip has been seen"*, *"Not sterilised — Syros Cats' records"*, *"Not known yet"*. "Clipped tip", never "notched"; usually the **left** ear. English, Greek and French, with the Greek and French checked under SYC-4.
- **Terms:** "spotter" and "snapper"; "cat guardian", never "colony carer". User-facing copy says "Syros Cats", not "the charity". Sterilisation costs Syros Cats **€50–60 per cat**.
- **Offline support is partial.** Photos, capture locations and map tiles work without signal and the spot queue syncs later. Nothing in this plan claims more.
- **Exact coordinates never reach the mobile app** (§6.5). Blurring happens server-side when the payload is built.
- **App-written statements are authored `account_id = 'system:<source>'`** (Part 2g): `system:legacy-backfill` for PR 3, `system:admin-route` for the old `OWNER_SECRET` route in PR 2. Every row keeps exactly one author, and deletion never matches these.
- **Migrations:** generated, reviewed, with a commented rollback block; all pending migrations run in one transaction with a 5 s lock timeout; no `CREATE INDEX CONCURRENTLY` (`lib/db/migrations/README.md`). **Every step must be safe to run twice**, because of how production receives changes (see "How each step reaches production").
- **F6:** every schema change lands before the Google Play fourteen-day closed test starts.

## The sequence

This plan's own PRs are **P and 1–9**. The others in the table are owned elsewhere and appear because the order depends on them.

| # | PR | Spec step | Migration | Blocked by |
|---|---|---|---|---|
| — | SYC-98: opaque photo ids (Chip E) | hosting §6.2 | `0002` | — |
| — | SYC-43 part 1: `people` and staff sign-in | team-access §2, §7.3 | next free | its own approval (PR #20) |
| — | SYC-111: API tests on a throwaway database | — | none | — |
| — | SYC-63 §5: the deletion schema migration (nullable device columns, checks, index, sightings guard) | step 8, schema half | next free | SYC-111; PR P; its own approval (PR #21) |
| — | SYC-101: fold cat names | §10.3, Part 2g | next free | PR 1 (`foldName`); after PR 2 (shared files) |
| **P** | Database changes reach production | §11.1 | none | decision Q1 |
| **1** | The resolver and the name-folding function (pure) | §10.2, §10.3 | none | — |
| **2** | One way to write an observation, and the go-forward writes | steps 2, 4 | none | SYC-111, PR 1; **PR P live, and step 1's guards confirmed in production** |
| **3** | Backfill what already exists | steps 3, 4 | next free (data only) | PR 2 **live in production**; SYC-101 merged |
| **4** | The cat page shows derived status | §3.5, §4.2, §10.7 | none | PR 2; **merged only after PR 3 has run in production** |
| **5** | Close the oracle | step 5 | none | PR 2 |
| **6** | Turn on blurring | step 6 | none | PR 4, PR 5, SYC-98 |
| **7** | The sighting questions and the note | step 7 | none | PR 5; SYC-79 photos; decisions Q2, Q3 |
| **8** | The correction path (team endpoints) | §4.5 | none | PR 2; SYC-43 part 1's `requireTeam` |
| **9** | Coarsen sighting pushes | §6.4.4 | none | PR 4; decision Q4 |
| — | SYC-63 build: `DELETE /me` and "Delete my data" | step 8 | none | SYC-63 §5 migration; SYC-107 (PR 2); PR 4 |

Step 2 ("backfill life status") writes nothing, by design: a cat with no `life_status` observation resolves to Street (§11.2). It needs no PR; PR 1's test *"no observations resolves to street and unknown"* is its proof.

---

### PR P — Database changes reach production

Its shape depends on Q1 (see "How each step reaches production"). Under the recommended answer:

- **What changes:** in production, the API takes a Postgres advisory lock on start-up (so two instances never race), then runs an idempotent "finish" step: every trigger, function, constraint and relaxed NOT NULL the migrations define, applied if missing; every data step not yet recorded, run and recorded in a small record table the finish step creates for itself in the `drizzle` schema, beside the runner's own history. That table lives outside `public`, so it needs no migration, `migrate:check` doesn't see it, and Replit's diff has nothing to copy or delete. Then it compares production's schema signature (`lib/db/src/migrate/signature.ts`, which baseline adoption already uses) with what the migrations produce, and logs every difference. In production, if the `observations` or `cat_identity` guards are still missing, writes to those tables are refused with a 503 and a clear log line.
- **Files:** `lib/db/src/migrate/` (a `finish` entry point), `artifacts/api-server/src/index.ts` (call it before listening), `docs/DEPLOYMENT.md` §C (replace "run `migrate` against production first" with what really happens), `lib/db/migrations/README.md` (the "safe to run twice" rule).
- **Tests:** on a throwaway database built the way Replit's diff builds one (tables only, as `drizzle-kit push` makes them), the finish step adds step 1's triggers and attribution check, and a second run changes nothing; a data step runs once only; with a guard deliberately missing, an observation write is refused.
- **Assurance:** mutation probe (skip one trigger in the finish step; the start-up check must report it); after the first publish, the read-only query tool confirms step 1's guards exist in production.
- **Rollback:** revert. What it added (triggers, checks) is what the migrations always intended, so it stays.
- **Also serves** SYC-63's §5 migration and SYC-43 part 1's migration, which have the same problem.

Under Q1 option B, this PR instead makes the API run the ordinary migration runner at start-up (same lock, same check), after SYC-64's baseline adoption, with Replit's copying switched off.

### PR 1 — The resolver and the name-folding function

Pure functions: no database, no I/O. This is where the design risk lives, so it carries the hard tests (§10.8).

- **Files:** new `artifacts/api-server/src/lib/resolve.ts` and `resolve.test.ts`; new `lib/db/src/fold.ts` and `fold.test.ts` (in `lib/db` because SYC-101 and the API both use it).
- **Produces:**
  - `resolveLifeStatus(observations, evidenceOfLife, now)` and `resolveSterilised(observations, importRecords)` with exactly the §10.2 signatures and the `Resolved<T>` shape (`value`, `confidence`, `supportingObservationIds`, `conflicts`, `asOf`). `confidence` includes `reported`, unreachable in phase 1.
  - `evidenceOfLife` is an input, `{ at, source } | null`, computed by PR 2's loader. The resolver queries nothing.
  - `resolveCat(observations, evidenceOfLife, now)`, returning the snapshot §9.1 describes (sterilised level and value, life status, `presumedDeceased`, `notSeenSince`, and the date each was derived from). The cat page, the fan-out check, SYC-55's nightly job and the dashboard all read this one function.
  - `clippedTipCount(observations)` for the API's `clippedTipSightings`.
  - `foldName(name)`: NFC, case-folded, accents stripped, `ς` folded to `σ` (Part 2g). The same folding `colonies.normalised_name` uses.
- **Rules, as tests** (the names are the test titles):
  1. *ear-tip asymmetry: no number, authority or recency of spotter "looks whole" or "can't tell" answers moves sterilised* (§10.8.1). Its failure message says what it costs: a volunteer sent to trap a cat that was sterilised years ago.
  2. *a clipped tip reaches likely and never confirmed, whoever wrote it* (§10.8.2; §4.2 "never crosses attributes").
  3. *authoritative precedence, both directions*: import `true` 2024 then staff `false` 2026 → confirmed not sterilised; the same pair in the other date order → confirmed sterilised (§10.8.3, §4.6).
  4. *likely needs a photo*: a `clipped: true` with no `photoId` stays unknown (§4.2, review finding 22).
  5. *a team "that's not a clip" returns likely to unknown, never to a negative* (§10.8.4, §4.5).
  6. *a sighting after a deceased statement clears it in the same read*, returning street, with the disagreement in `conflicts` (§10.8.5, §3.2).
  7. *a cat created today with no sightings is not presumed deceased* (§10.8.6).
  8. *presumed deceased counts from when the photo was taken, not when it synced* (§10.8.7).
  9. *presumed deceased after 36 months of silence, and each kind of evidence of life resets it*: a resolved sighting, `life_status` street/homed/in care, `sterilised`, `ear_tip` and `welfare_report` do; `colony`, `note`, `name` and `food_and_water` don't (§3.4, §10.5).
  10. *a live deceased statement suppresses presumed deceased*, and *a life_status newer than the last evidence of life suppresses it*.
  11. *superseded and redacted-value observations are ignored*.
  12. *welfare reports and outcomes move no derived status* (§10.8.17, the resolver half).
  13. *no observations resolves to street and unknown* (step 2).
  14. `foldName`: `ΜΙΜΗ` = `Μιμή` = NFD `Μιμή`; `ΣΟΦΊΑΣ` = `Σοφίας`; `Zoë` = `Zoe`.
- **Assurance beyond green:** a mutation probe on rules 1, 3 and 6 (flip the branch, confirm the named test fails, restore), because each guards a wrong-but-plausible answer.
- **Rollback:** revert. Nothing calls it yet.

### PR 2 — One way to write an observation, and the go-forward writes

The single write path every later writer uses (this plan's PRs, SYC-42's welfare observations, the dashboard), and the loader every reader uses.

- **Files:** new `artifacts/api-server/src/lib/observations.ts` and tests; `routes/cats.ts` (claim, owner registration, rename); `routes/notifications.ts` (the `OWNER_SECRET` care-update route); `routes/sightings.ts` (naming a new cat on resolve).
- **Produces:**
  - `writeObservation(tx, input)`: validates `kind` against the phase-1 vocabulary (`life_status`, `sterilised`, `ear_tip`, `food_and_water`, `note`, `name`, `colony`, `welfare_report`, `welfare_outcome`) and each kind's value shape (§10.1); enforces one author; applies the `observedAt` rule (public writes clamped to 30 days back with the existing `clampCaptureTime`, any past date for team, vet, import and legacy, the future refused everywhere, §10.1); refuses a `roleAtTime` of guardian, volunteer or vet, unreachable in phase 1 (§10.4); refuses an `accountId` starting `system:` from any caller but the named system writers; returns the row.
  - `loadCatRecords(catIds)`: one batched query for the observations of many cats, reading through `cat_identity` so a future merge needs no change here (§2.3: never one query per cat), and one batched query for each cat's evidence of life (newest resolved sighting, newest life-implying observation, the cat's `created_at`). Returns what PR 1's `resolveCat` takes.
  - `SYSTEM_AUTHORS`: `system:legacy-backfill` and `system:admin-route` (Part 2g).
- **Go-forward writes**, each in the same transaction as the change it records:
  - **A claim** writes `life_status: homed` from the claiming device, `roleAtTime: public`, `authorityScope: owner_of_this_cat` (Part 2c).
  - **Owner registration** (`POST /cats`) writes the same at creation (§11.2 step 4).
  - **Naming** a new cat on resolve, **registering** one, and an owner's **rename** each write a `name` observation with the folded form, so no rename destroys an earlier name (§5, §10.3).
  - **The old admin care route** (`POST /cats/:catId/updates`): `desexed` also writes `sterilised: true`, and `adopted` writes `life_status: homed`, `roleAtTime: staff`, author `system:admin-route`, with `observedAt` = the new `cat_updates` row's `created_at`, so PR 3 can recognise it and not copy it twice. Without this, anything recorded through it before the dashboard exists would be missing from the record.
  - **Claim, registration and rename check the device secret.** §10.6 requires it of the claim "before the owner tier means anything at all", and the spec puts that in step 5; it moves here because from this PR on a claim changes what a cat's page says (Part 2c: "securing the claim endpoint therefore matters more"). Registration and rename have the same gap and aren't named in the spec (**SYC-107**, filed from this plan); from this PR they write attributed statements, and an author anyone can forge defeats §2's "how do you know". SYC-63's plan is blocked on the same fix, because an unchecked route could re-attach a deleted person's device id. The app already sends the secret on every request (`custom-fetch.ts`, noted in `routes/sightings.ts`), so no tester is locked out.
- **Tests:** each go-forward write appears once with the right role, scope and provenance, and not at all when the request fails; each of the three routes refuses a missing or wrong secret and writes nothing; `writeObservation` refuses an unknown kind, a malformed value, a future date, a public date more than 30 days old, an unreachable role and a borrowed `system:` author; `loadCatRecords` for 50 cats issues a fixed number of queries (asserted with a query counter).
- **Rollback:** revert. Observations already written stay (append-only), are true statements, and nothing reads them until PR 4.

### PR 3 — Backfill what already exists (next free migration number, data only)

Steps 3 and 4. Everything the app knows today becomes a statement in the record, once.

- **What's written.**
  - Each `cat_updates` row of type `desexed` → `sterilised: true`; each `adopted` → `life_status: homed`. `provenance: legacy`, `roleAtTime: staff` (they came through the admin route), `observedAt` = the update's `created_at`, author `system:legacy-backfill`.
  - Each cat with `owner_device_id` set → `life_status: homed` from that device, `authorityScope: owner_of_this_cat`, `provenance: legacy`. **`observedAt` = the cat's `created_at`**, because the claim date was never stored. That's the earliest the claim could have been, so the backfill never claims evidence of life later than we actually know it.
  - Each cat → one `name` observation with its current name and folded form, `provenance: legacy`, author `system:legacy-backfill`, `observedAt` = the cat's `created_at`. The folded form is copied from the column SYC-101 adds to `cats`, because a SQL migration can't call PR 1's TypeScript `foldName`. (SYC-101 has the same problem filling that column: it needs either a SQL folding that a test proves matches `foldName` on the Greek and Latin cases, or a data step run from TypeScript. Flagged on the ticket.)
  - Every row carries `suggestion_source = 'backfill:data-spine'`, so the rollback finds exactly these rows. PR 2's validation refuses that value from any other writer.
- **Idempotent against the go-forward writes.** Each insert is guarded by "no equivalent observation exists yet", so a claim PR 2 already recorded isn't recorded twice. That's why PR 2 must be **live in production** before this runs: it closes the window in which a claim could happen after the backfill read the table and before the new code was live.
- **Self-checking.** It ends with a block that compares what it expected to write with what it wrote and raises if they differ, so a partial or wrong backfill rolls back whole instead of landing.
- **Notifications.** Nothing is sent: it writes only to `observations`. The notify job's baseline doesn't exist yet, and when SYC-55 builds it, it seeds from current derived status on its first run (`email-capture.md` §5.3: "the job would simply re-seed and send nothing"), so this history is never news (§9.2, test §10.8.15). See Conflicts, C4.
- **How it's made:** `drizzle-kit generate --custom --name data_spine_backfill`, so it enters the journal and `migrate:check` accepts it. In production it runs through PR P's mechanism (under Q1 option A, as a recorded data step using the same SQL), which is why it must be safe to run twice.
- **Tests** (`lib/db/src/migrate/backfill.test.ts`, throwaway database): seeded cats, claims, registrations and care updates produce exactly the expected observations; running it where PR 2 already wrote a claim's `homed` or a care route's statement produces no duplicate; up–down–up leaves the same rows; every seeded cat's resolved status matches what its old flags said (homed ↔ `hasHome`, sterilised ↔ the `Desexed` badge).
- **Rollback block:** in one transaction, the table owner disables the observations append-only trigger, deletes the rows marked `backfill:data-spine`, and re-enables it. The block says this is the one sanctioned bypass and that it removes only these rows.

### PR 4 — The cat page shows derived status

- **API:** `Cat` and `CatDetail` gain `lifeStatus`, `notSeenSince` and `sterilised { value, confidence, clippedTipSightings }` (§10.7). `hasHome` becomes `lifeStatus === 'homed'`, derived, instead of `owner_device_id is not null`, so a team correction to Street is honoured, and deleting an owner (SYC-63) doesn't quietly unhome a cat. `GET /cats` and `GET /cats/:id` use `loadCatRecords` and `resolveCat` in one batch. **Request-duration logging** on both ships with the resolver, as §2.3 requires, so §12 risk 8's 200 ms trigger is observable.
- **Merged only after PR 3 has run in production.** Before the backfill, a claimed cat has no `homed` statement, and deriving `hasHome` would briefly strip every claimed cat of its home badge. One visible change is intended: a cat marked "adopted" through the old admin route, with no owner in the app, now shows "Has a home", which is what the team meant.
- **Fan-out:** `createUpdateAndFanOut` and `notifyCatSpotters` skip a cat whose resolved life status is deceased (§3.3). Follows are kept, so a sighting that clears the status resumes them.
- **App:** the cat page shows the life line and the sterilised line, in the copy above, where "Last seen" sits today. The `Desexed` badge, which reads `careTimeline` today (`app/cat/[id].tsx`), is replaced by the sterilised line. The "Has a home" filter keeps working through `hasHome`. `lastSeenAt` stays.
- **Files:** `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts` (the resolve response's `hasHome`), `lib/notificationFanout.ts`, `lib/notifications.ts`, `lib/api-spec/openapi.yaml` and the regenerated client and zod packages, `artifacts/cat-spotter/app/cat/[id].tsx`, `components/CatCard.tsx`, `lib/i18n.ts`.
- **Tests:** the API returns each life and sterilised state for seeded observations; a presumed-deceased cat's payload carries `notSeenSince` and never `deceased`; no push goes out for a cat with a live deceased statement; a claimed cat set back to Street by a later staff statement has `hasHome: false`; an app test renders each line in each language, with no "presumed" and no "No longer with us" for the presumed case.
- **Checked** at ~390 px and desktop, with data (a seeded cat in each state), before the PR opens.
- **Rollback:** revert. The fields are additive; old clients ignore them.

### PR 5 — Close the oracle

Step 5, owned by this plan. It ships before blurring, because blurring while this endpoint answers questions about exact positions is a promise that is already false (§11.2 step 5; F2, "not optional"). The claim half of step 5 is already done in PR 2.

- **What changes in `POST /sightings`** (`computeMatchCandidates`, which the dedupe-hit path also uses):
  1. Candidates are chosen by the distance between the **snapped** probe point and **snapped** cat positions, within **750 m**, ties broken on cat id. The vision model still re-ranks (§6.3.1). See Conflicts, C3, on SYC-39's 500 m.
  2. The limiter counts per **device**, after the secret check SYC-92 already added, not per IP. (Where the count is kept is SYC-105's; this PR keys it by device either way.)
  3. Candidates below the confidence threshold come back without `catId` and `name`, and the response never orders or annotates candidates by true distance (§6.3.3).
- **New:** `lib/blur.ts` (pure): `BLUR_CELL_METRES = 250`, `blurPosition`, `publicDistanceKm`, and a grid-origin offset derived by HMAC from a server secret, `BLUR_GRID_SECRET` (§6.2). The implementer adds the secret to the Replit deployment before deploying; the server refuses to start in production without it.
- **Files:** `routes/sightings.ts`, new `lib/blur.ts` and tests, `middlewares/rateLimit.ts`.
- **Tests:** §10.8.10: probing from a grid of coordinates with a known cat's photo returns a candidate set that doesn't change with sub-cell movement and doesn't reveal true-distance order. `blurPosition` is deterministic and idempotent and keeps every point in its cell. The per-device limit refuses the 21st request from one device, and not a second device on the same IP.
- **Assurance:** the probe test is mutation-checked (feed it exact coordinates; it must fail). An adversarial pass runs §6.3's bisection attack against the built endpoint.
- **Rollback:** revert, which reopens the oracle. Never revert it after PR 6 has shipped.

### PR 6 — Turn on blurring

Step 6. Server and app ship together with the cache version bump, so no phone keeps an exact payload.

- **Server:** one `serialiseCat(cat, viewer)` in `lib/catHelpers.ts`, and all four emitters go through it (§10.6): `listCatsWithStats`, `catPayload` in `routes/cats.ts`, the inline cat in the resolve response, and the sightings array in `GET /cats/:id`. The public payload has the cell centre, `locationPrecision: approximate`, `locationCellM: 250`, `distanceKm` from the cell centre rounded to 0.1, a stable sort with ties on id, last-seen as a date, and no sighting coordinates, notes, private feeding sites or device ids. The detail page gives an **authenticated owner** exact coordinates for their own cat (Option B, §10.6); the list is always public.
- **Pagination** of `GET /cats` (§2.3), loading each page's observations in one batch. It changes the list contract, so it ships here with the app and the cache bump, not in PR 4. The app walks every page in the background when it refreshes the offline cache (a few pages at today's size), so the catalogue still works without signal exactly as it does now.
- **App:** the catalogue cache key becomes `cats-cache/public/v2` (`hooks/useCatsWithCache.ts`). The map draws the 250 m cell with softened corners, labelled *"Somewhere in here"*, instead of a pin, and the cat page labels the position *"first spotted around here"* (§6.6, SYC-80). `BLUR_DISPLAY_RADIUS_METRES` is never introduced (retired, §6.2).
- **Depends on SYC-98**, for two reasons: photo ids in public payloads must be opaque before the coarse-timestamp claim is true (§6.4.4), and both change `photoUrl()` in `catHelpers.ts`.
- **Files:** `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts`, `openapi.yaml` and the generated packages, `hooks/useCatsWithCache.ts`, `components/AppMap.tsx`, `components/AppMap.web.tsx`, `app/(tabs)/cats.tsx`, `app/(tabs)/index.tsx`, `app/cat/[id].tsx`, `lib/i18n.ts`.
- **Tests:** §10.8.8 against all four emitters by name; §10.8.9 (a hundred requests from varied viewer positions return byte-identical geography); the old cache key is never read. (The public feeding-sites query filtering `is_public` in SQL, §10.5, is tested where SYC-43 builds that endpoint.)
- **Checked** at ~390 px and desktop, on native and web, with data, before the PR opens.
- **Assurance:** mutation probe (route one emitter around the serialiser; §10.8.8 must fail). Adversarial review hunting for a fifth emitter.
- **Rollback:** revert server and app together. A revert republishes exact positions, so it is Samuel's decision, not a routine rollback.

### PR 7 — The sighting questions and the note

Step 7: SYC-37 and SYC-74.

- **Timing, which the spec leaves open** (Conflicts, C5): the questions appear on the reward screen, after the points, and the points come back from resolve. So the answers go to a new device-authenticated `POST /sightings/{id}/answers`, accepted once per sighting, within 24 hours of its resolve, from the sighting's own device. Resolve stays exactly as it is.
- **What's written** (§10.7): `ear_tip` (`clipped_left | clipped_right | clipped_unsure | looks_whole | cant_tell`), `food_and_water` (`yes | no | cant_tell`) and `note` (≤ 500 characters), each its own observation with the sighting's `photoId` and `observedAt` = the sighting's capture time. `provenance: volunteered`, because in phase 1 the app pre-fills nothing; `prompted` arrives with pre-filled answers later (SYC-52).
- **When to ask:** the resolve response gains `askEarTip: boolean`, false after "Can't tell" from this device for this cat (§4.4) and otherwise as Samuel decides in Q3.
- **App** (`app/review.tsx`): the one-tap question with the required example photo (a clean clipped tip beside a torn ear, with its one-line explanation) and `Skip`; the food-and-water tap; and the optional note box, which says only Syros Cats see it. Nothing stands between a spotter and their points. The example photo is **SYC-79**'s, and this PR can't merge without it.
- **Likely before the correction path** (Conflicts, C6, and Q2): the public sterilised line shows *Likely* only once PR 8 is live, or as Samuel decides in Q2.
- **Tests:** answers from another device, a second set of answers, and answers after 24 hours are refused; a note never appears in any public payload (added to §10.8.8's list); "looks whole" moves nothing (rule 1, end to end); skipping writes nothing.
- **Checked** at ~390 px and desktop with a real resolve.
- **Rollback:** revert. Answers already stored stay valid observations.

### PR 8 — The correction path (team endpoints)

§4.5 and §3.5. The endpoints only; SYC-43's later parts build the screens.

- `POST /observations` (a team statement of life status or sterilised, with a reason); `POST /observations/{id}/supersede` (marks one observation wrong, with a reason, by writing a new one that points at it); `GET /observations/review/likely` (cats at *Likely* with their evidence photos, newest first).
- **Behind SYC-43 part 1's `requireTeam(capability)`** with `set_life_status` and `set_sterilisation` (`team-access-and-welfare-queue.md` §7.3). `roleAtTime: staff`, `accountId` = the person's `people.id`. The staff **"that's not a clip"** writes `ear_tip { clipped: false }` superseding the spotter's, which PR 1's rule 5 already handles.
- **Files:** new `routes/observations.ts` and tests; `openapi.yaml`.
- **Tests:** unauthenticated and wrong-capability requests are refused; superseding a missing or already-superseded observation is refused; after a staff "not a clip" the cat reads *Not known yet*; the review list holds only *Likely* cats.
- **Rollback:** revert. Statements already written stay, correctly attributed.

### PR 9 — Coarsen sighting pushes

§6.4.4: *"Agatha was spotted again!"* arriving within seconds gives anyone who once spotted a cat a minute-accurate feed of every later sighting of it. For cats the recipient doesn't own, the push becomes whatever Samuel chooses in Q4, and its text never carries a time. Owners keep live pushes about their own cat.

- **Files:** `lib/notificationFanout.ts`, plus a small scheduled sender if Q4 picks a daily round-up.
- **Tests:** a non-owner gets no push inside the window Q4 sets; an owner still does; no text contains a time.
- **Rollback:** revert to live pushes.

## Interfaces with the deletion and dashboard plans

**What SYC-63 (deletion) needs from this plan**, checked against its plan on `claude/syc-63-deletion-plan`:

- **Claims recorded as `homed` (PR 2, PR 3) and `hasHome` derived from life status (PR 4)**, before its build. Otherwise clearing a deleted owner's link flips the cat to "no home". Its plan says the same ("step 4 should land before this").
- **SYC-107 (in PR 2)** before its build, so no unchecked cat route can re-attach a deleted person's device id. Its plan names the same blocker.
- **Every observation kind this plan adds is severable by its SQL.** PR 2's and PR 7's rows are device-authored, and a `note`'s text is emptied by `value = '{}'` in SQL, which the step-1 trigger permits. No new kind stores personal text anywhere but `note`. (`system:` rows are never matched, per Part 2g.)
- **Its §5 migration and this plan's code agree on the sightings guard**: the only application update to `sightings` is resolve (pending → resolved, `cat_id` set once). PR 7 adds no sightings update; its answers are observations. Anything later that updates a sighting must change the guard on purpose.
- **PR P delivers its triggers and checks to production** (the same Replit problem applies to it).

**SYC-107 is covered inside this plan, in PR 2**, not as separate work: the claim secret check (step 5's claim half) and the registration and rename checks ship together there, ahead of PR 5 (step 5's oracle half). So "steps 4 and 5 before step 8", as SYC-63's plan asks, means PR 2, PR 3 and PR 4 before its build; PR 5 is not a prerequisite for deletion.

**The sightings append-only guard is SYC-63's**, in its migration (PR #21). This plan doesn't duplicate it; it only relies on it allowing resolve.

**What this plan needs from SYC-63:** nothing before PR 2. Its only shared prerequisite is SYC-111 (throwaway test database), which PR 2's tests need because observations can't be deleted between tests.

**What this plan needs from SYC-43 part 1:** `requireTeam(capability)` and `people.id` for PR 8. Nothing else here waits for it.

**What SYC-43's later parts need from this plan:** `writeObservation` (PR 2) for every correction and colony assignment; `resolveCat` for every status they show; PR 8's endpoints.

## How each step reaches production

**What we now know (SYC-102, verified read-only on 29 Sep).** The apptest production database is Replit-managed, separate from dev, and can't be reached from the workspace shell (there is only a read-only query tool). **When the app is published, Replit applies the structural difference between the dev and production databases itself.** Replit documents that as "adding and deleting columns or tables". Production has **no `drizzle` schema and no migration history**, and the same nine tables as dev. So `docs/DEPLOYMENT.md`'s "run `migrate` against production first" can't be done as written, and SYC-64's one-off "adopt the baseline on production" never happened.

Replit's publish step is documented to carry only some of what our migrations contain:

| What a step needs in production | Carried by Replit's publish diff? | Who needs it |
|---|---|---|
| New tables and new columns | Yes (documented) | Step 1's tables, if dev had them at publish; SYC-43 part 1's `people`; SYC-63's `cats` redaction columns |
| Relaxing NOT NULL | Not documented | SYC-63 §5 |
| CHECK constraints | Not documented | Step 1's attribution check; SYC-63 §5; SYC-43 part 1's email checks |
| Triggers and functions | Not documented | **Step 1's append-only guards**; SYC-63 §5's sightings guard |
| The migration history (`drizzle` schema) | No (verified absent) | Every step: the runner's "never twice, never out of order" guarantee |
| Data backfills | No: a diff compares structure, not rows | PR 3; SYC-101's folded names |
| The notify job's baseline seeding (F4) | No | SYC-55. This plan needs none (C4) |

**The consequence to take seriously now:** if step 1's tables reached production through the diff, they may have arrived **without their append-only triggers and without the attribution check**. Nothing writes observations yet, so nothing is wrong today. It becomes wrong the day PR 2 deploys. **So PR 2 and PR 3 are blocked on Q1 and PR P.**

**How the plan compensates**, whichever answer Q1 gets:

1. **Every step is written so it is safe to run more than once**: `CREATE OR REPLACE FUNCTION`, triggers created only if missing, constraints added only if missing, NOT NULL dropped (a no-op the second time), backfills guarded by "not already there". PR 3 is specified that way above; the same rule is passed to SYC-63 §5 and SYC-101.
2. **The app checks production's shape when it starts** (PR P), and refuses to write cat history if the guard that protects it is missing. That's the check that would have caught the 500 incident, and it's cheap.
3. **Verification after each publish is a probe, not an assumption**: the implementer uses the read-only query tool to confirm the triggers, constraints and backfilled rows exist, and records it in the PR.

## Data safety on the live test database

Testers are using apptest.catspotters.com now. In this plan only PR 3 touches live data (inserts into `observations`); PR P adds missing guards. Everything else is code.

**Before either, check the ground** (the implementer does this, not Samuel, with the read-only query tool):

1. What production actually has from step 1: the five tables, the attribution check, the three triggers, the three functions. Record the answer in PR P's description; it decides how much PR P has to add.
2. Confirm a restorable backup point exists (Replit's point-in-time restore or a dump) and record its time in the PR.
3. Run read-only counts the backfill will reproduce: cats, claimed cats, owner-registered cats, `cat_updates` by type. They go in PR 3's description, and PR 3's self-check must match them on production.

| Change | What it locks, and for how long | Why nothing is lost | If it goes wrong |
|---|---|---|---|
| PR P: add missing triggers and the attribution check | A brief lock per table to create each; the check validates existing rows (none in `observations` today) | Adds rules only; changes no row | Start-up logs the failure and refuses history writes; nothing else is affected. Revert and republish |
| PR 3: backfill | Row inserts into `observations` only; reads the rest | Append-only, idempotent, self-checking; nothing existing changes | The transaction raises and nothing lands, or the rollback removes exactly the `backfill:data-spine` rows |

**Order.** PR 3's code prerequisite (PR 2) must be **live in production** first, *then* its backfill runs, *then* PR 4 merges. `docs/DEPLOYMENT.md` §C's "migrate, deploy, smoke" is rewritten by PR P to match whatever Q1 decides.

**The Play clock (F6).** This plan adds **no schema change of its own**: PR 3 is data only, and PR P adds only what earlier migrations already defined. The remaining schema changes in the chain are SYC-43 part 1's, SYC-63 §5 and SYC-101's; all three should land before the closed test starts. The up–down–up against a copy of production (`docs/DEPLOYMENT.md` §C) is best run on SYC-63 §5, the first migration after `0001` with a meaningful rollback; how the copy is made depends on Q1.

## Parallelism

Migrations are serial by nature: one chain, in merge order, each regenerated if it lands behind another. Code PRs run in parallel where their files don't collide.

```
Migration chain (serial, numbers taken at merge):
  0002 SYC-98 (Chip E) → SYC-43 part 1 (PR #20, expected 0003) → SYC-63 deletion (PR #21) → SYC-101 → PR 3 (data)
  (the expected queue; whichever merges out of order regenerates its number)

Wave 1 (start now, in parallel):   PR 1 · SYC-111 · PR P (once Q1 is answered)
Wave 2:                            PR 2 (needs SYC-111, PR 1; deploys only after PR P is live)
Wave 3 (in parallel):              SYC-101 (after PR 2) · PR 5 · PR 4 built now, merged after PR 3 has run · PR 8 once SYC-43 part 1 lands
Wave 4:                            PR 3 (needs PR 2 live, SYC-101) → then PR 4 merges
Wave 5 (in parallel):              PR 6 (needs PR 4, PR 5, SYC-98) · PR 7 (needs PR 5, SYC-79, Q2, Q3) · SYC-63 build (needs PR 4)
Wave 6:                            PR 9 (needs PR 4, Q4)
```

| Pair | Together? | Why |
|---|---|---|
| PR 1, SYC-111, PR P | Yes | A new pure file, the API test setup, and the migrate folder plus the server's start-up |
| PR P and SYC-63 §5 | **Serial**: PR P first | SYC-63 §5's trigger is delivered to production by PR P's mechanism, and both touch `lib/db/src/migrate/` |
| PR 2 and SYC-101 | **Serial**: PR 2 first | Both change the naming code in `routes/cats.ts` and `routes/sightings.ts`; SYC-101 rebases and swaps its lookups to the folded column |
| PR 2 and SYC-63's build | Serial: PR 2 first | Both touch the three cat routes (SYC-107) |
| PR 4 and PR 5 | Yes | Different functions; both touch `routes/sightings.ts` (resolve's response vs matching), so expect a trivial rebase |
| PR 4 and PR 3 | Build together, merge PR 3 first | PR 3 is a migration file only; the order matters for testers, not for files |
| PR 6 and PR 7 | Yes, with a rebase | Both touch `routes/sightings.ts` and `openapi.yaml` |
| PR 6 and SYC-98 | **Serial**: SYC-98 first | Both change `photoUrl()` in `catHelpers.ts` |
| PR 6 and SYC-63's build | Yes | Both touch `catHelpers.ts`' discoverer fields and `lib/i18n.ts`; additive, expect a rebase |
| Anything and Chip E | Only PR 6 waits | None of this plan's PRs edit `photos` |

Each parallel builder gets **its own worktree**, never a shared one, and commits after each task.

## Model delegation

Planning ran on Opus (justified in the brief: the sequencing compounds). Building runs on the cheapest tier that can do each PR well. "Review" means a reviewer in its own worktree, on the tier named.

| Work package | Builds on | Why this tier | Assurance |
|---|---|---|---|
| PR P production delivery | **Opus** | Escalated: it decides whether production's safety rules exist at all, and its failures are silent (a missing trigger breaks nothing until someone rewrites history) | Tests on a diff-built throwaway database; **mutation probe** (skip one trigger; the start-up check must report it); read-only probe of production after the first publish; Sonnet adversarial review |
| PR 1 resolver and `foldName` | **Sonnet** | The rules are fully written down (§10.2 and the 14 named tests); the risk is in the tests, which are specified | Named tests; **mutation probe** on rules 1, 3 and 6; **Opus adversarial review** (escalation: a wrong confidence level looks exactly like a right one, and every later PR trusts this logic) |
| PR 2 write service and go-forward writes | **Sonnet** | Clear interfaces, routine route changes | Tests, including the query counter and the three secret checks; Sonnet review against §10.1 |
| PR 3 backfill | **Sonnet** | A short, well-specified SQL file | Its own self-check block; migration tests; up–down–up on a throwaway database seeded like production; **Opus review** of the idempotency guard (escalation: a duplicate or missing statement is silent and permanent) |
| PR 4 status on the cat page | **Sonnet**; translation strings on **Haiku** | Standard API and screen work; the strings are mechanical given the English | Tests; screenshots at ~390 px and desktop with seeded data; strings then go to SYC-4 for a native check |
| PR 5 oracle | **Opus** | Escalated: privacy-critical and adversarial by nature; the grid offset and candidate rules are easy to get subtly wrong | The probe test (§10.8.10), **mutation-checked**; an adversarial pass that actually runs the bisection attack |
| PR 6 blurring | **Sonnet** for server and app | Clear spec, several files | §10.8.8 and §10.8.9; **mutation probe** (bypass the serialiser once); **Opus adversarial review** hunting a fifth emitter (escalation: one missed emitter voids the whole promise); screenshots at both widths, native and web |
| PR 7 sighting questions | **Sonnet**; strings on **Haiku** | Standard endpoint and screen | Tests; a real resolve walked through in the browser pane at both widths |
| PR 8 correction endpoints | **Sonnet** | Straightforward once `requireTeam` exists | Tests; Sonnet review |
| PR 9 push coarsening | **Sonnet** | Small, once Q4 is answered | Tests; Sonnet review |
| Each PR's final adversarial review before merge (`/ship`) | **Opus** | The standing rule for PRs Claude built | As `/ship` defines |

**Every silent-failure guard in this plan, and where else it must hold**, so a reviewer checks the list rather than only the guard:

- *Never cross attributes / the ear-tip asymmetry:* the resolver (PR 1), and every reader, which is why there is one `resolveCat` that the cat page, the fan-out (PR 4), the notify job (SYC-55) and the dashboard (SYC-43) all call. No other code derives a status.
- *No exact coordinate in a public payload:* the four emitters (PR 6), the matching response (PR 5), notes (PR 7), feeding sites (SYC-43), and any future endpoint, which must go through `serialiseCat`.
- *Append-only:* `observations` and `cat_identity` (step 1, delivered to production by PR P), `sightings` (SYC-63 §5). Only PR 3's rollback bypasses it, and says so.
- *Attribution:* every writer goes through `writeObservation`; the three cat routes check the secret (PR 2); `system:` authors can't be borrowed (PR 2).

## Conflicts to resolve

Where the approved spec disagrees with the code, a ticket, another spec or another plan. None is resolved silently; each has a recommendation.

**C1 · SYC-75 asks for a sterilised status column on `cats`.** The spec, approved a day later, rejects status columns by name (§2) and derives sterilised from observations.
- *Options:* (a) follow the spec and point SYC-75 at this plan; (b) add the column as SYC-75 says.
- *Recommendation:* (a). The spec and DECISIONS.md win, and PR 1 and PR 4 deliver everything SYC-75 wants people to see.

**C2 · SYC-74 asks for the note and food-and-water to be columns on `sightings`, sent with the upload and carried through the offline queue.** The spec makes them observations written after resolve (§7, §10.7).
- *What a spotter notices:* following the spec, the questions come after the points, as designed, and need signal at that moment. Following the ticket, they'd come before matching, which puts a questionnaire in front of the points (§7: "the fastest way to kill this project").
- *Recommendation:* follow the spec. The small cost: answers typed with no signal on the reward screen aren't queued. Resolve already needs signal, so the spotter almost always has it seconds later.

**C3 · SYC-39 caps matching at 500 m; the spec widens the candidate radius to 750 m on the blurred grid** (§6.3), to make up for positions being snapped.
- *What a spotter notices:* nothing in practice. The vision model decides the match either way, and 750 m on snapped cells covers roughly what 500 m did on exact positions.
- *Recommendation:* 750 m on the grid (PR 5), and close SYC-39 as superseded by the spec.

**C4 · Who owns "what we last told people" about a cat.** The spine (§9.1) says it exposes a notified-status record; `email-capture.md` §5.3 says that table is the email job's own, written only by the job. DECISIONS.md Part 3 gives the job to `email-capture.md`.
- *Recommendation:* the email spec owns the table (SYC-55); this plan exposes only `resolveCat`. PR 3 seeds nothing, because the job seeds itself on first run and so never treats history as news.

**C5 · The spec sends the ear-tip answer with resolve, but the question appears on the screen that shows resolve's result** (the points).
- *Options:* (a) a separate "answers" call after the points (PR 7); (b) hold back resolve until the questions are answered, showing points the phone works out itself.
- *What a spotter notices:* (a) nothing; (b) a spot that isn't saved until they finish or skip the questions, and is lost if they close the app first.
- *Recommendation:* (a).

**C6 · A wrong *Likely* must be correctable from the day it can appear** (§4.3: the correction path "ships in the same change, not later"), **but the correction path needs team sign-in**, which SYC-43 part 1 hasn't built yet. See Q2.

**C7 · The plans disagree about migration slots.** SYC-63's plan says "SYC-43 holds `0002`"; SYC-98 (Chip E) actually holds `0002`, and SYC-43 part 1 takes the next free number. *Recommendation:* nobody hardcodes a number (as this plan now does); SYC-63's plan should drop "`0003` once SYC-43 takes `0002`" when it's next edited.

**C8 · SYC-63's plan says its §5 migration is written by "whoever holds the next slot"**, which leaves it without an owner. *Recommendation:* SYC-63's build owns it (it's step 8's schema), scheduled before the Play closed test; this plan's PR P delivers it to production. Samuel confirms when approving PR #21.

## Decisions for Samuel

Plain English, one at a time, each with a recommendation. Q1 is needed first; Q2 and Q3 before PR 7; Q4 before PR 9. (Whose name goes on statements the app writes by itself is already decided: Part 2g, "system:" authors.)

**Q1 · How do database changes reach the live app on Replit?** (Blocks PR P, PR 2 and PR 3, and the same question applies to SYC-43 part 1, SYC-63 and SYC-101.) When the app is published, Replit copies new tables and columns from the development database to the live one by itself. It doesn't promise to copy the safety rules built into the database (the rules that stop anyone quietly rewriting a cat's history), and it can't copy one-off data changes, like turning last season's "desexed" updates into records. Today the live database has no record of which changes it has had. If we do nothing, the first time the app writes a cat's history, the live copy may not have the rules that protect it.
- **Option A — the app finishes its own database changes when it starts.** Replit's publish copies tables and columns; then every time the app starts on the live server, it adds any missing safety rules, runs any one-off data changes it hasn't run yet, keeps its own record of what it has done, and refuses to write cat history if a safety rule is missing. *Benefits:* works with what Replit does today; no manual step; nobody needs access to the live database. *Risks:* two mechanisms (Replit's copy and the app's own) share the job, so each change has to cope with either having happened first; a slightly slower start while a data change runs (seconds at our size).
- **Option B — switch off Replit's copying, and let the app apply every change itself on start-up**, using the same history-keeping migrations dev already uses. *Benefits:* one mechanism, the one built and tested in SYC-64, with the same guarantees in dev and live. *Risks:* only possible if Replit lets us turn its copying off, which isn't documented; it needs confirming first, and if it can't be done, this option doesn't exist.
- **Option C — someone pastes each change into Replit's live database console by hand.** *Benefits:* no new code. *Risks:* relies on Samuel doing it correctly at the right moment on every release, which the working rules exist to avoid; easy to forget, and nothing records it.
- **Option D — move the live database off Replit's managed service** (for example to a hosted Postgres we can reach). *Benefits:* the standard tooling works as designed. *Risks:* reopens "everything stays on Replit" (D1) and the hosting question (SYC-47) in the middle of testing.
- **Recommendation: A now, and B if Replit confirms its copying can be switched off.** A works with what Replit is documented to do, and the start-up check means a missing safety rule is caught loudly rather than discovered later. If B turns out to be possible, move to it: one mechanism is simpler than two.

**Q2 · Should "Probably sterilised" show publicly before Syros Cats can correct it?** The ear-tip question can ship before the team dashboard does. When a tourist mistakes a torn ear for a clipped one, the cat would show "Probably sterilised" to everyone, and until the dashboard exists nobody at Syros Cats could fix it. A cat wrongly shown as probably done can be skipped for trapping and have a litter.
- **Option A — collect the answers now, show "Probably sterilised" only once the team can correct it.** Until then the public sees "Not known yet". Nothing is lost: the answers are stored, and those cats update the day the correction screen arrives. *Benefits:* every answer from the testing season is captured, with no uncorrectable wrong label. *Risks:* for a while the app knows more than it shows.
- **Option B — hold the whole question until the dashboard ships.** *Benefits:* simplest. *Risks:* loses the testing season's ear-tip answers, which can't be recovered later (the spotter has walked away).
- **Option C — show it now, and Claude corrects mistakes on request** (a team member sends a cat and a photo; Claude records the correction). *Benefits:* the label is live now. *Risks:* puts Claude in the loop for every correction, and relies on someone noticing.
- **Recommendation: A.**

**Q3 · Should a spotter be asked the ear-tip question every time they spot the same cat?** The spec says "Can't tell" stops the app asking that spotter about that cat again. It doesn't say what happens after "Yes, clipped" or "No, looks whole".
- **Option A — ask every time unless they said "Can't tell"** (the spec as written). *Benefits:* more independent looks at the ear, which strengthens the evidence. *Risks:* a regular who spots the same cat daily sees the same question daily.
- **Option B — ask once per spotter per cat, whatever they answered.** *Benefits:* never repetitive. *Risks:* fewer answers; a spotter who saw the right ear first is never asked again when they see the left.
- **Option C — ask again only after 30 days.** *Benefits:* fresh looks without nagging. *Risks:* one more rule to explain.
- **Recommendation: C.** It keeps the spec's "Can't tell" rule and adds a quiet period after any other answer.

**Q4 · How quickly should "Agatha was spotted again!" reach people who don't own the cat?** Today it arrives within seconds. That lets anyone who once spotted a cat follow, to the minute, when it's seen, and so when its feeder visits. The spec says these must be "batched or coarsened".
- **Option A — one round-up a day** ("Agatha and 2 other cats you follow were spotted today"), at a fixed evening hour. *Benefits:* closes the leak properly, and fewer pushes is kinder anyway. *Risks:* loses the instant "someone just saw her!" delight.
- **Option B — keep it live, but only the first sighting of each cat each day.** *Benefits:* keeps some immediacy. *Risks:* still tells a watcher the moment the cat was first seen each day, which is the feeding-time pattern the spec worries about.
- **Option C — a random delay of a few hours.** *Benefits:* feels close to live. *Risks:* delays average out over many days, so a patient watcher still learns the pattern.
- **Recommendation: A.** Owners still get instant pushes about their own cat.

## Review

An adversarial second pass over this plan, run deliberately after the first draft (a chip can't spawn a critic agent). It tried to refute each PR's order, safety and completeness against the spec, DECISIONS.md (including Part 2g, merged while this plan was written), the SYC-63 and SYC-43 part 1 plans, and the code on `origin/main` at `f8c362c`. Findings, and what changed:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| R1 | **PR 4 before PR 3 strips every claimed cat of its home badge.** Deriving `hasHome` from life status before the backfill has written any `homed` statement turns every claim into "no home" for testers. | High | PR 4 is built in parallel but merges only after PR 3 has run in production. |
| R2 | **The backfill can't call the folding function.** PR 3 is SQL; `foldName` is TypeScript. The first draft had PR 3 compute folded names. | High | PR 3 copies SYC-101's folded column; SYC-101's same problem is flagged. |
| R3 | **PR 3 would copy PR 2's own care-route statements a second time**, because "no equivalent observation" had no match key. | Medium | PR 2 sets `observedAt` to the `cat_updates` row's `created_at`, which PR 3 matches on. |
| R4 | **Append-only tables break the API tests**, which clean up by deleting against the shared dev database. | High | PR 2 is blocked on SYC-111 (throwaway test database). |
| R5 | **Production may already be missing step 1's safety rules** (SYC-102): Replit's publish copies tables and columns but isn't documented to copy triggers or checks, and production has no migration history. | High | "How each step reaches production", PR P and Q1; PR 2 and PR 3 blocked on them; the start-up check refuses history writes without the guard. |
| R6 | **The ear-tip answer can't travel with resolve** (C5): the question is on the screen resolve's response produces. | Medium | PR 7 adds a separate answers call. |
| R7 | **A wrong *Likely* could go public with no way to correct it** (C6). | High | Q2, recommending answers are collected now and *Likely* shown once correction exists. |
| R8 | **Rename and registration accept a forged device id**, and from PR 2 they write attributed statements. The spec names only the claim. | Medium | In PR 2; filed as **SYC-107** (SYC-63's plan now depends on it too). |
| R9 | **Paging the catalogue could quietly shrink the offline catalogue** to its first page. | Medium | PR 6: the app walks every page when refreshing the cache. |
| R10 | **The first draft planned deletion's schema and endpoint itself**, and named the `cats` columns `discoverer_redacted_at`, contradicting Part 2g (`cats.redacted_at` / `redaction_reason`) and duplicating SYC-63's plan. | Medium | Deletion is now SYC-63's, referenced with its interface points; the column names follow Part 2g. |
| R11 | **The first draft asked Samuel who authors app-written statements**, which Part 2g had already decided. | Low | Removed from the decisions; `system:legacy-backfill` and `system:admin-route` used throughout. |
| R12 | **Hardcoded migration numbers** would clash with SYC-43 part 1 and SYC-63. | Low | None hardcoded; C7 records the other plan's stale number. |
| R13 | **PR P's record of data steps would itself need a migration**, which production can't run. | Low | The record lives in the `drizzle` schema, created by the finish step. |
| R14 | **Deletion would miss a note written by PR 7** if notes were stored anywhere but `observations.value`. | Medium | PR 7 writes notes only as `note` observations; the interface section states it, and SYC-63's information-schema test would catch a second copy. |

**Checked, and holding:**

- *Every spec step has an owner:* step 2 (PR 1's test 13), 3 and 4 (PR 2, PR 3), 5 (PR 5, the claim in PR 2), 6 (PR 6), 7 (PR 7), 8 (SYC-63). §4.5 is PR 8; §6.4.4 is SYC-98 plus PR 9; §2.3's logging is PR 4.
- *Every §10.8 test has an owner:* 1–7 and 17 (PR 1, PR 4), 8–9 (PR 6), 10 (PR 5), 14 (SYC-63), 16 (SYC-101 and PR 1's `foldName` test). 11 and 12 are the import's (SYC-49). 13's spotter half already exists (`imageValidation.exif.test.ts`, SYC-65); its import half is SYC-49's. 15 is SYC-55's, and C4 explains why this plan's backfill can't trigger it.
- *DECISIONS.md:* D4's public negative is in the copy and PR 1 rule 3; F2's oracle fix precedes blurring; F3 is step 1 plus SYC-63; F4 (no death announcements) is PR 4's fan-out check and the global constraints; F6 holds because this plan adds no schema of its own; Part 2c's points are each reflected (claims homed, vets unreachable in phase 1, import optional, discovery position labelled, colony averaging not reopened, presumed deceased never "No longer with us"); Part 2g's three points are followed (folded names via SYC-101, deletion's nullable columns via SYC-63, `system:` authors).
- *Canonical facts:* €50–60, "cat guardian", "spotter" and "snapper", "Not seen since…", partial offline, and "absence of a clip is never negative evidence" are in the global constraints; no copy in this plan says otherwise.
- *Chip E:* nothing here edits `photos`; PR 6 waits for SYC-98 because both change `photoUrl()`.

**Left open, on purpose:** the spec's own open questions stay with their owners and block nothing here: the 250 m cell and the colony-averaging acceptance (Syros Cats, SYC-67), whether a public feeding site shows its exact position (Syros Cats; SYC-43 builds that endpoint), whether a cat guardian may mark a cat deceased (unreachable until SYC-53), and how long sighting notes are kept (Samuel with Syros Cats).
