# The cat record data spine

**Status:** **Approved by Samuel, 28 September 2026**, with his review edits incorporated. Revised after adversarial review and Samuel's decisions of 3 September 2026 (`docs/specs/DECISIONS.md`). §10.9 (match records, SYC-151) approved by Samuel, 4 October 2026.
**Owner:** Samuel
**Covers:** SYC-40 (life status and presumed-deceased), SYC-41 (blurred public locations), the deletion mechanism (F3), the status-change feed the email spec reads (F4), the team-only match record behind hand picks (SYC-151, §10.9), plus the per-sighting note and food-and-water question from the 1 September meeting. Designed to be extended by SYC-52 (the full confidence engine) without a migration that rewrites history.
**Related:** [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §2.3 and §2.4 · [`docs/SPEC.md`](../SPEC.md) · [`docs/superpowers/specs/2026-07-28-cat-health-record-design.md`](../superpowers/specs/2026-07-28-cat-health-record-design.md) · [`docs/specs/team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) · [`docs/specs/email-capture.md`](./email-capture.md) · [`docs/specs/hosting-and-photo-storage.md`](./hosting-and-photo-storage.md)

**What this document owns**, per the ownership table in `DECISIONS.md`: the cat record model, observations and how status is worked out; presumed-deceased; location blurring, the nearest-cat oracle and feeding-site privacy; records import and matching; the team-only match record behind hand picks; and the deletion mechanism. Other specs reference this behaviour rather than restating it. In particular, `team-access-and-welfare-queue.md` independently described a status-column-plus-audit-log record model — the exact design §2 rejects by name. **That description is struck; this document owns the record.** Sign-in, roles, the dashboard, the welfare queue and the safety copy are that document's, and are referenced here, never redefined.

**Section numbering changed in this revision.** Deletion (§8) and the status-change feed (§9) are new sections; the technical specification is now §10 and the migration plan §11. Anything citing the old §9.x should cite §10.x.

---

## 1. Why this document exists, in one paragraph

Every summer, thousands of photographs of Syros cats arrive in this app. Each one is a dated, located, human-verified fact about an individual animal — the exact raw material a cat charity almost never has. But a photograph only becomes useful when the app knows what it is a photograph *of*: a cat that is alive or gone, sterilised or not, living on a street or in someone's kitchen. A count of sightings is not an answer to "how many cats have we sterilised", "which colonies need us next", or "how do you know". This spec defines the shape the cat record takes so that the 2027 season's observations land in structures that can answer those questions.

The shape matters more than the features. Getting the features later is a sprint. Getting the shape wrong means unpicking two years of data.

---

## 2. The one architectural decision everything else follows from

**Nobody edits a status field. People add dated, attributed observations, and the app works out the status when it displays it.**

An observation is one small statement: *"On 14 June, a spotter photographed this cat and said its left ear tip was clipped."* Observations are never edited and never deleted. If someone is wrong, a later observation supersedes the earlier one, and both stay in the record.

### 2.1 Options considered

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Status columns on the cat** | `sterilised: boolean`, `life_status: text`, last writer wins | Simplest to build and read. Fast queries with no resolver logic. | The displayed value can drift from the truth with nothing to check it against. A funder asking "how do you know?" gets "someone ticked a box". Three independent spotters seeing the same clipped tip is stronger evidence than one — a boolean cannot represent that; it can only be overwritten. Adding history back after two years is a data-archaeology project. |
| **B. Status columns plus a separate audit log** | The column is truth; the log is a paper trail | Fast reads, some history | Two sources that can disagree, and no rule that says which wins. Audit logs written alongside a column are the classic place where the log quietly stops matching reality. |
| **C. Append-only observations, status derived on read** | One small table of claims; a pure function computes status | The claim trail *is* the evidence. Confidence levels become possible. New roles and new attributes are additive. Matches how the rest of this app already thinks — badges, streaks, fan counts and catalogue totals are all derived, explicitly so they cannot drift. | Every read computes. The resolution rules become their own body of logic that needs hard tests, because a wrong confidence level looks exactly like a right one. |
| **D. Observations plus a cached status column** | C, with a materialised cache for querying | C's honesty with A's read speed | Cache invalidation, which is a real cost to carry before there is any measured need for it. |

### 2.2 Recommendation

**Option C.** At Syros scale — hundreds of cats, thousands of sightings — deriving on read costs nothing measurable, and the complexity buys the one property this project cannot do without: numbers that survive scrutiny.

Option D is the version this becomes at a hundred times the size. Because the cache would be a pure function of the observation log, it can be added later by adding a column and a rebuild script — no data model change, no history rewrite. We do not build it now.

**This decision is what makes SYC-52 additive rather than a rewrite.** The confidence engine is the resolver getting smarter. The table it reads from is the table we are creating here.

### 2.3 Will deriving on read actually be fast enough?

The review's answer, which we accept: yes for the arithmetic, no for the surrounding query. The resolver itself is a fold over tens of thousands of rows in JavaScript and costs single-digit milliseconds. What is not fine is the endpoint it sits inside.

Three volumes matter, and each gets a named answer rather than an assurance:

| Where | What it looks like today | What this spec requires |
|---|---|---|
| **The catalogue** (`GET /cats`) | Unpaginated. Every cat, every app open, with a `LEFT JOIN sightings … GROUP BY` and two correlated sub-queries per row. The whole payload is then written to the phone's cache. | **Paginate it**, and load each cat's observations in one batched query keyed by cat id — never one query per cat. Pagination is cheaper than caching and it is the fix that keeps working as the catalogue grows. |
| **The map** | Same endpoint, same payload | The map needs position, name, photo and status — not history. Serve the map from the same paginated response; never a per-cat round trip. |
| **Offline sync** | The catalogue response is stored whole under one key | The phone stores a *derived summary* per cat, not the observation log. Nothing about this design puts the evidence trail on a tourist's phone. |

**The trigger everyone forgets to build.** §13 risk 6 says "revisit if a catalogue query goes above 200 ms". Today there is no timing instrumentation, no slow-query log and no metrics anywhere in the API, so that trigger is unobservable and therefore not a mitigation. **Request-duration logging on `GET /cats` and `GET /cats/{id}` ships in the same change as the resolver**, or the first person to notice the slowdown is a user.

Separately, and outside this spec's scope but worth naming because it will hurt first: `POST /sightings` already does a full table scan of `cats` plus one base64 photo fetch per candidate out of Postgres. §6.3 changes what that query selects on; making it cheap belongs with the photo-storage work in `hosting-and-photo-storage.md`.

---

## 3. Life status

### 3.1 The four states, in plain terms

| Status | What it means to a person | Typical evidence |
|---|---|---|
| **Street** | The cat lives outdoors. This is where nearly every cat in the catalogue starts. | The default. No claim needed. |
| **Homed** | Someone has taken this cat in. It lives in a house now. | A cat guardian or a Syros Cats team member says so, or an owner claims the cat. |
| **In care** | The cat is temporarily with Syros Cats, a foster, or a vet — recovering, being treated, or waiting for a home. | A team member says so, or a vet does if the cat is in their care. |
| **Deceased** | The cat has died and someone knows it. | A team member or the cat's guardian says so. |

Plus one derived state that is **not** a status anyone sets:

| Derived | What it means | How it appears |
|---|---|---|
| **Presumed deceased** | Nothing has been heard of this cat for three years. | The cat page says *"Not seen since June 2024."* The app never announces a death. |

### 3.2 Who can set what

| Who | Can set |
|---|---|
| **Syros Cats team** (staff and management) | Any status, on any cat |
| **Cat guardian** | Homed, in care, deceased — on cats they look after, directly, with no team check. She may put back the life status she herself replaced, within 30 days. She may also set a cat's sterilisation answer (§4.2), and add cats to, or take them out of, her own colonies (§10.5), directly |
| **Vet** | In care, on a cat in their care. Vet accounts come later (SYC-24); until then the team records it on the vet's word. |
| **Resident who has claimed a cat** | Homed, on their own claimed cat. They may also withdraw that statement when the cat no longer lives with them, which supersedes it and never sets a status of its own (`claiming-a-cat.md` §6). Who may claim a cat at all is `claiming-a-cat.md` §3. |
| **Any spotter** | Nothing directly. A spotter's *sighting* is itself evidence the cat is alive, which is the strongest and most common life-status signal we get. A spotter who notices something worrying uses the note field or the trouble report. |

**Deceased is reversible, and the app makes that happen by itself.** Cats presumed dead walk back into frame. On a small island, a cat reported dead by one person and then photographed alive is a normal Tuesday.

The rule, stated so the resolver can actually perform it: **a resolved sighting dated after a `deceased` observation clears that observation in the same read.** No job, no queue, no team member in the loop. The photograph is the evidence; the cat page shows *"Lives on the street"* again the moment the sighting resolves. Both statements stay in the record and the disagreement is flagged for the team as context — but the *display* corrects itself immediately. Previously this spec promised the behaviour in prose and had no rule that produced it; a spotter's sighting is not a `life_status` observation, so "the newest life_status wins" left the cat dead. That gap is closed in §10.2.

### 3.3 What the cat page says when a cat has died

A cat with a live `deceased` status shows one quiet line: *"No longer with us."* Nothing more — no date headline, no cause, no photograph treatment. The cat keeps its page and its history (photos are kept, and shrunk after a year, under the photo retention rule in `hosting-and-photo-storage.md` §6.7, the same for every cat, living or not), and it keeps counting toward the collection of everyone who ever spotted it. Nobody loses a cat they found.

Three consequences that need deciding rather than discovering:

- **Notifications stop.** Anyone following that cat stops receiving "spotted again" pushes; the follow itself is kept, so a sighting that clears the deceased status resumes them. This is why the fan-out has to check life status: without it, everyone who ever spotted her keeps getting *"Agatha was spotted again!"* about a cat the team has recorded as dead, which is the cruellest bug in the app.
- **No email, ever, about a death.** Per F4 in `DECISIONS.md`: presumed-deceased is reversible by one sighting, so an email you may have to retract is worse than no email. `email-capture.md` owns the sending; this document simply never emits a death as a notifiable change (§9.3).
- **The collection denominator.** A deceased cat stays in "12 of 142" and stays collectable. Removing it would silently revise every spotter's progress downward, which is a worse harm than a slightly stale denominator.

### 3.4 Presumed deceased at three years

**Derived, never stored.**

| Option | Benefits | Risks |
|---|---|---|
| **Nightly job sets a flag** | Cheap to query. Explicit. | The flag needs unsetting. Every unsetting path is a bug waiting to happen — the classic failure is a cat photographed on Saturday still showing as presumed dead on Monday. Also invites a notification ("Loukoumi is presumed deceased") that we never want to send. |
| **Computed from the last evidence of life (recommended)** | Reverts the instant a new photo arrives, with no job and no code path to forget. Impossible for the flag to be stale, because there is no flag. | Every list query needs the last-evidence date — which it already computes for "last seen". |

**Recommendation: computed.**

**Computed from what, exactly.** The previous rule keyed off sightings alone, and that broke in four places the review found. The rule is now: presumed deceased when **the newest evidence that this cat was alive is more than 36 months old**, where evidence of life is the newest of:

- a resolved sighting,
- any observation whose kind implies the cat was alive at `observedAt` — a `life_status` of street, homed or in care; a `sterilised` record (a cat on a clinic table is alive); an `ear_tip` observation; a `welfare_report` (somebody stood in front of this cat and was worried about it),
- a linked import record's operation date,
- failing all of those, the date the cat record was created.

That last clause is what stops a cat registered by a resident this afternoon — no photo, no sightings — being presumed deceased this afternoon, or the comparison blowing up against a null. A `deceased` observation is not evidence of life and overrides the derivation entirely; the cat shows §3.3's line instead. Likewise `coat`, `markings`, `vaccinated` and `team_note` observations are not evidence of life (§10.1, amended 12 October 2026, SYC-2): a colour, a mark, a vaccination date or a team note does not show the cat was seen, and none of them moves the 36-month clock.

**What it does and does not do.** A presumed-deceased cat leaves the active counts — colony coverage, "cats needing sterilisation", the targeting view. It stays fully in the record, keeps its page, keeps its history, and keeps counting toward the spotter's collection and the discoverer's credit.

**What the app says.** Never "presumed deceased" as a headline, and never a notification. The cat page reads *"Not seen since June 2024"* in the same quiet place it would read *"Last seen yesterday"*. The team dashboard is the only surface that uses the words "presumed deceased", because the team is using it as a filter, not reading it as news.

### 3.5 What a spotter and the team actually experience

A spotter sees a small, plain line on the cat page: *"Lives on the street"*, *"Has a home"*, *"In Syros Cats' care"*, *"No longer with us"*, or *"Not seen since June 2024"*. No status pickers, no forms, nothing to fill in. The spot flow is untouched.

A team member on the dashboard sees the current derived status, a control for **stating what it is now** with a short reason box, and a list underneath of every previous statement about this cat, who made it and when. The control looks like a field and is not one: it appends an observation. The dashboard itself is specified in `team-access-and-welfare-queue.md` §3.3; what it writes is §10.7's `POST /observations`.

---

## 4. Sterilised status

### 4.1 The rule, stated once and never bent

> **A visible clipped tip is strong evidence a cat has been sterilised. No visible clipped tip is almost no evidence of anything.**

Cats get sterilised without a clip — an older operation, a different vet's practice, a clip that healed subtly, or simply a photo taken from the wrong side. The clip is **usually on the left ear**, which means a right-side photo tells you nothing at all.

**Absence of a visible clip is never negative evidence.** No number of "no clip visible" answers can move a cat toward "not sterilised". Only a Syros Cats team member, a vet, or an imported Syros Cats record can assert that a cat has not been sterilised.

This rule gets its own section, its own named test and a line in the opening summary because **it fails in both directions and both directions cost real animals**:

- **Getting it backwards** — treating "no clip visible" as "not sterilised" — puts every unclipped-but-sterilised cat onto the trapping list. The failure mode is real people driving to real places and setting a trap for a cat that was done four years ago. Sterilisation costs Syros Cats €50–60 per cat; a wasted trapping trip costs volunteer hours they cannot buy back.
- **Being too eager the other way** — letting one misread photo sit at *Likely* forever — quietly deprioritises a cat that has *not* been done, and the result is a litter. This is the direction the one-photo rule in §4.3 creates, and it is why §4.5 exists.

### 4.2 The three levels, and what the public sees

| Level | Reached when | Shown as, to everyone |
|---|---|---|
| **Confirmed sterilised** | An imported Syros Cats record, a team entry, a vet, a cat guardian (for a cat in her own colonies) or a cat owner (per SYC-130) says the cat was sterilised, and nothing from a higher level, or later at the same level, says otherwise (Decision G) | *"Sterilised — confirmed by Syros Cats"* |
| **Likely sterilised** | One or more photo-backed sightings report a clipped tip, and nothing authoritative contradicts it | *"Probably sterilised — a clipped ear tip has been seen"* |
| **Confirmed not sterilised** | A team member, a vet, a cat guardian (for a cat in her own colonies), an owner (once SYC-130 allows owners to write), or an imported record says this cat has not been sterilised, and nothing from a higher level, or later at the same level, says otherwise (Decision G) | *"Not sterilised — Syros Cats' records"* |
| **Unknown** | Nothing has been said, or only "can't tell" / "no clip visible" answers exist | *"Not known yet"* |

**Per D4, a confirmed negative is shown publicly.** The earlier draft of this spec recommended hiding it — showing *"Not known yet"* to the public while the team saw the truth. Samuel decided against that: the app should be honest, and a person looking at a cat should be able to see that this one still needs help.

| Option | Benefits | Risks |
|---|---|---|
| **Show the confirmed negative publicly (chosen)** | The app tells the truth. A donation ask against a specific unsterilised cat is the most honest version of the ask there is. A guardian or resident reading the page can act on it. No second, hidden version of the record for staff — one truth, one display. | It paints a target. The public map now says *this specific cat, roughly here, has not been sterilised*, which is a sharper signal than a location alone for anyone hostile to street cats. It also invites a specific kind of wrongness: a mis-matched import row that says "not sterilised" is now a public accusation about the wrong cat. |
| **Show it as "not known yet"** | Removes the targeting signal entirely. | Two versions of the truth in one system, which is the thing §2 exists to prevent, and a dishonest one facing the public. |

**Recommendation, and the decision: show it.** Two things follow and are not optional. First, **this sharpens the targeting risk in §6 and must be disclosed to Syros Cats alongside the colony-averaging limitation in §6.2** — they are accepting both together, and the combination is stronger than either alone. Second, the correction path in §4.5 becomes load-bearing rather than nice to have, because a wrong public negative is now visible to everybody.

A fourth level, **Reported**, exists in the data model and the resolver's output type from day one but is not yet reachable — it is where SYC-52 will place a single unconfirmed public claim once prompted-versus-volunteered weighting arrives. Building the ladder with all its rungs now means the later change is a resolver change, not a schema change. See §10.

**Confidence never crosses attributes.** A *Confirmed* ear tip is a confirmed statement about an ear, not about an operation. It contributes to sterilised reaching *Likely* and can never make it *Confirmed*. This is the §4.1 rule expressed as something the resolver enforces rather than a convention it hopes for.

**Who can say a cat is sterilised (amended 12 October 2026, `roles-and-invites.md` Decision 5).** A *statement that a cat is sterilised* from the team, a vet, a cat guardian (for a cat in her own colonies) or a cat owner (what counts as an owner follows SYC-130, `claiming-a-cat.md`) makes the cat *Confirmed* at once. It is recorded with who said it and in what role, and the team can mark it wrong with its own later statement; the earlier statement stays in the history. A vet's waits for SYC-24, which builds vet accounts, and an owner's waits for the claim work in SYC-130. The sentence above still holds: an ear tip on its own never makes a cat *Confirmed*.

**A field check is a different thing.** A cat guardian's in-person look at an ear (*it looks clipped*) counts at once, with no team OK, and shows as *"Probably sterilised – checked in person"* under *Likely*. It never makes a cat *Confirmed*, and the team can mark it wrong. Saying "she is sterilised" is a statement about the operation; "I looked at her ear" is a statement about the ear.

**The "sterilised" news (Samuel, 12 October 2026).** When a statement makes a cat *Confirmed* sterilised for the first time, the people who follow that cat are told **in the app and by a push notification**, and **once per cat, ever**: if a *Confirmed* answer is later marked wrong and then confirmed again, nobody is told a second time in the app or by push, because the news cannot be unsent and a second message would read as spam. Whoever's statement made the cat *Confirmed* (team, management, vet, guardian or owner), the news is the same. A field check, an ear tip, and a guardian's "not sterilised" announce nothing. The roles work sends no email itself; people who opted in to news by email also get the separate "your cat was sterilised" email from the nightly job in `email-capture.md` §5.3 (SYC-55), unchanged (Samuel, 13 October 2026).

### 4.3 How many clipped-tip sightings make it Likely?

| Option | Benefits | Risks |
|---|---|---|
| **One is enough (recommended)** | Matches reality: a clipped tip in a photograph is a physical fact, not an opinion. Fills the record from the first season. Simple to explain: "somebody saw the clip." | One misread photo shows as *Likely*, and an unsterilised cat sitting at *Likely* is deprioritised for trapping and produces a litter. Only tolerable with a working correction path — see §4.5. |
| **Two independent spotters required** | Higher bar; fewer wrong *Likely* labels | Most cats are spotted by one person. This would leave the majority of genuinely-clipped cats sitting at *Unknown* through an entire season, which is a worse error than the one it prevents — and it is exactly the error that sends volunteers out to trap already-done cats. |

**Recommendation: one photo-backed clipped-tip observation reaches *Likely*** — with §4.5's correction path shipping in the same change, not later. The cat page shows how many people have said it and links to the photos, so the strength of the evidence is visible without needing an extra level.

### 4.4 The question a spotter is asked

On the reward screen, after the points, one tap:

> **+15 points** · Agatha spotted again
>
> *One quick thing — is Agatha's ear tip clipped?* (usually the left ear — see the example photo)
> `Yes, clipped` &nbsp; `No, looks whole` &nbsp; `Can't tell`
>
> *Skip*

- **The example photo is required, not decorative.** It shows a clean clipped tip beside a torn or notched ear, with one line: *a clip is a straight cut across the tip; a notch or a tear is a battle scar, not a sterilisation mark.* Notch-versus-clip is the single most predictable error an untrained tourist will make in this app, and the picture is the cheapest defence against it. It comes from `docs/PRODUCT-SPEC.md` §2.2 and must be a real asset before this question ships — the earlier draft linked to a dead anchor.
- **"Can't tell" is a first-class answer**, recorded as such, and it stops the app asking that spotter about that cat again. It is not a failure and it is not treated as "no".
- **"No, looks whole"** from a spotter is recorded faithfully and has exactly one effect: it is visible to the team as context. It does not move the status. It never will.
- **Skipping** leaves the attribute *Unknown*, which is the truthful state.
- Which ear was seen is recorded when the answer is "yes" (left / right / not sure), because the left-ear convention makes a right-ear clip worth a second look — not disqualifying, just interesting.

### 4.5 Fixing a wrong *Likely* — the correction path

A tourist taps "Yes, clipped" at a torn ear. The cat is now *Probably sterilised*. Until this revision, nothing in the system could undo that: a team member's `ear_tip { clipped: false }` was defined as never affecting the level, a staff `sterilised: false` was a different attribute with undefined precedence, the confirmation queue was deferred, and there was no API for writing a superseding observation at all. The most predictable error in the app was permanent.

Three things fix it, and all three ship together:

1. **A supersede write.** A team member viewing the evidence photo can mark that specific observation superseded, with a reason, from the cat page in the dashboard. It writes a new observation pointing at the old one; nothing is deleted and the mistake stays visible in the trail. `POST /observations/{id}/supersede` in §10.6.
2. **`clipped: false` means something when a team member says it.** The §4.1 asymmetry is about *spotters*, and it is unchanged: no volume of public "no clip visible" answers moves anything. But a Syros Cats team member or vet looking at the same photograph and judging *that is a torn ear* is an authoritative statement about the ear, and it supersedes the spotter's `clipped: true` on that cat. It moves sterilised from *Likely* back to *Unknown* — never to a negative, because an unclipped ear is still not evidence of an unsterilised cat.
3. **A *Likely* review list.** Not the full confirmation queue (specified in `roles-and-invites.md` §7) — just a dashboard list of cats sitting at *Likely* with their evidence photos, newest first, and the two buttons *looks right* / *that's not a clip*. A few minutes a week clears a season's errors.

### 4.6 Precedence — which statement wins

This is the rule the old spec got wrong, and it is worth stating plainly because it is what makes every correction in this document actually execute.

**Among authoritative statements about sterilisation, the highest level wins, and within a level the newest one by the date it describes wins, whichever way it points** (amended 13 October 2026, Decision G in `roles-and-invites.md` §7.2: the order is **vet > owner > cat guardian > team**, with management and imported records ranking as the team). A 2019 import saying "sterilised" loses to a 2026 staff entry saying "not sterilised": both are team level, so the newest wins. A 2026 import saying "not sterilised" **loses** to a 2024 vet record saying "sterilised", because a vet outranks the team and imports whatever the dates. A cat guardian's word on a cat in her own colony outranks the team's and an import's, however late the team spoke, but never an owner's or a vet's. Within a level there is no thumb on the scale for positives.

The team can always mark a guardian's statement wrong (the existing supersede, §4.5), and a guardian can correct her own; a marked-wrong statement no longer counts. An owner's statement is not written until SYC-130 says how a claim is checked.

Only when there is no authoritative statement at all does the clipped-tip evidence get consulted, and it can only ever produce *Likely*.

The reason this matters: `records-import.md` §2.5 promises that a later team entry corrects a mis-matched import row. That is the highest-consequence correction in the system — it is how a cat wrongly labelled from someone else's record gets its own record back — and under the old "any positive ever, wins" rule it could not happen.

---

## 5. Importing Syros Cats' existing records

**Moved to its own spec, `records-import.md` (Samuel, 28 September 2026).** Importing Syros Cats' existing records is an **optional, post-MVP** feature, built only if Syros Cats confirm it is operationally sensible and helpful. What exists today is a set of month-by-month WhatsApp groups with scant details about each cat.

Nothing in this spec depends on it. Without an import, *Confirmed* sterilisations come from the team (and vets, once they have access) recording them as cats are seen.

**What this spec keeps so an import can arrive later without rewriting history:** the `import` provenance on observations and the precedence rule in §4.6; a cat's names are recorded append-only (§10.3), so an owner renaming a cat does not destroy the name a future import would match on; colony name history (§10.5); and the notification baseline for bulk writes (§9.2).

## 6. Location privacy

### 6.1 What we are protecting against

Two different things, and they need two different answers.

1. **Casual harm.** Someone browsing the public app finding the exact bush a cat sleeps under. Anyone who wishes a cat harm, and anyone who wants to dump unwanted kittens somewhere cats are known to be fed.
2. **Patient harm.** Someone with a script, sampling the public API repeatedly and working out exact positions from data that was supposed to be approximate.

The second is the one that quietly defeats most blurring schemes, so it drives the method.

**D4 raises the stakes on both.** The public map now says *this specific cat, roughly here, has not been sterilised*. That is a sharper signal than a location alone, and it is the reason §6.2's accepted limitation has to be put to Syros Cats explicitly rather than filed away.

### 6.2 The blurring method

| Option | How it works | Benefits | Risks |
|---|---|---|---|
| **A. Random jitter per request** | Add a random offset each time the location is served | Trivial to implement; looks blurred | **Defeated completely by averaging.** Sample the same cat two hundred times and the mean of the offsets converges on the true position. This is the standard mistake. |
| **B. Fixed random offset per cat** | One offset generated per cat, stored, reused forever | Immune to averaging | The offset is a stored secret that must never leak, and a single leak exposes that cat exactly. Also produces a map where cats appear in the sea or on cliff faces, which looks broken. |
| **C. Snap to a fixed grid (chosen)** | The island is divided into fixed cells. The public location of a cat is the centre of the cell its true location falls in. | Deterministic — a thousand requests return one identical answer, so repeated sampling of *one cat* yields exactly nothing. No secret to leak. Cheap: a rounding operation, no state. | Averaging across *many* cats still recovers a colony centre — see below. A cell centre can land in the sea; we display a shape, not a pin, so this reads correctly. |
| **D. Snap every cat in a colony to one shared colony centre** | All cats in a colony publish the identical point | Averaging returns exactly the published value and yields nothing at all | Costs the map its texture — thirty cats on one dot in the middle of town. Requires colony membership for every cat, which most cats do not have yet. |
| **E. No public locations at all** | Cat pages show a colony name and no map position | Perfect privacy | Kills the map, which is a large part of why the app is enjoyable, and removes the "cats near you" experience the whole spot flow leads with. |

**Decision (F2): Option C, 250 m cells, kept as specified.**

Practically: latitude and longitude are quantised to a grid of roughly 250 m (about 0.00225° of latitude, with the longitude step scaled by the cosine of Syros's latitude so cells stay square). The published position is the centre of the cell.

**Why 250 m and not 100 m or 1 km.** At 100 m a cell often contains one doorway, which is not protection. At 1 km, half of Syros is one circle and the map stops saying anything. 250 m is roughly a block of Ermoupoli: enough to find the cat if you walk around and look, which is the intended experience, and not enough to point at a specific house. This number is written as a single configuration value so it can be changed after the team sees the first real map.

#### The accepted limitation, stated at its real size

Grid snapping protects an individual cat perfectly against repeated sampling. **It does not protect a colony.** Each cat's published point is its true point pushed to a cell centre; those errors are effectively independent from cat to cat and spread roughly evenly across a cell. Average the published points of the cats in one colony and the errors cancel. The maths is ordinary: the error on the average shrinks with the square root of the number of cats, so **thirty cats in one colony give the colony's centre to about 45 metres**. Forty-five metres is a specific corner of a specific street.

Colonies exist because cats gather where they are fed. So the number recovered is, in practice, the feeding site — which is precisely the information §6.6 keeps out of public payloads entirely, and precisely the targeting concern Syros Cats raised at the 1 September meeting.

**This is a knowingly accepted limitation, not an oversight and not a bug to be fixed later.** Option D would close it and was considered and rejected: it needs colony membership the data does not have, and it flattens the map that makes the app worth opening. We are choosing a working map over a guarantee we cannot fully make.

What acceptance requires, and none of it is optional:

- **Accepted by Samuel, 28 September 2026.** Still to be put to Syros Cats (SYC-67), whose acceptance F2 requires.
- **Syros Cats hear it in plain language, before launch, together with D4.** The sentence is: *someone patient enough to average the map can work out roughly where a colony is fed, to about the width of a street. We can stop them finding one cat; we cannot stop them finding the colony.* They accept it or they ask us to change it — it is their island and their neighbours.
- **The acceptance is recorded**, with a date, alongside D4's public unsterilised status. (Agenda item and ticket, per `DECISIONS.md` Part 4.)
- **§6.6's private-feeding-site toggle is never oversold.** It is honest about the site row itself and it does not hide the cats clustered on it. Anyone describing that toggle to the charity says so.

#### The drawn circle was overstating the protection

The map drew a 300 m radius circle around a 250 m cell. That circle covers about 283,000 m²; the cell it represents is 62,500 m². **The picture claimed roughly four and a half times more privacy than exists**, and the grid is not secret — anyone who reads the code, or simply notices that published points fall on a lattice, knows exactly which 250 m box the cat is in.

It was also misleading in the other direction for honest users: a cat sitting at a cell corner is up to about 177 m from the drawn centre, so a tourist walking to the middle of the circle can be walking away from the cat.

**Fix: draw the cell.** The map shows the 250 m square (with softened corners so it reads as a region, not a building footprint), labelled *"Somewhere in here"*. It is truthful, it is the same shape the guarantee is made about, and it removes the need to explain a discrepancy to anybody. `BLUR_DISPLAY_RADIUS_METRES` is retired; the API publishes the cell size and the client draws it.

#### One improvement worth taking

> **Withdrawn (Samuel, 6 Oct 2026, on the adversarial review of PR #95).** A secret origin can't hide the grid while each published point is a cell centre: one published point gives the offset away (`offset = (published − half a cell) mod cell`). The grid is public, and the honest guarantee is the 250 m square. Original text kept below for the record.

The grid origin is derived from a **server-held secret** — one fixed sub-cell offset applied to the whole island, `HMAC(secret) → offset`. This stays entirely deterministic: a thousand requests still return one identical answer, there is no per-cat secret, and no averaging attack is opened. What it buys is that the cell boundaries are not reconstructable by reading the source, so an attacker knows the cat is within 250 m of the published point rather than knowing precisely which box. If the offset ever leaked, the guarantee degrades to exactly what it is today — which is why it is worth doing and not worth worrying about.

### 6.3 The nearest-cat oracle on `POST /sightings` — fixed, not accepted

**This is the one thing in §6 that is not a judgement call.** The previous version of this section opened *"It does not interact, and that is deliberate"* and treated photo matching as an internal consumer of exact coordinates. It is not internal, and the endpoint is not a non-issue.

What the code does today, verified: `POST /sightings` is unauthenticated, takes a `lat`/`lng` chosen entirely by the caller, loads every cat, sorts them by true distance from that point, takes the ten nearest, and returns matching candidates — cat id, name, photo URL and confidence — straight back in the response.

That is a question-answering service about the unpublished coordinates. The attack needs nothing that is not already public: photos are served unauthenticated from sequential ids, so fetch the target cat's own photo, resubmit it at a probe coordinate, and see whether the cat comes back. Each probe is a geometric constraint. Bisect, repeat from a few bearings, and a 250 m cell falls in tens of probes. The rate limit does not stop it — 20 requests per 15 minutes **per IP address** is roughly 1,900 probes a day from one address and trivially multiplied across addresses.

Grid snapping is not defeated by averaging the published value. It is defeated by a second endpoint that answers questions about the value we did not publish.

**Three changes, all required:**

1. **Superseded, 30 Sep 2026: matching uses exact positions within 500 m (`DECISIONS.md` Part 2h, SYC-39); the residual probing risk is accepted. Points 2 and 3 are still required; both arrive in PR 5 (§11).** *Original text, kept for the record:* **Candidate selection runs on the blurred grid.** The ten candidates are chosen by distance from the *snapped* probe point to the *snapped* cat positions. Every cat in the same cell is equivalent, so probing tells the caller which cell they are pointing at — which they already knew, because they chose the coordinate. The ordering that leaked true distance is gone.
   - *(Original text, superseded by `DECISIONS.md` Part 2h.)* **The accuracy objection is answerable.** Quantisation could push a genuinely-near cat out of the ten, so the candidate radius widens to **750 m** to absorb it, and the candidate list is re-ranked by the vision model anyway, which is what actually decides the match. Matching quality is preserved; the ordering channel is not.
2. **Rate-limited per device, not per IP.** `POST /sightings` requires the device secret the resolve endpoint already requires, and the limit counts against the device. An attacker can still register devices, but each one is a deliberate act with its own budget rather than a free IP rotation.
3. **A candidate set never reveals its own geography.** Candidates below a real confidence threshold are not returned with `catId` and `name` at all, and the response never orders or annotates candidates by true distance.

**Test:** probe the endpoint from a grid of coordinates with a known cat's photo and assert the returned set does not vary with sub-cell movements of the probe, and does not reveal ordering by true distance.

Two consequences to hold on to:

- Exact coordinates remain stored and remain used for the team's own work — targeting, colony clustering, welfare response. Blurring is a publication rule. What changed is that *answering a stranger's question about the exact value* counts as publication.
- On-device matching, when it arrives, runs against the *photo fingerprints* of nearby cats without needing exact coordinates on the phone. Exact coordinates never reach the mobile app at all (§6.5). Flagged here so it is not discovered late.

### 6.4 The other channels that give the position back

Grid snapping handles the obvious attack. These close the rest.

1. **Per-sighting coordinates are never public.** This is the big one. Blurring a cat's single location while publishing forty exact sighting coordinates for that cat protects nothing — the sightings cluster on the truth. Public sighting history shows photo, spotter and date, and no position. The team sees positions. *(Today `GET /cats/{id}` returns `lat`/`lng` on every sighting. This is the change that removes them.)*
2. **Distance is computed from the published position, not the true one.** Publishing an exact "1.37 km away" alongside a blurred point lets anyone with three positions trilaterate the true point in seconds. Public `distanceKm` is computed from the cell centre and rounded to 100 m.
3. **Sorting is stable and coarse.** "Cats near me" sorts by the same blurred distance everyone else sees. Two cats in one cell tie, and ties break on cat id, not on true distance.
4. **Timestamps are coarse in public — and two channels currently hand the time back.** Public "last seen" is a date, not a timestamp, because an exact time plus a small area is a pattern of life for the cat and for the person who feeds it at the same hour every day. But:
   - **Photo ids are a global clock.** Photo ids are sequential and photos are served unauthenticated from an enumerable URL that appears in every public sighting. Every public sighting therefore carries a total ordering against every other one, and calibrating a few known ids reconstructs approximate times for all of them. **Sighting photos must be served under an opaque, non-enumerable id** — this is the same hardening F7a requires for other reasons, and it is specified in `hosting-and-photo-storage.md`; this document states the dependency.
   - **Push notifications are live.** Resolving a sighting subscribes you to that cat, and every later sighting fans out *"Agatha was spotted again!"* within seconds. Anyone who spots a cat once gets a minute-accurate feed of every subsequent sighting of it, forever. **Sighting notifications for cats the recipient does not own are batched or coarsened**, and the coarsening applies to the notification body too — "spotted again today", not a timestamp.

   Until both are closed, the coarse-timestamp claim is a partial protection and this spec says so rather than implying otherwise.
5. **Photos carry location in two ways, and only one of them is fixable.**
   - **EXIF GPS.** Every upload is currently re-encoded through sharp, which drops metadata unless it is explicitly asked to keep it. That is a default, not a decision — and a perfectly reasonable future change to preserve colour profiles or orientation would silently republish exact capture coordinates on a public, permanently-cached endpoint, defeating everything else in this section. **It becomes a stated requirement with a test**: upload a JPEG carrying GPS EXIF, fetch it back, assert there is no GPS block. The image-validation suite has eleven tests today and none of them makes that assertion.
   - **The second entrance.** The strip only helps if every photo goes through it. **The records import must have no direct-insert path into the photos table** — imported images are validated and re-encoded exactly like a spotter's, per `records-import.md` §2.3. A photo attached to a charity record is a phone picture taken at a clinic or a feeding spot, which is the most sensitive coordinate in the system.
   - **The picture itself.** A doorway, a house number, a shop sign, a recognisable balcony. No blurring scheme touches this and none ever will. Syros Cats should hear it from this document rather than discover it: the photographs are the least blurred thing we publish.

### 6.5 Who sees exact locations, and where the blurring lives

| Who | Sees |
|---|---|
| **The public — which is every user of the mobile app** | Cell centre, the 250 m cell drawn, coarse distance, no sighting positions |
| A spotter, on their own sightings | The positions they themselves recorded — their own walk, on their own device |
| A **cat guardian**, on the dashboard | Exact positions of cats, and of private feeding sites, in her own colonies, through dashboard pages only |
| Syros Cats team, on the dashboard | Everything, exactly |

**The mobile app is always a public reader.** There is no sign-in in the app and there is not going to be one: identity is an anonymous per-device id plus a device secret. The team dashboard is a separate web workspace with its own sign-in, specified in `team-access-and-welfare-queue.md`. Staff never sign in to the mobile app, so exact coordinates never reach it.

**The saved list on a guardian's or team member's phone is a dashboard page with its own storage** (`roles-and-invites.md` §12), not the app's cache. It holds the exact positions of the colonies it carries, cats and feeding sites both (so a guardian's own colonies' feeding sites are included), and lasts 72 hours from her last online load, counted by server time. It is deleted the next time it is opened after that, and the dashboard sends `Clear-Site-Data` on sign-out and when her access is removed. The paragraph above is unchanged: the mobile app is always a public reader, and it still holds only public sites.

This replaces the previous rule, which said "a device that signs out of a team account purges its cached catalogue". There is no team account in the app and no sign-out to hang that on; the mitigation was written for the wrong piece of software.

**What actually keeps it true.** The catalogue cache on the phone is a single unversioned key with no expiry and no eviction, written on every successful fetch. Two rules:

- **The cache key carries the viewer tier and a version** — `cats-cache/public/v2`. A tier can then never read another tier's cache, and a payload-shape change forces a re-fetch rather than waiting for expiry.
- **Any future team mode in the mobile app must use a distinct key.** If exact coordinates ever landed in the public key they would sit there indefinitely with nothing to purge them.

**Offline support in this app is partial**, and the cache is why this rule matters: photos, capture locations and map tiles work without signal and the spot queue syncs later, but a stale catalogue can outlive a deploy by weeks. Blurring is applied server-side when the payload is built — never in the rendering layer, or the exact figures sit on every tourist's phone in plain view, one screen away.

### 6.6 The cat's published position should be where the cat is

There is currently no derived cat location. A cat's stored position is written once — from the first sighting that created it, or from a resident's input — and **no code path ever updates it**. It is a frozen snapshot of one GPS reading.

Three consequences, in increasing order of importance:

- The old boundary-flicker mitigation ("we snap the cat's *derived* location, which moves rarely") described a mechanism that does not exist. A point that never moves cannot flicker, which is fine, but the spec should not claim machinery it does not have.
- **The published cell is a quantisation of where the discovering spotter was standing.** That is a disclosure about a person, not a cat.
- A cat first photographed by a tourist at the ferry terminal is pinned at the ferry terminal forever. "Cats near me" — the experience Option E was rejected to preserve — degrades as the catalogue ages, and no amount of blurring fixes a wrong point.

**Decision: deferred (Samuel, 28 September 2026).** The published position is the **discovery position**: where the cat was first spotted, blurred for publication. The map and the cat page must not imply it is where the cat lives now, so the label reads along the lines of *"first spotted around here"*, never *"lives here"*. The consequences above are accepted for now. The derived position (the centre of a cat's recent resolved sightings, recomputed on write and snapped for publication) is SYC-80.

### 6.7 Feeding sites

Feeding sites are mapped in full, and are **private by default**. Syros Cats chooses individual sites to make public.

- **Private sites do not appear in public payloads at all** — not blurred, not as a count, not as a heat overlay. A blurred dot still says "there is a feeding site roughly here", which is most of the information someone dumping kittens needs. Absence is the only honest privacy setting for these.
- **Public sites show their exact position.** Making a site public is a deliberate act with a purpose — directing people to somewhere they can help — and a blurred circle around a food bowl serves nobody. The team is choosing exposure knowingly, site by site.
- The toggle is per site, on the team dashboard, defaulted to private, and shows a one-line reminder of why: cat feeders face neighbour hostility, and known feeding sites attract abandonment.
- **Cat locations are still blurred near a public feeding site.** The two settings are independent; making a site public never publishes the exact position of a cat.
- **A public site's label never contains the guardian's name.** The internal name follows the "place — guardian" convention and is never published; the public label is a separate field written for the public.
- **A private site is indistinguishable from an unknown code.** A lookup by public code answers the same `404`, with the same body, for a site that is private, retired, never existed, has a wrong code, or has a superseded code. Nothing in a response, or in how long it takes, tells them apart.
- **A guardian sees only her own colonies' sites**, filtered in the query, never in the page or the serialiser.
- **And the honest caveat from §6.2:** suppressing the feeding-site row does not suppress the cats clustered on it. Anyone patient enough to average a colony's published positions gets the site's neighbourhood to about 45 m regardless of this toggle. The toggle is real and worth having; it is not a guarantee, and it is never described as one.

---

## 7. What each sighting now carries

Two additions, both optional, both on the screen that already exists after the points are awarded. Neither blocks anything. **The fastest way to kill this project is to put a questionnaire between a spotter and their points.**

### 7.1 "Anything you noticed?"

A free-text box, up to 500 characters, in any language, entirely optional.

**These notes are visible to the Syros Cats team and are never published publicly.** Not on the cat page, not in the sighting list, not in the API's public payloads. The author sees their own note on their own device.

Not publishing them is the whole design:

- It keeps moderation load near zero. Nothing a stranger types is shown to another stranger, so there is nothing to moderate in public, and the offensive-language filter that guards cat names is not load-bearing here.
- It changes what people write. A note nobody will read except the charity gets *"limping on back left, hiding under the blue boat"* — which is useful. A public note gets performance.

The team dashboard shows notes on the cat page and in a single reviewable stream, newest first, with the sighting photo attached. A note mentioning injury, illness or kittens is highlighted, because the trouble-report flow is not the only way distress reaches us — most of the time somebody just types it. What happens to that highlight, and how fast anybody sees it, is `team-access-and-welfare-queue.md`'s to specify (and per F1, nothing pages a human).

Notes may contain personal information (a person's name, a doorway). They are stored under the same handling as everything else here: purpose stated, team-scoped, covered by §8's deletion mechanism and by a retention position.

### 7.2 "Do they have food and water?"

Three taps: `Yes` · `No` · `Can't tell`.

This is a genuine field-intelligence question and it is asked because Syros Cats asked for it. It says where the feeding network reaches, which is the input to "where does a new feeding site go", and in winter — when street cats depend on people far more than in August — a "no" is meaningful.

Recorded as an observation about the *place and the moment*, not a permanent fact about the cat, because a bowl that was empty at nine is full at ten. The team sees it aggregated: for each area, the proportion of recent sightings reporting food and water, and a list of cats where the last three answers were "no".

Skipping is normal and costs nothing.

---

## 8. Deleting a person from the record

This section owns the deletion mechanism (F3). `privacy-policy.md` holds the privacy policy wording; `email-capture.md` owns the controller question, the email-only deletion route **and all of the user-facing copy**; what happens *in the data* is here.

**There are exactly two destructive actions in the app, they have exactly these two names, and both specs use them** (`email-capture.md` §3.5):

| Action | What it does in the data |
|---|---|
| **Delete my data** | The full severing specified below — §8.3's table, in one transaction. |
| **Stop emailing me** | Mail only. The address is removed and its suppression hash kept (§8.5). Nothing else in this section runs: the device row, the profile, the points and every link between the person and their sightings are untouched. |

There is **no third action** — in particular no separate "delete everything from this device", which would be a second name for the first button.

### 8.1 The principle, in one sentence

**We delete everything that identifies you. The cat sightings stay, with your name off them.**

That is the sentence for the privacy policy and it is also literally what the code does. Nobody's deletion request should cost a cat its history — the observation that Agatha was alive on 14 June 2026 is a fact about Agatha, and it is the charity's evidence base. What made it personal was the link to a person, and that is the thing that goes.

### 8.2 Deleting yourself, in the app, without asking anyone

**Self-service is the primary route, not a convenience.** Settings has a **"Delete my data"** action that severs the person immediately.

**The device is the identity, so holding the phone is the proof.** There is no account, no password and no email round trip to authenticate against — the device id plus its secret *is* who you are in this app. That has two consequences and both are stated on the confirmation screen: anyone holding the unlocked phone can trigger it, and there is no undo.

A confirmation screen states exactly what goes and exactly what stays, and says that it cannot be undone. **`email-capture.md` §6.3 is the copy of record** — the words there and the rows in §8.3 below must always describe the same operation, and an earlier draft of this section carried a second, differently-worded screen. That draft is struck; there is one screen and one wording.

**A delete link in every email.** Anyone who gave us an address gets a working delete link in every message we send — for the person who no longer has the app but does have the email. The link deletes the same things the in-app action does. (`email-capture.md` owns the email plumbing; the link resolves to this mechanism.)

**The staff route stays as a fallback.** hello@catspotters.com remains published for people who lost the device or would rather ask a human, and the dashboard gets a staff action to service those requests on the legal clock. Self-service should reduce that to a trickle, which is the point: it saves the charity manual work and removes the risk of a deadline expiring in a volunteer's unread mail.

### 8.3 Exactly what is removed

| Removed — gone, not flagged | Kept — unlinked |
|---|---|
| The device row and its secret | Every sighting: photo, date, position, cat |
| The profile: nickname, username, points, streak, badges | Every observation the person wrote: ear tip, food and water, notes |
| The email address and the identifying parts of its consent record | Cat records, including cats they discovered |
| The link from every sighting and observation to that person | Names they gave cats (§8.4) |
| Cat follows, push tokens, queued notifications | The discoverer credit on a cat, shown as *"a spotter"* |
| Their own device-visible history of where they walked | Aggregate counts the charity has already reported |

**"Unlinked" means the identifying columns are cleared and the row is stamped as redacted**, not that the row is deleted. That distinction is the whole design: the sighting keeps its evidential value and loses its owner.

**Sighting notes need one extra step.** A note is free text and may name a person or a doorway, so clearing the author id is not enough. On deletion, the person's own notes are **removed from the observation** (the observation row survives, stamped redacted, with its value emptied) — a note is the one field where the content itself can be the identifying thing.

### 8.4 Cat names are kept

Someone names a cat Agatha. Other spotters spot Agatha, the charity's records get updated to say Agatha, and a guardian on the phone talks about Agatha. **The name became shared community property the moment other people used it**, and stripping it out would rewrite everyone else's experience of the app to service one person's departure. Names are kept, and the confirmation screen says so before anyone taps delete.

### 8.5 The technical shape, and why it is built now

The observation and sighting tables are append-only: rows are inserted and never updated. Deletion is the one operation that has to reach back into history, so it needs a defined way in — otherwise the first deletion request is either impossible or breaks the immutability guarantee everything else depends on.

**A redaction column, added now.** Every append-only table carries `redactedAt` (timestamp, null by default) and `redactionReason`. Deletion clears the identifying columns on the matching rows and stamps them. That is one column added today, versus a migration across two seasons of observations later — which is exactly why F3 says *now*.

The immutability guard is written so that redaction is the only permitted update, and it is written that way from the first migration rather than relaxed later.

**Deletion is one transaction and it is synchronous.** No nightly sweep, no queue. The person taps the button and by the time the screen changes it has happened. Propagation to the mail provider happens in the same operation (`email-capture.md` `records-import.md` §2.3).

**A suppression hash of the email address survives**, one-way and irreversible, so that an address that asked to be forgotten is not re-mailed if somebody types it again. It cannot be turned back into an address.

**Tests that must exist:** after deletion, no query anywhere returns the device id, the email, the nickname or the username; the cat's sighting count is unchanged; the cat's derived sterilised and life status are unchanged; the name the person gave is unchanged; and running the deletion twice is safe.

---

## 9. Telling the email job that something changed

`email-capture.md` owns the nightly job and every decision about what gets sent to whom. This section owns the one thing the job cannot compute for itself: **what this cat's status is now, and what it was when we last told anybody.** F4 requires that contract to be defined here, and defined clearly, because the failure mode is a mailbox full of news about operations that happened in 2019.

### 9.1 What we expose

Two things, and no more:

1. **A resolved status snapshot per cat** — the derived sterilised level and value, the life status, and the date each was derived from. This is exactly what the resolver already computes for the cat page; the job reads it rather than re-implementing the rules, so the email and the app can never disagree about whether a cat is sterilised.
2. **A notified-status record per cat** — the snapshot as it stood the last time a message went out about that cat, with the date. The job compares the two, and a difference is a candidate piece of news.

The comparison is deliberately on the *derived* status, not on the arrival of an observation. A second import row confirming what we already knew is not news. A cat going from *Likely* to *Confirmed* is.

### 9.2 Seeding the baseline so history is never news

Syros Cats' historical records are the single biggest injection of status changes the app will ever see, and every one of them would look like a change to a naive comparison. Importing a 2019 sterilisation must not send anybody *"the cat you named has been sterilised!"*.

**The baseline is seeded as the import lands, inside the same operation**, not afterwards by a separate job that might not run:

- Before any import batch is applied, every cat in the catalogue gets a notified-status record set to its current derived status. Nothing changes for anybody; we are just writing down where we started.
- As the batch is applied, each affected cat's notified-status record is advanced to the newly-derived status **without sending anything**, and stamped with the reason `import baseline`.
- The nightly job therefore wakes up to a system where nothing has changed. Changes from that moment on are genuine news.
- The same seeding runs for **any** bulk write — a backfill, a re-import, a correction sweep. Any operation touching more than a threshold of cats at once (say fifty) seeds rather than notifies, and says so in its log.

The equivalent applies to a brand-new cat: a cat's first status is not a change, so a cat enters with its notified-status record already matching.

### 9.3 What never counts as a change

- **Death, in any form.** Neither an explicit `deceased` status nor presumed-deceased is ever emitted as a notifiable change (F4). Presumed-deceased is reversible by one sighting, and an email you may have to retract is worse than no email.
- **A status going backwards to *Unknown*** — a correction under §4.5 — is a correction, not news. The notified record is updated silently so the *next* genuine change is still detected.
- **Anything about a cat whose record is being corrected in bulk**, per §9.2.
- **A welfare report or its outcome.** Neither kind is a derived-status change, so neither can produce one; stated here as well because "a cat you named has been reported injured" is precisely the message this product must never send automatically.

### 9.4 Timing

Up to a day's delay is acceptable and expected. The job is nightly, the comparison is cheap, and nothing in this design requires a status change to reach anybody quickly. Everything about batching, caps, consent and the actual sending belongs to `email-capture.md`.

---

## 10. Technical specification

Everything above is the product. Everything below is how it is built.

### 10.1 Observations

```ts
// lib/db/src/schema/observations.ts
export const observationsTable = pgTable("observations", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),

  // Open vocabulary. Phase 1 emits: life_status, sterilised, ear_tip,
  // food_and_water, note, name, colony, welfare_report, welfare_outcome.
  // Later phases add kinds without a migration.
  kind: text("kind").notNull(),

  // Structured, kind-specific. e.g.
  //   life_status    { status: "homed" }
  //   sterilised     { sterilised: true, date: "2024-03-03", clinic: "…", costEur: 55 }
  //   ear_tip        { clipped: true, side: "left" }        // side: left|right|unsure
  //   ear_tip        { clipped: true, side: "left", seenInPerson: true, photoPublicId: "k3x9…" }
  //                  // a field check (roles-and-invites.md 7.3): seenInPerson marks a look
  //                  // at the cat; photoPublicId is the random id of a private photo kept
  //                  // apart from the public photos (never carried in photoId)
  //   ear_tip        { clipped: false } | { clipped: "cant_tell" }
  //   food_and_water { present: true } | { present: false } | { present: "cant_tell" }
  //   note           { text: "…" }
  //   name           { name: "Μιμή", normalised: "μιμη", script: "el" }
  value: jsonb("value").notNull(),

  // Who said it. Exactly one of deviceId / accountId is set, until redaction
  // clears both — enforced by a CHECK constraint (see below).
  deviceId: text("device_id"),
  accountId: text("account_id"),
  // The observer's role AT THE TIME OF WRITING. Never looked up at read time.
  roleAtTime: text("role_at_time").notNull().default("public"),
  // public | guardian | vet | staff | management | system
  // (amended 12 Oct 2026, roles-and-invites.md 17.1.3: the reserved `admin` is
  // renamed `management`; `guardian` is a live value; the reserved `volunteer`
  // is retired, because volunteers are on the team as `staff`.)
  // Whether that authority applied to THIS cat at the time of writing.
  authorityScope: text("authority_scope").notNull().default("none"),
  // none | colony:<id> | guardian_of_this_cat | owner_of_this_cat
  // `colony:<id>` is a cat guardian's scope: the colony the cat was in when she
  // spoke. It must match ^colony:[1-9][0-9]*$, is written only by the server
  // (never read from a request), is valid only with roleAtTime `guardian`, and
  // is never treated as authority for any other role (SYC-53, Decision B).
  // `guardian_of_this_cat` stays reserved for the claim feature (SYC-130).

  // volunteered | prompted | machine | import | legacy
  provenance: text("provenance").notNull().default("volunteered"),
  // What the app pre-filled, when provenance is "prompted", and what produced
  // it. Without these, three agreements with one wrong guess are indis-
  // tinguishable from three independent observations — which is the entire
  // point of recording provenance at all.
  suggestedValue: jsonb("suggested_value"),
  suggestionSource: text("suggestion_source"),   // e.g. "match-v3"

  sightingId: integer("sighting_id"),   // when it came from a spot
  photoId: integer("photo_id"),         // the evidence
  importRecordId: integer("import_record_id"), // when it came from records-import.md

  // When the thing was true, not when the row was written.
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Retraction/correction: points at the observation this one replaces.
  supersedesId: integer("supersedes_id"),
  supersedeReason: text("supersede_reason"),

  // §8. The only permitted update to a row in this table.
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
}, (t) => [
  index("observations_cat_kind_idx").on(t.catId, t.kind, t.observedAt),
  index("observations_kind_idx").on(t.kind),
  check("observations_attribution_ck", sql`
    ${t.redactedAt} is not null
    or (${t.deviceId} is null) <> (${t.accountId} is null)
  `),
]);
```

Rows are inserted and never updated or deleted, with one exception: the redaction stamp and the clearing of identifying columns in §8. A database trigger or repository-level guard enforces exactly that, and the API layer exposes no other update or delete path.

#### Welfare reports are observations too

**A welfare report is the strongest single statement anybody ever makes about a cat's condition**, and until this revision it never entered the record at all — it lived only in `welfare_reports`, a queue row, and the cat whose page a funder or a guardian actually reads knew nothing about it. The queue is the team's workflow; the observation is the cat's history. Both exist, and the observation is written from the queue row rather than instead of it.

`team-access-and-welfare-queue.md` owns the report flow, the queue, its four states and every word of the copy. **This document owns the observation vocabulary**, so the two kinds are defined here:

```ts
//   welfare_report   { severity: "attention" | "urgent",
//                      isLitter: boolean,
//                      reportId: 412 }        // → welfare_reports.id
//   welfare_outcome  { state: "done" | "nothing_needed",
//                      reportId: 412 }
```

- **Written when the report is filed** (`welfare_report`) and **when the team closes it** (`welfare_outcome`), by the same transaction that writes and closes the queue row. A report with no cat attached writes no observation — there is nothing to attach it to — and the observation is written later if the report is tied to a cat (§3.1 of that spec).
- **`observedAt` is when the reporter saw the cat**, not when the queue moved. For the outcome it is when the team closed it.
- **`roleAtTime` is `public`** for the report (a member of the public wrote it) and `staff` for the outcome. The reporter's identity is a device id like any other observation's, and it is severed by §8 exactly like any other.
- **The free text is not copied in.** The reporter's note stays on the queue row, under `team-access-and-welfare-queue.md` §8.5's retention rule; the observation carries the structured facts. Copying free text into an append-only table would put a second, differently-retained copy of the same personal data in the record.
- **Neither kind moves a derived status.** A welfare report is not a `life_status` claim and never becomes one: "thin and limping" is not "in care", and only the team saying so makes it so. What both kinds do is appear in the cat's history, feed the team's view of the cat, and — for `welfare_report` — count as **evidence of life** under §3.4, because somebody saw the cat.
- **Neither is ever notifiable** (§9.3). A cat somebody reported as injured is not news we send to a stranger who once named it.

**`observedAt` validation.** Team, vet and import writes may carry any past date — staff entering "sterilised on 3 March 2019" must work. Public writes are clamped by the existing capture-time rule (30 days back), which is the app's only precedent for a client-supplied date and would silently corrupt a historical import if applied to one. Future dates are rejected everywhere.

#### Coat, markings, vaccination and team notes (amended 12 October 2026, SYC-2)

Approved with `coat-markings-and-health.md` (SYC-2). That document owns the colour and marking words, what "health" means and what is public; this section owns the observation kinds. `OBSERVATION_KINDS` gains `markings`, `vaccinated` and `team_note`. `coat` already exists. Values:

```ts
//   coat        { colours: CoatColour[] }                        // 1–2 from the eight; ["not_sure"] alone
//               { colours: CoatColour[], modelVersion: string }  // machine reading (system:vision)
//               { retracted: true }                               // "mark wrong" (set_appearance only)
//   markings    { marks: Mark[] }                                // from coat-markings-and-health.md §3.2; [] = "nothing special"; spotter answers hold at most 4, a team or guardian statement holds the whole list
//               { cantTell: true }                               // recorded, no effect
//               { retracted: true }                              // "mark wrong" (set_appearance only)
//   vaccinated  { vaccines: ("rabies" | "cat_flu_enteritis" | { other: string })[], clinic?: string }  // 1–3 distinct; "other" is a name the team types (no brand); date = observedAt
//   team_note   { text: string }                                 // a team-only note on the CAT; not a welfare-report note
```

- **`modelVersion` is required only on a machine reading.** The `coat` validator in `observations.ts` currently requires it on every `coat` value, which would refuse a person's statement. It becomes: required when `provenance` is `machine`, absent otherwise.
- **One normaliser, used by every writer.** `black` + `white` is stored as `black_and_white`; every writer (the answers route, the team and guardian statement functions) calls the same `normaliseColours()`, and the validator's refusal of the raw pair is only the backstop.
- **Who may write which kind.** `coat` and `markings` accept `public` (suggestions), `staff`, `management`, and `guardian` (with `authorityScope: colony:<id>`, her own colonies; the shape and its rules are in the `observations` comment above). There is no `volunteer` value: volunteers are on the team. `vet` has no standing on appearance and is refused. `vaccinated` is refused from `public` and `guardian`, and from `system` except `provenance: import` once `records-import.md` is built (the import is optional and after the first release). `team_note` is refused from `public` and `system`, accepted from staff and management, and from `guardian` only for her own colonies. The rename of the reserved `roleAtTime` value `admin` to `management`, and the live `guardian` value, are made in §10.1 above (`roles-and-invites.md` §17.1, item 3).
- **A retraction may only target a row of the same kind, and only `coat` or `markings`.** `{ retracted: true }` is refused from `public`, refused unless `supersedesId` is set, and refused unless the row it supersedes is the same kind and that kind is `coat` or `markings`, for every role. A retraction can never remove a `sterilised`, `vaccinated`, `team_note` or any other row.
- A prefilled "Yes" is `provenance: "prompted"`, with `suggestedValue` set to the machine's value and `suggestionSource` naming the reading. A different answer is `volunteered`. A team or guardian Confirm carries `agreesWith: <statement id>` and **no photo**, the PR #99 pattern, so it never counts as independent public evidence.
- A team or guardian statement on `markings` is the whole list; an empty list is meaningful.
- **`coat`, `markings`, `vaccinated` and `team_note` are not evidence of life** (§3.4). The honest reason for `vaccinated` is "not needed yet": a vaccination's `observedAt` is the date it happened, so an old import only says the cat was alive then, which moves nothing. A vet or team member who handles a cat is stronger evidence than an ear-tip answer; if Syros Cats begin recording vaccinations on the day, listing `vaccinated` as evidence of life is a one-line §3.4 amendment, and nothing here blocks it. The loader is an allow-list, so leaving it out takes no code.
- **The `team_note` kind is how the cat gets a note.** Welfare-report notes (`add_team_note`, `POST /api/team/reports/:id/note`) are unchanged and stay on the report. A `team_note` is never in any public payload and is not removed when a welfare report is deleted.

### 10.2 The resolver

```ts
// artifacts/api-server/src/lib/resolve.ts — pure, no db, no io
export type Confidence = "confirmed" | "likely" | "reported" | "unknown";

export interface Resolved<T> {
  value: T | null;
  confidence: Confidence;
  supportingObservationIds: number[];
  conflicts: number[];            // surfaced to the team, never to the public
  asOf: string;
}

export function resolveSterilised(
  observations: Observation[],
  importRecords: ImportRecord[],   // records-import.md §2.5, once built
): Resolved<boolean>;

export function resolveLifeStatus(
  observations: Observation[],
  evidenceOfLife: { at: Date; source: EvidenceSource; lastSightingAt: Date | null } | null,   // §3.4
  now: Date,
): Resolved<"street" | "homed" | "in_care" | "deceased"> & {
  presumedDeceased: boolean;
  notSeenSince: string | null;
};
```

*Amended 3 Oct 2026, Samuel: the `{at, source}` input can't express §3.2's sighting-clears-deceased rule on its own — a welfare report or ear-tip answer dated after the true clearing sighting hid that sighting entirely — so `lastSightingAt` was added, and `at`/`source` are typed `Date`/`EvidenceSource` rather than untyped strings. See DECISIONS.md.*

Phase-1 rules the resolver implements:

**Sterilised — an ordered fold, not a set of independent clauses.**

1. Discard superseded and redacted-value observations.
2. Take the **authoritative** `sterilised` assertions: `roleAtTime` in {vet, staff, management}, or `guardian` with a `colony:<id>` scope, or an owner (`authorityScope` = `owner_of_this_cat`, once SYC-130 allows owner statements), or `provenance: "import"`. **The highest level present decides (vet > owner > cat guardian > team; management and imports rank as the team), and the newest by `observedAt` wins only within that level, whatever sign it carries** (Decision G, §4.6). `true` → *confirmed sterilised*; `false` → *confirmed not sterilised*, which is displayed publicly per D4. The level of each observation comes from one function, `authorityLevel(observation)`, in `resolve.ts`, used by every rule on this page that ranks statements.
3. Only if there is no authoritative assertion at all: any non-superseded `ear_tip` with `clipped: true` and a `photoId` → *likely*, unless an authoritative `ear_tip { clipped: false }` (roleAtTime in {vet, staff, management}, or `guardian` with a `colony:<id>` scope) supersedes or postdates it, in which case → *unknown*. Where authoritative ear-tip statements disagree with each other, the same order applies: highest level, then newest within it. So a guardian's in-person *not a clip* outranks a team *clipped* statement, but never an owner's or a vet's.
4. Otherwise → *unknown*.

A spotter's `clipped: false` or `"cant_tell"` is collected into `supportingObservationIds` for display and **never affects the level** — the §4.1 asymmetry, unchanged. `ear_tip` can never produce *confirmed*, in either direction.

**Life status.**

- The `life_status` observation from the highest level present (Decision G, §4.6) wins, and within that level the newest non-superseded one by `observedAt` — **except** that a resolved sighting dated after a live `deceased` observation clears it in the same read, returning `street` and recording the disagreement in `conflicts` (§3.2). No job, no queue. Checked against `evidenceOfLife.lastSightingAt` specifically, never against the newest evidence of life of any kind — see the amendment above.
- `presumedDeceased` is true when the newest **evidence of life** (§3.4) is more than 36 months old and no `life_status` observation is newer than it. A live `deceased` status suppresses the presumed-deceased derivation entirely.

**The date on a guardian's statement is the server's.** Every route a cat guardian writes through sets `observedAt` itself; a date sent by the phone is ignored there, so a guardian cannot back-date or forward-date a statement to win a same-level tie. (The generic team and import routes keep the rule above: any past date, never a future one.)

**A guardian's statement that contradicts a team record is shown, not hidden.** It goes on the team's "recent guardian changes" list marked as contradicting, and the cat's page in the dashboard shows the team's record as a visible disagreement. It stands, because of the order above, until the team marks it wrong, a vet speaks, or an owner speaks.

**Never crosses attributes.** There is an explicit test that no quantity or authority of `ear_tip` observations can produce `confidence: "confirmed"` on sterilised.

#### Colour and markings (amended 12 October 2026, SYC-2)

Approved with `coat-markings-and-health.md` (SYC-2), which owns the colour and marking words and the plain-terms explanation; this subsection owns the rules for which reading wins. Three pure functions are added to `resolve.ts` and included in the cat snapshot: `resolveCoat`, `resolveMarkings`, `resolveVaccinated`. Colour and markings are worked out as follows.

**Before any rule runs, tidy the statements:**

- Throw out any statement that has been replaced or **retracted** (`coat-markings-and-health.md` §4.4).
- Treat *Not sure*, *Can't tell* and any other answer that says nothing as no statement at all, with one exception for colour: **a spotter's newer *Not sure* withdraws that same device's earlier colour** (Samuel, 14 October 2026). Their device then counts towards nothing until it names a real colour again. For markings, *Can't tell* and "nothing special" still withdraw nothing (markings rule 4).
- **Black plus white means black and white.** A pair that is exactly black and white is stored as `black_and_white`. Colours are then compared one at a time as plain values, never as the order or the way someone tapped them.
- **One voice per device, counted when the answer is worked out.** Whoever is the author of a statement is one *voice*. If several standing statements on one cat come from the same device, only the newest counts. This is checked every time the answer is worked out, so a mistake in any writing route cannot let one device count twice. (It is also enforced at writing time, `coat-markings-and-health.md` §10.3.)
- **A pair of voices only counts as two if they come from different photos and were written on different days** (Syros calendar days). A real user loses nothing by this; the "same photo from two browsers on one afternoon" trick now needs two visits.
- A team member's or guardian's "yes, that's right" is stored as a team (or guardian) statement that agrees with an earlier one, not as a separate kind of evidence (`coat-markings-and-health.md` §4.4). There is no lesser "volunteer confirmation".

**Colour**

1. **A statement from the team or a cat guardian wins.** A cat guardian's standing statement (for a cat in her own colonies) outranks the team's (staff and management), whichever is newer; within the same level, the newest standing statement is the answer (Decision G, `roles-and-invites.md` plan, applied to colour by Samuel on 13 October 2026). The team overrules a guardian deliberately: **Correct** on a cat whose answer is a guardian's statement marks every guardian statement of colour that stands on that cat wrong and records the team's colour in one step, with a required reason, shown on the recent guardian changes list. Vets, imported records and owners have no standing on appearance (owners until the SYC-130 claim work decides otherwise). This is the *Confirmed* level. A later machine reading is recorded but never overrides it, and a spotter whose answer is later cannot change it.
2. **Otherwise, two spotters who agree, colour by colour.** A colour is *Likely* when two voices hold it (a colour a voice named as part of a pair counts for that colour). So *Ginger · Tabby* from one spotter and *Ginger* from another agree on *Ginger*; *Tabby* has only one voice and is not shown. At most two colours are shown.
   - If more than two colours are agreed, the two with the most voices are shown; on a tie, the colours whose newest supporting statement is more recent.
   - If two colours are agreed but **nobody ever named both** (two separate camps, such as two voices for *ginger* and two for *black*), only the camp with the **newer supporting statement** is shown, and the cat goes onto the team's Colour check list.
   Taps that merely confirmed a pre-filled guess count as **prompted**, not independent, and do not count towards the two (the `provenance` comment in §10.1).
3. **Otherwise, the machine's reading** (SYC-161), if it is not *Not sure*. This is *Reported*. Only the machine's **newest** reading counts: if the team has marked it wrong, or it is *Not sure*, the machine has no reading and an older one never comes back (Samuel, 14 October 2026).
4. **Otherwise, one spotter's word fills a gap.** If the machine said *Not sure* or never read the cat, the **newest** single spotter's suggestion is shown until something better arrives. A single spotter **never replaces a real machine reading by themselves.** (This is the change to an approved sentence; see SYC2-D10 in `coat-markings-and-health.md`.)
5. **Otherwise, Not sure.**

A person saying *Not sure* or *Can't tell* is never a statement about colour and never beats anything; a spotter's *Not sure* can only withdraw that same device's own earlier colour. If the answer came from spotters (rule 2 or 4) and the machine has a different real reading, the cat goes onto the team's Colour check list (`coat-markings-and-health.md` §5.3): the one case the review found a determined pair could use is the case the team is shown.

**Markings** (no machine reading in this version, SYC2-D4 in `coat-markings-and-health.md`)

1. **A statement from the team or a cat guardian is the whole list.** A cat guardian's standing statement outranks the team's, and within the same level the newest stands (as for colour, Decision G); it is the cat's markings, including an empty list ("nothing special"). The team overrules a guardian's list with **Correct**, as for colour. *Confirmed.* It cannot be gamed by a spotter changing their answer: once a team or guardian statement stands, a spotter who had already answered cannot change that answer (as `EAR_TIP_CHECKED` does for the ear tip), and a new spotter's colour answer is refused with a gentle "Syros Cats have checked this one."
2. **Cats change, so the list can reopen.** A mark that **two voices** have ticked, whose sightings are **dated after** the standing team or guardian statement (the one that currently decides the list), is shown alongside that list, and the cat goes back onto the Colour check list for the team to confirm or reject. A cat loses an eye or tears an ear after the team wrote its list; this is how that reaches the page. Removals still need the team.
3. **Otherwise each mark stands on its own:** a mark is shown once two voices (different devices, photos and days) have each ticked it. *Likely.* A mark only one person ticked is held, and is visible to the team as a suggestion.
4. **Spotters can only add.** A spotter leaving a mark unticked is not evidence the cat lacks it (the cat may be photographed from the wrong side), so no number of omissions removes a mark. A device's later markings answer **adds to** what that device ticked before and never withdraws it. *Can't tell* is recorded and withdraws nothing, and so does "nothing special" from a device that had ticked marks earlier. Only the team (or a guardian) can remove one. This is the ear-tip rule applied to markings.

**Four guards that apply to both**

- **A new statement only ever replaces the same device's own earlier statement.** One device can never replace another's (the ownership rule in `add-details-later.md` §6), and there is a test for it.
- **Colour and markings are never evidence of life** (§3.4) and never notifiable. A colour reading on an old photo says nothing about whether the cat is alive, and nobody gets a push because a cat's colour changed.
- **The public sees the answer only.** Not how many people said it, who, when, or whether a person or the model said it. The team sees all of that.
- **At most one appearance question per sighting.** The details card asks one thing at a time, and never again once answered or skipped.

How the resolver counts and reports these, in detail:

- **Counting voices.** The resolver counts **at most one voice per `deviceId`**, among standing rows that still have one, whatever the write path did. Two voices also need **different `photoId`s** and **different calendar days** (Syros time). A device's write that would supersede a row only supersedes **that device's own** row. All of this is checked at read time, so no write route (the answers endpoint, a backfill, a future route) can make one device count twice.
- **Redacted rows.** After "Delete my data" a statement's device is cleared (§8, DECISIONS Part 2g). Each redacted row counts as one voice of its own. The limit is stated, not hidden: a deleted person's statement still counts, so someone who deletes their data and returns is a second voice. The photo-and-day rule above still applies where those fields survive redaction. SYC2-D1 in `coat-markings-and-health.md` accepts this.
- **Retraction.** A `{ retracted: true }` row removes the statement it supersedes from the count and asserts nothing. The resolver treats it as a gap, not a value.
- **Authoritative statements are compared by the date they describe** (`observedAt`), by level first and newest within a level, as the sterilised fold now does (§4.6, Decision G). A later machine reading never beats an earlier authoritative statement.
- **Confidence output** uses the existing ladder: authority `confirmed`; two voices `likely`; machine or a single gap-filling spotter `reported`. `reported` is the fourth rung the resolver already reserves; if SYC-52 has not made it reachable when this is built, this spec asks SYC-52 to make it so for these two attributes.
- **Never crosses attributes.** A confirmed colour says nothing about sterilisation, life status or vaccination, and a `vaccinated` observation does not feed sterilised (no clinical inference in either direction).
- **Not notifiable.** None of the four kinds is a derived-status change (§9.3).
- **`vet` and `import` rows are excluded for colour and markings at read time.** The sterilisation rule's authority (§10.2 rule 2) accepts both; for colour and markings the resolver excludes `vet` rows and `provenance: import` rows at read time. They never count as authority or as a voice, whatever a writer let through.

### 10.3 Names, aliases and merges

```ts
// Cat names are observations (kind: "name"), so §10.1 already stores them.
// Identity, however, needs its own table — merging cat B into cat A cannot
// repoint observations.catId without violating the append-only rule.
export const catIdentityTable = pgTable("cat_identity", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),
  canonicalCatId: integer("canonical_cat_id").notNull(),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  supersedesId: integer("supersedes_id"),   // an unmerge is a new row
});
```

The resolver reads through this table, so a merge is a row and an unmerge is another row. Duplicate merge itself is still deferred, but the table lands now: it is the only version of merge that is reversible, and merge was pulled forward as a user-facing workflow precisely because it must be.

**NFC normalisation on write**, in the app and the importer alike, plus a migration-level test asserting what `cats_name_lower_unique` actually does with `Μιμή` (NFC), `Μιμή` (NFD) and `ΜΙΜΗ` under this database's collation. Whatever the answer, it is written down — the "unique by construction" argument in `records-import.md` §2.4 is only as strong as the collation underneath it, and nobody has checked.

### 10.4 Import tables

Moved to `records-import.md` §3. Created only if the import goes ahead.

**`roleAtTime` values.** `staff`, `management` and `guardian` are live (`roles-and-invites.md`, 12 October 2026). `vet` is reserved and grants nothing until SYC-24 builds vet accounts, so nobody should build a UI expecting it. There is no `volunteer` value: volunteers are on the team and write as `staff`. The resolver's authoritative roles are the team (`staff`, `management`), `vet`, and, **for sterilisation and for colour and markings only, `guardian`** with `authorityScope` = the colony. A guardian's `colony:<id>` scope is meaningful only for the role `guardian`.

### 10.5 Colonies and feeding sites

**Colonies are a table, not a string.** Until this revision a colony was free text (`colonyName`) in three separate places, which meant "Vaporia — Eleni's" and "Vaporia (Eleni)" were two colonies, the import in `records-import.md` §2.4 could not score a colony match reliably, and the guardian join that `team-access-and-welfare-queue.md` §7.3 needs (`person_scopes.colony_id`) had nothing to point at.

**Colonies use the names Syros Cats already use, usually the location plus the name of the person caring for the colony** — "Vaporia — Eleni's". **Syros Cats can rename a colony at any time** (Samuel, 28 September 2026: guardians change). Every reference is by id, so a rename moves nothing; earlier names are kept in `colony_name_history` so an old name still finds the colony and still matches on import. That is the charity's own operational vocabulary and the app adopts it rather than inventing one; the naming convention and the dashboard that maintains it are `team-access-and-welfare-queue.md` §3.4's, and the person named there is a **cat guardian**.

```ts
export const coloniesTable = pgTable("colonies", {
  id: serial("id").primaryKey(),
  // "Vaporia — Eleni's". Place + the person caring for it. Editable by the
  // team; each earlier name is kept in colony_name_history.
  name: text("name").notNull(),
  normalisedName: text("normalised_name").notNull(),  // NFC, accent- and case-folded (§10.3)
  // Free text, and deliberately not a link to `people`: most guardians have no
  // account, and the name is part of how the colony is *spoken about*.
  guardianName: text("guardian_name"),
  // Optional approximate centre, team-only. Never published — §6.2's colony
  // averaging is the reason a colony centre is not a public coordinate.
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  notes: text("notes"),                  // team-only
  // Who created the colony: the creating person's id (from the people list,
  // team-access-and-welfare-queue.md §2.9) held as text, with no foreign key,
  // null for colonies that existed before this was recorded. The column
  // already exists as nullable text; SYC-53's colony creation writes it. A cat
  // guardian can create a colony and becomes its guardian
  // (roles-and-invites.md Decision 14).
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("colonies_normalised_name_unique").on(t.normalisedName),
]);

// One row per name a colony has had before its current one. Search and the
// records import (records-import.md §2.4) would match against these as well as colonies.name.
export const colonyNameHistoryTable = pgTable("colony_name_history", {
  id: serial("id").primaryKey(),
  colonyId: integer("colony_id").notNull().references(() => coloniesTable.id),
  name: text("name").notNull(),
  normalisedName: text("normalised_name").notNull(),
  replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull().defaultNow(),
  replacedBy: text("replaced_by"),
  // The redaction path for a cat guardian's name (feeding-sites-and-colonies.md
  // §7.4): a name that contains a guardian's name can be blanked, and the row
  // keeps its place in the history.
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
});

// Cats belong to colonies through an append-only observation, not a column, so
// a cat moving colony is a dated claim like everything else in §10.1:
//   colony  { colonyId: 12 }
//   colony  { colonyId: null }     // an explicit "in no colony"
```

**The `colony` observation gains a "no colony" value.** `{ colonyId: null }` is an explicit statement that the cat is in no colony, so taking a cat out of a colony is a dated claim like putting one in. Colony membership is the exception to Decision G: **the newest active (non-superseded) statement stands** (Decision 6: a guardian decides alone), whether it names a colony or says "in no colony". Decision G's levels apply to sterilisation, life status, ear tip, colour and markings.

`colony` joins `life_status`, `sterilised`, `ear_tip`, `food_and_water`, `note` and `name` in the phase-1 observation vocabulary. **A colony observation is not evidence of life** and does not feed §3.4's derivation — it says where a cat lives, not that it was seen.

**A colony centre is team-only.** §6.2's accepted limitation is that averaging published cat positions recovers a colony centre to about 45 m; publishing the centre outright would hand over for free the one thing that limitation is about.

```ts
export const feedingSitesTable = pgTable("feeding_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),          // location + cat guardian, matching colony convention; team-only, never published
  colonyId: integer("colony_id"),        // → colonies.id; replaces the old free-text colonyName
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  // The latest publish, kept (not cleared) on make private; the history in
  // mapping_events is the full record. A link to `people` (a separate, checked
  // migration step: it was text, and people.id is a uuid).
  madePublicBy: uuid("made_public_by").references(() => peopleTable.id),
  madePublicAt: timestamp("made_public_at", { withTimezone: true }),
  notes: text("notes"),                  // team-only
  // What the public sees: a separate, required label. Null until set; required
  // before isPublic can be true (check constraint). The internal name is never
  // published, and the label never contains a guardian's name (§6.7).
  publicLabel: text("public_label"),
  // The optional "how to find it" line. Words only; a hint, not a position.
  directions: text("directions"),
  // A random 128-bit value, unique, null until the site is first made public.
  // Never derived from `id`. A new one is issued when the site is made public
  // at a position more than 10 m from where it last stood in public, and always
  // when it is made public again after being retired; superseded codes go to
  // feeding_site_old_codes.
  publicId: text("public_id").unique(),
  // Team-only: where the site last stood in public, used to decide whether a
  // re-publish needs a new code.
  lastPublicLat: doublePrecision("last_public_lat"),
  lastPublicLng: doublePrecision("last_public_lng"),
  // The last value of the "the cat guardian knows" tick box on the
  // confirmation page.
  guardianAware: boolean("guardian_aware"),
  // Set when retired, cleared when brought back. A retired site is never public
  // (check constraint).
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredBy: uuid("retired_by").references(() => peopleTable.id),
  // The version for every write: a conditional write on the updated_at the page showed.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Superseded public codes. Team-only: kept so the history can show them and so
// the public lookup can refuse them.
export const feedingSiteOldCodesTable = pgTable("feeding_site_old_codes", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull().references(() => feedingSitesTable.id),
  publicId: text("public_id").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull(),
});

// Every change to a site or colony, add-only (feeding-sites-and-colonies.md §8, §11.1).
export const mappingEventsTable = pgTable("mapping_events", {
  id: serial("id").primaryKey(),
  subjectKind: text("subject_kind").notNull(),   // "site" | "colony"
  subjectId: integer("subject_id").notNull(),
  kind: text("kind").notNull(),
  personId: uuid("person_id").references(() => peopleTable.id),  // strict link to people
  actorSystem: text("actor_system"),             // "system:seed" | "system:migration"
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  before: jsonb("before"),
  after: jsonb("after"),
  note: text("note"),
  guardianAware: boolean("guardian_aware"),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
}, (t) => [
  // Exactly one of personId and actorSystem is set.
  check("mapping_events_one_actor", sql`(${t.personId} is null) <> (${t.actorSystem} is null)`),
]);
// A database trigger refuses updates and deletes, with one allowed update: a
// redaction that sets redactedAt / redactionReason and blanks before, after
// and note only (the same shape as the observations trigger, §8.5).

// Who opened a site's page and when. No position.
export const sitePageReadsTable = pgTable("site_page_reads", {
  id: serial("id").primaryKey(),
  personId: uuid("person_id").notNull().references(() => peopleTable.id),
  siteId: integer("site_id").notNull().references(() => feedingSitesTable.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
```

**The public sites endpoint filters `isPublic = true` in the query, not in the serialiser**, and "in the query" means the definition in `feeding-sites-and-colonies.md` §11.3. `GET /api/feeding-sites` is unauthenticated, takes no query parameters, and filters `WHERE is_public = true AND retired_at IS NULL` with an explicit column list, so private rows never enter a response object. It returns only `{ id: <public_id>, label, position, cats }`, where `cats` is one of five rough bands or absent, **ordered by `public_id`**, and is identical for every caller (no ordering by distance, no filter by area, no parameter that reaches into the data). A site's position comes from one function, `publishedSitePosition(site)`, which returns the exact position (§6.7). Cache headers are short and public (at most five minutes). A lookup by public code filters `is_public AND retired_at IS NULL AND public_id = :code` in the query, and answers `404` with the same body for a site that is private, retired, never existed, has a wrong code, or has a superseded code.

### 10.6 Location blurring, and where it is actually applied

```ts
// artifacts/api-server/src/lib/blur.ts — pure
export const BLUR_CELL_METRES = 250;
// BLUR_DISPLAY_RADIUS_METRES is retired — the client draws the cell (§6.2).

export function blurPosition(lat: number, lng: number): { lat: number; lng: number };
export function publicDistanceKm(fromLat, fromLng, catLat, catLng): number; // blurs first, rounds to 0.1
```

**There is one serialiser and every emitter goes through it.** The previous spec named `catHelpers.ts` and said the cat-detail builder lives there. It does not. Verified against the code, **four** paths emit exact coordinates today and all four must be routed through `serialiseCat(cat, viewer)`:

| Emitter | Where | Serves | Today |
|---|---|---|---|
| `listCatsWithStats` | `lib/catHelpers.ts` | `GET /cats` | Emits `lat`/`lng` from the row |
| `catPayload` | `routes/cats.ts` — **not** `catHelpers.ts` | `GET /cats/{id}`, `POST /cats`, `POST /cats/{id}/claim`, `PATCH /cats/{id}` | Emits `lat`/`lng` from the row |
| The inline cat object in resolve | `routes/sightings.ts` | `POST /sightings/{id}/resolve` | Returns **the cat's** exact stored position to any spotter who confirms a match on any cat |
| The sightings array | `routes/cats.ts` | `GET /cats/{id}` | Returns `lat`/`lng` on every public sighting (§6.4.1) |

The third one deserves naming: the old §6.5 entitled a spotter to "their own exact positions — it is their data and their walk". The resolve response does not return the spotter's position; it returns the *cat's*, which is the thing being protected. That is a straight leak on the most-used authenticated path in the app.

**How `viewer` is determined, per endpoint.** `GET /cats` has no caller identity at all today — no device id, no header, no session, just `lat`/`lng` query parameters. So the owner and guardian tiers of the old §6.5 were unimplementable on the surface that matters most.

| Option | Benefits | Risks |
|---|---|---|
| **A. Accept an authenticated device on `GET /cats` and return exact positions for cats that device owns** | An owner's own cat is exact everywhere | An API change on the highest-traffic endpoint; a mixed-precision list that the offline cache then stores under one key; more surface to get wrong |
| **B. The list is always public-blurred; exact positions only on the detail page, for an authenticated owner (recommended)** | One precision per cache key, so the cache rule in §6.5 stays simple and true. No change to the list endpoint's shape. The list is the payload that lands on every phone, so keeping it uniformly public is the safe default. | An owner sees their own cat blurred in the list and exact on its page — a small inconsistency, easily explained by a line on the detail page |

**Recommendation: Option B.** And a prerequisite that is not optional: **`POST /cats/{catId}/claim` does not currently verify the device secret** (unlike resolve, which does). Any caller can claim any unclaimed cat with an arbitrary device id and thereby promote themselves into the owner tier for that cat — self-service access to exact coordinates. The claim endpoint gets `verifyDeviceSecret` before the owner tier means anything at all.

`haversineKm` continues to receive exact coordinates for internal work. Candidate selection on `POST /sightings` also uses exact coordinates, within 500 m (`DECISIONS.md` Part 2h, superseding §6.3 point 1).

### 10.7 API changes

`Cat` and `CatDetail` gain:

```yaml
lifeStatus:
  type: string
  enum: [street, homed, in_care, deceased]
locationPrecision:
  type: string
  enum: [exact, approximate]
  description: |
    "approximate" means lat/lng are the centre of a cell of locationCellM
    metres and must be drawn as that cell, never as a pin.
locationCellM: { type: integer, nullable: true }
notSeenSince: { type: string, nullable: true }
sterilised:
  type: object
  properties:
    value: { type: boolean, nullable: true }
    confidence: { type: string, enum: [confirmed, likely, reported, unknown] }
    clippedTipSightings: { type: integer }
```

`lat`/`lng` keep their names and meaning ("where this cat is") — clients do not branch on a different field. `locationPrecision` tells the map how to draw it. Public `CatDetail.sightings[]` drops `lat` and `lng` entirely; the team payload keeps them.

*Amended 12 October 2026, SYC-2:* `Cat` and `CatDetail` also gain `coat` (a list of colours; `[]` means not known, never the string `not_sure`) and `markings` (a list). Not `vaccinated`, and nothing else about either field: not confidence, author, counts, model version or the date a colour was read. This is the single wire shape for "not known", used by every reader.

**No cache-key change.** The new fields are additive: an old client ignores them and a new client treats a missing `coat` or `markings` as "not known". The reason for a bump in §6.5 (a *shape* change that could leak or break) does not apply, so `cats-cache/public/v2` stays. Retired cache keys are deleted without being read, so a bump would empty the offline catalogue for anyone who updates the app with no signal.

New and changed endpoints:

- `POST /sightings/{id}/resolve` accepts optional `earTip` (`clipped_left | clipped_right | clipped_unsure | looks_whole | cant_tell`), `foodAndWater` (`yes | no | cant_tell`), and `note` (string, ≤500 chars). Each written as its own observation with `provenance: "prompted"` when the app pre-filled the answer — recording `suggestedValue` and `suggestionSource` — and `"volunteered"` when it did not. **Its response no longer carries the cat's exact position.**
- `POST /observations` (team) — writes a life-status or sterilised observation with a reason. §4.5, §3.5.
- `POST /observations/{id}/supersede` (team) — the correction path. §4.5.
- `GET /observations/review/likely` (team) — the *Likely* review list. §4.5.
- `DELETE /me` (device-authenticated) — self-service deletion. §8.2.
- `POST /sightings` requires the device secret and is rate-limited per device. §6.3.
- `POST /cats/{catId}/claim` requires the device secret. §10.6.

### 10.8 Tests that must exist

The resolver carries the design risk, so it carries the tests.

1. **The ear-tip asymmetry.** No quantity, authority or recency of *spotter* "no clip visible" observations moves sterilised away from its current level or toward a negative. Dedicated, named, and commented with why it exists.
2. A clipped-tip observation reaches *likely* and never *confirmed*, whoever wrote it.
3. **Precedence between two authoritative assertions**, both directions: an import `true` dated 2024 followed by a staff `false` dated 2026 resolves to a confirmed negative; the same two in the opposite date order resolve positive. (Nothing in the previous test list covered this, which is how `records-import.md` §2.7's correction path came to be unimplementable.)
4. An authoritative `ear_tip { clipped: false }` superseding a spotter's `clipped: true` returns sterilised to *unknown* and never to a negative.
5. Presumed-deceased reverts on a sighting dated after a `deceased` observation, in the same read, with no job run.
6. A cat created today with no sightings is not presumed deceased.
7. Presumed-deceased is computed from `observedAt`, so an offline sighting synced four days late still counts from when it was taken.
8. **Every public payload** — asserted against all four emitters in §10.6 by name — contains no exact coordinate, no sighting coordinate, no note, no private feeding site and no raw device id.
9. The same public request repeated a hundred times with varied viewer positions returns byte-identical geography.
10. **The nearest-cat oracle.** Probing `POST /sightings` from a grid of coordinates returns a candidate set that does not vary with sub-cell movement of the probe and does not reveal ordering by true distance.
11. *(Import idempotency moved to `records-import.md` §5.)*
12. **Auto-link safety:** a name-only match with no corroborating signal does not auto-link; a name match with a contradicting sex does not auto-link.
13. **EXIF, on both entrances:** a JPEG uploaded with a GPS block comes back from the photo endpoint with no GPS block — asserted for a spotter's upload (owned by `hosting-and-photo-storage.md`) **and** for a photo arriving with an imported record. Plus a structural assertion that the import writes photos only through `validatePhotoBase64`.
14. **Deletion:** after `DELETE /me`, no query returns the device id, email, nickname or username; sighting counts, derived statuses and cat names are unchanged; a second call is safe.
15. **Notification baseline:** any bulk write of historical data (a backfill, or a future import) produces zero notifiable status changes.
16. **Greek names:** the migration-level normalisation test in §10.3.
17. **Welfare observations:** filing a report against a known cat writes a `welfare_report` observation and moves no derived status; closing it writes a `welfare_outcome`; neither produces a notifiable change; and a `welfare_report` counts as evidence of life for §3.4.
18. **Match records:** a choice is labelled from the stored row, never from the phone's word. A below-threshold candidate picked by hand is a `hand_pick`, not `suggested`. A hand pick after a failed matcher, or with no photo compared, has no miss kind. A second resolve, or a repeated photo after resolve, can't change a recorded choice or the sets it was worked out from. A failed match write still lets the sighting resolve, and it reads as `unlabelled`. A team step can't break the CHECKs when its account is later deleted. No public payload contains anything from `sighting_matches`.

### 10.9 Match records

`choose-a-different-cat.md` §4.6 decides that the server, never the phone, says how a spotter's choice was made, and that the record behind it lives in a small team-only table. `DECISIONS.md` Part 3 gives that table to this document. This section is that table.

**What it is for.** One row per sighting. It holds what the matcher compared, what it suggested, what the spotter chose, and what the team later did about it. It is:

- the dataset SYC-56 measures matching accuracy from, including its "looks right, or not flagged within 30 days" label rule;
- the evidence SYC-80 needs on the 500 m limit;
- the source of the "Matched by hand" list and its photos waiting for a match (`choose-a-different-cat.md` §5);
- the "looked, then still chose new" signal SYC-59 uses (`choose-a-different-cat.md` §8.5).

```ts
// lib/db/src/schema/sightingMatches.ts
export const sightingMatchesTable = pgTable("sighting_matches", {
  sightingId: integer("sighting_id").primaryKey()
    .references(() => sightingsTable.id, { onDelete: "cascade" }),

  // 1. What the matcher looked at. Null when no match was recorded for the
  //    sighting and the row was first written at a later step.
  comparedCatIds: integer("compared_cat_ids").array(),
  // What it suggested: [{ catId, rank, score }], with real cat ids, including
  // any candidate the public response anonymised below the threshold.
  suggested: jsonb("suggested").$type<SuggestedMatch[]>(),
  // The matcher produced no comparison: the call failed, or there was no
  // photo to compare. Distinguishes "compared nothing" from "no cats nearby".
  matcherFailed: boolean("matcher_failed").notNull().default(false),
  matchedAt: timestamp("matched_at", { withTimezone: true }),

  // 2. The spotter's choice, labelled by the server.
  choice: text("choice"),
  //   suggested | hand_pick | new_cat | sent_to_team | unlabelled
  chosenCatId: integer("chosen_cat_id"),
  suggestedRank: integer("suggested_rank"),   // with "suggested" only
  pickedFrom: text("picked_from"),             // nearby | search | name_prompt
  missKind: text("miss_kind"),                 // matcher_miss | distance_miss
  openedPicker: boolean("opened_picker"),      // with "new_cat"
  colourFilterOn: boolean("colour_filter_on"), // with "new_cat"
  aliveClaim: boolean("alive_claim"),          // with "sent_to_team"
  chosenAt: timestamp("chosen_at", { withTimezone: true }),

  // 3. What the team did, once (choose-a-different-cat.md §5).
  teamAction: text("team_action"),
  //   on "sent_to_team": matched | made_new_cat
  //   on "hand_pick" or "unlabelled": looks_right | different_cat | new_cat | hidden
  teamCatId: integer("team_cat_id"),           // the cat the team chose at this step
  teamByAccountId: text("team_by_account_id"),
  teamAt: timestamp("team_at", { withTimezone: true }),

  // §8: deleting the account that took the team step.
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
});
// CHECKs: each enum column holds only its listed values, or null.
// A choice comes with a time, and a time with a choice. A rank comes with
// "suggested" and only with it. teamAction, teamAt and teamByAccountId are
// all set or all null, except that teamByAccountId may be null once
// redactedAt is set. teamAction's value fits the choice it answers.
// teamCatId is set exactly when teamAction is matched, made_new_cat,
// different_cat or new_cat.
```

**The labels, as the server decides them.** The phone sends only two things: which cat it chose, and which of its own screens the choice came from (`pickedFrom`). That is harmless because it describes the phone's screen and nothing else. The server works out the label from the row as it stands when the label is written:

| Label | When |
|---|---|
| `new_cat`, with `openedPicker` and `colourFilterOn` | The spotter created a cat. This label applies whatever the row holds. Whether they opened "Find the cat yourself" first, and whether a colour filter was on, are weak evidence the cat really is new. |
| `suggested`, with its rank | The chosen cat is in `suggested` **and** cleared the confidence threshold, so the spotter was actually shown it. A below-threshold candidate sits in the stored set but was never shown, so picking it is a hand pick. |
| `hand_pick`, with `pickedFrom` and `missKind` | Any other existing cat. The miss is a `matcher_miss` if the cat is in `comparedCatIds`, and a `distance_miss` if it isn't. **When `matcherFailed` is set**, nothing was really compared, so `missKind` is null, never a distance miss. |
| `sent_to_team`, with `aliveClaim` | The spotter asked Syros Cats to match the photo. `aliveClaim` marks a request made from a deceased cat's card ("Think this cat is alive?", `choose-a-different-cat.md` §4.3). |
| `unlabelled`, with `pickedFrom` | An existing cat was chosen, but the row has no stored set to compare with, because no match was recorded. The server doesn't guess. |

**When it is written.** It is written in three steps. Each step is written at most once. Step 3 may also fill in a `sent_to_team` choice that step 2 failed to write:

1. **When the match runs** (`POST /sightings`), the compared and suggested sets are stored. If the same photo is sent again (the dedupe path in `offline-queue-on-web.md`), they are overwritten, because the phone shows the latest response. This never happens once the sighting is resolved or sent to the team.
2. **When the spotter chooses**, the label is written: at `POST /sightings/{id}/resolve` for a cat or a new cat, or at the "Ask Syros Cats to match it" request for `sent_to_team`. The write happens only if no choice is recorded yet, so a retried or racing request can't relabel it. A resolve writes its label after its transaction commits.
3. **When the team acts.** On a photo sent to the team, matching it or making it a new cat fills the team columns. If step 2's write was lost, the same write also records `choice = sent_to_team`, with `aliveClaim` left null because it can no longer be known. On a hand pick, or an existing-cat choice recorded as `unlabelled`, "Looks right", "Different cat…", "It's a new cat" or "Hide this photo" fills them. The write happens only if `teamAt` is still null, so two people acting at once can't both record a step. Anything the team changes after that is a move statement (`choose-a-different-cat.md` §8.2) or a report, never an edit to this row.

Every write is best effort. If a write fails, it is logged, and the spotter's sighting, points and response still go ahead. **Readers treat a resolved sighting with no recorded choice as `unlabelled`**, the same as a choice with no stored set. Those sightings appear in "Matched by hand" like any `unlabelled` pick, and a team step on one records `choice = unlabelled` with it. The record is incomplete there, never wrong.

**Why this table is updated, unlike observations.** §2 makes statements about cats append-only. A match record is not a statement about a cat. It is the working of one decision about one sighting, completed in the three fixed steps above. Nothing in it feeds the resolver, and no derived status reads it. **Moving a sighting to a different cat** (`choose-a-different-cat.md` §8.2) is its own attributed statement. The match record keeps what the spotter chose next to what the team did, which is exactly the pair SYC-56 measures.

**Privacy.** It is team-only by construction. No public route reads this table, so the matcher's working can't reach a public payload: it is filtered in the query, not the serialiser, as for private feeding sites in §10.5. The table never holds a position, a device id or a photo.

Deleting a person:
- **A spotter** (§8) needs nothing extra here, because the row is linked to the sighting and sightings outlive deletion (§8.3). The cascade only follows a sighting if one is ever removed.
- **A team member, cat guardian or vet who took a team step** gets the same redaction as their observations: `teamByAccountId` is cleared and `redactedAt` is stamped. What the team did stays recorded.

**Merges.** All the cat ids in a row are the ids at the time:
- `chosenCatId`
- `teamCatId`
- the ids in `comparedCatIds`
- the ids in `suggested`

Readers resolve them through `cat_identity` (§10.3), as for everything else, so a later merge never rewrites a match record.

---

## 11. Migrating what is already there

Nothing is thrown away and no existing behaviour changes for a spotter.

### 11.1 Real migrations, before the Play clock (F6)

Two things are required and neither is negotiable:

1. **All of September's schema work lands before the fourteen-day Google Play closed test begins.** The sequencing is what protects the October launch: a schema change during the closed test either restarts the clock or ships against a database the testers' build does not match.
2. **Generated migrations with checked-in history, and a verified rollback.** The database today is managed with `drizzle-kit push` and there is no migrations directory at all — the schema is whatever the last push made it. That has already 500'd every endpoint in the app once (`.agents/memory/db-schema-drift.md`), and roughly twelve new tables are arriving in this spec and its siblings.

So before any table below is created: switch to `drizzle-kit generate`, check in the generated SQL, baseline the existing schema as the first migration, run it forward against a copy of the live database, and **verify that rolling one migration back works** rather than assuming it does.

### 11.2 The sequence

| Step | What happens | Risk handling |
|---|---|---|
| 0. Migration history | Baseline the current schema, switch to generated migrations, prove a rollback. | Nothing else in this table is safe without it. |
| 1. Create the tables | `observations`, `cat_identity`, `colonies`, `feeding_sites` (plus `import_batches` and `import_records` only if the import goes ahead, `records-import.md`), plus `redactedAt` on the append-only tables. Nothing reads them yet. | Additive; no existing column touched. The redaction column is added now precisely so it is never a two-season migration later (§8.5). The later feeding-site additions (`feeding_site_old_codes`, `mapping_events`, `site_page_reads`, and the checked change of `made_public_by` to a link to people) are their own steps and not all additive (`feeding-sites-and-colonies.md` §11.1). |
| 2. Backfill life status | Nothing is written. Every cat with no `life_status` observation resolves to **street**, which is correct for essentially every cat in the catalogue. | The default is the truth here, so an empty table is an accurate table. |
| 3. Backfill from the care timeline | Existing `desexed` care updates become `sterilised` observations with `provenance: "legacy"`, `roleAtTime: "staff"` (they were written through the admin endpoint), and `observedAt` set to the update's date. Existing `adopted` updates become `life_status: homed`. | `legacy` provenance means these can be re-derived or discounted later. Runs as a bulk write, so it seeds the notification baseline rather than notifying (§9.2). |
| 4. Claimed cats **are** made "homed" (Samuel, 28 September 2026) | An owner claiming a cat is evidence it is homed (§3.1), so every existing claim is backfilled as a `homed` observation from the claiming device, and from now on a claim writes one at the moment it is made. Cats registered through `POST /cats` (owner registration, no sighting) become **homed**, because that flow only exists for cats living with someone, and from now on that endpoint writes the observation at creation rather than relying on a backfill. *(`POST /cats` is later removed by `claiming-a-cat.md` §9; the backfill of cats it already registered stands.)* | Some claimed cats are really street cats a resident feeds; the team can set any of them back to Street (§3.2). Because a claim now changes what a cat's page says, securing the claim (row 5) matters more. |
| 5. Close the oracle and secure the claim | `POST /sightings` keeps exact 500 m candidate selection (`DECISIONS.md` Part 2h) and gains per-device rate limiting and the confidence threshold for ids and names (§6.3 points 2–3); `POST /cats/{catId}/claim` gains device-secret verification. | Ships before blurring, not after — blurring a payload while the oracle answers questions about the true value is a privacy promise that is already false. |
| 6. Turn on blurring | All four emitters route through `serialiseCat`; public sighting coordinates disappear; the resolve response stops returning the cat's exact position. | Deployed with the client change that draws cells instead of pins, and with a cache-key version bump (`cats-cache/public/v2`) so no phone keeps serving an exact payload. |
| 7. Add the two sighting questions | Reward screen gains one tap question and one optional box, with the real example photo. | No change to the spot, match or resolve paths. |
| 8. Self-service deletion | Settings action, confirmation screen, `DELETE /me`. | Depends only on step 1's redaction column. |

None of these steps depends on a records import. If one goes ahead, it follows step 8 (`records-import.md` §4).

---

## 12. Risks

| # | Risk | Consequence | Mitigation |
|---|---|---|---|
| 1 | **The ear-tip rule gets inverted by a well-meaning later change** — someone reasonably concludes that ten "no clip visible" answers should mean something | Volunteers driving out to trap cats sterilised years ago, wasting the charity's scarcest resource and distressing the cat | The rule is stated in the product spec, this spec, a named test, and a comment on the resolver branch. The test's failure message says what breaks in the real world. §4.5's authoritative `clipped: false` is deliberately scoped to team and vet so it cannot be mistaken for a general relaxation. |
| 3 | **Location blurring leaks through a side channel** — a new endpoint, a sort order, a distance figure, or the offline cache carrying an exact payload | The privacy promise made to Syros Cats is quietly false, and nobody finds out until someone shows them | Blurring lives in one serialiser that all four emitters call; tests assert no public payload holds an exact or per-sighting coordinate; the cache key carries tier and version. The one endpoint that previously defeated all of it is §6.3. Its matching now knowingly uses exact positions within 500 m (`DECISIONS.md` Part 2h), with per-device limits and the confidence threshold arriving in PR 5. |
| 4 | **Colony averaging recovers feeding sites** | The targeting concern Syros Cats raised is not fully answered by anything we build | **Knowingly accepted** (F2), at its real magnitude of ~45 m for a thirty-cat colony, disclosed to Syros Cats in plain language alongside D4 and recorded as accepted. Owner: Samuel. |
| 5 | **D4's public negative becomes a target list** | Someone hostile filters the map for unsterilised cats in one neighbourhood | Accepted with D4, disclosed with risk 4, and mitigated only by the blurring that also protects everything else. Reviewable after the first season: the display rule is one branch in the serialiser. |
| 6 | Notes arrive containing urgent welfare information and sit unread | A cat that needed help did not get it, and the app collected the evidence | Notes matching injury/illness/litter keywords in all three languages are highlighted in the dashboard. The trouble-report flow stays the primary route and is signposted from the note box. **Per F1, nothing pages a human, by design** — `team-access-and-welfare-queue.md` owns that copy and it is load-bearing. |
| 8 | Deriving status on every read becomes slow | Catalogue and map feel sluggish | Pagination and batched observation loading in the first cut (§2.3); the cached-status column is a pure function of the log and addable without a data model change. **Trigger: any catalogue query above 200 ms — with the request-duration logging that makes that trigger observable shipping in the same change.** |
| 9 | Notes, names and guardian details make this an app that processes personal data properly for the first time | Obligations a "we hold almost nothing" threat model does not cover | §8's self-service deletion, purpose stated at the point of entry, team-scoped access, a written retention position. Sequenced as one deliberate change. Privacy policy owned by `email-capture.md`. Owner: Samuel. |
| 10 | **Someone deletes their data by accident, or a phone is handed to a friend** | Irreversible loss of one person's points and history | The confirmation screen states exactly what goes and that it cannot be undone (§8.2). Accepted: the device is the identity, and requiring an email round trip would exclude the anonymous majority the app is built for. |

---

## 13. Open questions

| # | Question | Owner | Why it needs a person |
|---|---|---|---|
| 1 | **Is 250 m the right blur cell for Syros?** A cell is about a block of Ermoupoli. Too coarse and the map stops being useful in dense town; too fine and it points at a doorway. | Syros Cats, with Samuel | Local knowledge beats any number we pick. One config value; changeable after they see the first real map. |
| 2 | **Do Syros Cats accept the colony-averaging limitation and D4's public "not sterilised", together?** §6.2 states the magnitude honestly; §4.2 states what the map will now say. | **Syros Cats — needs a recorded answer, not an assumption** | It is their island, their neighbours and their reputation. F2 requires the acceptance be recorded with a date. |
| 3 | **Should a public feeding site show its exact position, or be blurred too?** Recommendation: exact, because making a site public is a deliberate act with a purpose. | Syros Cats | It is their exposure and their neighbours. |
| 5 | **Should a cat guardian be able to mark their own cat deceased without team confirmation?** | Syros Cats | Recommendation: yes — they are the person most likely to know, and it is reversible by any later sighting (§3.2). |
| 6 | **How long do we keep sighting notes?** They may contain personal information. | Samuel, with Syros Cats | Recommendation: indefinitely for notes attached to a welfare outcome, three years otherwise, removed immediately on deletion (§8.3). |
| 7 | ~~Is the derived cat position (§6.6) in this phase or the next?~~ | Samuel | **Answered 28 Sep: deferred.** The map shows the discovery position, labelled as such. Later work is SYC-80. |
