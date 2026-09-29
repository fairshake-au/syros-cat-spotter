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
