# Cat health record and volunteer entry — design

**Date:** 28 July 2026
**Status:** For review
**Scope:** Sub-projects A (cat health record) and the first slice of C (volunteer entry), with colonies pulled forward. Sub-projects B, D, E, F, G, H are mapped here but specified separately.

**Related:** [`docs/SPEC.md`](../../SPEC.md) — the reverse-engineered specification of the app as built.

---

## 1. Why this exists

Syros Cats asked for three things:

1. Reporting on their impact — how many cats have been sterilised through their work
2. An engagement tool that gets tourists and residents mapping as many cats as possible
3. Data showing where they can most effectively intervene

All three are blocked by the same absence. **The app has no structured idea of what condition a cat is in.** `desexed` and `adopted` exist only as free-text sentences on a notification timeline. The app can report that a cat was spotted forty times and cannot answer "how many cats have we sterilised", "which colonies are unsterilised", or "where should the next campaign go".

That is not a missing report. It is a missing field, and everything else is downstream of it.

A second, quieter dependency: **matching quality is data quality.** If one cat is registered three times, the island count is wrong, the sterilisation proportion is wrong, and volunteers get sent to trap a cat that was done years ago. That is sub-project G.

## 2. Sub-project map

| | Sub-project | Depends on | Sequence |
|---|---|---|---|
| **A** | Cat health record — structured, attributed claims | — | **This spec** |
| **C₁** | Volunteer entry — accounts, roles, field controls | — | **This spec** |
| **G** | Matching engine — measure, then embeddings for retrieval | — | Next |
| **B** | Report a cat in trouble | A, C₁ | Then |
| **D** | Impact and targeting | A, C₁ | Then |
| **H** | Colonies and the feeding network | A | Then |
| **E** | Coverage-driven engagement | sighting density (exists) | Independent |
| **F** | Donations | — | Independent |

Colonies are pulled forward into this spec because impact reporting groups by them.

---

## 3. Architecture: store the claims, derive the status

**Decision:** nobody edits a status field. People add dated, attributed observations, and status is computed on read.

**Rejected alternatives.** Storing a status column with a separate audit log is simpler and faster to read, but it would be the first place in this app where the displayed value can drift from the truth. An event log with a cached status column is what this becomes at 100× the scale; adding the cache later is easy, unpicking a boolean into a claim history after two years of data is not.

**Rationale:**

1. **It matches how this codebase already thinks.** Points are the only stored aggregate in the entire app — badges, streaks, fan counts and catalogue totals are all derived on read, explicitly so they cannot drift.
2. **A funder report must survive "how do you know".** With claims, the answer is a list. With a boolean, the answer is "someone ticked a box".
3. **It is the only model where the crowd compounds.** Three tourists independently photographing the same clipped ear is real evidence. A status field cannot represent that; it can only be overwritten by the last writer.

**Accepted cost:** every read computes, and the resolution rules become their own body of logic requiring hard tests. At Syros scale — hundreds of cats — the performance cost is nil. The complexity cost is real and is the price of citable data.

### 3.1 Observations

One dated, attributed statement about one cat:

- **kind** — which attribute
- **value**
- **source** — device or account, with role at time of writing
- **provenance** — `volunteered`, `prompted` (machine suggested, human confirmed), or `machine` (asserted above threshold)
- **photo** — optional, the evidence
- **note** — optional free text

**Observations are never edited or deleted.** A wrong observation is superseded by a later one; retraction is itself an observation. Corrections happen in public, which is correct here: unclipped cats are sometimes sterilised, and the record needs to show that being worked out rather than hide it.

### 3.2 Derived status

For each attribute the resolver walks observations newest-first and returns a value plus a confidence:

| Level | Means |
|---|---|
| **Confirmed** | An authoritative source asserted it |
| **Likely** | Multiple independent observations agree |
| **Reported** | A single unconfirmed public observation |
| **Unknown** | Nothing has been said |

**Authority is per attribute, not global.** A vet outranks everyone on clinical facts and has no special standing on where a cat sleeps. A guardian is authoritative on their cat's day-to-day condition and is an ordinary observer on a cat they don't look after. This is what makes new roles addable later without touching the resolver.

**Confidence never crosses attributes.** A *Confirmed* ear-tip is a confirmed statement about an ear, not about a surgery. It contributes to sterilised reaching *Likely* and can never make it *Confirmed* — only a vet or staff assertion does that. This is the §4.3 asymmetry expressed as a rule the resolver enforces rather than a convention it hopes for.

The resolver lives in one pure, dependency-free module, tested in isolation — the same treatment `streak.ts` received, for the same reason: it fails silently and plausibly. A wrong confidence level looks exactly like a right one.

---

## 4. What the record holds

### 4.1 Health — how the cat *is*

Changes over time; recency matters.

| Attribute | Values | Authoritative sources |
|---|---|---|
| Sterilised | yes / no / unknown | Vet, staff |
| Ear-tipped | seen / not seen | Anyone, photo-backed |
| Vaccinated | rabies, date | Vet, staff |
| Sex | female / male / unknown | Vet; anyone as a report |
| Age class | kitten / young / adult / senior | Vet; anyone as a report |
| Pregnant or nursing | yes, observed on date | Vet; anyone as a report |
| Condition | healthy / needs attention / urgent | Anyone |
| Deceased | date | Staff, guardian |

Deliberately excluded: breed, weight, temperament. If it does not change what someone does, it is not in the record.

### 4.2 Appearance — who the cat *is*

Essentially stable; agreement across observers matters more than recency. Base colour, pattern, and distinguishing features (white bib, notched ear, kinked tail, odd eyes).

**Controlled vocabulary, not free text.** The app is trilingual: a Greek volunteer typing «τιγρέ», a French tourist typing "tigré" and an English one typing "tabby" produce three unsearchable strings describing one cat. A controlled list translates, filters, and can be offered as tappable chips rather than a keyboard — which matters when the alternative is typing outdoors in the sun.

Appearance pays for itself four times: it fills the `description` field that exists in the schema and is never written to; it gives the matching engine a cheap pre-filter; it lets the app participate in how people actually talk ("the tortoiseshell by the bakery"); and it makes the catalogue searchable the way people want to search it.

### 4.3 Evidence asymmetry — the ear-tip rule

**Ear-tip seen is strong evidence of sterilisation. Ear-tip not seen is almost no evidence of anything.** Cats are sterilised without a clip — an older spay, a different practice, a subtly healed clip, or a photo from the wrong side.

The resolver therefore treats a missing ear-tip as **absence of evidence, never evidence of absence**. No quantity of "no clip visible" observations can push a cat toward *not sterilised*. Only a vet or staff member can assert that; until then it stays *Unknown*.

Getting this backwards puts every unclipped-but-sterilised cat on the "needs trapping" list, sending volunteers to trap cats already done — wasting the scarcest resource the charity has and distressing the cat. **The failure mode of this feature is real people driving to real places for no reason.** It gets a dedicated test.

### 4.4 Other resolver rules

- **Pregnancy expires.** "Pregnant, observed 3 March" is not a fact about today. Pregnancy and nursing observations age out of current status into history, or a cat is permanently pregnant in the app.
- **Retraction is an observation.** A correcting record supersedes; the original stays in the trail.
- **Named clusters pin their identity.** See §7.

---

## 5. Machine suggestions

One vision pass over each photo produces both the matching fingerprint (§9) and attribute suggestions. Suggestions come from the vision model already in the pipeline at first — marginal token cost, no training, works day one — and later from a classifier trained on the confirmations users generate. **The taps are the training data.**

The user confirms, corrects or skips: *"Ginger tabby, white bib, left ear looks clipped — right?"* Confirming is a far lower bar than knowing, and this is likely the difference between a health record that fills up and one that stays empty.

### 5.1 When a machine suggestion is definitive

Per attribute, at a threshold set by measurement. The distinction is how visible the thing is and what being wrong costs:

| Attribute | Machine definitive? | Why |
|---|---|---|
| Colour, pattern, markings | Yes, above threshold | Plainly visible; wrong is cosmetic and trivially corrected |
| Ear-tip seen | Yes, above a higher threshold | Visible, and the photo is retained for re-checking |
| Sex, age class | Suggest only | Frequently ambiguous from one photo |
| Sterilised, vaccinated | Never | Not visible at all — clinical facts, not observations |

Concretely, one threshold per attribute splits two behaviours. **Above it**, the model writes a `machine` observation and the attribute resolves to *Confirmed* — for that attribute only, per §3.2. **Below it**, nothing is written; the model's guess becomes a suggestion shown to the user, and if they skip it the attribute stays *Unknown*. The model's opinion is never a silent half-record.

**Thresholds are measured, not declared.** A vision model's stated confidence is not a probability; these models are reliably overconfident, and a self-reported 0.95 may be right 70% of the time. Thresholds come from scoring against the labelled evaluation set built in sub-project G. Ship confirm-first, measure, promote attributes as the evidence earns it.

### 5.2 Prompted confirmations are not independent evidence

If three people were each shown the same pre-filled "left ear looks clipped", they did not independently observe anything — they agreed with one model's guess three times. People overwhelmingly confirm what is already on screen. Three confirmations of one error is one error, and it would flow straight into the figure reported to funders.

Therefore:

1. Every observation records its provenance.
2. **Prompted confirmations are weighted below volunteered observations** and cannot reach *Confirmed* on their own.
3. An unanswered suggestion leaves the attribute *Unknown*, which is the truthful state.

**Provenance is what makes a wrong threshold survivable.** Discovering in six months that the ear-tip threshold was too low is a re-derivation if provenance was recorded, and permanent contamination if it was not. It costs one column.

---

## 6. Identity, roles and access

The public path does not change. No signup, no email, no wall — a tourist opens the app and photographs a cat exactly as today. Everything here is additive.

### 6.1 Accounts

Accounts exist only for people whose word carries weight, and are created **only by invitation** — there is no self-declaring yourself a vet.

**Use Clerk** rather than building authentication. It supports Expo and Express, and provides invitations, roles and session management. This converts the app's first password system — resets, lockout, email delivery, sessions — from a build into configuration, and is the single largest de-risking available in this design. *Open item: confirm Clerk's pricing at a small charity's volunteer scale before committing.*

### 6.2 Roles

| Role | Authoritative on |
|---|---|
| **Admin** | Everything, plus inviting and revoking |
| **Staff** | All attributes; broadcasts; colony naming |
| **Volunteer** | Field observations; trouble-report response; confirmations |
| **Partner vet** | Clinical attributes — sterilised, vaccinated, sex, age |
| **Cat guardian** | Their cats' day-to-day condition, feeding, whereabouts — not clinical facts |

Invites are single-use, tied to an email, and expiring. Revocation never erases what someone recorded; past observations stay, correctly attributed.

**Signing in upgrades the phone.** The account becomes the identity, the existing device credential remains the session. A volunteer keeps their anonymous spotting history and gains their role. Signing out returns the phone to public mode.

### 6.3 Guardians

The app already has this relationship: any resident can claim a cat, set a home description and gain rename rights. Guardian is the **endorsed** version of it, not a parallel concept.

| | How it starts | Authority |
|---|---|---|
| **Claimed** (exists) | Anonymous resident taps "this is my cat" | Name and home only |
| **Guardian** (new) | Syros Cats endorses that person | That cat's condition, feeding, whereabouts |

A resident who feeds a cat must never need an account. Putting a signup in front of the most valuable contributor on the island would be a serious own goal.

### 6.4 Personal data

Guardians confirm Syros residency by address. Name and contact details are optional.

| Field | Required | Visible to |
|---|---|---|
| Address | Yes, for guardianship | Staff only |
| Real name | Optional | Staff only |
| Phone / email | Optional | Staff only |

**A self-typed address verifies nothing** — what establishes a resident guardian is Syros Cats endorsing them, because a small island charity knows who feeds the cats behind which taverna. The address is context that helps them recognise the person, not a check the software performs. Building it that way deliberately beats building a form that looks like verification and isn't.

Nothing here appears in any public payload. The public-facing owner name stays a chosen display name.

**This is a change in what the app is.** Today it holds almost no personal data, which is a deliberate design property and why the threat model is short. Storing residents' names, addresses and phone numbers means processing personal data in the EU, so GDPR applies properly: stated purpose, lawful basis, real deletion, retention limits, staff-scoped access. This is normal for a charity to hold and entirely doable — it is not a field to add and move on from. The counter-argument is decisive: the charity will record these details regardless, and a governed record beats an ungoverned spreadsheet.

**Feeder contact details require recorded consent** — who consented, when, to what, and the ability to withdraw.

---

## 7. Colonies

Cats cluster from where they are actually seen. Staff can name a cluster, and that name is the colony Syros Cats already talks about — no boundaries to hand-maintain as cats move. Chosen over staff-drawn fixed boundaries because derived clusters stay operable at scale.

**Once named, a cluster's identity is pinned**, so a colony stays itself as its membership shifts rather than silently becoming a different colony when the data moves.

Impact and targeting group by colony.

---

## 8. How people contribute

### 8.1 The public

The spot flow is the best thing in this app and the reason anyone returns. **The fastest way to kill this project is to put a health questionnaire between a tourist and their points.** Contributing is never required, never blocking, and never a form.

1. **Nothing is asked before the reward.** The question appears on the existing post-resolution screen, where the user has just earned points and the task is done.
2. **One question, chosen for this cat** — the single most valuable unknown, or nothing at all if everything is known.
3. **Tap, never type.** Chips, pre-selected from machine suggestions.
4. **Confirm rather than author.**

> **+10 points** · Agatha spotted again
>
> *One quick thing — is Agatha's ear clipped?*
> `Yes, clipped`  `No, looks whole`  `Can't tell`
>
> *Skip*

"Can't tell" is a first-class answer, recorded as such, so the question stops being asked forever.

**Appearance is captured in the new-cat naming flow** instead — the one moment where someone is already describing the cat and extra input feels like part of the fun.

**Points for observations, with a guard:** one person's observation of one attribute on one cat counts once. Otherwise the leaderboard becomes a test of who can tap "ginger" most often, and the record fills with noise from the people trying hardest to help.

**Not building:** health forms, mandatory fields, public free-text health notes, or "complete this cat's profile" nagging. If nobody ever answers a question, the app is exactly as good as it is today.

### 8.2 Volunteers

Signing in adds controls where the volunteer already is. On any cat page: record a clinic visit, confirm or correct crowd reports, flag for trapping, mark deceased. Each writes an authoritative observation into the same record — no separate volunteer database, no reconciliation problem.

**The confirmation queue is the highest-leverage screen.** Cats where the crowd has reached *Likely* and a volunteer's word would make it *Confirmed*, sorted by proximity. Hundreds of tourists do the finding; a handful of volunteers do the confirming. Five minutes of tapping turns a season of tourist photos into citable numbers.

**Field work is offline work** — volunteers are outdoors with less signal than the tourists. Everything queues through the app's existing offline machinery rather than a second system.

---

## 9. Matching engine (sub-project G, summarised)

Included here because every impact number rests on it.

Today: the vision LLM receives the new photo plus the **10 geographically nearest** cats. Three weaknesses — candidates are chosen by distance rather than appearance (so a moved cat is invisible, and in a 30-cat colony the right cat may not be shortlisted); each spot costs a paid call with eleven images, which is why the endpoint is capped at 20 per 15 minutes; and it cannot work offline, which is the condition the rest of the app is built for. Underneath all three: **no evaluation set exists**, so current accuracy is unknown.

**Decision: hybrid, staged, measure first.**

1. **Build an evaluation set** from confirmed sightings already in the database and score the current system. Every confirmed sighting is a human-verified label saying *these two photos are the same individual*. This is the highest-value hour available, and may show the current approach is fine.
2. **Embeddings for retrieval.** Fingerprint every cat photo, store vectors in Postgres via `pgvector` — same database, no new infrastructure — and shortlist by visual similarity instead of distance. The LLM then adjudicates the top three and supplies its reasoning sentence. Fixes candidate selection, cuts cost substantially, needs no training, leaves the user experience identical.
3. **On-device embeddings** for offline matching, and a fine-tuned re-ID model once labels accumulate.

Full ML alone was rejected for now: it discards the per-candidate reasoning sentence, which is what users rely on when making the judgement.

**To be tested, not assumed:** many Greek street cats are tabbies who genuinely look alike. Some pairs will defeat both approaches, and the honest answer is for the app to say "I'm not sure" well — which is what the confidence levels are for.

---

## 10. Impact and targeting (sub-project D, summarised)

All four audiences from one set of queries.

**Figures always carry their confidence:** *"89 confirmed sterilised, 23 likely, 30 unknown, of 142 cats."* The honest number is the stronger one — a funder who sees error bars trusts the total, and a tourist who sees 30 unknowns sees something they can help with.

- **Public, in-app** — live counts on the Help tab; per-cat provenance on cat pages.
- **Funders** — the same query over a date range, exported, method stated, confidence split intact. Answerable because every claim is dated and attributed.
- **Targeting** — sterilisation coverage per colony, colonies growing, colonies with no feeder, and areas nobody has surveyed. That last is free: sighting density already reveals unphotographed parts of Syros, which is both a data gap and the raw material for sub-project E.
- **Press and social** — milestone detection over the same numbers. Lightest, last.

---

## 11. Testing

The resolver carries the risk, so it carries the tests. Pure and dependency-free, covering: ear-tip asymmetry (no volume of "not seen" moves a cat toward *not sterilised*); pregnancy expiry; authority per attribute per role; prompted-versus-volunteered weighting; supersession and retraction ordering; and confidence-level boundaries.

Route tests cover role enforcement on every write, invite acceptance and revocation, staff-only visibility of personal data, and that no public payload leaks addresses, contact details or raw device ids.

Machine-suggestion thresholds are validated against the labelled evaluation set, not asserted.

---

## 12. Implementation phasing

This spec is one coherent design but more than one implementation plan's worth of work. It should be built in four phases, each independently shippable and useful:

| Phase | Contains | Useful on its own because |
|---|---|---|
| **1** | Observation store, resolver, appearance vocabulary, public contribution on the reward screen | The record starts filling from tourist taps immediately, with no accounts and no auth work |
| **2** | Clerk accounts, roles, invites, volunteer cat-page controls, confirmation queue | Crowd claims become confirmable; Syros Cats stop making raw HTTP calls with a shared secret |
| **3** | Guardian endorsement, address and contact fields, consent records, staff-only access scoping | The personal-data work lands as one deliberate, reviewable change rather than scattered fields |
| **4** | Colony clustering and naming, impact queries, targeting view | Reporting and targeting arrive once there is enough data for them to say something true |

Phase 1 carries the design risk (the resolver) and none of the auth risk. Phase 3 carries the GDPR obligations and should not be diluted across the others.

## 13. Open questions for Syros Cats

These need answering by the charity, not by us:

1. **Does the attribute list in §4.1 match what they actually track?** If they keep a spreadsheet, its column headings beat our inference.
2. **Should the feeding map be staff-only?** Recommended default, for two reasons: cat feeders often face neighbour hostility, and known feeding sites attract abandonment — people dump unwanted cats where they know cats get fed, worsening the problem exactly where the charity works hardest. They will know the local temperature better than we do.
3. **Does the role list match the people they have?**
4. **What is their retention position** on guardian and feeder personal data?
5. **Do they have existing sterilisation records** to import as authoritative history?

---

## 14. Explicitly out of scope

- Full TNR case management — trap scheduling, clinic capacity, medical histories beyond §4.1. Flag for trapping, record the outcome, done.
- Payments (sub-project F).
- Public sign-up of any kind.
- ~~Merge and split of duplicate cat records~~ **No longer deferred (28 July, later):** Samuel pulled duplicate-merge forward as a user-facing workflow, alongside litter records with kitten graduation. Both are specified in the charity proposal (§5 "When kittens arrive", §6 "When the same cat gets counted twice") and reuse this spec's claims model: same-cat links are observations that climb the confidence ladder, merges require human confirmation, are reversible, and never delete; litter-attached observations transfer to graduated individuals via the litter link. Split (one entry that turns out to be two cats) remains deferred to sub-project G.
