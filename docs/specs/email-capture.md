# Email capture — design spec

**Date:** 3 September 2026
**Status:** For review, then Samuel's decision
**Owner:** Samuel
**Linear:** SYC-21 (this design question) · SYC-45 (build) · SYC-55 (the sterilisation loop) · SYC-3 (restore spots on a new device) · SYC-25 (mail transport)
**Related:** [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §2.7 and §3 item 6 · [`docs/SPEC.md`](../SPEC.md) §3.1 · [`docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md`](../superpowers/specs/2026-07-28-engagement-and-donations-design.md) §3 and §6 · [`threat_model.md`](../../threat_model.md)

---

## 0. The one-paragraph version

Cat Spotters is an app you can use without telling anyone who you are. That does not change. But the most valuable thing the app can ever say to someone is *"Agatha, the cat you named in June, was sterilised last week"* — and there is no way to say it to a person who went home three months ago and deleted the app. So the app asks for an email address, at a small number of moments where the reason for asking is obvious and the thing you get back is worth having. You can always say no, and saying no takes nothing away from you. An email address is a **forwarding address for news about your cats**, not an account, not a login, not a way to get your stuff back on a new phone.

---

## 1. The question, worked through

### 1.1 The two audiences want the same thing from different ends

It is tempting to treat the tourist and the local as opposites — one is here for a week, the other forever. They are not opposites. They want the **same** thing, which is *to find out what happened to the cat*. They differ only in what "what happened" means and how quickly they need it.

| | Tourist / visitor | Local, cat guardian, volunteer |
|---|---|---|
| Time with the app | 5–9 days, then years of silence | Permanent, low intensity |
| The cat they care about | The three or four they named | The colony they feed |
| What "closing the loop" means | *"Your cat was sterilised."* Arrives months later, out of the blue, and is the best thing the app ever does. | *"Your report was actioned."* Arrives in days, and is the difference between a working relationship and a black hole. |
| Why they'd give an email | It is the only channel that survives going home | It is the only channel that survives not opening the app for a fortnight |
| Push notification instead? | Useless — the app gets deleted | Partly works, but push dies with a reinstall or a permission decline |

Both cohorts are asking the app to **remember them to a cat**. Email is the only mechanism that does that across months and across devices. This is why email capture serves both audiences with one design rather than needing two.

### 1.2 Every candidate moment, judged

For each: who is standing there, what they get, how likely they are to say yes, and what it costs us.

---

**A. Following a cat** (you've just resolved a spot; the app already subscribes you to that cat)

- **Who:** everyone. Tourists mostly, because it happens on the spot flow.
- **What they get:** news about *this specific cat* — seen again, sterilised, found a home. The most concrete promise in the product.
- **Likely yes:** **high**. The cat has a face and a name they may have chosen themselves. The ask is small and the payoff is specific.
- **Cost to us:** an extra step in the highest-traffic flow in the app. If it is a blocking screen it damages the core loop; as a dismissible card after the reward screen it costs nothing.
- **Verdict: include.** This is the primary moment.

---

**B. Naming a new cat**

- **Who:** almost always a tourist (locals mostly confirm cats they already know).
- **What they get:** the strongest version of the promise — *you named this cat, we will tell you what happens to her*.
- **Likely yes:** **highest of any moment.** Naming creates ownership; ownership creates the wish to know.
- **Cost to us:** it is the same screen as (A) — the resolve/reward screen — just a stronger variant of the copy. Not a separate build.
- **Verdict: include, as the strong-copy variant of A.** Treating naming as its own moment would double-ask people who name a cat, which is precisely the wrong lesson.

---

**C. Trip / visit summary** ("you met 14 cats on Syros")

- **Who:** tourists, on the way out. Locals never see it.
- **What they get:** a keepsake — the cats they met, sent to them, plus the promise of news later. It is also the honest moment for a donation ask, per the engagement design.
- **Likely yes:** **high**, and it captures the people who declined at (A) because they were in a hurry. It is the second chance that does not feel like nagging, because the thing on offer changed.
- **Cost to us:** we must be able to detect "the trip is ending" without being creepy. Simple, honest rule: several days of activity followed by a few quiet days, or the person opens the app after leaving the island. It must never guess wrong in a way that matters — worst case it shows a summary early, which is harmless.
- **Verdict: include.**

---

**D. Welfare report needing a status update** ("this cat needs help")

- **Who:** both, and disproportionately locals and cat guardians.
- **What they get:** to be told what happened. Someone who reports a sick cat and hears nothing concludes the app is a suggestion box. The meeting was explicit that reports get an acknowledgement and a status update when the team acts.
- **Likely yes:** **very high** — arguably the highest intent of all, because the person is already worried and actively wants contact. But volume is low, so it is not where most addresses come from.
- **Cost to us:** it creates an obligation. If we take the address we must actually send the update, which means the team queue has to produce a status the app can send. That is a real commitment, not a form field.
- **Verdict: include.** This is the one where declining to ask would be a design failure. It stays optional — an anonymous report is still a valid report.

---

**E. Donation receipt**

- **Who:** both.
- **What they get:** a receipt. Non-negotiable in practice, and Greek charity rules may require one.
- **Likely yes:** **near universal**, but it is not really a choice — it is transactional.
- **Cost to us:** the address arrives through the payment provider, outside the app, and comes with a different legal basis (contract/legal obligation, not consent). Mixing it into the news list without a separate opt-in would be exactly the sort of quiet list-building that damages trust.
- **Verdict: out of scope for this design, deliberately.** Donations are not in the app yet (checkout is external). When they land, the receipt address is handled by the payment path and is **not** added to cat news unless the donor separately ticks to join it. Recorded here so nobody assumes otherwise later.

---

**F. Restoring spots on a new device**

- **Who:** anyone who reinstalls, changes phone, or comes back next season.
- **What they get:** their cats back.
- **Likely yes:** high *at the moment of loss* — but that is far too late, because by then there is nothing on the server tied to them.
- **Cost to us:** enormous, and it is a security cost, not a UX one (see SYC-3). Making email a recovery key turns it into a login: anyone who can receive mail at that address becomes that spotter, with their points, their owned cats and their private visited-cat history — which is closer to a location history than a score. That needs real account security, and it converts an anonymous app into an account app by the back door.
- **Verdict: exclude from v1, explicitly and loudly.** See §6.

---

**G. The "cat you named was sterilised" loop itself**

- **Who:** whoever gave an address earlier.
- **This is not a capture moment.** It is the payoff for (A)/(B). Listed here because it is easy to confuse the promise with the ask. The ask happens months earlier; this is the thing that makes the ask honest.

---

**H. Onboarding / first launch** — *considered and rejected*

- **Who:** everyone, before they have any reason to care.
- **Likely yes:** low, and the people who say yes are giving an address to something they haven't used.
- **Cost to us:** it is the single worst thing we could do to the product. The app's promise is "start spotting in seconds, tell us nothing". An email field on the way in reads as a sign-up wall, tanks conversion, and contradicts the anonymity that makes the app easy to recommend.
- **Verdict: never.**

---

**I. Team and staff sign-in** (Syros Cats dashboard, MVP §2.6)

- Genuinely an account, genuinely email-based, for a handful of named staff. **Out of scope here** — different system, different purpose, different consent basis. Mentioned only so the two are never conflated.

---

## 2. Recommendation

### 2.1 What we ask, and where

**Four moments in v1, in priority order:**

1. **After you resolve a spot — "follow this cat"** (moments A and B; stronger copy when you named the cat). Appears on the reward screen as a card below the points, never as a blocking step.
2. **The visit summary** — offered when a visit looks finished. Sends the summary and offers cat news.
3. **After a welfare report** — offered as part of the report, so we can tell you what happened.
4. **Settings** — a plain "get news about my cats" row, so anyone who declined can change their mind without hunting for a moment.

Settings is not a "moment" in the marketing sense, but leaving it out is what makes people feel trapped by an earlier no.

### 2.2 Deliberately left out of v1

| Left out | Why |
|---|---|
| Onboarding / first launch | Contradicts the core promise; converts badly; makes the app harder to recommend. |
| Email as device recovery / login | Turns anonymity into accounts and creates a real account-takeover surface (§6). SYC-3 is a separate decision. |
| Donation receipts joining the news list | Different legal basis; silent list-building. Receipt yes, list only on a separate tick. |
| Any second ask after two declines | Frequency discipline, §2.4. |
| Name, country, age, or any other field | We ask for exactly one thing. Anything else is a form, and forms get abandoned. |
| Marketing or newsletter sends | We promised news about *your cats*. A general newsletter is a different promise and needs a separate opt-in. |

### 2.3 Never, under any circumstances

- Email never gates spotting, naming, claiming a cat, reporting a cat in trouble, points, badges, streaks or the leaderboard.
- Declining is a single tap, is remembered, and produces no penalty, no nag badge, no reduced feature.
- No pre-ticked boxes. No "continue" button that implies consent by proceeding.

### 2.4 The frequency discipline for asking

- At most **one ask per moment type**, and at most **two asks in total** in a person's first fourteen days.
- After two declines, the app stops asking anywhere except Settings. Permanently.
- Never ask on the same screen twice.
- If they gave an address, no moment ever asks again.

---

## 3. The ask itself — the actual words

All copy is UK English here and gets native-authored Greek and French, not translation. Every ask has: what we'll send, how often, and how to stop — visible before they type, not buried in a link.

### 3.1 After naming a new cat (the strongest moment)

> **You named her. Want to know how she gets on?**
>
> Leave an email and we'll write when there's real news about Agatha — if she's spotted again, if she's sterilised, if she finds a home. A few times a year at most, and nothing else. Unsubscribe in one tap.
>
> `[ your@email.com ]`
> **[ Keep me posted ]**  ·  *No thanks*

**If they decline:** the card disappears and never comes back on this screen. Nothing else changes. They still follow the cat inside the app, still get the in-app notification, still keep the points. A one-line reassurance replaces the card the first time:

> *No problem — you'll still see Agatha's news in the app.*

### 3.2 After confirming a cat someone else named

> **Want news about Loukoumi?**
>
> We'll email you if there's something worth telling — sterilised, found a home, spotted after a long gap. Rarely, and never anything else. One tap to stop.
>
> `[ your@email.com ]`
> **[ Keep me posted ]**  ·  *No thanks*

### 3.3 The visit summary

> **You met 14 cats on Syros.**
>
> Want the list sent to you? We'll email your cats — names, photos, where you met them — and let you know when something happens to one of them. That's all we'd ever use it for.
>
> `[ your@email.com ]`
> **[ Send me my cats ]**  ·  *Not now*

**If they decline:** the summary stays in the app, viewable any time from the profile. Nothing is withheld. "Not now" here rather than "No thanks", because this one genuinely may be a timing thing — but it still counts as a decline against the two-ask cap.

### 3.4 After reporting a cat in trouble

> **Shall we tell you what happens?**
>
> Syros Cats will see this report. If you leave an email we'll confirm we've got it and let you know what they were able to do. It's used for this report and nothing else unless you ask.
>
> `[ your@email.com ]`
> **[ Yes, keep me updated ]**  ·  *No, send it anonymously*

**If they decline:** the report is submitted exactly the same way, to the same place, with the same urgency. The confirmation screen says so plainly:

> *Report sent. Syros Cats have it.*

Note the second checkbox that appears **only** after an address is entered here, unticked:

> ☐ Also email me news about the cats I've met

That is a separate purpose and therefore a separate consent. Without the tick, this address is used for this report and then falls under the retention rule in §5.4.

### 3.5 Settings

> **News about your cats**
> Off · *Get an email when something happens to a cat you've met.*
>
> `[ your@email.com ]`  **[ Save ]**

And once on:

> **News about your cats** — on, sent to s•••@gmail.com
> **[ Change ]** · **[ Turn off and delete my email ]**

"Turn off and delete my email" is a real deletion, not a flag (§5.3).

### 3.6 The confirmation email (double opt-in)

Every address is confirmed before we send it anything else.

> **Subject:** Confirm your email — Cat Spotters
>
> Someone (we hope you) asked us to send news about the cats they've met on Syros.
>
> **[ Yes, that was me ]**
>
> If it wasn't you, ignore this — we won't send anything else, and we'll forget the address in a week.

Unconfirmed addresses are deleted after seven days. This costs a little conversion and buys three things: nobody can sign up someone else's address, our sending reputation stays clean, and typos die quietly instead of bouncing forever.

---

## 4. What we send

### 4.1 The message types

| Message | Trigger | Who gets it | Cap |
|---|---|---|---|
| **Confirm your email** | Address given | That address | Once per address; resend on request |
| **Your cat's news** | A care event on a cat you follow: sterilised, found a home, spotted after a long gap, life status changed | Followers of that cat with a confirmed address | See §4.2 — batched, max one per fortnight |
| **Your visit summary** | You asked for it at the summary moment | That address | Once per visit |
| **Your report: we've got it** | You filed a welfare report and left an address | That reporter | Once per report |
| **Your report: what happened** | The team resolves or updates that report | That reporter | Max two updates per report |
| **Donation receipt** | Payment completes (future, outside the app) | The donor | Once per donation |

That is the whole list. Anything not on it needs a new consent and a new row in this table.

### 4.2 Frequency caps, so we never feel spammy

- **A hard ceiling of one cat-news email per fortnight per person.** If three of your cats have news in the same week, that is one email about three cats, not three emails.
- **A soft floor:** no cat-news email for a single low-value event. "Spotted again" alone is not news; "spotted again after four months" is. Sterilisation, homing and death are always news.
- **Quiet period:** nothing in the first 48 hours after confirmation except the thing they asked for.
- **Absolute ceiling:** no person receives more than **one email per week** from the app across all types, except transactional ones (confirmation, receipt, report acknowledgement), which are never delayed.
- If someone has had no news for a year, we do not invent any. A silent year is fine, and better than filler.

Realistic expectation for a tourist who followed three cats: **two to five emails a year.** The ask copy in §3 promises exactly that, so the promise and the system agree.

### 4.3 The donation ask, attached honestly

Per the engagement design, the "your cat was sterilised" email is the highest-intent donation moment in the whole product — because the outcome comes first and the ask follows it. So: the outcome is the email; the ask is a single line and a single button at the bottom, naming what it buys (a sterilisation is €50–60; co-funding a share of one is the realistic rung). Never a subject line, never above the news, never in a report update, never in a confirmation email.

### 4.4 Unsubscribe

- A one-click unsubscribe link in every non-transactional email, working without login and without a "are you sure" page.
- `List-Unsubscribe` and `List-Unsubscribe-Post` headers so mail clients' own unsubscribe button works.
- Unsubscribing stops **all** cat news immediately. Report updates for an open report continue unless they also ask to stop those — and the unsubscribe page says so and offers that option too.
- The unsubscribe page offers a second button: **delete my email address entirely** (§5.3). Unsubscribing keeps a suppression record; deleting removes the address.

---

## 5. GDPR and trust

The charity's credibility is on loan to this app. That is the real reason for this section, not the fines.

### 5.1 The basis for holding an address

**Consent**, in the GDPR sense: freely given (nothing is withheld if you decline), specific (each moment states its own purpose), informed (what and how often, before you type), and unambiguous (an explicit tap on an unticked control). Withdrawing it is as easy as giving it.

The one exception is the donation receipt, which rests on contract/legal obligation, and is why it never joins the news list without a separate tick.

### 5.2 How consent is recorded

For every address we store, alongside it:

- **what** they consented to (cat news / this report / visit summary),
- **where** they were when they consented (which moment, which screen),
- **the exact wording** they were shown — a version id pointing at the stored copy, so we can reproduce the screen a year later,
- **when**, to the second, and the app language,
- **confirmation** timestamp from the double opt-in,
- **withdrawal** timestamp if they later turn it off.

That record is the answer to "prove they agreed", and it is worthless if it only says "true".

### 5.3 Deletion, end to end

Two doors, both leading to the same place: **Settings → Turn off and delete my email**, and the delete button on the unsubscribe page. No email to a support address, no waiting.

What happens, precisely:

1. The address, the consent record's identifying parts, and any queued emails are deleted. Not flagged — removed.
2. A **suppression hash** (a one-way hash of the address) is kept so that if it is ever re-entered by someone else we do not re-mail an address that asked to be forgotten. It cannot be reversed into an address.
3. **Their spots, their named cats and their points are untouched.** This is the part people get wrong. The email address is a forwarding address bolted onto a device, not the identity behind the data. Deleting it removes the way we reach them; it does not delete Agatha, does not un-name her, does not remove their points, and does not break the catalogue. The app keeps working exactly as before, minus the emails.
4. If they want the *spotting* data gone too, that is a separate, also-available action ("delete everything from this device") — and the copy on the deletion screen says which one they are choosing, in one sentence each, so nobody deletes the wrong thing.
5. Deletion propagates to the mail provider (SYC-25) within the same operation, not on a nightly job.

**Access and export:** anyone can ask what we hold for their address and get it back. Because we hold one field plus a consent record, this is a small, honest export rather than a project.

### 5.4 Retention

| Data | Kept for |
|---|---|
| Unconfirmed address | 7 days, then deleted |
| Confirmed address, active | While consent stands |
| Address after 24 months with no opens, clicks or app activity | Deleted, after one "still want these?" email |
| Report-only address (no news tick) | Until the report is closed plus 90 days, then deleted |
| Consent record after deletion | Minimal, non-identifying: what was consented to and when it was withdrawn |
| Suppression hash | Indefinitely — it exists to protect them |

### 5.5 What we tell a journalist who asks about privacy

The honest, quotable version:

> You can use Cat Spotters without telling us anything about yourself — that's still the default and always will be. If you want to know what happened to a cat you met, you can leave an email address, and we'll use it for exactly that. We don't sell it, we don't share it with anyone but the mail service that delivers the message, we don't build a profile from it, and you can delete it from inside the app in two taps. Deleting it doesn't delete your cats — the cats belong to the island's record, not to us.

Three claims in there we must be able to defend, so they are build requirements, not slogans:

- **"We don't sell or share it."** No analytics tool, no ad platform, no third party other than the mail provider ever receives an address, hashed or otherwise.
- **"Two taps."** The deletion control is in Settings, not in a web form.
- **"We don't build a profile."** No open-tracking pixels for behavioural profiling. Aggregate delivery and bounce statistics only, which is what we need to know the mail is arriving.

And the thing not to claim, because it is not true: the app is **not** fully usable with no signal. Photos, queued sightings, offline map tiles and the cached catalogue work offline; matching, syncing, email capture and everything email-related need a connection. Email addresses given while offline are held in the same local queue as sightings and sent on reconnect, and the ask copy does not pretend otherwise.

### 5.6 Cross-reference to the threat model

[`threat_model.md`](../../threat_model.md) describes the app as fully anonymous, with a per-device credential and no email anywhere. Email capture changes the asset list, so these are the deltas that belong in the next revision of that document:

| Threat-model area | What changes |
|---|---|
| **Assets** | New asset: **email addresses and consent records** — the first genuinely personal data in the system. Higher value to an attacker than anything currently stored, and the one asset with a regulator attached. |
| **Information disclosure** | An address must never appear in any public or aggregate response — same rule as raw device ids (see `.agents/memory/anonymous-device-identity.md`). Not on the leaderboard, not on a cat page, not in a sighting list, not in a "discovered by" credit. The profile response returns a **masked** form (`s•••@gmail.com`) only. |
| **Spoofing** | Reading or changing the address on a device is an **owner-only** action and requires the `X-Device-Secret` header via the deviceAuth helper (`.agents/memory/device-secret-auth.md`). A device id alone must never reveal or set an address. |
| **Tampering / DoS** | The capture endpoint sends mail, so it is an outbound-abuse vector: an unauthenticated flood could burn sending quota and, worse, get the sending domain blocked, which would silently kill the loop. Needs rate limiting per device and per address, plus a global send ceiling. This lands in an API that today has **no rate limiting anywhere** — so this endpoint should not be the exception that proves the rule; it needs its own limit from day one. |
| **Elevation of privilege** | Unsubscribe and delete links must be unguessable, single-address tokens. A sequential or enumerable token would let anyone unsubscribe or delete everyone. |
| **New: email as an injection surface** | Cat names and free-text notes are user-supplied and will appear in emails. They must be escaped in HTML mail, and never placed in a subject line or header unescaped. |

---

## 6. Where the line is: email is not an account

This is the single most important boundary in this spec, and the easiest to erode by accident.

### 6.1 The line

**Identity stays the device.** The device id plus the device secret is what proves you are you. An email address is a **contact channel attached to a device** — an outbound-only forwarding address.

Concretely:

- You cannot log in with an email address. There is no login.
- Knowing or receiving mail at an address grants **no** access to any spot, cat, point, badge or profile.
- The address does not migrate anything to a new phone.
- Two devices that give the same address are still two separate spotters. We do not merge them, and we do not tell either device about the other — that would leak one person's activity to whoever else typed that address.
- There is no email in any authentication path. The device secret remains the only credential.

If we ever cross this line, we cross it deliberately, with a spec, with real account security, and with a different consent — not by adding a "sign in with your email" button because it seemed convenient.

### 6.2 Why the temptation is dangerous

Making the address a recovery key would mean: anyone who can receive mail at an address becomes that spotter. That hands over their points and owned cats, and — worse — their private profile, which includes every cat they have visited. As `docs/SPEC.md` §3.1 puts it, that list is closer to a location history than to a score. A magic link over email is a perfectly normal way to build accounts; it is not a small addition to an app whose entire security model is "the device holds an unguessable secret and nothing else authorises anything".

### 6.3 So how does restoring spots on a new device work?

**Not with the email address.** SYC-3 stays a separate decision with its own options, and this spec deliberately does not pre-empt it. The realistic candidates remain:

| Option | Benefit | Risk |
|---|---|---|
| **One-time recovery code**, shown once, saved by the user | No new personal data; no third party; works even if the old phone is destroyed | People lose codes. Needs a very good "save this" moment, and it is still a secret people can be socially engineered out of. |
| **Device-to-device transfer** (QR from the old phone) | Cryptographically clean; no stored secret anywhere; nothing to steal | Useless when the old phone is gone or broken — which is the common case |
| **Passkey** | Genuinely strong, phishing-resistant, backed up by the platform | Platform complexity, a real account concept, and an onboarding step in an app that has none |
| **Email magic link** | Familiar; free once mail transport exists | Everything in §6.2. **Not recommended.** |

**Recommendation:** keep email capture and device recovery entirely separate, ship email capture first (it has no security dependency), and decide SYC-3 on its own merits — with a preference for the recovery code, because it is the only option that costs the anonymous model nothing. If SYC-3 later chooses a mechanism that happens to use email, it must be a **separate, separately-consented** address with its own explicit warning, not the news address quietly promoted into a credential.

### 6.4 The one honest interaction

There is a real, small interaction worth naming: if someone reinstalls, their device id changes, so the app no longer knows the new install is the same person — including for email. They will be asked again at the next moment, and if they give the same address, they will get a confirmation email for an address that is already confirmed elsewhere. That is mildly annoying and completely safe. The fix is: recognise the address on the mail side, don't double-send news about the same cat to the same address, and say nothing to the app about what the other device did.

---

## 7. Technical notes (clearly marked; skip if you're reading for the decision)

- **Storage.** A new table keyed on device id: address, status (`pending` / `confirmed` / `unsubscribed`), purpose flags, confirmation token hash, timestamps. A separate consent-events table, append-only, holding the §5.2 record. Addresses stored in the same database as everything else; never in logs, never in analytics events, never in a push payload.
- **Auth.** Every read/write of an address goes through the deviceAuth helper (`X-Device-Secret`). The masked form is the only thing ever returned to a client.
- **Tokens.** Confirmation, unsubscribe and delete tokens are long random values, stored hashed, single-purpose, and expiring (confirmation 7 days; unsubscribe/delete do not expire, because a year-old email must still work).
- **Transport.** Depends on SYC-25. Whatever provider is chosen must support one-click unsubscribe headers, per-message suppression, and deletion of stored recipient data on request — a provider that keeps a copy we cannot delete makes §5.3 a lie.
- **Sending domain.** Needs SPF, DKIM and DMARC on the Cat Spotters domain before the first send. Sending "your cat was sterilised" from an unauthenticated domain lands it in spam, which fails the loop silently — the worst kind of failure, because it looks like nothing happened.
- **Offline.** Capture works offline by queuing alongside sightings (`docs/SPEC.md` §6.1) and sending on reconnect. The confirmation email is therefore delayed, and the success copy says "we'll send a confirmation when you're back online" rather than pretending it went.
- **Batching.** Cat-news sends are a scheduled job that groups events per person per fortnight, not a fan-out on every care event. The existing notification fan-out (`docs/SPEC.md` §5.5) stays as it is for in-app and push; the email path reads from care events on its own schedule.
- **Testing.** Invariants worth asserting: no address in any public response; no email send without a confirmed consent row; the fortnight cap holds when events cluster; unsubscribe stops sends within the same request; delete removes the row and leaves spots, cats and points intact; a decline is remembered across app restarts; two declines stop all asks.

---

## 8. Risks and open questions

### 8.1 Risks

| # | Risk | Why it matters | Mitigation | Owner |
|---|---|---|---|---|
| **1** | **We collect addresses and then never send anything.** Care events depend on Syros Cats recording sterilisations and the team queue producing report outcomes. If that flow is thin, we have taken personal data under a promise we don't keep. | This is the biggest risk in the spec, and it is operational, not technical. It also converts the app's best moment into its worst. | Do not turn on a capture moment until the message behind it can actually be sent. The report-update ask ships with the team queue, not before. Review send volumes a month after launch and pull any moment that isn't paying out. | Samuel + Syros Cats |
| **2** | **The ask damages the core loop.** An email prompt on the highest-traffic screen in the app, at the moment of reward. | The spot flow is the product. Any friction there costs spots, which costs data. | Card, not a step; below the reward, never above it; dismissible; two-ask lifetime cap; measure resolve-to-completion before and after. | Samuel |
| **3** | **Deliverability failure.** New domain, transactional mail, months between sends. | The loop fails silently — we think we closed it, the user sees nothing. | SPF/DKIM/DMARC before first send; double opt-in; monitor bounces and complaints; a warm-up before the first big batch. | Build |
| **4** | Sending endpoint becomes an outbound-abuse vector in an API with no rate limiting anywhere. | Burns quota and can get the sending domain blocked, killing the loop for everyone. | Per-device and per-address rate limits plus a global daily ceiling, shipped with the endpoint. | Build |
| **5** | Consent drift — a future feature quietly emails the list something it didn't consent to. | Exactly how charities lose trust. | §4.1 is a closed list; adding a row requires a new consent. Make that a code-level constraint, not a convention. | Build |
| **6** | Email creeps into becoming a login. | §6. | The line is written down here; any PR that puts an address in an auth path is a spec violation. | Samuel |
| **7** | Children give addresses. Boundless cohorts include minors, and a ten-year-old will type an address into any field. | Consent from a child is a different legal question, and the engagement design already flags safeguarding as pending Boundless's policy. | v1 asks for an address only where the promise is cat news; no name, no age, no profile. Revisit before any Boundless programme mode ships — and ask Boundless directly. | Samuel |

### 8.2 Open questions

1. **Does the visit-summary detection need to be clever?** Recommendation: no — a simple "several active days then quiet days" rule, shown late rather than early. Confirm the rule is acceptable, or accept showing it only when the user opens the app after a gap. *(Samuel)*
2. **Does Syros Cats want reporters' addresses visible to the team in the dashboard**, so a human can reply directly, or should all contact go through templated app-sent emails? This changes who sees personal data. Recommendation: templated sends only in v1, with the address hidden from the queue view — less exposure, less obligation. *(Samuel + Syros Cats)*
3. **Who is the data controller** — Syros Cats, or Samuel's entity? The privacy notice, the deletion route and the journalist answer all name someone. This needs to be settled before the first address is collected. *(Samuel)*
4. **Susan's standard reply text** feeds the report acknowledgement copy in §3.4 and §4.1. Outstanding from the 1 September meeting. *(Syros Cats)*
5. **Mail provider choice** (SYC-25), constrained by §7's deletion and unsubscribe requirements. *(Build)*
6. **Does the donation path — once James settles it — return an address at all**, or does the payment provider keep it? Determines whether §1.2(E) ever becomes ours to hold. *(Samuel + James)*

### 8.3 The one thing that genuinely needs Samuel's call

Everything above is a recommendation with a default. The one place where a reasonable person could go the other way:

**Should the "follow this cat" ask appear on the very first spot, or wait until the second or third?**

- **Ask on the first spot:** maximum capture, because a tourist may only ever make one or two spots, and the naming moment is at its strongest the first time. Risk: it reads as a sign-up prompt from a stranger, and it lands on someone who has used the app for ninety seconds.
- **Wait until the second or third:** asks someone who has demonstrably enjoyed it, higher yes-rate per ask, feels earned. Risk: we lose every one-spot tourist, who may be a large share of the audience.

**Recommendation: ask on the first spot, but only if that spot was a new cat they named** (the strongest possible version of the promise), and otherwise wait until the second. That splits the difference in the direction of the moment's actual strength rather than an arbitrary count. Samuel's call.
