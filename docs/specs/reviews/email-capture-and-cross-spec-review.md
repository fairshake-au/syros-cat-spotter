# Adversarial review — email capture, and the four specs read against each other

**Date:** 3 September 2026
**Reviewer:** independent adversarial pass (no authorship of any of the four specs)
**Targets:** `docs/specs/email-capture.md` (primary) · `docs/specs/hosting-and-photo-storage.md` · `docs/specs/cat-record-data-spine.md` · `docs/specs/team-access-and-welfare-queue.md`
**Also read:** `CLAUDE.md` · `docs/PRODUCT-SPEC.md` · `docs/DEPLOYMENT.md` · `threat_model.md` · `.agents/memory/anonymous-device-identity.md` · `.agents/memory/device-secret-auth.md` · `artifacts/api-server/src/` (middleware, routes, deviceAuth, imageValidation)

This document finds fault. It does not summarise what the specs get right. Findings are split **CONFIRMED** (verified against spec text or code, quoted) and **PLAUSIBLE** (a real risk, but resting on an inference the specs leave open).

---

# Part A — attacking the email-capture spec

Ordered most severe first.

---

## A1 · CONFIRMED — Deletion is promised in a system that is architecturally incapable of deleting

**What is wrong.** §5.3 promises deletion "end to end", including item 4: *"If they want the spotting data gone too, that is a separate, also-available action ('delete everything from this device')."* It also promises (§7) that the consent-events table is **append-only**, while §5.3 item 1 deletes "the consent record's identifying parts" and §5.4 retains a "minimal, non-identifying" consent record after deletion. Deleting fields out of an append-only table is an update to an append-only table.

Worse, the thing the user is offered — erasing their device's data — is owned by the data-spine spec, which states the opposite: *"Rows are inserted and never updated or deleted. A database trigger or repository-level guard enforces this; the API layer exposes no update or delete path"* (`cat-record-data-spine.md` §9.1). Observations carry `deviceId`. Sighting notes (`kind: note`) are free text that the same spec says *"may contain personal information (a person's name, a doorway)"* (§7.1).

**Consequence.** The first erasure request — from a user, or under GDPR Art.17 — cannot be honoured as written. Either the promise in §5.3 item 4 is false at the moment it is made, or the delete guard on `observations` is bypassed in an emergency, which is exactly the guard that protects the evidence trail funders will be shown. Both outcomes are bad, and one of them is the kind of thing a journalist asks about after §5.5 has been quoted back at them.

**Fix.** Decide the erasure mechanism now and write it into both specs:
1. Name the only two legitimate patterns for an append-only store — **crypto-shredding** (personal fields encrypted per device, erasure = destroying the key) or an explicit, audited **redaction observation** that blanks `value.text` and nulls `deviceId` while preserving the row's shape and its contribution to derived status.
2. Say precisely what "delete everything from this device" does and does not remove. A named cat, a photo of a public street and a derived sterilisation status are arguably not the user's to erase; the note they typed and the device linkage are.
3. Remove the phrase "the consent record's identifying parts... are deleted" or replace the append-only consent table with an append-only table plus a redaction event.

---

## A2 · CONFIRMED — The core promise ("your cat was sterilised") has no trigger it can actually fire on

**What is wrong.** §4.1 fires cat news on *"a care event on a cat you follow: sterilised, found a home, spotted after a long gap, life status changed"*, batched by a scheduled job (§7 Batching: *"a scheduled job that groups events per person per fortnight"*).

The data spine deliberately removes the thing that job would read. Status is **derived on read** and never stored (`cat-record-data-spine.md` §2, Option C chosen; Option D — the cached column — explicitly *"We do not build it now"*). Presumed-deceased is likewise *"Derived, never stored"* (§3.3), with the nightly-job option rejected. So there is no row anywhere that changes when a cat's sterilised status becomes *Confirmed*. There is only an observation insert, whose effect on the resolved status depends on what else is in the log.

**Consequence.** The email job cannot detect "a cat's status changed". It can only detect "an observation was inserted", which is a different thing — an ear-tip observation on an already-confirmed cat is not news, and an import row applied to a cat already marked *Likely* **is**. To do it correctly the job must re-resolve every followed cat every fortnight and diff against a remembered previous value — which is the materialised cache the data spine rejected, reintroduced by the back door, unspecified, owned by neither spec.

**Fix.** One of: (a) the data spine adds a narrow `derived_status_snapshot` table written by the email job (not by the resolver) purely for change detection, stated as a consumer-owned cache rather than a source of truth; or (b) email capture drops "status change" as a trigger and fires only on a **whitelist of observation kinds with a confirming role** (`sterilised: true` from vet/staff/admin/import; `life_status: homed`), accepting that it will occasionally re-announce. Either way, name the owner. Right now both specs assume the other one has it.

---

## A3 · CONFIRMED — "No rate limiting anywhere" is factually wrong, and the mitigation it justifies is the weakest of the three available

**What is wrong.** §5.6 and Risk 4 both assert the API *"today has **no rate limiting anywhere**"*. It does. `artifacts/api-server/src/middlewares/rateLimit.ts` defines `aiLimiter` (20 requests / 15 min, per IP), applied in `routes/sightings.ts` and `routes/cats.ts`, with a dedicated test at `routes/rateLimit.test.ts`, and `app.ts` sets `trust proxy: 1` so `req.ip` is the real client. The spec is quoting `threat_model.md`, which is stale. The team-access spec knows this — it says *"Rate limit per device and per IP on the same basis as the existing AI-backed endpoints"* (§8.4) — so two specs written on the same day disagree about the codebase.

**Consequence.** Two: the argument for this endpoint's limits rests on a false premise and will be questioned; and the existing, tested primitive goes unnamed, so the build re-invents it.

**Also wrong within the mitigation.** §5.6 and Risk 4 put **per-device** limits first. Device ids are client-generated and unguessable but **free** (`.agents/memory/device-secret-auth.md`); an attacker mints a new one per request. Per-device limiting is a courtesy control against a buggy client, not an abuse control. The load-bearing controls are per-IP, per-address, and the global daily ceiling.

**Fix.** Correct the factual claim, cite `middlewares/rateLimit.ts`, reorder the mitigation to per-IP + per-address + global ceiling, and note that per-device is diagnostic only. Refresh `threat_model.md` while you are there — §5.6 already commits to revising it.

---

## A4 · CONFIRMED — The confirmation email is itself the abuse vector, and double opt-in does not close it

**What is wrong.** §3.6 claims double opt-in buys *"nobody can sign up someone else's address"*. It buys nobody being **subscribed** to someone else's address. It does not stop us **sending mail** to someone else's address — the confirmation email goes out before any consent exists, to whatever string was typed. The capture endpoint is therefore an unauthenticated "send an email from a charity's domain to an arbitrary address" API. That is the classic email-bombing amplifier, and it is worse than burning quota (Risk 4's framing) because the complaints land on `catspotters.com` — the same domain the team-access spec uses for **staff sign-in links** (see B2).

**Consequence.** A modest script produces thousands of unsolicited confirmation emails from the charity, spam complaints against the sending domain, and — because sign-in shares that domain — Syros Cats locked out of their own dashboard at the moment they need it.

**Fix.** Ship with the endpoint: a per-address global cap on unconfirmed sends (one confirmation per address per 24h, three lifetime before hard suppression), a per-IP cap, a global daily send ceiling that fails closed with an alert, and — because the client is a mobile app — a proof-of-work or attestation on the capture call rather than relying on the device id. State that the suppression hash (§5.3 item 2) also suppresses *confirmation* sends, not just news.

---

## A5 · CONFIRMED — Declining does cost something, and the spec contradicts itself about it

**What is wrong.** §2.3: *"Declining is a single tap, is remembered, and produces no penalty, no nag badge, no reduced feature."* §3.3, on the visit summary: *"'Not now' here rather than 'No thanks'... but it still counts as a decline against the two-ask cap."* §2.4: after two declines the app stops asking anywhere except Settings, **permanently**.

So a tourist who declines at their first named cat and then declines a welfare-report ask has silently burned the visit-summary moment — the spec's own second-best capture point, and the one §1.2(C) says *"captures the people who declined at (A) because they were in a hurry"*. Declining costs the user the thing they were most likely to want.

**Consequence.** The two rules are individually sensible and jointly self-defeating. The design's stated second-chance mechanism is unreachable for exactly the cohort it was designed for.

**Fix.** Exempt purpose-specific asks from the global cap. The welfare-report ask (§3.4) is transactional — its address is used for that report and expires with it (§5.4) — and should not consume a news-consent ask at all. Cap news asks at two (A/B + the summary); let the report ask stand outside it. Say so in §2.4.

---

## A6 · CONFIRMED — The two-ask cap cannot be enforced by a system whose identity resets on reinstall

**What is wrong.** §2.4 states hard frequency limits ("at most two asks in total in a person's first fourteen days", "after two declines... Permanently"). §6.4 already concedes that reinstalling changes the device id and the app *"no longer knows the new install is the same person"*. The spec applies that concession only to the address, not to the decline record.

Three separate holes:
- **Reinstall resets the counter.** Someone who declined twice and reinstalls gets asked again, from zero.
- **Storage location is unspecified.** If declines live only on the device, the cap is a client convention and any future client bug or reinstall breaks it. If they live server-side, they are keyed on device id and reset anyway — and a decline record is now a server-side behavioural record about someone who explicitly declined to be recorded.
- **"First fourteen days" is undefined after day fourteen.** Does the counter reset on day 15? The spec never says, and §2.4's second bullet ("after two declines... permanently") implies it does not, which makes the fourteen-day framing meaningless.

**Consequence.** The frequency discipline is the honesty guarantee behind §2.3 and §5.5's journalist answer. As written it is a best-effort client behaviour described in absolute language.

**Fix.** Say plainly: declines are stored on the device, the cap is best-effort, a reinstall resets it, and that is acceptable because a reinstall is rare and the ask is dismissible. Drop "permanently" or qualify it as "on this install". Delete the fourteen-day window or define what happens at its end.

---

## A7 · CONFIRMED — The visit-summary trigger fires when the user is least likely to be there

**What is wrong.** §1.2(C) describes the detection rule as *"several days of activity followed by a few quiet days, or the person opens the app after leaving the island"*, and §8.2 recommends *"shown late rather than early"*.

A tourist's trip is 5–9 days (§1.1). "A few quiet days" after activity ends means the prompt becomes eligible **after they have gone home** — and §1.1's own table says of tourists: *"Push notification instead? Useless — the app gets deleted."* The card only renders on an app open. The spec has defined the highest-value tourist moment so that it requires an app open that its own analysis says will not happen.

**Consequence.** The moment that "captures the people who declined at (A)" will convert far below the "high" estimate in §1.2(C), which in turn undermines the volume assumptions behind Risk 1.

**Fix.** Trigger on a signal available while the person is still on the island and still opening the app: the second or third day with spots, or a day with spots followed by one quiet day, or on any app open where the last spot is more than 24 hours old **and the device is still on Syros**. The spec's own reassurance applies — *"worst case it shows a summary early, which is harmless"* — so bias much earlier than §8.2 recommends.

---

## A8 · CONFIRMED — Risk 1's mitigation is aspirational at the point where it matters most: the records import

**What is wrong.** Risk 1's mitigation is *"Do not turn on a capture moment until the message behind it can actually be sent."* That is a real gate for the report-update ask. It is not a gate for the cat-news ask, and the spec never confronts the one event that will dominate the first six months of "confirmed sterilisation" data: the historical records import (`cat-record-data-spine.md` §5), which lands *"the single biggest injection of Confirmed data the app will ever receive"* in one batch.

Nothing in §4 excludes observations with `provenance: "import"`, or with an `observedAt` years in the past, from the cat-news job.

**Consequence.** Two failure modes, both live on day one: a subscriber receives *"Agatha was sterilised"* about an operation performed in 2019; or the import fires a mass send that trips every deliverability control on a cold domain (A9). Both convert the product's best moment into its worst, which is precisely what Risk 1 says it is trying to prevent.

**Second gap in the same risk.** The mitigation *"review send volumes a month after launch and pull any moment that isn't paying out"* addresses future collection. It does nothing for addresses **already collected under a promise** that turned out to be unfundable. Pulling the moment does not discharge the obligation.

**Fix.** State explicitly that the cat-news job ignores `provenance: import` and `legacy`, and any observation whose `observedAt` is more than N days before `created_at`. State what happens to already-collected addresses if a moment is pulled: a single honest "we're not going to be able to send you what we promised — here's how to delete your address" message, sent once.

---

## A9 · CONFIRMED — Deliverability: the domain is shared with staff sign-in, and nobody owns the reputation

**What is wrong.** §7 requires *"SPF, DKIM and DMARC on the Cat Spotters domain"*. `team-access-and-welfare-queue.md` §8.2 verifies *"the sending domain `catspotters.com`"* for staff sign-in links, welfare reports and issue reports. `docs/DEPLOYMENT.md` line 48 already commits to Resend on the new domain. Cat news is scheduled, batched, consumer-inbox, marketing-shaped mail with an unsubscribe link. Staff sign-in is a security-critical transactional link with a fifteen-minute life.

Nobody in any spec proposes separating them.

**Consequence.** A complaint rate on cat news degrades the reputation of the domain that delivers **sign-in links**. The failure mode is "Susan can't get into the dashboard because a tourist marked a cat email as spam", and it is silent — team-access §2.1's whole design rests on the link arriving. Risk 3 in email-capture and Risk 2 in team-access describe halves of this and neither names the interaction.

**Fix.** Split subdomains before the first send: `mail.catspotters.com` (or `auth.`) for transactional sign-in and report mail, `news.catspotters.com` for cat news, separate DKIM keys, separate Resend audiences/domains. DMARC on the parent with an explicit policy value (start `p=none` with rua reporting, move to `p=quarantine` before launch). Add "sign-in deliverability is not affected by news complaints" to the launch-day check. **Owner: needs assigning — currently neither spec owns it.**

---

## A10 · CONFIRMED — No processor, transfer basis, controller or privacy notice, with a September store deadline

**What is wrong.** §5.5's quotable claim is *"we don't share it with anyone but the mail service that delivers the message"*. That mail service (Resend, per team-access §2.3) is a processor, almost certainly US-hosted, handling EU residents' personal data for a Greek charity. No spec names a DPA, a transfer mechanism, a sub-processor list or a retention setting on the provider side — while §7 makes provider-side deletion a hard requirement (*"a provider that keeps a copy we cannot delete makes §5.3 a lie"*) without checking that the recommended provider satisfies it.

§8.2 open question 3 leaves the **data controller** undecided. `docs/DEPLOYMENT.md` line 16 requires a privacy policy on the new domain **at store submission**, covering photos, location and the new optional email collection, plus the Syros Cats ↔ Fair Shake data agreement.

**Consequence.** The controller question is not an open question, it is a blocker: the privacy notice, the store listing, the DPA signature and the deletion route all name a legal person, and store submission is inside the launch window.

**Fix.** Promote open question 3 to a dated blocker with a decision owner. Add to §7: named processor, DPA signed, transfer mechanism recorded, provider-side deletion capability **verified by test** not assumed. None of the four ask screens (§3.1–3.5) currently links to a privacy notice or names who holds the address — GDPR Art.13 requires the controller's identity at the point of collection. Add the link.

---

## A11 · CONFIRMED — The device-identity boundary holds on paper but the visit-summary email walks around it

**What is wrong.** §6 is a well-argued boundary and I could not break it through the auth path — reading or writing an address requires `X-Device-Secret` (§5.6, consistent with `deviceAuth.ts`), and no email appears in an auth path. The leak is in the **payload**, not the credential.

§3.3's visit summary offers to email *"your cats — names, photos, where you met them"*. §6.2 says the visited-cat list is *"closer to a location history than to a score"* and is the reason email must never be a recovery key. The spec then emails that same list to an address whose only verification is a double opt-in click — which a curious wrong recipient of a mistyped address will happily perform.

Second, §6.4's fix — *"recognise the address on the mail side, don't double-send news about the same cat to the same address"* — requires the mail system to hold an address→followed-cats map spanning devices. That is a cross-device profile keyed on email, and it sits awkwardly beside §5.5's *"We don't build a profile from it"* and §6.1's *"we do not merge them"*.

Third, the user expectation question is unanswered in the product, not just the spec. Nothing the user ever reads says "this will not get your cats back if you lose your phone." Someone who typed their address at three moments will reasonably assume otherwise.

**Consequence.** The strongest privacy claim in §5.5 has two counter-examples inside the same document, and the "email is not an account" line will look like a technicality to anyone who reads §3.3 and §6.4 together.

**Fix.**
- Send the visit summary **only after confirmation**, never in the confirmation email itself, and with **blurred** locations (see B7) — "cats you met near Vaporia", not coordinates.
- Rewrite §6.4's dedupe so it works on `(address, cat)` send-suppression only, and state explicitly that no per-address aggregate is stored, queryable, or exportable, and that the dedupe table is not a profile because it carries no timestamps of activity. If that is not achievable, drop the dedupe — a duplicate email is a smaller cost than the claim it breaks.
- Add one line to the settings row and the confirmation email: *"This is a forwarding address, not an account — it won't restore your cats on a new phone."*

---

## A12 · PLAUSIBLE — Children, and the Greek age of digital consent

**What is wrong.** Risk 7 names the problem and mitigates it with *"v1 asks for an address only where the promise is cat news; no name, no age, no profile"*. That is a data-minimisation argument, not a lawful-basis argument. Greece sets the age of consent for information-society services at **15** (GDPR Art.8 national derogation). The product ships publicly in October and its own MLP plan (`PRODUCT-SPEC.md` §3 item 7) targets school cohorts.

**Consequence.** A ten-year-old typing an address into the strongest-converting moment in the app is not a Boundless-programme problem to revisit later; it is a launch-day problem in the base product.

**Fix.** Either add a neutral, non-creepy age affirmation on the ask ("I'm 15 or over" as an unticked box is a form, which §2.2 rules out — so more likely a single line in the ask copy stating the minimum age, plus a documented policy of deleting on notification), or accept the position and write it down with reasoning and a named decision-maker. Do not leave it as "revisit before Boundless".

---

## A13 · PLAUSIBLE — Copy problems

- **Gendered pronouns with no gender data.** §3.1 uses *"You named her... how she gets on"*. The data spine says `Sex` is *"Left unknown"* when missing from records (§5.1) and is not collected from spotters. Greek and French require grammatical gender throughout. Either gender is derived from a field that is usually empty, or the copy is wrong for roughly half the cats, in three languages.
- **User-supplied cat names in outbound charity mail.** §5.6 correctly requires escaping. It does not address a name that passes the offensive-language filter but is still unsuitable, leaving the charity's domain sending it. The moderation filter exists (`routes/cats.moderation.test.ts`); its threshold was tuned for in-app display, not for a charity's outbound mail.
- **"A few times a year at most, and nothing else" (§3.1)** is a promise the §4.2 caps allow (max one per fortnight = up to 26/year). The copy and the system do not agree, despite §4.2 claiming *"the promise and the system agree"*. Either lower the technical cap or change the copy.
- **Non-expiring delete tokens** (§7) mean any forwarded or archived email lets a third party delete the recipient's subscription. Low harm, but it is a stated design choice that should be stated *as* a choice.

---

# Part B — contradictions and gaps between the four specs

Ordered most severe first. Each names the specs in conflict.

---

## B1 · CONFIRMED — **The most serious contradiction.** Three specs promise deletion; one forbids it, and a fourth architecture makes the promise undeliverable

**Specs in conflict:** `email-capture` ↔ `cat-record-data-spine` ↔ `team-access-and-welfare-queue`

| Spec | What it promises |
|---|---|
| email-capture §5.3 | Address, consent record's identifying parts and queued mail **deleted, not flagged**; plus a separate "delete everything from this device" action |
| email-capture §7 | The consent-events table is **append-only** |
| team-access §8.5 | Reporter email addresses are *"deletable on request — one-click from every message we send"*, on `welfare_reports` rows that also carry the photo, exact lat/lng and free text |
| data-spine §11 risk 7 | *"real deletion"* for notes and guardian details |
| data-spine §12 Q6 | Notes are *"deletable on request"* |
| data-spine §9.1 | *"Rows are inserted and never updated or deleted. A database trigger or repository-level guard enforces this; the API layer exposes no update or delete path."* |

The data spine contradicts **itself** (§9.1 vs §11.7 and §12.6) and contradicts the other two specs. Sighting notes are observations. Notes may contain a third party's name and a doorway (§7.1). Observations carry `deviceId`.

**Consequence.** Erasure is promised in three user-facing places and is architecturally blocked in the table where most of the personal data will actually live. The first request forces either a broken promise or an emergency bypass of the guard that protects the evidence trail. And there is no single owner: each spec assumes another one holds the erasure mechanism.

**Fix.** One decision, written into the data spine and referenced by the other two: **crypto-shredding or an audited redaction observation**, with a named function, a test, and an explicit list of what erasure does and does not remove (address: yes; note text: yes; device linkage: yes; the cat, the photo, the derived status, the points: no). Then make the three user-facing promises say the same thing in the same words.

---

## B2 · CONFIRMED — Marketing sends and staff sign-in links share one domain and one provider, and nobody owns the reputation

**Specs in conflict:** `email-capture` ↔ `team-access-and-welfare-queue`

- team-access §2.3 chooses **Resend**, verifies `catspotters.com`, and lists the *"'your cat was sterilised' loop"* as one of the four things the one provider covers — i.e. it assumes it owns the email-capture spec's transport decision.
- email-capture §7 and §8.2(5) treat the provider as **undecided** (SYC-25) and set requirements — one-click unsubscribe headers, per-message suppression, deletion of stored recipient data on request — that it never checks Resend against.
- Neither proposes subdomain separation, separate DKIM keys, or separate audiences.

**Consequence.** Full detail in A9. Short version: a spam complaint on cat news can silently degrade delivery of the fifteen-minute sign-in links the entire dashboard depends on. Both specs list a deliverability risk; neither risk describes this interaction; nobody is the owner.

**Fix.** Make team-access §2.3 the single provider decision of record and have email-capture reference it rather than re-open it, **and** add the subdomain split (A9) to both, with an owner and a launch-day check.

---

## B3 · CONFIRMED — "Your cat was sterilised" depends on a status-change signal that the data spine deliberately does not produce

**Specs in conflict:** `email-capture` ↔ `cat-record-data-spine` (with `team-access` as the third party that writes the event)

The chain: team-access §3.3 lets a team member *"correct a sterilisation record"* in the dashboard → the data spine turns that into an appended observation and derives status **on read**, with no cached column (§2, Option C; Option D deferred) → email-capture §4.1 wants to send on *"a care event... life status changed"*.

There is no artefact in the middle. Full analysis in A2.

**Consequence.** The product's single most-cited feature — the reason the email spec exists at all — has no implementable trigger as the four specs stand, and each spec assumes the other holds it.

**Fix.** As A2. Assign the change-detection surface to one spec by name.

---

## B4 · CONFIRMED — The team-access spec is written for a runtime this project does not have

**Specs in conflict:** `team-access-and-welfare-queue` ↔ `hosting-and-photo-storage` (and the codebase)

team-access assumes Cloudflare Workers throughout:
- §2.5: *"`wrangler secret put RESEND_API_KEY` / the deployment platform's secret store"*
- §2.3 option B: *"Cloudflare Email Sending — the platform sends the mail itself through a built-in binding"*, named as **the fallback** if Resend stalls
- §2.3 option C: *"The platform the workspace runs on has no real SMTP client — this fights the architecture"*

The API is Express/Node (`artifacts/api-server/`), and the hosting spec commits to **Replit through launch** (§4.1–4.2). There is no `wrangler.toml`, no Worker, nothing Cloudflare in the repo. The only Cloudflare thing any spec proposes is an **R2 bucket** (hosting §4), which is object storage and has nothing to do with Email Sending bindings.

**Consequence.** Three concrete errors: the named fallback provider is **unavailable** without a runtime migration the hosting spec explicitly rules out before launch; the secret-handling instruction points at the wrong secret store; and option C's rejection reasoning is wrong for Node (nodemailer exists), even though the conclusion — don't use a Google app password — is right for better reasons.

**Fix.** Rewrite team-access §2.3/§2.5 for Express-on-Replit: Replit deployment secrets, and a real fallback (a second transactional provider such as Postmark/SES, or SMTP-via-provider) rather than a Workers binding. Keep the "not a Google app password" conclusion; fix the argument.

---

## B5 · CONFIRMED — The same two tables are specified twice, differently, and the correction model is specified twice, incompatibly

**Specs in conflict:** `cat-record-data-spine` ↔ `team-access-and-welfare-queue`

**Feeding sites, defined twice:**

| data-spine §9.4 | team-access §8.3 |
|---|---|
| `colonyName text` | `colony_id` (FK to a new `colonies` table) |
| `notes` (team-only) | not present |
| no `colonies` table anywhere; colonies are mapped **by name** in import normalisation (§5.2) | `colonies` — id, name, place, guardian_name |

**Corrections, modelled twice and incompatibly.** team-access §8.3 specifies `record_changes` — *"an append-only log of corrections: what, who, when, before, after"* — alongside editable status fields (§3.3: *"Correct a life status"*, *"Correct a sterilisation record"*). That is precisely **Option B** in the data spine's own options table, which it rejects: *"Two sources that can disagree, and no rule that says which wins. Audit logs written alongside a column are the classic place where the log quietly stops matching reality."* The data spine's answer is that a correction **is** an observation with `supersedes`.

**Consequence.** Implemented as written, the team dashboard writes to a status column and a change log while the resolver reads an observation table that never hears about either. The cat page and the dashboard show different truths and there is no rule for which wins — exactly the failure the data spine was written to prevent.

**Fix.** team-access §3.3 and §8.3 defer to the data spine: corrections are observations with `roleAtTime: staff`, `supersedesId` set; `record_changes` is dropped or becomes a view over observations. Reconcile `feeding_sites` into one definition (the `colonies` table is the better design — adopt it, and update the data spine's import normalisation to map to `colony_id`).

---

## B6 · CONFIRMED — The two specs promise the reporter a different number of emails, in copy the user reads

**Specs in conflict:** `email-capture` ↔ `team-access-and-welfare-queue`

- team-access §5.5: *"they hear from us twice and no more"* — acknowledgement, plus one message on state change.
- email-capture §4.1: *"Your report: we've got it"* (once per report) **plus** *"Your report: what happened"* with cap *"Max two updates per report"* — up to **three**.

The queue has four states (§3.1: New · Looking at it · Done · Not for us), and team-access §5.5 says a message goes out *"when the team changes the state"* — which naturally produces two (Looking at it, then Done), i.e. three total, matching email-capture and contradicting team-access's own "twice and no more".

**Consequence.** This is consent copy, not an implementation detail. §3.4's ask says *"It's used for this report and nothing else"*; §5.5's copy tells the reporter how many messages to expect. Two specs, two numbers, and the queue's own state machine matches neither cleanly.

**Fix.** Pick: acknowledgement + one message on the **first** transition out of New + one message on the **terminal** state (Done / Not for us), suppressing duplicates. Write that number into both specs and into the ask copy.

---

## B7 · CONFIRMED — The EXIF/blurring dependency runs one way only, and the test that carries it does not exist yet

**Specs in conflict:** `hosting-and-photo-storage` ↔ `cat-record-data-spine`

hosting §5.3 states the dependency and claims the test: *"The sharp re-encode already drops metadata... This must be covered by an explicit test (`imageValidation`), because it is now load-bearing for the blurred-location promise"*, plus R3 and a 1–14 Sep slot in §6.

The data spine — which makes the blurring promise — **never mentions EXIF, image metadata or photo files anywhere**. Its threat model (§6.1) covers casual browsing and API sampling only. Its test list (§9.7, nine tests) has no EXIF test; test 6 asserts *"every public payload"* contains no exact coordinate, which does not cover an image byte stream served by a different route.

**Verified against code:** `imageValidation.ts` calls `.rotate()` then `.jpeg().toBuffer()` with no `.withMetadata()`, so sharp does strip metadata — the claim is **true today**. But the only related test (`imageValidation.test.ts:121`) asserts *orientation*, not metadata removal. Nothing prevents a future contributor adding `.withMetadata()` to preserve orientation "properly" and silently republishing GPS.

**Residual, owned by neither:** `GET /api/photos/:id` (`routes/photos.ts`) has **no access control and a sequential integer id** — already flagged in `threat_model.md`. Hosting §5.4 adds `visibility: restricted` for welfare-report and feeding-site photos, which is right, but sighting photos stay publicly enumerable, so the whole photo corpus is walkable by anyone. The data spine's privacy design does not consider this surface at all.

**Fix.** Add the EXIF-stripping assertion to the data spine's §9.7 list as test 10 (so the spec that makes the promise owns the check), keep hosting's implementation ownership, and have the test's failure message say *why* — the same treatment §11 risk 1 gives the ear-tip rule. Add the enumeration residual to one spec explicitly, even if the decision is "accepted".

---

## B8 · CONFIRMED — Reporter addresses: the specs agree in the queue and disagree everywhere else

**Specs in conflict:** `email-capture` ↔ `team-access-and-welfare-queue`

email-capture §8.2 Q2 recommends *"templated sends only in v1, with the address hidden from the queue view"*. team-access §3.1 shows only *"whether the reporter left a way to contact them"* — consistent.

But:
- team-access §4.3 sends an email to `admin@syroscats.com` containing *"the reporter's contact if they gave one"*. The address is disclosed in full to a shared Google Workspace mailbox that several people read. Hiding it from the queue UI achieves nothing while the mail carries it.
- team-access §5.5 says the state-change message goes *"with a sentence the team can edit before it sends"* — a human composing into a template, which is most of what "templated sends only" was meant to prevent, and creates a path for a team member to put something unintended in front of a member of the public.
- The **consent copy exists twice**, differently: email-capture §3.4 (*"It's used for this report and nothing else unless you ask"* + a separate unticked news box) vs team-access §4.2 (*"So we can tell you what happened. We use it for this and nothing else, and you can ask us to delete it"*, with **no** news box). Neither is marked authoritative, and team-access's version omits the second-consent mechanism entirely.

**Consequence.** The privacy recommendation is defeated by the delivery path in the other spec, and two different consent texts exist for the same field.

**Fix.** Decide once: either the address never leaves the app's own system (the alert email to `admin@syroscats.com` says *"reporter left contact details — reply from the dashboard"*), or it does and the queue shows it too. Make email-capture §3.4 the single source for the consent copy and have team-access §4.2 cite it.

---

## B9 · CONFIRMED — Email capture would announce a cat's death; the data spine forbids the app from announcing deaths

**Specs in conflict:** `email-capture` ↔ `cat-record-data-spine`

- email-capture §4.1 triggers cat news on *"life status changed"*; §4.2: *"Sterilisation, homing and death are always news."*
- data-spine §3.3: *"The app never announces a death"*, and on presumed-deceased: *"Never 'presumed deceased' as a headline, and never a notification"*; §3.2: *"Deceased is reversible... a cat reported dead by one person and then photographed alive is a normal Tuesday."*

**Consequence.** As written, a tourist who named a cat in June receives *"Loukoumi has died"* — from a `deceased` observation a single guardian may set (data-spine §12 Q5 recommends allowing exactly that without team confirmation), which any later photograph can reverse. An email cannot be unsent. This is the highest-emotion message the product could ever send and it rests on the most reversible observation in the model.

**Fix.** Remove death from the cat-news triggers, or restrict it to `roleAtTime` in {staff, admin, vet} with a seven-day cooling-off window before the send, and never for derived presumed-deceased. Align §4.2's wording with data-spine §3.3 in both documents.

---

## B10 · CONFIRMED — Sequencing: "the only infrastructure change before launch" is not true, and two specs each claim to be first

**Specs in conflict:** `hosting-and-photo-storage` ↔ all three others

hosting §4.1: the photo move *"is the only infrastructure change that goes in before launch"*. Against `PRODUCT-SPEC.md` §2, everything below is also MVP, i.e. before October:

| Spec | New infrastructure before October | Product-spec section |
|---|---|---|
| team-access | Mail transport, sign-in tokens/sessions, staff dashboard, **6 new tables** (`people`, `signin_tokens`, `welfare_reports`, `feeding_sites`, `colonies`, `record_changes`) | §2.5, §2.6 |
| data-spine | **4 new tables**, a resolver module, server-side blurring, a client change to draw circles, two new sighting questions, the records import | §2.3, §2.4 |
| email-capture | 2 new tables, 4 client capture moments, transport, double opt-in, a batching job, public unsubscribe/delete web pages | §2.7 |

**Undeclared dependency:** team-access §8.3 says report photos are *"stored in object storage rather than the database"* — that storage does not exist until hosting's SYC-46 lands. Neither spec states the dependency; hosting's §5 upload path is written for `POST /api/sightings` only and never mentions welfare-report photos or the `restricted` visibility path's write side.

**Competing "firsts":** team-access risk 2 — *"Settle the provider decision first, before dashboard work starts"*. hosting §6 — the storage work is the one thing in the 1–14 Sep window. They are not mutually exclusive, but no document sequences the four together, and each was written as though it were the only one in the window.

**A quieter tension worth naming.** hosting §6 is emphatic that nothing may disturb the Play 14-day clock: *"Explicitly not during 1–14 September... no change to the upload contract"*, and R2 leans on the change being *"API-only... no new store build required"*. The data spine (§10 step 5–6) and email capture (§3, four in-app moments) both require **new client builds** inside that same window, per `PRODUCT-SPEC.md` §4 Phase 0. Either the hosting spec's caution is overstated for the other specs' work, or the other two specs are scheduled into a window their sibling says is closed to client changes. Nobody has reconciled it.

**Fix.** One sequencing document across the four, with the dependency edges drawn: mail transport → (sign-in, welfare queue, email capture); object storage → (report photos, sighting photos); data-spine observations → (team corrections, cat-news triggers). Then re-estimate 15 Sep–early Oct honestly, with store review time inside it, and cut something.

---

## B11 · CONFIRMED — "The first genuinely personal data in the system" is claimed by the wrong spec

**Specs in conflict:** `email-capture` ↔ `cat-record-data-spine` ↔ `team-access-and-welfare-queue`

email-capture §5.6 tells the threat model that email addresses are *"the first genuinely personal data in the system"*. By October the system will also hold, from the other two specs: free-text sighting notes that *"may contain personal information (a person's name, a doorway)"* (data-spine §7.1); cat guardians' names from the records import (§5.1); colony names that are *"the location, plus the name of the person caring for the colony"* (PRODUCT-SPEC); reporter emails, reporter device ids and team notes (team-access §8.3); and a staff allow-list of named people (`people`).

**Consequence.** §5.6 is written as the definitive threat-model delta. Applied as written, the revised threat model would document the email asset and miss four others, and the app would ship with a privacy notice built from an incomplete asset list — into a store submission that requires that notice (DEPLOYMENT.md line 16).

**Fix.** One combined threat-model revision covering all four specs' new assets, produced once, before the privacy notice is written. Owner needed — currently email-capture §5.6 is the only spec that even proposes revising `threat_model.md`, and while doing so it should fix the stale "no rate limiting anywhere" claim (A3).

---

## B12 · CONFIRMED — The visit-summary email is the one payload with no location-precision rule

**Specs in conflict:** `email-capture` ↔ `cat-record-data-spine`

email-capture §3.3 offers *"names, photos, where you met them"*. The data spine's blurring is defined as a rule applied in *"the payload builders"* keyed on a `viewer` argument (§9.5), with per-sighting coordinates *"never public"* (§6.4.1) and the offline-cache rule that blurring must be *"applied server-side when the payload is constructed — never in the rendering layer"*.

An email is neither a payload builder nor a rendering layer. It is generated by a scheduled batch job with no viewer context, sent to an address that is not a device, and archived in a third-party inbox forever.

**Consequence.** If the summary carries exact per-sighting positions, the data spine's central privacy promise is bypassed by a channel it never considered — and the leak is permanent and forwardable. If it carries blurred ones, someone must say so, because the natural implementation reads the spotter's own sightings, which the data spine says the spotter is entitled to see exactly (§6.5).

**Fix.** State it in both specs: **email always uses the public/blurred precision**, regardless of who the recipient is, because an inbox is not a device. Add it to the data spine's §9.7 test list.

---

## B13 · PLAUSIBLE — Welfare reports never become observations

**Specs in conflict:** `team-access-and-welfare-queue` ↔ `cat-record-data-spine`

A welfare report carries a photo, a location, a severity, a litter flag and free text, and may be linked to a cat (`welfare_reports.cat_id`). It is the strongest single statement anyone makes about a cat's condition. The data spine's Phase-1 observation kinds are *"life_status, sterilised, ear_tip, food_and_water, note"* — a welfare report is none of them, and no spec says a report writes an observation.

**Consequence.** The record the data spine exists to build is missing the events that matter most to the charity, and a cat's page shows notes and food-and-water answers but not that someone reported it injured. `PRODUCT-SPEC.md` explicitly wants *"still capturing every scrap of data about what is going on"*.

**Fix.** Add a `welfare_report` observation kind emitted when a report is filed (and a `welfare_outcome` kind when the team closes it), so the report enters the trail with provenance and role. Cheap now; a backfill later.

---

## B14 · PLAUSIBLE — Public feeding-site exposure is recommended one way and left open the other

**Specs in conflict:** `cat-record-data-spine` ↔ `team-access-and-welfare-queue`

data-spine §6.6 recommends **public sites show their exact position** (*"a 300 m circle around a food bowl serves nobody"*), and raises it again as open question 2. team-access §3.2 describes the toggle and its safety rationale but never states the precision of a public site, and its own open question asks only *which* sites may be public.

**Consequence.** Two specs describe the same toggle; only one has an opinion on what it exposes. Implemented from team-access alone, the precision is whatever the developer picks.

**Fix.** Carry the data-spine recommendation into team-access §3.2 verbatim, and put the open question in one place with one owner (Syros Cats).

---

# Can the four specs be implemented together as written?

**No — not without reconciliation.** Individually they are strong. Together they contain at least four contradictions that would produce broken behaviour rather than merely inconsistent documentation:

1. **B1** — three specs promise erasure over a store that forbids deletion, with no mechanism named anywhere.
2. **B3/A2** — the product's flagship email has no trigger, because the data spine deliberately removed the only signal that would fire it.
3. **B5** — the team dashboard and the resolver are specified against two different, incompatible models of the same cat data (status-column-plus-audit-log vs append-only observations), and define `feeding_sites` twice.
4. **B4** — team-access is written for a Cloudflare Workers runtime this project does not have, making its named fallback provider unavailable and its secret-handling instruction wrong.

Plus two that damage users rather than the build: **B9** (the app emailing a reversible death announcement it has promised never to announce) and **B12** (exact locations leaking into an inbox).

**The single most serious cross-spec contradiction is B1 — deletion versus append-only observations.** It is the worst of the set because it is the only one where all three affected specs believe the problem is solved, each of them by a different document; because it fails at the moment of maximum exposure (a person exercising a legal right, or a journalist testing the §5.5 quote); and because the fix is architectural and cheap **now** — a per-device encryption key or a redaction path costs a column and a function today, and costs a schema migration across two seasons of observations if it lands after March 2027. B3 is the more embarrassing product failure and B1 is the more expensive one to fix late.

---

## Suggested order of reconciliation

1. **B1** — one erasure mechanism, written into the data spine, referenced by the other two.
2. **B5** — one correction model and one `feeding_sites` definition (data spine wins on corrections; team-access wins on `colonies`).
3. **B3/A2** — assign the status-change surface.
4. **B4** — rewrite team-access for Express-on-Replit; pick a real fallback provider.
5. **B2/A9** — subdomain split, one provider decision of record, named owner.
6. **B10** — one sequencing document; then cut scope honestly.
7. **A10/B11** — controller decision, processor DPA, one combined threat-model revision, then the privacy notice. This has a store-submission deadline inside the launch window and is currently an "open question" in one spec.
