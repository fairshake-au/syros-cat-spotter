# Data spine, steps 2–7: implementation plan (approved by Samuel, 2 Oct 2026)

**Refreshed 2 Oct 2026** against `origin/main` at `67701c9`, after the move to Neon (SYC-121, cutover 1 Oct 2026). The first draft (29 Sep) was written against `f8c362c`, when production was still Replit's own database. What changed, and why, is in the next section.

**Spec:** `docs/specs/cat-record-data-spine.md` (approved 28 Sep 2026), its review `docs/specs/reviews/cat-record-data-spine-review.md`, and `docs/specs/DECISIONS.md`, which wins over every spec (Part 2c for the spine; Part 2g for the step-1 follow-ups; **Part 2h** for the matching distance; **Part 2i** for choosing a different cat; D4, D7, F2, F3, F4, F6). Sibling specs where they touch the spine: `team-access-and-welfare-queue.md`, `email-capture.md`, `hosting-and-photo-storage.md`, `offline-queue-on-web.md`, `choose-a-different-cat.md`.
**Linear:** SYC-40 (life status, presumed deceased) and SYC-52 (the confidence engine this makes additive), delivering SYC-41 (blurring), SYC-37 and SYC-74 (the sighting questions) and SYC-75 (the sterilised thin slice) along the way.
**Builds on:** step 1, **done** in PR #17 (`docs/superpowers/plans/data-spine-step-1.md`): migration `0001_data_spine_tables` created `observations`, `cat_identity`, `colonies`, `colony_name_history`, `feeding_sites` and the `sightings` redaction columns, with the append-only triggers. **Confirmed in production on 2 Oct 2026** (Neon, read-only query): the four triggers and the attribution check are there, and `observations` is empty. This plan starts at §11.2 step 2.
**Owned by other plans, and only sequenced here:** step 8, deletion (**SYC-63**, `docs/superpowers/plans/syc-63-self-service-deletion.md`); staff sign-in (**SYC-43 part 1**, merged as #28); API tests on a throwaway database (**SYC-111**); the welfare report (**SYC-42**); choosing a different cat (**SYC-119**).

**A note on format.** This is a plan for approval, so it carries no application code, schema or SQL. Each PR names its files, the interfaces later PRs rely on, its tests by name, and its rollback. Whoever builds a PR writes the code test-first against those names.

## What changed since the 29 Sep draft

Each item was checked against the code on `main`, the merged pull requests, Linear, or the live database, and the evidence is named.

| What | Then | Now | Evidence |
|---|---|---|---|
| How database changes reach production | Through Replit's Publish, which could miss safety rules or empty a table, so the draft added **PR P** and asked **Q1** | The database is Neon (Frankfurt). Changes reach it **only through the `db-ops` workflow, before the publish that needs them**. Replit's Publish no longer touches the database. **PR P is withdrawn; Q1 is settled by the move** | SYC-121 cutover comment (1 Oct); `.github/workflows/db-ops.yml`; `docs/DEPLOYMENT.md` §C |
| SYC-107 (claim, register and rename trusting a device id without its secret) | Inside PR 2 | **Done**, merged in #41. Removed from PR 2 | `git log origin/main -S SYC-107` → `9385be2`; `routes/cats.ts` imports `verifyDeviceSecret` |
| Matching distance | PR 5 widened matching to 750 m on the blurred grid (conflict C3) | **Samuel decided on 30 Sep: exact positions, 500 m, kept after the spine lands** (DECISIONS Part 2h). Already live: `lib/candidateSelection.ts`, `MATCH_RADIUS_KM = 0.5`. PR 5 keeps it and adds only the other protections | #39; DECISIONS Part 2h; SYC-52 comment of 30 Sep |
| Opaque photo ids (SYC-98) | In flight; PR 6 waited for it | **Done**, merged in #24 (`0002_photos_public_id`) | #24; `lib/db/migrations/` |
| Staff sign-in and `requireTeam` (SYC-43 part 1) | Waiting for approval; PR 8 blocked on it | **Merged today** in #28 (`0003_people_and_staff_sign_in`). `requireTeam(capability)` exists, with `set_life_status` and `set_sterilisation`. **PR 8 can now be built** | `middlewares/requireTeam.ts`; `lib/capabilities.ts` |
| Migration numbers | `0002` taken; the rest "next free" | `main` has `0000`–`0003`. **Production has `0000`–`0002`**: `0003` is merged but not yet applied there. SYC-42 Slice 1 (#55, open) holds `0004`. This plan's first migration (PR 3) will be `0005` or later, and still takes the next free number when it merges | `lib/db/migrations/meta/_journal.json`; Neon `drizzle.__drizzle_migrations` (3 rows, 2 Oct); #55's file list |
| New writers of observations | — | SYC-119 will write a cat's coat colour as a `coat` observation authored `system:vision` (Part 2i). SYC-42 Slice 5 will write `welfare_report` authored by the reporter's device, or `system:welfare-report` if the device was deleted. PR 2 must accept both | `syc-119-choose-a-different-cat.md` Slice C; `syc-42-cat-in-trouble.md` 5.1 |
| SYC-63's sightings guard | "allows only pending → resolved" | Must also allow **pending → awaiting_team** and **awaiting_team → resolved** (SYC-119's "Ask Syros Cats to match it") | SYC-63 Linear comment, 30 Sep |
| What the backfill will find in production | Unknown | 28 cats, **12 claimed**, 35 care updates, **all of type `sighting`**: no `desexed` or `adopted` updates exist. So the backfill writes about 12 "has a home" statements and 28 names, and nothing about sterilisation | Neon read-only counts, 2 Oct |
| The name backfill | Part of PR 3, so PR 3 waited for SYC-101 (folded names, not started) | **Split out as PR 3b**, after SYC-101. PR 3 (homes and care updates) no longer waits for it, so the cat page, deletion and everything after stop depending on an unstarted ticket | This refresh's review, R23 |

## In plain English

Step 1 built the empty filing cabinet, and it's in the live database with its locks on. This plan fills it and starts reading from it:

- **The rules** that turn what people have said about a cat into "Lives on the street", "Probably sterilised" or "Not seen since June 2024" are written and tested on their own first, with no database, because a wrong answer here looks exactly like a right one.
- **Everything the app already knows** is copied in once: the 12 cats people have claimed become "Has a home" (Samuel's 28 Sep decision), and each cat's current name is recorded.
- **The cat page starts saying** what the rules work out, and the "Has a home" badge never flickers off while the copying happens.
- **Matching stays at 500 m** as Samuel decided, and gains its remaining protections before blurring is switched on.
- **The map is blurred** before the pre-launch pass comes off, so nobody outside the testers can find a cat's exact spot.
- **Spotters get the two quick questions** (ear tip, food and water) and the private note, after their points. Syros Cats staff get the endpoints to correct a wrong answer.

Database changes reach the live app the way every change now does: the `db-ops` workflow applies them to Neon, Claude checks them with a read-only query, and only then is the new app published. Nobody's spot flow gets slower, and nothing a tester has already done is lost.

## Scope

| In | Spec | Ticket |
|---|---|---|
| The resolver: life status, presumed deceased, the sterilised ladder, never crossing attributes | §3, §4.1–4.3, §4.6, §10.2 | SYC-40, SYC-52 (phase-1 rules), SYC-75 |
| One way to write an observation, used by every writer, and the go-forward writes from claim, owner registration, the old admin care route and naming | §3.2, §10.1, §10.3, §11.2 step 4 | SYC-40, SYC-52 |
| Backfill of what exists: claims and legacy care updates (PR 3), current names (PR 3b) | §11.2 steps 2–4 | SYC-40 |
| Showing derived status on the cat page; no pushes about a cat the team has recorded as dead | §3.3, §3.5, §4.2, §10.7 | SYC-40, SYC-75 |
| Hardening matching around the 500 m rule (per-device limit, confidence threshold, no distance ordering) | §6.3 points 2–3, as amended by Part 2h | SYC-41 |
| Turning on blurring: the grid, one serialiser for four emitters, pagination, a new cache key, drawing the cell | §2.3, §6.2, §6.4, §6.5, §6.6's label, §10.6, §10.7, §11.2 step 6 | SYC-41 |
| Coarsening sighting pushes | §6.4.4 | SYC-41 |
| The ear-tip and food-and-water questions and the private note | §4.4, §7, §11.2 step 7 | SYC-37, SYC-74 |
| The correction path: team statements, supersede, the *Likely* review list (endpoints only) | §3.5, §4.5, §10.7 | SYC-52 |

**Out, with where it lives:**

- **Deletion**, step 8: the `DELETE /me` endpoint, the Settings screen, the deletion schema migration and the sightings append-only guard. **SYC-63's plan.** The interface points are below.
- **The dashboard screens** that call the correction endpoints, show notes and food-and-water, manage colonies and feeding sites, the public feeding-sites endpoint and the staff deletion action (**SYC-43**, later parts). The workspace hand-off that lets staff actually reach the dashboard is **SYC-103**.
- API tests on a throwaway database: **SYC-111**.
- Writing `welfare_report` / `welfare_outcome` observations: **SYC-42 Slice 5**, through this plan's write service.
- Writing `coat` observations, and the colour backfill: **SYC-119 Slice C**, through this plan's write service.
- Folding cat names for uniqueness: **SYC-101** (Part 2g, own migration). This plan supplies the shared folding function (PR 1).
- The derived "where it's usually seen" position: **SYC-80**, deferred by Samuel. The map says "first spotted around here".
- Records import: **SYC-49 / SYC-82**, optional and post-MVP. The resolver takes an empty import list.
- The nightly notify job and its `notified_status` baseline: **SYC-55 / SYC-45** (`email-capture.md` §5.3). This plan exposes the resolved snapshot the job reads.
- Duplicate merge (**SYC-59**), litters (**SYC-58**), roles beyond staff (**SYC-53**, SYC-24).
- Photo retention: **SYC-81**. It keeps ear-tip and sterilisation evidence photos at full size, found through `observations.photo_id` once PR 7 writes them.
- Owner-name remnants (**SYC-69**), making claiming harder to do by mischief (**SYC-130**), and milestone dates (**SYC-73**, deferred by Samuel: this plan orders the work, it doesn't date it).

## Global constraints

Every PR's requirements include these.

- **Nobody edits a status.** Statements are appended to `observations`; status is derived on read (§2). No PR adds a status column to `cats`, whatever an older ticket says (Conflicts, C1).
- **Absence of a visible clipped tip is never negative evidence.** No quantity of spotter "looks whole" or "can't tell" answers moves sterilised at all. Only a team member, a vet or an imported record can say "not sterilised" (§4.1).
- **A confirmed negative is shown publicly** (D4): *"Not sterilised — Syros Cats' records"*.
- **Presumed deceased is never announced.** The cat page says *"Not seen since June 2024"*, never "No longer with us" and never "presumed deceased". Only a live `deceased` statement reads *"No longer with us."* (Part 2c). No push and no email about a death, ever (F4).
- **Public copy** (§3.5, §4.2): *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, *"No longer with us"*, *"Not seen since {Month Year}"*; *"Sterilised — confirmed by Syros Cats"*, *"Probably sterilised — a clipped ear tip has been seen"*, *"Not sterilised — Syros Cats' records"*, *"Not known yet"*. "Clipped tip", never "notched"; usually the **left** ear. English, Greek and French, with the Greek and French checked under SYC-4.
- **Terms:** "spotter" (never "snapper"); "cat guardian", never "colony carer". User-facing copy says "Syros Cats", not "the charity". Sterilisation costs Syros Cats **€50–60 per cat**.
- **Offline support is partial.** Photos, capture locations and map tiles work without signal and the spot queue syncs later. Nothing in this plan claims more.
- **Exact coordinates never reach the mobile app in a public payload** (§6.5). Blurring happens server-side when the payload is built. (Matching itself compares exact positions on the server, Part 2h; that is not a payload.)
- **App-written statements are authored `account_id = 'system:<source>'`** (Part 2g). The known sources: `system:legacy-backfill` (PR 3, PR 3b), `system:admin-route` (the old `OWNER_SECRET` route, PR 2), `system:vision` (SYC-119's coat colour) and `system:welfare-report` (SYC-42 Slice 5, a report whose reporter was deleted). Every row keeps exactly one author, and deletion never matches these.
- **Migrations:** generated, reviewed, with a commented rollback block; all pending migrations run in one transaction with a 5 s lock timeout; no `CREATE INDEX CONCURRENTLY`; numbers never hardcoded, the later one regenerates (`lib/db/migrations/README.md`).
- **Production rollout for anything with a migration** (`docs/DEPLOYMENT.md` §C, SYC-121 plan §A.4): merge → `db-ops` migrate on `development` → **`db-ops` migrate on `production`, before publishing the code that needs it** → Claude checks the history, the new objects and any backfilled rows with a **read-only Neon query** (not `-f command=verify`, which false-alarms once testers have written to Neon) → Samuel pulls in the EU Replit project and publishes → `db-ops` smoke. Take a Neon snapshot first when real data is affected (Neon's 7-day restore is the backstop).
- **Never approve a Replit database review.** After the move, Replit's Publish has nothing of ours to compare. If one ever appears, cancel it: something is pointing at Replit's own database (SYC-121 rule R3).
- **F6:** every schema change lands before the Google Play fourteen-day closed test starts.
- **Launch gate (SYC-113, done):** until launch, every `/api` route except `/api/healthz` sits behind a pre-launch pass. That pass comes off at launch (SYC-114), and from then on **anyone can read what `/api` returns**. So **PR 5 and PR 6 must be live in production before the pass is removed.** This gates the launch, not the merge. Until then the pass is the only thing keeping exact cat and sighting coordinates private.

## The sequence

This plan's own PRs are **1, 2, 3, 3b and 4–9**. (PR P is withdrawn; the numbers are kept so that the SYC-63, SYC-42 and SYC-119 plans, which cite them, stay correct.) The others in the table are owned elsewhere and appear because the order depends on them.

| # | PR | Spec step | Migration | Blocked by |
|---|---|---|---|---|
| — | SYC-111: API tests on a throwaway database | — | none | — (Backlog: **on the critical path, start now**) |
| — | SYC-43 part 1: `people`, staff sign-in, `requireTeam` | team-access §2, §7.3 | `0003`, **merged; production migrate pending** | — |
| — | SYC-42 Slice 1: welfare reports (#55) | — | `0004` if it merges next | its own review |
| — | SYC-63 §5: the deletion schema migration (nullable device columns, checks, index, **sightings guard**) | step 8, schema half | next free | SYC-111 |
| — | SYC-101: fold cat names | §10.3, Part 2g | next free | PR 1 (`foldName`); after PR 2 (shared files) |
| **1** | The resolver and the name-folding function (pure) | §10.2, §10.3 | none | — |
| **2** | One way to write an observation, and the go-forward writes | steps 2, 4 | none | SYC-111, PR 1 |
| **3** | Backfill claims and care updates | steps 3, 4 | next free (data only) | PR 2 **live in production** |
| **3b** | Backfill current names | step 4 | next free (data only) | PR 2 live; SYC-101's migration applied |
| **4** | The cat page shows derived status | §3.5, §4.2, §10.7 | none | PR 2; **merged only after PR 3 has run in production**, and gated in code |
| **5** | Harden matching (500 m kept) | step 5, as amended by Part 2h | none | — |
| **6** | Turn on blurring | step 6 | none | PR 4, PR 5 |
| **7** | The sighting questions and the note | step 7 | none | PR 2; **SYC-79's example photos**; decisions Q2, Q3; ships with #46 |
| **8** | The correction path (team endpoints) | §4.5 | none | PR 2 (SYC-43 part 1 is merged) |
| **9** | Coarsen sighting pushes | §6.4.4 | none | PR 4; decision Q4 |
| — | SYC-63 build: `DELETE /me` and "Delete my data" | step 8 | none | SYC-63 §5 migration; PR 2, PR 3, PR 4 |

Step 2 ("backfill life status") writes nothing, by design: a cat with no `life_status` observation resolves to Street (§11.2). It needs no PR; PR 1's test *"no observations resolves to street and unknown"* is its proof.

---

### PR 1 — The resolver and the name-folding function

Pure functions: no database, no I/O. This is where the design risk lives, so it carries the hard tests (§10.8).

- **Files:** new `artifacts/api-server/src/lib/resolve.ts` and `resolve.test.ts`; new `lib/db/src/fold.ts` and `fold.test.ts` (in `lib/db` because SYC-101 and the API both use it).
- **Produces:**
  - `resolveLifeStatus(observations, evidenceOfLife, now)` and `resolveSterilised(observations, importRecords)` with exactly the §10.2 signatures and the `Resolved<T>` shape (`value`, `confidence`, `supportingObservationIds`, `conflicts`, `asOf`). `confidence` includes `reported`, unreachable in phase 1.
  - `evidenceOfLife` is an input, `{ at, source } | null`, computed by PR 2's loader. The resolver queries nothing.
  - `resolveCat(observations, evidenceOfLife, now)`, returning the snapshot §9.1 describes (sterilised level and value, life status, `presumedDeceased`, `notSeenSince`, and the date each was derived from). The cat page, the fan-out check, SYC-55's nightly job, the dashboard and SYC-119's dead-cat guard all read this one function.
  - `clippedTipCount(observations)` for the API's `clippedTipSightings`.
  - `foldName(name)`: NFC, case-folded, accents stripped, `ς` folded to `σ` (Part 2g). The same folding `colonies.normalised_name` uses.
  - If SYC-119 Slice C has already shipped its small coat-colour rule ("a person beats the machine; among each, the newest wins"), PR 1 adopts it into `resolve.ts` unchanged; if not, Slice C adds it here.
- **Rules, as tests** (the names are the test titles):
  1. *ear-tip asymmetry: no number, authority or recency of spotter "looks whole" or "can't tell" answers moves sterilised* (§10.8.1). Its failure message says what it costs: a volunteer sent to trap a cat that was sterilised years ago.
  2. *a clipped tip reaches likely and never confirmed, whoever wrote it* (§10.8.2; §4.2 "never crosses attributes").
  3. *authoritative precedence, both directions*: import `true` 2024 then staff `false` 2026 → confirmed not sterilised; the same pair in the other date order → confirmed sterilised (§10.8.3, §4.6).
  4. *likely needs a photo*: a `clipped: true` with no `photoId` stays unknown (§4.2, review finding 22).
  5. *a team "that's not a clip" returns likely to unknown, never to a negative* (§10.8.4, §4.5).
  6. *a sighting after a deceased statement clears it in the same read*, returning street, with the disagreement in `conflicts` (§10.8.5, §3.2).
  7. *a cat created today with no sightings is not presumed deceased* (§10.8.6).
  8. *presumed deceased counts from when the photo was taken, not when it synced* (§10.8.7).
  9. *presumed deceased after 36 months of silence, and each kind of evidence of life resets it*: a resolved sighting, `life_status` street/homed/in care, `sterilised`, `ear_tip` and `welfare_report` do; `colony`, `note`, `name`, `food_and_water` and `coat` don't (§3.4, §10.5).
  10. *a live deceased statement suppresses presumed deceased*, and *a life_status newer than the last evidence of life suppresses it*.
  11. *superseded and redacted-value observations are ignored*.
  12. *welfare reports and outcomes move no derived status* (§10.8.17, the resolver half).
  13. *no observations resolves to street and unknown* (step 2).
  14. `foldName`: `ΜΙΜΗ` = `Μιμή` = NFD `Μιμή`; `ΣΟΦΊΑΣ` = `Σοφίας`; `Zoë` = `Zoe`.
- **Assurance beyond green:** a mutation probe on rules 1, 3 and 6 (flip the branch, confirm the named test fails, restore), because each guards a wrong-but-plausible answer.
- **Rollback:** revert. Nothing calls it yet.

### PR 2 — One way to write an observation, and the go-forward writes

The single write path every later writer uses (this plan's PRs, SYC-42 Slice 5, SYC-119 Slice C, the dashboard), and the loader every reader uses.

- **Files:** new `artifacts/api-server/src/lib/observations.ts` and tests; `routes/cats.ts` (claim, owner registration, rename); `routes/notifications.ts` (the `OWNER_SECRET` care-update route); `routes/sightings.ts` (naming a new cat on resolve).
- **Produces:**
  - `writeObservation(tx, input)`: validates `kind` against the phase-1 vocabulary (`life_status`, `sterilised`, `ear_tip`, `food_and_water`, `note`, `name`, `colony`, `welfare_report`, `welfare_outcome`, and **`coat`**, which Part 2i added) and each kind's value shape (§10.1); enforces one author; applies the `observedAt` rule (public writes clamped to 30 days back with the existing `clampCaptureTime`, any past date for team, vet, import and legacy, the future refused everywhere, §10.1); refuses a `roleAtTime` of guardian, volunteer or vet, unreachable in phase 1 (§10.4); refuses an `accountId` starting `system:` from any caller but the named system writers; returns the row. The `coat` value is SYC-119's (`choose-a-different-cat.md` §4.7, §8.4): one or two of its fixed eight colours, or "not sure", with the model version; `provenance: machine` is accepted only from `system:vision`. PR 2 validates exactly that and nothing more; the colour list itself is imported from SYC-119's code, not copied.
  - `loadCatRecords(catIds)`: one batched query for the observations of many cats, reading through `cat_identity` so a future merge needs no change here (§2.3: never one query per cat), and one batched query for each cat's evidence of life (newest resolved sighting, newest life-implying observation, the cat's `created_at`). **It deliberately leaves out §3.4's fourth source, a linked import record's operation date**, because the import is out of scope. SYC-49 / SYC-82 must add it when the import tables exist. Returns what PR 1's `resolveCat` takes. **(Amended after the PR #62 review, 3 Oct 2026, Samuel — B2/DECISIONS Part 2j):** `resolveCat`'s `evidenceOfLife` is now `{at, source, lastSightingAt}`, not `{at, source}` — `loadCatRecords` must separately compute and supply `lastSightingAt` (the cat's newest resolved sighting, specifically, regardless of what the overall newest evidence of life turns out to be), and must label `source` with the exported `EvidenceSource` const from `resolve.ts`, not an ad hoc string.
  - `SYSTEM_AUTHORS`: `system:legacy-backfill`, `system:admin-route`, `system:vision`, `system:welfare-report`. A new system writer adds its name here in its own PR.
- **Go-forward writes**, each in the same transaction as the change it records:
  - **A claim** writes `life_status: homed` from the claiming device, `roleAtTime: public`, `authorityScope: owner_of_this_cat` (Part 2c).
  - **Owner registration** (`POST /cats`) writes the same at creation (§11.2 step 4).
  - **Naming** a new cat on resolve, **registering** one, and an owner's **rename** each write a `name` observation with the folded form, so no rename destroys an earlier name (§5, §10.3).
  - **The old admin care route** (`POST /cats/:catId/updates`): `desexed` also writes `sterilised: true`, and `adopted` writes `life_status: homed`, `roleAtTime: staff`, author `system:admin-route`, with `observedAt` = the new `cat_updates` row's `created_at`, so PR 3 can recognise it and not copy it twice. Nothing in production has ever come through it (2 Oct: no `desexed` or `adopted` rows), and D7 retires it once staff sign-in is live (Conflicts, C13); this is cheap insurance for the meantime.
  - The device secret is **already** checked on claim, registration and rename (SYC-107, #41). PR 2 relies on it and adds a test that a refused request writes no observation.
- **Tests:** each go-forward write appears once with the right role, scope and provenance, and not at all when the request fails (including a 401/403 from the secret check); `writeObservation` refuses an unknown kind, a malformed value, a future date, an unreachable role and a borrowed `system:` author, **clamps** a public date more than 30 days old (3 Oct 2026, review of #66: this line previously said "refuses", contradicting both §10.1's last line and this section's own design prose above, which both say public writes are clamped by the existing capture-time rule), and accepts a well-formed `coat` from `system:vision`; `loadCatRecords` for 50 cats issues a fixed number of queries (asserted with a query counter).
- **Why it waits for SYC-111:** observations can't be deleted, and the API tests today clean up by deleting from a shared test database. PR 2 is the first API code that writes them.
- **Rollback:** revert. Observations already written stay (append-only), are true statements, and nothing reads them until PR 4.

### PR 3 — Backfill claims and care updates (next free migration number, data only)

Steps 3 and 4, for homes and sterilisation. Everything the app knows about these today becomes a statement in the record, once.

- **What's written.**
  - Each `cat_updates` row of type `desexed` → `sterilised: true`; each `adopted` → `life_status: homed`. `provenance: legacy`, `roleAtTime: staff` (they came through the admin route), `observedAt` = the update's `created_at`, author `system:legacy-backfill`. (Production has none today; the rule is kept for the development database and for anything recorded before PR 3 runs.)
  - Each cat with `owner_device_id` set → `life_status: homed` from that device, `authorityScope: owner_of_this_cat`, `provenance: legacy`. **`observedAt` = the cat's `created_at`**, because the claim date was never stored. That's the earliest the claim could have been, so the backfill never claims evidence of life later than we actually know it. (Production: 12 cats on 2 Oct.)
  - Every row carries `suggestion_source = 'backfill:data-spine'`, so the rollback finds exactly these rows. PR 2's validation refuses that value from any other writer.
- **Idempotent against the go-forward writes, with an explicit match key for each kind:**
  - *Care updates:* skip if a `sterilised` / `life_status` observation exists for that cat with `observedAt` equal to the `cat_updates` row's `created_at` (PR 2 writes exactly that).
  - *Claims:* skip if the cat has any `life_status: homed` observation from its `owner_device_id` with `authorityScope: owner_of_this_cat`.

  PR 2 must be **live in production** before this runs: it closes the window in which a claim or care update could happen after the backfill read the tables and before the new code was live.
- **Self-checking.** It ends with a block that compares what it expected to write with what it wrote and raises if they differ, so a partial or wrong backfill rolls back whole instead of landing.
- **Notifications.** Nothing is sent: it writes only to `observations`. The notify job's baseline doesn't exist yet, and when SYC-55 builds it, it seeds from current derived status on its first run (`email-capture.md` §5.3), so this history is never news (§9.2, test §10.8.15). See Conflicts, C4.
- **How it's made:** `drizzle-kit generate --custom --name data_spine_backfill`, so it enters the journal and `migrate:check` accepts it. It reaches production through `db-ops` migrate like any migration, and the runner's history records it once.
- **Tests** (`lib/db/src/migrate/backfill.test.ts`, throwaway database): seeded cats, claims, registrations and care updates produce exactly the expected observations; running it where PR 2 already wrote a claim's `homed` or a care route's statement produces no duplicate; up–down–up leaves the same rows; every seeded cat's resolved status matches what its old flags said (homed ↔ `hasHome`, sterilised ↔ the `Desexed` badge).
- **Rollback block:** in one transaction, the table owner disables the observations append-only trigger, deletes the rows marked `backfill:data-spine`, and re-enables it. The block says this is the one sanctioned bypass and that it removes only these rows. Applied with `db-ops -f command=migrate-rollback`, and only after the app code has been rolled back first (`docs/DEPLOYMENT.md` §C's order).

### PR 3b — Backfill current names (next free migration number, data only)

Step 4, for names. Split from PR 3 in this refresh so that the cat page doesn't wait for SYC-101 (R23).

- **What's written:** each cat → one `name` observation with its current name and folded form, `provenance: legacy`, author `system:legacy-backfill`, `observedAt` = the cat's `created_at`, `suggestion_source = 'backfill:data-spine-names'`.
- **The folded form is copied from the column SYC-101 adds to `cats`**, because a SQL migration can't call PR 1's TypeScript `foldName`. SYC-101 has the same problem filling that column: it needs either a SQL folding that a test proves matches `foldName` on the Greek and Latin cases, or a data step run from TypeScript. (Flagged on SYC-101.)
- **Match key:** **skip any cat that already has any `name` observation.** Such a cat was named or renamed after PR 2 went live. Writing its *current* name dated at `created_at` would backdate the rename, which §10.3 forbids.
- **Accepted gap (review of #94, 6 Oct 2026):** a cat created *before* PR 2 and renamed *after* it keeps only its rename. Its original name was never stored, so nothing can recover it, and the backfill doesn't invent it. Production had no name observations on 6 Oct 2026, so no cat has hit this. **Migrate PR 3b in the same `db-ops` run as SYC-101's migration** to keep the window shut.
- **Tests:** as PR 3's, plus *a cat renamed after PR 2 went live keeps both names in order, and gains no backdated name row*.
- **Nothing reads names from observations yet**, so PR 3b changes nothing anyone sees. It must land before the records import (SYC-49) or duplicate merge (SYC-59), which do.
- **Rollback block:** as PR 3's, for `backfill:data-spine-names` rows only.

### PR 4 — The cat page shows derived status

- **API:** `Cat` and `CatDetail` gain `lifeStatus`, `notSeenSince` and `sterilised { value, confidence, clippedTipSightings }` (§10.7). `hasHome` becomes `lifeStatus === 'homed'`, derived, instead of `owner_device_id is not null`, so a team correction to Street is honoured, and deleting an owner (SYC-63, which clears `owner_device_id`) doesn't quietly unhome a cat. `GET /cats` and `GET /cats/:id` use `loadCatRecords` and `resolveCat` in one batch. **Request-duration logging** on both ships with the resolver, as §2.3 requires, so §12 risk 8's 200 ms trigger is observable.
- **Merged only after PR 3 has run in production, and gated in code, not only by merge order.** Before the backfill, a claimed cat has no `homed` statement, and deriving `hasHome` would strip all 12 claimed cats of their home badge. So PR 4's derivation first checks that the runner's history (`drizzle.__drizzle_migrations`) records PR 3's migration as applied. That is the same record in production, development, CI and tests. Until it does, `hasHome` falls back to the legacy `owner_device_id is not null`, and the sterilised line falls back to the legacy `desexed` care update. The check is read once per process and re-read until it passes. Test: *with PR 3's step not recorded, a claimed cat with no `homed` observation still has `hasHome: true`; once it's recorded, `hasHome` follows life status.* One visible change is intended: a cat marked "adopted" through the old admin route, with no owner in the app, now shows "Has a home", which is what the team meant. (None exist in production.)
- **Fan-out:** `createUpdateAndFanOut` and `notifyCatSpotters` skip a cat whose resolved life status is deceased (§3.3). Follows are kept, so a sighting that clears the status resumes them.
- **SYC-119 hand-off (its Slice D), built in this PR's checklist if #52 (SYC-119 Slice A) has merged; otherwise SYC-119 adds it when it does:** the "find the cat yourself" picker greys out a cat recorded as deceased, and resolve refuses a hand pick of one with the same `NOT_NEARBY`-style refusal. A suggested match still clears the death (§3.2). Until the team can record a death (PR 8), this is a no-op, which is fine.
- **App:** the cat page shows the life line and the sterilised line, in the copy above, where "Last seen" sits today. The `Desexed` badge, which reads `careTimeline` today (`app/cat/[id].tsx`), is replaced by the sterilised line. The "Has a home" filter keeps working through `hasHome`. `lastSeenAt` stays.
- **Files:** `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts` (the resolve response's `hasHome`, the hand-pick guard), `lib/notificationFanout.ts`, `lib/notifications.ts`, `lib/api-spec/openapi.yaml` and the regenerated client and zod packages, `artifacts/cat-spotter/app/cat/[id].tsx`, `components/CatCard.tsx`, the picker component SYC-119 adds, `lib/i18n.ts`.
- **Tests:** the API returns each life and sterilised state for seeded observations; a presumed-deceased cat's payload carries `notSeenSince` and never `deceased`; no push goes out for a cat with a live deceased statement; a claimed cat set back to Street by a later staff statement has `hasHome: false`; a hand pick of a deceased cat is refused; an app test renders each line in each language, with no "presumed" and no "No longer with us" for the presumed case.
- **Checked** at ~390 px and desktop, with data (a seeded cat in each state), before the PR opens.
- **Rollback:** revert. The fields are additive; old clients ignore them.

### PR 5 — Harden matching (500 m kept)

Step 5, as Samuel amended it on 30 Sep (DECISIONS Part 2h). **Matching keeps comparing a new photo only with the cats within 500 m of it, on exact positions, up to ten, nearest first** — already live in `lib/candidateSelection.ts` (#39). This PR does **not** reintroduce grid-snapped selection. Samuel knowingly accepted that a determined person can still narrow down a cat's position by repeated probing; this PR adds the other two protections §6.3 still requires, which make that slow and noisy.

- **What changes in `POST /sightings`** (`computeMatchCandidates`, which the dedupe-hit path also uses):
  1. **The limiter counts per device**, after the device-secret check SYC-92 already added, not per IP address (today: 20 per 15 minutes per IP). Where the count is kept is SYC-105's; this PR keys it by device either way.
  2. **Candidates below the confidence threshold come back without `catId` and `name`.** Today only a 0.1 noise floor applies.
  3. **The response never orders or labels candidates by true distance**: ordered by confidence, ties broken by cat id (§6.3.3; Part 2h).
- **Files:** `routes/sightings.ts`, `lib/candidateSelection.ts` (only to keep its output out of the response order), `middlewares/rateLimit.ts`.
- **Tests:** a cat 499 m away is a candidate and one 501 m away isn't (the existing radius tests, kept); the per-device limit refuses the 21st request from one device and not a second device on the same IP; a low-confidence candidate has no id or name; two candidates with equal confidence come back in cat-id order whatever their distances.
- **Assurance:** mutation probes (order by distance: the tie test must fail; drop the threshold: the id/name test must fail). An adversarial pass tries to recover a cat's position from the response alone and records how many requests it needs under the per-device limit.
- **Rollback:** revert, which returns to per-IP limiting and the 0.1 floor. Never revert it after PR 6 has shipped without Samuel's say-so.

### PR 6 — Turn on blurring

Step 6. Server and app ship together with a new cache key, so no phone keeps an exact payload.

- **New:** `lib/blur.ts` (pure): `BLUR_CELL_METRES = 250`, `blurPosition`, `publicDistanceKm`, and a grid-origin offset derived by HMAC from a server secret, `BLUR_GRID_SECRET` (§6.2). *(Amended by Samuel, 6 Oct 2026, on the adversarial review of #95: the secret offset is dropped. Every published point is a cell centre, so any one of them gives the offset away; it protected nothing and made the server refuse to start without it. The grid is lib/geo's public one, and the guarantee is "somewhere in this 250 m square".)* (This moved here from PR 5, which no longer snaps anything.) The secret goes into the EU Replit project's deployment secrets before the publish; the server refuses to start in production without it. Claude generates the value and puts it on the clipboard; Samuel pastes it into Replit's Secrets pane, the one step that needs his login.
- **Server:** one `serialiseCat(cat, viewer)` in `lib/catHelpers.ts`, and all four emitters go through it (§10.6): `listCatsWithStats`, `catPayload` in `routes/cats.ts`, the inline cat in the resolve response, and the sightings array in `GET /cats/:id`. The public payload has the cell centre, `locationPrecision: approximate`, `locationCellM: 250`, `distanceKm` from the cell centre rounded to 0.1, a stable sort with ties on id, last-seen as a date, and no sighting coordinates, notes, private feeding sites or device ids. The detail page gives an **authenticated owner** exact coordinates for their own cat (Option B, §10.6); the list is always public.
- **SYC-119 hand-off (on SYC-41), if #52 has merged by then:** `lib/geo`'s `publishedPosition(cat)` snaps to a public-origin 250 m grid today, because the phone can't know the server's secret offset. In this PR it switches to the payload's cell centre as-is, without snapping again; SYC-119's tests 2, 24 and 25 and their mutation probe re-run here.
- **Pagination** of `GET /cats` (§2.3), loading each page's observations in one batch. It changes the list contract, so it ships here with the app and the new cache key. The app walks every page in the background when it refreshes the offline cache, so the catalogue still works without signal exactly as it does now.
- **App:** the catalogue cache key changes from `cat-spotter/cats-cache` to a new key no earlier build used (SYC-119 Slice C may change it first; PR 6 takes the next one) in `hooks/useCatsWithCache.ts`. The map draws the 250 m cell with softened corners, labelled *"Somewhere in here"*, instead of a pin, and the cat page labels the position *"first spotted around here"* (§6.6, SYC-80). `BLUR_DISPLAY_RADIUS_METRES` is never introduced (retired, §6.2).
- **SYC-98 is done** (#24), so photo ids in public payloads are already opaque, which the coarse-timestamp promise needs (§6.4.4).
- **Files:** `lib/blur.ts` and tests, `lib/catHelpers.ts`, `routes/cats.ts`, `routes/sightings.ts`, `openapi.yaml` and the generated packages, `lib/geo` (`publishedPosition`), `hooks/useCatsWithCache.ts`, `components/AppMap.tsx`, `components/AppMap.web.tsx`, `app/(tabs)/cats.tsx`, `app/(tabs)/index.tsx`, `app/cat/[id].tsx`, `lib/i18n.ts`.
- **Tests:** `blurPosition` is deterministic and idempotent and keeps every point in its cell; §10.8.8 against all four emitters by name; §10.8.9 (a hundred requests from varied viewer positions return byte-identical geography); the old cache key is never read; SYC-119's 2, 24, 25. (The public feeding-sites query filtering `is_public` in SQL, §10.5, is tested where SYC-43 builds that endpoint.)
- **Checked** at ~390 px and desktop, on native and web, with data, before the PR opens.
- **Assurance:** mutation probe (route one emitter around the serialiser; §10.8.8 must fail). Adversarial review hunting for a fifth emitter, including anything SYC-42 or SYC-119 added since this plan was written.
- **Rollback:** revert server and app together. A revert republishes exact positions, so it is Samuel's decision, not a routine rollback.

### PR 7 — The sighting questions and the note

Step 7: SYC-37 and SYC-74. **Ships together with #46** (SYC-117 part 1 and SYC-118: "Retake photo" and the "New spot" wording), as Samuel decided on 30 Sep: the spot flow changes once, as one piece. Build on #46's branch, and make the "New spot" wording set up the questions that now follow matching.

- **Timing, which the spec leaves open** (Conflicts, C5): the questions appear on the reward screen, after the points, and the points come back from resolve. So the answers go to a new device-authenticated `POST /sightings/{id}/answers`, accepted once per sighting, within 24 hours of its resolve, from the sighting's own device. Resolve stays exactly as it is.
- **What's written** (§10.7): `ear_tip` (`clipped_left | clipped_right | clipped_unsure | looks_whole | cant_tell`), `food_and_water` (`yes | no | cant_tell`) and `note` (≤ 500 characters), each its own observation through `writeObservation`, with the sighting's `photoId` and `observedAt` = the sighting's capture time. `provenance: volunteered`, because in phase 1 the app pre-fills nothing.
- **When to ask:** the resolve response gains `askEarTip: boolean`, false after **any** ear-tip answer ("Clipped", "Looks whole" or "Can't tell") from this device for this cat, so each spotter is asked once per cat (Q3, decided B by Samuel, 2 Oct 2026; confirmed after an earlier record said A).
- **App** (`app/review.tsx`): the one-tap question with the required example photo (a clean clipped tip beside a torn ear, with its one-line explanation) and `Skip`; the food-and-water tap; and the optional note box, which says only Syros Cats see it. Nothing stands between a spotter and their points. **The example photo is SYC-79's, still outstanding (Backlog, 2 Oct), and this PR can't merge without it.** *(Amended by Samuel, 5 Oct 2026: ship without waiting. Until Syros Cats' photo arrives the question shows its written explanation only, with no placeholder; the photo is added later in `lib/earTipExample.ts` with no other change.)*
- **Likely before the correction path** (Conflicts, C6, and Q2): the public sterilised line shows *Likely* only once Syros Cats can correct it (Q2, decided A).
- **SYC-119 hand-off (its Slice D, needs its Slice B):** a "clipped" answer on a sighting the server recorded as a hand pick is sorted first in PR 8's *Likely* list and marked *matched by hand*.
- **Tests:** answers from another device, a second set of answers, and answers after 24 hours are refused; a note never appears in any public payload (added to §10.8.8's list); "looks whole" moves nothing (rule 1, end to end); skipping writes nothing; no sightings row is updated (SYC-63's guard).
- **Checked** at ~390 px and desktop with a real resolve.
- **Rollback:** revert. Answers already stored stay valid observations.

### PR 8 — The correction path (team endpoints)

§4.5 and §3.5. The endpoints only; SYC-43's later parts build the screens.

- `POST /observations` (a team statement of life status or sterilised, with a reason); `POST /observations/{id}/supersede` (marks one observation wrong, with a reason, by writing a new one that points at it); `GET /observations/review/likely` (cats at *Likely* with their evidence photos, newest first; hand picks first once SYC-119 Slice B exists).
- **Behind `requireTeam(capability)`** (merged in #28) with `set_life_status` and `set_sterilisation`, both already in `lib/capabilities.ts`. `roleAtTime: staff`, `accountId` = the person's `people.id`. The staff **"that's not a clip"** writes `ear_tip { clipped: false }` superseding the spotter's, which PR 1's rule 5 already handles. This is also how Syros Cats records a cat's death, which they asked for in the 29 Sep testing call (SYC-40 comment).
- **Can be built now.** For staff to *use* it, three more things must be live: `0003` applied to production, the workspace hand-off (SYC-103), and a screen (SYC-43). Until then it is reachable only by tests.
- **Files:** new `routes/observations.ts` and tests; `openapi.yaml`.
- **Tests:** unauthenticated and wrong-capability requests are refused; superseding a missing or already-superseded observation is refused; after a staff "not a clip" the cat reads *Not known yet*; after a staff `deceased`, the cat reads *No longer with us* and no push goes out; the review list holds only *Likely* cats.
- **Rollback:** revert. Statements already written stay, correctly attributed.

### PR 9 — Coarsen sighting pushes

§6.4.4: *"Agatha was spotted again!"* arriving within seconds gives anyone who once spotted a cat a minute-accurate feed of every later sighting of it. For cats the recipient doesn't own, the push becomes one daily round-up (Q4, decided A), and its text never carries a time. Owners keep live pushes about their own cat.

- **Files:** `lib/notificationFanout.ts`, plus a small scheduled sender if Q4 picks a daily round-up.
- **Tests:** a non-owner gets no push inside the window Q4 sets; an owner still does; no text contains a time.
- **Rollback:** revert to live pushes.

## Interfaces with other plans

**What SYC-63 (deletion) needs from this plan.** Its plan was approved by Samuel on 29 Sep (Linear), though the file on `main` still says "awaiting approval" (Conflicts, C9).

- **Claims recorded as `homed` (PR 2, PR 3) and `hasHome` derived from life status (PR 4), before its build.** Samuel chose (flag 5, option b) that deletion clears `cats.owner_device_id`; without PR 4, that flips a deleted owner's cat to "no home".
- **SYC-107 is done** (#41), so no unchecked cat route can re-attach a deleted person's device id.
- **So SYC-63's build waits for PR 2, PR 3 and PR 4.** Its schema migration (§5) waits for none of them, only for SYC-111.
- **Every observation kind this plan adds is severable by its SQL.** PR 2's and PR 7's rows are device-authored, and a `note`'s text is emptied by `value = '{}'` in SQL, which the step-1 trigger permits. No new kind stores personal text anywhere but `note`. (`system:` rows are never matched, per Part 2g.)
- **The sightings guard is SYC-63's**, in its §5 migration. From this plan it needs only resolve (pending → resolved, `cat_id` set once) and redaction. PR 7 adds no sightings update; its answers are observations. **It must also allow pending → awaiting_team and awaiting_team → resolved** for SYC-119's "Ask Syros Cats to match it" (Conflicts, C10). Moving a sighting to another cat (SYC-150) will need its own deliberate change later.
- **Welfare reports:** deletion clears `welfare_reports.reporter_device` and keeps the report and its photo as the cat's history (SYC-42 plan; SYC-63 comment of 30 Sep). Whichever of SYC-63's build or SYC-42 Slice 1 lands second adds the clearing and its test. Once SYC-42 Slice 5 has written a `welfare_report` observation, that row is device-authored and is severed like any other.

**What this plan needs from SYC-63:** nothing. Its only shared prerequisite is SYC-111, which PR 2's tests need too.

**SYC-43 part 1 (merged):** PR 8 uses `requireTeam(capability)` and `people.id`. Nothing else here waits for it.

**What SYC-43's later parts need from this plan:** `writeObservation` (PR 2) for every correction and colony assignment; `resolveCat` for every status they show; PR 8's endpoints.

**SYC-42 (welfare):** Slice 5 (tying a report to a cat) needs PR 2 live; it writes `welfare_report` (reporter's device, or `system:welfare-report`) and `welfare_outcome` (staff account), and neither moves a derived status (PR 1 rule 12). Slices 0–4 need nothing from this plan.

**SYC-119 (choose a different cat):** Slice C needs PR 2 for `coat` observations; Slice D rides inside PR 4 (dead-cat guard), PR 6 (`publishedPosition`) and PR 7/PR 8 (hand-picked clipped answers first). Slice E2 needs SYC-63's guard to allow `awaiting_team`.

**SYC-3 (keep my spots safe):** moving a spotter to a new phone keeps their device id and swaps its secret, so device-authored observations stay theirs with no re-keying. Nothing to build here.

## How each step reaches production

The move to Neon settled this. Everything below is the route `docs/DEPLOYMENT.md` §C and the SYC-121 plan §A.4 already describe; this plan adds nothing to it.

1. Merge.
2. `gh workflow run db-ops.yml --ref main -f target=development -f command=migrate`.
3. For anything that touches real data (PR 3, PR 3b): take a Neon snapshot of `production` and record its name in the PR.
4. `gh workflow run db-ops.yml --ref main -f target=production -f command=migrate`, **before** publishing the code that needs it. The runner applies every pending migration in one transaction, triggers and data steps included, with a 5 s lock timeout.
5. Claude checks with a read-only Neon query: the migration history matches the journal, and the new objects or backfilled rows are there. For PR 3, the counts match the ones recorded in the PR (12 claimed cats on 2 Oct, plus any since).
6. Samuel pulls `main` in the EU Replit project and publishes. A Replit database review should never appear; if one does, cancel it.
7. `db-ops -f command=smoke`.

**If smoke fails:** republish the previous build first, then `migrate-rollback`. New code on the old schema is the one broken combination; old code on the new schema is fine.

**Code-only PRs** (1, 2, 4–9) skip steps 2–5.

**What's in production today** (read-only query, 2 Oct): migrations `0000`–`0002` in the history; `0003` (staff sign-in) is merged but not yet applied. The observations and `cat_identity` triggers (four) and `observations_attribution_ck` are present. `observations` is empty. 28 cats, 12 claimed; 35 care updates, all `sighting`.

**Launch gate:** whoever removes the `/api` pre-launch pass (SYC-114) first checks in production, with a public request, that `GET /api/cats` returns cell centres and that `POST /api/sightings` refuses the 21st request from one device and hides low-confidence ids. `docs/DEPLOYMENT.md` §C lists this check before the removal.

## Data safety on the live test database

Testers are using apptest.catspotters.com now. In this plan only PR 3 and PR 3b touch live data (inserts into `observations`); everything else is code.

**Before either, check the ground** (Claude, not Samuel, with the read-only query tool):

1. Re-run the counts the backfill will reproduce: cats, claimed cats, owner-registered cats, `cat_updates` by type. They go in the PR's description, and its self-check must match them on production.
2. Take a Neon snapshot of `production` and record its name (Neon's 7-day restore is the backstop).

| Change | What it locks, and for how long | Why nothing is lost | If it goes wrong |
|---|---|---|---|
| PR 3 / PR 3b: backfill | Row inserts into `observations` only; reads the rest; bounded by the 5 s lock timeout | Append-only, idempotent, self-checking; nothing existing changes | The transaction raises and nothing lands; or the rollback removes exactly its marked rows; or restore the snapshot |

**Order.** PR 2 must be **live in production** first, *then* PR 3 runs, *then* PR 4 merges (and PR 4's code gate holds the old badge until PR 3 is recorded, whatever the merge order).

**The Play clock (F6).** This plan adds **no schema change of its own**: PR 3 and PR 3b are data only. The remaining schema changes in the chain (SYC-42's, SYC-63 §5, SYC-3's, SYC-101's, SYC-119 Slice B's) all land before the closed test starts. The up–down–up against a copy of production (`docs/DEPLOYMENT.md` §C) is best run on SYC-63 §5, the first migration with a meaningful rollback, on a Neon branch restored from production.

## Parallelism

Migrations are serial by nature: one chain, in merge order, each regenerated if it lands behind another. Code PRs run in parallel where their files don't collide.

```
Migration chain (serial, numbers taken at merge; main has 0000–0003):
  0003 SYC-43 part 1 (merged; production migrate pending)
  → 0004 SYC-42 Slice 1 (#55) if it merges next
  → then, in whatever order they become ready: SYC-63 §5 · SYC-3 Slice 1 · SYC-101 · SYC-119 Slice B
    · PR 3 (data) · PR 3b (data, after SYC-101) · SYC-42 Slice 2
  (no plan hardcodes a number; migrations merge strictly one at a time,
   and whoever merges second rebases and regenerates)

Wave 1 (start now, in parallel):   SYC-111 · PR 1 · PR 5
Wave 2:                            PR 2 (needs SYC-111, PR 1)
Wave 3 (in parallel):              PR 3 (needs PR 2 live) · PR 4 built now, merged after PR 3 has run
                                   · PR 8 · SYC-101 (after PR 2) · SYC-119 Slice C (after PR 2)
Wave 4 (in parallel):              PR 4 merges · PR 3b (after SYC-101) · PR 6 (needs PR 4, PR 5)
                                   · PR 7 (needs SYC-79's photos, Q2, Q3; with #46) · SYC-63 build (needs PR 4)
Wave 5:                            PR 9 (needs PR 4, Q4)

LAUNCH GATE (not a merge gate): PR 5 and PR 6 live in production
  → only then may SYC-113's /api pre-launch pass be removed (SYC-114)
```

The critical path to launch is **SYC-111 → PR 2 → PR 3 → PR 4 → PR 6**. SYC-111 is in the Backlog and nothing is building it; it gates both this plan and deletion, so it is the first thing to start.

| Pair | Together? | Why |
|---|---|---|
| PR 1, PR 5, SYC-111 | Yes | A new pure file, the matching route and limiter, and the API test setup |
| PR 2 and SYC-101 | **Serial**: PR 2 first | Both change the naming code in `routes/cats.ts` and `routes/sightings.ts`; SYC-101 rebases and swaps its lookups to the folded column |
| PR 2 and SYC-119 Slice C | **Serial**: PR 2 first | Slice C writes through `writeObservation` |
| PR 2 and SYC-63's build | Serial: PR 2 first | Both touch the three cat routes |
| PR 2 and SYC-42 Slice 5 | Serial: PR 2 first | Slice 5 writes through `writeObservation` |
| PR 4 and PR 5 | Yes | Different functions in `routes/sightings.ts` (resolve's response vs matching); expect a trivial rebase |
| PR 4 and PR 3 | Build together, merge PR 3 first | PR 3 is a migration file only; the order matters for testers, not for files |
| PR 4 and SYC-119 Slice A (#52) | **Serial**: #52 first | PR 4's hand-pick guard edits the resolve check #52 adds |
| PR 6 and PR 7 | Yes, with a rebase | Both touch `routes/sightings.ts` and `openapi.yaml` |
| PR 6 and SYC-119 Slice C | Serial on the cache key | Whichever ships second takes the next cache key |
| PR 6 and SYC-63's build | Yes | Both touch `catHelpers.ts`' discoverer fields and `lib/i18n.ts`; additive, expect a rebase |
| PR 7 and #46 | **Together** (Samuel, 30 Sep) | One change to the spot flow |
| Anything and SYC-42 (#54, #55) | Yes | No shared files until Slice 5 |

Each parallel builder gets **its own worktree**, never a shared one, and commits after each task.

## Model delegation

Planning and this refresh ran on Opus (justified in the brief: judgement-heavy reconciliation across four merged PRs and an infrastructure move, gating six tickets). Building runs on the cheapest tier that can do each PR well. "Review" means a reviewer in its own worktree, on the tier named.

| Work package | Builds on | Why this tier | Assurance |
|---|---|---|---|
| PR 1 resolver and `foldName` | **Sonnet** | The rules are fully written down (§10.2 and the 14 named tests); the risk is in the tests, which are specified | Named tests; **mutation probe** on rules 1, 3 and 6; **Opus adversarial review** (escalation: a wrong confidence level looks exactly like a right one, and every later PR trusts this logic) |
| PR 2 write service and go-forward writes | **Sonnet** | Clear interfaces, routine route changes | Tests, including the query counter and the refused-request cases; Sonnet review against §10.1 |
| PR 3 and PR 3b backfills | **Sonnet** | Short, well-specified SQL files | Their own self-check blocks; migration tests; up–down–up on a throwaway database seeded like production; **Opus review** of the match keys (escalation: a duplicate or missing statement is silent and permanent); read-only production probe after `db-ops` |
| PR 4 status on the cat page | **Sonnet**; translation strings on **Haiku** | Standard API and screen work; the strings are mechanical given the English | Tests, including the code gate's two states; screenshots at ~390 px and desktop with seeded data; strings then go to SYC-4 for a native check |
| PR 5 matching hardening | **Sonnet** | Smaller than the first draft's PR 5: the 500 m rule is already built, and what's left is a limiter key, a threshold and an ordering | **Mutation probes** on the ordering and the threshold; an **Opus adversarial pass** that attempts the probing attack and records its cost (escalation: privacy-critical, and a regression is invisible) |
| PR 6 blurring | **Sonnet** for server and app | Clear spec, several files | §10.8.8 and §10.8.9; **mutation probe** (bypass the serialiser once); **Opus adversarial review** hunting a fifth emitter (escalation: one missed emitter voids the whole promise); screenshots at both widths, native and web |
| PR 7 sighting questions | **Sonnet**; strings on **Haiku** | Standard endpoint and screen | Tests; a real resolve walked through in the browser pane at both widths |
| PR 8 correction endpoints | **Sonnet** | Straightforward now that `requireTeam` exists | Tests; Sonnet review |
| PR 9 push coarsening | **Sonnet** | Small, once Q4 is answered | Tests; Sonnet review |
| Each PR's final adversarial review before merge (`/ship`) | **Opus** | The standing rule for PRs Claude built | As `/ship` defines |

**Every silent-failure guard in this plan, and where else it must hold**, so a reviewer checks the list rather than only the guard:

- *Never cross attributes / the ear-tip asymmetry:* the resolver (PR 1), and every reader, which is why there is one `resolveCat` that the cat page, the fan-out (PR 4), the notify job (SYC-55), the dashboard (SYC-43) and SYC-119's dead-cat guard all call. No other code derives a status.
- *No exact coordinate in a public payload:* the four emitters (PR 6), `lib/geo`'s `publishedPosition` (PR 6), the matching response (PR 5: no distances, no low-confidence ids), notes (PR 7), feeding sites (SYC-43), welfare report positions (SYC-42: team-only), and any future endpoint, which must go through `serialiseCat`.
- *Append-only:* `observations` and `cat_identity` (step 1, **confirmed in production**), `sightings` (SYC-63 §5). Only PR 3's and PR 3b's rollbacks bypass it, and say so.
- *Attribution:* every writer goes through `writeObservation`; the three cat routes check the secret (SYC-107, done); `system:` authors can't be borrowed (PR 2).
- *"Has a home" never flickers:* PR 4's code gate on PR 3's recorded migration.

## Conflicts to resolve

Where the approved spec disagrees with the code, a ticket, another spec or another plan. None is resolved silently; each has a recommendation.

**C1 · SYC-75 asks for a sterilised status column on `cats`.** The spec, approved a day later, rejects status columns by name (§2) and derives sterilised from observations.
- *Options:* (a) follow the spec and point SYC-75 at this plan; (b) add the column as SYC-75 says.
- *Recommendation:* (a). The spec and DECISIONS.md win, and PR 1 and PR 4 deliver everything SYC-75 wants people to see.

**C2 · SYC-74 asks for the note and food-and-water to be columns on `sightings`, sent with the upload and carried through the offline queue.** The spec makes them observations written after resolve (§7, §10.7).
- *What a spotter notices:* following the spec, the questions come after the points, as designed, and need signal at that moment. Following the ticket, they'd come before matching, which puts a questionnaire in front of the points (§7: "the fastest way to kill this project").
- *Recommendation:* follow the spec. The small cost: answers typed with no signal on the reward screen aren't queued. Resolve already needs signal, so the spotter almost always has it seconds later.

**C3 · Matching distance. Resolved** by Samuel on 30 Sep (DECISIONS Part 2h): exact positions within 500 m, kept after the spine lands. PR 5 is rewritten to match. SYC-39 is done (#39).

**C4 · Who owns "what we last told people" about a cat.** The spine (§9.1) says it exposes a notified-status record; `email-capture.md` §5.3 says that table is the email job's own. DECISIONS.md Part 3 gives the job to `email-capture.md`.
- *Recommendation:* the email spec owns the table (SYC-55); this plan exposes only `resolveCat`. PR 3 seeds nothing, because the job seeds itself on first run and so never treats history as news.

**C5 · The spec sends the ear-tip answer with resolve, but the question appears on the screen that shows resolve's result** (the points).
- *Options:* (a) a separate "answers" call after the points (PR 7); (b) hold back resolve until the questions are answered, showing points the phone works out itself.
- *What a spotter notices:* (a) nothing; (b) a spot that isn't saved until they finish or skip the questions, and is lost if they close the app first.
- *Recommendation:* (a).

**C6 · A wrong *Likely* must be correctable from the day it can appear** (§4.3: the correction path "ships in the same change, not later"). PR 8's endpoints can now be built, but Syros Cats can only *use* them once `0003` is in production, the workspace hand-off (SYC-103) works and a screen exists (SYC-43). See Q2.

**C7 · Migration slots. Resolved.** No plan hardcodes a number any more except SYC-63's, whose queue line (`0002` SYC-98 → SYC-43 part 1 → SYC-101 → spine PR 3 → SYC-63) predates the Neon move and SYC-42. See C12.

**C8 · Who writes the deletion migration. Resolved:** SYC-63 owns it, before the Play closed test. It reaches production through `db-ops` like everything else.

**C9 · SYC-63's plan file says "awaiting Samuel's approval"; Linear records his approval on 29 Sep** (decisions A–E, flags 5 and 6).
- *Recommendation:* treat it as approved (Linear is the record), and correct the status line in the plan file when its build starts.

**C10 · SYC-63's sightings guard allows only resolve and redaction; SYC-119's "Ask Syros Cats to match it" needs pending → awaiting_team → resolved.**
- *Options:* (a) SYC-63's migration allows both transitions now; (b) SYC-119 adds a small follow-up migration when E2 is built.
- *What people notice:* nothing either way, until E2 ships.
- *Recommendation:* (a). It's two lines in a trigger being written anyway, and it saves a migration that would rewrite a guard function (exactly the kind of change that used to go missing on Replit, and still deserves care).

**C11 · Observation kinds: the spec's phase-1 list doesn't include `coat`; Part 2i adds it.** *Resolved* in PR 2: `coat` is accepted with SYC-119's value shape, and `system:vision` is a named system author.

**C12 · Two queue orders.** SYC-63's plan puts spine PR 3 before deletion's migration; SYC-42's plan (approved later) puts SYC-63 §5 and SYC-3 Slice 1 before PR 3.
- *What matters:* nothing technical links PR 3 (inserts into `observations`) and SYC-63 §5 (relaxes two columns, adds checks and the sightings guard). The real constraints are PR 3 after PR 2 is live, PR 3b after SYC-101, and SYC-63's *build* after PR 4.
- *Recommendation:* migrations merge in the order they become ready, one at a time, each regenerating if it lands second. Neither plan's queue line is binding beyond those constraints.

**C13 · The old admin care route still uses a shared password (`OWNER_SECRET`), and D7 retires shared passwords the day staff sign-in goes live.** Staff sign-in merged today.
- *Options:* (a) PR 2 still records what the route writes, and the route is removed once PR 8 and a SYC-43 screen can record sterilisation and adoption; (b) remove the route now.
- *What Syros Cats notices:* nothing; production has no record of the route ever being used (no `desexed` or `adopted` updates).
- *Recommendation:* (a). Removing it is filed as **SYC-185** (under D7, after PR 8 and a SYC-43 screen), and PR 2's few lines keep anything recorded in the meantime.

**C14 · SYC-119's picker publishes positions on a public-origin grid; PR 6 uses a grid offset by a server secret.** Until PR 6, a cat's "square" in the picker and its future blurred cell can differ.
- *Recommendation:* accept it as transitional. Nothing public uses the secret grid before PR 6, and PR 6 switches `publishedPosition` to the payload's cell centre in the same change (SYC-41 hand-off).

## Decisions for Samuel

**Decided by Samuel, 2 Oct 2026, and the plan approved: Q2 → A, Q3 → B, Q4 → A.** Q3 departs from the recommendation (C): each spotter is asked about a cat's ear **once**, whatever they answer, so the question never repeats for them. PR 7's `askEarTip` is false after any answer from this device for this cat. *(Correction, 2 Oct: an earlier version of this line recorded Q3 → A; Samuel confirmed B when asked about the mismatch.)* **Conflicts, also decided 2 Oct, all as recommended:** C1 (a), C2 follow the spec, C4 email spec owns the table, C5 (a), C9 treat SYC-63 as approved, C10 (a), C12 merge in order of readiness, C13 (a), C14 accept as transitional.

The options as they were put to Samuel are kept below for the record.

**Q1 · How do database changes reach the live app? Settled by the move to Neon.** The 29 Sep draft asked this because Replit's Publish could leave out safety rules and once planned to empty a table. Since 1 Oct the live database is on Neon, our own `db-ops` workflow applies changes to it before each publish, and Replit no longer touches it. Nothing to decide. The one standing rule carries over: **if Replit's Publish ever shows a database review, cancel it and tell Claude.**

**Q2 · Should "Probably sterilised" show publicly before Syros Cats can correct it?** The ear-tip question can ship before the team has a screen to correct answers. When a tourist mistakes a torn ear for a clipped one, the cat would show "Probably sterilised" to everyone, and nobody at Syros Cats could fix it. A cat wrongly shown as probably done can be skipped for trapping and have a litter.
- **Option A — collect the answers now, show "Probably sterilised" only once the team can correct it** (PR 8 live, staff able to sign in, and a correction screen). Until then the public sees "Not known yet". Nothing is lost: the answers are stored, and those cats update the day the correction screen arrives. *Benefits:* every answer from the testing season is captured, with no uncorrectable wrong label. *Risks:* for a while the app knows more than it shows.
- **Option B — hold the whole question until the dashboard ships.** *Benefits:* simplest. *Risks:* loses the testing season's ear-tip answers, which can't be recovered later (the spotter has walked away).
- **Option C — show it now, and Claude corrects mistakes on request** (a team member sends a cat and a photo; Claude records the correction through PR 8). *Benefits:* the label is live now. *Risks:* puts Claude in the loop for every correction, and relies on someone noticing.
- **Recommendation: A.**

**Q3 · Should a spotter be asked the ear-tip question every time they spot the same cat?** The spec says "Can't tell" stops the app asking that spotter about that cat again. It doesn't say what happens after "Yes, clipped" or "No, looks whole".
- **Option A — ask every time unless they said "Can't tell"** (the spec as written). *Benefits:* more independent looks at the ear, which strengthens the evidence. *Risks:* a regular who spots the same cat daily sees the same question daily.
- **Option B — ask once per spotter per cat, whatever they answered.** *Benefits:* never repetitive. *Risks:* fewer answers; a spotter who saw the right ear first is never asked again when they see the left.
- **Option C — ask again only after 30 days.** *Benefits:* fresh looks without nagging. *Risks:* one more rule to explain.
- **Recommendation: C.** It keeps the spec's "Can't tell" rule and adds a quiet period after any other answer.

**Q4 · How quickly should "Agatha was spotted again!" reach people who don't own the cat?** Today it arrives within seconds. That lets anyone who once spotted a cat follow, to the minute, when it's seen, and so when its cat guardian comes to feed. The spec says these must be "batched or coarsened".
- **Option A — one round-up a day** ("Agatha and 2 other cats you follow were spotted today"), at a fixed evening hour. *Benefits:* closes the leak properly, and fewer pushes is kinder anyway. *Risks:* loses the instant "someone just saw her!" delight.
- **Option B — keep it live, but only the first sighting of each cat each day.** *Benefits:* keeps some immediacy. *Risks:* still tells a watcher the moment the cat was first seen each day, which is the feeding-time pattern the spec worries about.
- **Option C — a random delay of a few hours.** *Benefits:* feels close to live. *Risks:* delays average out over many days, so a patient watcher still learns the pattern.
- **Recommendation: A.** Owners still get instant pushes about their own cat.

## Review

### Refresh review, 2 Oct 2026

An adversarial pass over the refreshed plan, run deliberately after rewriting it (a chip can't spawn a critic agent). It looked for ordering bugs, migration-number collisions with #54/#55, and anything assumed shipped that isn't, checking each claim against `gh pr view --json files`, `git log origin/main -S`, Linear and a read-only query of Neon production.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| R22 | **"`0003` is in production" would have been assumed from "#28 merged".** It isn't: production's history has three rows (`0000`–`0002`). PR 8's staff use and anything citing staff sign-in as "live" were overclaiming. | Medium | The plan says "merged; production migrate pending" everywhere, and PR 8 lists what must be live before staff can use it. |
| R23 | **PR 3 waited for SYC-101, which nobody has started**, so the whole critical path (cat page, blurring, deletion) hung on it, only because of the name backfill. | High | Names split into PR 3b, after SYC-101. PR 3 now waits only for PR 2 being live. |
| R24 | **The draft's PR 5 contradicted Part 2h** (grid-snapped 750 m), and its §10.8.10 probe test would have failed against the 500 m rule Samuel chose. | High | PR 5 rewritten: 500 m on exact positions kept; per-device limit, threshold and id-ordering added; tests replaced. `lib/blur.ts` moved to PR 6, which is the first to need it. |
| R25 | **`writeObservation`'s closed kind list and system-author list would have refused SYC-119's `coat` / `system:vision` and SYC-42's `system:welfare-report`**, breaking two approved plans at their first write. | High | Both kinds and all four system authors are in PR 2. |
| R26 | **SYC-63's sightings guard, as its plan describes it, would refuse SYC-119's `awaiting_team` transitions.** | Medium | C10, recommending the guard allows them from the start; restated in the interfaces section. |
| R27 | **Migration-number collision with #55.** #55 takes `0004`; if PR 3 merged first it would collide. | Low | Nothing here hardcodes a number; whoever merges second regenerates (the existing rule). Stated against today's numbers. |
| R28 | **Backdated badge loss (R1) re-checked against real data:** 12 of production's 28 cats are claimed, and none has a `homed` statement. Deriving `hasHome` before PR 3 would strip all 12. | High (if unguarded) | PR 4's code gate stays and is listed among the silent-failure guards. |
| R29 | **PR 6's cache key `cats-cache/public/v2` assumed a versioned key that doesn't exist** (today's is `cat-spotter/cats-cache`) and could collide with SYC-119 Slice C's bump. | Low | PR 6 takes "a new key no earlier build used, the next after SYC-119's". |
| R30 | **SYC-79 (the ear-tip example photos) is still Backlog**, so PR 7 can't merge, and #46 is held waiting for it. | Medium (schedule) | Stated as a hard blocker on PR 7; Samuel owns the ask to Syros Cats. |
| R31 | **SYC-111 is Backlog with no owner, yet gates PR 2 and SYC-63's migration.** | High (schedule) | Named as the first thing on the critical path, Wave 1. |
| R32 | **The old admin route (`OWNER_SECRET`) is a shared password D7 retires.** | Low | C13; PR 2 keeps a few lines of insurance; removal is SYC-43's. |
| R34 | **PR 4 and PR 6 assumed SYC-119 Slice A (#52, still a draft) is on `main`**, because their hand-offs edit `lib/geo` and the hand-pick check it adds. | Low | Both hand-offs are conditional on #52 having merged; if it hasn't, SYC-119 carries them. |
| R33 | **The runner's advisory lock is taken before its lock timeout** (`runner.ts::lockAndLimit`), so a second migrate run waits without limit. The withdrawn PR P fixed this. | Low | Not reopened: `db-ops` runs one at a time (its `concurrency` group), and a second run waiting its turn and then finding nothing to do is the correct outcome. Recorded so a future reader knows it was considered. |

**Checked, and holding:** SYC-107 is on `main` (`9385be2`); SYC-39's 500 m is on `main` (`lib/candidateSelection.ts`); SYC-98 is on `main` (`0002_photos_public_id`); `requireTeam` and both capabilities PR 8 needs exist; step 1's triggers and attribution check exist in production; `observations` in production is empty, so PR 3's idempotency keys have nothing to collide with on first run.

### Original review, 29 Sep 2026

Kept for the record. Findings marked *superseded* no longer apply after the move to Neon.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| R1 | **PR 4 before PR 3 strips every claimed cat of its home badge.** | High | PR 4 merges only after PR 3 has run in production (and R17's code gate). |
| R2 | **The backfill can't call the folding function** (SQL vs TypeScript). | High | The name backfill copies SYC-101's folded column (now PR 3b). |
| R3 | **PR 3 would copy PR 2's own care-route statements a second time.** | Medium | PR 2 sets `observedAt` to the `cat_updates` row's `created_at`, which PR 3 matches on. |
| R4 | **Append-only tables break the API tests**, which clean up by deleting against a shared database. | High | PR 2 is blocked on SYC-111. |
| R5 | *Superseded.* Production might lack step 1's safety rules after a Replit publish. | — | Production is now on Neon; the rules were confirmed present on 2 Oct. |
| R6 | **The ear-tip answer can't travel with resolve** (C5). | Medium | PR 7 adds a separate answers call. |
| R7 | **A wrong *Likely* could go public with no way to correct it** (C6). | High | Q2. |
| R8 | **Rename and registration accepted a forged device id.** | Medium | Filed as SYC-107; done in #41. |
| R9 | **Paging the catalogue could shrink the offline catalogue** to its first page. | Medium | PR 6: the app walks every page when refreshing the cache. |
| R10 | **The first draft planned deletion itself**, contradicting Part 2g. | Medium | Deletion is SYC-63's; column names follow Part 2g. |
| R11 | **The first draft asked who authors app-written statements**, already decided by Part 2g. | Low | `system:` authors used throughout. |
| R12 | **Hardcoded migration numbers** would clash. | Low | None hardcoded. |
| R13 | *Superseded.* A record of data steps would need its own migration. | — | Data steps are ordinary migrations. |
| R14 | **Deletion would miss a note stored anywhere but `observations.value`.** | Medium | PR 7 writes notes only as `note` observations. |
| R15 | *Superseded.* PR P's start-up step could stop the app starting; unbounded runner lock. | — | PR P withdrawn; the lock is R33. |
| R16 | **The name backfill backdated renames made after PR 2 went live.** | Medium | Skip any cat with a `name` observation (PR 3b); explicit match keys for every kind. |
| R17 | **"PR 4 after PR 3" was only a remembered merge order.** | Medium | PR 4 checks the runner's history and falls back until PR 3 is recorded. |
| R18 | **The evidence-of-life query silently lacked §3.4's import source.** | Low | PR 2 says so and names SYC-49 / SYC-82. |
| R19 | *Superseded.* PR P assumed the production role could run DDL. | — | `db-ops` migrates Neon directly. |
| R20 | *Superseded.* Replit's diff could truncate a table and skip function bodies. | — | Replit no longer touches the database. |
| R21 | **Once the `/api` pre-launch pass is removed, exact coordinates are public** unless PR 5 and PR 6 are live. | High | A hard launch gate. |

**Checked, and holding:**

- *Every spec step has an owner:* step 2 (PR 1's test 13), 3 and 4 (PR 2, PR 3, PR 3b), 5 (PR 5, as amended by Part 2h; the claim half by SYC-107), 6 (PR 6), 7 (PR 7), 8 (SYC-63). §4.5 is PR 8; §6.4.4 is SYC-98 plus PR 9; §2.3's logging is PR 4.
- *Every §10.8 test has an owner:* 1–7 and 17 (PR 1, PR 4), 8–9 (PR 6), 10 (superseded by Part 2h; PR 5's tests replace it), 14 (SYC-63), 16 (SYC-101 and PR 1's `foldName` test). 11 and 12 are the import's (SYC-49). 13's spotter half already exists (`imageValidation.exif.test.ts`, SYC-65); its import half is SYC-49's. 15 is SYC-55's, and C4 explains why this plan's backfill can't trigger it.
- *DECISIONS.md:* D4's public negative is in the copy and PR 1 rule 3; D7 is C13; F2 is PR 5 then PR 6, with Part 2h's amendment; F3 is step 1 plus SYC-63; F4 (no death announcements) is PR 4's fan-out check; F6 holds because this plan adds no schema of its own; Part 2c's points are each reflected; Part 2g's three points are followed; Part 2h is PR 5; Part 2i's `coat` and dead-cat guard are in PR 2 and PR 4.
- *Canonical facts:* €50–60, "cat guardian", "spotter" (never "snapper"), "Not seen since…", partial offline, and "absence of a clip is never negative evidence" are in the global constraints; no copy in this plan says otherwise.

**Left open, on purpose:** the spec's own open questions stay with their owners and block nothing here: the 250 m cell and the colony-averaging acceptance (Syros Cats, SYC-67), whether a public feeding site shows its exact position (Syros Cats; SYC-43 builds that endpoint), whether a cat guardian may mark a cat deceased (unreachable until SYC-53), and how long sighting notes are kept (Samuel with Syros Cats).
