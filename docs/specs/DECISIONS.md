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

**Not optional, fixed in all cases:** `POST /sightings` is an unauthenticated nearest-neighbour oracle over *exact* coordinates. It must answer from the blurred grid and be rate-limited per device, not per IP. This leaks regardless of what the map draws.

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
- **Safety copy cuts.** Onboarding loses "most of them are fed, watched over and known by somebody" (not necessarily true) and "away from dogs". The litter block loses both "move them if they are in real danger" and "talk to Syros Cats first". The confirmation screen and the acknowledgement email lose the "nobody is on duty, it may be days" framing and the "we will write to you once more" line. User-facing copy says **Syros Cats**, not "the charity".
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
| Privacy policy content, controller, withdrawal route | `email-capture.md` |
| Hosting, photo storage, photo endpoint, migrations | `hosting-and-photo-storage.md` |

**Editorial correction, not a decision:** `team-access-and-welfare-queue.md` independently specified a status-column-plus-audit-log cat record — the exact model the data spine rejects by name. It is struck; the data spine owns the record.

---

## Part 4 — new work these decisions create

- Privacy policy published on catspotters.com (D6).
- Self-service "Delete my data" in the app, plus a delete link in every email and a staff action for the fallback route (F3).
- Disclose the colony-averaging limitation and D4's public unsterilised status to Syros Cats, and record their acceptance (F2).
- Specify the Cloudflare↔API trust boundary; fix the two auth bugs (F5).
- Verification flow for every email entry point (F7b).
- Migration history before the Play clock starts (F6).
