# Adversarial review — Team access and the welfare queue

**Target:** [docs/specs/team-access-and-welfare-queue.md](../team-access-and-welfare-queue.md) v1.0 (3 Sep 2026)
**Reviewer:** adversarial pass, 3 September 2026
**Evidence used:** the live magic-link implementation in `fairshake-au/catspotters-website` (`admin/src/index.js`, `admin/wrangler.jsonc`, `site/schema.sql`, `site/src/index.js`, `site/wrangler.jsonc`), this repo's API (`artifacts/api-server/src/app.ts`, `src/middlewares/rateLimit.ts`, `src/lib/deviceAuth.ts`), `threat_model.md`, `docs/DEPLOYMENT.md`, `docs/PRODUCT-SPEC.md`, `docs/specs/hosting-and-photo-storage.md`, `CLAUDE.md`.

**CONFIRMED** = verified against code or a project document. **PLAUSIBLE** = judgement, not verified by artefact.

Findings are ordered most severe first.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | No rate limit on the request-a-link endpoint | Critical | CONFIRMED |
| 2 | The report flow is a reflected mailbomb aimed at any address | Critical | CONFIRMED (design gap) |
| 3 | Urgent welfare reports have no alerting channel at all | Critical | CONFIRMED (spec silent) |
| 4 | The enumeration padding does not actually pad | High | CONFIRMED |
| 5 | Mail-scanner prefetch: the spec closes the wrong half | High | CONFIRMED |
| 6 | "One identity, one table" is already false | High | CONFIRMED |
| 7 | §8 is written for the wrong platform | High | CONFIRMED |
| 8 | A shared mailbox destroys the attribution claim | High | CONFIRMED |
| 9 | Urgent copy contradicts the app's own safety guidance | High | CONFIRMED |
| 10 | Vet list is "never blocks" but the advice is useless without it | Medium-High | PLAUSIBLE |
| 11 | Litter message offers only an asynchronous channel, then asks for money | Medium-High | PLAUSIBLE |
| 12 | "Not for us" reaching the reporter reads as refusal | Medium | CONFIRMED (spec text) |
| 13 | Cost and "nobody may come" land before submit — abandonment risk | Medium | PLAUSIBLE |
| 14 | Auto-hide is a one-device vandalism vector | Medium | CONFIRMED |
| 15 | Silent-loss paths between report and queue | Medium | CONFIRMED (spec silent) |
| 16 | Resend: claim holds, with three corrections | Medium | CONFIRMED |
| 17 | Roles-later: two things will need tearing up | Medium | CONFIRMED |
| 18 | The copy exists only in English | Medium | CONFIRMED |
| 19 | Privacy, retention, and a missing Reply-To | Medium | CONFIRMED |
| 20 | Smaller silences | Low | mixed |
| 21 | What is genuinely sound | — | — |

---

## 1. There is no rate limit on the request-a-link endpoint — Critical — CONFIRMED

**What is wrong.** §8.1 specifies token length, TTL, single use, cookie flags and constant-time comparison, and says nothing about how often a link may be requested. §8.4 scopes rate limiting to *report endpoints* only. The live code matches that omission: `admin/wrangler.jsonc` declares no rate-limit binding, and `requestLink()` throttles nothing. The neighbouring public-site worker gets this right — `site/wrangler.jsonc` declares `UNLOCK_RL` (8/min/IP) and `SUBSCRIBE_RL` (5/min/IP) and `site/src/index.js` has a `throttled()` helper — so the pattern exists in the codebase and the sign-in endpoint was simply left off it.

The same-origin check on `/api/signin` stops a browser on another site; it stops nothing from `curl`, because `Origin` is a header the attacker sets.

**Consequence.** Three, in ascending order of harm. A volunteer's inbox can be flooded with sign-in links by anyone who guesses her address. Unbounded `signin_tokens` rows accumulate (the opportunistic tidy-up only deletes rows a day past expiry, and only when someone signs in). Worst: every one of those requests spends a Resend send. Once this same key and quota carry welfare reports (§2.3's whole argument for one provider), **someone spamming the login form can silence the injured-cat emails**. That is a security bug that turns into a welfare failure.

**Fix.** Add per-IP *and* per-address limits to the sign-in worker on the same binding pattern the public site already uses — suggest 3 per address per 15 minutes and 20 per IP per hour, failing closed for the address limit. Cap outstanding unused tokens per address at 3. State the limits in §8.1 rather than leaving them to §8.4, which is about a different surface. Alert when either threshold is crossed.

## 2. The report flow is a reflected mailbomb aimed at any address — Critical — CONFIRMED (design gap; spec silent)

**What is wrong.** §4.2 collects an optional reporter email; §5.5 sends an acknowledgement "straight away", and one more on state change. The endpoint is public and unauthenticated (§8.4 says so). Nothing verifies that the submitter controls the address they typed. The spec never mentions this.

**Consequence.** The app becomes a free, attributable email cannon: submit N reports with `victim@example.com`, and `catspotters.com` sends N acknowledgements to a person who never asked. Beyond the harm to the victim, the complaints and bounces land on the sending domain's reputation — and that domain also sends the staff sign-in links. A spam-flagging event locks the team out of their own dashboard and buries welfare mail in Google Workspace spam. The per-device rate limit §8.4 proposes does not help: device identity is a client-generated string (`deviceAuth.ts` binds a secret to whatever id is presented first, trust-on-first-use), so an attacker mints a new device per request.

**Fix.** (a) Rate-limit acknowledgements per *recipient address*, not per submitter — at most one acknowledgement per address per day, regardless of how many reports name it. (b) Put a Turnstile or equivalent on the report submit (the `turnstile-spin` skill exists in this environment; a charity app with an unauthenticated public write endpoint is the textbook case). (c) Ingest Resend's bounce/complaint webhook and maintain a suppression list. (d) Say in §8.4 that the queue row is always written even when the acknowledgement is suppressed — suppression must never lose the report.

## 3. Urgent reports have no alerting channel at all — Critical — CONFIRMED (spec silent)

**What is wrong.** The spec names this as its own risk 3 — "a genuinely dying cat and nobody sees it for two days" — and every mitigation offered is passive: the queue sorts urgent to the top, the email has a distinct subject line, the copy is honest about response times, and *maybe* a phone number if Syros Cats want one. Nothing in the design wakes a human. The queue is a web page nobody has open; the email lands in a shared Google Workspace mailbox. On a Sunday in February with two people on the island, both surfaces are unattended, and the spec has no answer.

**Consequence.** The stated risk is not mitigated, it is documented. The failure mode is exactly the scenario the spec describes, and the reporter has been told in writing "someone will look at it".

**Fix.** Make the mitigation active. (a) An urgent report pushes a message into the channel Syros Cats already live in — the WhatsApp group that `DEPLOYMENT.md` §E confirms exists and is already being used to recruit testers — or a Telegram/SMS to one rota phone. (b) An escalation rule: any urgent report still in *New* after N hours re-notifies, and after 2N notifies a named person. Put N in the spec and let Syros Cats set it. (c) State actual hours in the copy ("someone usually looks in the morning") rather than the open-ended "someone will look at it". (d) Put the vet details *before* submit so the reporter can act independently of the charity's response time — that is the only mitigation that works at 3am. (e) Add to §10: "no urgent report sits in *New* longer than N hours" is the definition of done for this feature; today §10 has no time-based criterion at all.

## 4. The enumeration padding does not actually pad — High — CONFIRMED

**What is wrong.** §8.1 claims "the response, the status code, and the response *time* are identical either way — a padded delay before replying". The implementation adds a fixed 400 ms sleep *after* the work, not a deadline. For an address on the list, `requestLink()` performs an INSERT, a DELETE, and a full outbound HTTPS round trip to `api.resend.com` before that sleep; for an address that is not on the list it does one SELECT and then sleeps. The difference is the Resend call — typically 100–500 ms and highly variable.

**Consequence.** The endpoint is a working oracle for "is this address on the Syros Cats access list?", which is the exact thing the design says it must not be. Averaged over a few dozen requests the signal is unambiguous. Combined with finding 1 (no rate limit), an attacker can take as many samples as they like.

**Fix.** Two changes, both cheap. Move the send off the response path (`ctx.waitUntil(sendLink(...))`). Pad to a *deadline*: record `t0` at entry and `await sleep(Math.max(0, t0 + 800 - Date.now()))` before replying, so both branches return at the same wall-clock offset. Update §8.1's wording — as written it describes a mitigation that does not hold.

## 5. Mail-scanner prefetch: the spec closes the wrong half of the problem — High — CONFIRMED

**What is wrong.** §8.1 and the code both address prefetch with a conditional write, and the code comment states the goal: "two simultaneous visits ... would otherwise both find `used_at` empty and both be handed a session." That prevents *two sessions*. The common real-world failure is different: the scanner is the **only** consumer. Microsoft Defender for Office, Proofpoint URL Defense, Barracuda and Gmail's own link handling issue a GET on links in mail; `/auth` consumes on GET. The session cookie goes to the scanner, which discards it, and the human clicks a link that is already spent and sees "That link has been used already".

**Consequence.** A deterministic lockout loop for anyone whose mail passes through a scanning gateway — every fresh link is burnt before she reaches it. She cannot self-diagnose, and the spec's own §10 criterion ("from 'I have an email address' to 'I am looking at the queue' without anybody running a database command") fails. This is a support burden on a charity with no support function.

**Fix.** Do not consume on GET. `/auth?t=` renders a small page with one button ("Yes, sign me in") that POSTs the token; scanners do not POST. Keep the conditional write for the POST. As a belt-and-braces measure, allow the same token to be re-presented within 60 seconds and return the same session, and allow up to 3 unexpired outstanding tokens per address so a second attempt does not invalidate the first. §2.2 should stop framing single-use as an unqualified good and name this trade-off.

## 6. "One identity, one allow-list, one table" is already false — High — CONFIRMED

**What is wrong.** §2.4 recommends the dashboard on the app's own backend with "one identity, one allow-list, one place to add or remove a person", and §2.6 says removing someone is removing one row. But `site/schema.sql` already contains an `admins` table in the D1 database `catspotters-signups`, and `admin/src/index.js` authenticates `admin.catspotters.com` against it on every request. The app backend is a different codebase, a different platform and a different database (Express + Postgres on Replit — `DEPLOYMENT.md` §C, and `hosting-and-photo-storage.md` recommends deferring any move). §2.4's own risk column admits "the sign-in flow has to exist in a second codebase", and then the rest of the spec writes as though it does not.

**Consequence.** Two people tables in two databases on two platforms. Removing a departing volunteer takes two deletions in two systems — precisely the failure the design is meant to prevent, and precisely the one nobody remembers to do twice. The claim in §10 that no one needs a database command is not achievable while `admins` is edited by hand in D1. Additionally, `admin/wrangler.jsonc` documents that the workspace **shares its `SIGNING_KEY` with the public site worker**, so a session cookie for the workspace can be minted by any code holding the public site's secret; extending "the document workspace recognising the same person" to a third system means spreading that key further, and the spec does not describe the trust link at all.

**Fix.** Say explicitly which table is canonical and how the other is derived — either `admin.catspotters.com` calls the app API to authenticate (and `admins` is deleted), or `people` is the source and `admins` becomes a synced read-only projection. Then specify the cross-system trust: a shared HMAC key is workable but must be a *separate* key from the public site's document-gate key, so a compromise of the public gate cannot mint admin sessions.

## 7. §8 is written for the wrong platform — High — CONFIRMED

**What is wrong.** §8.1 and §8.2 assume Cloudflare Workers: `wrangler secret put`, a `__Host-`-prefixed cookie, D1-style conditional-write-with-`RETURNING`, "platform binding". That is the *website* worker's world. The dashboard per §2.4 lives on the app backend, which is Express on Replit: `app.ts` calls `app.use(cors())` (wildcard origin), sets `trust proxy: 1`, and `rateLimit.ts` uses `express-rate-limit` with the default in-memory store.

**Consequence — three concrete collisions an implementer hits on day one.** (a) Wildcard CORS cannot be combined with credentialed requests, so a cookie-session dashboard on a different origin from the API simply will not work until CORS is rewritten to an explicit allow-list with `credentials: true`. (b) `__Host-` cookies are host-only: the dashboard must be served from the same origin as the API, and **the spec never says what URL the dashboard has**. That is a blocking unknown, not a detail. (c) `express-rate-limit`'s MemoryStore is per-process; Replit autoscale runs multiple instances, so §8.4's limits are silently multiplied by the instance count and reset on every deploy.

**Fix.** Name the dashboard's origin in the spec. Specify the cookie strategy across `api.`, `admin.` and the app's web host. Replace wildcard CORS with an allow-list plus credentials. Use a shared rate-limit store (or Cloudflare in front) so limits are real. Rewrite §8.1/§8.2 in platform-neutral terms with a note of what changes if hosting moves — `hosting-and-photo-storage.md` deliberately leaves that open, so this spec must not quietly assume an answer.

## 8. A shared mailbox destroys the attribution claim — High — CONFIRMED

**What is wrong.** §2.2's central argument is that a shared password means "nobody can prove who used it", and that the mailbox fixes this. But `admin@syroscats.com` is a Google Workspace mailbox read by several people (PRODUCT-SPEC §1), and it is also the destination for every welfare report — so mailbox access is deliberately broad. If that address is added to the people table (nothing stops it; the schema is `email TEXT PRIMARY KEY`), then everyone with mailbox access is one identity, the sign-in link is readable by all of them, and §3.3's "every correction records who made it" and §7.3's "every change is attributed" record a mailbox rather than a person.

**Consequence.** The stated advantage over shared passwords evaporates for the most likely first row anyone adds — and it will be the first row, because it is the address everybody knows.

**Fix.** Forbid shared and role addresses in `people`, and validate it on insert with a short deny-list (`admin@`, `info@`, `hello@`, `contact@`). Say plainly in §2.6 that the shared mailbox is a *recipient*, never an *account*. Each person gets their own address; if a volunteer has no work address, a personal one is correct and is what the design assumes.

## 9. The urgent copy contradicts the app's own safety guidance and carries duty-of-care risk — High — CONFIRMED

**What is wrong.** PRODUCT-SPEC §2.2 requires onboarding screen 2 to carry health-and-safety guidance — "don't get too close". §5.3's urgent block then tells a tourist that the fastest help is to pick up a badly hurt street cat and carry it to a vet, with no handling guidance whatsoever. The two pieces of copy are in the same app, days apart.

Three problems compound. (a) **Physical risk**: a frightened injured cat bites and scratches, and the consequences (infection, cat-scratch disease, tetanus, a ruined holiday) fall on a person the app just encouraged. (b) **Financial ambiguity**: "the vet will normally charge you for the visit" is the only money statement, and it is silent on reimbursement — a reasonable reader assumes a charity that asked them to do this will settle up. It should be explicit that it will not, unless agreed in advance. (c) **Decision exposure**: whoever presents the animal may be asked to authorise treatment, or consent to euthanasia. The copy invites a tourist into that position with no warning.

**Consequence.** A foreseeable injury, an unbudgeted bill the charity is then asked to cover, or an angry reporter — any of which damages Syros Cats more than the unreported cat would have.

**Fix.** Add one handling line to the urgent block: an injured cat will bite even when it knows you — use a towel and a box, never bare hands, and do not attempt it if you are alone or unsure. Add one money line: the charity cannot reimburse vet costs unless agreed with them beforehand. Have the whole urgent block signed off by Syros Cats *and* checked against whatever liability/insurance position Fair Shake is taking, before launch — this is not a copy tweak that can be swapped from configuration after the fact.

## 10. The vet list is filed as "never blocks", but the urgent advice is useless without it — Medium-High — PLAUSIBLE

**What is wrong.** §9.2 lists "a named list of Syros vets with hours and phone numbers" as an open question that "makes 'go to a vet' actionable rather than aspirational. Without it the guidance is weaker but still correct." It is not still correct. The urgent variant's entire structure is "we may not come, a vet is faster, here is a vet" — remove the third clause and it becomes "we may not come" with a placeholder underneath. It is also silent on out-of-hours: a small-island vet at 9pm on a Sunday is exactly the moment the urgent path matters most.

**Fix.** Promote the vet list to a launch blocker *for the urgent variant specifically* (the rest of the flow ships without it). If Syros Cats cannot supply out-of-hours coverage, the copy must not lead with "a vet is the fastest help" — it must lead with what a person can actually do tonight: somewhere safe, water, no food if the cat is badly hurt, and send the report.

## 11. The litter message offers only an asynchronous channel, then asks for money — Medium-High — PLAUSIBLE

**What is wrong.** The stated goal is to stop someone turning up with kittens. The mechanism offered is "contact Syros Cats first" plus an **email address** (the phone number is a placeholder). A person crouched over a cardboard box will not email and wait. As drafted, the message states a rule it gives no means of following. Separately, the block closes with the €50–60 sterilisation ask — a fundraising line landing immediately after "if they are truly in danger", on the screen of someone upset.

**Fix.** The litter block needs a synchronous channel — a phone or WhatsApp number — or it does not do its job; treat that as a dependency with the same weight as the vet list. Move the donation ask out of this moment and into the acknowledgement email, where it reads as gratitude rather than as a toll. Add the one line that actually changes behaviour: what to do *right now* if you cannot reach anyone (leave them, watch from a distance, come back in an hour — the mother is almost certainly nearby).

## 12. "Not for us" reaching the reporter reads as refusal — Medium — CONFIRMED (spec text)

**What is wrong.** §3.1 names the four queue states, and §5.5 sends the reporter a message when the state moves to *Looking at it*, *Done* or *Not for us*, "with a sentence the team can edit before it sends". Editing is optional. A tourist who reported a bleeding cat and receives an email whose subject or body carries "Not for us" has been told, in the charity's own voice, that the animal was not their problem.

**Fix.** Reporter-facing wording is fixed copy per state, authored separately, never the internal label — the state names are an internal shorthand and must not leak. For this state in particular the message must say what *did* happen ("we looked, and this one is better handled by X / the cat had already moved on / it is a healthy community cat someone is feeding") and what the reporter can do next. Make that copy mandatory, not an editable optional extra.

## 13. Cost and "nobody may come" land before submit — Medium — PLAUSIBLE

**What is wrong.** §5.2 deliberately places the guidance on the severity step, before submission. The two most discouraging sentences in the whole spec — "there may not be anyone free to come out today" and "the vet will normally charge you for the visit" — are therefore the first response the app gives a frightened person. §5.2's reassurance is "the report always goes through", but that is only true of a report the person finishes.

**Consequence.** Abandonment at the severity step yields nothing: no data, no cat, no record — the exact outcome §5.1 says the charity most wants to avoid ("the charity still wants the data").

**Fix.** (a) Persist a draft the moment severity and location are set, so an abandonment still leaves a row the team can see. (b) Lead the urgent block with the encouragement ("Send this — it takes thirty seconds and it tells us where this cat is") and put the caveats below it. (c) Move the cost sentence to the confirmation screen and the acknowledgement email, where it informs rather than deters. (d) Add abandonment rate at the severity step to what gets watched during the September test — the WhatsApp testers include actual tourists, which is the only way to find out whether this lands.

## 14. Auto-hide is a one-device vandalism vector — Medium — CONFIRMED

**What is wrong.** §6 hides a photo "immediately, automatically, before any human looks at it" on a single unauthenticated report. The stated counter-abuse measure is that "repeated reports from the same device that are all overturned are a signal the team can see". Device identity does not support that: `deviceAuth.ts` implements trust-on-first-use — the first request presenting a secret for an id binds it — so an attacker generates a fresh id and secret per report at zero cost. `threat_model.md` records the same weakness from the other direction.

**Consequence.** One short script hides every photo in the catalogue, one report at a time, and the only remedy is a volunteer restoring them by hand. For a public gallery this is a cheap, high-visibility act of vandalism, and the mitigation named in the spec is void.

**Fix.** Keep auto-hide — the reasoning for it is right — but gate it: require reports from N distinct devices *and* IPs, or auto-hide only from public views while the photo stays visible to staff and its uploader, plus a Turnstile on the report action and an alert when hide volume exceeds a daily threshold. Rewrite the mitigation sentence in §6 and in §9.1's "below the top three" list; both currently rest on device identity meaning something.

## 15. Silent-loss paths between report and queue — Medium — CONFIRMED (spec silent)

**What is wrong.** §8.2's architecture is right — the queue row is the source of truth and the email is a notification, queued with retry — but four loss paths remain unaddressed. (a) An offline-queued report on a phone that is reinstalled, wiped, or flown home never sends; §4.3 is honestly worded, but nothing expires the draft, reminds the user, or tells the charity a report existed. (b) A persistent mail failure "surfaces in the dashboard" — the surface nobody is watching out of hours (see finding 3). (c) Photo upload succeeding or failing independently of the report row is unspecified: a queue row with no photo is a report the team cannot triage. (d) There is no reconciliation between rows created and mail delivered — Resend's delivery webhook is not mentioned anywhere.

**Fix.** Expire and remind on unsent offline reports (a local notification after 24 hours: "you have a cat report that hasn't sent"). Route persistent send failure to the same second channel as urgent reports. Specify photo-upload failure behaviour explicitly — the row is written first and the photo attaches after, with a visible "photo pending" state. Ingest Resend's `delivered`/`bounced` webhooks and show delivery state per report, so "did they get it?" has an answer.

## 16. The Resend recommendation — it survives, with three corrections — Medium — CONFIRMED

The claim I was asked to check is **true**: Resend delivers to arbitrary recipients with no recipient-side verification. The existing `sendLink()` posts to `api.resend.com/emails` with `to: [email]` and no recipient enrolment step of any kind. So welfare mail can reach `admin@syroscats.com` without anyone at Syros Cats clicking anything, and **SYC-30 genuinely comes off the critical path**. §2.5's key handling is also sound and matches the code (`env.RESEND_API_KEY` read from the platform secret store, never logged — `sendLink()` logs the response status and body on failure, not the key).

Three corrections:

- **The blocker moves, it does not disappear.** Sending to arbitrary recipients requires a *verified sending domain*. Until `catspotters.com` is verified, Resend restricts sending to the account owner's own address. So §2.3's "does not need admin@syroscats.com to be verified by anybody at Syros Cats first" is true only after the DNS records land — the dependency shifts from Syros Cats' inbox to Samuel's DNS, which is better but is not nothing, and §9.3 should say so.
- **"Free tier comfortably covers this volume" is unquantified and load-bearing.** The free tier is on the order of 100 emails/day and 3,000/month (re-check current limits before committing). One key and one quota now carry sign-in links, acknowledgements, status updates, team notifications and issue reports — with no rate limit on either the sign-in endpoint (finding 1) or the acknowledgement path (finding 2). The daily cap is the shared point of failure where login abuse silences welfare mail. State the actual limits, budget for the paid tier, and **use two API keys with separate quotas** — one for staff sign-in, one for public-facing mail — so abuse of the public surface cannot lock the team out.
- **The single-provider failure mode is named but not built.** "Cloudflare Email Sending is the fallback and requires no code rethink" is a plan, not a fallback. §8.2's one-send-function shape is the right foundation, but there is no health check, no automatic failover, no cutover runbook, and Google sign-in (option D) rescues only sign-in — reports have no second path at all. Add: a send-failure threshold that raises a dashboard banner and a second-channel alert, and a written half-page cutover procedure so the answer to "Resend is down on a Sunday" is not "wait for Samuel".

**Verdict: the Resend recommendation survives review.** Options B and C are correctly rejected, and the reasoning against Google Workspace SMTP (an app password is a reusable key to the charity's whole mailbox) is right. Adopt it with the DNS caveat stated, quotas and rate limits specified, and separate keys.

## 17. Roles-later: mostly the right shape, two things will need tearing up — Medium — CONFIRMED

§7.3's instincts are good — capability checks rather than role checks, attribution from day one, invitation as the only way in, colony membership already existing. Two of the six will not survive contact:

- **`role` and `scope` as scalar columns are the retrofit the section says it is avoiding.** A cat guardian looks after *several* colonies, and real people hold two roles at once (a staff member who is also a guardian of her own alley). A single `scope` column forces either a delimited string or the exact migration §7.3 warns about. Make it a `person_scopes` join table (person, role, colony_id) now; the cost today is one small table and it removes the only genuine rework risk in the access model.
- **The capability function is asserted but its capabilities are never named.** Without an enumerated set, "can this person do this?" becomes `isStaff()` with extra steps, and the screens still encode the assumption. List them in the spec — `view_exact_location`, `hide_photo`, `rename_cat`, `set_life_status`, `set_sterilisation`, `set_site_public`, `change_report_state`, `manage_people` — and have the dashboard call them by name from the first commit.

The larger rework risk is finding 6, not the role column: if two people tables exist on two platforms, guardians will arrive into that split and the "no rebuild" claim in §10 fails for reasons that have nothing to do with roles.

## 18. The copy exists only in English — Medium — CONFIRMED

**What is wrong.** The app ships in English, Greek and French (PRODUCT-SPEC §2.1; SYC-4 native-speaker review is still open). Every word in §5.3, the acknowledgement email, the per-state reporter messages and the queue's reporter-facing strings is English-only, and the spec never mentions translation. §5.6's "never blocks — it is a copy swap" is true for English; Susan's reply arriving in English still needs Greek and French versions by a native speaker, on a path SYC-4 already flags as outstanding.

**Consequence.** Either the most emotionally sensitive copy in the product ships English-only to a Greek island, or translation appears as an unplanned dependency in the final week before launch.

**Fix.** Name translation as a dependency in §9.2 with an owner and a date. Store the reporter's language on the report row so the acknowledgement and the status update go out in the language they used. Note in §5.6 that the swap is a copy change ×3, not ×1.

## 19. Privacy, retention, and a missing Reply-To — Medium — CONFIRMED

**What is wrong.** §8.5 covers visibility rules well, and consent/purpose/deletion are stated. Four gaps:

- **No retention period** for reports, report photos or reporter email addresses. "Deletable on request" is not a retention policy, and GDPR expects one.
- **The one-click delete needs a mechanism** — an unauthenticated endpoint carrying a signed, expiring token — and §8 does not specify it. Done casually it becomes an enumeration surface of its own.
- **The privacy policy and the data agreement are unnamed dependencies.** `DEPLOYMENT.md` §A requires a privacy policy at store submission covering photos, location and email. This feature adds a new category: a precise location plus a photo that may include bystanders, vehicles and property, emailed to a third-party mailbox and stored by a third-party mail provider. That is a disclosure the policy must carry before submission, and the Syros Cats ↔ Fair Shake data agreement should cover it. Add both to §9.2.
- **No `Reply-To`.** The acknowledgement in §5.3 is sent from `catspotters.com` and signed "Syros Cats · admin@syroscats.com". A reporter who replies — and they will, with exactly the update that matters ("it has moved, it's outside the bakery now") — reaches whatever `MAIL_FROM` is, which is `hello@catspotters.com` and which SYC-30 is precisely the ticket for *descoping*. Set `Reply-To: admin@syroscats.com` explicitly and say so in §8.2, or that reply is lost.

## 20. Smaller silences that will bite — Low

- **No acceptance tests are named for the security mechanics.** This repo tests routes properly with vitest (`sightings.upload.test.ts`, `profiles.auth.test.ts` and others). Single-use consumption, allow-list-checked-before-mint ordering, response-time padding, and each rate limit should each have one named test in the implementation plan.
- **No session revocation for a stolen cookie.** Removal from the list works (verified: `session()` re-queries `admins` on every request — this claim in §2.6 is true). But a leaked cookie is valid for thirty days and the only remedy is rotating the shared signing key, which signs everyone out including the document hop. Add a `session_version` integer per person, included in the signed payload.
- **`/auth` has no origin check**, so login-CSRF is possible: an attacker can sign a victim's browser into the attacker's session and observe what she then enters. Low impact here, one line to close.
- **`record_changes` has no reversal story and no visibility rule** — who can read the log, and can a correction be undone, or only re-corrected?
- **Report photos depend on the object-storage migration** (SYC-46, `hosting-and-photo-storage.md`), which is a separate in-flight spec. §8.3 assumes it has landed. State the dependency.
- **No stated cut line.** `DEPLOYMENT.md` §D already names the staff dashboard as one of the three items that can slip without moving launch. This spec adds six tables, a sign-in, a dashboard, a public report flow, a mail dependency and copy in three languages — inside the same window as the store submissions. Say what ships if the window bites (suggestion: report flow + mail + queue ship; feeding-site map and colony naming slip to hardening).
- **`threat_model.md` is stale** on two points this spec touches — it says no rate limiting exists (it does, `rateLimit.ts`) and that device ids are unverified (they are now secret-bound, TOFU). Worth a refresh pass alongside this work so the next reviewer is not misled.

## 21. What is genuinely sound

One line each, as asked:

- **§8.2's mail architecture** — queue row as source of truth, email as a notification, queued with retry, failures logged loudly and never swallowed — is the best decision in the technical section and should not be touched.
- **The placement of capacity messaging** (two moments, before and after, and the report always goes through) is right; the problem is the wording, not the structure.
- **The queue's four states and its refusal to become a ticketing system** is correct for a team this size.
- **Private-by-default feeding sites with per-site, attributed toggles and no bulk action** matches PRODUCT-SPEC §1 exactly and is right.
- **Escaping reporter text in HTML and never interpolating user input into mail headers** are both correctly identified.
- **Rejecting Google Workspace SMTP** — an app password being a reusable key to the charity's mailbox — is the right call for the right reason.
- **The session-ends-at-next-request claim** is verified true against the code.
- **Canonical facts all check out**: €50–60 per sterilisation (twice, never €25); "spotter"; "cat guardian", never colony carer; "clipped tip", never notched; the two audiences described as complementary in §1; and §4.3's offline wording is precise and does not overclaim — it says the report is saved on the device and sends when signal returns, which is exactly right.
