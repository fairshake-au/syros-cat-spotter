# Spec decisions — 3 September 2026

Samuel's decisions on the four September specs and the eight blocking findings from adversarial review. **This document wins over anything in the four specs.** Where a spec still says otherwise, the spec is wrong and is being corrected.

Context: `docs/specs/*.md` are the specs; `docs/specs/reviews/*.md` are the adversarial reviews that produced these questions.

---

## Part 1 — the seven spec decisions

### D1 · Everything stays on Replit for now
Photos stay in Postgres. No object-storage migration before launch, no hosting change. Rationale: build speed.

**Accepted cost, recorded deliberately.** The migration is free *today* because the API has never been deployed and there is no production photo corpus. It stops being free the moment real spotters' photos exist, and it becomes a data-loss-risk migration rather than a no-op. This is a deferral with that cost knowingly accepted — not an oversight. SYC-46 and SYC-47 stay open with a date and owner.

### D2 · Resend, split into two sending identities
Stay with Resend. Two subdomains, two API keys, two quotas:

- **Transactional** — staff sign-in links, welfare reports, report acknowledgements, email verification.
- **News** — "the cat you named was sterilised" and other loop-closing updates.

Separate quotas mean login-form abuse cannot exhaust the allowance that injured-cat reports depend on. Postmark remains the upgrade path if transactional deliverability proves weak on a new domain. Google Workspace SMTP is rejected (would require holding an app password to the charity's whole mailbox). Cloudflare Email Sending is not available on the API's runtime.

#### Amendment, 3 September 2026 — public-user verification moves to the news identity

The list above originally placed **all** email verification on the transactional identity. Samuel has amended that:

- **Verification messages to public app users — every address typed anywhere in the mobile app, including on a welfare report — send from the NEWS identity (`news.catspotters.com`).**
- **Staff sign-in verification stays transactional** (`mail.catspotters.com`), along with sign-in links, welfare reports, report acknowledgements and report outcomes.

Rationale: a verification message goes to a stranger who just typed an address, so it carries the highest complaint and bounce risk of anything this app sends. Keeping it off the transactional identity protects the reputation that staff sign-in links depend on — which is the entire purpose of the split. A verification message delayed by news-list reputation costs one person a small wait; a degraded sign-in reputation costs the charity its dashboard on a bad day.

This closes the open question `email-capture.md` §7.3 raised. That section is now a record of a decision, not a recommendation.

### D3 · The staff dashboard lives on the app's own backend
The welfare queue sits next to the cat data it is about. See F5 for how sign-in reaches it.

### D4 · The app publicly shows when a cat is not sterilised
A confirmed negative reads as *not sterilised* to everyone, not just the team. Samuel's rationale: the app should be honest.

**Consequence to design around:** the public map now says *this specific cat, roughly here, has not been sterilised*, which is a sharper targeting signal than a location alone. It raises the bar on F2 and must be considered when Syros Cats reviews the location limitation.

The rule that absence of a visible clipped tip is **never** negative evidence is unchanged — this decision concerns *confirmed* negatives only, from team entry or imported records.

### D5 · Four loop-closing email moments; no onboarding ask
Ask after a resolved spot, at the visit summary, after a welfare report, and in settings. **No email field during onboarding or first run.** Anonymous use stays the default.

### D6 · Syros Cats is the data controller
- A privacy policy is published on catspotters.com. *(New work — needs a ticket.)*
- **Deletion is self-service in the app first** (see F3) — the charity should not be doing this by hand.
- **hello@catspotters.com** is the published fallback route, for people who lost the device or prefer to ask a human. Staff need a dashboard action to service those, on a legal clock, without Samuel in the loop.

### D7 · Shared passwords retire the day staff sign-in goes live
No period of running two credential models side by side.

---

## Part 2 — the eight blocking findings

### F1 · No urgent alarm. Honest copy instead.
Urgent welfare reports reach the shared inbox and the queue. **Nothing pages a human, by design.** The app never implies anyone is standing by.

Rationale: Syros Cats' stated goal is fewer cats in their own care and more care in the community. An alerting system is a promise of response; promising one nobody has agreed to staff would make the app dishonest in a new way rather than safer.

**Follow-through required:**
- The copy must be unmistakable that **a vet is the fast route**, because nothing else is fast.
- Severity affects **queue order only, never response speed**. The acknowledgement must not imply otherwise.
- Accepted: a report can genuinely sit unseen for two days. This is survivable only because the copy sent urgent cases to a vet first — so the copy is load-bearing, not decorative.

### F2 · 250m grid as specced; colony averaging accepted
Keep the spec's deterministic 250 m grid snapping for public cat locations.

**Not optional, fixed in all cases:** `POST /sightings` is an unauthenticated nearest-neighbour oracle over *exact* coordinates. It must answer from the blurred grid and be rate-limited per device, not per IP. This leaks regardless of what the map draws. *Amended 30 Sep 2026 by Part 2h: matching uses exact positions within 500 m, with the residual risk accepted. The per-device rate limit still applies.*

**Knowingly accepted limitation:** averaging the published positions of ~30 cats in a colony recovers the colony centre to about 45 m — which is the private feeding-site information Syros Cats raised a targeting concern about at the 1 September meeting.

**This is Syros Cats' risk to accept, not ours to absorb silently.** It must be disclosed to them in plain language, alongside D4, and recorded as accepted. *(Needs an agenda item and a ticket.)*

Also correct: the map currently draws a 300 m circle, implying ~4.5× more privacy than the 250 m cell actually provides. Either the circle or the claim must change.

### F3 · Deletion severs the person and keeps the cat data
On request: email, device link, points, and the connection between a person and their sightings are all removed. **The sightings themselves survive, unlinked and anonymous**, so no cat loses its history.

Honest phrasing for the privacy policy: *we delete everything that identifies you; the cat sightings stay, with your name off them.*

Implementation: a redaction/tombstone column on the append-only tables, added **now** — one column today versus a migration across two seasons of observations later.

**Self-service is the primary route.** The app must let people delete themselves, in the app, without contacting anybody. This is the main path, not a convenience:

- A **"Delete my data"** action in settings that severs the person immediately. The device *is* the identity, so no email round trip is needed to prove who is asking — holding the phone is the proof.
- A **delete link in every email** we send, for people who gave an address and later changed their mind about the app itself.
- Clear, non-alarming confirmation before it happens, stating exactly what goes (their points, streaks, spot history, email) and what stays (the cat sightings, unlinked; names they gave cats). It is irreversible and must say so.
- Because the device is the identity, **anyone holding the unlocked phone can trigger it** — hence confirmation, and no way to undo.

The hello@catspotters.com route in D6 remains as the **fallback** for people who have lost the device or would rather ask a human, plus a staff action in the dashboard to service those. Self-service should reduce that to a trickle, which is the point: it saves the charity manual work and removes the risk of a legal clock running out on volunteers who never saw the email.

Cat names given by a deleted user are **kept** (they are shared community property once others use them).

### F4 · Nightly comparison against what we last told them
A daily job compares each cat's current derived status against the last status we notified about, and emails on genuine changes.

- **The baseline is seeded as the historical records import lands**, so importing Syros Cats' existing records never generates "sterilised last week" emails about 2019 operations.
- **No automated death announcements.** Presumed-deceased is reversible by a single sighting; an email you may have to retract is worse than no email.
- Up to a day's delay is acceptable for this message.

### F5 · Cloudflare keeps the front door; the API trusts its token
The existing magic-link sign-in at admin.catspotters.com stays. It issues a token the Express API validates.

**Required work this creates:**
- The trust boundary must be specified properly — token format, signing, expiry, audience, and what the API does when validation fails.
- **Two confirmed auth bugs must be fixed wherever the flow lives:** the enumeration-timing padding does not pad (fixed 400 ms sleep placed *after* an outbound network round trip), and the mail-scanner defence closes the wrong half — the token is consumed on GET, so a link scanner can be the sole consumer and permanently lock a volunteer out.
- The request-a-link endpoint has no rate limit and must get one (see D2 — shared quota with welfare mail).

### F6 · Schema first, then the Play clock; and build real migrations
1. Land **all** September schema work **before** the fourteen-day Google Play closed test begins. The sequencing is what protects the October launch.
2. Stand up generated migrations with checked-in history while doing it, and verify a rollback works.

`drizzle-kit push` with no migration history has already 500'd every endpoint once (`.agents/memory/db-schema-drift.md`). Roughly twelve new tables are coming.

### F7a · Photo endpoint hardened
Unguessable ids, rate limiting, tighter CORS. Photos still load for anonymous users — the app has no login, so they must. Signed expiring URLs were rejected: they fight the offline design, expiring exactly when a spotter is out of signal.

### F7b · Every email entered anywhere is verified
**A general rule, broader than the question that produced it.** Any email address a user types — at any of the four moments in D5, or on a welfare report — receives a verification message and **nothing else is sent to it until they confirm**.

- A welfare report is submitted and confirmed **on screen immediately**, with no friction at the moment someone is trying to help a hurt cat. The emailed acknowledgement and status update follow after verification.
- Rate limits are **retained alongside** verification, not replaced by it: the verification message is itself outbound mail to a typed address. Verification caps abuse (fixed content, one message per address) rather than eliminating it.

### F8 · Safety copy splits by situation
The two rules are not in conflict once separated:

- **Onboarding (healthy street cats):** keep your distance, and why — they are not pets, and it is better for them.
- **Injured-cat flow:** a hurt cat might bite and scratch even when you are helping it. **Borrow a carrying cage from one of the island's vets and lure the cat into it with strong-smelling food.** Only if that fails, and only if it feels safe: a towel over the cat, including its head, and into the cage or a box that closes. Then straight to the vet.

**Amended 4 September 2026.** F8 originally led with the towel. Susan's standard reply (`docs/specs/source/syros-cats-standard-reply.md`, canonical) leads with borrowing a cage from a vet, and that is both safer and the charity's own practice, so it wins. The decision itself — that safety copy splits by situation — is unchanged.

**Line edits, 4 September 2026.** Samuel reviewed the rewritten injured-cat copy and edited it line by line. Those edits are definitive. The follow-through bullet above now matches the copy as it stands in `team-access-and-welfare-queue.md` §5.3b. What he cut, and it is recorded rather than re-argued: the "stop if you cannot do it safely" paragraph, "never bare hands", the line about a bite needing a doctor, "most cats walk in on their own", the Greek word *metaforas* (the vets speak English), and the note that Syros Cats cannot reimburse the vet's bill. "A hurt cat **will** bite" became "**might** bite"; "the vet **will** charge you" became "**is likely to** charge you".

**~~No out-of-hours cover~~, 4 September 2026 — superseded the same day, see below.** SYC-68 was answered "there is no night or weekend vet cover on Syros, and the app deliberately says nothing about it". The two-variant structure in §5.3b was deleted on that basis, and that part stands.

**Out-of-hours: reversed by research, 4 September 2026.** The verification pass on the three clinics (`docs/specs/source/syros-vets-verified.md`) found the opposite of what Syros Cats told us. **Symviosis publishes +30 697 005 5012 on its own website explicitly as the number to ring outside clinic hours**, and **Cyclades Vets advertises 24-hour operation, 365 days a year, on +30 6937 252802**. Those are published claims and nobody has tested them — which is exactly what the app now says. §5.3b names both numbers in one short paragraph and promises nothing: *"We haven't rung them to check, so we can't promise anyone will answer — but they are the numbers to try."* Neither Syros Cats nor the app has arranged anything, and the copy must never imply otherwise. Ringing the two numbers out of hours to find out what really happens is a testing task (§5.4). The reversal is recorded rather than quietly overwritten because the original answer came from the charity, and it may still be right about what happens in practice at 2am.

**The third clinic's name, 4 September 2026.** It is **"Cyclades Vets (George Maragkos)"** everywhere, in that bracketed form. The clinic Maragkos founded in 2012 now trades as Κτηνιατρική Κλινική Κυκλάδων / Cyclades Vets and is part of the Plakentia group; there is no sign saying "Maragkos" to find. But Syros Cats and the island still call it by his name, and so will anyone phoning ahead. Both halves are needed and neither is to be trimmed away.

The copy is no longer "awaiting sign-off" — Syros Cats confirm it during testing (`team-access-and-welfare-queue.md` §5.4).

Wording needs care given it is advice a tourist may act on, but saying nothing is worse — people help anyway, and then do it without guidance.

---

## Part 2b — approval of `team-access-and-welfare-queue.md`, 27–28 September 2026

Samuel reviewed the team-access spec line by line and **approved it on 28 September 2026**, on the basis that these edits are incorporated. Where anything earlier in this document says otherwise, these win.

- **Colony names are editable** by Syros Cats at any time. Everything references a colony by id; earlier names are kept for search and records-import matching. Corrects "colonies have fixed names" in `cat-record-data-spine.md`, which misread the 1 September note "Fixed names exist" (the charity already *has* names; it did not mean they never change).
- **Out-of-hours (supersedes F8's "Out-of-hours: reversed by research" as far as the copy goes).** The urgent block no longer mentions out-of-hours at all. The two published after-hours numbers stay in the vet list (§5.7) as labelled phone numbers unless Samuel says otherwise. **Whether they answer is untested, and Samuel accepts that risk.** No tester or on-island check is required.
- **Safety copy cuts.** Onboarding loses "most of them are fed, watched over and known by somebody" (not necessarily true) and "away from dogs". The in-app litter block (§5.3d) loses both "move them if they are in real danger" and "talk to Syros Cats first". The acknowledgement email's litter variant (§5.3g) keeps "talk to Syros Cats first": that was flagged to Samuel and deliberately left. The confirmation screen and the acknowledgement email lose the "nobody is on duty, it may be days" framing and the "we will write to you once more" line. User-facing copy says **Syros Cats**, not "the charity".
- **Closing emails.** Both closing states send: "Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive." (Done may carry the optional team sentence.)
- **Dr Dermitzaki's clinic is in Livadia, Manna**, not Lazareta. The old Lazareta pin is withdrawn pending a real one.
- **"Report an issue" hides on one report** (supersedes the two-devices-and-two-IPs gate in the spec's earlier draft). An "upsetting or inappropriate" report first asks "Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it", then hides the item from public view pending review. The vandalism risk is accepted, with Turnstile, a volume alert and one-tap restore as mitigations.

## Part 2c — approval of `cat-record-data-spine.md`, 28 September 2026

Samuel reviewed the data spine and **approved it on 28 September 2026**, on the basis that these edits are incorporated. Where anything earlier in this document says otherwise, these win.

- **An owner claiming a cat is evidence it is homed.** Existing claims are backfilled as `homed`; future claims write it at once. The team can set a wrongly homed cat back to Street. Securing the claim endpoint therefore matters more.
- **A vet can mark a cat in care** when it is in their care. Until vets have accounts (SYC-24) the team records it on the vet's word.
- **The records import is optional and after MVP**, split into its own spec (`records-import.md`). What exists is month-by-month WhatsApp groups with scant detail. It is built only if Syros Cats confirm it is worth doing. Without it, *Confirmed* comes from team (and later vet) entries. If it happens, names arrive in English and no Greek–Latin transliteration is needed.
- **The map shows the discovery position**, labelled as where the cat was first spotted and never as where it lives. The derived position is deferred (SYC-80).
- **Colony averaging (F2) accepted by Samuel**, 28 September 2026. Syros Cats' own acceptance is still required (SYC-67).
- **Photos are not kept forever by default.** Samuel rejected the keep-everything outcome; the retention rule is decided in the `hosting-and-photo-storage.md` review, and it applies equally to living and deceased cats.
- **Presumed deceased stays separate from Deceased.** A cat unseen for three years shows "Not seen since…", never "No longer with us". (Samuel's comment proposing otherwise was withdrawn.)

## Part 2d — approval of `email-capture.md`, 28 September 2026

Samuel reviewed the email-capture spec and **approved it on 28 September 2026**, on the basis that these edits are incorporated. Where anything earlier in this document says otherwise, these win.

- **D5 amended: onboarding ends with an optional email step.** It leads with not losing your spots ("Save my spots" and "Skip", equally prominent), with news as a separate, unticked box. Skipping doesn't use up a later ask; ticking news means no news moment asks again.
- **SYC-3 decided: "keep my spots safe".** An opt-in, separately consented restore email that brings a spotter's collection back on a new phone, using the staff sign-in safeguards and telling the old phone. Under-15s are told to use a parent's email. The device key also moves into the phone's secure storage. **The news email still restores nothing.**
- **The "follow this cat" ask appears on the first spot**, named or not.
- **The ask screens no longer promise a frequency.** The fortnight and annual caps are unchanged; the privacy policy still states "a handful of times a year at most".
- **D2 reaffirmed:** two sending subdomains, `mail.` and `news.`.
- **The privacy policy text moves to `privacy-policy.md`**, approved separately.
- **Donor emails are deferred until donations are built** (SYC-1). Working assumption: the payment company keeps them.

## Part 2e — approval of `hosting-and-photo-storage.md`, 28 September 2026

Samuel **approved the hosting spec on 28 September 2026**, with one addition:

- **Photo retention (§6.7): shrink, don't delete.** After 12 months a sighting photo is replaced by a small version (long edge 480 px, about a tenth of the size). Each cat's main photo, any photo backing a sterilisation or ear-tip observation, and welfare-report photos (their own three-year rule) stay at full size. The rule applies equally to living and deceased cats. Chosen over deleting old photos (option 1) and keeping everything at full size (option 3).
- D1 stands: everything stays on Replit, photos stay in Postgres for now, and the move is decided by the dated trigger in §4.2.
- The spec's September/October timeline is stale. Samuel deferred the dates question (SYC-73) on 27 September, so it is left as written, not rewritten.

## Part 2f — approval of `offline-queue-on-web.md`, 28 September 2026

Approved by Samuel after an adversarial review broke v1 (its promise that nothing already queued could be lost was false as designed; the review reproduced three loss paths). v2 was rebuilt on that review and is what was approved.

- **Every queue change goes through one serialised write path** that re-reads storage under a Web Lock, on every platform. This also fixes the pre-existing lost-update bugs on the phone apps (a sync reverting a resolved review, a discard, a replacement or a new sighting).
- **Web photos move to IndexedDB**; the list stays in AsyncStorage. Supersedes `hosting-and-photo-storage.md` §8 **for the web build only**.
- **Before moving anything, the raw queue is backed up** to IndexedDB for 30 days; photos are stripped only after a verified read-back; if the backup fails, nothing moves.
- **Photos never travel through the review route**, in all three places including `ReviewReadyBanner`.
- **R1 accepted:** browsers may clear site storage (Chrome near-full, Safari after seven unused days); the app reports a cleared photo honestly. Testers are told to open the app once they have signal.
- **R2 approved, in this PR:** `POST /api/sightings` returns the existing sighting when the same device sends the same capture time again. No schema change; the gap for server-clamped capture times is accepted and ticketed.
- **R3 accepted:** in-app browsers without usable IndexedDB keep today's inline behaviour, and a failed save says to open the link in Chrome.
- **R4 accepted:** review photos stay on the phone up to seven days.
- **R5 approved:** when sending fails for a network reason while the phone reports a connection, the app offers "Save and send later" and queues the sighting.

## Part 2g — data spine follow-ups from the step 1 review, 29 September 2026

Samuel decided these after the adversarial review of data spine step 1 (#17). All three amend `cat-record-data-spine.md`, and win where it says otherwise.

- **Cat names are unique by a folded form, not by `lower(name)`.** `cats` gains a normalised name column: NFC, case-folded, accents stripped, `ς` folded to `σ`, the same folding as `colonies.normalised_name` (§10.3). The unique index moves onto it. The name as typed is still what everyone sees. The migration lists existing near-duplicates for the team to resolve rather than guessing, and lands before launch while there are few. **Why:** the step 1 tests proved `lower(name)` accepts `ΜΙΜΗ` beside `Μιμή`, and `ΣΟΦΊΑΣ` beside `Σοφίας`, as different cats, so `records-import.md` §2.4's "unique by construction" was false.
- **Deletion unlinks by clearing the column (SYC-63).** `sightings.device_id` and `cats.discoverer_device_id` become nullable. A check allows NULL only on a redacted row, and `cats` gains `redacted_at`/`redaction_reason` like sightings. A cat with no discoverer shows as *"a spotter"* (§8.3). **Rejected:** a fixed "redacted" value, which would create one phantom spotter holding every deleted person's sightings and points. **Also rejected:** a random stand-in id per person, which would keep each deleted person's walk trail grouped together, the thing §8.3 removes. **Corrects §11.2 step 8:** deletion needs this migration; it does not "depend only on step 1's redaction column".
- **System-written observations are authored `account_id = 'system:<source>'`.** Examples: `system:legacy-backfill` (§11.2 step 3), `system:records-import`. The attribution check stays strict: every row has exactly one author. Real account ids are generated and never start with `system:`, and deletion never matches these rows. A welfare report is still authored by the reporter's device, and a report outcome by the staff member's account. **Rejected:** allowing authorless rows, which reopens the gap the review closed. **Also rejected:** a separate author-type column, a migration and a concept for three sources.

## Part 2h — photo matching distance (SYC-39), 30 September 2026

Samuel decided this after a decision write-up on SYC-39 (PR #39) and a direct explanation of the probing risk. It amends `cat-record-data-spine.md` §6.3 point 1, and wins where that section says otherwise.

- **Matching compares a new photo only with cats within 500 m of it, measured on exact positions.** Up to the ten nearest cats within 500 m go to the photo check, nearest first. If none are within 500 m, the app goes straight to "add a new cat". Until SYC-80, a cat's position is where it was first spotted. This keeps the 500 m promise made to Syros Cats (`PRODUCT-SPEC.md` §2.3) and stays in place after the data spine lands: data spine PR 5 keeps it, and the data spine plan's 750 m grid-snapped selection (PR #23, its conflict C3) is superseded.
- **Risk accepted knowingly.** §6.3 explains that answering "is this cat near here?" for a location the caller chooses lets someone narrow down a cat's real position by repeated probing. Exact-position matching with a hard 500 m edge keeps that possible. Samuel accepted this residual risk in exchange for accurate matching.
- **The other §6.3 protections are still required, but are not all live yet.** Point 2: `POST /sightings` already requires the device secret (SYC-92), but its rate limit still counts per IP address (20 per 15 minutes); counting per device arrives in data spine PR 5. Point 3: low-confidence candidates must not return a cat's id or name, and the response must never order or label candidates by true distance. Today only a 0.1 noise floor applies, and the confidence threshold arrives in data spine PR 5. Until then, ties in confidence are broken by cat id, never by distance.
- **This opens no new channel today.** Until blurring ships (data spine PR 6), `GET /cats` already publishes every cat's exact position to anyone, so the probing risk accepted here only starts to matter once the map is blurred.
- **Samuel's risk to accept, not Syros Cats'.** F2 says location risks such as colony averaging are Syros Cats' to accept. Samuel decided on 1 Oct 2026 that this one is his alone. It concerns how the app answers its own matching question, not what the map publishes, and it only matters once blurring ships. It isn't part of the SYC-67 briefing.
- **Rejected:** 750 m on the blurred grid, as the spec said. It only guarantees cats within about 400 m, because snapping can move each position by up to about 177 m, and it breaks the 500 m promise. **Also rejected:** about 850 m on the grid (recommended in PR #39). Samuel judged it overkill.

## Part 2i — approval of `choose-a-different-cat.md` (SYC-119), 30 September 2026

*Lettered 2i because Part 2h (the 500 m matching distance) sits in SYC-39's PR #39, which hadn't merged when this was written.*

Samuel **approved the spec on 30 September 2026**. It covers what happens when the suggested matches miss and the spotter picks the right cat themselves. Where anything earlier in this document says otherwise, these win.

- **The picker.** "Not one of these? Find the cat yourself" opens a list of *cats known around here* (within 1.5 km). The list is always **nearest first by map square** (each cat's published 250 m square), ties broken by SYR number, never by exact distance. Its search box (name or SYR number) and **colour filter** narrow that list. Each cat's colour is read automatically from its main photo by the matching model and stored as a `system:vision` observation. Colours the model isn't sure of are never hidden.
- **Points.** A hand pick earns the same as confirming a suggestion (SYC-38's 15). Nothing is taken back if the team later moves the sighting.
- **Hand picks count straight away** and are recorded, by the server, as hand picks. They go into a low-priority **"Matched by hand"** list on the staff dashboard. It is not the SYC-53 confirmation queue.
- **Two guards that work with nobody looking.** A cat recorded as deceased can't be picked by hand, so a guess never clears a death. And a "clipped" ear-tip answer on a hand pick goes to the top of the *Likely* review list.
- **Who can pick from where (Samuel, 30 September 2026).** Only the Syros Cats team, cat guardians and vets can pick a cat from anywhere on the island, and they do it in the staff dashboard. Every spotter in the app picks only from cats whose published square is within 1.5 km of the sighting's saved location. **The server enforces this** using published positions only, and refuses anything else with one identical message. A cat that isn't nearby goes to **"Ask Syros Cats to match it"**, and the points are paid when the team matches it. Until SYC-53 gives guardians accounts, picking from anywhere is team-only. Vets depend on a vet role that doesn't exist yet (SYC-24, parked).
- **Samuel's answers to the spec's open questions, all 30 September 2026:** flags also show on the cat's dashboard page; 30 days for launch; guardians check hand picks in their own colonies once they have accounts; the nearby-only rule above; a cautious "not sure" cut-off for colour. Nothing is left to ask Syros Cats.

## Part 2j — PR #62 adversarial review findings (data spine PR 1), 3 October 2026

Samuel decided these after an adversarial review of PR #62 (`resolve.ts`, `fold.ts`). All amend `cat-record-data-spine.md`, and win where it says otherwise.

- **B2: `evidenceOfLife` widened to `{at, source, lastSightingAt}`, approved departing from §10.2's exact signature.** The single `{at, source}` shape collapsed every kind of evidence of life into one newest instant, so a welfare report or an ear-tip answer dated after the true clearing sighting hid that sighting from §3.2's "a sighting clears a deceased statement" rule entirely. `lastSightingAt` is now checked on its own for that rule; `at`/`source` still drive the 36-month presumed-deceased threshold. `source` is a typed union (`EvidenceSource`, exported as a const), and both dates are `Date`, not strings — PR 2's `loadCatRecords` must supply `lastSightingAt` and use the exported const (`docs/superpowers/plans/data-spine.md`'s PR 2 section is updated to say so).
- **S2: a death cleared by a sighting keeps `confidence: "confirmed"`.** It is not a weaker claim than an unchallenged death — somebody still said "deceased" and the record of that stays. The gap this leaves (the clearing sighting has no observation id to add to `supportingObservationIds`, because `evidenceOfLife` carries only a date) is flagged for PR 2, not papered over with a guess.
- **J2: a newer photo-backed clipped-tip observation after an authoritative "not sterilised" does not move the public answer, but is flagged to the team.** Flagged rather than decided outright — Samuel wants the team's dashboard to show it rather than the resolver silently dropping it, but whether it should ever move the public answer is a question for the team, not this PR.
- **SYC-101: `foldName` strips invisible formatting characters and collapses whitespace runs to one space, trimmed.** Greek/Latin look-alike letters (`Α` vs `A`) are deliberately NOT folded — deferred to SYC-101 for Samuel to decide, since merging those silently could collapse two differently-spelled cats into one name.

## Part 2k — SYC-43 part 2 plan decisions (dashboard queue and corrections), 5 October 2026

Samuel decided these on the SYC-43 part 2 plan (`docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, PR #73). They amend `team-access-and-welfare-queue.md` and the SYC-42 plan, and win where those say otherwise.

- **Dashboard screens are plain server-drawn pages and forms, with no scripts, for now.** Ready-made admin tools and plugins are to be explored as alternatives (SYC-207).
- **The SYC-43 plan builds the welfare queue** (SYC-42 Slices 2 and 5.1), using SYC-42's approved design. "Use this photo on the cat" (Slice 5.2) waits for SYC-163 (SYC-203).
- **Hiding a photo is recorded in an add-only hide/restore log** (`photo_visibility_events`), not as an observation on the cat. This amends §3.3's "every one of these actions appends an observation" for photo hiding only. The rule's spirit is unchanged: nothing is overwritten, everything is attributed, and a restore is another row. "Report an issue" (SYC-44) writes into the same log.
- **When a cat's main photo is hidden, the public sees its newest visible photo, or the placeholder.** The main photo itself is unchanged, so restoring it brings it back.
- **Renaming a cat keeps today's pattern:** the name column is updated and a signed `name` observation is appended, in one transaction.
- **"Looks right" on the Probably sterilised list records a team `ear_tip { clipped: true }`.** The cat stays *Likely* (a photo is never proof, §4.1) and leaves the review list until a newer spotter answer arrives.
- **People who leave are marked as left, not deleted, and dashboard attribution is a strict database link to `people`.** This amends §2.9 and §10. "Removing somebody… one deletion" becomes **"marking somebody as left, one action in one place, takes effect at their next request in both systems"**. A person marked as left can't sign in, and their open sessions end. Their name stays on everything they did. Adding their address again brings back the same person. Hard deletion remains only for someone with no history (a mistaken add). Forgetting a former staff member's details is done by anonymising, never by deleting (SYC-208). Samuel chose this over storing ids without a link, after being shown that a strict link with deletion would make anyone who had ever touched a report impossible to remove.
- **The dashboard's mail-failure banner counts a failed alert only while its report is still open** (6 Oct 2026, on PR #82). This amends §8.3's "persistent send failure raises a dashboard banner" as the SYC-43 part 2 plan wrote it ("any alert … `failed`"). A failed alert never clears, so the plan's rule would keep the banner up for ever after one failure. An alert unsent an hour after it was due still raises the banner whatever its report's state. The report's own "Email to Syros Cats: Failed" line stays as the record.

## Part 2l — approval of `add-details-later.md` (SYC-117 part 2), 5 October 2026

Samuel **approved the spec on 5 October 2026**. It lets a spotter come back to a cat's page and add details about their own sighting of it. Where anything earlier in this document, `cat-record-data-spine.md` or the data spine plan's PR 7 says otherwise, these win.

- **Who:** only people who spotted the cat, and what they add is tied to their own sighting (its photo and the date it was taken). Not a free box for anyone (Decision 1, as recommended).
- **How long:** a month after the photo was taken, for all three questions (Decisions 2 and 4). This replaces PR 7's 24 hours after the match. **Food and water too (Decision 4 → B, not the recommendation)**: answers carry the photo's date, so the team reads them in the order the cat was actually seen.
- **Changing an answer (Decision 3 → B, not the recommendation):** on the cat's page, a spotter can replace their own ear-tip answer. Only their own, only from a sighting of the cat in the last month, and never once Syros Cats have checked it. The old answer is kept, marked replaced. The reward screen still never asks about the same cat's ear twice (Q3 → B stands for the asking).
- **Where:** the cat's page only, for now (Decision 5, as recommended).
- **Each question once per sighting** replaces PR 7's "one set of answers per sighting".

## Part 2m — Greek and Latin look-alike letters in cat names (SYC-223), 6 October 2026

Samuel decided this after SYC-101 (#92), which left it open (Part 2j). It amends Part 2g's folding, and wins where anything earlier says otherwise.

- **For launch, Greek and Latin look-alike letters stay separate in cat names.** `ΑΓΑΘΗ` and `AΓAΘH` (Latin `A` and `H` typed for Greek `Α` and `Η`) are two different names, and `cats_normalised_name_unique` accepts both. `foldName` and the database's folded column fold accents, case and final sigma only (Part 2g). **Why:** production has 28 cats, all with plain English names, so this hasn't happened; the SYR number already tells two cats apart; and silently merging look-alikes could refuse a genuinely different name, the surprise Part 2j decided against.
- **If it ever happens, warn instead of refusing** (SYC-227): when a new name differs from an existing one only by look-alike letters, the app asks "There's already a cat called ΑΓΑΘΗ. Is this them?" (SYC-119's existing screen), and the spotter can still go ahead. **Rejected:** folding look-alikes into the unique index, which blocks real names a spotter never meant to copy.

## Part 2n — approval of `coat-markings-and-health.md` (SYC-2) and its plan, 12 October 2026

Samuel **approved `coat-markings-and-health.md` and its implementation plan (`docs/superpowers/plans/syc-2-coat-markings-and-health.md`) on 12 October 2026**, answering the plan's five decisions as recommended (A1, B1, C1, D1, E1). Where anything earlier in this document, `cat-record-data-spine.md` or `choose-a-different-cat.md` says otherwise, these win. The data spine's §3.4, §10.1, §10.2 and §10.7 and `choose-a-different-cat.md` §8.4 are amended to match.

- **Health is three things, not one status.** On the cat page: what the record already shows (sterilised, ear tip, life status), and nothing about vaccination or condition. Vaccination is team-only at launch; donors see an overall count, computed automatically and never a cat. The vaccine list is rabies, the core cat flu and enteritis combination, and others by name (no brand). Condition is a team-only note on the cat. There is no "Looks healthy" badge, ever.
- **"Needs vet" is never a public filter or label.** The urgent route ("This cat needs help") is the only public way to say a cat is in trouble, and nothing replaces or delays it.
- **Spotters suggest appearance; the team and cat guardians state it.** This amends `choose-a-different-cat.md` §8.4: it said "a person's reading always beats the machine's"; it now says **a single spotter fills a gap but never overturns a machine reading; two independent spotters (different devices, photos and days), a cat guardian for her own cats, or the team do.** (SYC-161's wording is updated to match.)
- **Markings and colour are never evidence of life and never notifiable.**
- **The ear tip is not a marking.** It stays its own question with its own rules.
- **Vaccination is stated only by the team (`set_vaccination`) and is not public per cat.** If it is ever made public: the vaccine is never named, and "If a cat bites or scratches you, see a doctor." sits beside it in all three languages.
- **Health and vaccination are never written through the old shared-password care route** (`cat_updates`).
- **A team-only note on the cat** (`team_note`) is a new observation kind in the data spine, gated by `view_health_notes` and `add_health_note`. Welfare-report notes are unchanged.
- **The four capability names** (`set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`) are the roles spec's. `coat-markings-and-health.md` adds none. Volunteers and staff are one role (the Syros Cats team), so there is no `confirm_appearance` and no volunteer rule.
- **The colour and marking words are the fixed lists in `coat-markings-and-health.md` §3.** No free text.

The plan's decisions, as answered:

- **A1: order of work.** SYC-2's rules, the public `coat` and `markings` fields and the team's screens come first; then SYC-161 (the machine reading, which is urgent); the spotters' questions come after SYC-161.
- **B1: the vaccinated count.** "N cats vaccinated this year" is built now and shown on the Help tab under the campaign, nothing below five cats, number and year only.
- **C1: the old care route.** `POST /cats/:catId/updates` refuses `general` now; `desexed` and `adopted` stay until SYC-185 retires the route.
- **D1: chip pictures.** One consistent set of simple drawn pictures for the colour and marking chips, reviewed by Samuel in the browser check; the torn ear is drawn and shown beside the real ear-tip photo.
- **E1: two colours on the cat's page.** Joined with " · " in every language ("Ginger · Tabby · White paws"), with no grammar to get wrong.
- **Who wins on colour and markings (13 October 2026).** Decision G from the roles plan (vet > owner > cat guardian > team) applies to appearance with one carve-out: vets, imported records and owners have no standing on colour or markings (owners until SYC-130 decides). So a cat guardian's statement outranks the team's whatever the dates, and the newest wins only within a level. The team overrules a guardian by pressing **Correct**, which marks her statement wrong and records the team's answer in one step, with a reason, on the recent guardian changes list. Samuel considered letting the photo-reading model referee guardian–team disagreements and chose not to: people decide, the machine stays below them (in keeping with §4.2 rule 1 of `coat-markings-and-health.md`, where a later machine reading never overrides a person's statement).

## Part 2o — approval of `feeding-sites-and-colonies.md` (SYC-209), 12 October 2026

Samuel **approved the spec on 12 October 2026**. It specifies the feeding-site map and the colony screens on the team dashboard, and the public site card. Where anything earlier in this document, `cat-record-data-spine.md` or `team-access-and-welfare-queue.md` says otherwise, these win.

1. **Feeding-site map and colony screens are specified in `feeding-sites-and-colonies.md`.** Ownership table: that document owns the screens and the public site card; the data spine still owns the records, privacy and precision; `roles-and-invites.md` owns the capability names.
2. **A public site has a separate, required public label.** The internal name (which follows the "place — guardian" convention) is never published.
3. **Making a site public takes a confirmation page, a preview of what visitors see, and a recorded "the cat guardian knows" tick.** There is no bulk action and no import that sets visibility. It needs a named guardian, and is re-confirmed when the guardian or the colony changes.
4. **Moving a public site makes it private until reconfirmed, and gives it a new public code. Retiring removes it from public view and retires its code.**
5. **Nothing from `colonies` is public.** Not names, guardians, centres, notes or exact counts. (The one derived exception is the rough band on a public site's card, entry 11.)
6. **Every change to a site or colony is recorded in an add-only history** (`mapping_events`), linked to the people list, with a redaction path for a guardian's name.
7. **The public sites endpoint returns an opaque code, label and position only**, ordered by code, identical for every caller, with a short shared-cache lifetime. A lookup for anything not currently public, or for a superseded code, answers identically to an unknown code.
8. **Cat guardians can create colonies and become their guardian automatically; renaming afterwards is the team's.** (*Updated after Samuel's roles decisions (12 Oct 2026)*, reason: a guardian who finds an unrecorded place should be able to record it. Accepted risk: she could create a colony anywhere and add cats to see their positions; every change is in the history and the team's dashboard lists recent guardian changes.)
9. **A guardian decides alone which cats are in her colonies, adding and taking out, with immediate effect.** `assign_cat_to_colony` is held by guardians for their own colonies; `propose_colony_change` no longer exists. (*Updated after Samuel's roles decisions (12 Oct 2026)*, reason: the team should not be a queue for a guardian's own cats.)
10. **A guardian's phone may hold her colonies' data, exact feeding-site positions included, for 72 hours from her last online load by server time, deleted on next open, with `Clear-Site-Data` on sign-out and removal.** This replaces "directions in words, no coordinates". The "how to find it" line is optional. (*Updated after Samuel's roles decisions (12 Oct 2026)*, roles Decision 12.)
11. **A public site's card shows a rough count, "About N cats use this spot", in five bands, counting cats in the site's colony that are alive and seen in the last 12 months; never the exact number, never names, photos or a list.** (*Samuel, 12 October 2026, Decision 3.* Accepted: it tells anyone how many animals are at one exact place, and invites looking for them, §4.6.)
12. **The team's own dashboard pages are English only.** (*Samuel, 12 October 2026, Decision 9.*)
13. **The public card asks visitors to give the cats room, not leave food, and see how they can help.** (*Samuel, 12 October 2026, Decision 13.*)

## Part 3 — spec ownership, to stop the specs drifting apart again

The four specs were written independently and contradicted each other in fourteen places. Each area now has exactly one owning document. A spec that needs another's behaviour **references it and does not restate it**.

| Area | Owner |
|---|---|
| Cat record model, observations, status derivation, presumed-deceased | `cat-record-data-spine.md` |
| Location blurring, the nearest-cat oracle, feeding-site privacy | `cat-record-data-spine.md` |
| Records import and matching (optional, post-MVP; split out 28 Sep 2026) | `records-import.md` |
| Deletion mechanism (F3) | `cat-record-data-spine.md` |
| Sign-in, trust boundary, roles | `team-access-and-welfare-queue.md` |
| Staff dashboard, welfare queue, report flow | `team-access-and-welfare-queue.md` |
| Capacity and safety copy (F1, F8) | `team-access-and-welfare-queue.md` |
| The four email moments, consent, verification (F7b) | `email-capture.md` |
| The nightly notify job (F4) | `email-capture.md` |
| Privacy policy text (split out 28 Sep 2026, approved separately) | `privacy-policy.md` |
| Controller, withdrawal route, the email facts the policy states | `email-capture.md` |
| Feeding-site screens (the map, one site, adding, moving, retiring), the Colonies page, and the public site card (approved 12 Oct 2026). The records, privacy and precision stay with the data spine; the capability names stay with `roles-and-invites.md` | `feeding-sites-and-colonies.md` |
| Hosting, photo storage, photo endpoint, migrations | `hosting-and-photo-storage.md` |
| Offline queue writes on every build; web photo storage; review-route photo handoff; sighting dedupe (approved 28 Sep 2026) | `offline-queue-on-web.md` |
| Picking a cat by hand when matching misses: the picker, its colour filter, hand-pick points, the "Matched by hand" review (approved 30 Sep 2026). The records it relies on (the match record, moving a sighting, the `coat` observation) stay with the data spine | `choose-a-different-cat.md` |
| Who may say a cat lives with them, the "This is my cat" and let-go screens, and removing an owner (approved 8 Oct 2026). What a claim records and what an owner sees stay with the data spine | `claiming-a-cat.md` |
| Coat and marking vocabulary, what "health" means, what is public about it | `coat-markings-and-health.md`. The observation kinds and resolver rules for them stay with `cat-record-data-spine.md` |

**Editorial correction, not a decision:** `team-access-and-welfare-queue.md` independently specified a status-column-plus-audit-log cat record — the exact model the data spine rejects by name. It is struck; the data spine owns the record.

---

## Part 4 — new work these decisions create

- Privacy policy published on catspotters.com (D6).
- Self-service "Delete my data" in the app, plus a delete link in every email and a staff action for the fallback route (F3).
- Disclose the colony-averaging limitation and D4's public unsterilised status to Syros Cats, and record their acceptance (F2).
- Specify the Cloudflare↔API trust boundary; fix the two auth bugs (F5).
- Verification flow for every email entry point (F7b).
- Migration history before the Play clock starts (F6).
- Offline queue on web: single write path, IndexedDB photo store with backup-first migration, route handoff, sighting dedupe, "Save and send later" (`offline-queue-on-web.md`, PR #9).
- Cat names unique by a folded form, with a migration that surfaces existing near-duplicates, before launch (Part 2g).
- The deletion migration: nullable device columns with a redaction check, plus `cats` redaction columns (Part 2g, SYC-63).
