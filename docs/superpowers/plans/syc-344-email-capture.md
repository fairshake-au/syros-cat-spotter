# SYC-344 / SYC-45: email capture v1 (implementation plan, for Samuel's approval)

**Linear:** SYC-344 (this plan) · SYC-45 (the build) · SYC-55 (the "your cat was sterilised" email, which Slices 1 and 3 deliver) · SYC-42 (Slice 3, the reporter's email, PR #181) · SYC-3 (keep my spots safe; the shared "is this you?" tables) · SYC-63 (Delete my data) · SYC-358 (mail priority budget) · SYC-346 (Johnny's copy pack) · SYC-283 (the native-language check of email copy).
**Status:** **draft for approval.** Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/email-capture.md`, approved by Samuel on 28 September 2026 · `team-access-and-welfare-queue.md` §2.10 (the mail priority budget) · `cat-record-data-spine.md` (the resolver the nightly job calls) · `DECISIONS.md` (D2 amendment, F4, F7b).
**Checked against:** `origin/main` at `90fc6d6` (15 Oct 2026); **PR #181 at head `dd9ceeb`** (SYC-42 Slice 3, open, read in full with `gh pr diff 181`); PR #172's launch plan (`docs/superpowers/plans/mvp-launch-31-oct.md` on `claude/xenodochial-zhukovsky-df315f`, not yet approved); Linear SYC-344, SYC-45, SYC-55, SYC-358. Every "exists today" claim below names the file it was read in.

---

## In plain English

**What this adds.** Today the app can take an email in two places: "keep my spots safe" (SYC-3, on `main`) and, once PR #181 merges, a cat report ("Shall we tell you what happens?"). Neither sends any **cat news**. This plan adds the rest of the approved spec:

- **A nightly check** that notices when a cat someone follows has genuinely good news: it was **confirmed sterilised**, it **found a home**, or it was **spotted again after four months or more**. It never sends anything about a death, a "presumed dead", a "not sterilised", or a "likely sterilised".
- **The cat-news email** that check sends, at most once a fortnight and eight times a year per person, with a one-tap "stop" in every email.
- **The asking screens:** a card on the screen you see after a spot ("You named Agatha. Want to know how they get on?"), a "News about your cats" row in Settings, the unticked news box on the "Don't lose your spots" onboarding screen, and the unticked news box on the cat report's email screen.

Every address still gets exactly **one** "is this you?" email first, and nothing else until the person says yes. That part is PR #181's, and this plan reuses it rather than building it twice.

**Why most of it can't be switched on at launch, whatever we build.** The approved spec says no news ask may be switched on until the nightly check has run on real data for **two weeks** and found at least one genuine change that a person has looked at (spec §10.1, Risk 1). That rule exists so we never collect addresses and then send nothing. So the useful thing to do before 31 October is to **start that two-week clock**: build the nightly check first, in "watch only" mode, sending nothing. The earliest any news ask can go live is then about two weeks after that check starts. Decision 1 asks Samuel to confirm this.

**What cutting it costs.** Nothing a reporter needs. PR #181 owns the reporter's "is this you?", acknowledgement and outcome emails, the consent records and the do-not-email list. Email capture only **adds** to them. If every slice here is dropped, reporters still leave an email and hear back exactly as #181 builds it.

**The order, in one line.** The nightly check in watch-only mode (starts the clock) → the news address and the Settings row → sending cat news → the after-a-spot card → the two news boxes (onboarding and report). Each slice ships switched off and can be dropped from the end without touching the ones before it. The visit summary is proposed for after launch (Decision 2).

---

## Where the spec, the code and PR #181 disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something the spec didn't.

| # | What the spec says | What is true on `main` or in PR #181 | What this plan does |
|---|---|---|---|
| C1 | §10.1 Risk 1: news flags stay off until the nightly job has run **two weeks** on real data and produced a genuine, human-reviewed change | Launch is 31 Oct (PR #172, unapproved). No job exists. Building it the week of 19 Oct means the earliest switch-on is about 6–9 Nov | Slice 1 builds the job **first**, in watch-only mode, to start the clock. **Decision 1** |
| C2 | §5.3: the job calls the resolver for "status, with the provenance and `observedAt` of the observations that produced it" | `resolveCat` in `artifacts/api-server/src/lib/resolve.ts` returns `Resolved<T>` with `supportingObservationIds` and `asOf` (line 22–31), not provenance. The wrapper the routes use, `deriveCatStatuses` (`lib/catHelpers.ts:294`), drops both | The job calls `resolveCat` directly and looks up the supporting observations' `provenance`, `observed_at` and `created_at` itself (one read-only query). The resolver is not changed. A test asserts the resolver never reads the job's table (Risk 8) |
| C3 | §4.3: one "is this you?" per typed address; §9 "a table keyed on device id" | `email_contacts` (`lib/db/src/schema/email.ts`) already allows `purpose = 'news'` with an address and a device id. Nothing stops two news rows per phone | Slice 2's migration adds a partial unique index: one news row per phone |
| C4 | #181 builds **all** "is this you?" sending | PR #181's `outbox.ts` sends **every** `public_verify` row through `processReporterMail` (`REPORTER_PURPOSES` includes `public_verify`), and `confirmAddress`, `forgetAddress` and `tokenIsLive` (`keepSafe/service.ts`) treat any contact that isn't `report` as keep-safe | Slice 2 routes `public_verify` by the **contact's purpose** (report → #181's code, news → a new `processNewsMail`), and adds a `news` branch to those three functions. Told to the #181 session on 15 Oct; #181 isn't asked to change |
| C5 | §3.4: the report screen gets an unticked "Also email me news about the cats I've met" | PR #181 leaves it out on purpose (its `i18n.ts` comment: "the second is about news, which a report address never gets") | Slice 5 adds it to #181's email screen. **Decision 3** is whether one "is this you?" covers both |
| C6 | §3.0: the onboarding news box | `KeepSafeScreen.tsx` (lines 22–23) hides it "until SYC-45 builds news" | Slice 5 shows it |
| C7 | §4.4 control 1: "one verification per **address** per 24 hours; three in its lifetime" | Fingerprints are keyed **per purpose** (`lib/mail/fingerprint.ts`), so a report fingerprint never equals a news fingerprint (SYC-3 review A3). #181 counts its caps on report fingerprints only | News counts its own caps the same way. So one address can get one report "is this you?" **and** one news "is this you?" in a day (two, not one). The shared daily ceiling and per-IP limit still cover both. Decision 3, option A, removes the commonest case (both typed on one screen) |
| C8 | §5.8: "One-click unsubscribe … no 'are you sure' page" | Email security scanners open every link in an email. SYC-3 and #181 therefore never act on a link being opened: their pages show one button (`routes/mailPages.ts`) | The mail app's own unsubscribe button is genuinely one click (the standard `List-Unsubscribe-Post` header). The link in the email opens a page with one **Stop emailing me** button. **Decision 4** |
| C9 | §5.5: a report-only address is deleted 90 days after the report closes | PR #181 forgets an **unconfirmed** report address after 7 days (`keepSafe/sweep.ts`). The close + 90 days deletion is **planned but not built**: SYC-42 plan item 4.3 (`syc-42-cat-in-trouble.md:248`) | Not email capture's to build: it's a promise to reporters, and it must survive email capture being cut. Tracked as SYC-371 so it isn't lost |
| C10 | §5.1: cat news "from the news identity" | `send.ts` on `main` already lists `cat_news`, `visit_summary` and `promise_withdrawn` on `news.catspotters.com`, all **off** | Slice 3 switches on `cat_news` only |
| C11 | §5.3: seed the baseline as a records import lands | No records import exists (optional, after MVP: `records-import.md`) | Slice 1 exports `seedNewsBaseline(catIds)` with a test, and the import plan must call it. Nothing else to do now |
| C12 | §2.4: "Saving spots without ticking news leaves both news asks in place, **with the address filled in**" | A keep-safe row never holds the address (Decision 4 of SYC-3, enforced by a database check), and the phone keeps only the masked form (`lib/keepSafe.ts`) | The address can't be filled in without storing it somewhere the SYC-3 design refused to, and a masked hint ("Use s•••@gmail.com?") can't work either, because we can't send to a mask. Small call S6: the box starts empty |

---

## Decisions for Samuel

Four, one at a time. Each has a recommendation.

### Decision 1: When do the news asks go live, given the two-week rule? (C1)

**The question.** The approved spec won't let any news ask (the after-a-spot card, Settings, the two news boxes) be switched on until the nightly check has run for two weeks on real data and found at least one real change that someone has looked at. That rule stops us collecting addresses and then never writing. It means **no news ask can be live on 31 October** unless the rule is waived.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Build the check first, switch the asks on when the rule is met (recommended)** | Slice 1 (watch-only check) lands the week of 19 Oct. The asks are built behind switches that stay off. Earliest switch-on about 6–9 Nov, after Samuel looks at what the check found | Keeps the spec's promise. Starts the clock as early as possible. Nothing a visitor sees depends on email capture at launch, so it can slip with no visible cost | Visitors in the first week or two after launch aren't asked. Late October is the end of the season, so that's a small number |
| B. Switch the asks on at launch, waiving the two-week rule | Everything built by 29 Oct and switched on | Catches the last of the season's visitors | Breaks the spec's biggest safeguard. If the check misfires or Syros Cats record nothing, we've collected addresses we can't honour. Also competes with launch-week work for the first thing Samuel agreed to cut |
| C. Build nothing before launch | All of it after 31 Oct | Frees the week of 19 Oct entirely | The clock starts later, so switch-on is late November at best |

**Recommendation: A.** It costs one small, low-risk slice before launch (the check sends nothing), keeps the safeguard, and leaves everything else free to slip.

### Decision 2: Build the visit summary now, or after launch?

**The question.** The spec's third moment is the visit summary ("You've met 14 cats on Syros. Want the list sent to you?"). **There is no visit summary in the app at all today** (no screen, no wording in `lib/i18n.ts`). Building it means a new in-app screen, the "two separate days, last spot over 18 hours old" trigger, and an email listing cats with blurred locations. That's the biggest piece of the spec by far.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. After launch, as its own ticket (recommended)** | This plan builds the card, Settings and the two news boxes. The visit summary gets its own plan before next season | Keeps this plan small enough to finish. The summary matters most in the summer, not November | The second news ask (§2.4) doesn't exist until then, so someone who says no to the card is only asked again via Settings |
| B. Build it in this plan as Slice 6 | All four moments | The spec in full | Roughly doubles the work, and none of it could be switched on before mid-November anyway |

**Recommendation: A.** Filed as a new ticket (see "Linear").

### Decision 3: One typed address, two choices: one "is this you?" email or two? (C5, C7)

**The question.** On the report's email screen, someone types their address and ticks "Also email me news about the cats I've met". That's two separate consents (spec §3.4: "Separate purpose, separate consent"). Do they get one "is this you?" email or two?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. One email confirms both (recommended)** | One "is this you?". Pressing "Yes, that was me" confirms the report address and the news address typed on the same screen. Both consents are still recorded separately, and either can be withdrawn alone | One email, which is what the person expects. Halves the mail a stranger can cause by typing someone else's address. The fixed email doesn't mention a purpose, so its words stay true | A little more code in the confirm step (it confirms a second row) |
| B. Two separate emails | Each purpose sends its own | Simplest code | Two identical-looking emails seconds apart. Feels broken, and doubles what a prankster can cause |

The onboarding screen is different and stays as the spec says: "keep my spots safe" sends its own transactional "is this you?" (it's a key to the person's collection, with different words), and ticking news sends the news one. That's two emails there, by design.

**Recommendation: A.**

### Decision 4: The unsubscribe link: a page with one button, or truly one click? (C8)

**The question.** The spec says unsubscribing is one click, with no "are you sure" page. But email security scanners open every link in every email. If opening the link stopped the emails, a scanner would unsubscribe people who never asked.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. The mail app's button is one click; the link opens a page with one button (recommended)** | Gmail's and Apple Mail's own "Unsubscribe" button works in one tap (the standard header, a POST that scanners don't send). The link in the email's footer opens a page saying "Stop cat news emails" with one **Stop emailing me** button, and a second **Delete my email address** button (spec §5.8) | Nobody is unsubscribed by a scanner. Matches how SYC-3 and #181 handle every link. The page asks nothing ("are you sure?") — it's just the button | One extra tap from the footer link |
| B. Opening the link unsubscribes | Literal one click | Fewest taps | Scanners unsubscribe real subscribers silently. We'd never know |

**Recommendation: A.**

### Small calls this plan makes (object to any, otherwise they stand)

- **S1. News emails are in English for everyone at first**, the same rule Samuel set for the reporter's emails on 15 Oct, until Johnny checks the Greek and French (SYC-283). The app's screens are in all three languages. Greek and French drafts of the email are in this plan for the pack.
- **S2. The cat-news email carries no location at all**, not even the blurred one. It names the cat and what happened. Safer than the spec's minimum (§3.3 asks for public precision) and loses nothing.
- **S3. The card is shown once.** On the first reward screen after the switch goes on (a spotter with spots already gets it on their next one). Answering or leaving the screen both use it up; it never comes back on that screen (§3.1). This counts as news ask 1 of 2 (§2.4).
- **S4. Cat names are re-checked when the email is sent** (spec §9 "Escaping"). A name that fails becomes "a cat you met".
- **S5. The nightly check runs at 02:15 Athens time**, from the existing `mail-drain-cron` Cloudflare Worker (a second cron line), with GitHub Actions as a daily backup, like the mail drain.
- **S6. No "filled in" address on later asks** (C12): the box starts empty.
- **S7. The nightly send is capped at 50 emails a night** until SYC-358's priority budget is built (see "How email-capture mail is ranked"). Anything over waits for the next night.
- **S8. Leaving and coming back:** "Stop emailing me" in Settings, and the same button on the unsubscribe page, delete the news address and add a `news` suppression (`reason = 'unsubscribe'`). Changing the address in Settings is "stop" then "add", so the new address gets its own "is this you?".

---

## How it ships: the order

| Slice | What | Needs a migration? | Before 31 Oct? (Decision 1, A) | Can be dropped without touching earlier slices? |
|---|---|---|---|---|
| 1 | The nightly check, watch only (no mail) | Yes: `cat_news_baseline`, `cat_news_changes` | **Yes, Fri 23 Oct** (launch plan's "email capture, first slice") | n/a (first) |
| 2 | The news address, its "is this you?", and the Settings row (switched off) | Yes: one news row per phone | If time, Mon 26 Oct; otherwise after launch | Yes |
| 3 | Sending cat news: the email, the caps, the unsubscribe page (switched off) | Yes: an `unsubscribe` link type | After launch | Yes |
| 4 | The after-a-spot card (switched off) | No | After launch | Yes |
| 5 | The two news boxes: onboarding and the report screen (switched off) | No | After launch; **after PR #181 merges** | Yes |

**If the date slips, cut from the bottom:** 5, then 4, then 3, then 2. Slice 1 is worth keeping because it starts the two-week clock and sends nothing; if even that has to go, nothing else depends on it before launch.

**Switching on, after all five are merged** (Samuel's step, one env var per moment, see Slice 2): the two-week rule met and reviewed → `NEWS_SETTINGS=on` and `CAT_NEWS_SEND=on` → a real end-to-end send to Samuel's inbox from `news.` → `NEWS_SPOT_CARD=on` → `NEWS_ONBOARDING=on` and `NEWS_REPORT_TICK=on`.

**Migrations are never numbered here:** each takes the next free number when it's generated, after rebasing (`lib/db/migrations/README.md`; highest on `main` today is 0024, and PR #181 holds 0025).

---

## Slice 1: the nightly check, watch only (SYC-55 core; spec §5.3)

### PR 1.1: the baseline, the change log and the check (migration `cat_news_baseline`)

- **Migration**, two tables. Neither holds a device id or an address, so there's nothing in them for "Delete my data" to remove:
  - `cat_news_baseline`: `cat_id` (primary key), `sterilised` (`confirmed` / `not_confirmed`), `life_status`, `last_seen_at`, `updated_at`. **Written only by the check, never read by the resolver** (spec §5.3, Risk 8). A comment on the table says so.
  - `cat_news_changes`: `id`, `cat_id`, `change` (`sterilised` / `homed` / `seen_again`), `evidence_ids` (the observation ids), `found_at`, `silenced_reason` (null, or `import`, `legacy`, `old_news`, `first_run`), `reviewed_at`, `reviewed_note`. This is the evidence the two-week rule needs, and what a person reviews.
  - Rollback drops both.
- **`artifacts/api-server/src/lib/news/nightly.ts`**, `runNightlyNewsCheck({ mode: "watch" | "send" })`:
  1. **Which cats.** Watch mode: every cat with at least one follower in `cat_subscriptions` (`lib/db/src/schema/notifications.ts`; every resolved spot adds one, `routes/sightings.ts:784`). Send mode (Slice 3): only cats followed by a phone with a **confirmed** news address.
  2. For each, `resolveCat` (`lib/resolve.ts:1387`) for sterilisation and life status, plus the cat's newest sighting time. Compared with the baseline.
  3. **News, only these** (spec §5.3 table): sterilisation becomes `value: true` with `confidence: "confirmed"`; life status becomes `homed`; a sighting after a gap of **120 days** or more. **Never**: `deceased` or presumed-deceased, `not sterilised`, `likely`, `in_care`, or a change back.
  4. **Silenced, baseline updated, nothing sent** (spec §5.3 guards): every supporting observation has provenance `import` or `legacy`; or every supporting observation's `observed_at` is more than 90 days before its `created_at`; or the cat has no baseline yet (first sight of it: the first run seeds every cat and sends nothing).
  5. Writes `cat_news_changes` rows (silenced ones too, with the reason) and updates the baseline, in one transaction per cat.
  - Watch mode stops there. Send mode is Slice 3.
- **`seedNewsBaseline(catIds)`**: writes the current status for those cats with no change rows. For the records import (C11).
- **`POST /api/internal/news/nightly`**, with its own token `NEWS_JOB_TOKEN` (like `MAIL_DRAIN_TOKEN`: a Replit secret and a Worker secret, never in a file). Idempotent per Athens day: a second call the same night does nothing. The pre-launch gate lets this one path through, as it does the drain.
- **`infra/mail-drain-cron`**: a second cron line at 02:15 Athens time calling it (S5). **`.github/workflows/news-nightly.yml`**: the daily backup, `workflow_dispatch` for manual runs.
- **Review list:** `GET /api/team/news-changes` (staff only, `can()` as the queue uses it) returns the last 30 days of `cat_news_changes` with the cat's name and code. No page yet; Samuel reads it with a curl that Claude runs. `POST …/:id/review` sets `reviewed_at` and a note. That's the "human-reviewed" in the two-week rule.
- **Tests** (`lib/news/nightly.test.ts`, real database):
  - **T1-1:** confirmed sterilised → one `sterilised` change. Likely → none.
  - **T1-2:** deceased, presumed-deceased, and confirmed not-sterilised → no change row of any send-able kind, ever (F4).
  - **T1-3:** homed → `homed`. A sighting after 121 days → `seen_again`; after 119 → nothing.
  - **T1-4:** a change resting only on `import` or `legacy` observations → silenced `import`/`legacy`, baseline updated.
  - **T1-5:** a change resting on an observation recorded 91 days after it was observed → silenced `old_news`.
  - **T1-6:** first run over 50 cats → baseline seeded, every row silenced `first_run`, nothing send-able.
  - **T1-7:** `seedNewsBaseline` then a run → no change.
  - **T1-8:** the resolver never reads `cat_news_baseline` (a test that drops the table and checks `resolveCat` and `deriveCatStatuses` still answer the same; Risk 8).
  - **T1-9:** two calls the same Athens night → the second does nothing.
  - **T1-10:** the endpoint refuses a missing or wrong token, and the token never appears in a log line.
- **Mutation probes:** let `likely` count as confirmed → T1-1 red; drop the deceased exclusion → T1-2 red; drop the provenance guard → T1-4 red; drop the 90-day guard → T1-5 red; skip seeding on first sight → T1-6 red.

---

## Slice 2: the news address, its "is this you?", and Settings

### PR 2.1: server (migration `news_contact_per_device`)

- **Migration:** partial unique index on `email_contacts (device_id) where purpose = 'news'` (C3). Rollback drops it.
- **The switches** (`lib/news/switches.ts`): `NEWS_SETTINGS`, `NEWS_SPOT_CARD`, `NEWS_ONBOARDING`, `NEWS_REPORT_TICK`, `CAT_NEWS_SEND`, each off unless set to `on`. `GET /api/news/options` returns the four ask switches as booleans, each `true` only if its switch is on **and** `cat_news` is enabled in `send.ts` **and** `RESEND_NEWS_API_KEY` and the fingerprint key are set. **A start-up check refuses to boot** if any ask switch is on while `cat_news` has no registered template (spec Risk 1: "this cannot rot").
- **`POST /api/news/address`** (device secret, per `.agents/memory/device-secret-auth.md`): body `{ email, surface, language }`, surface one of `settings`, `spot_card`, `onboarding`, `report`. Refused with 404 when that surface's switch is off. Otherwise, in one transaction under the address's advisory lock (the pattern in #181's `reporterEmail.ts`):
  - suppressed (`news` scope forget/unsubscribe/verify_cap, or `all` bounce/complaint/unsubscribe) → keep nothing;
  - insert the news contact (`pending`), a `consented` consent event with the surface and the wording version (§5.6);
  - the same limits #181 uses, counted on news fingerprints (`REPORTER_LIMITS` shape): one "is this you?" per address per 24 h, three ever then a `verify_cap` suppression, 20 adds per IP per hour, and the **shared** daily ceiling (`dailyCeilings().verify`);
  - queue one `public_verify` outbox row with `payload.kind = "news"`.
  - **The answer is the same whatever happened** (`202 { status: "pending" }`), so it never reveals a limit or a suppression. Returns the masked address.
- **`GET /api/news/address`** → `{ state: "off" | "pending" | "on", mask? }`. **`DELETE /api/news/address`** ("Stop emailing me", S8).
- **Outbox routing (C4):** `public_verify` rows go by the contact's purpose: `report` to #181's `processReporterMail` unchanged, `news` to a new `processNewsMail` that sends the **same fixed template** (`public_verify` in #181's `reportTemplates.ts`). Same give-up rules.
- **Confirm and forget (C4):** `tokenIsLive`, `confirmAddress` and `forgetAddress` get a `news` branch. Confirm: the contact becomes `confirmed`, a `verified` event. Forget from the "is this you?" email: delete it, a `news`-scope `forget` suppression, a `withdrawn` event. Confirm page wording for news (English only, like #181's pages; below).
- **Delivery records (confirmed with the #181 session, 15 Oct).** #181's `markSent` writes a `mail_deliveries` row for every purpose in `DELIVERY_RECORDED` (`welfare_alert`, `public_verify`, `report_ack`, `report_outcome`). Because it goes by purpose, a **news** "is this you?" gets a delivery row too (with `report_id` null and the news fingerprint). So every news clean-up below (forget, the sweep, Delete my data, unsubscribe) also deletes the delivery rows of that contact's outbox rows, the way #181's `forgetReporterAddress` does. `cat_news` is **not** added to `DELIVERY_RECORDED`: nothing reads its delivery state, and a bounce or complaint still suppresses the address, because #181's webhook suppresses by the `to` address on the event (`addressFingerprint("all", …)`), not by looking up the delivery row. T2-8 asserts no delivery row survives Delete my data.
- **The 7-day sweep** (`keepSafe/sweep.ts`, as #181 leaves it) adds `news` to its purposes.
- **Delete my data** (`keepSafe/sever.ts`) already deletes every contact row with the device id and redacts its consent events; this PR adds deleting the device's news outbox rows (`payload->>'contactId'`) and a test.
- **Tests** (`routes/news.address.test.ts`):
  - **T2-1:** no switch → 404 and nothing stored.
  - **T2-2 (spec §9, "no send of any kind to an unverified address"):** a pending news address gets exactly one outbox row, `public_verify`, and nothing else is ever queued for it (asserted across a later nightly run in send mode with that phone following a cat with news).
  - **T2-3:** the 24-hour, lifetime and per-IP limits, and a suppressed address → the same `202`, no row, no mail.
  - **T2-4:** a `public_verify` row for a news contact goes to `processNewsMail`, one for a report contact still goes to #181's (both in one drain).
  - **T2-5:** confirm, then forget-link refused (used); forget before confirm → suppression, and typing it again sends nothing.
  - **T2-6:** the address never appears in a log line, an API answer (only the mask), or the outbox row once sent.
  - **T2-7:** day 8 → the sweep removed it. **T2-8:** Delete my data → no news contact, no news outbox rows, consent events redacted.
  - **T2-9:** the start-up check fails with `NEWS_SETTINGS=on` and no `cat_news` template.
- **Mutation probes:** route all `public_verify` to the reporter's code → T2-4 red; skip the suppression read → T2-3 red; queue anything but `public_verify` for a pending address → T2-2 red; drop the news branch from the sweep → T2-7 red.

### PR 2.2: the Settings row (spec §3.5)

- **`components/news/NewsSettings.tsx`**, on the profile tab directly above "Delete my data" (`app/(tabs)/profile.tsx:269–379`), next to `KeepSafeSettings`. Shown only when `/api/news/options` says `settings: true`.
- Off: title, the description, the email box, **Save**, then the two fixed lines and the under-15 line. Pending: "Check your inbox to confirm" (the existing `keepSafeSettingsPending`). On: "on, sent to s•••@gmail.com", **Change**, **Stop emailing me**. No connection: the existing `keepSafeSettingsUnavailable`.
- **Tests:** the row is absent when the switch is off; Save sends the right surface; "Stop emailing me" calls DELETE; no pre-ticked anything; the English is word for word.

---

## Slice 3: sending cat news (spec §5.1–5.3, §5.7, §5.8)

### PR 3.1: the email, the caps and the unsubscribe page (migration `unsubscribe_link`)

- **Migration:** `mail_tokens.purpose` check gains `unsubscribe`. Rollback restores the old check (after deleting any `unsubscribe` rows).
- **`send.ts`:** `cat_news` added to `DEFAULT_ENABLED`; a `cat_news` template in a new `lib/mail/newsTemplates.ts`; `resend.ts` gains a `headers` field so the template can set `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (spec §5.8). `newsSendDeps()` in `suppression.ts`: suppressed = `news` scope or `all` bounce/complaint/unsubscribe; verified = a confirmed news contact.
- **Send mode of the nightly check** (`CAT_NEWS_SEND=on`): after Slice 1's steps, for each confirmed news contact whose phone follows a cat with an unsilenced change found tonight:
  - **Caps** (spec §5.2), counted from that address's `cat_news` outbox rows: none in the last 14 days; under 8 in the last 365; none in the 48 hours after confirmation; no other news-identity email in the last 7 days (transactional mail doesn't count).
  - **One email per address per night** listing every cat with news (spec §8.5's narrow dedupe: grouped by address in the batch, nothing stored). Two phones with the same address get one email.
  - A change that misses a cap is **dropped, not held** (the spec: "A silent year is fine"), and the change row records `capped`.
  - At most 50 a night (S7).
  - Each email gets a fresh unsubscribe token and a delete token (no expiry, spec §5.8; in practice three years like #181's `DELETE_LINK_DAYS`).
- **`/mail/unsubscribe`** in `routes/mailPages.ts`: GET shows the page (one button, plus "Delete my email address"); POST with the token, from our own origin, does it. `POST /mail/unsubscribe/one-click` answers the mail app's header with no page. Both: delete the news contact, add `news`/`unsubscribe` suppression, `withdrawn` event. The page says a report's outcome email still comes (spec §5.8).
- **Tests** (`lib/news/send.test.ts`):
  - **T3-1 (spec §9):** five changes for one address in one week → one email; a sixth the next week → none (fortnight); the ninth in a year → none (annual).
  - **T3-2:** nothing in the 48 hours after confirmation.
  - **T3-3 (spec §9, "unsubscribe stops sends within the same request"):** unsubscribe, then run → nothing to that address.
  - **T3-4:** a deceased, likely or not-sterilised cat never appears in an email body (render check over every template branch).
  - **T3-5:** a cat name that fails moderation renders as "a cat you met"; a name with `<script>` is escaped; the subject has no CR/LF.
  - **T3-6:** the email contains no coordinate and no place name (S2), and the donation line appears only with a sterilisation.
  - **T3-7:** the one-click POST and the page POST both suppress; a GET changes nothing.
  - **T3-8:** two phones, one address → one email.
- **Mutation probes:** drop the fortnight cap → T3-1 red; drop the 48-hour quiet → T3-2 red; skip the suppression check in `newsSendDeps` → T3-3 red; let GET unsubscribe → T3-7 red.

---

## Slice 4: the after-a-spot card (spec §3.1, §3.2, §2.4, §10.3)

### PR 4.1: the card on the reward screen

- **`components/news/SpotNewsCard.tsx`**, on the success screen in `app/review.tsx`, **below** the points and badges (around line 318), never above and never blocking the buttons. Shown when `/api/news/options` says `spotCard: true`, this phone has no news address, the card has never been shown on this phone, and fewer than two news asks are used (S3).
- **Named a new cat** (`result.isNewCat`): §3.1 words. **Confirmed someone else's**: §3.2 words. Cat name only; "they" otherwise.
- **The decline budget lives on the phone** (spec §2.4): `lib/newsAsks.ts`, AsyncStorage `newsAsks.v1 = { used: number, cardShown: boolean, given: boolean }`, every read in try/catch. Giving an address anywhere sets `given`, and no card or box asks again.
- "No thanks" → the card is replaced, once, by "No problem — you'll still see {name}'s news in the app."
- "Keep me posted" → `POST /api/news/address` with `surface: "spot_card"` → "Thanks. Look out for one message asking if this is you. Nothing else comes until you say yes." (never "sent"). The reward screen needs a connection already (resolving is online), so there's no offline case here.
- **Tests:** shown once; a second reward screen shows nothing; "No thanks" remembered across a restart; two used asks stop it (spec §9 "two news declines stop news asks but **not** the report ask": also asserted against Slice 5's report box); never shown when the switch is off; named vs. not named wording; no box pre-ticked.
- **Checked in a real browser** at 390 px and 1280 px, in all three languages, before the PR opens: the card never pushes the "See {name}" button off screen on a small phone.

---

## Slice 5: the two news boxes (spec §3.0, §3.4)

### PR 5.1: onboarding and the report screen (after PR #181 merges)

- **`KeepSafeScreen.tsx`:** shows the unticked news box when `onboarding: true`. **Save my spots** with the box ticked → the keep-safe add (unchanged) **and** `POST /api/news/address` with `surface: "onboarding"`. Two "is this you?" emails, by design (Decision 3 note). Skip uses no news ask (spec §2.4). Ticking sets `given`.
- **#181's report email screen** (`components/report/ReportWizard.tsx`): once an address is typed, the unticked "Also email me news about the cats I've met" appears, when `reportTick: true`. The report body gains `newsToo: boolean`. The report is written first, exactly as #181 does; then #181's `addReporterEmail`; then, if `newsToo`, the news add with `surface: "report"`. **Nothing about news can change what the reporter is told or lose the report** (a failure is logged, like #181's).
- **Decision 3, A:** when both are added from one report, the news contact is created `pending` with no "is this you?" of its own; confirming the report's "is this you?" also confirms the news contact for the same phone and address (the confirm step looks it up by the news fingerprint of the report row's address). Forget from that email forgets both.
- **Offline:** the tick rides in the queued report (#181's `reportQueue.ts`), so the copy is #181's "We'll send a message to check that address when you're back online". The onboarding screen already needs a connection.
- **Tests:** the tick is unticked and hidden until an address is typed; a report with `newsToo` and the switch off stores no news contact; one "is this you?" for both, confirming confirms both, forgetting forgets both; the report row and its alert are identical with and without the tick; two used news asks still show the report's own email question (spec §2.4) **and** its news tick.
- **Mutation probe:** send a second "is this you?" for the news row → the one-email test red; let the news add throw before the report reply → the "report unchanged" test red.

---

## How email-capture mail is ranked (SYC-358)

Nothing email capture sends is "never shed". In the order SYC-358 sheds as Resend's daily cap nears (spec §2.10, email-capture §7.3):

1. **Shed first: `cat_news`** (news identity). It can always wait a night, and a missed night is dropped by the caps anyway.
2. **Shed second: news "is this you?"** (`public_verify` with `kind = "news"`), with the reporter's "is this you?" in the same group.
3. Never ahead of the reporter's acknowledgement and outcome, the welfare alert, sign-in or restore links.

Until SYC-358 is built, the backstops are the 50-a-night cap (S7), the shared daily ceiling on "is this you?" emails, and the per-address and per-IP limits. **Switching `CAT_NEWS_SEND` on waits for SYC-358 to merge, or for Samuel to confirm the Resend plan's daily limit leaves room.** Which Resend plan the account is on, and its daily limit, is **unchecked** (there's no Resend key on this machine; PR #181's body says the same).

---

## Where each of the spec's tests is built

| Spec §9 invariant | Test |
|---|---|
| No address in any public response | T2-6 |
| No send of any kind to an unverified address | T2-2, and #181's test 31 |
| The fortnight and annual caps hold when events cluster | T3-1 |
| Unsubscribe stops sends within the same request | T3-3 |
| Deletion removes the address and leaves sightings intact but unlinked | T2-8 (SYC-63's own tests cover the sightings) |
| A decline is remembered across app restarts | Slice 4 tests |
| Two news declines stop news asks but not the report ask | Slice 4 and Slice 5 tests |
| The notify job sends nothing for an import batch | T1-4, T1-7 |
| The notify job never sends on a negative or a death | T1-2, T3-4 |
| An emailed summary contains no exact coordinate | T3-6 (visit summary deferred: Decision 2) |
| Risk 1: a flag can't be on with no sender | T2-9 |
| Risk 8: the resolver never reads the baseline | T1-8 |

## Every place the "confirmed only" rule must hold

The rule (F7b): a news address gets the one fixed "is this you?" and nothing else until confirmed. The places that could break it:

1. `sendMail`'s `verified_public` check (`send.ts`) with `newsSendDeps().isVerified`: every `cat_news` send.
2. The nightly check's send-mode query (confirmed contacts only): T2-2.
3. The outbox routing of `public_verify` (C4): T2-4.
4. Slice 5's shared confirmation: confirming a report "is this you?" from **another** phone must not confirm this phone's news row (the #181 review finding 1 rule, per phone).
5. A future `visit_summary` or `promise_withdrawn` sender: both stay off in `send.ts` until their own plan.

---

## Copy for the 22 October freeze (SYC-346)

Every new sentence a visitor sees. English is the spec's, word for word where the spec has it. **Greek and French are drafts for Johnny.** The app speaks informally (εσύ / tu), like the existing keep-safe and report strings. Greek uses "τη γάτα {name}" (the ordinary word for any cat, not a statement of sex), so no sentence gives away a cat's sex (spec §3, "Pronouns"). The reused strings (`reportEmailCheck`, `keepSafeSettingsPending`, `keepSafeSettingsUnavailable`, `reportEmailPlaceholder`) already exist and aren't repeated.

### On screens (all three languages ship)

| Key | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `newsCardNamedTitle` | You named {name}. Want to know how they get on? | Έδωσες στη γάτα το όνομα {name}. Θέλεις να μαθαίνεις τα νέα της; | Tu as appelé ce chat {name}. Tu veux avoir de ses nouvelles ? |
| `newsCardNamedBody` | Leave an email and we'll write when there's real news about {name} — sterilised, found a home, or turning up again after a long quiet spell. | Άφησε ένα email και θα σου γράψουμε όταν υπάρχουν πραγματικά νέα για τη γάτα {name}: αν στειρωθεί, αν βρει σπίτι ή αν ξαναφανεί μετά από πολύ καιρό. | Laisse ton e-mail et nous t'écrirons quand il y aura de vraies nouvelles de {name} : stérilisation, adoption, ou retour après une longue absence. |
| `newsCardOtherTitle` | Want news about {name}? | Θέλεις νέα για τη γάτα {name}; | Tu veux des nouvelles de {name} ? |
| `newsCardOtherBody` | We'll email you if there's something worth telling — sterilised, found a home, spotted again after a long gap. | Θα σου στείλουμε email αν υπάρχει κάτι που αξίζει να μάθεις: αν στειρωθεί, αν βρει σπίτι ή αν ξαναφανεί μετά από μεγάλο διάστημα. | Nous t'écrirons s'il y a quelque chose à raconter : stérilisation, adoption, ou retour après une longue absence. |
| `newsCardYes` | Keep me posted | Θέλω νέα | Tiens-moi au courant |
| `newsCardNo` | No thanks | Όχι, ευχαριστώ | Non merci |
| `newsCardDeclined` | No problem — you'll still see {name}'s news in the app. | Κανένα πρόβλημα. Θα βλέπεις τα νέα της γάτας {name} στην εφαρμογή. | Pas de souci : tu verras toujours les nouvelles de {name} dans l'appli. |
| `newsAskThanks` | Thanks. Look out for one message asking if this is you. Nothing else comes until you say yes. | Ευχαριστούμε. Θα λάβεις ένα μήνυμα που ρωτά αν είσαι εσύ. Τίποτε άλλο δεν θα έρθει μέχρι να πεις «ναι». | Merci. Tu vas recevoir un message qui demande si c'est bien toi. Rien d'autre n'arrive tant que tu n'as pas dit oui. |
| `newsAskFixedLine2` | This email is only for news. To get your spots back if you change phones, use Keep my spots safe in Settings. Syros Cats holds it. | Αυτό το email είναι μόνο για νέα. Για να πάρεις πίσω τις παρατηρήσεις σου αν αλλάξεις κινητό, χρησιμοποίησε το «Κράτα τις παρατηρήσεις μου ασφαλείς» στις Ρυθμίσεις. Το κρατά η Syros Cats. | Cet e-mail ne sert qu'aux nouvelles. Pour récupérer tes observations si tu changes de téléphone, utilise « Garder mes observations en sécurité » dans les Réglages. C'est Syros Cats qui le conserve. |
| `newsAskPrivacyLink` | What we do with it · delete it any time | Τι κάνουμε με αυτό · διάγραψέ το όποτε θέλεις | Ce que nous en faisons · supprime-le quand tu veux |
| `newsAskUnder15` | If you're under 15, ask a parent first. | Αν είσαι κάτω από 15, ρώτα πρώτα έναν γονιό. | Si tu as moins de 15 ans, demande d'abord à un parent. |
| `newsSettingsTitle` | News about your cats | Νέα για τις γάτες σου | Des nouvelles de tes chats |
| `newsSettingsOff` | Off | Ανενεργό | Désactivé |
| `newsSettingsBody` | Get an email when something happens to a cat you've met. | Λάβε email όταν συμβεί κάτι σε μια γάτα που έχεις γνωρίσει. | Reçois un e-mail quand il arrive quelque chose à un chat que tu as rencontré. |
| `newsSettingsSave` | Save | Αποθήκευση | Enregistrer |
| `newsSettingsOn` | On, sent to {address} | Ενεργό, στέλνεται στο {address} | Activé, envoyé à {address} |
| `newsSettingsChange` | Change | Αλλαγή | Modifier |
| `newsSettingsStop` | Stop emailing me | Σταμάτα τα email | Arrête de m'écrire |
| `newsSettingsStopped` | Done. We won't email you news any more. | Έγινε. Δεν θα σου στέλνουμε πια νέα με email. | C'est fait. Nous ne t'enverrons plus de nouvelles par e-mail. |
| `keepSafeNewsBox` | Also send me news about cats I spot: when one is sterilised or finds a home. | Στείλτε μου και νέα για τις γάτες που βλέπω: όταν κάποια στειρώνεται ή βρίσκει σπίτι. | Envoyez-moi aussi des nouvelles des chats que je repère : quand l'un d'eux est stérilisé ou trouve un foyer. |
| `reportNewsBox` | Also email me news about the cats I've met | Στείλτε μου και νέα με email για τις γάτες που έχω γνωρίσει | M'envoyer aussi par e-mail des nouvelles des chats que j'ai rencontrés |

### In the email and on the web pages (English ships; Greek and French drafts for the pack, used after SYC-283)

| Where | English | Greek (draft) | French (draft) |
|---|---|---|---|
| Subject, one cat | News about {name} | Νέα για τη γάτα {name} | Des nouvelles de {name} |
| Subject, several | News about {n} cats you've met | Νέα για {n} γάτες που έχεις γνωρίσει | Des nouvelles de {n} chats que tu as rencontrés |
| Sterilised | {name} has been sterilised. Thank you for spotting them: every spot helps Syros Cats find the cats who still need it. | Η γάτα {name} στειρώθηκε. Ευχαριστούμε που την κατέγραψες: κάθε παρατήρηση βοηθά τη Syros Cats να βρει τις γάτες που το χρειάζονται ακόμη. | {name} a été stérilisé·e. Merci de l'avoir repéré·e : chaque observation aide Syros Cats à trouver les chats qui en ont encore besoin. |
| Homed | {name} has found a home. | Η γάτα {name} βρήκε σπίτι. | {name} a trouvé un foyer. |
| Seen again | {name} was spotted again on {date}, after more than four months with no sightings. | Η γάτα {name} εμφανίστηκε ξανά στις {date}, μετά από πάνω από τέσσερις μήνες χωρίς παρατηρήσεις. | {name} a été revu·e le {date}, après plus de quatre mois sans observation. |
| Name failed moderation | a cat you met | μια γάτα που γνώρισες | un chat que tu as rencontré |
| Donation line (sterilised only, at the bottom, spec §5.7) | A sterilisation costs €50–60. If you'd like to help pay for the next one: Help Syros Cats | Μια στείρωση κοστίζει 50–60 €. Αν θέλεις να βοηθήσεις στην επόμενη: Στήριξε τη Syros Cats | Une stérilisation coûte 50 à 60 €. Si tu veux aider à financer la prochaine : Soutenir Syros Cats |
| Footer | You're getting this because you asked for news about cats you met with the Cat Spotters app. Stop these emails · Delete my email address · What we do with your email · hello@catspotters.com | Το λαμβάνεις επειδή ζήτησες νέα για γάτες που γνώρισες με την εφαρμογή Cat Spotters. Σταμάτα αυτά τα email · Διάγραψε τη διεύθυνσή μου · Τι κάνουμε με το email σου · hello@catspotters.com | Tu reçois ce message parce que tu as demandé des nouvelles des chats rencontrés avec l'appli Cat Spotters. Arrêter ces e-mails · Supprimer mon adresse · Ce que nous faisons de ton e-mail · hello@catspotters.com |
| Confirm page, done (news) | Thank you. We'll email you when there's real news about a cat you've met. You can close this page. | Ευχαριστούμε. Θα σου στείλουμε email όταν υπάρχουν πραγματικά νέα για μια γάτα που γνώρισες. Μπορείς να κλείσεις αυτή τη σελίδα. | Merci. Nous t'écrirons quand il y aura de vraies nouvelles d'un chat que tu as rencontré. Tu peux fermer cette page. |
| Unsubscribe page, title | Stop cat news emails | Σταμάτα τα email με νέα για γάτες | Arrêter les e-mails de nouvelles |
| Unsubscribe page, text | Press the button and we'll stop emailing you news about cats. Nothing else in the app changes. If you also left this address on a cat report, you'll still get the one email about what happened. | Πάτησε το κουμπί και θα σταματήσουμε να σου στέλνουμε νέα για γάτες. Τίποτε άλλο δεν αλλάζει στην εφαρμογή. Αν άφησες αυτή τη διεύθυνση και σε αναφορά για γάτα, θα λάβεις κανονικά το ένα email για το τι έγινε. | Appuie sur le bouton et nous arrêterons de t'envoyer des nouvelles des chats. Rien d'autre ne change dans l'appli. Si tu as aussi laissé cette adresse sur un signalement, tu recevras quand même l'e-mail sur ce qui s'est passé. |
| Unsubscribe page, buttons | Stop emailing me · Delete my email address | Σταμάτα τα email · Διάγραψε τη διεύθυνσή μου | Arrêter les e-mails · Supprimer mon adresse |
| Unsubscribe page, done | Done. We won't email you cat news again. You can close this page. | Έγινε. Δεν θα σου ξαναστείλουμε νέα για γάτες. Μπορείς να κλείσεις αυτή τη σελίδα. | C'est fait. Nous ne t'enverrons plus de nouvelles des chats. Tu peux fermer cette page. |
| Delete done | Done. We've deleted your email address. You can close this page. | Έγινε. Διαγράψαμε τη διεύθυνση email σου. Μπορείς να κλείσεις αυτή τη σελίδα. | C'est fait. Nous avons supprimé ton adresse e-mail. Tu peux fermer cette page. |

**For Johnny:** the French email lines use "·e" for a cat of unknown sex; he may prefer rewording round it. The "is this you?" email itself is #181's and unchanged.

---

## Rollout

1. Slice 1 merged → migration through db-ops (development, production, verify) → Samuel's Replit pull and publish → Claude adds `NEWS_JOB_TOKEN` (heads-up first: it creates a secret in Replit and Cloudflare) → the Worker's cron deployed with wrangler → a manual run, and Claude reads the change list back to Samuel. **That starts the two-week clock.**
2. Each later slice: merged, migrated, published, switch still off.
3. **Switch-on** (Decision 1, A): two weeks of watch runs, at least one change Samuel has reviewed, SYC-358 merged (or the Resend limit confirmed), `news.catspotters.com` verified in Resend (#181's rollout step 1) → switches on in the order under "How it ships" → after each, a probe with Samuel's own address (heads-up first: it emails him).

## What works with no signal, precisely

- The spot card needs a connection (it appears only after an online resolve).
- Settings and the onboarding news box need a connection, and say so (existing strings).
- The report's news tick rides with a report saved offline and goes when the phone reconnects; the copy promises only a message "when you're back online".
- The nightly check and the emails are server-side and don't depend on the phone.

## Where this collides with other work

| Other work | Shared files | Order |
|---|---|---|
| **PR #181** (SYC-42 Slice 3) | `lib/mail/outbox.ts`, `keepSafe/service.ts`, `routes/mailPages.ts`, `lib/mail/suppression.ts`, `keepSafe/sweep.ts`, `keepSafe/sever.ts`, `ReportWizard.tsx`, `lib/i18n.ts`; migration 0025 | **Slice 2 onwards rebases on #181 after it merges.** Slice 1 touches none of these and can go first. If #181 changes `REPORTER_PURPOSES`, the `public_verify` template or the confirm/forget branching before merge, C4 and Slice 2 change with it (the #181 session was told on 15 Oct) |
| Match-wait screen plan (SYC-36 + SYC-48, sibling chip) | `app/review.tsx` (the feeding nudge on the first result screen; the card goes on the success screen) | Slice 4 is after launch and rebases on the match-wait PRs. The match-wait session was told on 15 Oct |
| SYC-53 Slice 1 (PRs #178, #179) | `lib/i18n.ts`; `can()` for the review list | Rebase; no shared logic |
| SYC-358 (priority budget) | `lib/mail/send.ts` | `CAT_NEWS_SEND` waits for it (above) |
| `mail-drain-cron` Worker (SYC-231) | `infra/mail-drain-cron` | Slice 1 adds one cron line; the drain is unchanged |
| Migrations from any session | `lib/db/migrations` | Next free number at generation time, after rebasing, after messaging live sessions |

## What this plan does not do

- The visit summary (Decision 2, A: SYC-370).
- "We can't keep our promise" (`promise_withdrawn`): only needed if a moment is ever withdrawn; SYC-372.
- The 24-month "still want these?" email and deletion: the first address can't reach 24 months until late 2028; SYC-372.
- Deleting a confirmed report-only address 90 days after the report closes (C9): SYC-42 plan item 4.3; tracked as SYC-371.
- The priority budget itself (SYC-358).
- Anything about donation receipts (spec §1.2 E).

---

## Model delegation

This session (Opus) wrote the plan. For the build:

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Slice 1: the nightly check and its guards | **Opus** | Silent-failure territory: a wrong guard emails a "sterilised" about a 2019 operation, or worse a death. Reads the resolver's evidence | T1-1…T1-10, and the five **mutation probes** named in Slice 1 (each guard broken by hand, the named test seen red, restored); Sonnet adversarial review of the diff |
| Slice 2 PR 2.1: news address, routing, confirm/forget | **Opus** | Multi-file change across #181's and SYC-3's mail code, where a mistake sends to an unconfirmed address | T2-1…T2-9 and the four mutation probes; Sonnet adversarial review checking every item in "Every place the 'confirmed only' rule must hold" |
| Slice 2 PR 2.2: the Settings row | Sonnet | Clear spec, a pattern that exists (`KeepSafeSettings`) | Component tests; Opus spot review of the diff; real-browser check at 390 px and 1280 px |
| Slice 3: sending, caps, unsubscribe | **Opus** | Caps and suppression are silent failures (too many emails, or emails after "stop") | T3-1…T3-8 and four mutation probes; Sonnet adversarial review |
| Slice 4: the card | Sonnet | One component, an existing screen, a device-side counter | Component tests, a decline-across-restart test, real-browser check; Opus spot review |
| Slice 5: the two boxes | Sonnet, with the shared-confirmation step on **Opus** | The boxes are routine; confirming two rows from one email is not | Tests named in Slice 5 and its two mutation probes; Opus writes the confirm step; Sonnet adversarial review |
| i18n strings from this plan into `lib/i18n.ts` | Haiku | Mechanical copy-paste from the tables above | A test that every key exists in all three languages; Sonnet spot review that the English is word for word |
| Adversarial review of this plan | Sonnet | Checking each spec rule maps to a test is careful reading, not design | Its findings and what happened to each are in `syc-344-email-capture-review.md` |

**Every agent prompt in the build restates, word for word:** commit after each item; keep a `CHECKPOINT.md` in the worktree; never hold work only in memory. **Re-run delegated tests yourself before merging** (an agent's "tests pass" has been false before).

## Linear

- **SYC-344:** this plan, In Review until Samuel approves.
- **SYC-45:** blocked by SYC-344; one comment linking this plan and its slices.
- **SYC-55:** related; Slices 1 and 3 deliver its core ("the cat you named was sterilised").
- **Filed from this plan (new):** SYC-370 (the visit summary, Decision 2); SYC-372 (`promise_withdrawn` and the 24-month inactivity email); SYC-371 (tracks SYC-42 plan item 4.3, deleting a reporter's address 90 days after close; C9).

## Still needs Samuel

- Decisions 1–4 (and the small calls, unless he objects).
- Approve the plan, so Slice 1 can be built the week of 19 Oct.
- Later: review the first real change the nightly check finds (the two-week rule's "human-reviewed").
