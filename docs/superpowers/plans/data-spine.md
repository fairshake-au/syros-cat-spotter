# Data spine, steps 2–8: implementation plan (for approval)

**Spec:** `docs/specs/cat-record-data-spine.md` (approved 28 Sep 2026), its review `docs/specs/reviews/cat-record-data-spine-review.md`, and `docs/specs/DECISIONS.md`, which wins over every spec (Part 2c for the spine; D4, F2, F3, F4, F6). Sibling specs where they touch the spine: `team-access-and-welfare-queue.md`, `email-capture.md`, `hosting-and-photo-storage.md`, `offline-queue-on-web.md`.
**Linear:** SYC-40 (life status, presumed deceased), SYC-52 (the confidence engine this makes additive), with SYC-41 (blurring), SYC-63 (deletion), SYC-37 and SYC-74 (the sighting questions) and SYC-75 (the sterilised thin slice) delivered along the way.
**Builds on:** step 1, **done** in PR #17 (`1e88a97`, `docs/superpowers/plans/data-spine-step-1.md`): migration `0001_data_spine_tables` created `observations`, `cat_identity`, `colonies`, `colony_name_history`, `feeding_sites` and the `sightings` redaction columns, with the append-only triggers. This plan starts at §11.2 step 2 and does not re-plan step 1.
**Migration order:** Chip E's SYC-98 (`photos.public_id`) is `0002`. Every migration here comes after it. Numbers below are the expected order; the runner refuses a migration older than one already merged, so whichever lands second regenerates its number (`lib/db/migrations/README.md`).

**A note on format.** This is a plan for approval, so it carries no application code, schema or SQL. Each PR names its files, the interfaces the next PR relies on, the tests by name, and its rollback. The engineer building each PR writes the code test-first against those names.

## In plain English

Step 1 built the empty filing cabinet. This plan fills it and starts reading from it:

- **The rules** that turn a cat's statements into "Lives on the street", "Probably sterilised" or "Not seen since June 2024" are written and tested on their own first, with no database, because a wrong answer here looks exactly like a right one.
- **Everything the app already knows** is copied in once: cats marked desexed or adopted through the old admin route, claimed cats (now "Has a home", Samuel's 28 Sep decision), and each cat's current name.
- **The cat page starts saying** what the rules work out.
- **The location leak is closed before the blurring is switched on**, because blurring the map while the matching endpoint still answers questions about exact positions would be a promise that is already false.
- **Spotters get the two quick questions** (ear tip, food and water) and the private note after their points.
- **"Delete my data"** works from Settings, and removes the person but keeps the cat's history.

Nobody's spot flow gets slower, and nothing a tester has already done is lost.

## Scope

| In | Spec | Ticket |
|---|---|---|
| The resolver: life status, presumed deceased, sterilised ladder, never crossing attributes | §3, §4.1–4.3, §4.6, §10.2 | SYC-40, SYC-52 (phase-1 rules), SYC-75 |
| Writing observations: one service every writer uses, and the go-forward writes from claim, owner registration, the old admin care route and naming | §3.2, §10.1, §10.3, §11.2 step 4 | SYC-40, SYC-52 |
| Backfill of what exists (legacy care updates, claims, owner registrations, current names) | §11.2 steps 2–4 | SYC-40 |
| Showing derived status on the cat page, and stopping pushes about a cat the team has recorded as dead | §3.3, §3.5, §4.2, §10.7 | SYC-40, SYC-75 |
| Closing the nearest-cat oracle and securing the claim | §6.3, §10.6, §11.2 step 5 | SYC-41 |
| Turning on blurring: one serialiser, four emitters, pagination, cache v2, drawing the cell | §2.3, §6.2, §6.4, §6.5, §6.6 label, §6.7, §10.6, §10.7, §11.2 step 6 | SYC-41 |
| Coarsening sighting pushes | §6.4.4 | SYC-41 |
| The ear-tip and food-and-water questions and the private note | §4.4, §7, §11.2 step 7 | SYC-37, SYC-74 |
| The correction path: team statements, supersede, the *Likely* review list (endpoints only) | §3.5, §4.5, §10.7 | SYC-52 |
| Self-service deletion: the schema it needs, `DELETE /me`, the Settings action | §8, §11.2 step 8 | SYC-63 |
| The step-1 hand-offs: deletion's NOT NULL columns, a sightings append-only guard, an author for machine-written rows, the `redacted_at` value | step-1 plan, "Deferred on purpose" | SYC-63, SYC-52 |

**Out, with where it lives:**

- The staff dashboard screens that call the correction endpoints, show notes and food-and-water, manage colonies and feeding sites, and the staff deletion action: **SYC-43**. Team sign-in and the capability check the endpoints sit behind: **SYC-43 / SYC-83** (`team-access-and-welfare-queue.md` §2, §7).
- Writing `welfare_report` / `welfare_outcome` observations: **SYC-42**, through this plan's write service.
- Folding cat names for uniqueness: **SYC-101** (own migration). This plan supplies the shared folding function it needs (PR 1) and sequences its migration.
- The derived "where it's usually seen" position: **SYC-80**, deferred by Samuel. The map says "first spotted around here".
- Records import: **SYC-49 / SYC-82**, optional and post-MVP (`records-import.md`). The resolver takes an empty import list.
- The nightly notify job and its `notified_status` baseline: **SYC-55 / SYC-45** (`email-capture.md` §5.3). This plan exposes the resolved snapshot the job reads.
- Duplicate merge: **SYC-59**. Litters: **SYC-58**. Roles beyond staff (guardian, volunteer, vet): **SYC-53**, SYC-24.
- Photo retention (shrinking at 12 months): **SYC-81**. It must keep ear-tip and sterilisation evidence photos at full size, which it can find through `observations.photo_id` once PR 7 writes them.
- Opaque photo ids: **SYC-98** (Chip E, in flight). Blurring depends on it for the coarse-timestamp claim (§6.4.4).
- Owner-name remnants: **SYC-69**. PR 9 clears a deleted owner's name; the wider tidy-up stays there.
- Milestone dates: **SYC-73**, deferred by Samuel. This plan orders the work; it does not date it.

## Global constraints

Every PR's requirements include these.

- **Nobody edits a status.** Statements are appended to `observations`; status is derived on read (§2). No PR adds a status column to `cats`, whatever an older ticket says (see Conflicts, C1).
- **Absence of a visible clipped tip is never negative evidence.** No quantity of spotter "looks whole" or "can't tell" answers moves sterilised at all. Only a team member, a vet or an imported record can say "not sterilised" (§4.1).
- **A confirmed negative is shown publicly** (D4): *"Not sterilised — Syros Cats' records"*.
- **Presumed deceased is never announced.** The cat page says *"Not seen since June 2024"*, never "No longer with us" and never "presumed deceased". Only a live `deceased` statement reads *"No longer with us."* (Part 2c). No push and no email about a death, ever (F4).
- **Public copy** (§3.5, §4.2): *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, *"No longer with us"*, *"Not seen since {Month Year}"*; *"Sterilised — confirmed by Syros Cats"*, *"Probably sterilised — a clipped ear tip has been seen"*, *"Not sterilised — Syros Cats' records"*, *"Not known yet"*. "Clipped tip", never "notched"; usually the **left** ear. English, Greek and French, with the Greek and French checked under SYC-4.
- **Terms:** "spotter" and "snapper"; "cat guardian", never "colony carer". User-facing copy says "Syros Cats", not "the charity". Sterilisation costs Syros Cats **€50–60 per cat**.
- **Offline support is partial.** Photos, capture locations and map tiles work without signal and the spot queue syncs later. Nothing in this plan claims more.
- **Exact coordinates never reach the mobile app** (§6.5). Blurring happens server-side when the payload is built.
- **Migrations:** generated, reviewed, with a commented rollback block; all pending migrations run in one transaction with a 5 s lock timeout; no `CREATE INDEX CONCURRENTLY` (`lib/db/migrations/README.md`). Migrate production first, then deploy, then `smoke` (`docs/DEPLOYMENT.md` §C).
- **F6:** every schema change lands before the Google Play fourteen-day closed test starts. A data-only migration doesn't change what the testers' build talks to, but is still landed before it where possible.

## The sequence

Twelve PRs: one for test infrastructure, one schema migration and one data migration of this plan's own, SYC-101's migration (its own ticket, sequenced here), and eight code PRs. Each is independently mergeable and leaves main working. The order puts every schema change first (F6), then the rules, then the writes, then the reads, then what the public sees.

| # | PR | Spec step | Migration | Blocked by |
|---|---|---|---|---|
| 0 | API tests run on a throwaway database | — | none | — |
| 1 | The resolver and the name-folding function (pure) | §10.2, §10.3 | none | — |
| A | Deletion-ready schema and the sightings guard | step 8 (schema half) | `0003` | SYC-98's `0002` merged; PR 0 |
| — | SYC-101: fold cat names for uniqueness (own ticket) | §10.3 amended | `0004` | PR A merged; PR 1 (folding function) |
| 2 | One way to write an observation, and the go-forward writes | steps 2, 4 | none | PR 0, PR 1 |
| 3 | Backfill what already exists | steps 3, 4 | `0005` (data only) | PR 2 **deployed**; SYC-101 merged; decision Q1 |
| 4 | The cat page shows derived status | §3.5, §4.2, §10.7 | none | PR 2 |
| 5 | Close the oracle | step 5 | none | PR 2 |
| 6 | Turn on blurring | step 6 | none | PR 4, PR 5, SYC-98 |
| 7 | The sighting questions and the note | step 7 | none | PR 5; SYC-79 photos; decisions Q2, Q3 |
| 8 | The correction path (team endpoints) | §4.5 | none | PR 2; SYC-43's sign-in and capability check |
| 9 | "Delete my data" | step 8 | none | PR A, PR 4 |
| 10 | Coarsen sighting pushes | §6.4.4 | none | PR 4; decision Q4 |

Step 2 ("backfill life status") writes nothing, by design: a cat with no `life_status` observation resolves to Street (§11.2). It needs no PR; PR 1's test *"no observations resolves to street and unknown"* is its proof.

---

### PR 0 — API tests run on a throwaway database

**Why first.** The API tests share the Replit dev database and clean up by deleting their own `cats` and `sightings` rows (`sightings.resolve.test.ts`, `sightings.dedupe.test.ts`, `catHelpers.derived.test.ts` and four more). From PR 2 on they also write observations, which can't be deleted, and PR A makes `sightings` refuse deletes. Both break the current cleanup.

**What changes.** A vitest global setup in `artifacts/api-server` creates `api_test_<random>` on the `DATABASE_URL` server, runs the migrations into it (the same `migrateUp` the `lib/db` spine tests use), points `@workspace/db`'s pool at it, and drops it afterwards. `pretest` stops migrating the dev database. Per-test cleanup of append-only tables uses the step-1 pattern (the table owner disables the truncate trigger for the reset, then re-enables it) in one shared helper.

- **Files:** `artifacts/api-server/vitest.config.ts`, new `artifacts/api-server/src/test/globalSetup.ts` and `src/test/resetTables.ts`, `artifacts/api-server/package.json`, and `lib/db/src/index.ts` if the pool needs to be constructible from a URL.
- **Produces:** `resetTables(tables: string[])` for later PRs' tests.
- **Tests:** the existing API suite passes unchanged against the throwaway database; one new test asserts the suite is not connected to the database named in `DATABASE_URL`.
- **Rollback:** revert the PR. No data involved.

### PR 1 — The resolver and the name-folding function

Pure functions: no database, no I/O. This is where the design risk lives, so it carries the hard tests (§10.8).

- **Files:** new `artifacts/api-server/src/lib/resolve.ts` and `resolve.test.ts`; new `lib/db/src/fold.ts` and `fold.test.ts` (in `lib/db` because SYC-101's migration test and the API both use it).
- **Produces:**
  - `resolveLifeStatus(observations, evidenceOfLife, now)` and `resolveSterilised(observations, importRecords)` with exactly the §10.2 signatures and the `Resolved<T>` shape (`value`, `confidence`, `supportingObservationIds`, `conflicts`, `asOf`). `confidence` includes `reported`, unreachable in phase 1.
  - `evidenceOfLife` is an input, `{ at, source } | null`, computed by PR 2's loader. The resolver queries nothing.
  - `resolveCat(observations, evidenceOfLife, now)`, returning the snapshot §9.1 describes (sterilised level and value, life status, `presumedDeceased`, `notSeenSince`, and the date each was derived from). The cat page, the fan-out check and SYC-55's nightly job all read this one function.
  - `clippedTipCount(observations)` for the API's `clippedTipSightings`.
  - `foldName(name)`: NFC, case-folded, accents stripped, `ς` folded to `σ`. The folding `colonies.normalised_name` needs too.
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

### PR A — Deletion-ready schema, and a guard on sightings (migration `0003`)

All the schema deletion needs, landed early so F6 holds, while the deletion feature itself (PR 9) comes later. It resolves three of step 1's hand-offs.

- **Columns.**
  - `sightings.device_id` drops NOT NULL, with a CHECK that it is null only when `redacted_at` is set.
  - `cats.discoverer_device_id` drops NOT NULL, and `cats` gains `redacted_at` and `redaction_reason`, with the same CHECK. A redacted discoverer shows as *"a spotter"* (§8.3). `cats.owner_device_id` and `owner_name` are already nullable.
- **The sightings guard** (step 1: "sightings have no append-only guard yet"). A trigger that allows exactly what the app does today and what deletion needs, and refuses everything else:
  - insert, arriving unredacted;
  - resolve: `status` pending → resolved, setting `cat_id` from null, once;
  - redaction: stamping `redacted_at` and a reason, clearing `device_id`, nothing else;
  - no delete, no truncate.

  Before writing it, the implementer greps every `update(sightingsTable` and `delete(sightingsTable` in non-test code (today only the resolve in `routes/sightings.ts`) and lists them in the PR description. A new writer later has to change the trigger on purpose.
- **`redacted_at` is the database's clock** (step 1: "accepts any timestamp"). The observations function is replaced (`CREATE OR REPLACE`) so a first redaction must set `redacted_at = now()`, the transaction's own timestamp. Deletion sets it in SQL, never from the app, so step 1's worry about an app clock that is slightly off refusing real deletions doesn't arise. The same rule applies to the sightings and cats redaction.
- **Schema code:** `lib/db/src/schema/sightings.ts` and `cats.ts`. The CHECKs are declared in schema code so `migrate:check`'s comparison with `push` matches; the triggers live only in the SQL, as the README says.
- **Tests** (`lib/db/src/migrate/deletionSchema.test.ts`, on a throwaway database like `dataSpine.test.ts`): each allowed sightings update succeeds; resolving twice, changing `lat`, changing `cat_id` after resolve, delete and truncate are each refused; a sighting can't lose its device without being redacted; a redaction with a client-supplied past `redacted_at` is refused; step 1's re-run redaction still works.
- **Assurance:** mutation probe on the trigger's resolve branch (allow any `cat_id` change; *changing cat_id after resolve is refused* must fail).
- **Rollback block:** restores step 1's observations function, drops the sightings trigger and function, drops the cats columns and the CHECKs, and sets NOT NULL back. **Setting NOT NULL fails once any deletion has happened**, because a redacted row has a null device. The block says so: after the first real deletion, fix forward, never roll back.

### SYC-101 — Fold cat names (its own ticket, sequenced here)

Not in this plan's scope, but its migration sits in the same serial chain and PR 3 depends on it: PR 3's `name` observations record the folded name, and SYC-101's migration is where existing near-duplicates are found and listed for the team. It uses PR 1's `foldName`. Its ticket specifies the rest.

### PR 2 — One way to write an observation, and the go-forward writes

The single write path every later writer uses (this plan's PRs, SYC-42's welfare observations, SYC-43's dashboard), and the loader every reader uses.

- **Files:** new `artifacts/api-server/src/lib/observations.ts` and tests; `routes/cats.ts` (claim, owner registration, rename); `routes/notifications.ts` (the `OWNER_SECRET` care-update route); `routes/sightings.ts` (naming a new cat on resolve).
- **Produces:**
  - `writeObservation(tx, input)`: validates `kind` against the phase-1 vocabulary (`life_status`, `sterilised`, `ear_tip`, `food_and_water`, `note`, `name`, `colony`, `welfare_report`, `welfare_outcome`) and each kind's value shape (§10.1); enforces the attribution rule; applies the `observedAt` rule (public writes clamped to 30 days back with the existing `clampCaptureTime`, any past date for team, vet, import and legacy, the future refused everywhere, §10.1); refuses a `roleAtTime` of guardian, volunteer or vet, which are unreachable in phase 1 (§10.4); returns the row.
  - `loadCatRecords(catIds)`: one batched query for the observations of many cats, reading through `cat_identity` so a future merge needs no change here (§2.3: never one query per cat), and one batched query for each cat's evidence of life (newest resolved sighting, newest life-implying observation, the cat's `created_at`). Returns what PR 1's `resolveCat` takes.
  - `SYSTEM_AUTHORS`: the fixed author ids for machine-written rows, per decision Q1.
- **Go-forward writes**, each in the same transaction as the change it records:
  - **A claim** writes `life_status: homed` from the claiming device, `roleAtTime: public`, `authorityScope: owner_of_this_cat` (Part 2c).
  - **Owner registration** (`POST /cats`) writes the same at creation (§11.2 step 4).
  - **Naming** a new cat on resolve, **registering** one, and an owner's **rename** each write a `name` observation with the folded form, so no rename destroys an earlier name (§5, §10.3).
  - **The old admin care route** (`POST /cats/:catId/updates`, `OWNER_SECRET`): `desexed` also writes `sterilised: true`, and `adopted` writes `life_status: homed`, `roleAtTime: staff`, author per Q1. Without this, anything recorded through it before the dashboard exists would be missing from the record.
  - **The claim checks the device secret** (§10.6: "before the owner tier means anything at all"). The spec puts this in step 5, but from this PR on a claim changes what a cat's page says, so it moves here (Part 2c: "securing the claim endpoint therefore matters more").
- **Tests:** each go-forward write appears once with the right role, scope and provenance, and not at all when the request fails; a claim without the secret is refused and writes nothing; `writeObservation` refuses an unknown kind, a malformed value, a future date, a public date more than 30 days old and an unreachable role; `loadCatRecords` for 50 cats issues a fixed number of queries (asserted with a query counter).
- **Rollback:** revert. Observations already written stay (append-only), are true statements, and nothing reads them until PR 4.

### PR 3 — Backfill what already exists (migration `0005`, data only)

Steps 3 and 4. Everything the app knows today becomes a statement in the record, once.

- **What's written.**
  - Each `cat_updates` row of type `desexed` → `sterilised: true`; each `adopted` → `life_status: homed`. `provenance: legacy`, `roleAtTime: staff` (they came through the admin route), `observedAt` = the update's `created_at`, author per Q1.
  - Each cat with `owner_device_id` set → `life_status: homed` from that device, `authorityScope: owner_of_this_cat`, `provenance: legacy`. **`observedAt` = the cat's `created_at`**, because the claim date was never stored. That is the earliest the claim could have been, so the backfill never claims evidence of life later than we actually know it.
  - Each cat → one `name` observation with its current name and folded form, `provenance: legacy`, author per Q1, `observedAt` = the cat's `created_at`.
  - Every row carries `suggestion_source = 'backfill:0005'`, so the rollback finds exactly these rows. PR 2's validation refuses that value from any other writer.
- **Idempotent against the go-forward writes.** Each insert is guarded by "no equivalent observation exists yet", so a claim PR 2 already recorded isn't recorded twice. That is why PR 2 must be **deployed** before this migration runs: it closes the window in which a claim could happen after the backfill read the table and before the new code was live.
- **Self-checking.** The migration ends with a block that compares what it expected to write with what it wrote and raises if they differ, so a partial or wrong backfill rolls back the whole transaction instead of landing.
- **Notifications.** Nothing is sent: the SQL writes only to `observations`. The notify job's baseline doesn't exist yet, and when SYC-55 builds it, it seeds from current derived status on its first run (`email-capture.md` §5.3: "the job would simply re-seed and send nothing"), so this history is never news (§9.2, test §10.8.15). See Conflicts, C4.
- **How it's made:** `drizzle-kit generate --custom --name data_spine_backfill`, so it enters the journal and `migrate:check` accepts it.
- **Tests** (`lib/db/src/migrate/backfill.test.ts`, throwaway database): seeded cats, claims, registrations and care updates produce exactly the expected observations; running it where PR 2 already wrote a claim's `homed` produces no duplicate; up–down–up leaves the same rows; every seeded cat's resolved status matches what its old flags said (homed ↔ `hasHome`, sterilised ↔ the `Desexed` badge).
- **Rollback block:** in one transaction, the table owner disables the observations append-only trigger, deletes the rows marked `backfill:0005`, and re-enables it. The block says this is the one sanctioned bypass and that it removes only this migration's rows.

### PR 4 — The cat page shows derived status

- **API:** `Cat` and `CatDetail` gain `lifeStatus`, `notSeenSince` and `sterilised { value, confidence, clippedTipSightings }` (§10.7). `hasHome` becomes `lifeStatus === 'homed'`, derived, instead of `owner_device_id is not null`, so a team correction to Street is honoured and deleting an owner (PR 9) doesn't quietly unhome a cat. `GET /cats` and `GET /cats/:id` use `loadCatRecords` and `resolveCat` in one batch. **Request-duration logging** on both ships with the resolver, as §2.3 requires, so §12 risk 8's 200 ms trigger is observable.
- **Fan-out:** `createUpdateAndFanOut` and `notifyCatSpotters` skip a cat whose resolved life status is deceased (§3.3). Follows are kept, so a sighting that clears the status resumes them.
- **App:** the cat page shows the life line and the sterilised line, in the copy above, where "Last seen" sits today. The `Desexed` badge, which reads `careTimeline` today (`app/cat/[id].tsx`), is replaced by the sterilised line. The "Has a home" filter keeps working through `hasHome`. `lastSeenAt` stays.
- **Files:** `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts` (the resolve response's `hasHome`), `lib/notificationFanout.ts`, `lib/notifications.ts`, `lib/api-spec/openapi.yaml` and the regenerated client and zod packages, `artifacts/cat-spotter/app/cat/[id].tsx`, `components/CatCard.tsx`, `lib/i18n.ts`.
- **Tests:** the API returns each life and sterilised state for seeded observations; a presumed-deceased cat's payload carries `notSeenSince` and never `deceased`; no push goes out for a cat with a live deceased statement; a claimed cat set back to Street by a later staff statement has `hasHome: false`; an app test renders each line in each language, with no "presumed" and no "No longer with us" for the presumed case.
- **Checked** at ~390 px and desktop, with data (a seeded cat in each state), before the PR opens.
- **Rollback:** revert. The fields are additive; old clients ignore them.

### PR 5 — Close the oracle

Step 5. Ships before blurring, because blurring while this endpoint answers questions about exact positions is a promise that is already false (§11.2 step 5; F2, "not optional").

- **What changes in `POST /sightings`** (`computeMatchCandidates`, which the dedupe-hit path also uses):
  1. Candidates are chosen by the distance between the **snapped** probe point and **snapped** cat positions, within **750 m**, ties broken on cat id. The vision model still re-ranks (§6.3.1). See Conflicts, C3, on SYC-39's 500 m.
  2. The limiter counts per **device**, after the secret check SYC-92 already added, not per IP.
  3. Candidates below the confidence threshold come back without `catId` and `name`, and the response never orders or annotates candidates by true distance (§6.3.3).
- **New:** `lib/blur.ts` (pure): `BLUR_CELL_METRES = 250`, `blurPosition`, `publicDistanceKm`, and a grid-origin offset derived by HMAC from a server secret, `BLUR_GRID_SECRET` (§6.2). The implementer adds the secret to the Replit deployment before deploying; the server refuses to start in production without it.
- **Files:** `routes/sightings.ts`, new `lib/blur.ts` and tests, `middlewares/rateLimit.ts`.
- **Tests:** §10.8.10: probing from a grid of coordinates with a known cat's photo returns a candidate set that doesn't change with sub-cell movement and doesn't reveal true-distance order. `blurPosition` is deterministic and idempotent and keeps every point in its cell. The per-device limit refuses the 21st request from one device, and not a second device on the same IP.
- **Assurance:** the probe test is mutation-checked (feed it exact coordinates; it must fail). An adversarial pass runs §6.3's bisection attack against the built endpoint.
- **Rollback:** revert, which reopens the oracle. Never revert it after PR 6 has shipped.

### PR 6 — Turn on blurring

Step 6. Server and app ship together with the cache version bump, so no phone keeps an exact payload.

- **Server:** one `serialiseCat(cat, viewer)` in `lib/catHelpers.ts`, and all four emitters go through it (§10.6): `listCatsWithStats`, `catPayload` in `routes/cats.ts`, the inline cat in the resolve response, and the sightings array in `GET /cats/:id`. The public payload has the cell centre, `locationPrecision: approximate`, `locationCellM: 250`, `distanceKm` from the cell centre rounded to 0.1, a stable sort with ties on id, last-seen as a date, and no sighting coordinates, notes, private feeding sites or device ids. The detail page gives an **authenticated owner** exact coordinates for their own cat (Option B, §10.6); the list is always public.
- **Pagination** of `GET /cats` (§2.3), loading each page's observations in one batch. It changes the list contract, so it ships here with the app and the cache bump, not in PR 4.
- **App:** the catalogue cache key becomes `cats-cache/public/v2` (`hooks/useCatsWithCache.ts`). The map draws the 250 m cell with softened corners, labelled *"Somewhere in here"*, instead of a pin, and the cat page labels the position *"first spotted around here"* (§6.6, SYC-80). The list pages. `BLUR_DISPLAY_RADIUS_METRES` is never introduced (retired, §6.2).
- **Depends on SYC-98**, for two reasons: photo ids in public payloads must be opaque before the coarse-timestamp claim is true (§6.4.4), and both change `photoUrl()` in `catHelpers.ts`.
- **Files:** `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts`, `openapi.yaml` and the generated packages, `hooks/useCatsWithCache.ts`, `components/AppMap.tsx`, `components/AppMap.web.tsx`, `app/(tabs)/cats.tsx`, `app/(tabs)/index.tsx`, `app/cat/[id].tsx`, `lib/i18n.ts`.
- **Tests:** §10.8.8 against all four emitters by name; §10.8.9 (a hundred requests from varied viewer positions return byte-identical geography); the old cache key is never read. (The public feeding-sites query filtering `is_public` in SQL, §10.5, is SYC-43's, where that endpoint is built.)
- **Checked** at ~390 px and desktop, on native and web, with data, before the PR opens.
- **Assurance:** mutation probe (route one emitter around the serialiser; §10.8.8 must fail). Adversarial review hunting for a fifth emitter.
- **Rollback:** revert server and app together. A revert republishes exact positions, so it is Samuel's decision, not a routine rollback.

### PR 7 — The sighting questions and the note

Step 7: SYC-37 and SYC-74.

- **Timing, which the spec leaves open** (Conflicts, C5): the questions appear on the reward screen, after the points, and the points come back from resolve. So the answers go to a new device-authenticated `POST /sightings/{id}/answers`, accepted once per sighting, within 24 hours of its resolve, from the sighting's own device. Resolve stays exactly as it is.
- **What's written** (§10.7): `ear_tip` (`clipped_left | clipped_right | clipped_unsure | looks_whole | cant_tell`), `food_and_water` (`yes | no | cant_tell`) and `note` (≤ 500 characters), each its own observation with the sighting's `photoId` and `observedAt` = the sighting's capture time. `provenance: volunteered`, because in phase 1 the app pre-fills nothing; `prompted` arrives with pre-filled answers later (SYC-52).
- **"Can't tell" stops the app asking that spotter about that cat again** (§4.4): the resolve response gains `askEarTip: boolean`.
- **App** (`app/review.tsx`): the one-tap question with the required example photo (a clean clipped tip beside a torn ear, with its one-line explanation) and `Skip`; the food-and-water tap; and the optional note box, which says only Syros Cats see it. Nothing stands between a spotter and their points. The example photo is **SYC-79**'s, and this PR can't merge without it.
- **Likely before the correction path** (Conflicts, C6, and Q2): the public sterilised line shows *Likely* only once PR 8 is live, or as Samuel decides in Q2.
- **Tests:** answers from another device, a second set of answers, and answers after 24 hours are refused; a note never appears in any public payload (added to §10.8.8's list); "looks whole" moves nothing (rule 1, end to end); skipping writes nothing.
- **Checked** at ~390 px and desktop with a real resolve.
- **Rollback:** revert. Answers already stored stay valid observations.

### PR 8 — The correction path (team endpoints)

§4.5 and §3.5. The endpoints only; SYC-43 builds the screens.

- `POST /observations` (a team statement of life status or sterilised, with a reason); `POST /observations/{id}/supersede` (marks one observation wrong, with a reason, by writing a new one that points at it); `GET /observations/review/likely` (cats at *Likely* with their evidence photos, newest first).
- **Behind SYC-43's sign-in and capability check** (`set_life_status`, `set_sterilisation`, `team-access-and-welfare-queue.md` §7.3), with `roleAtTime: staff` and `accountId` = the person's id. The staff **"that's not a clip"** writes `ear_tip { clipped: false }` superseding the spotter's, which PR 1's rule 5 already handles.
- **Files:** new `routes/observations.ts` and tests; `openapi.yaml`.
- **Tests:** unauthenticated and wrong-capability requests are refused; superseding a missing or already-superseded observation is refused; after a staff "not a clip" the cat reads *Not known yet*; the review list holds only *Likely* cats.
- **Rollback:** revert. Statements already written stay, correctly attributed.

### PR 9 — "Delete my data"

Step 8, on PR A's schema. `email-capture.md` §6.3 is the copy of record for the confirmation screen.

- **`DELETE /me`**, device-authenticated. One synchronous transaction (§8.5), through one function, `deletePerson(deviceId, reason)`, which the staff action (SYC-43) and the email delete link (SYC-45) will call too:
  - **removed:** the device's `profiles`, `device_credentials`, `cat_subscriptions`, `notifications` and `push_tokens` rows;
  - **redacted and kept:** the device's `observations` (author cleared, a note's text emptied), its `sightings` (device cleared), and cats it discovered (discoverer cleared, shown as *"a spotter"*). On cats it owns, `owner_device_id`, `owner_name` and `home_description` are cleared. The cat stays homed, because its status comes from the now-anonymous `homed` observation (PR 4);
  - **untouched:** cat names (§8.4), sighting counts, derived statuses;
  - every stamp is `now()` in SQL (PR A).
  - When SYC-45's email tables arrive, they join this function, and the test below fails CI until they do.
- **App:** Settings gains **"Delete my data"** and the confirmation screen; on success the app clears its stored device id, secret, queue and caches and starts again as a new device.
- **Tests** (§10.8.14): after deletion, **a query over every text column of every table in `information_schema`** finds neither the device id, the nickname nor the username, so a table added later that holds a device id fails this test until deletion covers it; the cat's sighting count, derived statuses and name are unchanged; calling it twice is safe; a request without the secret is refused.
- **Assurance:** adversarial review of the privacy claim against §8.3's table, row by row, plus a mutation probe (skip one table; the information-schema test must fail).
- **Rollback:** revert the endpoint and the Settings action. Deletions already done are irreversible by design.

### PR 10 — Coarsen sighting pushes

§6.4.4: *"Agatha was spotted again!"* arriving within seconds gives anyone who once spotted a cat a minute-accurate feed of every later sighting of it. For cats the recipient doesn't own, the push becomes whatever Samuel chooses in Q4, and its text never carries a time. Owners keep live pushes about their own cat.

- **Files:** `lib/notificationFanout.ts`, plus a small scheduled sender if Q4 picks a daily round-up.
- **Tests:** a non-owner gets no push inside the window Q4 sets; an owner still does; no text contains a time.
- **Rollback:** revert to live pushes.
