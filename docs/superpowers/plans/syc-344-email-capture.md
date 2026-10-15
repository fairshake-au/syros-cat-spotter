# SYC-344 / SYC-45: email capture v1 (implementation plan; decisions settled 15 Oct, for Samuel's approval)

**Linear:** SYC-344 (this plan) · SYC-45 (the build) · SYC-55 (the "your cat was sterilised" email, which Slices 1 and 3 deliver) · SYC-42 (Slice 3, the reporter's email, PR #181, **merged 15 Oct** as `851c24a`) · SYC-3 (keep my spots safe; the shared "is this you?" tables) · SYC-63 (Delete my data) · SYC-358 (mail priority budget) · SYC-346 (Johnny's copy pack) · SYC-283 (the native-language check of email copy) · SYC-370, SYC-371, SYC-372 (filed from this plan).
**Status:** **for approval. All seven decisions settled by Samuel on 15 Oct 2026** (1, 2, 3, 4 and 6 as recommended; 5 changed to **one a week, no yearly cap, held news kept up to 60 days**; 7 changed to **the reader's language from day one**). Revised after an independent adversarial review (`syc-344-email-capture-review.md`: 3 critical, 12 major, 11 minor, 4 nits; what happened to each is recorded there). Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/email-capture.md`, approved by Samuel on 28 September 2026 · `team-access-and-welfare-queue.md` §2.10 (the mail priority budget) · `cat-record-data-spine.md` (the resolver the nightly check calls, and its notification rules) · `DECISIONS.md` (D2 amendment, F4, F7b).
**Checked against:** `origin/main` at `88967f4` (15 Oct 2026), which includes **PR #181** (merged 14:57 UTC; read in full from its diff, head `dd9ceeb`); open PR #178 (SYC-53 PR 1.1, which edits the same mail files); PR #172's launch plan (`docs/superpowers/plans/mvp-launch-31-oct.md` on `claude/xenodochial-zhukovsky-df315f`, not yet approved); Linear SYC-344, SYC-45, SYC-55, SYC-358. The SYC-42 Slice 3 session confirmed on 15 Oct that #181's shapes this plan relies on are final. Every "exists today" claim below names the file it was read in.

---

## In plain English

**What this adds.** The app can already take an email in two places: "keep my spots safe" (SYC-3) and, since #181 merged today, a cat report ("Shall we tell you what happens?"). Neither sends any **cat news**. This plan adds the rest of the approved spec:

- **A nightly check** that notices when a cat someone follows has genuinely good news: it was **confirmed sterilised**, it **found a home**, or it was **spotted again after four months or more**. It never sends anything about a cat that has died or is presumed dead, and never a "not sterilised" or a "likely sterilised". It never tells someone about their own spot.
- **The cat-news email** that check sends: at most one a week per person (Samuel, 15 Oct), with "stop" in every email.
- **The asking screens:** a card on the screen after a spot ("You named Agatha. Want to know how they get on?"), a "News about your cats" row in Settings, the unticked news box on the "Don't lose your spots" onboarding screen, and the unticked news box on the cat report's email screen.

Every address still gets exactly **one** "is this you?" email first, and nothing else until the person says yes. That part is #181's, and this plan reuses it.

**Why none of it can be switched on at launch, whatever we build.** The approved spec says no news ask may be switched on until the nightly check has run on real data for **two weeks** and found at least one genuine change that a person has looked at (spec §10.1, Risk 1). That rule stops us collecting addresses and then never writing. So the useful thing to do before 31 October is to **start that clock**: build the nightly check first, in "watch only" mode, sending nothing. Decision 1 asks Samuel to confirm this.

**What cutting it costs.** Nothing a reporter needs. #181 owns the reporter's "is this you?", acknowledgement and outcome emails, the consent records and the do-not-email list. Email capture only **adds** to them. If every slice here is dropped, reporters still leave an email and hear back exactly as they can today.

**The order, in one line.** The nightly check in watch-only mode (starts the clock) → the news address and the Settings row → sending cat news → the after-a-spot card → the two news boxes. Each slice ships switched off and can be dropped from the end without touching the ones before it. The visit summary is proposed for after launch (Decision 2).

---

## Where the spec, the code and #181 disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something the spec didn't. Each row starts with what it means for people.

| # | For people | What the spec says | What is true on `main` | What this plan does |
|---|---|---|---|---|
| C1 | Nobody can be asked for news at launch | §10.1 Risk 1: news switches stay off until the nightly check has run **two weeks** on real data and produced a genuine, human-reviewed change | No check exists | Slice 1 builds the check **first**, watch-only, to start the clock. **Decision 1** |
| C2 | The check must see the same status as the cat's page, and know where each change came from | §5.3: the job calls the resolver for "status, with the provenance and `observedAt` of the observations that produced it" | `resolveCat` (`lib/resolve.ts:1387`) is a pure function returning a `CatSnapshot` (lines 104–120) with **no observation ids**. Ids exist only on `resolveSterilised` (409) and `resolveLifeStatus` (558), as `supportingObservationIds` on `Resolved<T>` (22–31). `deriveCatStatuses` (`lib/catHelpers.ts:294`) drops them | The check loads each cat with `loadCatRecords` (`lib/observations.ts:951`), takes the cat's status from `resolveCat` (exactly what the cat page shows) and the evidence ids from `resolveSterilised` / `resolveLifeStatus`. The resolver isn't changed. Test T1-11: the check and the cat page agree on every cat |
| C3 | One phone, one news address | §9: "a table keyed on device id" | `email_contacts` (`lib/db/src/schema/email.ts`) allows `purpose = 'news'` with an address and a device id; nothing stops two news rows per phone | Slice 2's migration: one news row per phone |
| C4 | The news "is this you?" goes through the same machinery as the reporter's | — | #181: `outbox.ts` sends **every** `public_verify` row through `processReporterMail`, and `tokenIsLive` / `confirmAddress` / `forgetAddress` (`keepSafe/service.ts`) treat any contact that isn't `report` as keep-safe | Slice 2 routes `public_verify` by `payload.kind` (`"news"` → a new `processNewsMail`; absent → #181's code, unchanged) and adds a `news` branch to those three functions |
| C5 | The report screen's news box is new | §3.4: an unticked "Also email me news about the cats I've met" | #181 leaves it out on purpose (`lib/i18n.ts`: "the second is about news, which a report address never gets") | Slice 5 adds it. **Decision 3** |
| C6 | The onboarding news box is new | §3.0 | `KeepSafeScreen.tsx:22–23` hides it "until SYC-45 builds news" | Slice 5 shows it |
| C7 | A stranger typing someone's address on both a report and Settings can cause two "is this you?" emails in a day, not one | §4.4 control 1: one per **address** per 24 hours | Fingerprints are keyed **per purpose** (`lib/mail/fingerprint.ts`; SYC-3 review A3). #181 counts its caps on report fingerprints only. The shared daily ceiling counts every purpose (`reporterEmail.ts`, `dailyCeilings().verify`) | News counts its own caps the same way; the shared ceiling and per-IP limit still cover both. Decision 3, A, removes the commonest case |
| C8 | A scanner opening an email can't unsubscribe anyone | §5.8: "One-click unsubscribe … no 'are you sure' page" | SYC-3 and #181 never act on a link being opened; their pages show one button (`routes/mailPages.ts`) | The mail app's own "Unsubscribe" is one tap. The link opens a page with one button. **Decision 4** |
| C9 | A reporter's address is deleted 90 days after their report closes | §5.5 | #181 forgets an **unconfirmed** report address after 7 days. Close + 90 days is **planned, not built**: SYC-42 plan item 4.3 (`syc-42-cat-in-trouble.md:248`) | Not email capture's: it must hold even if email capture is cut. Tracked as SYC-371 |
| C10 | — | §5.1: cat news from the news identity | `send.ts` lists `cat_news`, `visit_summary`, `promise_withdrawn` on `news.catspotters.com`, all off | Slice 3 switches on `cat_news` only; a test keeps the other two off |
| C11 | A future records import sends nobody an email | §5.3: seed the baseline as an import lands | No records import exists (optional, after MVP) | Slice 1 exports `seedNewsBaseline(catIds)` with a test; the import's plan must call it (noted on SYC-45) |
| C12 | The news box starts empty, even if the person saved their spots with an address | §2.4: "with the address filled in" | A keep-safe row never holds the address (SYC-3 Decision 4, a database check), and the phone keeps only the mask (`lib/keepSafe.ts`) | Small call S6 |
| C13 | A cat guardian's own sighting never triggers "spotted again" news to them | The spec doesn't say | Every resolved spot follows the cat (`routes/sightings.ts:784`), so a follower's own sighting after a gap would otherwise email them about it | The check ignores a change caused only by the recipient's own observations (Slice 3) |
| C14 | A big batch of corrections never emails people | Data spine §9.2: a bulk write touching more than about 50 cats seeds rather than notifies | Only import and legacy provenance are guarded in the spec | Slice 1: more than 50 send-able changes in one night → the whole night is silenced and Samuel is told |

---

## Decisions for Samuel

Seven. **All decided by Samuel on 15 October 2026** (recorded on SYC-344). The options are kept as the record of what was weighed.

### Decision 1: When do the news asks go live, given the two-week rule? (C1)

**Decided (Samuel, 15 Oct): A.**

**The question.** The spec won't let any news ask be switched on until the nightly check has run for two weeks on real data and found at least one real change that someone has looked at. So **no news ask can be live on 31 October** unless the rule is waived.

**What counts as "a genuine change", proposed:** one `cat_news_changes` row that isn't silenced, about a real cat on the live site, which Samuel (or the team) has looked at and marked "right" in the review list.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Build the check first, switch the asks on when the rule is met (recommended)** | Slice 1 (watch only) is live by 23–26 Oct. The asks are built behind switches that stay off. Switch-on once two weeks have passed **and** a genuine change has been reviewed | Keeps the spec's safeguard. Starts the clock as early as it can. Nothing a visitor sees depends on email capture at launch, so it can slip with no visible cost | Before launch the check runs against the test site, so the real two weeks start on 31 Oct: **earliest switch-on about 14 Nov**. If no genuine change turns up (few sterilisations get recorded in November), it waits longer. Whether late October is the end of the visitor season is **unchecked** |
| B. Switch the asks on at launch, waiving the rule | Everything built by 29 Oct and switched on | Catches visitors in launch week | Breaks the spec's biggest safeguard. Competes with launch-week work for the first thing Samuel agreed to cut |
| C. Build nothing before launch | All of it after 31 Oct | Frees the week of 19 Oct | The clock starts later still |
| D. Staged: Settings first, the card later | Switch on only the Settings row once the rule is met; the card and boxes after a further check | The fewest people promised news while the check is youngest | Settings alone collects almost no addresses; the card is where most come from |

**If no genuine change appears:** Syros Cats can record a real sterilisation they've done on a cat someone follows. That is a genuine change, and the check should notice it the next night.

**Recommendation: A.** It costs one small, low-risk slice before launch (the check sends nothing), keeps the safeguard, and leaves everything else free to slip.

### Decision 2: Build the visit summary now, or after launch?

**Decided (Samuel, 15 Oct): A.** SYC-370.

**The question.** The spec's third moment is the visit summary ("You've met 14 cats on Syros. Want the list sent to you?"). **There is no visit summary in the app at all today** (no screen, no wording in `lib/i18n.ts`). It needs a new screen, its trigger, and an email listing cats with blurred locations. It's the biggest piece of the spec.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. After launch, as its own ticket (recommended)** | This plan builds the card, Settings and the two news boxes. The visit summary gets its own plan before next season (SYC-370) | Keeps this plan small enough to finish. The summary matters most in summer | The spec's second news ask doesn't exist until then, so someone who says no to the card is only asked again via Settings |
| B. Build it here as Slice 6 | All four moments | The spec in full | Roughly doubles the work; none of it can be switched on before mid-November anyway |

**Recommendation: A.**

### Decision 3: One typed address, two choices: one "is this you?" email or two? (C5, C7)

**Decided (Samuel, 15 Oct): A.**

**The question.** On the report's email screen, someone types their address and ticks "Also email me news about the cats I've met". Those are two separate consents (spec §3.4). Do they get one "is this you?" email or two?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. One email confirms both, when the report sends one (recommended)** | If the report's "is this you?" goes out, pressing "Yes, that was me" also confirms the news address typed on the same screen. If the report sends none (the address was already confirmed on this phone, or a limit stopped it), the news address sends its own, under its own limits. Both consents are recorded separately | One email in the usual case, which is what the person expects. Fewer emails a prankster can cause. The fixed email names no purpose, so its words stay true | A little more code, and a table of cases to test (Slice 5) |
| B. Always two separate emails | Each purpose sends its own | Simplest | Two identical-looking emails seconds apart. Feels broken |

The onboarding screen stays as the spec says: "keep my spots safe" has its own "is this you?" (it's a key to the collection, with different words), and ticking news sends the news one. Two emails there, by design.

**Recommendation: A.**

### Decision 4: The unsubscribe link: a page with one button, or truly one click? (C8)

**Decided (Samuel, 15 Oct): A.**

**The question.** The spec says unsubscribing is one click, with no "are you sure" page. But email security scanners open every link in every email. If opening the link stopped the emails, a scanner would unsubscribe people who never asked.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. The mail app's button is one tap; the link opens a page with one button (recommended)** | Gmail's and Apple Mail's own "Unsubscribe" works in one tap (a standard header that scanners don't trigger). The link in the footer opens a page with a **Stop emailing me** button (no "are you sure?"), a **Delete my email address** button, and, if the address is also on a cat report, **Stop emails about my cat report too** | Nobody is unsubscribed by a scanner. The same as every other link in this app's emails | One extra tap from the footer link |
| B. Opening the link unsubscribes | Literal one click | Fewest taps | Scanners silently unsubscribe real people |

**Recommendation: A.**

### Decision 5: When the limit blocks good news, hold it or drop it?

**Decided (Samuel, 15 Oct), changing the spec:** "change the limit to once per week - fortnightly is too infrequent"; then, asked about the yearly cap, **"No yearly cap"**; and for news that arrives while the weekly limit is closed, **A: hold it, drop after 60 days**. So: at most one cat-news email a week per person, no yearly ceiling, nothing in the 48 hours after confirming, and held news goes with the next email the limit allows. This amends `email-capture.md` §5.2 and §9, `DECISIONS.md` (the 28 Sep edits), and `privacy-policy.md`'s "a handful of times a year at most" (all in this PR; the policy wording is also noted on SYC-66 for Samuel's approval). The table below is the question as first put, with the fortnightly limit.

**The question.** The spec caps cat news at one email a fortnight and eight a year, with nothing in the first 48 hours after someone confirms. Suppose a follower got "Loukoumi found a home" last Tuesday, and tonight Agatha is confirmed sterilised. The spec says "three cats with news in the same week is one email about three cats", but doesn't say what happens to news that arrives while the cap is closed.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Hold it, then send it with the next email; drop it after 60 days (recommended)** | Agatha's news waits, and goes out (with anything else waiting) the first night the cap allows | The best message the app has is never lost to a timing accident. Matches "one email about three cats" | News can arrive up to two weeks late, which the spec accepts ("up to a day's delay is fine"; nobody waits by an inbox for this) |
| B. Hold it forever | Same, without the 60-day limit | Nothing is ever lost | A follower who hits the annual cap could get year-old "news" |
| C. Drop it | Only news found on an eligible night is sent | Simplest | A real "your cat was sterilised" is lost forever if any email went out in the previous 13 days |

**Recommendation: A.**

### Decision 6: After "Stop emailing me", can the same person start again?

**Decided (Samuel, 15 Oct): A.**

**The question.** The spec says "Stop emailing me" removes the address and keeps a do-not-email mark "so it is never mailed again". But if someone taps Stop in Settings and later changes their mind, or taps Change and goes back to their old address, the mark means nothing ever arrives, and the screen can't tell them why without telling any stranger who types that address that it unsubscribed.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. The same phone can undo its own Stop (recommended)** | Stop keeps the do-not-email mark, exactly as the spec says. If **the same phone** later adds the same address, the mark is lifted and a fresh "is this you?" goes out. From any other phone, the mark holds | Keeps the spec's protection against strangers. The person who stopped can come back. Nothing is revealed to anyone else | A little more code (the stop is recorded with the phone it came from) |
| B. Keep the mark for everyone, as written | Re-adding the same address silently does nothing | Simplest, literal | The person who stopped is told "check your inbox" and nothing ever comes |
| C. No mark from Settings, only from the email's link | Settings Stop just deletes the address | Simple | Weaker than the spec |

The email's own "Stop emailing me" (where we can't know which phone it is) always keeps the mark, for every phone.

**Recommendation: A.**

### Decision 7: Cat-news emails in English only at first?

**Decided (Samuel, 15 Oct): B, the reader's language from day one.** Cat-news emails and the news web pages go in the reader's app language. So the Greek and French email lines below must be checked by Johnny in the 22 Oct pack (noted on SYC-346) before cat news switches on. The "is this you?" email and the reporter's emails stay English-first under the 15 Oct rule for #181.

**The question.** The spec wants Greek and French written by native speakers. On 15 Oct Samuel decided the **reporter's** emails go in English for everyone until Johnny checks the Greek and French (SYC-283). Should cat news follow the same rule?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. English first, Greek and French once Johnny has checked them (recommended)** | Drafts are in this plan for Johnny's pack. Each email switches to the reader's app language once its words are checked | The same rule as the reporter's emails. Nothing unchecked goes to a stranger's inbox | Greek and French readers get English until then. Cat news can't go out before mid-November anyway, which gives Johnny time |
| B. In the reader's language from the start, using the drafts | — | Feels local | Unchecked Greek and French in an email we can't take back |

**Recommendation: A.**

### Small calls this plan makes (object to any, otherwise they stand)

- **S2. The cat-news email carries no location at all**, not even the blurred one. It names the cat and what happened. Stricter than the spec's minimum (§3.3).
- **S3. The card is shown once.** The spec (§10.3, Samuel, 28 Sep) puts it on a person's **very first** resolved spot; new spotters get exactly that. A spotter who already has spots when the switch goes on gets it on their next reward screen. Answering or leaving the screen both use it up (§3.1: "never comes back on this screen"). It counts as news ask 1 of 2 (§2.4).
- **S4. A cat name that fails the moderation check at send time becomes "a cat you met"** rather than the spec's "the cat you named" (§9), because the follower may not be the person who named it. A wording departure, flagged for Samuel.
- **S5. The nightly check runs once a night**, from the existing `mail-drain-cron` Cloudflare Worker (a second cron, in UTC, timed for the small hours in Athens on both sides of the 25 Oct clock change), with GitHub Actions as a daily backup. The "night" is the Athens date.
- **S6. No filled-in address on later asks** (C12). Carrying the typed address on the phone for the session wouldn't help: onboarding happens once and the card comes on a later day.
- **S7. At most 50 cat-news emails a night** until SYC-358's priority budget is built. Held news (Decision 5) waits for the next night.
- **S8. "Change" in Settings is Stop, then Add**, so the new address gets its own "is this you?". With Decision 6 A, changing back to the old address works.
- **S9. Limits per internet address are counted in the database**, as #181 does, rather than with `rateLimit.ts` (spec §4.4 control 2), because they must hold across servers and restarts (spec §9). A departure from the letter of §4.4, matching #181.
- **S10. Unsubscribe and delete links last three years**, not forever (spec §5.8), the same as #181's "Delete my details" link and for the same reason.

---

## How it ships: the order

| Slice | What | Migration? | When (Decision 1, A) | Dropped without touching earlier slices? |
|---|---|---|---|---|
| 1 | The nightly check, watch only (no mail) | Yes: `cat_news_check` (three small tables) | **Before launch: build Mon 19–Fri 23 Oct**, publish with the launch plan's first email-capture slot | n/a (first) |
| 2 | The news address, its "is this you?", the Settings row (switched off) | Yes: one news row per phone | Mon 26 Oct if time; otherwise after launch | Yes |
| 3 | Sending cat news: the email, the limits, the unsubscribe page (switched off) | Yes: an `unsubscribe` link type, and a send log | After launch | Yes |
| 4 | The after-a-spot card (switched off) | No | After launch, after the match-wait PR 2 (26 Oct) | Yes |
| 5 | The two news boxes: onboarding and the report screen (switched off) | No | After launch | Yes |

**If the date slips, cut from the bottom:** 5, then 4, then 3, then 2. Slice 1 is worth keeping because it starts the clock and sends nothing; if even that has to go, nothing depends on it before launch.

**Switching on, after all five are merged.** The machine refuses to switch any ask on unless the gate below is met (Slice 2, test T2-9), so the order is not just a convention:

1. Two weeks of nightly runs on the live site, and at least one reviewed, genuine change.
2. SYC-358 merged, or the Resend plan's daily limit confirmed to leave room (see "Ranking").
3. `CAT_NEWS_SEND=on`, then a real end-to-end send to Samuel's inbox from `news.catspotters.com` (heads-up first).
4. `NEWS_SETTINGS=on` → `NEWS_SPOT_CARD=on` → `NEWS_ONBOARDING=on` and `NEWS_REPORT_TICK=on`.

**Migrations are never numbered here:** each takes the next free number when it's generated, after rebasing, after messaging the live sessions (`lib/db/migrations/README.md`; highest on `main` today is 0025, from #181).

---

## Slice 1: the nightly check, watch only (SYC-55 core; spec §5.3)

### PR 1.1: the baseline, the change list and the check (migration `cat_news_check`)

- **Migration**, three tables. None holds a device id or an address, so there's nothing in them for "Delete my data" to remove:
  - `cat_news_baseline`: `cat_id` (primary key), `sterilised_confirmed` (boolean), `notified_sterilised_at`, `notified_homed_at` (**set once and never cleared**: a ratchet, so a status that flips back and forth is never announced twice; data spine "nobody is told twice"), `life_status`, `last_sighting_at`, `updated_at`. **Written only by the check, never read by the resolver** (spec §5.3, Risk 8). A comment on the table says so.
  - `cat_news_changes`: `id`, `cat_id`, `change` (`sterilised` / `homed` / `seen_again`), `evidence_ids`, `caused_by_devices` (the devices whose observations caused it, used only to stop self-notification, then cleared when the change is settled), `found_at`, `state` (`watched` / `held` / `sent` / `silenced` / `expired`), `silenced_reason` (`import`, `legacy`, `old_news`, `first_seen`, `deceased`, `bulk`), `reviewed_at`, `reviewed_note`. The evidence the two-week rule needs, and what a person reviews.
  - `cat_news_runs`: `athens_date` (primary key), `started_at`, `finished_at`, `cats_walked`, `changes_found`, `silenced_bulk`. The night's record: the check claims a date only when it **finishes**, so a crashed run is re-run by the backup.
  - Rollback drops all three.
- **`artifacts/api-server/src/lib/news/nightly.ts`**, `runNightlyNewsCheck()`, under one advisory lock (two callers at once can't both run):
  1. **Which cats: always every followed cat** (any row in `cat_subscriptions`, `lib/db/src/schema/notifications.ts`; every resolved spot adds one, `routes/sightings.ts:784`). Every baseline moves forward every night, whoever follows the cat, so a baseline is never months stale (review finding 3). Who gets told is decided later, in Slice 3.
  2. For each cat (in batches): `loadCatRecords` → `resolveCat` for the status the cat page shows, and `resolveSterilised` / `resolveLifeStatus` for the evidence ids (C2).
  3. **A cat that is dead or presumed dead produces no news of any kind** (`lifeStatus === "deceased"` or `presumedDeceased`), whatever else changed. Its baseline updates silently, reason `deceased` (F4; data spine: the "cruellest bug in the app").
  4. **News, only these** (spec §5.3 table), each compared with the baseline: sterilisation newly `value: true` with `confidence: "confirmed"` and `notified_sterilised_at` empty; life status newly `homed` and `notified_homed_at` empty; a new sighting whose **gap from the sighting before it** is four calendar months or more (measured on the sightings, not on the stored baseline). **Never**: `not sterilised`, `likely`, `in_care`, or anything about a death.
  5. **Silenced, baseline updated** (spec §5.3 guards, applied to the observations **newer than the baseline**): all of them have provenance `import` or `legacy`; or all were recorded more than 90 days after they were observed (`created_at` vs `observed_at`); or the cat has no baseline yet (first sight: the first run seeds every cat).
  6. **The bulk guard (C14):** if more than 50 changes in one night would be news, none is: all are silenced `bulk`, and Samuel gets an email through the Worker's existing alarm path. (A staff correction sweep looks like this; real news doesn't.)
  7. Watch mode marks news `watched` and stops. (Send mode is Slice 3.)
- **`seedNewsBaseline(catIds)`**: writes the current status for those cats with no change rows (C11).
- **`POST /api/internal/news/nightly`**, with its own token `NEWS_JOB_TOKEN` (a Replit secret, a Worker secret and a GitHub `production` Environment secret, like `MAIL_DRAIN_TOKEN` per `lib/internalAuth.ts`; never in a file). Answers `200` with the night's counts, or `200 { already: true }` if tonight is done. The pre-launch gate lets this one path through, as it does the drain.
- **The Worker** (`infra/mail-drain-cron`): a second cron with its own branch on `event.cron`. **It alarms** (the existing `send_email` path to Samuel) on a non-200, or if `GET /api/internal/news/last-run` shows no finished run in 36 hours (review finding 17). It targets the same base address as the drain (`MAIL_DRAIN_BASE_URL`), which today is the test site; it moves to the live address with the launch switch-over (SYC-345). **`.github/workflows/news-nightly.yml`**: daily backup plus manual runs.
- **The review list:** `GET /api/team/news-changes` (staff only, `can()`) returns the last 30 days of changes with the cat's name and code. `POST /api/team/news-changes/:id/review` sets `reviewed_at` and a note. No dashboard page yet: Claude runs the curl and reads the list to Samuel.
- **Tests** (`lib/news/nightly.test.ts`, real database):
  - **T1-1:** confirmed sterilised → one `sterilised` change. Likely → none.
  - **T1-2:** a cat becoming deceased or presumed dead, or confirmed not sterilised → no news row (F4).
  - **T1-2b:** a sterilisation confirmed on a cat that is dead, and on one presumed dead → silenced `deceased`, nothing send-able. Same for homed.
  - **T1-3:** homed → `homed`. Sightings exactly four months apart → `seen_again`; one day short → nothing; one day over → `seen_again`.
  - **T1-3b:** a cat sighted every week whose baseline wasn't walked for six months → no `seen_again` (the gap is between sightings).
  - **T1-4:** a change resting only on `import` or `legacy` observations → silenced.
  - **T1-5:** a change resting on an observation recorded 91 days after it was observed → silenced `old_news`; at 89 days → news.
  - **T1-6:** first run over 50 cats → baseline seeded, nothing send-able.
  - **T1-7:** `seedNewsBaseline` then a run → no change.
  - **T1-8:** the resolver never reads `cat_news_baseline` (drop the table; `resolveCat` and `deriveCatStatuses` still answer the same; Risk 8).
  - **T1-9:** two calls the same Athens night → the second does nothing; a run that crashes before finishing doesn't claim the night, and the next call runs it.
  - **T1-10:** the endpoint refuses a missing or wrong token, and the token never appears in a log line.
  - **T1-11:** for 30 seeded cats, the check's status equals what `GET /api/cats/:id` shows (data spine §9.1).
  - **T1-12:** sterilised, then not, then sterilised again → one `sterilised` change ever (the ratchet).
  - **T1-13:** 51 news changes in one night → all silenced `bulk`, alarm raised; 50 → none silenced.

---

## Slice 2: the news address, its "is this you?", and Settings

### PR 2.1: server (migration `news_contact_per_device`)

- **Migration:** partial unique index on `email_contacts (device_id) where purpose = 'news'` (C3). Rollback drops it.
- **The switches and the gate** (`lib/news/switches.ts`): `NEWS_SETTINGS`, `NEWS_SPOT_CARD`, `NEWS_ONBOARDING`, `NEWS_REPORT_TICK`, `CAT_NEWS_SEND`, each off unless set to `on`. An ask is **live** only if its switch is on **and** `CAT_NEWS_SEND` is on **and** `cat_news` is enabled with a registered template **and** `RESEND_NEWS_API_KEY` and the fingerprint key are set **and** `cat_news_changes` has at least one reviewed change older than 14 days after the first finished run. `GET /api/news/options` returns the four asks' live state. **The server refuses to start** if any ask switch is on and the gate isn't met, and says which part is missing (spec Risk 1: "this cannot rot").
- **`POST /api/news/address`** (device secret, per `.agents/memory/device-secret-auth.md`): `{ email, surface, language }`, surface `settings`, `spot_card`, `onboarding` or `report`. `404` when that surface isn't live. Otherwise, in one transaction under the address's advisory lock (the pattern in #181's `reporterEmail.ts`):
  - **This phone already has a news address:** pending → replaced by the new one (the old one's links stop working); confirmed → `409 already_on` (the app shows Settings instead).
  - **Do-not-email:** `news` scope (`forget`, `unsubscribe`, `verify_cap`), or `all` scope (`bounce`, `complaint`, `unsubscribe`) → keep nothing. Exception (Decision 6 A): a `news`/`unsubscribe` mark that this phone made itself is lifted.
  - insert the news contact (`pending`) and a `consented` consent event with the surface and the **wording version for that surface** (`NEWS_WORDING = { settings: "news-settings-v1", spot_card_named: …, spot_card_other: …, onboarding: …, report: … }`, so each screen can be reproduced, §5.6);
  - limits as #181's (`REPORTER_LIMITS` shape), on news fingerprints: one "is this you?" per address per 24 h, three ever then a `verify_cap` mark, 20 adds per IP per hour, and the **shared** daily ceiling. Hitting the shared ceiling logs at `error` (spec §4.4 control 3);
  - queue one `public_verify` outbox row, `payload = { kind: "news", contactId, expiresAt, token, forgetToken }`.
  - **The answer is the same whatever happened** (`202 { status: "pending", mask }`), so it never reveals a limit or a mark.
- **`GET /api/news/address`** → `{ state: "off" | "pending" | "on", mask? }`. **`DELETE /api/news/address`** ("Stop emailing me", this phone only; Decision 6).
- **Outbox (C4):** `processRow` sends `public_verify` with `payload.kind === "news"` to `processNewsMail`; everything else goes to #181's code unchanged. `processNewsMail` **re-reads the contact by `payload.contactId`** (it must still exist, be `pending`, and belong to the token's phone) before calling `sendMail`, as `processReporterMail` does, and gives up (clearing the payload) if not. It sends #181's fixed `public_verify` template with `newsSendDeps("verify")`.
- **`suppression.ts`:** `isNewsSuppressed(address, "verify" | "confirmed")`, mirroring `isReportSuppressed`: `verify_cap` and `forget_verify` block only further "is this you?" emails, never mail to an address its holder confirmed (SYC-261). `newsSendDeps(mail)` uses it, and `isNewsConfirmed`.
- **Confirm and forget (C4):** `tokenIsLive`, `confirmAddress` and `forgetAddress` get a `news` branch. Confirm: that contact (only that phone's) becomes `confirmed`, a `verified` event. Forget from the "is this you?" email: delete it, a `news`/`forget` mark, a `withdrawn` event. The confirm page has news wording (English only, like #181's pages; copy below).
- **Delivery records (agreed with the SYC-42 Slice 3 session).** #181's `markSent` records a `mail_deliveries` row for every purpose in `DELIVERY_RECORDED`, which includes `public_verify`, so a news "is this you?" gets one (no `report_id`, the news fingerprint). Every news clean-up (forget, the sweep, Delete my data, unsubscribe) also deletes those rows, as `forgetReporterAddress` does. `cat_news` is **not** added to `DELIVERY_RECORDED`: nothing reads its state, and a bounce or complaint still marks the address, because #181's webhook marks the `to` address on the event, not the delivery row.
- **The 7-day sweep** (`keepSafe/sweep.ts`) adds `news`.
- **Delete my data** (`keepSafe/sever.ts`) already deletes every contact with the device id and redacts its consent events; this PR adds the device's news outbox rows, their delivery rows and its send-log rows (Slice 3).
- **`threat_model.md`:** its stale "no rate limiting anywhere" line is corrected in this PR (spec §4.4).
- **Tests** (`routes/news.address.test.ts`):
  - **T2-1:** an ask not live → `404`, nothing stored.
  - **T2-2:** a pending news address gets exactly one outbox row, `public_verify`, and nothing else, including across a nightly run in send mode where its phone follows a cat with news.
  - **T2-3:** the 24-hour, lifetime and per-IP limits, and each kind of mark → the same `202`, no row, no mail.
  - **T2-4:** a news `public_verify` row goes to `processNewsMail`, a report one still to #181's, in one drain.
  - **T2-4b (cross-phone):** phone A has a pending news contact for an address; phone B confirms the same address. A's row is never sent anything but its one "is this you?", and B's confirmation doesn't confirm A.
  - **T2-5:** confirm, then the forget link is refused (used); forget before confirm → marked, and typing it again sends nothing.
  - **T2-5b (Decision 6 A):** Stop on phone A, then A adds the same address → a new "is this you?"; phone B adding it → nothing.
  - **T2-5c:** a `verify_cap` mark doesn't stop cat news to an address its holder confirmed.
  - **T2-6:** the address never appears in a log line, an API answer (mask only), or a sent outbox row.
  - **T2-7:** day 8 → swept, with its delivery row. **T2-8:** Delete my data → no news contact, outbox row, delivery row or send-log row; consent events redacted.
  - **T2-9:** the server refuses to start with each ask switch on and each part of the gate missing in turn (five parts × four switches), and starts once all are met.
  - **T2-10:** pending address replaced by a new one; a confirmed one → `409`.

### PR 2.2: the Settings row (spec §3.5)

- **`components/news/NewsSettings.tsx`** on the profile tab, **immediately above "Delete my data"** (`app/(tabs)/profile.tsx`, the row at line ~375; spec §3.5 "directly below"). Shown only when Settings is live.
- Off: title, description, the email box, **Save**, then the fixed lines and the under-15 line. Pending: "Check your inbox to confirm" (existing `keepSafeSettingsPending`), with **Change** and **Stop emailing me** (review finding 9: a typo isn't stuck for 7 days). On: "On, sent to s•••@gmail.com", **Change**, **Stop emailing me**. No connection: existing `keepSafeSettingsUnavailable`.
- **Tests:** absent when not live; Save sends the right surface; Change and Stop in both pending and on; nothing pre-ticked; English word for word.

---

## Slice 3: sending cat news (spec §5.1–5.3, §5.7, §5.8)

### PR 3.1: the email, the limits and the unsubscribe page (migration `cat_news_send`)

- **Migration:** `mail_tokens.purpose` check gains `unsubscribe`; a table `news_send_log (contact_id references email_contacts on delete cascade, sent_at)`, the only record the limits need. It holds no address, no fingerprint and no cat, and goes with the contact (spec §8.5: no address-to-cats history). Rollback drops the table and restores the check.
- **`send.ts`:** `cat_news` added to `DEFAULT_ENABLED`; its template in `lib/mail/newsTemplates.ts`; `resend.ts` gains a `headers` field for `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. A test asserts `visit_summary` and `promise_withdrawn` stay off (Risk 5).
- **Send mode of the nightly check** (`CAT_NEWS_SEND=on`), after Slice 1's steps:
  1. Tonight's new changes, plus held ones (Decision 5 A), are matched to **confirmed** news contacts whose phone follows the cat.
  2. **Not to the person who caused it** (C13): a change whose new observations all came from that contact's phone isn't sent to that contact.
  3. **Limits per contact** (spec §5.2), from `news_send_log`: none in the last 7 days; none within 48 hours of confirmation; no yearly limit (Decision 5). Only `cat_news` counts (verification and report mail never do; review finding 21).
  4. **One email per address per night** listing every cat with news for it (spec §5.2 and §8.5's narrow dedupe, grouped in memory). Two phones with the same address get one email, logged against both contacts.
  5. A change a limit blocks stays `held` and is tried each night; after 60 days it becomes `expired` (Decision 5 A).
  6. At most 50 emails a night (S7); the rest stay `held`.
  7. Each email is one outbox row, `purpose: "cat_news"`, `payload = { kind: "news", contactIds, changeIds, expiresAt }`: an intent, not a rendered message (§4.3 step 4).
- **The outbox's `cat_news` branch** (`processNewsMail`): re-reads every contact (must still be confirmed, not marked) and every change, renders at send time (cat names re-checked: S4), creates the unsubscribe token and a delete token, sends with `newsSendDeps("confirmed")`, then **clears the payload** to `{ cleared: true }` and writes `news_send_log` rows. Contact gone or marked → give up and clear. Retries back off as #181's, for three days, then give up and leave the changes `held`.
- **`/mail/unsubscribe`** in `routes/mailPages.ts`: GET shows the page; POST (token, our own origin) acts. `POST /mail/unsubscribe/one-click` answers the mail app's header. Either way: **every** news contact with that address (whoever's phone) is deleted, an `all`-phones `news`/`unsubscribe` mark is added, a `withdrawn` event. The page's third button (when the address is also on a cat report) does what #181's "Delete my details" does. A link pressed twice says "Done" again, not "invalid".
- **Tests** (`lib/news/send.test.ts`):
  - **T3-1:** five changes for one address in one week → one email; a sixth three days later → held, then sent the night the week ends; after 60 days held → expired; a tenth email in a year goes (no yearly cap).
  - **T3-2:** nothing within 48 hours of confirmation; then the held news goes.
  - **T3-3:** unsubscribe, then a run → nothing to that address, from any phone.
  - **T3-4:** a deceased, presumed-dead, likely or not-sterilised cat never appears in an email body (render check over every template branch).
  - **T3-5:** a name failing moderation renders as "a cat you met"; `<script>` is escaped; the subject has no CR/LF.
  - **T3-6:** no coordinate and no place name in any email (S2); the donation line only with a sterilisation.
  - **T3-7:** one-click POST and page POST both mark; a GET changes nothing; a second press says "Done".
  - **T3-8:** two phones, one address → one email, logged twice.
  - **T3-9:** a sighting by the follower themselves after a gap → no email to them; another follower of the same cat → email.
  - **T3-10:** a sent outbox row keeps no cat id and no address.
  - **T3-11:** a `cat_news` row whose contact was deleted gives up and clears its payload.
  - **T3-12:** 60 eligible emails → 50 sent, 10 held for tomorrow.

---

## Slice 4: the after-a-spot card (spec §3.1, §3.2, §2.4, §10.3)

### PR 4.1: the card on the reward screen

- **`components/news/SpotNewsCard.tsx`** on the success block of `app/review.tsx` (`matchConfirmed` / `newCatRegistered`, below the points and badges, around line 318), never above, never blocking the buttons. **Agreed with the match-wait session on 15 Oct:** the feeding nudge is only on the match list and the naming screen, so they never share a screen; this PR rebases after its PR 2 (26 Oct).
- Shown when the card is live, this phone has no news address, the card has never been shown here, and fewer than two news asks are used (S3).
- **Named a new cat** (`result.isNewCat`): §3.1 words. **Confirmed someone else's:** §3.2 words.
- **The decline budget lives on the phone** (spec §2.4): `lib/newsAsks.ts`, AsyncStorage `newsAsks.v1 = { used, cardShown, given }`, every read in try/catch. Giving an address anywhere sets `given`.
- "No thanks" → replaced, once, by the declined line. "Keep me posted" → `POST /api/news/address` (`spot_card`) → the thanks line (never "sent"). The reward screen needs a connection already, so there's no offline case.
- **Tests:** shown once; not on a second reward screen; "No thanks" remembered across a restart; two used asks stop it; never when not live; named vs. not named wording; nothing pre-ticked.
- **Checked in a real browser** at 390 px and 1280 px, in all three languages, before the PR opens: the card never pushes the "See {name}" button off a small screen.
- **Before and after** (spec Risk 2): the share of spots that reach the reward screen and then a second spot, for the two weeks before and after the card goes on. How to measure it: SYC-376.

---

## Slice 5: the two news boxes (spec §3.0, §3.4)

### PR 5.1: onboarding and the report screen

- **`KeepSafeScreen.tsx`:** the unticked news box when onboarding is live. **Save my spots** with it ticked → the keep-safe add (unchanged) **and** a news add (`onboarding`). Skip uses no news ask (spec §2.4). Ticking sets `given`.
- **#181's report email screen** (`components/report/ReportWizard.tsx`): once an address is typed, the unticked "Also email me news about the cats I've met", when the report box is live and this phone has no news address. The report body gains `newsToo`. The report is written first, exactly as #181 does; then `addReporterEmail`; then, if `newsToo`, the news add (`report`). A failure in the news part is logged and changes nothing the reporter is told.
- **Decision 3 A, every case** (each a test):

| The report's address | What the news address does |
|---|---|
| New, and #181 queues its "is this you?" | Created pending with **no** email of its own. Confirming the report's "is this you?" on this phone confirms it too |
| Already confirmed on this phone (no "is this you?" goes) | Sends its own news "is this you?" (its own limits) |
| A limit or mark stops the report's "is this you?" | Sends its own, under news limits and marks |
| Confirmed only on another phone (#181 sends a fresh one) | Rides on that one, like the first row |

  "Forget this address" from that shared email forgets both. "Delete my details" from a later report email deletes the report address only; the news address stays (they're separate consents).
- **Offline:** the tick rides in the queued report (#181's `reportQueue.ts`), under #181's "We'll send a message to check that address when you're back online". Onboarding already needs a connection.
- **Tests:** each table row; hidden until an address is typed; not live → no news contact; the report and its alert identical with and without the tick; two used news asks still show the report's own email question (spec §2.4) and its tick.

---

## Every mutation probe (break it, see the named test go red, put it back)

Every guard above that could fail silently has one. The builder runs each and records the result in the PR.

| Probe | Test that must go red |
|---|---|
| Let `likely` count as confirmed | T1-1 |
| Drop the "never a death" exclusion | T1-2 |
| Drop the blanket dead-or-presumed-dead rule | T1-2b |
| Change "four months or more" to "more than" | T1-3 |
| Measure the gap from the baseline instead of the previous sighting | T1-3b |
| Drop the import/legacy guard | T1-4 |
| Drop the 90-day guard | T1-5 |
| Skip seeding on first sight | T1-6 |
| Make `seedNewsBaseline` write a change | T1-7 |
| Make the cat page read `cat_news_baseline` | T1-8 |
| Claim the night at the start, not the end | T1-9 |
| Log the token | T1-10 |
| Use `deriveCatStatuses`' legacy path in the check | T1-11 |
| Clear `notified_sterilised_at` on a flip | T1-12 |
| Raise the bulk limit to 1,000 | T1-13 |
| Return `true` from `/options` with the switch off | T2-1 |
| Queue an acknowledgement for a pending news address | T2-2 |
| Skip the mark check | T2-3 |
| Route every `public_verify` to #181's code | T2-4 |
| Check verification by address instead of by contact | T2-4b |
| Lift the mark for any phone | T2-5b |
| Let `verify_cap` block confirmed mail | T2-5c |
| Return the full address from GET | T2-6 |
| Drop news from the sweep | T2-7 |
| Skip the delivery rows in Delete my data | T2-8 |
| Drop each part of the start-up gate in turn | T2-9 |
| Drop the weekly limit; drop holding | T3-1 |
| Drop the 48-hour quiet | T3-2 |
| Skip the mark check in `newsSendDeps` | T3-3 |
| Let a deceased cat through the renderer | T3-4 |
| Skip the send-time name check | T3-5 |
| Add the cat's blurred place to the email | T3-6 |
| Let GET unsubscribe | T3-7 |
| Send per phone instead of per address | T3-8 |
| Drop the "not about your own spot" rule | T3-9 |
| Keep the payload after send | T3-10 |
| Send a second "is this you?" for the shared report + news case | Slice 5 first-row test |
| Let a news failure throw before the report reply | Slice 5 "report identical" test |

## Every place the "confirmed only" rule must hold

The rule (F7b): a news address gets the one fixed "is this you?" and nothing else until confirmed, by **that** contact on **that** phone.

1. `sendMail`'s `verified_public` check with `newsSendDeps("confirmed")`: every `cat_news` send. Address-level, so not enough on its own:
2. `processNewsMail` re-reads each contact by id (pending for "is this you?", confirmed for news) before sending: T2-4b, T3-11.
3. The nightly check's send step picks confirmed contacts only: T2-2.
4. The outbox routing of `public_verify` by `payload.kind`: T2-4.
5. Slice 5's shared confirmation confirms only this phone's news row: T2-4b's pattern, repeated in Slice 5.
6. A future `visit_summary` or `promise_withdrawn` sender: both stay off (Slice 3 test).

## Where each of the spec's tests is built

| Spec §9 invariant or risk | Test |
|---|---|
| No address in any public response | T2-6 |
| No send of any kind to an unverified address | T2-2, T2-4b, and #181's test 31 |
| The weekly cap holds when events cluster (fortnight and annual caps changed by Decision 5) | T3-1 |
| Unsubscribe stops sends within the same request | T3-3 |
| Deletion removes the address, sightings stay unlinked | T2-8 (SYC-63's tests cover sightings) |
| A decline is remembered across restarts | Slice 4 |
| Two news declines stop news asks but not the report ask | Slices 4 and 5 |
| The notify job sends nothing for an import batch | T1-4, T1-7 |
| The notify job never sends on a negative or a death | T1-2, T1-2b, T3-4 |
| An emailed summary contains no exact coordinate | T3-6 (visit summary: SYC-370) |
| Risk 1: no ask live without a sender and the two weeks | T2-9 |
| Risk 5: closed list | Slice 3 test |
| Risk 8: the resolver never reads the baseline | T1-8 |

---

## How email-capture mail is ranked (SYC-358)

Nothing email capture sends is "never shed". In the order SYC-358 sheds as Resend's daily limit nears (spec §2.10, email-capture §7.3):

1. **Shed first: `cat_news`.** It can always wait: with Decision 5 A, a shed email is simply held.
2. **Shed second: news "is this you?"** (`public_verify`, `kind: "news"`), in the same group as the reporter's "is this you?".
3. Never ahead of the reporter's acknowledgement and outcome, the welfare alert, sign-in or restore links.

Until SYC-358 is built, the backstops are the 50-a-night limit (S7), the shared daily ceiling on "is this you?" emails, and the per-address and per-IP limits. **`CAT_NEWS_SEND` stays off until SYC-358 merges, or Samuel confirms the Resend plan's daily limit leaves room.** Which Resend plan the account is on is **unchecked** (no Resend key on this machine).

---

## Copy for the 22 October freeze (SYC-346)

Every new sentence a visitor sees. English is the spec's, word for word where the spec has words. **Greek and French are drafts for Johnny.** On screens the app speaks informally (εσύ / tu), like the keep-safe and report strings; the two news **boxes** use the polite plural ("Στείλτε μου", "Envoyez-moi") because the person is speaking **to** Syros Cats.

**Notes for Johnny:**
- In Greek, "γάτα" is grammatically feminine whatever the cat's sex, so "τη γάτα {name}" and the pronouns that follow it ("της", "την") are the ordinary way to talk about any cat, not a statement that it's female. Please check that reads naturally, and reword where it doesn't.
- The French email lines use "·e" for a cat of unknown sex; reword round it if you prefer.
- Reused, already in the app: the first fixed line ("We'll send one message first…", `reportEmailCheck`), `keepSafeSettingsPending`, `keepSafeSettingsUnavailable`, the email placeholder.

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

### In the email and on the web pages (all three languages ship, Decision 7; Johnny checks them in the pack)

| Where | English | Greek (draft) | French (draft) |
|---|---|---|---|
| Subject, one cat | News about {name} | Νέα για τη γάτα {name} | Des nouvelles de {name} |
| Subject, several | News about {n} cats you've met | Νέα για {n} γάτες που έχεις γνωρίσει | Des nouvelles de {n} chats que tu as rencontrés |
| Sterilised | {name} has been sterilised. Thank you for spotting them: every spot helps Syros Cats find the cats who still need it. | Η γάτα {name} στειρώθηκε. Ευχαριστούμε που την κατέγραψες: κάθε παρατήρηση βοηθά τη Syros Cats να βρει τις γάτες που το χρειάζονται ακόμη. | {name} a été stérilisé·e. Merci de l'avoir repéré·e : chaque observation aide Syros Cats à trouver les chats qui en ont encore besoin. |
| Homed | {name} has found a home. | Η γάτα {name} βρήκε σπίτι. | {name} a trouvé un foyer. |
| Seen again | {name} was spotted again on {date}, after four months or more with no sightings. | Η γάτα {name} εμφανίστηκε ξανά στις {date}, μετά από τέσσερις μήνες ή περισσότερο χωρίς παρατηρήσεις. | {name} a été revu·e le {date}, après quatre mois ou plus sans observation. |
| Name failed the check (S4) | a cat you met | μια γάτα που γνώρισες | un chat que tu as rencontré |
| Donation line (sterilised only, at the bottom, §5.7) | A sterilisation costs €50–60. If you'd like to help pay for the next one: Help Syros Cats | Μια στείρωση κοστίζει 50–60 €. Αν θέλεις να βοηθήσεις στην επόμενη: Στήριξε τη Syros Cats | Une stérilisation coûte 50 à 60 €. Si tu veux aider à financer la prochaine : Soutenir Syros Cats |
| Footer | You're getting this because you asked for news about cats you met with the Cat Spotters app. Stop these emails · Delete my email address · What we do with your email · hello@catspotters.com | Το λαμβάνεις επειδή ζήτησες νέα για γάτες που γνώρισες με την εφαρμογή Cat Spotters. Σταμάτα αυτά τα email · Διάγραψε τη διεύθυνσή μου · Τι κάνουμε με το email σου · hello@catspotters.com | Tu reçois ce message parce que tu as demandé des nouvelles des chats rencontrés avec l'appli Cat Spotters. Arrêter ces e-mails · Supprimer mon adresse · Ce que nous faisons de ton e-mail · hello@catspotters.com |
| Confirm page, done (news) | Thank you. We'll email you when there's real news about a cat you've met. You can close this page. | Ευχαριστούμε. Θα σου στείλουμε email όταν υπάρχουν πραγματικά νέα για μια γάτα που γνώρισες. Μπορείς να κλείσεις αυτή τη σελίδα. | Merci. Nous t'écrirons quand il y aura de vraies nouvelles d'un chat que tu as rencontré. Tu peux fermer cette page. |
| Unsubscribe page, title | Stop cat news emails | Σταμάτα τα email με νέα για γάτες | Arrêter les e-mails de nouvelles |
| Unsubscribe page, text | Press the button and we'll stop emailing you news about cats. Nothing else in the app changes. | Πάτησε το κουμπί και θα σταματήσουμε να σου στέλνουμε νέα για γάτες. Τίποτε άλλο δεν αλλάζει στην εφαρμογή. | Appuie sur le bouton et nous arrêterons de t'envoyer des nouvelles des chats. Rien d'autre ne change dans l'appli. |
| Unsubscribe page, report line (only if the address is on a report) | This address is also on a cat report. We'll still send the one email about what happened, unless you stop that too. | Αυτή η διεύθυνση υπάρχει και σε μια αναφορά για γάτα. Θα σου στείλουμε κανονικά το ένα email για το τι έγινε, εκτός αν το σταματήσεις κι αυτό. | Cette adresse figure aussi sur un signalement. Nous t'enverrons quand même l'e-mail sur ce qui s'est passé, sauf si tu l'arrêtes aussi. |
| Unsubscribe page, buttons | Stop emailing me · Delete my email address · Stop emails about my cat report too | Σταμάτα τα email · Διάγραψε τη διεύθυνσή μου · Σταμάτα και τα email για την αναφορά μου | Arrêter les e-mails · Supprimer mon adresse · Arrêter aussi les e-mails sur mon signalement |
| Unsubscribe page, done | Done. We won't email you cat news again. You can close this page. | Έγινε. Δεν θα σου ξαναστείλουμε νέα για γάτες. Μπορείς να κλείσεις αυτή τη σελίδα. | C'est fait. Nous ne t'enverrons plus de nouvelles des chats. Tu peux fermer cette page. |
| Delete done | Done. We've deleted your email address. You can close this page. | Έγινε. Διαγράψαμε τη διεύθυνση email σου. Μπορείς να κλείσεις αυτή τη σελίδα. | C'est fait. Nous avons supprimé ton adresse e-mail. Tu peux fermer cette page. |

The "is this you?" email itself is #181's and unchanged.

---

## Rollout

1. Slice 1 merged → migration through db-ops (development, production, verify; Neon writes need Samuel to switch this session to "ask" mode first) → Samuel's Replit pull and publish → wait until `/api/healthz` shows the new commit → Claude adds `NEWS_JOB_TOKEN` to Replit, the Worker and GitHub (heads-up first: it creates secrets outside the repo) → the Worker deployed with wrangler → a manual run, and Claude reads the change list back to Samuel. **That starts the clock** (on the test site until launch; on the live site from 31 Oct).
2. Each later slice: merged, migrated, published, still switched off.
3. **Switch-on**, in the order under "How it ships". After each switch, a probe with Samuel's own address (heads-up first: it emails him).

## What works with no signal, precisely

- The spot card needs a connection (it appears only after an online resolve).
- Settings and the onboarding news box need a connection, and say so (existing strings).
- The report's news tick rides with a report saved offline and goes when the phone reconnects; the copy promises only a message "when you're back online".
- The nightly check and the emails are server-side.

## Where this collides with other work

| Other work | Shared files | Order |
|---|---|---|
| **PR #178** (SYC-53 PR 1.1, open) | `lib/mail/outbox.ts`, `lib/mail/send.ts` (adds `person_invite`, `access_change_notice`), `lib/mail/suppression.ts`, `lib/db/src/index.ts` | Slices 2 and 3 rebase on #178 if it merges first; if Slice 2 is ready first, message the SYC-53 session and agree who rebases. Slice 1 touches none of these |
| #181 (merged) | Every shape this plan uses | Final, confirmed by its session on 15 Oct |
| Match-wait plan (SYC-36 + SYC-48) | `app/review.tsx` (the nudge on the match list and naming screen; the card on the success block) | Agreed 15 Oct: they never share a screen; Slice 4 rebases after its PR 2 (26 Oct) |
| SYC-53 PR 1.2 (#179) | `lib/i18n.ts`; `can()` | Rebase; no shared logic |
| SYC-358 | `lib/mail/send.ts` | `CAT_NEWS_SEND` waits for it (above) |
| `mail-drain-cron` Worker (SYC-231) | `infra/mail-drain-cron` | Slice 1 adds a cron branch; the drain is unchanged |
| Migrations from any session | `lib/db/migrations` | Next free number at generation time, after rebasing, after messaging live sessions |

## What this plan does not do

- The visit summary (Decision 2: SYC-370).
- "We can't keep our promise" and the 24-month "still want these?" email (SYC-372).
- Deleting a reporter's address 90 days after close (C9: SYC-42 plan item 4.3, tracked as SYC-371).
- Staff deleting a news address by hand from the dashboard (spec §6.2 door 3), and "what do you hold about me?" (§6.4): SYC-375. Until then, "Delete my data" and the link in every email cover it.
- Measuring the card's effect on spotting (spec Risk 2): SYC-376.
- The priority budget itself (SYC-358). Donation receipts (spec §1.2 E).

---

## Model delegation

This session (Opus) wrote the plan. For the build:

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Slice 1: the nightly check and its guards | **Opus** | Silent-failure territory: a wrong guard emails a "sterilised" about a cat that has died. Reads the resolver's evidence | T1-1…T1-13, and their **mutation probes** (table above); Sonnet adversarial review of the diff in its **own worktree** |
| Slice 2 PR 2.1: news address, gate, routing, confirm/forget | **Opus** | Changes #181's and SYC-3's mail code, where a mistake sends to an unconfirmed address | T2-1…T2-10 and their probes; Sonnet adversarial review (own worktree) against "Every place the confirmed-only rule must hold" |
| Slice 2 PR 2.2: the Settings row | Sonnet | Clear spec, an existing pattern (`KeepSafeSettings`) | Component tests; Opus spot review; real-browser check at 390 px and 1280 px |
| Slice 3: sending, limits, unsubscribe | **Opus** | Limits and marks are silent failures (too many emails, or emails after "stop") | T3-1…T3-12 and their probes; Sonnet adversarial review (own worktree) |
| Slice 4: the card | Sonnet | One component, a device-side counter | Component tests, real-browser check; Opus spot review |
| Slice 5: the boxes; the shared confirmation | Sonnet for the boxes, **Opus** for the confirmation table | Confirming two rows from one email, across five cases, is not routine | The five case tests and their probes; Sonnet adversarial review (own worktree) |
| i18n strings from this plan | Haiku | Mechanical copy from the tables | A test that every key exists in all three languages; Sonnet spot review that the English is word for word |
| Adversarial review of this plan | Sonnet | Careful reading against the spec and code, not design | Findings and outcomes in `syc-344-email-capture-review.md` |

**Every agent prompt in the build restates, word for word:** commit after each item; keep a `CHECKPOINT.md` in the worktree; never hold work only in memory. **Each reviewer gets its own worktree** (probes mutate the tree). **Re-run delegated tests yourself before merging** (an agent's "tests pass" has been false before).

## Linear

- **SYC-344:** this plan, In Review until Samuel approves.
- **SYC-45:** blocked by SYC-344; a comment links this plan and its slices, and notes that any records-import plan must call `seedNewsBaseline` (C11).
- **SYC-55:** Slices 1 and 3 deliver its core.
- **Filed from this plan:** SYC-370 (visit summary), SYC-371 (tracks SYC-42 item 4.3), SYC-372 (`promise_withdrawn` and the 24-month email), SYC-375 (staff deletion by address and the §6.4 export), SYC-376 (measuring the card's effect on spotting, Risk 2).

## Still needs Samuel

- ~~Decisions 1–7~~ settled 15 Oct. The small calls stand unless he objects.
- Approve the plan, so Slice 1 can be built the week of 19 Oct.
- Later: review the first real change the nightly check finds.
