# Adversarial review — The cat record data spine

**Target:** [`docs/specs/cat-record-data-spine.md`](../cat-record-data-spine.md)
**Reviewer:** adversarial pass, 3 September 2026
**Method:** spec read in full, then every claim about the codebase checked against `lib/db/src/schema/*`, `artifacts/api-server/src/{routes,lib}/*`, `lib/api-spec/openapi.yaml`, and the Expo offline cache in `artifacts/cat-spotter/`. Cross-read against `CLAUDE.md`, `docs/PRODUCT-SPEC.md` §2.3/§2.4/§3.1, `docs/SPEC.md`, `docs/superpowers/specs/2026-07-28-cat-health-record-design.md`, `threat_model.md`, `docs/specs/team-access-and-welfare-queue.md`.

**CONFIRMED** = verified against code or against the spec's own text. **PLAUSIBLE** = a real risk I could not fully verify from this worktree.

**Headline: the blurring design does not survive review.** The grid-snapping choice is correct in isolation, but two live channels defeat it, one of them the very endpoint §6.3 declares to be a non-issue. Findings 1 and 2 need answers before this ships. The rest of the spec is largely sound in structure and wrong in specific rules — §9.2 as written cannot implement §5.5 or §3.2.

Canonical facts (CLAUDE.md) all pass: €50–60 (§4.1, §5.1), "spotter" and "cat guardian" throughout, "clipped tip" never "notched", "usually on the left ear" (§4.1), colony naming as location + carer (§5.1, §9.4), and the offline claim in §6.5 is precise rather than overclaimed. No corrections needed there.

---

## 1. CONFIRMED · CRITICAL — `POST /sightings` is a nearest-neighbour oracle over exact coordinates, and §6.3 says the opposite

**What is wrong.** §6.3 opens "**It does not [interact], and that is deliberate**" and treats the matching path as a purely internal consumer of exact coordinates. It is not internal. `artifacts/api-server/src/routes/sightings.ts` accepts an unauthenticated `POST /sightings` carrying attacker-chosen `lat`/`lng`, selects the **10 nearest cats by exact stored coordinates**, and returns matching candidates — `catId`, `name`, `photoUrl`, `confidence` — straight to the caller. The caller controls the probe point and reads back which cats were near it.

The exploit is fully assembled from things already public:

1. `GET /api/photos/{id}` is unauthenticated and sequentially enumerable (`routes/photos.ts`; `threat_model.md` names this). Fetch the target cat's own primary photo.
2. Resubmit that photo as a sighting at a probe coordinate. The cat appears in `candidates` at high confidence whenever it is inside the 10-nearest set of the probe.
3. Bisect on latitude, then longitude. Each probe returns a half-plane constraint (the perpendicular bisector between the target and the 11th-nearest cat). Repeat from several bearings and multilaterate.
4. `aiLimiter` is 20 requests / 15 min **per IP** (`middlewares/rateLimit.ts`), which is roughly 1,900 probes per IP per day and trivially multiplied across IPs. A 250 m cell falls in tens of probes.

Grid snapping is defeated not by averaging the published value — the spec is right that it can't be — but by a second endpoint that answers questions about the unpublished value.

**Consequence.** The privacy promise made to Syros Cats is false for any cat whose photo can be downloaded, which is all of them. §11 risk 3 anticipates "a new endpoint" as the leak vector; the leaking endpoint is the oldest one in the app, and the spec explicitly clears it.

**Recommended fix.** Rewrite §6.3. Options, cheapest first: (a) snap the *candidate-selection* input to the same grid — the accuracy objection in §6.3 is answerable by widening the candidate radius to 750 m to absorb the quantisation, since candidates are re-ranked by the vision model anyway; (b) require a verified device secret on `POST /sightings` (already implemented for resolve in `lib/deviceAuth.ts`) and rate-limit per device, not per IP; (c) do not return `catId`/`name` for candidates the model scores below a real threshold, and never echo a candidate set whose membership was decided by geography. Add a test that probes the endpoint from a grid of coordinates and asserts the response set does not reveal ordering by true distance.

---

## 2. CONFIRMED · CRITICAL — averaging across cats recovers colony centres, which is what §6.6 exists to hide

**What is wrong.** §6.2 rejects Option A because "sample the same cat two hundred times and the mean of the offsets converges on the true position". The same argument applies to Option C across a *population* rather than across requests. Quantisation errors of different cats in the same area are effectively independent and roughly uniform over the cell. Take the 30 published cell centres of a colony and average them: the error on the centroid falls as the square root of the count. Thirty cats gives a colony centre good to roughly 250/√30 ≈ 45 m, and colonies exist because cats gather where they are fed.

§6.6 states that private feeding sites "do not appear in public payloads at all — not blurred, not as a count, not as a heat overlay", with the correct reasoning that "a blurred dot still says 'there is a feeding site roughly here', which is most of the information someone dumping kittens needs". The public catalogue is that heat overlay. Suppressing the feeding-site row does not suppress the cats clustered on it.

**Consequence.** The one privacy control the spec treats as absolute is defeated by the control it treats as sufficient. Both were designed against the same threat (kitten dumping, neighbour hostility) and neither holds.

**Recommended fix.** Say so in §6.2 rather than leaving the population attack unaddressed, then choose: (a) accept it and say plainly to Syros Cats that colony locations are recoverable to ~50 m from public data, so that the private-site toggle is not oversold; or (b) blur at the *cluster* level — snap every cat in a colony to the same published centre so averaging returns exactly the published value and yields nothing. Option (b) also makes §6.6 coherent and is a small change to `blur.ts` (snap by colony id when the cat has one, by cell otherwise). It costs the map some texture and buys the only version of this promise that is true.

---

## 3. CONFIRMED · HIGH — §9.2's sterilised rule has no recency or precedence, so §5.5 is unimplementable

**What is wrong.** §9.2 states: "Any non-superseded observation with `kind: "sterilised"`, `value.sterilised === true`, and `roleAtTime` in {vet, staff, admin} or `provenance: "import"` → **confirmed**." There is no "newest" and no ordering. The clause fires on *any* matching row, ever.

§5.5 then promises the opposite in two of its five rows: "Import confirms sterilised, a later team entry says not sterilised → **The later team entry wins**", and "Two import rows disagree → the newer date wins". Under §9.2 as written, the older positive still satisfies clause one and returns `confirmed: true`; the trailing sentence about a confirmed negative is unreachable. §3.2's life-status rule *does* say "newest by `observedAt` wins" — the asymmetry looks accidental.

**Consequence.** Exactly the failure mode §8 warns about: "a wrong confidence level looks exactly like a right one". §5.5 row 4 is the correction path for a mis-matched import row (finding 5) — the highest-consequence correction in the system — and the resolver as specified will not perform it.

**Recommended fix.** State the sterilised rule as an ordered fold: partition observations by authority tier, take the newest non-superseded authoritative `sterilised` assertion by `observedAt` regardless of sign, and only fall through to `ear_tip` when no authoritative assertion exists. Add a named test: an import `true` dated 2024 followed by a staff `false` dated 2026 must resolve to a confirmed negative, and the reverse order must resolve positive. §9.7 has nine tests and none of them covers precedence between two authoritative assertions.

---

## 4. CONFIRMED · HIGH — the same-photo-supersedes-death rule in §3.2 does not exist in §9.2

**What is wrong.** §3.2 says a "deceased" observation is "superseded by a later observation — **including, most powerfully, a new photograph**". §9.2 says "The newest non-superseded `life_status` observation by `observedAt` wins", and a sighting is not a `life_status` observation — §3.2's own table says a spotter "Can set: Nothing directly". §9.2 then confirms the gap: a later sighting is "reported as a conflict to the team and does not suppress the sighting", i.e. it does not change the status either.

Worse, §3.4 enumerates the four lines a spotter sees on the cat page — *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, *"Not seen since June 2024"* — and there is **no copy for `deceased` at all**. The spec specifies the display for the derived, uncertain state and omits it for the certain one.

**Consequence.** This is precisely the "someone who named that cat" case. A cat wrongly reported dead by one guardian, then photographed alive by the tourist who named her, keeps whatever the undefined `deceased` rendering is until a team member notices a conflict queue that §8 does not build. The spec's stated comfort — "a cat reported dead by one person and then photographed alive is a normal Tuesday" — is not delivered by the algorithm.

**Recommended fix.** Two changes. (1) Make a resolved sighting an implicit `life_status: street` signal at ordinary authority: any resolved sighting dated after a `deceased` observation clears it in the same read, no job, no queue. That is what §3.2 already promises and it costs one clause. (2) Write the `deceased` public copy explicitly, and decide whether a cat marked deceased is still notified about, still in the collection grid, and still in the "12 of 142" denominator — `catSubscriptionsTable` will keep pushing "Agatha was spotted again!" to everyone who ever spotted her, which is either the right behaviour or a very bad one, and the spec does not say which.

---

## 5. CONFIRMED · HIGH — the import is not idempotent: the unique index is per batch, so re-uploading the same file duplicates everything

**What is wrong.** §5.2 claims "**Re-running the import is safe.** The pair (source file, row hash) is unique, so the same row imported twice produces one observation." §9.3 implements that as `uniqueIndex("import_records_batch_row_unique").on(t.batchId, t.rowHash)` — uniqueness on **(batch id, row hash)**. A batch id is a `serial`; re-uploading the same file creates a new batch with a new id, so every row inserts again, matches again, and writes a second `observations` row. The index prevents duplicate rows *within* one file. It does nothing about re-running the import, which is the thing §5.2 claims it guarantees.

**Consequence.** The single most likely operational event — someone re-uploads the spreadsheet because they were not sure it worked, or the charity sends a corrected version — doubles the confirmed-sterilisation count that goes to funders, and §9.7 test 9 ("Import is idempotent: the same file twice produces one set of observations") will pass against a batch-scoped index only if it re-imports into the same batch, which is not what a second upload does.

**Related, also wrong.** "A corrected spreadsheet re-imported later adds only the changed rows" — true, and it is the problem. `rowHash` is sha256 of the raw row, so a corrected row is a *different* row. The original's observation is already applied and is not superseded by the correction. Two contradictory live observations from one real-world record, with no link between them. And genuinely duplicate rows in the charity's own file (the same cat done twice, or two identically-typed rows) silently collapse to one, discarding a real record.

**Recommended fix.** Make the identity `(file content hash, row hash)` or `(normalised source key, row hash)` globally unique, not batch-scoped, and store the file hash on `import_batches`. Add a `rowOrdinal` so genuinely repeated identical rows survive. Define correction semantics: a re-import of the same file with changed content must supersede the observations written by the rows it replaces, matched on a stable per-row business key (the charity's own reference where one exists), not on the content hash. Change test 9 to upload the same file as two separate batches.

---

## 6. CONFIRMED · HIGH — the auto-link rule bypasses the very signals §5.3 defines, on a name space that is not what the spec thinks it is

**What is wrong.** §5.3 defines a scoring table including "**Sex contradicts a recorded sex → Strong negative**", then defines the outcome table so that "Exact name match, and exactly one cat in the catalogue has that name → **Applied immediately**". The auto-link path does not consult the score, so the strong negative cannot veto it. Two clauses of one section contradict each other.

The justification is also a non-sequitur: "Names are already unique case-insensitively across the catalogue, so this is unambiguous by construction." Uniqueness is real — `cats_name_lower_unique` on `lower(name)` exists in `lib/db/src/schema/cats.ts` — but it guarantees *at most one candidate*, not *the right candidate*. And app cat names are not distinctive: they come from `lib/nameSuggestions.ts`, an AI suggester asked for names in the user's language, drawing from the same small pool of common Greek cat names the charity's own records use. "Ρούλα" in the charity's Ano Syros records and "Roula" the tabby a French tourist named in Kini are one exact-name auto-link with no human ever seeing it.

**Consequence.** §11 risk 2 names this as the second-worst outcome in the spec — "a single wrong link makes a *Confirmed* sterilisation on a cat that has not had one ... the cat drops off the trapping list with a confident label" — and the mitigation it cites ("Only exact unique name matches auto-link") is the mechanism that causes it. Compounded by finding 3: the correction path §5.5 promises does not work.

**Recommended fix.** Auto-link requires exact unique name **and** at least one corroborating signal (colony match, or a record location within 500 m of the cat's sightings, or a guardian-name match) **and** no negative signal. Everything else is `needs_review` — the queue already exists in the design and a few hundred rows is one afternoon for Jo. Add a test that a name-only match with a contradicting sex does not auto-link.

---

## 7. CONFIRMED · HIGH — a wrong *Likely* has no correction path, and notch-vs-clip is the most likely tourist error in the app

**What is wrong.** §4.3 accepts one photo-backed clipped-tip observation as *Likely*, arguing the error is "contained, because *Likely* ... is visibly superseded by any team entry". Check what a team entry can actually do:

- `ear_tip { clipped: false }` — §4.4 and §9.2 both say it "never affects the level". By design, a team member looking at the photo and correctly judging "that is a torn ear, not a clipped tip" cannot write anything that lowers the level.
- `sterilised { sterilised: false }` from staff — a *different attribute*. §4.2's "confidence never crosses attributes" rule is one-directional as written, and per finding 3 the precedence between a staff negative and an `ear_tip` positive is undefined.
- `supersedesId` on the offending observation — the correct mechanism, and §9.6 exposes **no API for writing a superseding observation**. It lists only `POST /sightings/{id}/resolve` gaining three optional fields.
- The confirmation queue that would surface these for review is explicitly in §8's "Not built now" list.

Meanwhile `docs/PRODUCT-SPEC.md` line 20 records the exact confusion at issue: "the correct term is a **clipped tip**, never 'notched' (a notch is a battle scar, not a sterilisation mark)". An untrained tourist shown a torn or notched ear will tap "Yes, clipped". This is the single most predictable data-quality error in the whole feature, and the spec has no path to fix an instance of it.

**Consequence.** Wrong *Likely* labels accumulate permanently through a season. §4.3's own argument that *Likely* "lowers a colony's priority slightly" is the harm: an unsterilised cat sitting at *Likely* is deprioritised for trapping and produces a litter. The spec names only one direction of the error (trapping an already-done cat) and never the other, which is the one this rule creates.

**Recommended fix.** Keep one-is-enough — the reasoning against a two-spotter threshold is right — but ship the correction path with it: a team-facing "supersede this observation" write in §9.6, and a minimal review list of cats at *Likely* with their evidence photos (not the full confirmation queue, just the list). Add both failure directions to §4.1 so the next reader does not optimise against one of them. Add the ear-tip photo example from PRODUCT-SPEC §2.2 to the §4.4 question — it is referenced as `[see an example](#)` with a dead link.

---

## 8. CONFIRMED · HIGH — §9.5 specifies blurring in the wrong place, and three payload paths that emit exact coordinates are not mentioned

**What is wrong.** §9.5: "Applied in one place: the payload builders in `artifacts/api-server/src/lib/catHelpers.ts`. `listCatsWithStats` and the cat-detail builder take a `viewer` argument". Verified against the code, three things are false:

1. **The cat-detail builder is not in `catHelpers.ts`.** `catPayload()` lives in `artifacts/api-server/src/routes/cats.ts` and emits `lat`/`lng` from the row. It serves `GET /cats/{id}`, `POST /cats`, `POST /cats/{id}/claim` and `PATCH /cats/{id}`.
2. **`POST /sightings/{id}/resolve` builds its own cat object inline** in `routes/sightings.ts` and returns `lat: cat.lat, lng: cat.lng` — the *cat's* exact stored coordinates, to any spotter who confirms a match on any cat. §6.5's tier table entitles a spotter to "their own exact positions — it is their data and their walk". This is not their data; it is the cat's, which is the thing being protected.
3. **`GET /cats` has no caller identity at all.** `router.get("/cats")` reads only `lat`/`lng` query params. There is no `deviceId`, no header, no session. The `viewer` argument §9.5 requires cannot be computed for the list endpoint without an API change the spec does not specify — so the `owner` and `guardian` tiers of §6.5 are unimplementable on the surface that matters most.

**Also.** `POST /cats/{catId}/claim` does **not** call `verifyDeviceSecret` (unlike resolve, which does). Any caller can claim any unclaimed cat with an arbitrary `deviceId` and thereby promote themselves into §6.5's "owner" tier for that cat — self-service access to exact coordinates. That is a pre-existing gap, but this spec is what turns it into a privacy escalation.

**Recommended fix.** Enumerate all four emitters in §9.5 and route them through one `serialiseCat(cat, viewer)`. Specify how `viewer` is determined per endpoint, including a decision for `GET /cats`: either accept an authenticated device and return exact positions only for cats that device owns, or accept that the list is always public-blurred and the owner sees exact positions only on the detail page. Add `verifyDeviceSecret` to claim before the owner tier means anything. §9.7 test 6 ("every public payload") must name these four builders explicitly or it will be written against the one the spec mentions.

---

## 9. CONFIRMED · HIGH — §6.5's cache-purge mitigation targets a sign-out that does not and will not exist in the app

**What is wrong.** §6.5: "a device that signs out of a team account purges its cached catalogue and re-fetches". The Expo app has no accounts and no sign-out — identity is an anonymous per-device UUID plus a device secret (`.agents/memory/anonymous-device-identity.md`, `lib/deviceAuth.ts`, `threat_model.md`). And per `docs/specs/team-access-and-welfare-queue.md` §2.4, the team dashboard is a **separate web workspace** with its own email-link session; staff never sign in to the mobile app at all. The mitigation is written for the wrong artifact.

The cache itself is `artifacts/cat-spotter/hooks/useCatsWithCache.ts`: a single unversioned key `'cat-spotter/cats-cache'`, written on every successful fetch, read whenever `query.data` is absent, with no TTL, no viewer tag and no eviction. §10 step 5's "a version bump on the catalogue cache key forces a re-fetch" is correct and easy — but the key is also a hazard the spec does not name: if the mobile app *ever* gains a team mode, an exact-coordinate payload lands in the same key and stays there indefinitely with nothing to purge it.

**Recommended fix.** Replace the sign-out sentence with what is actually true and enforceable: the mobile app is always a public reader; exact coordinates never reach it; the team dashboard is a separate session that does not use this cache. Then add the constraint that keeps it true — tag the cache key with the viewer tier (`cats-cache/public/v2`) so a tier change can never read another tier's cache, and state that any future team mode in the app must use a distinct key.

---

## 10. CONFIRMED · MEDIUM-HIGH — there is no derived cat location; §6.2's mitigation describes something that does not exist

**What is wrong.** §6.2's answer to the boundary-jitter objection is: "mitigated because we snap the cat's *derived* location, which moves rarely." There is no derived location. `catsTable.lat/lng` is written once — from the first sighting in `routes/sightings.ts` resolve, or from the resident's input in `POST /cats` — and **no code path ever updates it**. It is a frozen snapshot of one GPS reading.

**Consequence.** Three, in increasing order of importance. The boundary-flicker mitigation is vacuous (the point never moves, so there is nothing to mitigate, which is fine — but the spec should not claim a mechanism it does not have). The published cell is a quantisation of *where the discovering spotter was standing*, which is a disclosure about a person, not a cat. And the map is simply wrong in a way blurring cannot fix: a cat first photographed by a tourist at the ferry terminal is pinned at the ferry terminal forever, so "cats near me" — the experience §6.2 Option D is rejected to preserve — degrades as the catalogue ages.

**Recommended fix.** Either delete the claim, or build the derived location this spec's other sections already assume (§6.3 references "colony clustering", §8 references targeting): a cat's position is the centroid or most-recent-cluster of its resolved sightings, recomputed on write, snapped for publication. That is a small addition and it makes the map true. If deferred, say so and note that the published position is the discovery position.

---

## 11. CONFIRMED · MEDIUM-HIGH — the grid origin is public, so the honest guarantee is the 250 m cell, not the 300 m circle

**What is wrong.** §6.2 specifies a plain quantisation: "latitude and longitude are quantised to a grid of roughly 250 m (about 0.00225° of latitude, with the longitude step scaled by the cosine of Syros's latitude)". There is no secret. An attacker who reads `blur.ts` — or simply observes that published points fall on a lattice, which two cats in the same neighbourhood reveal immediately — reconstructs the cell boundaries exactly and knows the true position lies in a specific 250 m × 250 m box: 62,500 m². The drawn 300 m circle implies 282,743 m². The display overstates the protection by 4.5×.

It is also inaccurate for honest users in the other direction: a cat at a cell corner is up to ~177 m from the drawn centre, so a user walking to the middle of the circle can be walking away from the cat.

**Recommended fix.** Derive the grid origin from a server-held secret (`HMAC(secret) → a fixed sub-cell offset applied to the whole island`). It stays fully deterministic — a thousand requests still return one identical answer, no per-cat secret, no averaging attack, and §6.2 Option B's "stored secret per cat" objection does not apply because a single leaked global offset degrades the guarantee to what it already is today rather than exposing any individual cat. Then either draw a 250 m square (truthful) or keep the circle and say in §6.2 that the circle is a display convention, not the guarantee. Note the interaction with finding 2: if colony-level snapping is adopted there, this becomes less load-bearing.

---

## 12. CONFIRMED · MEDIUM — presumed-deceased has four unhandled edge cases, including one that fires on day one

**What is wrong.** §9.2: "`presumedDeceased` is true when there is no resolved sighting within 36 months and no `life_status` observation newer than the last sighting."

1. **Cats with no sightings at all.** `POST /cats` (resident owner registration) creates a cat with `primaryPhotoId: 0` and zero sightings. `lastSightingAt` is `null`. "No resolved sighting within 36 months" is trivially true, and "no `life_status` newer than the last sighting" is undefined against a null. §10 step 4 backfills *existing* such cats to `homed`, but §9.6 does not say `POST /cats` writes a `life_status` observation going forward. A cat registered tomorrow is presumed deceased tomorrow, or the comparison throws — the spec does not say which.
2. **An import can never rescue a cat.** The clock keys off sightings only. A charity record dated last month proving the cat was on a clinic table is stronger evidence of life than a photo, and the rule ignores it. Same for a guardian's `in_care` observation dated after the last sighting — that one is caught by the second clause, which makes the asymmetry with import records look accidental.
3. **A cat imported with an old last-seen date** has no path to affect this at all, because §5 never turns an import row into a sighting or a last-seen date. Worth stating explicitly rather than leaving to the implementer.
4. **`observedAt` bounds.** The existing capture-time clamp (`lib/captureTime.ts`, `MAX_BACKDATE_MS` = 30 days) is the app's only precedent for client-supplied dates. Staff entering "sterilised on 3 March 2019" must not hit it. The spec does not say what validates `observedAt`, and the nearest precedent will silently corrupt historical imports.

**Recommended fix.** Define the rule over "last evidence of life" — the newest of (resolved sighting, any observation whose kind implies the cat was alive, cat creation date) — rather than sightings alone; that fixes 1, 2 and 3 in one clause and makes `POST /cats` safe without a backfill. State the `observedAt` validation rule (past dates unbounded for authenticated writers, clamped for public ones).

---

## 13. CONFIRMED · MEDIUM — §8's own "cannot be added later" test disqualifies two fields §8 omits

§8 argues that provenance must be recorded now because it is "unrecoverable retrospectively ... permanent contamination if it was not. It costs one column." The argument is right and it applies to two more fields the table does not include:

- **What was prompted.** `provenance: "prompted"` records *that* the app pre-filled an answer. To discount prompted agreement you need to know **what was suggested and by which model version** — §5.2 of the health-record design doc is explicit that "three confirmations of one error is one error". Without the suggested value and a model identifier, the future weighting cannot separate "three people agreed with a wrong guess" from "three people agreed with a right one", which is the entire point. Add `suggestedValue jsonb` and `suggestionSource text`.
- **Whether the observer's authority applied to *this* cat.** `roleAtTime` is a global role. §6.2/§6.3 of the design doc and §4.1 of this spec both require *per-cat* authority — "a guardian is authoritative on their cat's day-to-day condition and an ordinary observer on a cat they don't look after". Guardianship changes over time, so it cannot be looked up at read time — the exact argument §8 makes for `roleAtTime`. Add `authorityScope` (e.g. `guardian_of_this_cat` / `none`) resolved at write time.

Both are one column each and both are unrecoverable later. Everything else in §8's table stands up.

---

## 14. CONFIRMED · MEDIUM — duplicate merge is not "a resolver or vocabulary addition", and the append-only rule forbids the operation it needs

§8 closes: "Every one of them is a resolver or vocabulary addition on top of this table", with `duplicate merge` in the list. Merge is not a resolver change. Merging cat B into cat A requires repointing `observations.catId`, `sightings.catId` and `import_records.catId` — and §9.1 states "Rows are inserted and never updated or deleted. A database trigger or repository-level guard enforces this". The merge either violates the immutability guard or has nowhere to write.

This matters more than a deferred nice-to-have: §14 of the health-record design doc records that Samuel **pulled duplicate merge forward** as a user-facing workflow, reversible and never deleting. Reversibility in particular is impossible if merge mutates `catId` in place.

**Recommended fix.** Add a `cat_aliases` (or `cat_identity`) table now — `catId → canonicalCatId`, itself append-only with a supersede path — and have the resolver read through it. It is a table, not a migration of history, and it is the only version of merge that is reversible. Then §8's claim becomes true.

---

## 15. CONFIRMED · MEDIUM — §6.4's timestamp-coarsening protection is undone by sequential photo ids and by push notifications

§6.4.4 coarsens public "last seen" to a date, on the reasoning that "an exact time plus a small area is a pattern of life — for the cat, and for the person who feeds it at the same hour every day". Two channels re-supply the time:

- **Photo ids are a global monotonic clock.** `photosTable.id` is a `serial`, `GET /api/photos/{id}` is unauthenticated and enumerable, and `CatDetail.sightings[].photoUrl` is public. Every public sighting therefore carries a total ordering against every other sighting in the system, and calibrating a handful of ids against known times reconstructs approximate timestamps for all of them. Coarsening the displayed date changes nothing.
- **Push notifications are real time.** `createUpdateAndFanOut` in `lib/notificationFanout.ts` fires "Agatha was spotted again!" to every device in `catSubscriptionsTable` for that cat, and resolving one sighting subscribes you automatically. An attacker who spots a cat once receives a live feed of every subsequent sighting of it, to the minute, indefinitely.

**Recommended fix.** Either drop §6.4.4's claim (it is not currently deliverable) or close both: serve sighting photos under an opaque, non-enumerable id, and coarsen or batch sighting notifications for cats the recipient does not own. At minimum, name both channels in the spec so the next reviewer does not have to find them.

**Related, minor:** §6.4.4 conflicts with §9.6, which changes `sightings[]` only by dropping `lat`/`lng` and leaves `createdAt` as a full ISO timestamp. And coarsening `Cat.lastSeenAt` to a date breaks the existing default catalogue sort in `listCatsWithStats` (`b.lastSeenAt.localeCompare(a.lastSeenAt)`), which would become a mass tie.

---

## 16. CONFIRMED · MEDIUM — EXIF stripping is incidental, undocumented and untested

The entire blurring design rests on the assumption that a published photo does not carry the GPS tag of where it was taken. It currently does not — `lib/imageValidation.ts` re-encodes every upload through `sharp(...).rotate().jpeg()`, and sharp drops metadata unless `.withMetadata()` is called. That is a default, not a decision: a future change adding `.withMetadata()` for colour-profile or orientation reasons (a plausible bug fix) would republish exact capture coordinates on a public, unauthenticated, `immutable`-cached endpoint, silently defeating every other control in §6.

The spec never mentions EXIF.

**Recommended fix.** State the requirement in §6.4 as a fifth leak, and add a tenth test to §9.7: upload a JPEG carrying GPS EXIF, fetch it back from `GET /api/photos/{id}`, assert no EXIF GPS block. Also worth one honest line in §6.4 that photo *content* — a doorway, a house number, a shop sign — is itself location data that no blurring scheme touches. Syros Cats should hear that from the spec rather than discover it.

---

## 17. CONFIRMED · MEDIUM — cats known by two names, and the rename that erases the import's best signal

§5.3 makes the cat's name "the strongest matching signal we have". Nothing in the app or the spec preserves names over time or allows more than one:

- `PATCH /cats/{catId}` (`routes/cats.ts`) overwrites `name` in place. There is no rename history anywhere — the care timeline records a *notification* about the rename, not the prior name. An owner renaming a cat destroys the only strong matching key for every future import run.
- There is no alias concept, so the charity's "Μιμή / the one-eyed one by the bakery" and the app's "Mimi" are one row or none.
- §5.2's normalise step says "names trimmed and case-folded", which is a much harder problem in Greek than the sentence suggests (final sigma, accents, and NFC-vs-NFD normalisation). See finding 18.

**Recommended fix.** Add a `cat_names` append-only table (or `kind: "name"` observations, which the open vocabulary already supports) recording every name a cat has been known by, with source and date, and match imports against all of them. This also gives §5.3's near-match rule something to work on and is the natural home for the transliteration pairs.

---

## 18. PLAUSIBLE · MEDIUM — "unique by construction" is only as strong as the collation, and Greek breaks the assumption

§5.3's auto-link rule leans on `cats_name_lower_unique` on `lower(name)`. Two properties I could not verify from this worktree but which would each break it:

- **Collation.** Under the `C` collation, Postgres `lower()` leaves non-ASCII bytes untouched, so `ΜΙΜΗ` and `Μιμή` are distinct names, both insertable, and both auto-linkable from one import row. Under a Greek or ICU collation the behaviour differs again, and none of them handles final sigma (`ς` vs `σ`) the way a person would.
- **Unicode normalisation.** Nothing normalises input to NFC. `Μιμή` typed on an iPhone (precomposed) and the same name pasted from a decomposed source are different strings, so the unique index does not fire and the catalogue holds two cats whose names look identical.

Verify with a migration-level test: insert `Μιμή` (NFC), then `Μιμή` (NFD), then `ΜΙΜΗ`, and assert the intended uniqueness behaviour. Whatever the result, §5.3 should say what "case-insensitively unique" means for Greek rather than assuming ASCII semantics — and normalisation to NFC should happen on write, not only in the importer.

---

## 19. CONFIRMED · LOW-MEDIUM — the waiting pool and the catalogue can double-count, and the published impact figure can go down

§5.4 recommends Option B and gives the reporting sentence: *"142 cats in the catalogue: 89 confirmed sterilised, 23 likely, 30 not known. A further 46 sterilisations are on record for cats not yet photographed."* Two problems the spec asserts past:

- A pool record is "a cat not yet photographed" only if the matching was right. A record that failed to match a cat that *is* in the catalogue is counted twice — once in the 89 and once in the 46 — and unmatched-because-hard is the common case, not the rare one.
- When a pool record later links on a first sighting (the flow §5.4 sells as the payoff), the "further 46" drops by one and the 89 goes up by one. A funder-facing total that moves downward needs an explanation ready before it happens, not after.

Also unhandled: two rows in the charity's own file describing one cat under two spellings both sit in the pool and both count.

**Recommended fix.** State the overlap plainly in the reporting copy ("46 further operations on record, some of which may be cats already listed above"), and de-duplicate within the import before the pool figure is published. §5.4's risk column currently lists only "two places to look", which understates it.

---

## 20. CONFIRMED · LOW-MEDIUM — the performance argument is sound; the trigger that is supposed to catch it is not

The core claim holds. Hundreds of cats and low tens of thousands of observations resolve in JS in single-digit milliseconds, and Option D is genuinely addable later because the cache is a pure function of the log. I do not think read-time resolution is the risk the spec worries it might be. Three qualifications:

- §11 risk 6's trigger — "any catalogue query above 200 ms" — has no detector. There is no timing instrumentation, no slow-query logging and no metrics anywhere in `artifacts/api-server`. A trigger nobody can observe is not a mitigation. Add request-duration logging on `GET /cats` and `GET /cats/{id}` in the same change, or the trigger will first be observed by a user.
- `GET /cats` is unpaginated and already does a full `cats LEFT JOIN sightings GROUP BY` with two correlated subqueries per row, returning every cat on every app open, and the whole payload is written to AsyncStorage. Adding a per-cat resolve over an observations table makes the constant worse on the one endpoint with no bound. Pagination is the cheaper fix than caching, and the spec does not mention it.
- `POST /sightings` already does `db.select().from(catsTable)` — a full scan — plus one base64 photo fetch per candidate from Postgres. That is the query that will hurt first, and it is untouched by this spec.

---

## 21. CONFIRMED · LOW — §6.3 and §9.7 test 8 assert behaviour that does not exist yet

§6.3 says "Matching a new photo against cats within 500 m happens on the server", in the present tense, and §9.7 test 8 says "The matching path reads exact coordinates, asserted directly against the 500 m candidate query". There is no 500 m cap in the code: `routes/sightings.ts` takes the 10 nearest cats by `haversineKm` with no distance filter (`MAX_CANDIDATES = 10`). The cap is a separate PRODUCT-SPEC §2.3 item that has not landed. Declare the dependency, or write the test against what exists.

---

## 22. CONFIRMED · LOW — smaller items worth fixing before implementation

- **§5.5 vs §9.3 state names.** The prose says unlinking "returns the record to `needs_review`"; the enum also has `unlinked`. Two states for one transition; pick one, or say what each means.
- **`deviceId` / `accountId`.** §9.1 comments "Exactly one of deviceId / accountId is set" with no CHECK constraint to enforce it. Add one — a row with neither is an unattributable observation, which is the one thing this table exists to prevent.
- **`uploadedBy` / `reviewedBy` are `text` with no identity system to fill them.** Staff identity comes from `docs/specs/team-access-and-welfare-queue.md`, which is unshipped. §10 lists steps 1–6 as "independent of the records handover" but step 7 (import) also depends on staff sign-in existing, and §11 risk 5 does not name that dependency.
- **`roleAtTime` vocabulary outruns what exists.** The enum lists `guardian | volunteer | vet`; PRODUCT-SPEC §2.6 puts the invited-role system in MLP and the team-access spec §7 explicitly builds one role. Recording the column now is right; the spec should say those values are unreachable in phase 1 so nobody builds a UI expecting them.
- **§4.4's ear-tip example links to `[see an example](#)`** — a dead anchor for the photo example PRODUCT-SPEC §2.2 requires.
- **§4.2 vs §9.2, twice.** §4.2 defines *Likely* as "**photo-backed** sightings ... and nothing authoritative contradicts it". §9.2's rule requires neither a `photoId` nor a contradiction check. Pick one; the §4.2 version is the better rule.
- **No API for writing a superseding observation** anywhere in §9.6 (see finding 7), and no API for the team's life-status write that §3.4 describes as "an editable field with a short reason box".
- **§12 Q4** ("do we show 'not sterilised' publicly?") is marked as needing Samuel's decision and already carries the right recommendation — no. Worth noting that under §9.2 as written the confirmed-negative state is unreachable anyway (finding 3), so the question is currently moot in the wrong way.

---

## Sections that are sound

One line each, as asked — no manufactured findings here.

- **§2, the append-only decision.** Right call, honestly argued, and the four options are fairly represented; the "Option D is a column and a rebuild script" claim is true.
- **§4.1, the ear-tip asymmetry.** Correct, correctly justified, and correctly given a named test — the rule itself is not the problem, only the absence of a way to fix a wrong instance of it (finding 7).
- **§4.3's rejection of a two-spotter threshold.** The reasoning is right: leaving genuinely-clipped cats at *Unknown* for a season is the worse error.
- **§5.1, asking for records in whatever form they exist.** Exactly the right posture toward a small charity, and the field-by-field "if missing" column is genuinely useful.
- **§6.4.1 (no public per-sighting coordinates), §6.4.2 (distance from the blurred point) and §6.4.3 (stable coarse sort, ties on id).** All three are correct, and 6.4.2 in particular catches a trilateration channel most designs miss.
- **§6.6's private-by-default toggle and the "absence is the only honest privacy setting" argument.** Right, and well reasoned — undermined by finding 2, not by anything in the section itself.
- **§7.1, notes visible to the team and never published.** The moderation-load and "a public note gets performance" arguments are both correct, and it matches PRODUCT-SPEC §2.3.
- **§10's migration sequence.** Genuinely additive, correctly ordered, and step 4's distinction between a claimed cat and a registered owned cat matches the code (`POST /cats` sets `ownerDeviceId` at creation; claim sets it later).
- **Canonical facts.** All correct, including the precise offline claim in §6.5.

---

## What I would gate the spec on

Blocking, in order: **1, 2, 3, 5, 6, 7**. Findings 1 and 2 decide whether the privacy promise can be made at all; 3 and 5 are correctness bugs in the two rules the spec calls load-bearing; 6 and 7 are the two paths by which a confident wrong label enters the record with no way out.

Findings 8, 9 and 10 are corrections to claims about the codebase that are simply not true today and will mislead whoever implements this.
