# Adversarial review — `docs/specs/hosting-and-photo-storage.md`

**Reviewed:** 3 September 2026 · against the code on branch `claude/next-build-specs-parallel-f8f8c3`
**Method:** every claim about the codebase checked against the actual files; every arithmetic claim recomputed; supplier prices re-checked against live published pricing.
**Verdict in one line:** the *direction* (photos out of Postgres, into neutral object storage, now) survives — but the **numbers that justify the priority ordering are wrong by roughly 4×, and the conclusion "this decision is ten times more important than the hosting one" does not survive correction.**

Findings are ordered most severe first. Each is tagged **CONFIRMED** (verified against code, docs or live supplier pricing) or **PLAUSIBLE** (a concern I could not fully verify).

Sections I judged genuinely sound are listed in §S at the end. I have not manufactured findings to pad the list.

---

## F1 — CRITICAL · CONFIRMED · The entire cost model uses a Replit price that was cut by 77% one month before the spec was written

**What is wrong.** §2 prices Replit database storage at **≈$1.50 per GB per month** and calls that "supplier list prices as understood in September 2026". Replit's [August 2026 cloud pricing update](https://docs.replit.com/billing/aug-cloud-billing-updates) cut PostgreSQL data storage from **$1.50 to $0.35 per GiB-month**, effective **1 August 2026**, and cut deployment egress from $0.10 to **$0.05 per GiB**. The spec's own risk **R6** anticipated exactly this and asserted the argument "survives moderate price changes". A 4.3× cut is not a moderate change, and the argument does *not* survive intact.

**Concrete consequence.** Recomputing §2 with the correct price, holding the spec's own volume assumptions:

| Line | Spec says | Correct at $0.35/GiB |
|---|---|---|
| DB storage at MVP (4 GB of base64) | ~$6/mo | **~$1.40/mo** |
| DB storage at MLP (47 GB of base64) | ~$70/mo | **~$16.45/mo** |
| "Do nothing" MLP total | $100–110/mo | **~$46–56/mo** |
| Saving from the photo move at MLP | **~$70/mo** | **~$16/mo** |
| "Database is ~60× the price of object storage" | 60× | $0.35 ÷ $0.015 = **23×** (31× including the ⁴⁄₃ base64 inflation) |

Three headline claims in the spec collapse with it:

1. **"The photo move saves roughly $70/month."** It saves ~$16/month, and only from the 2027 season onward. In the launch window it saves about **$1.40/month**.
2. **"The hosting choice moves the total by perhaps $20–25/month either way. One of these decisions is ten times more important than the other."** At correct prices the photo move is worth ~$16/mo and the hosting decision ~$20–25/mo. **The hosting decision — the one the spec defers — is now the larger line.** The rhetorical spine of §2 and §4 is inverted.
3. **"For a charity spending €50–60 to sterilise a single cat, the whole hosting bill at launch scale is worth less than one cat a month."** Still true, and now true by a wider margin — which weakens rather than strengthens the case for urgency.

**Does the recommendation still stand?** Yes, but on entirely different grounds — see F3. The money argument no longer carries it.

**Recommended fix.** Rewrite §2 against live prices (Replit $0.35/GiB-month storage, $0.16/compute-hour PG compute, $0.05/GiB egress; R2 $0.015/GB-month + $4.50/M Class A and $0.36/M Class B operations, 10 GB / 1M / 10M free tier; Supabase Pro $25 with 8 GB DB, 100 GB storage, 250 GB egress, $0.125/GB and $0.09/GB overage — the Supabase column I re-checked and it is **correct**). Then delete the "ten times more important" claim and replace the priority argument with the migration-size and optionality arguments, which are the ones that actually hold.

---

## F2 — CRITICAL · CONFIRMED · The cost conclusion does not survive the sensitivity test the brief demands

**What is wrong.** §2 says the volumes are "deliberately on the generous side" and R6 says the argument survives price movement. Neither claim is tested. Run at correct prices:

| Volume vs plan | Photo bytes at MLP | Base64 in Postgres | DB storage cost | Saving from the move |
|---|---|---|---|---|
| ⅓ of plan | ~12 GB | ~16 GB | ~$5.5/mo | **~$5/mo** |
| As planned | ~35 GB | ~47 GB | ~$16.5/mo | **~$16/mo** |
| 3× plan | ~105 GB | ~140 GB | ~$49/mo | **~$48/mo** |

The photo move only becomes decisively more important than the hosting decision (~$20–25/mo) at roughly **2× the planned volume or above**. Below plan — which is the more likely direction for a first-season charity app on a 22,000-person island — the two decisions are the *same size*, and the hosting decision is bigger.

Separately, the volume assumptions themselves are asserted, not derived. 6,000 installs and 60,000 sightings in the 2027 season implies every install produces 10 sightings; 400 installs producing 6,000 sightings implies 15 each. Real-world engagement curves on volunteer apps are heavily long-tailed — a median user submits 1–2. There is no downside scenario anywhere in the spec.

**Concrete consequence.** A reader approves Option D believing it is a 10:1 priority call. It is a 1:1 call at plan volumes and a 1:4 call below plan.

**Recommended fix.** Add a low/central/high volume band to §2 and state explicitly at which volume the priority ordering flips. Keep the recommendation but justify it on migration risk and optionality (F3), not on the €/month.

---

## F3 — HIGH · CONFIRMED · The "migrating 3 GB in September is a quiet afternoon" argument is built on a production corpus that does not exist

**What is wrong.** §3 Option C and §5.6 both assume there is production photo data to back-fill. `docs/DEPLOYMENT.md` states, as verified 2 September: *"API never deployed (`.replit` has an autoscale config, nothing live)"*, and §C still has "Deploy the API as a Replit deployment" and "Production Postgres" as unticked items. **There is no production database and no production photo corpus.** The "production backfill, then flip to `object`" step scheduled for 15 Sep – early Oct will run against a database that is created in that same window, and §D of the runbook plans "the purge of test cats/sightings before launch" anyway.

**Concrete consequence.** Two things follow, and the spec gets both wrong in the same direction:

1. The elaborate migration apparatus in §5.6/§5.7 — dual-write mode, a 5% checksum sample, a 30-day rollback window, a restore-tested backup before the column drop, `VACUUM FULL` to reclaim space — is scaled to a risk (**R1: "severe and irreversible — these are volunteers' contributions"**) that does not exist at the moment the work is done. `VACUUM FULL` on a `photos` table that never held production rows reclaims nothing; §5.6 step 5 calls that step "the actual saving".
2. The genuine argument for doing this now is therefore *not* "3 GB is easier than 40 GB". It is "**zero rows is easier than any rows**" — do it before the first real photo is written and there is no backfill at all, no dual mode, no rollback window, and R1 evaporates.

**Recommended fix.** Restate §5.6/§5.7 around the real state of the world: ship the object-storage write path **before the production database is first populated**; keep the `data`-fallback read path for the handful of test/seed rows and for the R2-outage fallback; drop dual-write mode and the 30-day column-drop window entirely, or keep them only if the production DB is stood up before the storage code lands. This removes several days of work and the highest-severity risk in the register.

---

## F4 — HIGH · CONFIRMED · Choosing R2 for zero egress, then designing the egress benefit away

**What is wrong.** §2's cost table gives object storage "**$0 on Cloudflare R2 (no egress charge)**" for bandwidth, and §4 makes zero egress the deciding reason for R2: *"Cloudflare R2 charges nothing for bandwidth, which is exactly the shape of our costs."* But §5.4 decides to **stream every photo through the Express API** rather than redirect or serve from a Cloudflare domain. In that design, **100% of photo bandwidth is billed as Replit deployment egress at $0.05/GiB** regardless of where the bytes are stored. R2's zero egress is never realised.

At the spec's own busy-month figure of 120 GB, that is ~$6/month of Replit egress that the "$0" cell says does not exist. §5.4 additionally defers a CDN ("*Immutable cache headers already do most of this work*") — but `Cache-Control: immutable` only helps a client that has already fetched the photo. Tourist browsing of the catalogue is overwhelmingly *cold* traffic, which is exactly the case a CDN exists for and the cache header does nothing for.

**Concrete consequence.** The stated reason for picking R2 over Supabase Storage or Replit's own object storage is not delivered by the design in the same document. If the tie-break is genuinely bandwidth shape, the design has to change; if the design is right, the tie-break must be argued on something else (S3-compatibility and neutrality, which is a perfectly good argument on its own).

**Recommended fix.** Either (a) keep proxy-streaming and correct §2 to show photo bandwidth as a Replit egress line in *every* column, re-arguing R2 on neutrality rather than egress, or (b) serve photos from a Cloudflare custom domain in front of the bucket (public cat photos only) with the API retained for `restricted` photos — which realises the zero egress, gets a free CDN, and keeps access control where it matters. Note that (b) does change photo URLs, so it is a Phase 3 change, not a September one.

---

## F5 — HIGH · CONFIRMED · The schema change is applied by `drizzle-kit push` against a live database, with no migration history, in a repo with a documented history of exactly this breaking every endpoint

**What is wrong.** §5.2 specifies four new columns and makes `photos.data` nullable, and §6 schedules it inside the 1–14 September test window. The spec never says *how*. There is **no migrations directory** anywhere in `lib/db` — `lib/db/package.json` exposes only `push` and `push-force` (`drizzle-kit push`), which diffs the schema against the live database and applies DDL directly, with no versioning, no down-migration and no review artefact.

`.agents/memory/db-schema-drift.md` records that this has already caused a production-shaped failure: *"The username feature shipped with schema code but the column was never pushed; every username endpoint returned Express HTML 500s that looked like app bugs."*

**Concrete consequence.** This is the most credible way the storage work actually breaks testers during the Play window — not the photo bytes, the DDL. If the schema code deploys and the push doesn't (or vice versa), `POST /api/sightings` 500s and **every spot fails for every tester**, which is the one thing §6 exists to prevent. `drizzle-kit push` also has no rollback: the `PHOTO_STORAGE=db` panic switch in §5.7 restores the *application* behaviour but not the schema.

**Recommended fix.** Add an explicit migration step to §6 with (i) generated SQL reviewed before it runs, (ii) the push executed and verified **before** the code that depends on it is deployed (add-columns-nullable first, then code, then any constraint change), (iii) a smoke test against `/api/sightings` and `/api/photos/:id` immediately after, and (iv) a named rollback DDL. Consider adopting `drizzle-kit generate` + versioned migrations as part of this change, since this is the first schema change that touches a table with irreplaceable content.

---

## F6 — HIGH · CONFIRMED · `GET /api/photos/:id` has no rate limiting and no authentication, and §3 claims it does

**What is wrong.** §3 Option A dismisses the runaway-compute risk with: *"a bot scraping photos could produce a surprising bill. **Mitigated by rate limiting and cache headers, both of which exist.**"* That is false for the photo path. `artifacts/api-server/src/middlewares/rateLimit.ts` defines exactly one limiter (`aiLimiter`), and it is applied only to `POST /api/sightings` and `POST /api/cats/name-suggestions`. `artifacts/api-server/src/routes/photos.ts` has **no limiter, no auth, and a sequential integer id** (`serial` primary key) — trivially enumerable. `app.ts` also enables `cors()` with no origin restriction, so any website can hotlink every photo.

§5.4 then routes *all* photo bytes through this endpoint, on usage-billed autoscale compute, with no CDN.

**Concrete consequence.** The exact risk R7 names ("a charity gets a surprise invoice") is unmitigated, and the spec records it as mitigated. A single scraper walking ids 1..N pulls the entire corpus through billed compute and billed egress.

**Recommended fix.** Correct the claim in §3 Option A. Add a per-IP limiter to the photos route as part of this change (it is a two-line addition and belongs in the same PR), and add the Replit billing alert from R7 to the §6 "must land before launch" table rather than leaving it as prose in the risk register.

---

## F7 — HIGH · CONFIRMED · Nothing in the spec, or in the code, ever deletes a photo — and the MVP adds a takedown flow

**What is wrong.** The spec has no deletion story at all. There is no object-delete on photo-row delete, no orphan reconciliation, no lifecycle/retention rule (§4.2 mentions "a bucket-level lifecycle and access check" but the check described is access-only), and no GDPR erasure path. Verified in code: there is **no DELETE route anywhere** in `artifacts/api-server/src/routes/` — the full route list is GET/POST/PATCH only.

This matters more, not less, after the migration, because deletion becomes a *two-system* operation. And the MVP explicitly adds work that needs it: `PRODUCT-SPEC.md` §2.6 ships **"'Report an issue' on every cat and photo, routed to admin@syroscats and the queue"** plus a staff dashboard with "record corrections", and §2.7 commits to email data being "deletable" under GDPR.

**Concrete consequence.** The first inappropriate photo reported by a tester has no removal path; when one is built, deleting the row leaves the object in the bucket forever — a permanent, growing, unauditable store of content the charity has been asked to remove. For a charity handling public photo submissions, "we deleted it from the app but the file is still in our bucket" is a real problem, not a hypothetical.

**Recommended fix.** Add a deletion contract to §5: photo delete = object delete + row delete, in that order, idempotent, with a reconciliation script that lists bucket keys with no matching `storage_key`. Add it to the §6 pre-launch list, since the takedown flow lands in the same window.

---

## F8 — MEDIUM–HIGH · CONFIRMED · The spec's picture of the matching code is wrong in two places

**What is wrong.** §5.5 says: *"`sightings.ts` selects `photosTable.data` for each candidate cat **within 500 m**"*.

- **There is no distance filter.** `artifacts/api-server/src/routes/sightings.ts` loads *every* cat in the table, sorts by haversine distance, and takes `MAX_CANDIDATES = 10` — island-wide, at any distance. The 500 m restriction is a *planned* MVP change (`PRODUCT-SPEC.md` §2.3, "Matching restricted to cats within 500 m"), not current behaviour. The spec describes future state as present state.
- **The reads are sequential and per-candidate.** The loop issues up to ten separate `SELECT * FROM photos WHERE id = ?` queries, one at a time, awaiting each. §5.5's "several bucket reads … latency adds up" therefore *understates* it: the current shape is an N+1 executed serially, and naively porting it to R2 turns ten local DB round trips into ten network round trips **in series** on the request path a spotter is waiting on.

**Concrete consequence.** The mitigation offered (in-process LRU) is right but incomplete — the structural fix is to fetch candidates **in parallel** (`Promise.all`), which the spec does not mention and which matters more than the cache on a cold cache.

**Recommended fix.** Correct the 500 m claim. Specify parallel candidate fetches plus the LRU in `loadPhotoBytes`, and set a latency budget (e.g. p95 added latency < 300 ms) to be measured during the September test rather than assumed.

---

## F9 — MEDIUM–HIGH · CONFIRMED · The core recommendation's central premise — "sign-in isn't used until Phase 3" — is contradicted by the MVP scope

**What is wrong.** §4's answer to "why not Supabase now" rests on: *"the case for Supabase is its sign-in and its row-level security, and **neither is used until the roles-and-invites work in Phase 3**"*, echoed in §3 Option B and §4.1.

`PRODUCT-SPEC.md` **§2.6 is MVP scope, in this window**: *"One Syros Cats staff sign-in (email based) opening a simple web dashboard: welfare/report queue, feeding-site map (private by default, per-site public toggle), record corrections, colony naming."* Sign-in is being **hand-rolled in September**, not deferred to Phase 3. The spec's own §5.4 depends on it: restricted photos "served only to an authenticated team session".

Second premise problem, also confirmed in code: **row-level security is not a free benefit for this architecture.** `lib/db/src/index.ts` connects with a plain `pg.Pool` and a single connection string via drizzle. RLS under that model does nothing unless the API is re-architected to pass per-user JWTs / `SET LOCAL role` on every request. Describing RLS as something that comes with the platform materially overstates the Supabase upside — which cuts *in favour* of the recommendation, but the spec should not be winning its argument with a claim that happens to be wrong in its own favour.

**Concrete consequence.** The strongest honest argument against adopting Supabase in September is the **window**, not "we won't use sign-in". As written, a reviewer who knows §2.6 exists will distrust §4. And the counterfactual is worth stating plainly: one staff login is a bcrypt hash and a cookie; it does not justify a platform migration — say *that*, rather than claiming no sign-in exists.

**Recommended fix.** Rewrite the §4 "why not Supabase now" paragraph around (a) the September window and (b) the fact that MVP needs exactly one staff login, which is hours of work, whereas Phase 3 needs a real multi-role invite system, which is where a platform auth product earns its keep. Downgrade the RLS claim in §3 Option B to "would require re-architecting the data access layer to be worth anything".

---

## F10 — MEDIUM · CONFIRMED · The upload path is described as unchanged, but a second photo upload path lands in the same window

**What is wrong.** §5.3 says the upload path is `POST /api/sightings` and that it is deliberately unchanged; §6 lists "no change to the upload contract" as a hard constraint. I confirmed `POST /api/sightings` is today the only route that calls `validatePhotoBase64` — so the spec is right about *current* state. But the MVP being built in the same window adds at least three more photo surfaces the spec never accounts for:

- **`PRODUCT-SPEC.md` §2.5** — the cat-in-trouble report flow takes **a photo**. That is a brand-new upload endpoint, and its photos are precisely the `visibility = 'restricted'` category §5.2 invents. §5.3 gives no guidance for it.
- **`PRODUCT-SPEC.md` §2.4** — "Import of Syros Cats' existing sterilisation/TNR records before launch". A bulk import that may carry photos, bypassing the HTTP upload path entirely and therefore bypassing `validatePhotoBase64` — i.e. **bypassing the EXIF strip that §5.3 makes load-bearing for the blurred-location promise**.
- **`PRODUCT-SPEC.md` §2.2/§2.3** — authored content: an ear-tip explainer photo and a clipped-tip reference photo per language. Static assets, but someone has to decide whether they are `photos` rows or bundled app assets.

**Concrete consequence.** Whoever implements SYC-46 will build one writer, and three more photo producers will appear over the next fortnight, each with its own chance of writing straight to `data` or skipping normalisation. The imported-records path is the dangerous one: an imported photo with intact GPS EXIF, served as a downloadable file, defeats location blurring exactly as R3 describes.

**Recommended fix.** State in §5.3 that **every** path that creates a `photos` row must go through one shared `storePhoto(buffer|base64, {visibility})` helper that performs validation, normalisation, EXIF strip, checksum and PutObject — and that the records import is explicitly in scope for that rule. Add a test asserting no code path inserts into `photosTable` outside that helper.

---

## F11 — MEDIUM · CONFIRMED · `PHOTO_STORAGE=db` is described as a panic switch that restores "exactly the current behaviour with no data loss". After the flip to `object`, it does not

**What is wrong.** §5.7: *"`db` — the panic switch. Because `data` was never dropped, flipping back restores exactly the current behaviour with no data loss."* This is only true for photos written *before* the flip to `object`. Every photo written after the flip has `data = NULL`, so `db` mode cannot serve it. Reads still work only because §5.2's rule ("authoritative on `storage_key` when non-null") keeps the bucket in the read path — which means `db` is a rollback of the **write** path only.

**Concrete consequence.** The switch does not protect against the failure it reads as protecting against. If R2 becomes unreachable — credentials revoked, account suspended, a Cloudflare incident, a bucket deleted in error — no setting restores those photos, because there is no second copy. The document invites the reader to believe otherwise.

**Recommended fix.** Rename the modes to what they are (`db` = "write to Postgres only"), and state explicitly that after the flip to `object` the bucket is the only copy of post-flip photos. Then say what actually covers that risk — R2 versioning enabled on the bucket, or a periodic copy of new objects, or an accepted-risk note signed off by Samuel.

---

## F12 — MEDIUM · CONFIRMED · The upload sequence in §5.3 has a crash window that produces permanently unreadable photos

**What is wrong.** §5.3 step 1–3: *"allocate the photo row, derive `storage_key` from the id plus a random suffix … `PutObject` … Write the row with `storage_key`, `bytes`, `checksum`."* Deriving the key from the row id forces an INSERT-then-UPDATE, which opens a window: if the process dies (or the DB connection drops) after `PutObject` but before the UPDATE, the row has `data = NULL` **and** `storage_key = NULL` — unreadable, with an orphaned object in the bucket. On Replit autoscale, instances are recycled; this window will eventually be hit.

The fallback described ("on storage failure, fall back to writing `data`") covers a `PutObject` *error*, not a crash after a successful put.

**Concrete consequence.** A sighting whose photo 404s, with no way to tell whether the bytes exist. Rare, but silently corrupting, and it lands in the same bucket of trust as R1.

**Recommended fix.** Generate the key from a UUID/ULID **before** touching the database, `PutObject` first, then a **single** INSERT carrying `storage_key`, `bytes` and `checksum`. This removes the window entirely and removes the need for the "random suffix stops key guessing" workaround, since the whole key is unguessable. The orphan-reconciliation script from F7 mops up puts whose insert failed.

---

## F13 — MEDIUM · CONFIRMED · No test, CI or local-development story for a design whose default mode requires bucket credentials on day one

**What is wrong.** §5.7 says `PHOTO_STORAGE` defaults to **`dual` from the day the code ships** — meaning every environment that runs the API needs working R2 credentials, including CI and every developer laptop. The spec says nothing about this. Meanwhile the existing test suite talks to a real Postgres (`pool` from `@workspace/db`) and reads/writes `photos.data` directly in at least five files:

- `sightings.upload.test.ts` asserts on `photo!.data` (`Buffer.from(photo!.data, "base64")`, `sharp(stored).metadata()`) — this test **fails outright** in `object` mode, since `data` will be null.
- `catHelpers.derived.test.ts`, `cats.nameSuggestions.test.ts`, `sightings.resolve.test.ts`, `sightings.moderation.test.ts` all insert `photosTable` rows with a literal `data` value.
- `artifacts/api-server/scripts/security-check.mjs` posts a sighting against a running server.

**Concrete consequence.** The "one afternoon" and "minutes, not hours" estimates in §5.6/§6 ignore a required storage abstraction with an in-memory fake, a decision about whether CI gets real credentials, and edits to five test files plus the security-check script. Realistically this is the largest single chunk of the work, and it is invisible in the plan.

**Recommended fix.** Specify the storage interface as an injectable module with an in-memory implementation selected by `PHOTO_STORAGE=memory` (or absent credentials) for tests and local dev; default CI to that. List the affected test files in §6 so the estimate is honest.

---

## F14 — MEDIUM · CONFIRMED · Adding Cloudflare as a photo processor is a privacy/compliance change, and the spec is silent on it while the privacy policy is being written this month

**What is wrong.** The spec never mentions GDPR, data residency, sub-processors or the store data-safety forms. It should, because:

- The photos are user-contributed images taken in the EU by EU data subjects, and `DEPLOYMENT.md` §A has "Privacy policy (en/el/fr)" and "Apple privacy nutrition labels + Play data-safety form (photos, precise location, optional email)" as **unticked, submission-blocking items in this same window**.
- R2 buckets are created in a location Cloudflare chooses unless a **jurisdiction** (e.g. EU) is specified at creation time. That choice is irreversible for the bucket and must be made before the first object is written.
- Adding Cloudflare adds a sub-processor that the Syros Cats ↔ Fair Shake data agreement (proposal §15, referenced in the runbook's critical path) has to name.

**Concrete consequence.** Either the privacy policy ships naming the wrong storage provider, or the bucket gets created in the wrong jurisdiction and cannot be moved without re-uploading everything. Both are cheap to avoid now and expensive later.

**Recommended fix.** Add to §6's 1–14 Sep row: create the bucket **with EU jurisdiction**; add Cloudflare to the sub-processor list in the privacy policy and the data agreement before submission. Add a line to §4.2's runbook changes covering the same.

---

## F15 — MEDIUM · PLAUSIBLE · `VACUUM FULL` is asserted to be "the actual saving" without checking that Replit's managed Postgres bills the way the spec assumes, or that the reclaim is even runnable

**What is wrong.** §5.6 step 5 and R5 hang the entire saving on `VACUUM FULL` or `pg_repack`. Three unverified assumptions:

1. **Metering.** Replit's managed Postgres is Neon-derived. Neon-style platforms meter *logical* data size including retained history/snapshots for the backup retention window — in which case the bill does not drop the moment the table is rewritten, and may not drop until retention rolls off. The spec asserts a before/after size will be "recorded" but not what the *bill* is expected to do.
2. **`pg_repack` availability.** It is an extension requiring installation and elevated privileges. On a managed database it is very likely **not available**. Offering it as an equal alternative to `VACUUM FULL` suggests it was not checked.
3. **`VACUUM FULL` takes an ACCESS EXCLUSIVE lock** on `photos` and needs free disk equal to the table size. On a small table that is seconds — but the spec never says the photos endpoint is unavailable during it, or that this must happen in a quiet window.

**Concrete consequence.** R5 ("we do the work and keep paying anyway") is the risk the spec names, and the handling proposed for it may not work. Given F3 (no production corpus), this may be moot for launch — but it will matter the first time the table is genuinely large.

**Recommended fix.** Confirm with Replit's documentation/support how database storage is metered and whether reclaim is reflected, before writing the reclaim step down as "the actual saving". State the lock and the maintenance window. Drop `pg_repack` unless confirmed available.

---

## F16 — MEDIUM · CONFIRMED · The `restricted` visibility design specifies enforcement against an authentication system that does not exist yet, in a route that has no auth at all

**What is wrong.** §5.4: restricted photos "are served only to an authenticated team session". `routes/photos.ts` today has no authentication of any kind, and the only auth primitives in the codebase are `deviceAuth.ts` (per-device secret, for a spotter proving ownership of their own sighting) and an `OWNER_SECRET` env var. The "team session" is `PRODUCT-SPEC.md` §2.6, being built this month in parallel.

Combined with §5.2's `visibility text default 'public'`, the practical outcome is a column that nothing writes `'restricted'` to and an enforcement rule nothing implements — scaffolding for a feature landing on a different track.

**Concrete consequence.** Either it ships as dead schema (harmless but misleading — the spec reads as though restricted photos are protected), or an implementer wires enforcement early, mis-sets the default, and **photos stop loading in testers' builds mid-Play-window** — the one outcome §6 exists to prevent.

**Recommended fix.** Either cut `visibility` from the September change and add it with the welfare flow that populates it, or keep the column and state explicitly that enforcement is a no-op until the §2.6 staff session exists, with a test pinning `default 'public'`.

---

## F17 — LOW–MEDIUM · CONFIRMED · The Play-clock risk (R2) is framed around the wrong failure mode

**What is wrong.** R2 and §6 are built on "a change during 1–14 Sep breaks testers and **resets the Play 14-day clock**", mitigated by the change being "API-only, no new store build required". Two problems:

- **New builds do not reset the clock.** Google Play's continuous-14-day requirement is about **12+ testers remaining opted in**, not about build immutability — the runbook's own §G says exactly this ("*Play's 14-day rule assumes testers stay **opted in** continuously — brief the WhatsApp group not to leave the test*"). Pushing a new closed-track build is normal and does not restart the count.
- **New builds are happening anyway.** `PRODUCT-SPEC.md` §2.3 adds a clipped-tip question, a per-sighting note and a food/water question to the spot flow in this same window — client changes that require new builds and that change the sightings request body. The "frozen upload contract" the storage spec protects is not actually frozen.

**Concrete consequence.** The "API-only" property is worth *less* than the spec claims as clock insurance — and correspondingly the risk it under-weights is the real one: **API 500s or photo 404s make the app look broken to testers, they disengage or uninstall, and the opt-in count drops below 12**. That is the mechanism that actually costs the window, and it points straight back at F5 (schema push) and F6 (unprotected photo route).

**Recommended fix.** Reframe R2 around tester retention rather than build immutability. Add a concrete guard: deploy the storage change at the *start* of the window, not the end; smoke-test spot → match → photo-load immediately after; and have a same-day revert path (the `PHOTO_STORAGE` switch plus a redeploy) with a named owner.

---

## F18 — LOW–MEDIUM · CONFIRMED · The Phase 3 "trigger" is a checklist, not a trigger — nothing fires it

**What is wrong.** §4.1 is four good questions with **no date, no owner, no default outcome and no mechanism**. "Re-open the hosting decision in October–December 2026" against four tests, one of which (Q1, charity credits) is itself an open, unowned question in §7. Meanwhile SYC-47 stays open indefinitely, which is precisely the failure mode §3 Option D flags ("*Mitigated by writing the trigger down (§4.1) so 'later' doesn't mean 'never'*"). Writing it down is not a mitigation; a dated obligation with a default is.

**Concrete consequence.** The most likely real outcome of Option D is that SYC-47 is still open in March 2027, the app is on Replit by inertia, and the decision was made by not making it. That is a defensible outcome — but it should be chosen, not drifted into.

**Recommended fix.** Give the trigger teeth in SYC-47: a **due date** (e.g. 15 November 2026), a named owner (Samuel), a required input (two months of actual invoices + a completed restore test), and an explicit default — "*if not decided by the due date, Replit is the answer through the 2027 season and SYC-47 closes*". Also give Q1 (credits) a date, since the trigger depends on it.

---

## F19 — LOW · CONFIRMED · §4.2 updates the deployment runbook but leaves the contradicting recommendation standing in the product spec

**What is wrong.** §4.2 enumerates changes to `docs/DEPLOYMENT.md` §C and says "**nothing else in the runbook moves**". But `docs/PRODUCT-SPEC.md` §2.8 — MVP scope, "during testing, before launch" — still reads: *"Hosting decision resolved: Supabase vs Replit (**recommendation stands: Supabase**)"*. §8 of this spec asks Samuel to override that recommendation, but the spec never says which document records the override.

**Concrete consequence.** Two live planning documents give opposite answers, in a repo where CLAUDE.md's standing rule is that state claims come from live sources. The next person to read §2.8 will build to Supabase.

**Recommended fix.** Add `PRODUCT-SPEC.md` §2.8 to the §4.2 change list, with the replacement wording, and note SYC-47's new due date there too.

---

## F20 — LOW · CONFIRMED · Small factual slips in §5.3's description of the validation pipeline

**What is wrong.** §5.3 summarises `imageValidation.ts` as "*format sniffing, HEIC conversion, EXIF-orientation applied, resize to 2048px, JPEG quality 80, 5 MB cap*". Mostly accurate, but:

- The **5 MB cap is the stored cap, not the accepted cap**. The route accepts up to `MAX_INPUT_BYTES = 20 MB` (behind `express.json({ limit: "25mb" })`), and oversized-but-valid photos are *shrunk* (1280px, quality 60) rather than rejected. Anyone sizing R2 request costs or the API's memory footprint from "5 MB cap" will be out by 4×.
- The pipeline accepts **WebP and AVIF** too, not just the JPEG/PNG/HEIC implied.
- `photos.mime` is always written as `image/jpeg` post-normalisation, so the `mime` column carries no information — worth noting since §5.3 has the upload set `Content-Type` from it.

**Concrete consequence.** Minor, but these are the numbers an implementer will copy.

**Recommended fix.** Correct the sentence; state the 20 MB inbound / 5 MB stored distinction.

---

## F21 — LOW · CONFIRMED · The `primary_photo_id = 0` sentinel is not accounted for

**What is wrong.** `routes/cats.ts` registers resident-owned cats with `primaryPhotoId: 0` as a deliberate sentinel (*"No photo yet — 0 is a sentinel; the photos route 404s for it"*). §5.2's claim that "every existing … foreign key (`cats.primary_photo_id`) … stays valid" is true only because that column is **not an actual foreign key** — a real FK would reject the sentinel.

**Concrete consequence.** The shared `loadPhotoBytes(photoId)` helper (§5.5) and the backfill must both handle id 0 without erroring or attempting a bucket GET for `photos/.../0-*.jpg`. Trivial, but the kind of thing that produces a confusing 500 rather than a 404 in the matcher.

**Recommended fix.** Note the sentinel in §5.2 and require `loadPhotoBytes(0) → null` explicitly, with a test.

---

## F22 — LOW · PLAUSIBLE · R2 per-operation costs are never mentioned

**What is wrong.** §2 prices R2 purely on GB-months. R2 also bills **Class A operations at $4.50/million** (writes) and **Class B at $0.36/million** (reads), with a monthly free tier of 1M Class A and 10M Class B. At the spec's own busiest-month figure (~120 GB ÷ ~0.5 MB ≈ 240,000 reads), this sits comfortably inside the free tier and rounds to zero — so the omission does not change any conclusion. It is worth one line so the model is complete, and so a future CDN-less, cache-miss-heavy traffic pattern is recognised as the thing that would change it.

**Recommended fix.** One footnote in §2.

---

## S — Sections I judged sound

Stated in one line each, as requested, with the verification behind them.

- **EXIF stripping (§5.3, R3).** Correct. `normalizeToJpeg` uses `sharp(...).rotate().resize().jpeg()` with no `withMetadata()`, so sharp drops all metadata including GPS; the `heic-convert` fallback re-enters the same pipeline. The spec is right that this is now load-bearing and right to demand an explicit test.
- **The offline queue (§5.8).** Accurate in every particular I checked: `pendingPhotos.ts` stores photos as files in the document directory with only the path in the queue, base64 is a web/legacy fallback (`supportsPhotoFiles = Platform.OS !== 'web'`), and `offlineQueue.ts` sets `MAX_QUEUE_AGE_MS = 30 days` with items flagged `errorKind: 'stale'`. The "offline support is partial" framing is precise and matches CLAUDE.md's standing correction.
- **Keeping the integer primary key and the `/api/photos/:id` URL shape (§5.2, §5.4).** Correct and well-judged — `catHelpers.photoUrl()` is the single URL constructor, and every consumer (`cats.ts`, `sightings.ts`) routes through it, so nothing else needs touching.
- **The single `loadPhotoBytes(photoId)` helper (§5.5).** The right call, and the reason is stated correctly: `photos.ts` and `sightings.ts` are today the only two readers of photo bytes, and I found no third. (The tests are a fourth *writer*, which is F13.)
- **Rejecting Option C outright (§3).** Right conclusion, wrong supporting arithmetic (F1/F3) — the "do it before there is anything to migrate" argument is stronger than the one the spec makes.
- **Deferring pre-signed direct-to-bucket uploads (§6).** Correct and correctly reasoned: a two-step upload genuinely does complicate the offline retry semantics in `OfflineContext.tsx`, for no benefit at this scale.
- **The Supabase column of the §2 cost table.** Re-checked against live pricing and it is accurate: Pro $25/mo, 8 GB DB then $0.125/GB, 100 GB storage then $0.021/GB, 250 GB egress then $0.09/GB.
- **Canonical facts (CLAUDE.md).** Clean. €50–60 per sterilisation (never €25); "spotter" and "cat guardian" used correctly with no "colony carer"; no "notched ear" (the spec does not discuss ear tips at all); offline support described as partial with an explicit boundary; the document reads as one aspirational vision without "built vs proposed" hedging.

---

## Bottom line on the core recommendation

**Option D survives — but not for the reasons given.**

The money argument that carries §2 and §4 is wrong by ~4× (F1) and does not survive a 2–3× volume sensitivity in either direction (F2). At correct prices, the decision the spec **defers** (hosting, ~$20–25/mo) is worth more per month than the decision it treats as urgent (photos, ~$16/mo at MLP, ~$1.40/mo at launch). The claim that one is "ten times more important" is the single most serious problem in the document, because it is the sentence a reader will use to approve the whole thing.

What *does* justify moving photos out now is not in the spec in its strongest form: **there is no production photo corpus yet** (F3). Doing this before the first real photo is written means no backfill, no dual-write mode, no 30-day rollback window, no `VACUUM FULL`, and R1 — the highest-severity risk in the register — simply does not arise. That is a much better argument, and it also makes the change *smaller* than the spec plans for.

Deferring the hosting call creates little technical rework (S3-compatible storage genuinely does move for free), so the timing logic holds. But the *stated* premise for deferring — "sign-in isn't used until Phase 3" — is contradicted by MVP §2.6 (F9), and the deferral has no mechanism to fire (F18).

**Recommendation to the author:** keep Option D, rewrite §2 against live prices, replace the priority argument with the empty-database argument, fix the four premise errors (F8 500 m, F6 rate limiting, F9 sign-in/RLS, F11 rollback), and add the three things the spec is silent on that will bite in implementation: deletion (F7), the migration mechanism (F5), and the test/local-dev storage fake (F13).

**Sources for pricing verification:**
- [Replit — Cloud Aug 2026 Pricing Updates](https://docs.replit.com/billing/aug-cloud-billing-updates)
- [Replit — Publishing and Database Billing](https://docs.replit.com/billing/about-usage-based-billing)
- [Cloudflare R2 pricing 2026 overview](https://egresscost.com/cloudflare/)
- [Supabase pricing 2026 breakdown](https://uibakery.io/blog/supabase-pricing)
