# Email capture — design spec

**Date:** 3 September 2026 · rewritten against `docs/specs/DECISIONS.md`
**Status:** **Approved by Samuel, 28 September 2026**, with his review edits incorporated. Reconciled with Samuel's decisions (D2, D4, D5, D6, F3, F4, F7b) and the adversarial review
**Owner:** Samuel
**Linear:** SYC-21 (this design question) · SYC-45 (build) · SYC-55 (the sterilisation loop) · SYC-3 (restore spots on a new device) · SYC-25 (mail transport)

**This spec owns:** the four email moments · consent · the verification rule (F7b) · the nightly notify job (F4) · the data controller and the withdrawal route (D6). The privacy-policy text itself is `privacy-policy.md`.

**This spec does not own, and only references:**

| What | Owned by |
|---|---|
| How a cat's status is derived, and presumed-deceased | [`cat-record-data-spine.md`](cat-record-data-spine.md) |
| Location blurring and the public precision rule | [`cat-record-data-spine.md`](cat-record-data-spine.md) |
| The records import and its matching (optional, after MVP) | [`records-import.md`](records-import.md) |
| The deletion **mechanism** (redaction over an append-only store) | [`cat-record-data-spine.md`](cat-record-data-spine.md) |
| Staff sign-in, the trust boundary, the welfare queue and its states | [`team-access-and-welfare-queue.md`](team-access-and-welfare-queue.md) |
| Mail provider, secrets, photo storage, migrations | [`team-access-and-welfare-queue.md`](team-access-and-welfare-queue.md) and [`hosting-and-photo-storage.md`](hosting-and-photo-storage.md) |

---

## 0. The one-paragraph version

Cat Spotters is an app you can use without telling anyone who you are. That does not change. Onboarding ends with one clearly optional offer to add an email, which is as easy to skip as to accept. But the most valuable thing the app can ever say to someone is *"Agatha, the cat you named in June, was sterilised last week"* — and there is no way to say that to a person who went home three months ago and deleted the app. So the app asks for an email address at four moments where the reason for asking is obvious and the thing you get back is worth having. Every address anyone types gets one message asking "is this you?", and nothing else is ever sent until they say yes. You can say no at every moment, and saying no costs you nothing at all. A news email is a **forwarding address for news about your cats**, never an account or a login. Getting your spots back on a new phone uses a separate, opt-in "keep my spots safe" email (§8), and the phone keeps its key safe where it can.

---

## 1. The question, worked through

### 1.1 The two audiences want the same thing from different ends

The tourist and the local are not opposites. They want the **same** thing — to find out what happened to the cat. They differ only in what "what happened" means and how quickly they need it. Their needs are complementary: the tourist supplies attention and a photograph at the moment it matters, the guardian and the team supply the judgement about what it means.

| | Tourist / visitor | Local, cat guardian, volunteer |
|---|---|---|
| Time with the app | 5–9 days, then years of silence | Permanent, low intensity |
| The cat they care about | The three or four they named | The colony they feed |
| What "closing the loop" means | *"Your cat was sterilised."* Arrives months later, out of the blue, and is the best thing the app ever does. | *"Your report was actioned."* Arrives in days, and is the difference between a working relationship and a black hole. |
| Why they'd give an email | It is the only channel that survives going home | It is the only channel that survives not opening the app for a fortnight |
| Push notification instead? | Useless — the app gets deleted | Partly works, but push dies with a reinstall or a permission decline |

Both are asking the app to **remember them to a cat**. Email is the only mechanism that does that across months and across devices. That is why one design serves both.

### 1.2 Every candidate moment, judged

**A / B. After you resolve a spot — following a cat, and naming one.** Everyone, mostly tourists, on the highest-traffic screen in the app. What they get is news about *this specific cat* — the most concrete promise in the product, and strongest of all when they chose the name themselves. Likely yes: high, highest when they named the cat. Cost: an extra thing on the reward screen; harmless as a dismissible card below the points, damaging as a blocking step. **Include — this is the primary moment, with stronger copy when they named the cat.** Naming is not a separate moment; treating it as one would double-ask exactly the people most likely to have already said yes.

**C. Visit summary** ("you met 14 cats on Syros"). Tourists only. What they get is a keepsake — their cats, sent to them — plus the promise of news later. Likely yes: high, and it catches the people who declined at A because they were in a hurry. Cost: we must notice a visit is winding down **while the person is still here** (§2.5). **Include.**

**D. After a welfare report.** Both audiences, disproportionately locals and cat guardians. What they get is being told what happened; someone who reports a sick cat and hears nothing concludes the app is a suggestion box. Likely yes: very high — highest intent of all — but the volume is low, so it is not where most addresses come from. Cost: it creates a real obligation on the team queue. **Include.** Declining to ask here would be the design failure; an anonymous report is still a valid report.

**E. Donation receipt.** Out of scope, deliberately. The address arrives through the payment provider, outside the app, on a different legal basis (contract / legal obligation, not consent). A receipt address **never** joins cat news unless the donor separately ticks to join it. Recorded here so nobody assumes otherwise later.

**F. Restoring spots on a new device.** Excluded, loudly. See §8.

**G. The "your cat was sterilised" email itself.** Not a capture moment — it is the payoff for A/B, and the thing that makes the ask honest. Designed in §5.

**H. Onboarding / first launch.** **Adopted as an optional last step, led by keeping your spots safe (Samuel, 28 September 2026; amends D5).** The step's main offer is protecting the spotter's collection (§8); news is a separate, unticked box on the same screen. The earlier objection still describes the risk: an email field on the way in can read as a sign-up wall, and the person has no reason yet to care. So the step is built to answer it. It says plainly that it's optional and what they get, **Skip** is as prominent as **Add email**, and anonymous use stays the default. The benefit is catching tourists who make only one spot, or who skip the reward-screen card, at the moment they're paying most attention. Copy in §3.0; its guardrails in §2.4.

**I. Team and staff sign-in.** A genuine account for a handful of named people, owned by `team-access-and-welfare-queue.md`. Mentioned only so the two are never conflated.

---

## 2. Recommendation

### 2.1 The four moments

1. **After you resolve a spot — "follow this cat"**, as a card below the points on the reward screen, never as a step you have to get past. Stronger copy when you named the cat.
2. **The visit summary**, offered while the visit is still happening (§2.5).
3. **After a welfare report**, offered as part of the report so we can tell you what happened.
4. **Settings** — a plain "news about my cats" row, so anyone who said no can change their mind without hunting for a moment.

Settings is not a moment in the marketing sense, but leaving it out is what makes an earlier "no" feel like a trap.

**Plus one offer at the end of onboarding** (§1.2 H, §3.0). It is optional and skippable, and it sits outside the news-ask budget (§2.4).

### 2.2 Deliberately left out

| Left out | Why |
|---|---|
| The news email as device recovery or login | It would turn every news subscriber into an account holder by accident. Recovery uses the separate, opt-in "keep my spots safe" email instead (§8, SYC-3). |
| Donation receipts joining the news list | Different legal basis; silent list-building. Receipt yes, list only on a separate tick. |
| Name, country, age, or any other field | We ask for exactly one thing. Anything else is a form, and forms get abandoned. |
| Marketing or newsletter sends | We promised news about *your cats*. A general newsletter is a different promise and needs a separate opt-in. |

### 2.3 Never, under any circumstances

- Email never gates spotting, naming, claiming a cat, reporting a cat in trouble, points, badges, streaks or the leaderboard.
- Declining is a single tap, is remembered, and produces no penalty, no nag badge, and **no reduced feature** — including no reduced access to the visit summary, which stays in the app whether or not you ever give an address.
- No pre-ticked boxes. No "continue" button that implies consent by proceeding.
- Nothing is ever sent to an address that has not been confirmed (§4).

### 2.4 How often we ask — and what a decline actually costs

The old version of this rule contradicted itself: it promised that declining cost nothing, then made every decline burn one of two lifetime chances, including the chance at the moment most likely to convert. Fixed here.

**There are two separate kinds of ask, and they do not share a budget.**

- **News asks** — the spot card, the visit summary, and Settings. These are asking to send you cat news later.
- **The report ask** — purely transactional. It exists so we can tell you what happened to a cat you were worried about. It uses the address for that report and nothing else, and it **never consumes a news ask**. Someone who has declined news twice is still asked for a contact address when they report an injured cat, because that is a different question with a different answer.

**The news-ask budget, stated so it can actually be enforced:**

- At most **two news asks per install**, ever, plus Settings, which is always there and never counts.
- The two asks are consumed in the order they arise: the spot card first, the visit summary second. Declining the spot card does **not** remove the visit summary — the visit summary is ask number two, and it is the whole point of having two.
- After two declines the app stops asking anywhere except Settings, **for as long as this install lives**.
- Never twice on the same screen. If they have given an address, no moment ever asks again.
- **The onboarding offer sits outside this budget.** Skipping it does not use up either news ask, so the spot card and visit summary are still offered, and the spot card is the stronger moment. Ticking news at onboarding counts as having given a news address, so no moment ever asks again. Saving spots without ticking news leaves both news asks in place, with the address filled in.
- The fourteen-day window is gone. It was undefined after day fourteen, which made it meaningless. The steady state is simple: two asks, then silence, then Settings forever.

**And the honest limitation, written down rather than implied:** the decline counter lives **on the device**, alongside the device identity. Reinstalling the app resets it, because a reinstall creates a new device and the app genuinely does not know it is the same person. That is acceptable — reinstalls are rare, the ask is one tap to dismiss, and the alternative is worse: a server-side record of the fact that a specific person refused to be contacted, which is a behavioural record kept about somebody who explicitly asked us not to keep one. We prefer the leaky cap to the creepy one, and we say "on this phone" rather than "permanently" in anything a user reads.

### 2.5 When the visit summary appears

The trigger has to fire while the person is still on the island with the app installed. The previous rule — several active days followed by several quiet ones — waited until after they had gone home and deleted the app, which is a fair description of never.

**The rule:** on any app open where the person has spots on **two or more separate days** and their most recent spot is **more than eighteen hours old**. Nothing about leaving, nothing about geofences at the airport, no cleverness.

Bias early on purpose. Worst case the summary appears on day four of a nine-day trip, which is harmless — it says "so far", it can be shown again at the end of the visit as an updated summary (that is a re-display of a thing they already have, not a second ask), and it caught the person while they were still opening the app. The previous recommendation to show it late is reversed.

---

## 3. The ask itself — the actual words

All copy is UK English here and gets native-authored Greek and French, not translation.

Every ask shows, before you type: what we'll send, how often, how to stop, and who holds the address. Two lines are fixed and appear under every ask, including the onboarding offer:

> *We'll send one message first, to check the address is yours. Nothing else goes out until you say it's you.*
> *This email is only for news. To get your spots back if you change phones, use Keep my spots safe in Settings. Syros Cats holds it. [What we do with it](https://catspotters.com/privacy) · delete it any time.*

**Pronouns:** copy uses the cat's name, and "they" when we do not know the cat's sex — which is most of the time, because sex is usually blank in the records and is never asked of a spotter. No template says "her" unless the record says so. This matters most in Greek and French, where the article gives it away in every sentence.

### 3.0 At the end of onboarding — keep your spots safe (optional)

The last onboarding step, after language and username. It leads with what the person stands to lose: their spots, points and badges. It never blocks anything: **Skip** is as prominent as **Save my spots**, and either one goes straight into the app.

> **Don't lose your spots**
>
> Add your email so you can get your spots, points and badges back if you lose or change your phone.
>
> Anyone who can open this inbox can open your collection, so use an address only you (or a parent) can read. **Under 15? Ask a parent to add theirs.**
>
> `[ your@email.com ]`
>
> ☐ *Also send me news about cats I spot: when one is sterilised or finds a home.*
>
> **This is optional.** You can use the app without it, and add it later in Settings.
>
> **[ Save my spots ]**  ·  **[ Skip ]**

**One address, two separate choices** (§8.1). Pressing **Save my spots** makes it the "keep my spots safe" address. The news box is **unticked by default** and is a separate consent: ticking it also makes the address a news address. Each gets its own "is this you?" confirmation and is recorded separately, so either can be withdrawn without the other.

If they save their spots but leave news unticked, the later news asks (§2.4) still appear, with the address already filled in. If they tick news, no news moment ever asks again.

### 3.1 After naming a new cat — the strongest moment

> **You named Agatha. Want to know how they get on?**
>
> Leave an email and we'll write when there's real news about Agatha — sterilised, found a home, or turning up again after a long quiet spell.
>
> `[ your@email.com ]`
> **[ Keep me posted ]**  ·  *No thanks*

**If they say no:** the card goes and never comes back on this screen. Nothing else changes — they still follow Agatha in the app, still get the in-app notification, still keep the points. One line replaces the card, once:

> *No problem — you'll still see Agatha's news in the app.*

### 3.2 After confirming a cat someone else named

> **Want news about Loukoumi?**
>
> We'll email you if there's something worth telling — sterilised, found a home, spotted again after a long gap.
>
> `[ your@email.com ]`
> **[ Keep me posted ]**  ·  *No thanks*

### 3.3 The visit summary

> **You've met 14 cats on Syros.**
>
> Want the list sent to you? We'll email your cats — their names, their photos, and roughly where you met them — and write again if something happens to one of them.
>
> `[ your@email.com ]`
> **[ Send me my cats ]**  ·  *Not now*

**If they say no:** the summary stays in the app, viewable any time from the profile, and it is exactly the same summary. Nothing is withheld and nothing is lost. "Not now" rather than "No thanks", because this one genuinely may be a timing thing.

**"Roughly where" is not a softener, it is the specification.** The emailed summary carries **public, blurred precision** — the same 250 m cell everyone else sees, described in words where possible ("near Vaporia") — never the exact position of a sighting, and never the position the spotter themselves is entitled to see in the app. An inbox is not a device: it is forwardable, searchable, archived by a third party forever, and it can be read by whoever ends up at a mistyped address. This is the one payload the location rules had never been applied to, and it is the one where a mistake is permanent. The rule and its test belong to `cat-record-data-spine.md`; this spec's requirement is simply: **email always uses public precision, regardless of who the recipient is.**

### 3.4 After reporting a cat in trouble

> **Shall we tell you what happens?**
>
> Syros Cats will see this report. If you leave an email we'll confirm we've got it, and write once more when there's an outcome. It's used for this report and nothing else.
>
> `[ your@email.com ]`
> **[ Yes, keep me updated ]**  ·  *No, send it anonymously*

Once an address is entered here, one unticked box appears:

> ☐ Also email me news about the cats I've met

Separate purpose, separate consent. Without the tick, this address is used for this report and then deleted (§5.5).

**If they say no:** the report is submitted in exactly the same way, to exactly the same place, with exactly the same urgency.

**And in every case — address or no address — the report is confirmed on screen immediately.** Nobody trying to help a hurt cat is made to wait for an email round trip. What waits for verification is the *emailed* acknowledgement and the outcome message, not the report.

> *Report sent. Syros Cats have it.*

**This is the single consent text for a reporter's address.** `team-access-and-welfare-queue.md` §4.2 cites these words rather than writing its own; the two documents previously carried two different texts for the same field, and this one wins because it is the one that also explains the second consent box.

### 3.5 Settings

> **News about your cats**
> Off · *Get an email when something happens to a cat you've met.*
>
> `[ your@email.com ]`  **[ Save ]**

And once on:

> **News about your cats** — on, sent to s•••@gmail.com
> **[ Change ]** · **[ Stop emailing me ]**

Directly below, always present whether or not an address was ever given:

> **[ Delete my data ]** — *Remove everything that identifies you.* (§6)

**There are exactly two destructive actions in this app, they have exactly these two names, and both specs use them.** They are deliberately different sizes and must never be presented as variants of each other:

| Action | What it does | Where it appears |
|---|---|---|
| **Delete my data** | The full severing. Email address, points, streak, badges, spot history, notes, and the link between the person and everything they have spotted. The sightings survive, unlinked. Irreversible. The mechanism is `cat-record-data-spine.md` §8; this spec owns the copy (§6.3). | Settings · the delete link in every email · `hello@catspotters.com` as the fallback |
| **Stop emailing me** | Only the mail stops. The address is removed and a suppression hash is kept so it is never mailed again. Points, streak, spots and everything else stay exactly as they are, and the app carries on working normally. | Settings (once an address is given) · the unsubscribe page's second button (§5.8) · the report-outcome and news emails |

There is **no third action**, and in particular no separate "delete everything from this device" — an earlier draft offered one, which read as a smaller thing than "Delete my data" while doing the same job, and gave the app two names for one button.

---

## 4. The verification rule — every address, every time

**The general rule, and it is broader than any one moment:** *any* email address a person types anywhere in this app — at onboarding, at any of the four moments, on a welfare report, in Settings, at the visit summary — receives **one** message asking whether the address is theirs, and **nothing else is ever sent to it until they confirm**. Not an acknowledgement. Not a summary. Not news. Not a receipt for anything.

**It sends from the news identity, not the transactional one** — see §7.3, and `DECISIONS.md`'s amendment to D2. Verification mail goes to strangers who have just typed an address, so it is kept off the reputation that staff sign-in links depend on. Staff sign-in verification is a different message on a different identity, and is `team-access-and-welfare-queue.md`'s.

This replaces the double opt-in the previous version described. Double opt-in was a *subscription* control: it stopped anyone being signed up to an address they did not own. It did nothing about the actual problem, which is that the capture endpoint would happily send mail from a charity's domain to any string a stranger typed. The verification rule is the same click doing a bigger job: it is the gate on **all** outbound mail to an unverified address, and it is enforced in one place rather than per feature.

### 4.1 What the verification message says — and why it is fixed

> **Subject:** Is this you? — Cat Spotters
>
> Someone using the Cat Spotters app on Syros asked us to send email to this address.
>
> **[ Yes, that was me ]**
>
> If it wasn't you, you don't need to do anything. We won't send anything else to this address, and we'll forget it in seven days. If you'd rather we forgot it right now: **[ Forget this address ]**.
>
> Cat Spotters is made for Syros Cats, a cat charity on Syros. [What we do with your email](https://catspotters.com/privacy) · hello@catspotters.com

**Every word of that message is fixed.** It carries no cat name, no note text, no photograph, no "your friend Anna thought you'd like this", nothing a sender chooses and nothing a stranger could use it to carry. That is deliberate: the message is the only thing an unverified address can ever receive, so it must be worth nothing to anyone trying to use us to send something to someone else. The **[ Forget this address ]** link is not politeness — it is the fastest suppression control we have, operated by the person best placed to use it.

### 4.2 What verification does and does not buy — stated honestly

**It caps the abuse. It does not eliminate it.** The verification message is itself outbound mail, from the charity's domain, to a typed address that nobody has proved anything about. Somebody determined to use us to annoy a stranger can still cause exactly one email to arrive.

What we get is that the ceiling is fixed and low:

- one message, ever, per address (until the address confirms or ages out),
- content that carries nothing an attacker chose,
- an unsubscribe-strength opt-out inside it,
- and hard limits on how many of them can be produced (§4.4).

What we do **not** get, and should not claim: an endpoint that cannot be used to send mail to a stranger. Anyone who says otherwise has confused "cannot be subscribed" with "cannot be mailed". This is why rate limiting is retained *alongside* verification rather than replaced by it *(F7b)*.

### 4.3 The flow, end to end

1. Someone types an address at onboarding or at one of the four moments. The on-screen thing they were doing — resolving a spot, filing a report — **completes immediately and unconditionally**.
2. The address is stored as `pending`, with the consent record (§5.6).
3. One verification message goes out, subject to §4.4's limits.
4. Nothing else is queued, generated or sent to that address. Anything that would have been sent — a report acknowledgement, a visit summary, cat news — is held **as an intent, not as a rendered message**, so nothing containing personal data sits in a queue for an address that may never confirm.
5. They tap **Yes, that was me**. The address becomes `confirmed`, and the held intents are rendered and sent, in one batch, immediately.
6. They do nothing: after seven days the address, the pending intents and the token are deleted. The consent record keeps only that an unconfirmed attempt expired.
7. They tap **Forget this address**: everything above happens now, and the address hash goes on the suppression list so we do not mail it again even if somebody types it again.

**Offline.** Capture works offline by queueing alongside sightings; the verification message therefore goes out when the phone reconnects, and the success copy says *"we'll send a message to check that address when you're back online"* rather than pretending it went. Offline support in this app is partial and the copy never overstates it.

### 4.4 Rate limiting — corrected, and in the right order

**Correcting the record first.** The previous version of this spec asserted that the API has *"no rate limiting anywhere"*. **That is false**, and it was quoting a stale `threat_model.md`. The codebase has a per-IP limiter today: `artifacts/api-server/src/middlewares/rateLimit.ts` exports `aiLimiter` (20 requests per 15 minutes, per IP, via `express-rate-limit`), applied to `POST /api/sightings` (`routes/sightings.ts`) and `POST /api/cats/name-suggestions` (`routes/cats.ts`), with a dedicated test at `routes/rateLimit.test.ts`. `app.ts` sets `trust proxy: 1`, so `req.ip` is the real client address behind the single Replit proxy and cannot be spoofed with `X-Forwarded-For`. **The email endpoints use that existing primitive rather than inventing a second one**, and the stale claim in `threat_model.md` gets fixed in the same change.

**The controls, ordered by how much weight they actually carry:**

| # | Control | Limit | Why it is where it is |
|---|---|---|---|
| 1 | **Per address** | One verification message per address per 24 hours; three in the address's lifetime, then permanent suppression | The only control that directly protects the *victim* — the person whose address was typed. It caps what any number of attackers, from any number of addresses, can do to one inbox. |
| 2 | **Per IP** | Reuse `aiLimiter`'s shape: a strict window on the capture endpoint | The load-bearing volume control. Costs an attacker real resources to evade. |
| 3 | **Global daily ceiling** | A fixed number of verification sends per day across the whole app, **failing closed** with an alert to the build owner | The backstop that decides what the worst day looks like. Failing closed means the loop pauses; failing open means the domain burns. A paused loop is recoverable, a burned domain is not. |
| 4 | **Per device** | A courtesy limit only, and labelled as such | **Diagnostic, not a defence.** Device ids are client-generated and free — an attacker mints a fresh one per request (`.agents/memory/device-secret-auth.md`). Per-device limiting catches a buggy client, nothing more. The previous version listed this first, which put the weakest control at the front of the argument. |

The suppression list checked at (1) is the **same** list used for unsubscribes and deletions (§6). An address that asked to be forgotten is not sent a verification message either.

---

## 5. What we send

### 5.1 The message list — closed

| Message | Trigger | Sending identity (§7) | Cap |
|---|---|---|---|
| **Is this you?** | Any address typed anywhere in the app | **News** *(D2 amendment — see §7)* | §4.4 |
| **Your cat's news** | The nightly job finds a genuine, good-news status change on a cat you follow (§5.3). **Never a death, a presumed death, or any life-status change other than *homed*** (F4, §5.3) | News | Max one per week; no yearly cap (§5.2; changed by Samuel, 15 October 2026, SYC-344 Decision 5) |
| **Your visit summary** | You asked for it, and the address is confirmed | News | Once per visit |
| **Your report: we've got it** | You filed a welfare report, left an address, and confirmed it | Transactional | Once per report |
| **Your report: what happened** | The report reaches a closing state | Transactional | Once per report (§5.4) |
| **We can't keep our promise** | A capture moment is withdrawn (§10, Risk 1) | News | Once, ever |
| **Donation receipt** | Payment completes, outside the app, later | Transactional | Once per donation |
| **Keep my spots safe: is this you?** | Someone adds a "keep my spots safe" address (§8) | Transactional | §4.4 |
| **Your restore link** | Someone asks to get their spots back on a new phone (§8.3) | Transactional | Rate-limited as staff sign-in; once per request |

That is the whole list. Anything not on it needs a new consent and a new row here, and that is a code-level constraint — the sender takes a message type from this enum and there is no free-text send path.

### 5.2 Frequency caps, so we never feel spammy

- **A hard ceiling of one cat-news email per week per person** (changed from one per fortnight by Samuel, 15 October 2026, SYC-344 Decision 5). Three cats with news in the same week is one email about three cats. News that arrives while the limit is closed is held and goes with the next email the limit allows; anything still waiting after 60 days is dropped.
- ~~**An annual ceiling of eight.**~~ **Removed by Samuel, 15 October 2026 (SYC-344 Decision 5): there is no yearly ceiling.** The weekly limit is the only cap. The privacy policy's "a handful of times a year at most" was changed to match (`privacy-policy.md`).
- **A soft floor:** no email for a single low-value event. "Spotted again" alone is not news; "spotted again after four months" is.
- **Quiet period:** nothing in the first 48 hours after confirmation except the thing they actually asked for.
- **Absolute ceiling:** no person gets more than one email a week across all types, except transactional ones (verification, report acknowledgement, receipt), which are never delayed.
- A silent year is fine. We do not invent news to fill it.

Realistic expectation for a tourist who followed three cats: **two to five emails a year**.

### 5.3 The nightly notify job — how "your cat was sterilised" actually fires

This is the mechanism behind the product's best message, and the previous version of this spec had no way to fire it. The data spine derives a cat's status on read and stores nothing, so there is no row anywhere that changes when a cat becomes *Confirmed sterilised*. Watching for observation inserts does not work either: an ear-tip photo of an already-confirmed cat is not news, and an import row applied to a cat we thought was *Likely* is.

**The job (F4):**

- **Nightly.** It walks every cat that at least one person with a confirmed address follows, asks the data spine's resolver for the cat's current derived status, and compares it against **the last status we told people about**.
- **The baseline is ours, not the data spine's.** A small table — cat id, the status we last notified about, when — written **only** by this job and **never read by the resolver. It is a consumer-owned cache for change detection, not a source of truth about any cat.** If it were deleted tomorrow the app would be unaffected; the job would simply re-seed and send nothing until the next real change. The data spine's rejection of a cached status column stands: this is not that column, and nothing derives from it.
- **The contract we depend on** is the data spine's status derivation (`cat-record-data-spine.md` §2 and its resolver in §10.2): given a cat, return the current derived sterilisation status and life status, with the provenance and `observedAt` of the observations that produced it. We call it and we do not reimplement it. If that contract changes, this job is a named consumer.
- **Up to a day's delay is fine** for this message. Nobody is waiting by an inbox for it.

**Seeding, so the import never sends "sterilised last week" about a 2019 operation.** If a records import ever happens (optional, after MVP: `records-import.md`), the baseline is seeded **as it lands** — as each import batch applies, the job records the post-import status for every affected cat as the baseline, without sending anything. The import is the single biggest injection of confirmed data the app will ever receive; it produces exactly zero emails, by construction rather than by a filter someone might forget.

Two further guards on the same principle, for import rows that arrive later (a record matched by a human in the review queue in March, about an operation in 2019):

- A change caused **only** by observations with provenance `import` or `legacy` updates the baseline silently and sends nothing.
- A change caused only by observations whose `observedAt` is more than **90 days** before they were recorded updates the baseline silently and sends nothing. Old news is not news.

**What is news, and what is not.** The job sends on a **positive, closing-the-loop** change only:

| Change | Email? | Why |
|---|---|---|
| Sterilisation status becomes **Confirmed sterilised** | **Yes** — this is the message the whole spec exists for | The loop closes, and the person's spot helped close it |
| Life status becomes **homed** | **Yes** | Unambiguously good news, and rarely reversed |
| Spotted again after a long quiet gap (four months or more) | **Yes** | Reassurance, and the most common good news for a cat nobody is trapping |
| Status becomes **Confirmed not sterilised** | **No** — never | See below |
| A cat is dead, or presumed dead | **No** — never | See below |
| *Likely* (a clipped tip was photographed) | **No** | Not certain enough to tell someone, and it flips to Confirmed often enough that the Confirmed message would then be a duplicate |

**No automated death announcements. This is absolute.** *(F4.)* Presumed-deceased is derived, reversible by a single photograph, and a cat reported dead by one person and then seen alive next Tuesday is a normal week on Syros. An email cannot be unsent. This would be the highest-emotion message the product could ever send, resting on the most reversible statement in the model, and an email you may have to retract is worse than no email at all. If a death is ever communicated it is a human writing to a specific person, deliberately, not a job.

**No email about a confirmed negative, either — and this is a direct consequence of D4.** The app now publicly shows a confirmed *not sterilised*, which is honest and right on the map. It is a different thing in an inbox. *"Agatha has not been sterilised"* is not news anyone can act on, it is a mildly distressing message about a cat somebody loves, and it is a durable, forwardable pointer to a specific unsterilised cat in roughly a known place — the sharpest targeting signal the product produces, sitting in a third-party mailbox forever. The map is a place people go; an inbox is a place things arrive and stay. **The ask copy in §3 was also checked against D4 and needed no change**: it promises news "if she's sterilised, if she finds a home" and never promises to report the absence of either, so the public negative introduces no broken promise to a follower.

### 5.4 The report loop — one number, in both specs

The two specs previously promised the reporter a different number of emails, in copy the reporter reads: `team-access-and-welfare-queue.md` v1.0 said *"twice and no more"*, this spec allowed up to three. Settled here, and cited in that spec's §5.3h.

**Two messages, after verification, and no more:**

1. **We've got it** — the acknowledgement, as soon as the address is confirmed.
2. **What happened** — one message, when the report reaches a **closing state** (*Done* or *Nothing needed*, the two closing states in `team-access-and-welfare-queue.md` §3.1).

A move to *Looking at it* sends nothing. It is a queue state, not an outcome, and per F1 nothing about the queue implies a response time — a message saying "we're looking at it" would imply exactly the service level the whole capacity design is careful not to promise. The ask copy in §3.4 says "we'll confirm we've got it, and write once more when there's an outcome", which is two, and matches.

**Options considered.** *(a)* Ack only — least obligation, but leaves the reporter exactly where they were: no outcome, which is the thing they wanted. *(b)* Ack + first transition + terminal — three messages; the interim one implies a response speed nobody has agreed to staff. *(c)* **Ack + terminal — recommended, and adopted.** It is the smallest number that closes the loop, matches both specs' copy, and promises nothing about timing.

**Related, and agreed with `team-access-and-welfare-queue.md`:** the reporter's address is **hidden from the queue UI**, and — because hiding it from a screen achieves nothing while an email carries it — the alert to `admin@syroscats.com` does **not** contain it either. That mail says *"the reporter left contact details — reply from the dashboard"*. All contact with a reporter goes out as one of the two templated messages above, from the app's own system, so a member of the public never receives free text a team member typed into a hurry.

### 5.5 Retention

| Data | Kept for |
|---|---|
| Unverified address | 7 days, then deleted along with anything held for it |
| Confirmed address, active | While consent stands |
| Address after 24 months with no opens, clicks or app activity | Deleted, after one "still want these?" email |
| Report-only address (no news tick) | Until the report closes, plus 90 days, then deleted |
| Consent record after deletion | Redacted to the non-identifying part: what was consented to, and when it was withdrawn |
| Suppression hash | Indefinitely — it exists to protect them |

### 5.6 How consent is recorded

For every address, alongside it: **what** they consented to (cat news / this report / visit summary), **where** (which moment, which screen), **the exact wording they were shown** — a version id pointing at the stored copy, so the screen can be reproduced a year later — **when**, to the second, the app language, the **verification** timestamp, and the **withdrawal** timestamp if they later turn it off.

That record is the answer to "prove they agreed", and it is worthless if it only says `true`.

Consent events are append-only, and withdrawal is a new event rather than an edit — with one exception that must be stated rather than fudged: when someone deletes their data, the identifying parts of past consent events are **redacted in place** using the data spine's redaction mechanism (F3), which is the same audited operation the observations table uses. The previous version promised deletion out of an append-only table without saying how, which was not implementable.

### 5.7 The donation ask, attached honestly

The "your cat was sterilised" email is the highest-intent donation moment in the product, because the outcome comes first and the ask follows it. So: the outcome is the email; the ask is one line and one button at the bottom, naming what it buys — **a sterilisation costs €50–60**, and co-funding a share of one is the realistic rung. Never a subject line, never above the news, never in a report update, never in a verification message.

### 5.8 Unsubscribe

- One-click unsubscribe in every non-transactional email. No login, no "are you sure" page.
- `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so the mail client's own button works.
- Unsubscribing stops **all** cat news immediately. Updates on an open report continue unless they ask to stop those too — the page says so and offers the option.
- The page's second button is **delete my email address entirely** (§6). Unsubscribing keeps a suppression hash; deleting removes the address.
- Unsubscribe and delete tokens do not expire, because a year-old email must still work. That is a deliberate choice with a known cost: anyone who is forwarded the email can act on it. The harm is capped at unsubscribing or deleting a *contact address* — never at reading anything, never at access to any account, because there is no account.

---

## 6. Deletion, and the privacy policy

### 6.1 What deletion does, in one sentence

**We delete everything that identifies you; the cat sightings stay, with your name off them.** *(F3.)*

That sentence is the phrasing for the privacy policy, and the same words appear in the app, so the promise a person reads in the policy is the promise they see when they tap the button.

### 6.2 Self-service first — the device is the proof

Deletion is something a person does in the app, without contacting anybody. **This is the primary route, not a convenience.** *(F3, D6.)*

Three doors, all reaching the same place:

1. **Settings → Delete my data.** The main one. The device *is* the identity, so holding the unlocked phone is the proof of who is asking — there is no email round trip, no ticket, no wait.
2. **A delete link in every email we send.** For someone who gave an address and later changed their mind about the app itself, possibly from a phone that no longer has it installed.
3. **hello@catspotters.com** — the published fallback, for people who lost the device or would simply rather ask a human. Staff service these from the dashboard, on the legal clock, without Samuel in the loop. Self-service should reduce this to a trickle, which is the point: it saves the charity manual work and removes the risk of a deadline running out on a volunteer who never opened the email.

**Because the device is the identity, anyone holding the unlocked phone can trigger it.** Hence a clear confirmation, and hence no undo.

The **mechanism** — how a row is redacted in an append-only store, and the guard and test around it — belongs to `cat-record-data-spine.md`. This spec owns how deletion is offered and how it is explained.

### 6.3 The confirmation screen — the actual words

> **Delete my data**
>
> This removes everything that identifies you. **It can't be undone**, and we can't get it back for you afterwards.
>
> **What goes**
> Your email address, and anything we were about to send to it. Your points, your streak and your badges. Your spot history — the list of cats you've met and when. Anything you typed in a note. The link between you and every sighting you've ever sent us.
>
> **What stays**
> The sightings themselves, with your name off them. Which cat was seen, roughly where, and when — that belongs to the island's record of its cats, and taking it out would put holes in the history of cats that have nothing to do with you.
> Names you gave cats stay too. Other people call Agatha "Agatha" now.
> If you told us a cat lives with you, it still shows as having a home, and the note about where it lives stays. Your name and your link to it come off.
>
> **[ Delete my data ]**  ·  **[ Keep my data ]**

Two lines appear only when they apply (approved by Samuel, 29 Sep 2026, SYC-63 plan §9 B and E):

- When spots on the phone haven't been sent yet, under **What goes**: *"You have 3 spots that haven't been sent yet. They'll be deleted too."* (the real count).
- With no connection, the delete button is disabled, with: *"You need a connection to delete your data."*
- When cat reports on the phone haven't been sent yet (approved by Samuel, 7 Oct 2026, SYC-234), above the buttons: *"You have 1 cat report that hasn't been sent yet. We can send it to Syros Cats first, so they still hear about the cat, and then delete your data. Or we can delete it along with everything else."* The delete button becomes two: **[ Send it, then delete my data ]** · **[ Delete it too ]** (plural: "them"). If a report won't send, nothing is deleted: *"We couldn't send your cat report, so nothing was deleted. You can try again, or delete it too."*

A report already sent keeps its note when its reporter deletes their data; only the link to them goes (SYC-234).

And afterwards:

> **Done.**
> Nothing on this phone is linked to you any more, and we've no way to contact you. You can carry on spotting straight away — you'll start again from zero.
> If you also asked us by email, that request is already finished; there's nothing left to wait for.

### 6.4 What we can tell someone who asks

Anyone can ask what we hold for their address and get it back. Because we hold one field plus a consent record, this is a short honest export rather than a project.

### 6.5 The privacy policy

**Moved to its own document, `privacy-policy.md`** (Samuel, 28 September 2026), to be approved separately. It is published at **catspotters.com/privacy** and linked from every ask screen, every email and the store listing. This spec still owns the facts it states about email: what we ask for and when, the single "is this you?" message, what we send, how long we keep addresses, and how to withdraw. If this spec changes, the policy changes with it.


---

## 7. Sending identities and deliverability

### 7.1 Two identities, on two subdomains *(D2)*

Resend, with **two sending identities, two subdomains, two API keys, two quotas**:

| Identity | Subdomain | Carries |
|---|---|---|
| **Transactional** | `mail.catspotters.com` | Staff sign-in links **and staff sign-in verification**, welfare-report acknowledgements and outcomes, the welfare alert to the shared mailbox, receipts |
| **News** | `news.catspotters.com` | "Your cat was sterilised", visit summaries, **every verification message sent to a public app user (§7.3)**, anything else with an unsubscribe link |

**Why this exists, in one sentence:** cat news is batched, consumer-inbox, marketing-shaped mail that some people will mark as spam, and staff sign-in is a security-critical fifteen-minute link — sharing one reputation means a tourist's spam click can silently lock Susan out of the dashboard at the moment an injured cat is in the queue. Separate keys mean separate reputations and separate quotas, so news volume can never exhaust the allowance injured-cat reports depend on.

`team-access-and-welfare-queue.md` §2.3 is the single provider decision of record. This spec does not re-open it; it adds the split and the news identity's requirements.

### 7.2 The new-domain problem, named

`catspotters.com` is brand new. It has no sending history, and this product's normal rhythm is months of silence followed by one batch — which is, unfortunately, an excellent impression of a spammer warming up a stolen domain.

- **SPF, DKIM and DMARC on both subdomains before the first send.** Separate DKIM keys per identity — a shared key is a shared reputation, which defeats the split.
- **DMARC on the parent domain** with an explicit policy: start `p=none` with `rua` reporting so we can see what is happening, and move to `p=quarantine` before public launch.
- **Warm up before the first real batch.** The first "your cat was sterilised" send is the one that must not land in spam, because a failure there is silent — it looks exactly like nothing happening.
- **Keep the news identity sending.** Long gaps hurt. If a quarter passes with no news, a small "here's what happened on Syros this season" send to confirmed subscribers is better for deliverability than silence — but only if it is genuinely worth sending, and it needs its own row in §5.1 and its own consent before it exists.
- **Launch-day check, written into the runbook:** *sign-in link deliverability is unaffected by news complaints* — verified by sending both and checking the headers, not assumed from the DNS records.

### 7.3 Where verification sends from — decided

**Decision, recorded as an amendment to D2 on 3 September 2026: public-user verification sends from the NEWS identity. Staff sign-in verification stays transactional.**

Verification messages are, by definition, mail to addresses that a member of the public typed and that nobody has vouched for. They are the highest-complaint-risk mail in the system. Putting them on the identity that carries staff sign-in links would put the abuse vector and the door key on the same reputation — the exact outcome the split exists to prevent. So they move.

The options as they were weighed:

| Option | Benefit | Risk |
|---|---|---|
| **A. Verification on the transactional identity** (D2 as originally written) | Verification is transactional in character (a person just asked for it, they expect it immediately, it must not be delayed by a news batch); one fewer thing to configure | A mailbomb aimed at the capture endpoint generates complaints against the same subdomain that delivers sign-in links — the exact outcome the split was designed to prevent |
| **B. ✅ Verification for public app users moves to the news identity; staff sign-in verification, sign-in links and welfare mail stay transactional** | Restores D2's intent completely: the door key is on a reputation nothing untrusted can touch. No new DNS, no new provider — a different key on an existing send | Verification then rides a reputation shaped by news complaints, so a badly-behaved news list could delay the message a person is waiting on |
| **C. A third identity for verification alone** | Cleanest isolation of the riskiest mail | More DNS, more warm-up, a third reputation to keep alive on very low volume — probably worse deliverability than either of the above |

**Decided: B.** A delayed verification message costs one person a small wait; a degraded sign-in reputation costs the charity its dashboard on a bad day. Three consequences to build against:

- The verification sender is chosen by **who is verifying**, not by which screen they were on: every address typed in the mobile app — spot card, visit summary, welfare report, Settings — verifies from `news.catspotters.com`. Staff sign-in, owned by `team-access-and-welfare-queue.md`, verifies from `mail.catspotters.com`.
- **The priority budget in `team-access-and-welfare-queue.md` §2.10 shifts accordingly:** public verification now sits inside the news identity's allowance, so shedding news load can delay a verification message. It is shed *after* news and *before* acknowledgements, and never alongside sign-in or welfare mail, which are on the other identity entirely.
- §7.2's warm-up matters more for `news.` than it did, because a sign-in-critical message no longer rides transactional reputation but a person-waiting message now rides news reputation.

---

## 8. Keeping your spots safe: the one email that can restore them

**Decided by Samuel, 28 September 2026 (SYC-3).** A spotter's points, badges, named cats and collection must not vanish because a phone was reset, the app was reinstalled, or a browser was cleared. That matters most for children who have built up a collection. Two things together fix it.

### 8.1 Two separate emails, never merged

- **The news email** (everything in §§2–5) is a forwarding address for news about your cats. It is **not** a credential. Knowing it, or receiving mail at it, grants no access to anything, and it restores nothing.
- **The "keep my spots safe" email** is separate and opt-in. It exists only to restore a spotter's collection on another phone. It has its own consent, its own screen and its own warning, and it is never quietly promoted from the news address. A person may type the same address for both, but they are two separate choices, recorded separately.

Two devices that give the same *news* address are still two separate spotters: we never merge them and never tell either device about the other. Only the "keep my spots safe" email links a new device to an existing spotter, and only when the person holding that inbox asks for it.

### 8.2 Why the separation matters

A "keep my spots safe" address is a key: whoever can receive mail at it can take over that spotter. That means their points, their named cats, and their list of every cat they have visited, which roughly shows where they have been. Keeping it separate from the news address means nobody turns their news subscription into a key by accident, and the warning on the screen says so plainly.

### 8.3 How restoring works

**1. The key stays on the phone wherever the phone allows it (automatic).** The device's hidden key moves from ordinary app storage into the phone's secure storage. On iPhone it then survives deleting and reinstalling the app, with nothing for the user to do. It does not help on web, on Android reinstalls, or when switching between iPhone and Android. That's what the email is for.

**2. "Keep my spots safe" (opt-in).**

- **Where it's offered:** first and mainly at the end of onboarding (§3.0), where the screen leads with not losing your spots. It's always in Settings too. If someone skipped it at onboarding, it's offered once more, unprompted, when they first have something to lose (their first badge). Declining is one tap and it isn't asked again.
- **The screen says:** *"Add an email so you can get your spots back if you lose or change your phone. Anyone who can open this inbox can open your collection, so use an address only you (or a parent) can read. Under 15? Ask a parent to add theirs."*
- **Restoring:** on a new phone, onboarding offers *"Already a spotter? Get your spots back"*. You type the address and we send a link. Tapping it opens a page with one button, and pressing it moves the collection (points, badges, named cats, username) to the new phone.
- **The old phone is told** it has been signed out: *"Your spots moved to a new phone."* It stops acting as that spotter at its next request.
- **Safeguards,** the same as staff sign-in (`team-access-and-welfare-queue.md` §2.5–2.6): the link works once and expires in 15 minutes; it is used up only when the button is pressed, never just by opening the link, so email scanners can't burn it; requests are rate-limited; and the reply is identical whether or not the address is known.
- **It sends from the transactional identity** (`mail.catspotters.com`), because it is a sign-in, not news.
- **Deleting your data** (§6) removes the "keep my spots safe" address along with everything else.

### 8.4 What this changes elsewhere

- The fixed line under every news ask (§3) now says the news email is only for news, and points to "Keep my spots safe" for getting spots back.
- The privacy policy (`privacy-policy.md`) must describe the second email: what it is for, that it works as a key, and how to remove it.
- The message list (§5.1) gains the restore link and its confirmation.

### 8.5 The one honest interaction — and the profile we will not build

If someone reinstalls, their device id changes and the app no longer knows the new install is the same person. They will be asked again, and if they type the same address they will get another verification message. Mildly annoying, completely safe.

The previous version's fix for that was to "recognise the address on the mail side and not double-send news about the same cat to the same address". **That is dropped.** Doing it requires the mail system to hold a map from an address to the cats followed across every device that typed it — which is a cross-device profile keyed on email, and it sits directly against the promise that we do not build a profile from an address.

What we do instead is the narrow version only: a **send-suppression check on `(address, message, cat)`** so an identical message is not sent twice in the same batch. It carries no timestamps of activity, is never queryable by address, is never exported, and is deleted with everything else on deletion. If that turns out not to be achievable without accumulating history, we drop the dedupe entirely and accept the duplicate email — a duplicate is a much smaller cost than the claim it would break.

---

## 9. Technical notes (skip if you're reading for the decision)

- **Storage.** A table keyed on device id: address, status (`pending` / `confirmed` / `unsubscribed`), purpose flags, verification token hash, timestamps. A separate append-only consent-events table (§5.6), with redaction rather than deletion. A `notified_status` table for §5.3, written only by the notify job. Addresses never appear in logs, analytics events or push payloads.
- **Auth.** Every read or write of an address goes through the deviceAuth helper (`X-Device-Secret`, per `.agents/memory/device-secret-auth.md`). A device id alone never reveals or sets an address. The only form ever returned to a client is masked (`s•••@gmail.com`).
- **Tokens.** Verification, unsubscribe and delete tokens are long random values, stored hashed, single-purpose. Verification expires in 7 days; unsubscribe and delete do not expire (§5.8).
- **Held intents.** Anything waiting on verification is stored as a type plus its ids, never as rendered content (§4.3 step 4).
- **Rate limiting.** Uses the existing `express-rate-limit` setup in `artifacts/api-server/src/middlewares/rateLimit.ts`; a new limiter alongside `aiLimiter`, not a new mechanism. Per-address and global counters live in the database because they must survive a restart.
- **Escaping.** Cat names and free text are user-supplied and will appear in emails. They are escaped in HTML mail and never placed unescaped in a subject or header. A cat name also passes the moderation filter (`routes/cats.moderation.test.ts`) **at send time as well as at naming time** — the existing threshold was tuned for in-app display, and a name that is merely odd on a map is a different thing on the charity's letterhead. A name that fails at send time drops to "the cat you named" rather than blocking the email.
- **Blurring.** The email builders take the same public-precision path as any anonymous viewer (§3.3). No email path may call an exact-coordinate builder.
- **Testing.** Invariants worth asserting: no address in any public response · no send of any kind to an unverified address · the weekly cap holds when events cluster · unsubscribe stops sends within the same request · deletion removes the address and leaves sightings intact but unlinked · a decline is remembered across app restarts · two news declines stop news asks but **not** the report ask · the notify job sends nothing for an import batch · the notify job never sends on a negative or a death · an emailed summary contains no exact coordinate.

---

## 10. Risks and open questions

### 10.1 Risks

| # | Risk | Why it matters | Mitigation | Owner |
|---|---|---|---|---|
| **1** | **We collect addresses and then never send anything.** Cat news depends on Syros Cats recording sterilisations; report outcomes depend on the team queue producing them. | The biggest risk in the spec, and operational rather than technical. It converts the app's best moment into its worst. | **A real gate, not an intention.** Each of the four moments is behind its own flag, **default off**. A flag cannot be turned on until: (a) the message behind it exists and has been sent end-to-end on staging to a real inbox from the right identity; (b) a test asserts that path; and (c) for cat news specifically, the nightly job has run against real data for **two weeks** and produced at least one genuine, human-reviewed change. A startup check fails the boot if a moment is enabled with no sender registered, so this cannot rot. And if a moment is later withdrawn, everyone who gave an address under it gets the §5.1 message once — *"we're not going to be able to send you what we promised; here's how to delete your address"* — because pulling a moment does not discharge an obligation already taken on. | Samuel + Syros Cats |
| **2** | The ask damages the core loop. | The spot flow is the product; friction there costs spots, which costs data. | Card, not a step; below the reward, never above; dismissible; two news asks per install; measure resolve-to-completion before and after. | Samuel |
| **3** | Deliverability failure on a cold domain with months between sends. | The loop fails silently — we think we closed it, nobody sees anything. | §7 in full: split subdomains, separate DKIM, DMARC with reporting, warm-up, launch-day check. | Build |
| **4** | The capture endpoint is an outbound-abuse vector. | Complaints land on the charity's domain; the loop dies for everyone. | §4.4, in that order: per-address, per-IP (using the existing limiter), global ceiling failing closed, per-device as diagnostic only. Verification caps the ceiling; it does not remove the vector, and §4.2 says so. | Build |
| **5** | Consent drift — a future feature quietly emails the list something it didn't consent to. | Exactly how charities lose trust. | §5.1 is a closed enum with no free-text send path. A code-level constraint, not a convention. | Build |
| **6** | Email creeps into becoming a login. | §8. | Written down; any PR putting an address in an auth path is a spec violation. | Samuel |
| **7** | **Children give addresses.** Greece sets the age at which someone can consent to a service like this at **15**. The app ships publicly in October and the schools plan targets exactly this cohort. | This is a launch-day question in the base product, not something to revisit later. | The ask copy carries a single plain line rather than a tick box (which would make it a form): *"If you're under 15, ask a parent first."* The privacy policy says the same and commits to deleting on notification. No name, no age, no profile is collected either way. Confirm the position with Boundless before any schools programme ships. | Samuel |
| **8** | The notify job's baseline is mistaken for a source of truth by a later contributor, reintroducing the cached status column the data spine rejected. | The cat page and the emails would drift apart, and nobody would notice. | The table is named for its consumer, documented as write-only-by-the-job, and a test asserts the resolver never reads it. | Build |

### 10.2 Open questions

1. ~~**§7.3 — does verification send from the transactional identity or the news identity?**~~ **Closed 3 September 2026:** public-user verification sends from the news identity; staff sign-in verification stays transactional. Recorded as an amendment to D2 in `DECISIONS.md`.
2. ~~**Susan's standard reply text**~~ **Arrived 3 September 2026** and is in `docs/specs/source/syros-cats-standard-reply.md`; the report copy in `team-access-and-welfare-queue.md` §5.3 was rewritten against it and approved on 28 September.
3. **Does the donation path return an address at all**, or does the payment provider keep it? Determines whether §1.2(E) is ever ours to hold. *(Samuel + James.)* **Deferred until donations are built (Samuel, 28 September 2026)**, tracked on SYC-1. The working assumption is that the payment company keeps donor emails unless Syros Cats have a concrete need for them.

### 10.3 The one thing that genuinely needs Samuel's call

**Should the "follow this cat" ask appear on the very first spot, or wait until the second?**

- **First spot:** maximum capture, because a tourist may only ever make one or two spots, and the naming moment is strongest the first time. Risk: it reads as a sign-up prompt from a stranger, landing on someone who has used the app for ninety seconds.
- **Second spot:** asks someone who has demonstrably enjoyed it; higher yes-rate per ask; feels earned. Risk: we lose every one-spot tourist, who may be a large share of the audience.

**Decided (Samuel, 28 September 2026): ask on the first spot**, whether or not it was a new cat they named. The spot card appears on the reward screen of a person's very first resolved spot. The copy is stronger when they named the cat (§3.1) and otherwise uses §3.2. The earlier recommendation (first spot only for a named cat, otherwise wait until the second) is superseded. If they saved their spots and ticked news at onboarding (§3.0), the card doesn't appear at all.
