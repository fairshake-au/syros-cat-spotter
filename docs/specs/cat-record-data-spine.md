# The cat record data spine

**Status:** For review
**Owner:** Samuel
**Covers:** SYC-40 (life status and presumed-deceased), SYC-49 (records import), SYC-41 (blurred public locations), plus the per-sighting note and food-and-water question from the 1 September meeting. Designed to be extended by SYC-52 (the full confidence engine) without a migration that rewrites history.
**Related:** [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §2.3 and §2.4 · [`docs/SPEC.md`](../SPEC.md) · [`docs/superpowers/specs/2026-07-28-cat-health-record-design.md`](../superpowers/specs/2026-07-28-cat-health-record-design.md)

---

## 1. Why this document exists, in one paragraph

Every summer, thousands of photographs of Syros cats arrive in this app. Each one is a dated, located, human-verified fact about an individual animal — the exact raw material a cat charity almost never has. But a photograph only becomes useful when the app knows what it is a photograph *of*: a cat that is alive or gone, sterilised or not, living on a street or in someone's kitchen. A count of sightings is not an answer to "how many cats have we sterilised", "which colonies need us next", or "how do you know". This spec defines the shape the cat record takes so that the 2027 season's observations land in structures that can answer those questions.

The shape matters more than the features. Getting the features later is a sprint. Getting the shape wrong means unpicking two years of data.

---

## 2. The one architectural decision everything else follows from

**Nobody edits a status field. People add dated, attributed observations, and the app works out the status when it displays it.**

An observation is one small statement: *"On 14 June, a spotter photographed this cat and said its left ear tip was clipped."* Observations are never edited and never deleted. If someone is wrong, a later observation supersedes the earlier one, and both stay in the record.

### Options considered

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Status columns on the cat** | `sterilised: boolean`, `life_status: text`, last writer wins | Simplest to build and read. Fast queries with no resolver logic. | The displayed value can drift from the truth with nothing to check it against. A funder asking "how do you know?" gets "someone ticked a box". Three independent spotters seeing the same clipped tip is stronger evidence than one — a boolean cannot represent that; it can only be overwritten. Adding history back after two years is a data-archaeology project. |
| **B. Status columns plus a separate audit log** | The column is truth; the log is a paper trail | Fast reads, some history | Two sources that can disagree, and no rule that says which wins. Audit logs written alongside a column are the classic place where the log quietly stops matching reality. |
| **C. Append-only observations, status derived on read** | One small table of claims; a pure function computes status | The claim trail *is* the evidence. Confidence levels become possible. New roles and new attributes are additive. Matches how the rest of this app already thinks — badges, streaks, fan counts and catalogue totals are all derived, explicitly so they cannot drift. | Every read computes. The resolution rules become their own body of logic that needs hard tests, because a wrong confidence level looks exactly like a right one. |
| **D. Observations plus a cached status column** | C, with a materialised cache for querying | C's honesty with A's read speed | Cache invalidation, which is a real cost to carry before there is any measured need for it. |

### Recommendation

**Option C.** At Syros scale — hundreds of cats, thousands of sightings — deriving on read costs nothing measurable, and the complexity buys the one property this project cannot do without: numbers that survive scrutiny.

Option D is the version this becomes at a hundred times the size. Because the cache would be a pure function of the observation log, it can be added later by adding a column and a rebuild script — no data model change, no history rewrite. We do not build it now. We revisit it the first time a map or catalogue query measurably slows down.

**This decision is what makes SYC-52 additive rather than a rewrite.** The confidence engine is the resolver getting smarter. The table it reads from is the table we are creating here.

---

## 3. Life status

### 3.1 The four states, in plain terms

| Status | What it means to a person | Typical evidence |
|---|---|---|
| **Street** | The cat lives outdoors. This is where nearly every cat in the catalogue starts. | The default. No claim needed. |
| **Homed** | Someone has taken this cat in. It lives in a house now. | A cat guardian or a Syros Cats team member says so. |
| **In care** | The cat is temporarily with Syros Cats, a foster, or a vet — recovering, being treated, or waiting for a home. | A team member says so. |
| **Deceased** | The cat has died and someone knows it. | A team member or the cat's guardian says so. |

Plus one derived state that is **not** a status anyone sets:

| Derived | What it means | How it appears |
|---|---|---|
| **Presumed deceased** | Nobody has seen this cat for three years. | The cat page says *"Not seen since June 2024."* The app never announces a death. |

### 3.2 Who can set what

| Who | Can set |
|---|---|
| **Syros Cats team** (staff, admin) | Any status, on any cat |
| **Cat guardian** | Homed, in care, deceased — on cats they look after |
| **Resident who has claimed a cat** | Homed, on their own claimed cat |
| **Any spotter** | Nothing directly. A spotter's *sighting* is itself evidence the cat is alive, which is the strongest and most common life-status signal we get. A spotter who notices something worrying uses the note field or the trouble report. |

**Deceased is reversible.** Cats presumed dead walk back into frame. A "deceased" observation is superseded by a later observation — including, most powerfully, a new photograph. It is never deleted, so the record shows the mistake being worked out rather than hiding it. This matters: on a small island, a cat reported dead by one person and then photographed alive is a normal Tuesday.

### 3.3 Presumed deceased at three years

**Derived, never stored.** The rule is: no resolved sighting for 36 months, and no explicit life status set more recently than the last sighting.

This is deliberately a computed value rather than a flag set by a nightly job.

| Option | Benefits | Risks |
|---|---|---|
| **Nightly job sets a flag** | Cheap to query. Explicit. | The flag needs unsetting. Every unsetting path is a bug waiting to happen — the classic failure is a cat photographed on Saturday still showing as presumed dead on Monday. Also invites a notification ("Loukoumi is presumed deceased") that we never want to send. |
| **Computed from the last sighting date (recommended)** | Reverts the instant a new photo arrives, with no job and no code path to forget. Impossible for the flag to be stale, because there is no flag. | Every list query needs the last-sighting date — which it already computes for "last seen". |

**Recommendation: computed.**

**What it does and does not do.** A presumed-deceased cat leaves the active counts — colony coverage, "cats needing sterilisation", the targeting view. It stays fully in the record, keeps its page, keeps its history, and keeps counting toward the spotter's collection and the discoverer's credit. Nobody loses a cat they found.

**What the app says.** Never "presumed deceased" as a headline, and never a notification. The cat page reads *"Not seen since June 2024"* in the same quiet place it would read *"Last seen yesterday"*. The team dashboard is the only surface that uses the words "presumed deceased", because the team is using it as a filter, not reading it as news.

### 3.4 What a spotter and the team actually experience

A spotter sees a small, plain line on the cat page: *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, or *"Not seen since June 2024"*. No status pickers, no forms, nothing to fill in. The spot flow is untouched.

A team member on the dashboard sees the status as an editable field with a short reason box, and a list underneath of every previous statement about this cat, who made it and when.

---

## 4. Sterilised status

### 4.1 The rule, stated once and never bent

> **A visible clipped tip is strong evidence a cat has been sterilised. No visible clipped tip is almost no evidence of anything.**

Cats get sterilised without a clip — an older operation, a different vet's practice, a clip that healed subtly, or simply a photo taken from the wrong side. The clip is **usually on the left ear**, which means a right-side photo tells you nothing at all.

**Absence of a visible clip is never negative evidence.** No number of "no clip visible" answers can move a cat toward "not sterilised". Only a Syros Cats team member or a vet can assert that a cat has not been sterilised.

The reason this gets its own section, its own dedicated test, and a place in this document's opening summary: getting it backwards puts every unclipped-but-sterilised cat onto the trapping list. **The failure mode is real people driving to real places, setting a trap for a cat that was done four years ago.** It wastes the scarcest thing the charity has and it distresses the cat. Sterilisation costs Syros Cats €50–60 per cat; a wasted trapping trip costs volunteer hours they cannot buy back.

### 4.2 The three levels

| Level | Reached when | Shown as |
|---|---|---|
| **Confirmed** | An imported Syros Cats record, a team entry, or a vet says the cat was sterilised | *"Sterilised — confirmed by Syros Cats"* |
| **Likely** | One or more photo-backed sightings report a clipped tip, and nothing authoritative contradicts it | *"Probably sterilised — a clipped ear tip has been seen"* |
| **Unknown** | Nothing has been said, or only "can't tell" / "no clip visible" answers exist | *"Not known yet"* |

A fourth level, **Reported**, exists in the data model and the resolver's output type from day one but is not yet reachable — it is where SYC-52 will place a single unconfirmed public claim once prompted-versus-volunteered weighting arrives. Building the ladder with all four rungs now means the later change is a resolver change, not a schema change. See §8.

**Confidence never crosses attributes.** A *Confirmed* ear tip is a confirmed statement about an ear, not about an operation. It contributes to sterilised reaching *Likely* and can never make it *Confirmed*. This is the §4.1 rule expressed as something the resolver enforces rather than a convention it hopes for.

### 4.3 How many clipped-tip sightings make it Likely?

| Option | Benefits | Risks |
|---|---|---|
| **One is enough (recommended)** | Matches reality: a clipped tip in a photograph is a physical fact, not an opinion. Fills the record from the first season. Simple to explain: "somebody saw the clip." | One misread photo shows as *Likely*. Contained, because *Likely* is honestly labelled as probable, is visibly superseded by any team entry, and never blocks anything — it lowers a colony's priority slightly, it does not remove a cat from the list. |
| **Two independent spotters required** | Higher bar; fewer wrong *Likely* labels | Most cats are spotted by one person. This would leave the majority of genuinely-clipped cats sitting at *Unknown* through an entire season, which is a worse error than the one it prevents — and it is exactly the error that sends volunteers out to trap already-done cats. |

**Recommendation: one photo-backed clipped-tip observation reaches *Likely*.** The cat page shows how many people have said it and links to the photos, so the strength of the evidence is visible without needing an extra level. When SYC-52 lands, prompted confirmations (where the app pre-filled the answer) will be weighted below volunteered ones, and it is that change — not a count threshold — that hardens this.

### 4.4 The question a spotter is asked

On the reward screen, after the points, one tap:

> **+15 points** · Agatha spotted again
>
> *One quick thing — is Agatha's ear tip clipped?* (usually the left ear — [see an example](#))
> `Yes, clipped` &nbsp; `No, looks whole` &nbsp; `Can't tell`
>
> *Skip*

- **"Can't tell" is a first-class answer**, recorded as such, and it stops the app asking that spotter about that cat again. It is not a failure and it is not treated as "no".
- **"No, looks whole"** is recorded faithfully and has exactly one effect: it is visible to the team as context. It does not move the status. It never will.
- **Skipping** leaves the attribute *Unknown*, which is the truthful state.
- Which ear was seen is recorded when the answer is "yes" (left / right / not sure), because the left-ear convention makes a right-ear clip worth a second look — not disqualifying, just interesting.

---

## 5. Importing Syros Cats' existing records

Syros Cats keeps sterilisation and TNR records today and will hand them over. Jo sets up TNR records; cat guardians are authorised to arrange sterilisation with Syros Cats paying. Those records are the single biggest injection of *Confirmed* data the app will ever receive, and they arrive once. This section is about not wasting them.

### 5.1 What we ask them for

We ask for whatever they already have, in whatever form they already have it — a spreadsheet export is ideal, a photograph of a notebook page is acceptable and gets typed up. We do not ask them to restructure their records to suit us; that is a request a small charity should never receive from software.

The columns we hope to find, and what each is worth:

| Field | Why it matters | If missing |
|---|---|---|
| **Date of the operation** | Orders the evidence; drives impact reporting by date range | Import as "date unknown"; the record still confirms sterilisation, it just cannot be counted in a period |
| **The cat's name or their reference** | The strongest matching signal we have | Falls back to colony plus description |
| **Colony or location** | Second-strongest matching signal; colonies have fixed names, usually the place plus the name of the person caring for the colony | Matching relies on name alone |
| **Sex** | Fills an attribute we otherwise rarely learn | Left unknown |
| **Vet or clinic** | Provenance; supports funder reporting | Recorded as "Syros Cats record" |
| **Ear tip clipped, and which side** | Lets us cross-check crowd observations | Assumed nothing |
| **Cat guardian's name** | Matching signal, and the route to a guardian account later | Ignored |
| **Cost** | Funder reporting against the €50–60 per cat figure | Ignored |
| **Free-text notes** | Kept verbatim; often the only thing that identifies a cat | — |

### 5.2 The pipeline

Four stages, each of which can be stopped and inspected.

1. **Land the file, untouched.** Every row is stored verbatim in a staging table alongside a hash of its content and the name of the file it came from. Nothing is interpreted yet. This is what makes the import re-runnable and re-derivable — if we discover in six months that the matching was too eager, we re-run it against the original rows rather than reconstructing them.
2. **Normalise.** Dates parsed (Greek and English formats), names trimmed and case-folded, colonies mapped onto the app's colony names. Anything that will not parse is flagged, not guessed.
3. **Match to a cat in the app.** Scored, never automatic beyond a high bar. See §5.3.
4. **Apply.** Matched rows become observations with provenance `import` and source `Syros Cats records`, which resolve to *Confirmed*. Unmatched rows wait in a pool. See §5.4.

**Re-running the import is safe.** The pair (source file, row hash) is unique, so the same row imported twice produces one observation. A corrected spreadsheet re-imported later adds only the changed rows.

### 5.3 Matching imported records to cats in the app

Candidates are scored, and the score decides what happens — it never decides silently.

| Signal | Weight |
|---|---|
| Cat name matches, case-insensitive, exactly | Very strong |
| Cat name is a near-match (one or two characters, or a known transliteration between Greek and Latin script) | Strong |
| Colony matches | Moderate |
| Record location within 500 m of the cat's sightings | Moderate |
| Cat guardian's name matches the claimed owner | Moderate |
| Sex contradicts a recorded sex | Strong negative |

| Outcome | Rule | What happens |
|---|---|---|
| **Auto-linked** | Exact name match, and exactly one cat in the catalogue has that name | Applied immediately. Names are already unique case-insensitively across the catalogue, so this is unambiguous by construction. |
| **Needs review** | Any other scoring cat | Lands in the team dashboard's import queue: the record on one side, up to three candidate cats with photos on the other, and buttons for *this one* / *none of these*. |
| **Unmatched** | Nothing scores | Goes to the waiting pool. See §5.4. |

**Nothing is auto-linked on location or colony alone.** In a thirty-cat colony, "a sterilised cat near the bakery" identifies no individual.

### 5.4 Records with no cat yet

Most of Syros Cats' records will describe cats the app has never photographed. This is the interesting case, and there are two ways to handle it.

| Option | Benefits | Risks |
|---|---|---|
| **A. Create a photo-less cat entry for every unmatched record** | Every sterilisation is immediately visible and countable. The island count jumps to something closer to reality. | The catalogue fills with cats nobody can spot, collect, or see a photo of. The collection grid — the reason tourists come back — becomes mostly locked grey squares for cats that may not exist any more. Duplicates become near-certain when the real cat is later photographed and named something else. |
| **B. Hold them in a waiting pool, attach on first sighting (recommended)** | The public catalogue stays honest: everything in it is a cat somebody has seen. Impact reporting still counts these records, from the pool, because the pool is part of the data. When a matching cat is later spotted, the team gets a suggestion and one tap links the record — turning a first sighting into a *Confirmed* sterilisation. | Two places to look when answering "is this cat done?" — handled by the resolver consulting both, so only the code sees the seam. |

**Recommendation: Option B.** The catalogue is a record of cats that have been seen; the pool is a record of operations that have been performed. Both are true, and conflating them damages the one that tourists interact with.

Impact figures report both, plainly: *"142 cats in the catalogue: 89 confirmed sterilised, 23 likely, 30 not known. A further 46 sterilisations are on record for cats not yet photographed."*

### 5.5 When the import contradicts what the app derived

| Situation | What happens | Why |
|---|---|---|
| App says *Likely* (clipped tip seen), import confirms sterilised | Becomes *Confirmed*. Both observations stay. | The crowd was right, and the record now says so with authority. |
| App says *Unknown*, import confirms sterilised | Becomes *Confirmed*. | The whole point of the import. |
| App says *Likely*, import record says the cat was **not** sterilised (e.g. a trapping that did not proceed) | Newest dated statement wins. Flagged for the team either way. | A team assertion of "not sterilised" is authoritative, but a clipped tip photographed *after* that date means something changed. The team sees the conflict and decides. |
| Import confirms sterilised, a later team entry says not sterilised | The later team entry wins, and the conflict is flagged prominently. | Almost always means the record was matched to the wrong cat. This is the signal that the matching needs correcting. |
| Two import rows disagree with each other about the same cat | Both applied; the newer date wins; flagged. | Their records, their conflict — we surface it rather than silently picking. |

**No import row ever overwrites or deletes anything.** Every one of these outcomes is an addition to the trail, and every one is reversible by adding a further observation.

**Unlinking is supported.** A record linked to the wrong cat can be unlinked from the team dashboard; the link removal is itself recorded, the record returns to the review queue, and the derived status recomputes immediately.

---

## 6. Location privacy

### 6.1 What we are protecting against

Two different things, and they need two different answers.

1. **Casual harm.** Someone browsing the public app finding the exact bush a cat sleeps under. Anyone who wishes a cat harm, and anyone who wants to dump unwanted kittens somewhere cats are known to be fed.
2. **Patient harm.** Someone with a script, sampling the public API repeatedly and working out exact positions from data that was supposed to be approximate.

The second is the one that quietly defeats most blurring schemes, so it drives the method.

### 6.2 The blurring method

| Option | How it works | Benefits | Risks |
|---|---|---|---|
| **A. Random jitter per request** | Add a random offset each time the location is served | Trivial to implement; looks blurred | **Defeated completely by averaging.** Sample the same cat two hundred times and the mean of the offsets converges on the true position. This is the standard mistake. |
| **B. Fixed random offset per cat** | One offset generated per cat, stored, reused forever | Immune to averaging | The offset is a stored secret that must never leak, and a single leak exposes that cat exactly. Also produces a map where cats appear in the sea or on cliff faces, which looks broken. |
| **C. Snap to a fixed grid (recommended)** | The island is divided into fixed cells. The public location of a cat is the centre of the cell its true location falls in. | Deterministic — a thousand requests return one identical answer, so repeated sampling yields exactly nothing. No secret to leak. Cheap: a rounding operation, no state. Honest to display: a circle over a cell is a truthful picture of what is known. | Cats near a cell boundary can appear to jump between cells if their true position drifts across it — mitigated because we snap the cat's *derived* location, which moves rarely. A cell centre can land in the sea; we display a circle, not a pin, so this reads correctly. |
| **D. No public locations at all** | Cat pages show a colony name and no map position | Perfect privacy | Kills the map, which is a large part of why the app is enjoyable, and removes the "cats near you" experience the whole spot flow leads with. |

**Recommendation: Option C, with a cell size of 250 m and a displayed circle of 300 m radius.**

Practically: latitude and longitude are quantised to a grid of roughly 250 m (about 0.00225° of latitude, with the longitude step scaled by the cosine of Syros's latitude so cells stay square). The published position is the centre of the cell. The map draws a soft 300 m circle, never a pin, with the label *"Somewhere around here"*.

**Why 250 m and not 100 m or 1 km.** At 100 m a cell often contains one doorway, which is not protection. At 1 km, half of Syros is one circle and the map stops saying anything. 250 m is roughly a block of Ermoupoli: enough to find the cat if you walk around and look, which is the intended experience, and not enough to point at a specific house. This number is a judgement call and is written as a single configuration value so it can be changed after the team sees the first real map.

### 6.3 How this interacts with the 500 m matching cap

**It does not, and that is deliberate.**

Matching a new photo against cats within 500 m happens **on the server, using exact coordinates, always.** Blurring is applied when a payload is built for a public reader — it is a presentation rule, never a data rule. The exact position is stored, is used for matching, targeting, colony clustering and every internal calculation, and is simply not published.

Two consequences to hold on to:

- If blurring were ever applied before matching, a 250 m quantisation inside a 500 m radius would misjudge candidates near the edge, and the matching quality — on which every impact number rests — would degrade for a privacy benefit that was already achieved elsewhere. There is a test asserting the matching path reads exact coordinates.
- On-device matching, when it arrives, changes this picture: a phone that matches offline needs candidate locations locally. The answer then is that on-device matching runs against the *photo fingerprints* of nearby cats without needing their published coordinates to be exact, and any exact coordinates cached on a device belong to a signed-in team member's device only. Flagged here so it is not discovered late.

### 6.4 Preventing de-anonymisation by repeated sampling

Grid snapping handles the obvious attack. Four less obvious leaks close the rest:

1. **Per-sighting coordinates are never public.** This is the big one. Blurring a cat's single location while publishing forty exact sighting coordinates for that cat protects nothing — the sightings cluster on the truth. Public sighting history shows photo, spotter and date, and no position. The team sees positions.
2. **Distance is computed from the published position, not the true one.** Publishing an exact "1.37 km away" alongside a blurred dot lets anyone with three positions trilaterate the true point in seconds. Public `distanceKm` is computed from the cell centre and rounded to 100 m.
3. **Sorting is stable and coarse.** "Cats near me" sorts by the same blurred distance everyone else sees. Two cats in one cell tie, and ties break on cat id, not on true distance.
4. **Timestamps are coarse in public.** Public "last seen" is a date, not a timestamp. An exact time plus a small area is a pattern of life — for the cat, and for the person who feeds it at the same hour every day.

A test suite asserts each of these by making the same request repeatedly and confirming byte-identical geography, and by confirming no public payload contains a raw sighting coordinate.

### 6.5 Who sees exact locations

| Who | Sees |
|---|---|
| The public, signed out | Blurred cell centre, 300 m circle, coarse distance, no sighting positions |
| A spotter, on their own sightings | Their own exact positions — it is their data and their walk |
| Cat guardian, on cats they look after | Exact position of those cats |
| Syros Cats team | Everything, exactly |

**The offline cache carries whatever the API returns.** The app's catalogue cache is a store of API responses, so blurring must be applied server-side when the payload is constructed — never in the rendering layer, or the exact figures sit on every tourist's phone in plain view. Two rules follow: the server decides based on the authenticated caller, and a device that signs out of a team account purges its cached catalogue and re-fetches. Offline support in this app is partial — photos, capture locations and map tiles work without signal, and the spot queue syncs later; a signed-out team device with a stale cache is exactly the gap this rule closes.

### 6.6 Feeding sites

Feeding sites are mapped in full, and are **private by default**. Syros Cats chooses individual sites to make public.

- **Private sites do not appear in public payloads at all** — not blurred, not as a count, not as a heat overlay. A blurred dot still says "there is a feeding site roughly here", which is most of the information someone dumping kittens needs. Absence is the only honest privacy setting for these.
- **Public sites show their exact position.** Making a site public is a deliberate act with a purpose — directing people to somewhere they can help — and a 300 m circle around a food bowl serves nobody. The team is choosing exposure knowingly, site by site.
- The toggle is per site, on the team dashboard, defaulted to private, and shows a one-line reminder of why: cat feeders face neighbour hostility, and known feeding sites attract abandonment.
- **Cat locations are still blurred near a public feeding site.** The two settings are independent; making a site public never publishes the exact position of a cat.

---

## 7. What each sighting now carries

Two additions, both optional, both on the screen that already exists after the points are awarded. Neither blocks anything. **The fastest way to kill this project is to put a questionnaire between a spotter and their points.**

### 7.1 "Anything you noticed?"

A free-text box, up to 500 characters, in any language, entirely optional.

**These notes are visible to the Syros Cats team and are never published publicly.** Not on the cat page, not in the sighting list, not in the API's public payloads. The author sees their own note on their own device.

Not publishing them is the whole design:

- It keeps moderation load near zero. Nothing a stranger types is shown to another stranger, so there is nothing to moderate in public, and the offensive-language filter that guards cat names is not load-bearing here.
- It changes what people write. A note nobody will read except the charity gets *"limping on back left, hiding under the blue boat"* — which is useful. A public note gets performance.

The team dashboard shows notes on the cat page and in a single reviewable stream, newest first, with the sighting photo attached. A note mentioning injury, illness or kittens is highlighted, because the trouble-report flow is not the only way distress reaches us — most of the time somebody just types it.

Notes may contain personal information (a person's name, a doorway). They are stored under the same handling as everything else in §9: purpose stated, team-scoped, deletable on request, and covered by a retention position.

### 7.2 "Do they have food and water?"

Three taps: `Yes` · `No` · `Can't tell`.

This is a genuine field-intelligence question and it is asked because Syros Cats asked for it. It says where the feeding network reaches, which is the input to "where does a new feeding site go", and in winter — when street cats depend on people far more than in August — a "no" is meaningful.

Recorded as an observation about the *place and the moment*, not a permanent fact about the cat, because a bowl that was empty at nine is full at ten. The team sees it aggregated: for each area, the proportion of recent sightings reporting food and water, and a list of cats where the last three answers were "no".

Skipping is normal and costs nothing.

---

## 8. What we are leaving room for

The full confidence engine (SYC-52) is a later phase. This section is the explicit list of what it will need, so that it arrives as a resolver change and a few new observation kinds — never as a migration that rewrites history.

Recorded from day one, even though nothing reads them yet:

| We record now | So that later we can | Why it cannot be added later |
|---|---|---|
| **Provenance** — `volunteered`, `prompted`, `machine`, `import`, `legacy` | Weight prompted confirmations below volunteered ones. If three people were each shown the same pre-filled "left ear looks clipped", they agreed with one model's guess three times; they did not independently observe anything. | It is unrecoverable retrospectively. Discovering in six months that a threshold was too low is a re-derivation if provenance was recorded and permanent contamination if it was not. It costs one column. |
| **The observer's role at the time of writing** | Apply authority per attribute — a vet outranks everyone on clinical facts and has no special standing on where a cat sleeps. | Roles change and people are revoked. A role looked up at read time gives the wrong answer for every historical observation. |
| **All four confidence levels in the resolver's return type** | Introduce *Reported* without changing any caller's shape | Adding a level to an enum that clients switch on exhaustively is a breaking change across the app and the offline cache. |
| **A `kind` string on every observation, from an open vocabulary** | Add vaccinated, sex, age class, pregnant/nursing, condition, appearance without a schema change | A column-per-attribute design needs a migration and a deploy for each new question. |
| **A structured `value` (JSON) rather than a boolean** | Hold "sterilised on 3 March at Dr X's clinic, €55" and "ear tip seen, left side" in the same table | Booleans cannot grow. |
| **`observed_at` separate from `created_at`** | Order evidence by when the thing happened, not when it was typed — essential for imports of ten-year-old records and for offline sightings synced days later | Retrofitting an observation date onto rows that only recorded insertion time is guesswork. |
| **`supersedes` / retraction as its own observation** | Corrections that stay visible | A delete is not recoverable. |
| **Expiry semantics on the kind, not the row** | Age pregnancy and nursing out of current status into history, or a cat is permanently pregnant in the app | Requires knowing which kinds expire, which is a property of the vocabulary — free if the vocabulary is data, expensive if it is a column layout. |

**Not built now, on purpose:** per-attribute authority tables, prompted-versus-volunteered weighting, machine-written observations and their measured thresholds, the *Reported* level, the confirmation queue, pregnancy expiry, appearance vocabulary, duplicate merge. Every one of them is a resolver or vocabulary addition on top of this table.

The resolver lives in one pure, dependency-free module with no database access, tested in isolation — the same treatment `streak.ts` received, for the same reason: it fails silently and plausibly. A wrong confidence level looks exactly like a right one.

---

## 9. Technical specification

Everything above is the product. Everything below is how it is built.

### 9.1 Observations

```ts
// lib/db/src/schema/observations.ts
export const observationsTable = pgTable("observations", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),

  // Open vocabulary. Phase 1 emits: life_status, sterilised, ear_tip,
  // food_and_water, note. Later phases add kinds without a migration.
  kind: text("kind").notNull(),

  // Structured, kind-specific. e.g.
  //   life_status    { status: "homed" }
  //   sterilised     { sterilised: true, date: "2024-03-03", clinic: "…", costEur: 55 }
  //   ear_tip        { clipped: true, side: "left" }        // side: left|right|unsure
  //   ear_tip        { clipped: false } | { clipped: "cant_tell" }
  //   food_and_water { present: true } | { present: false } | { present: "cant_tell" }
  //   note           { text: "…" }
  value: jsonb("value").notNull(),

  // Who said it. Exactly one of deviceId / accountId is set.
  deviceId: text("device_id"),
  accountId: text("account_id"),
  // The observer's role AT THE TIME OF WRITING. Never looked up at read time.
  roleAtTime: text("role_at_time").notNull().default("public"),
  // public | guardian | volunteer | vet | staff | admin | system

  // volunteered | prompted | machine | import | legacy
  provenance: text("provenance").notNull().default("volunteered"),

  sightingId: integer("sighting_id"),   // when it came from a spot
  photoId: integer("photo_id"),         // the evidence
  importRecordId: integer("import_record_id"), // when it came from §5

  // When the thing was true, not when the row was written.
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Retraction/correction: points at the observation this one replaces.
  supersedesId: integer("supersedes_id"),
  supersedeReason: text("supersede_reason"),
}, (t) => [
  index("observations_cat_kind_idx").on(t.catId, t.kind, t.observedAt),
  index("observations_kind_idx").on(t.kind),
]);
```

Rows are inserted and never updated or deleted. A database trigger or repository-level guard enforces this; the API layer exposes no update or delete path.

### 9.2 The resolver

```ts
// artifacts/api-server/src/lib/resolve.ts — pure, no db, no io
export type Confidence = "confirmed" | "likely" | "reported" | "unknown";

export interface Resolved<T> {
  value: T | null;
  confidence: Confidence;
  supportingObservationIds: number[];
  asOf: string;
}

export function resolveSterilised(
  observations: Observation[],
  importRecords: ImportRecord[],   // §5.4 waiting pool, when linked
): Resolved<boolean>;

export function resolveLifeStatus(
  observations: Observation[],
  lastSightingAt: string | null,
  now: Date,
): Resolved<"street" | "homed" | "in_care" | "deceased"> & {
  presumedDeceased: boolean;
  notSeenSince: string | null;
};
```

Phase-1 rules the resolver implements:

- **Sterilised.** Any non-superseded observation with `kind: "sterilised"`, `value.sterilised === true`, and `roleAtTime` in {vet, staff, admin} or `provenance: "import"` → **confirmed**. Otherwise, any non-superseded `ear_tip` with `value.clipped === true` → **likely**. Otherwise → **unknown**. `value.clipped === false` and `"cant_tell"` are collected into `supportingObservationIds` for display and **never affect the level**. A `sterilised: false` assertion resolves to a confirmed negative only from {vet, staff, admin} or an import row.
- **Life status.** The newest non-superseded `life_status` observation by `observedAt` wins. `presumedDeceased` is true when there is no resolved sighting within 36 months and no `life_status` observation newer than the last sighting. A `deceased` status with a resolved sighting after it is reported as a conflict to the team and does not suppress the sighting.
- **Never crosses attributes.** There is an explicit test that no quantity or authority of `ear_tip` observations can produce `confidence: "confirmed"` on sterilised.

### 9.3 Import tables

```ts
export const importBatchesTable = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer("row_count").notNull(),
  notes: text("notes"),
});

export const importRecordsTable = pgTable("import_records", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  rowHash: text("row_hash").notNull(),      // sha256 of the raw row
  raw: jsonb("raw").notNull(),              // the row, verbatim, forever
  parsed: jsonb("parsed"),                  // normalised fields, null if unparseable
  parseErrors: jsonb("parse_errors"),
  catId: integer("cat_id"),                 // null while unmatched
  matchState: text("match_state").notNull().default("unmatched"),
  // unmatched | needs_review | auto_linked | linked | rejected | unlinked
  matchScore: doublePrecision("match_score"),
  matchCandidates: jsonb("match_candidates"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("import_records_batch_row_unique").on(t.batchId, t.rowHash),
  index("import_records_state_idx").on(t.matchState),
]);
```

Linking an import record writes an `observations` row with `provenance: "import"` and `importRecordId` set. Unlinking supersedes that observation and returns the record to `needs_review`.

### 9.4 Feeding sites

```ts
export const feedingSitesTable = pgTable("feeding_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),          // location + carer, matching colony convention
  colonyName: text("colony_name"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  madePublicBy: text("made_public_by"),
  madePublicAt: timestamp("made_public_at", { withTimezone: true }),
  notes: text("notes"),                  // team-only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

The public sites endpoint filters `isPublic = true` in the query, not in the serialiser. Private rows never enter a public response object.

### 9.5 Location blurring

```ts
// artifacts/api-server/src/lib/blur.ts — pure
export const BLUR_CELL_METRES = 250;
export const BLUR_DISPLAY_RADIUS_METRES = 300;

export function blurPosition(lat: number, lng: number): { lat: number; lng: number };
export function publicDistanceKm(fromLat, fromLng, catLat, catLng): number; // blurs first, rounds to 0.1
```

Applied in one place: the payload builders in `artifacts/api-server/src/lib/catHelpers.ts`. `listCatsWithStats` and the cat-detail builder take a `viewer` argument (`public | owner | guardian | team`) and blur unless the viewer is entitled to exact positions. `haversineKm` continues to receive exact coordinates for matching and internal use, unchanged.

### 9.6 API changes

`Cat` and `CatDetail` gain:

```yaml
lifeStatus:
  type: string
  enum: [street, homed, in_care, deceased]
locationPrecision:
  type: string
  enum: [exact, approximate]
  description: |
    "approximate" means lat/lng are the centre of a ~250 m cell and should be
    drawn as a circle of locationRadiusM, never as a pin.
locationRadiusM: { type: integer, nullable: true }
notSeenSince: { type: string, nullable: true }
sterilised:
  type: object
  properties:
    value: { type: boolean, nullable: true }
    confidence: { type: string, enum: [confirmed, likely, reported, unknown] }
    clippedTipSightings: { type: integer }
```

`lat`/`lng` keep their names and meaning ("where this cat is") — clients do not branch on a different field. `locationPrecision` tells the map how to draw it. Public `CatDetail.sightings[]` drops `lat` and `lng` entirely; the team payload keeps them.

`POST /sightings/{id}/resolve` accepts optional `earTip` (`clipped_left | clipped_right | clipped_unsure | looks_whole | cant_tell`), `foodAndWater` (`yes | no | cant_tell`), and `note` (string, ≤500 chars). Each written as its own observation with `provenance: "prompted"` when the app pre-filled the answer and `"volunteered"` when it did not.

### 9.7 Tests that must exist

The resolver carries the design risk, so it carries the tests.

1. **The ear-tip asymmetry.** No quantity, authority or recency of "no clip visible" observations moves sterilised away from its current level or toward a negative. Dedicated, named, and commented with why it exists.
2. A clipped-tip observation reaches *likely* and never *confirmed*, whoever wrote it.
3. An import row reaches *confirmed*, and a later staff negative supersedes it while leaving both in the trail.
4. Presumed-deceased reverts on a sighting dated after a `deceased` observation, in the same read, with no job run.
5. Presumed-deceased is computed from `observedAt`, so an offline sighting synced four days late still counts from when it was taken.
6. Every public payload is asserted to contain no exact coordinate, no sighting coordinate, no note, no private feeding site, and no raw device id.
7. The same public request repeated a hundred times with varied viewer positions returns byte-identical geography.
8. The matching path reads exact coordinates, asserted directly against the 500 m candidate query.
9. Import is idempotent: the same file twice produces one set of observations.

---

## 10. Migrating what is already there

Nothing is thrown away and no existing behaviour changes for a spotter.

| Step | What happens | Risk handling |
|---|---|---|
| 1. Create the tables | `observations`, `import_batches`, `import_records`, `feeding_sites`. Nothing reads them yet. | Additive; no existing column touched. |
| 2. Backfill life status | Nothing is written. Every cat with no `life_status` observation resolves to **street**, which is correct for essentially every cat in the catalogue. | The default is the truth here, so an empty table is an accurate table. |
| 3. Backfill from the care timeline | Existing `desexed` care updates become `sterilised` observations with `provenance: "legacy"`, `roleAtTime: "staff"` (they were written through the admin endpoint), and `observedAt` set to the update's date. Existing `adopted` updates become `life_status: homed`. | `legacy` provenance means these can be re-derived or discounted later if the confidence engine decides they should be weighted differently. |
| 4. Claimed cats are **not** made "homed" | A resident claiming a cat means "this is my cat, I feed it" — usually a street cat with a person. Cats registered through `POST /cats` (owner registration, no sighting) become **homed**, because that flow only exists for cats living with someone. | Guardians are asked once, in the app, to confirm — one tap, dismissible, never nagged. |
| 5. Turn on blurring | The payload builders start blurring, and public sighting coordinates disappear from responses. | Deployed with the client change that draws circles instead of pins. Clients still holding a cached exact payload are served correct data on next fetch; a version bump on the catalogue cache key forces a re-fetch rather than waiting for expiry. |
| 6. Add the two sighting questions | Reward screen gains one tap question and one optional box. | No change to the spot, match or resolve paths. |
| 7. Import the Syros Cats records | Staged, reviewed in the dashboard, applied. | Reversible per row; the raw rows are kept permanently. |

Steps 1–6 are independent of the records handover and are not blocked by it.

---

## 11. Risks

| # | Risk | Consequence | Mitigation |
|---|---|---|---|
| 1 | **The ear-tip rule gets inverted by a well-meaning later change** — someone reasonably concludes that ten "no clip visible" answers should mean something | Volunteers driving out to trap cats sterilised years ago, wasting the charity's scarcest resource and distressing the cat | The rule is stated in the product spec, this spec, a named test, and a comment on the resolver branch. The test's failure message says what breaks in the real world. |
| 2 | **The records import matches rows to the wrong cats** — a single wrong link makes a *Confirmed* sterilisation on a cat that has not had one | Worse than no import: the cat drops off the trapping list with a confident label | Only exact unique name matches auto-link. Everything else is human-reviewed with photos. Raw rows kept forever; unlinking is one action and recomputes immediately. |
| 3 | **Location blurring leaks through a side channel** — a new endpoint, a sort order, a distance figure, or the offline cache carrying an exact payload | The privacy promise made to Syros Cats is quietly false, and nobody finds out until someone shows them | Blurring lives in the payload builders, not the renderers; tests assert no public payload holds an exact or per-sighting coordinate; the cache key is versioned; signing out purges. |
| 4 | Notes arrive containing urgent welfare information and sit unread in a stream | A cat that needed help did not get it, and the app collected the evidence | Notes matching injury/illness/litter keywords in all three languages are highlighted in the dashboard and counted in the daily team summary. The trouble-report flow stays the primary route and is signposted from the note box. |
| 5 | The records handover slips past the import window | The season's *Confirmed* baseline never arrives, and every figure stays *Likely* | The import is built and tested against a synthetic file so it is ready the day the records arrive; nothing else in this spec is blocked on it. Owner: Syros Cats, chased by Samuel. |
| 6 | Deriving status on every read becomes slow as the catalogue grows | Catalogue and map feel sluggish | The cached-status column (§2, option D) is a pure function of the log, addable without a data model change. Trigger: any catalogue query above 200 ms. |
| 7 | Notes and guardian details make this an app that processes personal data properly for the first time | GDPR obligations that a "we hold almost nothing" threat model does not cover | Purpose stated at the point of entry, team-scoped access, real deletion, a written retention position. Sequenced as one deliberate change, not scattered fields. Owner: Samuel. |

---

## 12. Open questions

| # | Question | Owner | Why it needs a person |
|---|---|---|---|
| 1 | **Is 250 m the right blur cell for Syros?** A cell is about a block of Ermoupoli. Too coarse and the map stops being useful in dense town; too fine and it points at a doorway. | Syros Cats, with Samuel | Local knowledge beats any number we pick. One config value; changeable after they see the first real map. |
| 2 | **Should a public feeding site show its exact position, or be blurred too?** This spec recommends exact, on the grounds that making a site public is a deliberate act with a purpose. | Syros Cats | It is their exposure and their neighbours. |
| 3 | **What shape are the existing sterilisation records actually in?** §5.1 is our best guess at the columns. Their real headings beat our inference. | Syros Cats (Jo, Susan) | Blocks nothing, but the sooner it is known the less rework in the matching. |
| 4 | **Do we ever show "not sterilised" publicly?** A confirmed negative is real information and it is also a target painted on a cat. | **Samuel — genuinely needs a decision** | Recommendation: no. Publicly, a cat is *sterilised (confirmed)*, *probably sterilised*, or *not known yet*, and a confirmed negative displays as *not known yet* while the team sees the truth. It costs the public nothing and removes a targeting risk we cannot take back. |
| 5 | **Should a cat guardian be able to mark their own cat deceased without team confirmation?** | Syros Cats | Recommendation: yes — they are the person most likely to know, and it is reversible by any later sighting. |
| 6 | **How long do we keep sighting notes?** They may contain personal information. | Samuel, with Syros Cats | Recommendation: indefinitely for notes attached to a welfare outcome, three years otherwise, deletable on request. |
