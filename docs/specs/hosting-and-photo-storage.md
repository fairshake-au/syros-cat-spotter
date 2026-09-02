# Hosting and photo storage — decision spec

**Tickets:** SYC-47 (decide hosting: Supabase vs Replit) · SYC-46 (move photos out of Postgres into object storage)
**Relates to:** [PRODUCT-SPEC.md](../PRODUCT-SPEC.md) §2.8 and §4 · [DEPLOYMENT.md](../DEPLOYMENT.md) §C
**Status:** For Samuel's approval. Adversarial review next.
**Window:** testing 1–14 September · launch October 2026 · MLP by end March 2027.

---

## 1. The short version

Cat Spotters keeps every photo a spotter takes. Right now those photos live **inside the database**, as text. That works, and nobody using the app can tell the difference — but a database is the most expensive place on the internet to keep a picture. Roughly **sixty times** the price of the storage built for the job. And unlike a monthly fee, it never comes back down: every photo taken in the summer of 2027 is still being paid for in 2030.

So there are two questions, and they have been tangled together:

1. **Where do the photos go?** Out of the database and into proper file storage. This is not really a decision — it is a job. The only real choice is *which* file storage, and how we do it without disturbing the two-week test.
2. **Where does the whole thing live?** Today it runs on Replit. Supabase is the alternative on the table: one predictable bill covering the database, the file storage and sign-in.

**The recommendation, up front:** do the photo move now, before launch, into **storage that is not tied to either host** — and answer the hosting question later, in the quiet months, when it can be answered properly and when the thing that would actually justify moving (real accounts for cat guardians and volunteers) is being built anyway. Details and reasoning in §4.

For a charity spending **€50–60 to sterilise a single cat**, the whole hosting bill at launch scale is worth less than one cat a month. That is the frame for everything below: we are not optimising pennies, we are making sure the bill does not quietly grow into something Syros Cats can't carry, and that we are never trapped.

---

## 2. What we are actually paying for

Four separate things, usually bundled and confusingly named:

| Thing | Plain English | How it grows |
|---|---|---|
| **Compute** | The machine that answers the app's requests | With how busy the app is. Goes back down in winter. |
| **Database** | The records: cats, sightings, points, colonies | Slowly. Text is tiny. |
| **File storage** | The photos themselves | Forever upward. Never shrinks. |
| **Bandwidth** | Photos travelling out to phones | With how much people browse. Peaks in tourist season. |

Only one of these compounds: **file storage**. That is the one to get right before October.

### The volumes we are planning for

Every photo is already resized to at most 2048px and re-encoded as JPEG before storage, so a stored photo is roughly **0.5 MB**. Storing it as text inside the database inflates it by about a third.

| | MVP — Oct 2026 to Mar 2027 (low season) | MLP — the 2027 season (Apr–Sep 2027) |
|---|---|---|
| Installs | ~400 | ~6,000 (tourists dominate) |
| Sightings / photos | ~6,000 total | ~60,000 in the season |
| Photo bytes stored | ~3 GB | ~35 GB cumulative |
| Same photos held as text in the database | ~4 GB | ~47 GB |
| Other database content | under 0.2 GB | under 1 GB |
| Photo bandwidth, busy month | ~5 GB | ~120 GB |

These are planning figures, deliberately on the generous side, not forecasts. The shape matters more than the numbers: **photos are 95%+ of everything we store, and bandwidth spikes in summer.**

### What that costs, three ways

Supplier list prices as understood in September 2026, in US dollars because that is how they are billed; roughly ×0.92 for euros. Prices must be re-checked at the moment of committing (see risk R6).

| Cost line | Do nothing (photos stay in the database) | Photos in object storage, everything else unchanged | Everything on Supabase |
|---|---|---|---|
| Database storage | ~$6/mo at MVP → **~$70/mo at MLP** (≈$1.50 per GB per month) | under $1/mo — the database becomes tiny | included in the plan (8 GB), then ~$0.13/GB |
| File storage | n/a | ~$0.05/mo at MVP → ~$0.55/mo at MLP (≈$0.015–0.025 per GB) | included (100 GB), then ~$0.021/GB |
| Bandwidth | included in compute egress | $0 on Cloudflare R2 (no egress charge); ~$0.10/GB on host-bundled storage | 250 GB included, then $0.09/GB |
| Compute | ~$5–15/mo usage-based | ~$5–15/mo usage-based | still needs a home (see §4) |
| Plan fee | Replit Core $25/mo (already being paid, and it is also the build environment) | same | Supabase Pro $25/mo **on top of**, or instead of, Replit |
| **Realistic MLP total** | **~$100–110/mo and climbing every month** | **~$30–40/mo, essentially flat** | **~$50–65/mo** (both plan fees) or ~$30–40 (if Replit goes away) |

The headline: **the photo move saves roughly $70/month by the 2027 season and stops the only line that compounds.** The hosting choice moves the total by perhaps $20–25/month either way. One of these decisions is ten times more important than the other, and it is not the one that has been sitting open.

---

## 3. The hosting decision

**The question:** where should the Cat Spotters backend — the machine, the database, the photos and eventually sign-in — live, from October 2026 onward?

### Option A — Stay on Replit (compute + database), photos to object storage

**What it means for users:** nothing changes. The app they test in September is the app that launches.

**Benefits**
- Zero migration risk during the only window we have. Nothing moves during the 1–14 September test or the September submission scramble.
- The AI photo matching currently runs through Replit's built-in OpenAI integration. Staying means not swapping that for a raw API key mid-sprint.
- Replit is also where the app is built. One less account, one less bill, one less set of credentials to hand over.
- Cheapest total while the app is small, because the plan fee is already being paid for the build environment.

**Risks**
- Replit's database storage is the most expensive of the three (~$1.50/GB/month), so the photo move is *mandatory* here, not optional.
- Autoscale compute billing is usage-based and less predictable than a flat fee — a bot scraping photos could produce a surprising bill. Mitigated by rate limiting and cache headers, both of which exist.
- Replit is a build-and-host product first; it is not where a serious production database wants to end up long term. Backups and restore need to be proven, not assumed.
- No real sign-in system, so the MLP roles-and-invites work (guardians, volunteers, vets) is ours to build.

### Option B — Move to Supabase (database + file storage + sign-in in one)

**What it means for users:** nothing visible, if it goes well. If it goes badly at the wrong moment, testers hit a broken app during the 14-day Play test and we lose the clock.

**Benefits**
- One predictable bill covering database, photo storage and bandwidth, with generous allowances (100 GB storage, 250 GB bandwidth) that comfortably cover the 2027 season.
- Sign-in comes free, and MLP needs real accounts for cat guardians, volunteers and the Syros Cats team. That is the single strongest argument for Supabase and it is a Phase 3 argument, not an October one.
- Row-level security is a genuinely good fit for our access rules: exact cat locations and feeding sites are team-only, and enforcing that in the database rather than only in application code is a real safety improvement.
- Standard Postgres underneath. Leaving is a `pg_dump` away.

**Risks**
- Supabase does not run our Node API. Compute still needs a home — Replit, Fly, Render or similar — so "one bill" is only one bill if we also move compute somewhere, which is a second migration, not a simplification.
- Doing it now costs the September window: new database, new connection strings, new secrets, replacing the Replit OpenAI integration, re-testing push and email, re-pointing the domain. All while the store submissions are the actual critical path.
- Sign-in only pays off once we build on it. Adopting it in October and not using it until January is carrying cost for no benefit.
- Its file storage has an egress charge past the allowance, where Cloudflare R2 has none. At tourist-season browsing this is small but real.

### Option C — Do nothing at all (photos stay in the database, hosting unchanged)

**Benefits:** zero work now; the whole window goes to the store submissions and the §2 product changes.

**Risks:** the compounding cost stays compounding. Worse, the longer we wait, the bigger the backfill: migrating 3 GB in September is a quiet afternoon; migrating 40 GB mid-season next summer is a maintenance window with users on the island actively spotting. **This option is rejected** — it converts a small job now into a risky one later, for a saving of one afternoon.

### Option D — Split the decision: photos out now to neutral storage, hosting answered in Phase 3

**What it means for users:** nothing changes in September or at launch. Photos load exactly as they do today.

**Benefits**
- The migration lands **once**, as SYC-47 asks — because the storage we move to is S3-compatible and belongs to neither host. If we later go to Supabase, the photos do not move again; only a configuration value changes.
- Kills the compounding cost before launch, which is the whole point of SYC-46.
- The hosting question gets decided in October–December, on evidence: real traffic numbers, a real bill, a tested restore, and the roles work in front of us where Supabase's sign-in either earns its place or doesn't.
- Cloudflare R2 charges nothing for bandwidth, which is exactly the shape of our costs — summer browsing spikes, tiny stored volume.

**Risks**
- One more supplier account (Cloudflare) alongside Replit. Mitigated: it is one bucket, two keys, and the code talks to it through a standard S3 interface that any of the three could serve.
- Leaves SYC-47 formally open past launch. Mitigated by writing the trigger down (§4.1) so "later" doesn't mean "never".
- If the charity-credit hunt turns up a large Supabase or AWS grant, we may wish we had committed. Mitigated: neutral storage is precisely what keeps that door open.

---

## 4. Recommendation

**Take Option D.**

1. **Photos move out of the database now, during testing, into an S3-compatible bucket — Cloudflare R2 as the default target.** This is SYC-46, and it is the only infrastructure change that goes in before launch.
2. **Compute and the database stay on Replit through launch.** This confirms what the deployment runbook already assumes, so the runbook needs no rewrite for October — only the new storage settings in §C.
3. **SYC-47 is answered as "Replit through launch, decided properly in Phase 3"**, with a written trigger, not a vague intention.

**Why not Supabase now, given the recommendation on record was Supabase?** Because the case for Supabase is its sign-in and its row-level security, and neither is used until the roles-and-invites work in Phase 3. Buying them in September means paying a second plan fee and spending our scarcest resource — the September window, where the store submissions are the real risk — on a change no user will notice. Doing the storage move neutrally means the Supabase option costs no more in December than it does today. The direction of travel is not being rejected; the timing is.

**What would change this recommendation:** a charity grant that materially favours one platform; the compute bill proving unpredictable during testing; or Replit's managed database failing a restore test. Any of those pulls the decision forward.

### 4.1 The Phase 3 trigger (write this into SYC-47)

Re-open the hosting decision in **October–December 2026**, and decide it against these tests:

- Are we about to build real accounts for cat guardians, volunteers and vets? (If yes, Supabase's sign-in and row-level security are worth real money.)
- What did the first two months actually cost, and how predictable was it?
- Has a database restore been performed successfully at least once?
- Did the charity credit hunt land anywhere?

### 4.2 What this does to the deployment runbook

`docs/DEPLOYMENT.md` §C changes as follows, and nothing else in the runbook moves:

- The hosting-call line stands as written: compute stays on Replit through launch. Add the Phase 3 trigger above.
- The photo line gains the target (R2 bucket, private) and three new production settings: bucket name, access key, secret.
- The production-database line gains an explicit **restore test** for the migrated schema — not just "backups on", but one real restore performed and dated.
- Add a bucket-level lifecycle and access check to the launch-day list: bucket is private, no public listing, keys scoped to the one bucket.

---

## 5. Photo storage — the design

*This section is technical. §5.1 is the plain-English version of what changes for a person using the app: **nothing**. Photos upload the same way, appear the same way, and the offline queue behaves exactly as it does today. Everything below is machinery.*

### 5.1 The user-visible contract

- A spotter takes a photo. It uploads when there is a connection, and waits on the phone when there isn't.
- Photo web addresses stay `/api/photos/:id` and stay permanent. Anything already saved, cached, or linked keeps working.
- The public sees cat locations **approximately**; the Syros Cats team sees exact locations. Photos must never leak the exact spot through hidden data inside the image file.

### 5.2 Schema change

`photos` gains columns and keeps its integer primary key so every existing URL, foreign key (`cats.primary_photo_id`, `sightings.photo_id`) and cached client reference stays valid:

| Column | Purpose |
|---|---|
| `storage_key text` (nullable) | Path inside the bucket, e.g. `photos/2026/09/000123-a91f3c.jpg` |
| `bytes integer` (nullable) | Stored size, for cost reporting and integrity checks |
| `checksum text` (nullable) | SHA-256 of the stored bytes; proves the backfill copied faithfully |
| `visibility text` default `'public'` | `'public'` for cat photos, `'restricted'` for feeding-site and welfare-report photos |
| `data text` | **becomes nullable**; retained through the rollback window, then dropped |

A row is authoritative on `storage_key` when it is non-null; `data` is only read as a fallback. That single rule is what makes the migration reversible.

### 5.3 Upload path

The client keeps sending base64 JSON to `POST /api/sightings` — unchanged on purpose, because changing the upload contract mid-test would invalidate the testers' builds and put the Play 14-day clock at risk.

Server-side, after the existing validation and normalisation (`imageValidation.ts`: format sniffing, HEIC conversion, EXIF-orientation applied, resize to 2048px, JPEG quality 80, 5 MB cap):

1. Compute the checksum, allocate the photo row, derive `storage_key` from the id plus a random suffix (the suffix stops anyone guessing keys if the bucket is ever fronted publicly).
2. `PutObject` to the bucket with `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`, and no ACL — the bucket is private.
3. Write the row with `storage_key`, `bytes`, `checksum`. On storage failure, fall back to writing `data` and log loudly; a spotter never loses a sighting because a bucket had a bad minute.

**EXIF safety.** The sharp re-encode already drops metadata, which means embedded GPS coordinates do not survive into the stored file. This must be covered by an explicit test (`imageValidation`), because it is now load-bearing for the blurred-location promise: a downloadable photo file with GPS inside it would hand out exactly the data we blur in the API.

Direct-to-bucket uploads with pre-signed URLs are deliberately **not** in scope. They would change offline retry semantics (a two-step upload can half-fail) for a bandwidth saving we do not need at this scale. Revisit at MLP.

### 5.4 Serving path and access control

`GET /api/photos/:id` stays the only public entry point and **streams the bytes through the API** rather than redirecting:

- Look up the row. If `storage_key` is set, fetch from the bucket and pipe; otherwise decode `data` (the rollback path).
- Keep `Cache-Control: public, max-age=31536000, immutable` — photos never change once stored, so browsers and any CDN in front absorb repeat views and the bucket is barely touched.
- Support `If-None-Match` / ETag from the object's checksum so repeat views cost nothing.

**Why stream rather than redirect to a signed URL:** URLs stay permanent and cacheable, access control stays in one place (our code), and R2's zero egress means there is no bandwidth saving to chase. The cost is that photo traffic passes through the API — acceptable at these volumes, and the immutable cache header means it is almost all cache hits.

**Restricted photos** (`visibility = 'restricted'` — feeding sites, welfare reports) are served only to an authenticated team session, with `Cache-Control: private, no-store`, and are excluded from any CDN caching rule.

**Location blurring is a separate concern and stays in the API responses:** public endpoints round coordinates to an approximate grid; team endpoints return exact values. The photo change must not become a side door around that — hence the EXIF test above and a test asserting that no public photo response carries location data.

### 5.5 The AI matching coupling (the non-obvious one)

`matching.ts` builds its OpenAI request from candidate photos read as base64 straight out of Postgres (`sightings.ts` selects `photosTable.data` for each candidate cat within 500 m). Once photos live in the bucket, that read must come from storage instead. Three consequences:

- Every match now costs several bucket reads. Cheap, but latency adds up when a spot compares against a dozen nearby cats.
- Mitigation: cache candidate bytes in-process (small LRU, keyed by photo id — the same nearby cats recur constantly), and/or store a 512px **matching derivative** alongside the full photo, which also cuts the vision-model token cost.
- The fallback path must handle mixed state during the backfill: some candidates from the bucket, some still from `data`. One helper (`loadPhotoBytes(photoId)`) used by both the serve route and the matcher, so there is exactly one place that knows where bytes live.

### 5.6 Backfill of existing photos

An idempotent script, safe to run repeatedly while the app is live:

1. Select rows where `storage_key IS NULL AND data IS NOT NULL`, in batches of 100, oldest first.
2. For each: decode, checksum, `PutObject`, then update the row with `storage_key`/`bytes`/`checksum`. Nothing is deleted in this pass.
3. Verify: re-fetch a random 5% sample from the bucket and compare checksums; refuse to proceed if any mismatch.
4. Only after the rollback window (§5.7): a second pass sets `data = NULL` for rows with a verified `storage_key`.
5. Reclaim the space explicitly. Nulling a text column does not shrink a Postgres table — the storage bill only drops after `VACUUM FULL` or `pg_repack` on `photos`. This step is the actual saving; skipping it means paying for nothing.

At MVP volumes this is minutes, not hours. It runs against the test data during 1–14 September and again against production before launch.

### 5.7 Rollback

A single environment setting, `PHOTO_STORAGE = db | dual | object`, defaulting to `dual` from the day the code ships:

- `dual` — new photos are written to **both** the bucket and `data`; reads prefer the bucket, fall back to `data`. Storage cost is briefly doubled and it is trivially reversible.
- `object` — new photos go to the bucket only. Flip after the backfill verifies and the app has run clean for a week.
- `db` — the panic switch. Because `data` was never dropped, flipping back restores exactly the current behaviour with no data loss.

The `data` column is dropped only after **30 days** on `object` with no incidents, and only once a database backup taken before the drop has been restore-tested.

### 5.8 The offline queue

Nothing changes, and it is worth stating why.

The queue already keeps photos as **files in the app's document directory** and stores only the file path (`pendingPhotos.ts`); base64 inside the queue is a web-preview fallback and a legacy path. When a connection returns, the queue reads the file and posts it through the same endpoint as before. Since the upload contract (§5.3) is unchanged, the server-side move is invisible to it. Queue items already in flight during the deploy sync normally.

Two things to be precise about, because they get overstated:

- **Offline support is partial.** Spotting works offline: photos and locations are captured, held on the phone and synced later, and map tiles that were pre-downloaded still render. Everything that needs the server — AI matching, the catalogue beyond what's cached, the leaderboard, notifications — waits for a connection. Nothing in this change alters that boundary in either direction.
- **A stale queue is a real failure mode.** Items older than 30 days are already flagged as unsyncable. A volunteer without mobile data for weeks can lose sightings, and that is a pre-existing product question, not something this migration creates or fixes.

---

## 6. Sequencing

The hard constraint is Google Play: a closed test needs **12+ testers opted in for 14 continuous days** before production access can even be applied for. That clock is the critical path to October, and anything that breaks testers' builds mid-test costs us weeks, not days.

### Must land before launch

| When | What | Why it can't wait |
|---|---|---|
| **1–14 Sep** (during testing) | Storage code behind `PHOTO_STORAGE=dual`, deployed to the API only | Server-side only — no new store build, no interruption to the Play clock |
| **1–14 Sep** | Backfill run against test data + checksum verification | Proves the script before it touches anything that matters |
| **1–14 Sep** | R2 bucket created, keys scoped, private-by-default verified | One afternoon; blocks nothing else |
| **1–14 Sep** | EXIF-stripping test and the "no location in public photo responses" test | The blurred-location promise now depends on them |
| **15 Sep – early Oct** | Production backfill, then flip to `object`, then `VACUUM FULL` | The saving isn't real until this runs |
| **15 Sep – early Oct** | Backups on **and one restore actually performed and dated** | Already in the runbook; the schema change makes it more urgent, not less |
| **Launch-day check** | Bucket private, keys scoped, photos serving from storage | Cheap final check |

### Can wait — and should

| What | When | Why |
|---|---|---|
| The Supabase-vs-Replit decision itself | Phase 3, Oct–Dec | Quiet season; decided against evidence and alongside the roles work that justifies it |
| Dropping the `data` column | 30 days after the flip to `object` | The rollback path is worth more than the disk |
| Direct-to-bucket uploads with pre-signed URLs | MLP | Changes offline retry semantics for no benefit at this scale |
| A CDN in front of photos | When bandwidth says so | Immutable cache headers already do most of this work |
| Matching derivatives (512px copies) | Phase 3 | An optimisation, and it wants real matching-cost data first |

### Explicitly not during 1–14 September

No database move, no domain change, no compute migration, no change to the upload contract. The test window has one job: get 12+ testers through 14 unbroken days while we shake out the §2 product changes.

---

## 7. Risks and open questions

| # | Risk / question | Impact | Owner | Handling |
|---|---|---|---|---|
| R1 | Backfill corrupts or loses photos | Severe and irreversible — these are volunteers' contributions | Build | Nothing deleted in the copy pass; checksum verification; `data` retained 30 days; restore-tested backup before the column drop |
| R2 | A change during 1–14 Sep breaks testers and resets the Play 14-day clock | Launch slips past October | Samuel | Storage change is API-only and dual-mode; no new store build required; no upload-contract change |
| R3 | Photos leak exact cat or feeding-site locations via EXIF in the image file | Breaks a promise made to Syros Cats about targeting | Build | Re-encode already strips metadata; add explicit tests; restricted-visibility photos never cached |
| R4 | AI matching slows or costs more once candidate photos come from storage | Spotting feels sluggish at exactly the moment a user is waiting | Build | Shared `loadPhotoBytes` helper, in-process cache, matching derivative if measurement says so |
| R5 | Postgres storage doesn't actually shrink after the migration | We do the work and keep paying anyway | Build | `VACUUM FULL`/`pg_repack` is an explicit, verified step with a before/after size recorded |
| R6 | Supplier prices in §2 are wrong or stale | A recommendation built on bad numbers | Samuel | Re-check all three suppliers' published prices at the moment of committing; the argument (storage compounds, hosting doesn't) survives moderate price changes |
| R7 | An unpredictable compute bill on Replit's usage-based autoscale | A charity gets a surprise invoice | Samuel | Billing alert set before launch; rate limiting and immutable cache headers already in place; pulls the Phase 3 decision forward if it bites |
| R8 | Adding Cloudflare means a third supplier account for a small charity to eventually own | Handover complexity | Samuel | Weigh at handover; the S3-compatible interface means the bucket can move to whoever ends up holding the bill |
| **Q1** | **Do charity/startup credits exist that change this?** Cloudflare's nonprofit programme, Google for Nonprofits, AWS and Supabase credits are all worth an hour's asking. A material grant could justify committing to a platform now rather than in December. | Samuel | Open — flagged in spec §5 |
| **Q2** | **Who owns the accounts and the bill at handover — Fair Shake or Syros Cats?** This shapes the hosting choice more than price does: a charity that will one day self-administer wants fewer suppliers and simpler bills, which favours Supabase in Phase 3. | Samuel | Open — needs an answer before the Phase 3 decision, not before launch |
| **Q3** | Which entity publishes in the stores (already in the runbook) interacts with Q2 — same question, different surface | Samuel | Open |

---

## 8. What Samuel needs to decide

1. **Approve Option D** — photos out now to neutral (R2) storage; hosting decided in Phase 3 against the written trigger. This overrides the "Supabase" recommendation currently on record in SYC-47 on timing grounds, not on merits, so it needs an explicit yes.
2. **Q1 — charity credits.** Worth an hour before the bucket is created, because a large grant is the one thing that would change the target.
3. **Q2 — who owns the bill long-term.** Not urgent for October, but it is the real input to the Phase 3 hosting call, and answering it now costs nothing.
