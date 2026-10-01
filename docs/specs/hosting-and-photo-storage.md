# Hosting, photo storage and migrations — spec

**Tickets:** SYC-47 (hosting: Supabase vs Replit) · SYC-46 (photos out of Postgres) · plus new work in §4 and §6
**Owns:** hosting, photo storage, `GET /api/photos/:id`, database migrations. Everything else is referenced, not restated — see `DECISIONS.md` Part 3.
**Relates to:** [PRODUCT-SPEC.md](../PRODUCT-SPEC.md) §2.8 and §4 · [DEPLOYMENT.md](../DEPLOYMENT.md) §C · [cat-record-data-spine.md](./cat-record-data-spine.md) · [team-access-and-welfare-queue.md](./team-access-and-welfare-queue.md) · [email-capture.md](./email-capture.md)
**Status:** **Approved by Samuel, 28 September 2026**, with the photo retention rule added (§6.7). Rewritten 3 September 2026 to record the decisions in [DECISIONS.md](./DECISIONS.md) and the findings in [the adversarial review](./reviews/hosting-and-photo-storage-review.md).
**Window:** September schema work, then the Google Play 14-day closed test · launch October 2026 · MLP by end March 2027.

---

## 1. The short version

Cat Spotters keeps every photo a spotter takes. Those photos live **inside the database**, stored as text. A database is an expensive place to keep a picture — but it works, nobody using the app can tell, and at the sizes we are talking about it is a few euros a month, not a few hundred.

An earlier draft of this document recommended moving the photos out to file storage before launch, and argued it was ten times more important than the hosting question. **That recommendation has been rejected, and the arithmetic behind it was wrong.**

**The decision: everything stays on Replit for now.** Photos stay in Postgres. No object-storage migration before launch, no hosting change. The reason is build speed — September is spent on the four specs' product work and getting testers through the Play window, not on infrastructure that saves about one euro a month at launch.

**The cost we are knowingly accepting.** The migration is free *today*. The API has never been deployed (`DEPLOYMENT.md` §C still has "Deploy the API as a Replit deployment" and "Production Postgres" unticked), so there is no production photo corpus. Moving the write path before the first real photo is written would mean no back-fill, no copy, no risk. **The moment real spotters' photos exist, that stops being true.** It becomes a migration that copies irreplaceable volunteer contributions between two systems, which needs verification, a rollback window and a maintenance plan. We are choosing to pay that later price in exchange for September. That is a deliberate deferral, recorded here so nobody later reads it as an oversight.

To stop "later" meaning "never", §4.2 gives the deferral a due date, an owner and a default outcome.

**What this document actually asks for in September** is three things, none of them a migration:

1. **Real database migrations, before the Play clock starts** (§3). This is the most important section here. Roughly twelve new tables arrive from the other three specs, and today the only way this repo changes its schema is a command that has already broken every endpoint once.
2. **Harden the photo endpoint** (§5). It is currently open to the world with sequential ids and no rate limit.
3. **Write the EXIF test** (§5.4). The promise that photos do not leak exact cat locations rests on a behaviour nothing tests.

For a charity spending **€50–60 to sterilise a single cat**, the entire hosting bill at launch scale is worth less than one cat a month. That is the frame: we are not optimising pennies. We are making sure the bill never quietly grows into something Syros Cats cannot carry, and that we are never trapped on one supplier.

---

## 2. What we are actually paying for

Four separate things, usually bundled and confusingly named:

| Thing | Plain English | How it grows |
|---|---|---|
| **Compute** | The machine that answers the app's requests | With how busy the app is. Goes back down in winter. |
| **Database** | The records: cats, sightings, points, colonies — and today, the photos | Text records grow slowly. Photos do not. |
| **File storage** | Where photos would live if we moved them | Forever upward. Never shrinks. |
| **Bandwidth** | Photos travelling out to phones | With how much people browse. Peaks in tourist season. |

Only one of these compounds: **the photos**, wherever they are kept. Everything else goes up and down with the season.

### 2.1 The volumes we are planning for

Every photo is resized to at most 2048px and re-encoded as JPEG before storage, so a stored photo is roughly **0.5 MB**. Held as text inside the database, it inflates by about a third.

| | Launch — Oct 2026 to Mar 2027 (low season) | MLP — the 2027 season (Apr–Sep 2027) |
|---|---|---|
| Installs | ~400 | ~6,000 (tourists dominate) |
| Sightings / photos | ~6,000 total | ~60,000 in the season |
| Photo bytes | ~3 GB | ~35 GB cumulative |
| Same photos held as text in the database | ~4 GB | ~47 GB |
| Other database content | under 0.2 GB | under 1 GB |
| Photo bandwidth, busy month | ~5 GB | ~120 GB |

**These are planning figures on the generous side, not forecasts, and they are asserted rather than derived.** 6,000 installs producing 60,000 sightings assumes ten spots per install; 400 installs producing 6,000 assumes fifteen. Real volunteer apps are heavily long-tailed — a median user submits one or two. The honest read is that these are an *upper* band, and §2.3 tests the conclusion against a third of them as well as three times.

### 2.2 What it costs — corrected

Supplier list prices as at 3 September 2026, in US dollars because that is how they are billed; roughly ×0.92 for euros. **These must be re-checked at the moment of committing to anything** — see R5, and note that this document exists partly because the previous version was priced against a rate Replit had already cut.

**Replit cut PostgreSQL data storage from $1.50 to $0.35 per GiB-month, and deployment egress from $0.10 to $0.05 per GiB, effective 1 August 2026** ([Replit's August 2026 cloud billing update](https://docs.replit.com/billing/aug-cloud-billing-updates)). The earlier draft of this spec was written a month later and still used $1.50. Every headline number in it was therefore about 4× too high.

| Cost line | Stay as we are — photos in Postgres | Photos in object storage (R2), rest unchanged | Everything on Supabase |
|---|---|---|---|
| Database storage | ~$1.40/mo at launch → **~$16/mo at MLP** ($0.35/GiB-month) | under $0.10/mo — the database becomes tiny | included in the plan (8 GB), then $0.125/GB |
| File storage | n/a | ~$0.05/mo at launch → ~$0.53/mo at MLP ($0.015/GB-month) | included (100 GB), then $0.021/GB |
| Photo bandwidth | Replit egress, $0.05/GiB — ~$0.25/mo at launch, ~$6/mo in a busy MLP month | **the same Replit egress** — see the note below | 250 GB included, then $0.09/GB |
| Compute | ~$5–15/mo usage-based | ~$5–15/mo usage-based | still needs a home (see §3) |
| Plan fee | Replit Core $25/mo, already paid, and it is also the build environment | same | Supabase Pro $25/mo on top of, or instead of, Replit |
| **Realistic MLP total** | **~$50–60/mo** | **~$35–45/mo** | **~$55–70/mo** (both plan fees) or ~$35–45 (if Replit goes away) |

**The ratio.** Database storage is $0.35/GiB-month against object storage at $0.015/GB-month — **about 23×**, or about 31× once the base64 inflation is counted. Not the 60× previously claimed.

**The R2 "$0 egress" trap.** R2 charges nothing for bandwidth, and that was the previous draft's deciding reason for choosing it. But the same draft then had every photo streamed through the Express API rather than served from a Cloudflare domain — in which case **100% of photo bandwidth is billed as Replit egress anyway**, and R2's zero-egress benefit is designed away. The table above reflects that honestly: photo bandwidth is a Replit egress line in *both* of the first two columns. If we ever do move photos, R2 should be argued on S3-compatibility and supplier neutrality, which is a perfectly good argument, or the serving design has to change (§6.4).

R2 also bills operations — $4.50 per million writes, $0.36 per million reads, with 1M/10M free each month. At our busiest projected month (~120 GB ÷ 0.5 MB ≈ 240,000 reads) this is inside the free tier and rounds to zero. Noted so the model is complete.

The Supabase column has been re-checked and is accurate: Pro $25/mo, 8 GB database then $0.125/GB, 100 GB storage then $0.021/GB, 250 GB egress then $0.09/GB.

### 2.3 Does the conclusion survive different volumes?

The previous draft claimed one decision was "ten times more important than the other". **That claim is false, and it is dropped.** Here is the test it never ran:

| Volume vs plan | Photo bytes at MLP | As base64 in Postgres | Postgres storage cost | Saving from moving photos |
|---|---|---|---|---|
| ⅓ of plan | ~12 GB | ~16 GB | ~$5.50/mo | **~$5/mo** |
| As planned | ~35 GB | ~47 GB | ~$16.50/mo | **~$16/mo** |
| 3× plan | ~105 GB | ~140 GB | ~$49/mo | **~$48/mo** |

The hosting decision moves the total by roughly **$20–25/month** either way. So:

- **Below plan** — the more likely direction for a first-season charity app on an island of 22,000 people — the hosting decision is the **bigger** of the two.
- **At plan**, they are the same size.
- **Only at roughly 2× plan or above** does the photo move become the larger line.

In the launch window itself, moving photos saves about **$1.40 a month**. That is the number to hold in mind when weighing it against a week of September.

**What this means for the decision.** The money does not make the photo move urgent. If there is a case for doing it early, it is the *migration-size* case — zero rows is easier to move than any rows — and that case is about future risk, not this year's bill. §3 takes it on those terms.

---

## 3. The hosting and storage decision

**The question:** where should the Cat Spotters backend — the machine, the database, the photos, and the staff sign-in that ships this month — live from October 2026 onward, and do the photos move out of the database before launch?

All options assume the September work in §4 (migrations) and §5 (photo endpoint) happens regardless. Those are not optional under any of them.

### Option A — Everything stays on Replit; photos stay in Postgres *(chosen)*

**What it means for people using the app:** nothing changes. The app tested in September is the app that launches. Photos load exactly as they do today.

**Benefits**
- **The September window goes to the product.** Four specs' worth of schema and features have to land before the Play clock starts. This is the only option that spends none of that window on infrastructure.
- Zero migration risk during the only window we have.
- The AI photo matching runs through Replit's built-in OpenAI integration. Staying means not swapping it for a raw API key mid-sprint.
- Replit is also the build environment, so the plan fee is already paid. One account, one bill, one set of credentials.
- Cheapest total while the app is small.

**Risks**
- **The migration stops being free.** This is the real cost and it is accepted deliberately (§1, §4.2). Today there is nothing to move; from the first production photo onward, moving means copying volunteers' irreplaceable contributions between two systems.
- Database storage is the expensive place to keep photos — about 23× object storage. At MLP that is ~$16/month, growing, and it never comes back down.
- Autoscale compute billing is usage-based and less predictable than a flat fee. **A bot scraping photos could produce a surprising bill, and today nothing prevents that** — §5 fixes it. (The previous draft claimed rate limiting already covered the photo route. It does not: `middlewares/rateLimit.ts` defines one limiter and applies it only to `POST /api/sightings` and `POST /api/cats/name-suggestions`.)
- Replit is a build-and-host product first. Backups and restore need proving, not assuming.
- No sign-in product, so the MLP roles-and-invites work is ours to build. (The single staff sign-in shipping this month is a different, much smaller thing — see below.)

### Option B — Move to Supabase now (database + file storage + sign-in in one)

**What it means for people using the app:** nothing visible, if it goes well. If it goes badly at the wrong moment, testers hit a broken app during the 14-day Play test and the clock restarts.

**Benefits**
- One predictable bill covering database, photo storage and bandwidth, with allowances (100 GB storage, 250 GB egress) that comfortably cover the 2027 season.
- Sign-in as a product. **MLP needs real accounts for cat guardians, volunteers, vets and the Syros Cats team** — that is the strongest argument for Supabase, and it is a Phase 3 argument.
- Standard Postgres underneath. Leaving is a `pg_dump` away.

**Risks**
- Supabase does not run our Node API. Compute still needs a home — Replit, Fly, Render — so "one bill" is only one bill if we also move compute, which is a second migration.
- **It costs the September window**, which is the scarce resource: new database, new connection strings, new secrets, replacing the Replit OpenAI integration, re-testing push and email, re-pointing the domain — while the store submissions are the actual critical path.
- **Row-level security is not the free win it looks like.** `lib/db/src/index.ts` connects with a plain `pg.Pool` on a single connection string. Under that model RLS does nothing unless the whole data-access layer is re-architected to pass per-user credentials on every request. It would be a real safety improvement one day; it is not something that arrives with the platform.
- Its file storage charges for egress past the allowance where R2 does not — small but real at tourist-season browsing.

**A note on the sign-in argument, because the previous draft got it backwards.** That draft said Supabase's sign-in "isn't used until Phase 3". That is false: `PRODUCT-SPEC.md` §2.6 ships one Syros Cats staff sign-in **this month**, and `DECISIONS.md` F5 confirms it, with the trust boundary owned by `team-access-and-welfare-queue.md`. The honest argument is the other one: **MVP needs exactly one staff login, which is hours of work and does not justify a platform migration.** Phase 3 needs a real multi-role invite system, which is where an auth product earns its keep.

### Option C — Photos out to neutral object storage now, hosting decided later

**What it means for people using the app:** nothing changes; photo web addresses stay the same.

**Benefits**
- **The migration is free exactly once, and this is the window.** With no production corpus, there is no back-fill, no dual-write mode, no rollback window, no `VACUUM FULL`, and the "we corrupt volunteers' photos" risk simply does not arise. That, not the money, is the honest case for doing it now.
- Kills the only compounding cost line before it starts compounding.
- S3-compatible storage belongs to neither host, so a later hosting move does not move the photos again.

**Risks**
- It costs September days that the product work needs — realistically more than the previous draft estimated, because it requires a storage abstraction with an in-memory fake for tests and local development, plus edits to five existing test files and the security-check script (§6.5).
- One more supplier account for a small charity to eventually own.
- Saves ~$1.40/month in the launch window.

### Option D — Move both: Supabase and photos to Supabase Storage, in September

Rejected without extended argument. It combines Option B's window cost with Option C's, in the one month where the store submissions and twelve new tables are the critical path. Nothing about the current bill justifies it.

### The recommendation, and the decision taken

**The recommendation on merit would be Option C** — do the photo move while it is free, on migration-size grounds, and answer hosting later. That is a defensible call and it was the previous draft's answer, though for the wrong reason.

**The decision taken is Option A: everything stays on Replit, photos stay in Postgres.** Samuel's call, on build speed. Given the corrected numbers this is a reasonable trade: Option C buys ~$1.40/month at launch and removes a future risk, at the price of days in the one month that cannot slip. Option A buys those days and accepts the future risk.

**What is being traded away, stated plainly, so it is not rediscovered in March:** the ability to do this move for free. That window closes on the day the API is first deployed with a real database behind it. After that, SYC-46 is a data migration with everything a data migration needs. §6 keeps the full design ready for that day.

---

## 4. What "deferred" means concretely

### 4.1 The two tickets

- **SYC-46 (photos out of Postgres)** — deferred, not closed. Re-scoped: it is now a data migration, not a write-path change. §6 is its design.
- **SYC-47 (hosting: Supabase vs Replit)** — deferred, not closed. Answer: **Replit through launch.**

### 4.2 The trigger — a date, an owner and a default

A checklist of questions is not a trigger. The previous draft had four good questions with nothing to fire them, and the review's judgement was blunt: without teeth, SYC-47 is still open in March 2027 and the decision gets made by drift. So:

| | |
|---|---|
| **Due date** | **15 November 2026** |
| **Owner** | Samuel |
| **Required inputs** | Two months of actual invoices (Oct + Nov) · one database restore performed and dated · the real photo volume and photo bandwidth from the launch period · an answer on charity credits (Q1) · an answer on who owns the bill at handover (Q2) |
| **The decision** | Both tickets together: does anything move before the 2027 season? |
| **Default if the date passes undecided** | **Replit and photos-in-Postgres stand through the 2027 season. SYC-47 closes. SYC-46 stays open, re-scoped as a data migration with a full risk register, and is re-examined at the end of the 2027 season.** |

The default is written down because it is the likely outcome and it should be *chosen*, not drifted into. Q1 (charity credits) needs its own answer by **31 October 2026**, since the hosting decision depends on it.

**What would pull the decision forward regardless of the date:** a charity grant that materially favours one platform; the compute or storage bill proving unpredictable during launch; Replit's managed database failing a restore test; or photo volume running above 2× plan, at which point §2.3 says the photo move becomes the larger line.

### 4.3 Documents that must be corrected

Two live planning documents currently say the opposite of this decision, and this repo's standing rule is that state claims come from live sources. Both need editing as part of accepting this spec:

- **`docs/PRODUCT-SPEC.md` §2.8** — currently reads *"Hosting decision resolved: Supabase vs Replit (recommendation stands: Supabase)"*. Replace with: hosting resolved as Replit through launch; re-opened 15 November 2026 per SYC-47.
- **`docs/DEPLOYMENT.md` §C** — currently reads *"Photos out of Postgres into object storage now … the one infrastructure change worth making before launch"*. Replace with: photos stay in Postgres for launch; SYC-46 deferred with the trigger above. §C also gains the migration steps from §4 of this spec and the photo-endpoint hardening from §5.

**Also correct, in both this document and anywhere it was repeated:** the claim that the photo move was "the only infrastructure change before launch" was never true. In the same window, the other three specs add roughly twelve tables, a mail transport with two sending identities (`DECISIONS.md` D2, owned by `email-capture.md`), a staff sign-in and trust boundary (F5, owned by `team-access-and-welfare-queue.md`), and client changes to the spot flow. Infrastructure is busy in September; that is precisely why the photo move is being deferred.

---

## 5. September work — migrations *(the most important section here)*

**In plain English:** the way this project changes the shape of its database is currently to run a command that looks at the code, looks at the live database, and edits the database to match. There is no record of what it did and no way to undo it. That has already gone wrong once: a column that existed in the code was never applied to the database, and every endpoint that touched it returned a server error that looked like an application bug (`.agents/memory/db-schema-drift.md`). Twelve or so new tables are about to arrive. If that happens again during the Play test, every spot fails for every tester, they disengage, the opt-in count drops below twelve, and the October launch goes with it.

`DECISIONS.md` F6 sets two requirements. Both are owned here.

### 5.1 Requirement one — all September schema work lands before the Play clock starts

The Google Play closed test needs **12+ testers opted in for 14 continuous days** before production access can be applied for. That clock is the critical path to October.

**The sequencing rule: every schema change from all four September specs is applied and smoke-tested *before* the 14-day test begins.** Not during it. This is the single measure that protects the October launch, and it costs nothing but ordering.

A correction to the previous draft's reasoning here, because it protected the wrong thing. It framed the risk as "a change during the test resets the 14-day clock", mitigated by the change being API-only with no new store build. **New builds do not reset the clock** — Play's requirement is about testers *remaining opted in*, which the runbook's own §G says. And new builds are happening anyway: the spot flow gains a clipped-tip question, a per-sighting note and a food/water question in this same window. The upload contract is not frozen and never was.

**The real failure mode is testers seeing a broken app.** API 500s or photos that fail to load make the app look dead; testers uninstall; the opt-in count falls below twelve. That points straight at the schema work — which is why it goes first, with a smoke test behind it.

### 5.2 Requirement two — generated migrations with checked-in history, and a verified rollback

Verified in the code today: there is **no migrations directory** anywhere in `lib/db`. `lib/db/package.json` exposes exactly two scripts, `push` and `push-force`, both `drizzle-kit push`, which diffs the schema against the live database and applies the DDL directly — no version, no down-step, no review artefact, no rollback.

**What lands, before any of the twelve tables:**

1. **Adopt `drizzle-kit generate`.** Migration SQL files are generated, **reviewed as part of the pull request**, and committed to `lib/db/migrations/`. `push` and `push-force` are removed from the package scripts so nobody reaches for them by habit.
2. **A `migrate` script** that applies pending migrations in order against a target database, and records what it applied.
3. **A baseline migration** capturing the current schema, so the history starts from a known state rather than from nothing.
4. **Every migration ships with a rollback**, either a generated down-migration or a hand-written, reviewed `-- rollback:` block in the same file. Additive changes (new nullable columns, new tables) roll back trivially; anything destructive needs its rollback written and reviewed before the forward step is allowed to run.
5. **The rollback is actually exercised, not assumed.** Before the Play window, run one full up-then-down-then-up cycle against a scratch database restored from a production-shaped dump, and record the result with a date. A rollback nobody has run is not a rollback.
6. **Order of operations for every deploy that changes the schema:** apply the migration first, verify, then deploy the code that depends on it. Additive-and-nullable first, code second, any constraint tightening third and separately.
7. **A smoke test immediately after every migration**, hitting `POST /api/sightings`, `GET /api/cats` and `GET /api/photos/:id` and asserting 2xx. If it fails, roll back the same hour. Named owner: Samuel.
8. **CI enforces it.** A check fails the build if the Drizzle schema and the committed migration history disagree — this is exactly the drift that caused the incident, and it is cheap to catch mechanically.

### 5.3 What this means for the other three specs

Every table the other specs introduce arrives through this mechanism. They own *what* their tables look like; this document owns *how* any schema change reaches a database. In particular, `cat-record-data-spine.md` owns the redaction/tombstone column that F3 requires be added now rather than across two seasons of observations — it arrives as a generated migration like everything else.

---

## 6. September work — the photo endpoint

`DECISIONS.md` F7a: unguessable ids, rate limiting, tighter CORS. Photos must still load for anonymous users, because the app has no login and the whole catalogue is public. **Signed expiring URLs were rejected** — they fight the offline design, since a URL would expire exactly when a spotter is out of signal and holding a cached page.

### 6.1 What is wrong today

Verified in `artifacts/api-server/src/routes/photos.ts` and `app.ts`:

- **Sequential integer ids.** The primary key is a `serial`, so photo #1 through photo #N can be walked by anyone with a loop.
- **No rate limit.** `middlewares/rateLimit.ts` defines one limiter (`aiLimiter`) and applies it to two POST routes. The photo route has none.
- **No origin restriction.** `app.use(cors())` with no options allows any website on the internet to hotlink every photo.
- **Usage-billed compute behind all of it**, with no CDN.

A single scraper walking the id range pulls the entire photo corpus through billed compute and billed egress. The previous draft recorded this risk as *mitigated by rate limiting and cache headers, both of which exist*. That was false and is the reason it went unfixed.

### 6.2 What changes

1. **Unguessable ids for photo URLs.** Add a `public_id text unique not null` column holding a UUID v4 (36 characters, hyphenated), generated by the database default `gen_random_uuid()` rather than minted in application code. Decided 1 Oct 2026 (SYC-98): an earlier draft of this spec called for a ~22-character base62 token minted in app code, but the UUID is kept — it's equally unguessable (128 bits of randomness either way), the database generates it for free on every insert with no app-level code path to maintain, and it's an internal identifier testers never see or type. `GET /api/photos/:publicId` becomes the served route. The integer primary key **stays** — every internal foreign key (`cats.primary_photo_id`, `sightings.photo_id`) is unchanged, and `catHelpers.photoUrl()` is the single place in the codebase that builds a photo URL, so exactly one function changes. The numeric route is kept as a redirect for one release so any cached client reference keeps working, then removed.
   - **Mind the sentinel:** `routes/cats.ts` registers resident-owned cats with `primaryPhotoId: 0` deliberately, and relies on the photo route 404ing for it. Zero is not a real row and `cats.primary_photo_id` is not an actual foreign key. The URL builder must return null for id 0 rather than minting a token, with a test pinning it.
2. **A per-IP rate limiter on the photo route.** Generous enough that a tourist browsing the catalogue never notices — a few hundred photos per fifteen minutes — and tight enough that walking the corpus is not viable. Sits alongside `aiLimiter` in the same middleware file.
3. **Tighter CORS.** Replace bare `cors()` with an explicit allowlist: the app's own origins, the admin dashboard origin, and the Expo development origins. Images requested by `<img>` do not need permissive CORS headers to display, so this costs nothing user-visible while removing casual hotlinking.
4. **Keep `Cache-Control: public, max-age=31536000, immutable`,** and add `ETag` plus `If-None-Match` support so repeat views cost nothing.
5. **A billing alert on the Replit account before launch**, so an unexpected pattern shows up as a message rather than an invoice.

### 6.3 The privacy chain this breaks

`cat-record-data-spine.md` owns location blurring and describes a chain by which someone could work backwards from public data to a cat's real position. **Unguessable photo ids remove the first ingredient in that chain**: with sequential ids, an attacker can enumerate the whole corpus and correlate photos against published approximate positions. With random ids they can only see what the app already shows them. This does not solve the location problem — the nearest-cat oracle and the colony-averaging limitation in F2 are the data spine's to handle — but it removes the cheapest way in, and the data spine should be able to assume it.

### 6.4 EXIF stripping — verified correct, and untested

**The promise:** a photo file downloaded from the app must not contain the GPS coordinates of where it was taken. Otherwise the blurred locations in the API are decoration — anyone could read the exact spot straight out of the image file.

**The behaviour is correct today.** `imageValidation.ts` normalises every upload through `sharp(input).rotate().resize().jpeg()` with no `withMetadata()` call, so sharp drops all metadata including GPS. The HEIC fallback (for HEVC-compressed iPhone photos that sharp's libvips cannot decode) re-enters the same pipeline, so it is covered too. The adversarial review checked this and confirmed it.

**No test covers it.** `imageValidation.test.ts` has eleven tests; the closest is *"applies EXIF orientation so stored pixels are upright"*, which asserts the opposite thing — that one specific piece of metadata is *honoured*. Nothing asserts that GPS tags are gone. A future change adding `withMetadata()` to fix an orientation or colour-profile complaint would silently break the location promise, and every test would still pass.

**This document owns writing that test**, in September, in the same window as everything else. It takes a fixture JPEG with GPS EXIF, runs it through `validatePhotoBase64`, and asserts the output buffer has no GPS tags and no EXIF block. A second test does the same through the HEIC fallback path.

**The dependency, stated in both directions so neither side assumes it:**
- `cat-record-data-spine.md` may rely on stored photo bytes carrying no location data. It is true, and after this test it stays true.
- **This document relies on the data spine to blur locations in API responses.** Stripping EXIF only closes the image-file route. If a public API response returns exact coordinates, the photo change has done nothing.

**Two further writers, and the rule that covers both.** `validatePhotoBase64` is imported today in `src/routes/sightings.ts` and nowhere else in `src/routes` — verified. Two more paths are arriving in this same window and each bypasses the EXIF strip if it writes rows directly:

- **the records import** (`PRODUCT-SPEC.md` §2.4, owned by `cat-record-data-spine.md` §5.3), whose images are phone pictures taken at a clinic or a feeding spot — the most sensitive coordinates in the system;
- **the welfare report** (`POST /api/reports`, owned by `team-access-and-welfare-queue.md` §4.3), which writes to `welfare_report_photos` (§6.6).

**Every path that creates photo bytes in either table must go through the same validation helper.** The rule is stated here because the consequence lands on this document's promise. A test asserting that no code path inserts into `photosTable` or `welfareReportPhotosTable` outside the shared helper ships with whichever of the two lands first.

### 6.5 Deleting a photo

The spec was previously silent on deletion, and the code has **no DELETE route anywhere** — the full route list is GET, POST and PATCH.

`DECISIONS.md` F3 puts the deletion *mechanism* with `cat-record-data-spine.md`: deletion severs the person and keeps the cat data, sightings survive unlinked. That is right, and it means most deletions never touch a photo at all — a sighting stays, with the name off it, and its photo stays with it.

**What this document owns is the case where photo bytes themselves must go**, which arrives in the same window as the "Report an issue" flow on every cat and photo (`PRODUCT-SPEC.md` §2.6) and its staff queue. The first inappropriate photo a tester reports needs a removal path, and today there is not one.

The contract, while photos are in Postgres:

- **Removing a photo is one database write** — delete the row, or null the bytes and mark it removed. There is no second system, no orphaned file, nothing to reconcile. This is genuinely simpler than it would be after a migration, and it is one of the quieter benefits of the deferral.
- **Anything referencing the removed photo degrades gracefully**, not into a 500: a cat whose primary photo is removed shows the placeholder, exactly as the `primaryPhotoId: 0` sentinel already does.
- **Removal is recorded** — who, when, why — because a takedown may need to be explained later.
- **After any future migration this becomes a two-system operation**: delete the object, then the row, in that order, idempotent, with a reconciliation script listing bucket keys that no row points at. Written into §7 so it is not rediscovered.

---

### 6.6 Restricted photos — where the restriction is actually enforced

Two of the four specs need photos that the public must never see: **welfare-report photos** (an injured animal, a doorway, a bystander, somebody's yard) and any photo attached to a **private feeding site**. §7.2 cut the `visibility` column that was standing in for this, correctly, and referred the requirement to `team-access-and-welfare-queue.md`. Left there it was a gap: that spec had a staff session and no storage rule, this one had storage and no session. It is settled here and in that spec's §4.3, in the same words.

**The restriction is enforced by which table the bytes are in, not by a column on a shared one.**

- `photos` is the **public** table. `GET /api/photos/:publicId` reads it and only it, and serves anonymously — which it must, because the app has no login (F7a).
- `welfare_report_photos` is the **team-only** table, served by one route, `GET /api/team/report-photos/:publicId`, behind the dashboard session on `team.catspotters.com`. A row there is unreachable from the public route because the public route does not read that table.

**Why this and not a column.** A column has a default, and a default can be wrong; a wrong default here publishes the most sensitive images in the system, and nothing in the test suite would notice. It also has to be written on every insert path and checked on every read path, which is exactly the "nothing writes it, nothing enforces it" failure §7.2 refused. A separate table has no default to get wrong, and the enforcement is the absence of a `FROM` clause — the cheapest thing in software to keep true.

**Consequences this document owns:**

- **The upload path.** §6.2 and the rest of this document are written for `POST /api/sightings`, which is the only path that exists today. Welfare-report photos arrive on **`POST /api/reports`**, which is a second writer of photo bytes and must therefore call **`validatePhotoBase64`** exactly as the sightings route does. Verified in the code: `validatePhotoBase64` is imported in `src/routes/sightings.ts` and nowhere else in `src/routes`. The EXIF strip in §6.4 is a property of that helper, so a report photo carrying GPS is stripped **only if this call is made** — and the structural test in §6.4 ("no code path inserts photo bytes outside the shared helper") now covers two tables, not one.
- **Unguessable public ids apply to both tables** (§6.2), so the team route is not enumerable either. The gate is the session; unguessability is the belt.
- **The alert mail carries the photo as an attachment**, not a link, since a link into the gated route fails in a mailbox and a public link would defeat the gate. Owned by `team-access-and-welfare-queue.md` §4.3; noted here because it is the one place a restricted photo legitimately leaves the system.
- **Deletion (§6.5) applies to both tables**, and so does the two-system ordering in §7.9 if the deferred migration ever happens.
- **Feeding-site photos** follow the same rule: while a site is private, any photo of it is a `welfare_report_photos`-class row. Whether a site is public at all is the data spine's (`cat-record-data-spine.md` §6.7), and this document does not set a second rule.

**One thing this does not claim.** A photo the team promotes onto a cat's page — a deliberate action in the dashboard, re-validated and copied into `photos` — is public from that moment, like any catalogue photo. That is a person choosing, which is the only way a restricted photo should ever become an unrestricted one.

---

### 6.7 Photo retention: old photos are shrunk, not deleted

**Decided by Samuel, 28 September 2026.** Keeping every photo at full size forever was rejected. Deleting old photos was considered and not chosen. The rule is:

- **After 12 months, a sighting photo is replaced by a small version**: long edge 480 px, JPEG, roughly a tenth of the original size. The sighting itself (when, where, by whom) is untouched, and the photo still shows on the cat's page. It's just smaller.
- **These stay at full size, always:**
  - **each cat's main photo**, because AI matching compares new spots against it;
  - **any photo that backs up a sterilisation or ear-tip observation** (`cat-record-data-spine.md` §4), because a small version is too blurry to check an ear tip, and that evidence must stay checkable;
  - **welfare-report photos**, which follow their own three-year rule (`team-access-and-welfare-queue.md` §8.5), not this one.
- **The same rule applies to every cat**, living or deceased (`cat-record-data-spine.md` §3.3).
- **How it runs:** a nightly job re-encodes eligible photos through the same validation helper as uploads (§6.4), so the small versions carry no location data either. It writes the new bytes in place and records that the photo was shrunk and when. It never touches a photo twice. The space is only given back after `VACUUM FULL` in a maintenance window (§7.6).
- **What this accepts:** storage still grows forever, but about ten times more slowly for older photos. Spotters see their older snapshots at a smaller size. If the deferred move to object storage (§7) happens, the rule moves with it unchanged.

## 7. The deferred migration — the plan for when it happens

*This section is technical and describes work that is **not** being done now. It is kept because the design is sound and because the day this becomes urgent, nobody should be starting from a blank page. It is right-sized: the elaborate apparatus in the previous draft was scaled to a risk that did not exist at the time, and the risk that does eventually exist is a different one.*

**Trigger to start reading this section for real:** SYC-46 being picked up after the 15 November 2026 review, or the photo volume passing roughly 2× plan.

### 7.1 The one thing that changes about this job over time

Right now: no production database, no photo corpus, nothing to move. Ship the write path, done.

After launch: every photo is a volunteer's irreplaceable contribution, and this becomes a copy-verify-cutover job. **The dual-write mode, the 5% checksum sample and the 30-day rollback window from the previous draft were designed for that second world and written into a plan for the first.** They belong to whichever world we are in when the work happens:

| Situation | What is needed |
|---|---|
| Zero rows (the window we are giving up) | New write path, read fallback for seed rows. No back-fill, no dual mode, no rollback window, no space reclaim. |
| A few hundred test rows | The above, plus a one-pass back-fill and a full checksum comparison — it is small enough to check every row, not a sample. |
| A real corpus (the likely case) | The full plan below. |

### 7.2 Schema

`photos` gains, in a generated migration:

| Column | Purpose |
|---|---|
| `storage_key text` (nullable) | Path inside the bucket |
| `bytes integer` (nullable) | Stored size, for cost reporting and integrity checks |
| `checksum text` (nullable) | SHA-256 of the stored bytes; proves the copy was faithful |
| `data text` | becomes nullable; retained through the rollback window, then dropped |

A row is authoritative on `storage_key` when non-null; `data` is read only as a fallback. That single rule is what makes the migration reversible.

**`visibility` is deliberately not added here, and the question it was standing in for is now answered — see §6.6.** The previous draft invented a `visibility` column to gate feeding-site and welfare-report photos to a staff session. Restricted photos are a real requirement, but a column nothing writes and nothing enforces is worse than no column, and mis-setting its default is a plausible way to make photos stop loading for testers. The resolution is structural rather than a flag: restricted photos are not rows in `photos` at all.

### 7.3 Writing

Generate the storage key from a UUID **before** touching the database, `PutObject` first, then a **single** INSERT carrying `storage_key`, `bytes` and `checksum`. This matters: deriving the key from the row id would force an insert-then-update, and a crash between the put and the update leaves a row with neither bytes nor key — unreadable, with an orphan in the bucket. On recycled autoscale instances that window eventually gets hit. Generating the key first removes it entirely, and makes the key unguessable as a side effect.

On storage failure, fall back to writing `data` and log loudly. A spotter never loses a sighting because a bucket had a bad minute.

### 7.4 Reading, and the AI matching coupling

Exactly **two** places in the codebase read photo bytes, so exactly one helper is needed: `loadPhotoBytes(photoId)`, used by both.

- `routes/photos.ts` — the serving route.
- `routes/sightings.ts` — the AI matcher. **This is the non-obvious coupling and it is the reason the helper matters.** Today, matching reads candidate cat photos as base64 straight out of Postgres. After a migration those reads come over the network instead, on the request path a spotter is actively waiting on.

Two corrections to the previous draft's picture of this code, both verified:

- **There is no 500 m filter.** `sightings.ts` loads *every* cat in the table, sorts by haversine distance, and takes the **10 nearest island-wide, at any distance**. The 500 m restriction is a separate, unbuilt ticket (`PRODUCT-SPEC.md` §2.3) owned by `cat-record-data-spine.md`. The previous draft described a planned change as current behaviour.
- **The reads are sequential.** The loop issues up to ten separate single-row queries, awaiting each. That is an N+1 executed in series. Ported naively to object storage it becomes ten network round trips in series, which is far worse than the previous draft's "latency adds up".

So the fix is structural, not just a cache: **fetch candidates in parallel** (`Promise.all`), plus a small in-process LRU keyed by photo id (the same nearby cats recur constantly). Set a latency budget — p95 added latency under 300 ms — and measure it rather than assuming it. `loadPhotoBytes(0)` must return null for the sentinel, with a test.

### 7.5 Serving

`GET /api/photos/:publicId` streams bytes through the API rather than redirecting: URLs stay permanent and cacheable, and access control stays in one place. **But if zero egress is the reason for choosing R2, this design does not deliver it** (§2.2). Either accept that and choose R2 on neutrality, or serve public cat photos from a Cloudflare domain in front of the bucket — which realises the zero egress and gets a CDN, but changes photo URLs, so it is its own project, not a step in this one.

### 7.6 Back-fill and reclaim

An idempotent script, safe to re-run while the app is live:

1. Select rows where `storage_key IS NULL AND data IS NOT NULL`, oldest first, in batches of 100.
2. For each: decode, checksum, `PutObject`, update the row. **Nothing is deleted in this pass.**
3. Verify. Sample size scales with the corpus: under ~2,000 rows, check **every** row; above that, a 5% sample plus every row above 1 MB. Refuse to proceed on any mismatch.
4. After the rollback window: a second pass sets `data = NULL` where `storage_key` is verified.
5. **Reclaim the space, and verify the bill actually moves.** Nulling a text column does **not** shrink a Postgres table — the space is still allocated. Only `VACUUM FULL` (or `pg_repack`) rewrites the table and releases it. **This step is the actual saving; skipping it means doing the whole migration and paying exactly the same.**
   - `VACUUM FULL` takes an ACCESS EXCLUSIVE lock on `photos` and needs free disk equal to the table size, so the photo endpoint is unavailable while it runs. Schedule it in a quiet window and say so.
   - `pg_repack` is an extension needing installation and elevated privileges, and is very likely **not available** on managed Postgres. Do not plan around it without confirming.
   - **Confirm how Replit meters storage before writing this down as a saving.** Replit's managed Postgres is Neon-derived, and Neon-style platforms meter logical size including retained history for the backup window — in which case the bill may not drop until retention rolls off. Record before/after table size *and* the next invoice.

### 7.7 Rollback

`PHOTO_STORAGE = db | dual | object`. Name them for what they do, because the previous draft's description was misleading: **`db` is a rollback of the *write* path only.** After the flip to `object`, every photo written since has `data = NULL`, so `db` mode cannot serve it — reads still work only because the bucket stays in the read path. **After the flip, the bucket is the only copy of post-flip photos.** No environment setting recovers them if the bucket is lost, the credentials are revoked or the account is suspended. Cover that explicitly: enable bucket versioning, or run a periodic copy, or record it as an accepted risk with a name against it.

Drop `data` only after 30 days clean on `object`, and only once a backup taken before the drop has been restore-tested.

### 7.8 Testing and local development

**This is the largest single chunk of the work and the previous draft did not mention it at all.** Any storage design where the default mode needs bucket credentials means every environment that runs the API needs them — CI and every developer laptop included.

- Specify storage as an **injectable module with an in-memory implementation**, selected by `PHOTO_STORAGE=memory` or by absent credentials. CI defaults to it. No developer needs a Cloudflare key to run the test suite.
- **Five existing test files write `photos.data` directly** and will need editing: `sightings.upload.test.ts` (which asserts on `photo!.data` and fails outright in `object` mode), `catHelpers.derived.test.ts`, `cats.nameSuggestions.test.ts`, `sightings.resolve.test.ts`, `sightings.moderation.test.ts` — plus `scripts/security-check.mjs`. They are a *fourth* writer of photo bytes and they route around the helper.
- Any estimate for SYC-46 that does not include this work is wrong.

### 7.9 Deletion, after a migration

As §6.5: object delete, then row delete, in that order, idempotent, plus a reconciliation script that lists bucket keys with no matching `storage_key`. "We deleted it from the app but the file is still in our bucket" is a real problem for a charity handling public photo submissions, not a hypothetical.

### 7.10 Jurisdiction and sub-processors — decide before the first object is written

If and when a bucket is created:

- **Create it with EU jurisdiction.** R2 buckets are placed where Cloudflare chooses unless a jurisdiction is set at creation, and that choice cannot be changed afterwards without re-uploading everything. The photos are taken in the EU by EU data subjects.
- **Cloudflare becomes a sub-processor** and must be named in the privacy policy (`privacy-policy.md`, per D6, with Syros Cats as controller) and in the Syros Cats ↔ Fair Shake data agreement, before store submission.
- The Play data-safety form and Apple privacy labels must match wherever the photos actually live.

**A benefit of the deferral worth stating:** because photos stay in Postgres for launch, the privacy policy and the store forms being written this month name **one** storage location, and they will still be accurate on launch day.

---

## 8. The offline queue — unchanged, and worth stating why

> **Superseded for the web build** by [offline-queue-on-web.md](./offline-queue-on-web.md), approved 28 September 2026. The web build is now the testers' primary channel, not a preview, so its photos move to IndexedDB and every queue write goes through one serialised path. Native storage as described below stands.

Nothing in this document changes offline behaviour, in either direction.

The queue keeps photos as **files in the app's document directory** and stores only the file path (`pendingPhotos.ts`); base64 inside the queue is a web-preview fallback and a legacy path. When a connection returns, the queue reads the file and posts it through the same endpoint. Since nothing about the upload contract changes, this is untouched.

Two things to be precise about, because they get overstated:

- **Offline support is partial.** Spotting works offline: photos and locations are captured, held on the phone and synced later, and map tiles that were pre-downloaded still render. Everything needing the server — AI matching, the catalogue beyond what is cached, the leaderboard, notifications — waits for a connection. Nothing here alters that boundary.
- **A stale queue is a real failure mode.** Items older than 30 days are already flagged as unsyncable (`offlineQueue.ts`). A volunteer without mobile data for weeks can lose sightings. That is a pre-existing product question, not something this document creates or fixes.

This is also why **signed expiring photo URLs were rejected** (F7a): a URL that expires is a photo that fails to load exactly when a spotter is out of signal, which is the situation the whole design is built around.

---

## 9. Sequencing

### Before the Play 14-day test begins

| What | Why it cannot wait |
|---|---|
| **Generated migrations, checked-in history, baseline migration, `push` removed** (§5.2) | Everything else in September depends on it, and this is the failure mode that has already happened once |
| **All four specs' schema changes applied and smoke-tested** (§5.1) | The sequencing is what protects the October launch |
| **A rollback exercised up-down-up against a restored dump, and dated** (§5.2) | A rollback nobody has run is not a rollback |
| **CI check for schema-vs-migration drift** (§5.2) | Cheap, mechanical, catches exactly the incident that happened |
| **Photo endpoint: unguessable public ids, rate limiter, CORS allowlist** (§6.2) | Currently an open, enumerable, unbilled-abuse surface on usage-billed compute |
| **EXIF-stripping tests** (§6.4) | The location-privacy promise depends on behaviour nothing tests |
| **Photo removal path for the takedown flow** (§6.5) | The "Report an issue" flow ships in this window and has nowhere to go |
| **`welfare_report_photos` and its team-gated route** (§6.6), with `POST /api/reports` calling `validatePhotoBase64` | The welfare report ships in this window, and its photos must not be reachable from the public photo route on day one |
| **Replit billing alert set** | The charity should never learn about a scraper from an invoice |

### Before launch

| What | Why |
|---|---|
| Deploy the API on the custom domain; production Postgres with **backups on and one restore performed and dated** | Already in the runbook; the migration work makes it more urgent, not less |
| `PRODUCT-SPEC.md` §2.8 and `DEPLOYMENT.md` §C corrected (§4.3) | Two live documents currently say the opposite of this decision |
| Privacy policy and store data-safety forms name Postgres-on-Replit as the photo location | Owned by `privacy-policy.md`; accurate only because of this deferral |

### Deferred, with dates

| What | When | Default if the date passes |
|---|---|---|
| Charity credits answered (Q1) | 31 Oct 2026 | Assume none; proceed |
| **SYC-47 hosting, and SYC-46 photos — decided together** | **15 Nov 2026** | **Replit and photos-in-Postgres through the 2027 season; SYC-47 closes; SYC-46 re-scoped as a data migration** |
| Direct-to-bucket uploads with pre-signed URLs | MLP at the earliest | Changes offline retry semantics for no benefit at this scale |
| A CDN in front of photos | When bandwidth says so, and only alongside §7.5 | Immutable cache headers help repeat views only; tourist browsing is cold traffic |
| Matching derivatives (512px copies) | Phase 3 | An optimisation; wants real matching-cost data first |

---

## 10. Risks and open questions

| # | Risk / question | Impact | Owner | Handling |
|---|---|---|---|---|
| R1 | **A schema change breaks every endpoint during the Play window** | Testers see a dead app, opt-ins fall below 12, October launch slips | Build | §5 in full: generated migrations, reviewed SQL, migrate-then-deploy ordering, smoke test, exercised rollback, CI drift check, and all schema work landing before the clock starts |
| R2 | **The deferred migration is harder and riskier later than now** | A copy of irreplaceable volunteer photos, with verification, cutover and a maintenance window | Samuel | **Knowingly accepted** (§1, §3). Kept visible by the dated trigger in §4.2 with a written default, and by §7 remaining a ready plan |
| R3 | Photos leak exact cat or feeding-site locations | Breaks a promise made to Syros Cats about targeting | Build | Re-encode already strips metadata — but it is untested; §6.4 adds the tests. Unguessable ids (§6.2) remove the enumeration ingredient. Blurring itself is `cat-record-data-spine.md`'s |
| R4 | A scraper walks the photo corpus on usage-billed compute | A charity gets a surprise invoice | Build | §6.2: unguessable ids, per-IP limiter, CORS allowlist, plus a billing alert before launch |
| R5 | Supplier prices here are stale | A decision built on bad numbers — which is exactly what happened last time | Samuel | Re-check all three suppliers at the moment of committing. §2.3's sensitivity band means the conclusion does not hinge on one price. Note that Replit's own cut of 77% arrived a month before the previous draft and was missed |
| R6 | Storage cost grows faster than plan | The deferral's accepted cost gets larger than assumed | Samuel | §2.3 names the threshold: roughly 2× plan volume flips the ordering and pulls the decision forward regardless of the 15 Nov date |
| R7 | **An imported record's or a welfare report's photo carries GPS EXIF** | Defeats location blurring by the back door, on the two paths carrying the most sensitive coordinates in the system | Build | Every path that writes photo bytes to either table goes through the shared validation helper, with a test asserting no other insert path exists. Import owned by `cat-record-data-spine.md`, the report path by `team-access-and-welfare-queue.md`; the rule is stated in §6.4 |
| R9 | **A welfare-report photo becomes publicly reachable** — a bleeding animal, a doorway, a bystander, on an anonymous endpoint | The worst image failure available to this product, and it would be found by a member of the public rather than by us | Build | §6.6: the bytes are in a separate table the public route does not read, so there is no default to set wrongly. A test fetches a report photo's id on the public route and asserts 404 |
| R8 | Postgres storage does not shrink even after a future migration | The work is done and the bill is unchanged | Build | §7.6: confirm Replit's metering first, `VACUUM FULL` as an explicit step in a maintenance window, before/after size **and** the next invoice recorded |
| **Q1** | **Do charity or startup credits exist that change this?** Cloudflare's nonprofit programme, Google for Nonprofits, AWS and Supabase credits are all worth an hour's asking | Samuel | **Open — due 31 October 2026**, because the 15 November decision depends on it |
| **Q2** | **Who owns the accounts and the bill at handover — Fair Shake or Syros Cats?** This shapes the hosting choice more than price does: a charity that will one day self-administer wants fewer suppliers and simpler bills | Samuel | **Open — needed for the 15 November decision**, not before launch |
| **Q3** | Which entity publishes in the stores (already in the runbook) — the same question, a different surface | Samuel | Open |

---

## 11. What Samuel has decided, and what is left

**Decided** (recorded in `DECISIONS.md` D1, and now the position of this document):

1. Everything stays on Replit. Photos stay in Postgres. No object-storage migration before launch, no hosting change. Rationale: build speed.
2. The accepted cost — that the free window for this migration closes on first production deployment — is recorded in §1 and R2, and given teeth by the dated trigger in §4.2.
3. September's infrastructure work is migrations (§5) and the photo endpoint (§6), not storage.

**Still open:**

1. **Q1 — charity credits, due 31 October.** An hour's asking, and it is an input to the November decision.
2. **Q2 — who owns the bill long-term.** The real input to the hosting call, and answering it now costs nothing.
3. **Confirm the 15 November date and the written default in §4.2**, since the default is the outcome we most likely get.
