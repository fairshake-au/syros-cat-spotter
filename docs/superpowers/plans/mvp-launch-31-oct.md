# Cat Spotters MVP: the plan to launch on Saturday 31 October 2026

**Status:** for Samuel's approval · written 15 October 2026 · Linear project P-SYC-54 ("Cat Spotters: MVP to MLP")
**Scope:** the full MVP in `docs/PRODUCT-SPEC.md` §2, as Samuel decided on 12 October (recorded on SYC-73), **with one approved exception:** spec §2.6 promises a per-site "make public" switch for feeding sites, and the approved SYC-209 plan moves that to after launch (its Slice 6). Records import (SYC-49), photos out of Postgres (SYC-46) and the hosting re-decision (SYC-47) are outside the MVP by the spec.
**Evidence base:** `origin/main` at `2acae50`, `gh pr list`, the live session list and Linear, all on 15 October. Where a claim comes from somewhere else it says so; where nobody has checked, it says **unchecked**.
**Adversarial review:** `mvp-launch-31-oct-review.md`, beside this file, with what happened to each finding. A summary is at the end.

---

## Words used in this plan

- **The pre-launch pass:** the password that keeps the app to testers today. Turning it off is the launch.
- **Turnstile:** Cloudflare's invisible "are you a person?" check on the two report forms. Today it only **watches** and lets everything through; once the pre-launch pass is off it **refuses** anything that fails.
- **Publish:** making merged code live. Samuel pulls the latest code into Replit (one click in its Git pane), then Claude publishes and checks the live site shows the new version.
- **Database change (migration):** a numbered change to how the database is laid out. Each one is applied to the live database before the code that needs it is published.
- **Store build:** the iPhone or Android app as Apple and Google receive it. None has ever been made.

---

## The short version

There are 16 days. Building isn't the hard part: about 28 pull requests have merged since 14 October (`gh pr list --state merged`). Four things decide whether 31 October happens:

1. **The phone apps can't be in the stores by 31 October.** No store build has ever been made. If the Google Play account is a personal one, Google makes a new app run a closed test with 12 or more testers for 14 days in a row before it can go public, and Apple's review takes 1–2 weeks. So the plan launches **the website version of the app** (the one testers use today) on 31 October, with the QR codes pointing at it, and submits both store apps as soon as they're ready so they follow in November. **This is Samuel's call: decision D1.**
2. **All the new Greek and French has to reach Johnny by Thursday 22 October.** Every new visitor-facing sentence (starter facts, feeding nudge, "Report an issue", the reporter's email, the rename) is written in English and drafted in Greek and French by then, even for screens that are built later. The starter facts and the feeding nudge already have Greek and French drafts in their spec (PR #174, approved).
3. **Samuel is the only person who can merge and start a publish.** About 30 more pull requests and seven publishes have to fit through him. The plan batches them into two merge windows a day and a fixed publish calendar.
4. **Samuel's own launch tasks**: the store accounts, approving the privacy policy, the liability check on the injured-cat advice, and three conversations with Syros Cats. Each is small, but each blocks launch on its own.

If the date slips, Samuel's agreed order is: **email capture goes first, then the rest of the feeding-site map.** This plan proposes two more cuts for him to accept or reject now (D4).

The "make public" switch for feeding sites (spec §2.6) is **not** in the 31 October launch: the approved SYC-209 plan puts it after launch, so no feeding site can appear on the visitors' map yet.

---

## What "launched" means on 31 October

On Saturday 31 October:

- Anyone on Syros can open the app in a browser at its launch address, without the tester password, in English, Greek or French.
- They can spot a cat, see the approximate map, report a cat in trouble, and report a problem with any cat or photo. Both report forms refuse bots.
- Someone who reports a cat in trouble can leave an email address and hear back when Syros Cats acts (spec §2.5).
- Syros Cats' staff use their dashboard for the welfare queue, the new issue reports, record corrections, colonies and their private feeding-site map.
- A privacy policy and a support page are live on catspotters.com.
- QR materials in cafés, hotels and at the Kini feeders point at the web app.
- The iPhone and Android apps are submitted to Apple and Google, and go live when the stores approve them.

The web app works partly offline: spots made with no signal wait and send later, but the website itself needs a signal to open (SYC-169) and has no offline map pictures (SYC-167). The phone apps do better on both, which is one reason to get them into the stores quickly.

Not in this launch: guardians and volunteers signing in (roles and invites, SYC-53, is MLP), public feeding sites, and the records import.

---

## Where things stand on 15 October

Checked against `origin/main` (`2acae50`), `gh pr list`, the session list and Linear on 15 October.

| Spec item | Where it is | Evidence |
|---|---|---|
| §2.1 Rename to "Cat Spotters (Syros)" | **Not done.** `app.json` still says "Syros Cat Spotters"; the app name in all three languages is still the old one | `artifacts/cat-spotter/app.json:3`; `lib/i18n.ts:50,610,1154`; SYC-34 Backlog |
| §2.1 €50–60 copy, French title, "clipped tip" | Done | SYC-14, SYC-15 Done |
| §2.2 Keep-your-distance screen | Done | SYC-35 Done |
| §2.2 Feeding nudge | **Spec approved by Samuel, 15 Oct** (PR #174, `docs/specs/feeding-nudge.md`). Nothing built | `gh pr view 174`; SYC-36, SYC-343 |
| §2.2 ~20 starter facts per language | **Spec approved by Samuel, 15 Oct** (PR #174, `docs/specs/starter-facts.md`), with all 20 facts and their Greek and French drafts. Nothing built | `gh pr view 174`; SYC-48, SYC-343 |
| §2.3 500 m matching, 25/15 points, ear-tip question, note + food/water | Done | SYC-39, SYC-38, SYC-37, SYC-74 Done |
| §2.4 Life status | Done | SYC-40 Done |
| §2.4 Sterilised Confirmed/Likely | Built. "Likely" is hidden from the public by a switch that is still off. The three conditions for turning it on are met in the code: the team's correction tools (#68), the correction screens (#99) and staff reaching the dashboard (SYC-103 Done) | `artifacts/api-server/src/lib/likelyGate.ts:33`; SYC-75 In Progress |
| §2.4 Approximate public locations | Done | SYC-41 Done |
| §2.5 Cat-in-trouble report, queue, capacity messaging | Done and live with testers | SYC-42 comment, 9 Oct, build `cfe2d53` |
| §2.5 Reporter's acknowledgement and status email | **Being built** (SYC-42 Slice 3) | session "Build SYC-42 Slice 3", running on 15 Oct |
| §2.5 Greek and French for the report flow | Drafted (all 522 keys exist in all three languages), **not native-checked** | `lib/i18n.ts` key count; SYC-172 Backlog |
| §2.6 Staff sign-in and dashboard, welfare queue, corrections | Done | SYC-43 comments; SYC-103 Done |
| §2.6 Colonies and colony naming | Done (SYC-209 PRs 2.1, 2.2) | `git log origin/main` |
| §2.6 Private feeding-site map | Map pictures done (PR 3.1, #161). Pages in review (PR 3.2, #169). Adding and moving sites (3.3, 3.4) not started; 3.4's precondition, PR 0.2, merged (#125) | `gh pr list`; `git log origin/main` |
| §2.6 Per-site "make public" switch | **After launch** by the approved SYC-209 plan (Slice 6) | SYC-209 plan, "Slice 6" |
| §2.6 "Report an issue" | Docs only (PR 0.1). Its database change (PR 4.1) is being built. About 10 PRs to go | SYC-44 plan; session list |
| §2.7 Email capture | Spec approved 28 Sep. Plan written, all seven decisions settled by Samuel on 15 Oct (PR #186, `syc-344-email-capture.md`). **No news ask is live on 31 Oct:** the spec allows none until the nightly check has run two weeks on real data, so before launch only that check is built, watching and sending nothing. Earliest switch-on about 14 Nov (Decision 1) | PR #186; SYC-344 |
| §2.8 Migrations, photo hardening | Done | SYC-64, SYC-98, SYC-121 Done |
| Turnstile on the report forms | Server check watching only (#151, #163). It switches itself to refusing when the pre-launch pass goes off. Its secret key is **not yet in Replit** (commit message of #163). Website part (PR 1.2) being built. Phone-app part (PR 1.3) not started | SYC-170; `artifacts/api-server/src/lib/turnstile.ts:212-221` |
| Shared rate limits | Counted in the database (#150). Left: check a limit holds across a republish, then allow more than one server | SYC-105 comment, 15 Oct |
| Hidden photos kept out of caches | In review (#168) | SYC-279 |
| Deleting a hidden photo for good | Decided (SYC-44 plan, Decision 3); built as SYC-44 PR 7.2 | SYC-44 plan; SYC-246 |
| How Replit applies database changes | Superseded: database changes now go through `db-ops` on Neon | SYC-102 comment, 7 Oct; SYC-121 Done |

**Needed to launch but not in the spec** (found while writing this plan):

- **Store builds** (SYC-323): no `eas.json`, so no store build has ever been made. Nobody has recorded whether the Google Play and Apple developer accounts exist. I searched Gmail for the last 90 days: there is Apple developer newsletter mail, but no Apple enrolment confirmation and no Google Play Console mail. That isn't proof they don't exist (another address may hold them), so this is **unchecked**.
- **The launch web address** (SYC-306) isn't decided, and Turnstile only accepts `apptest.catspotters.com` today (`turnstile.ts:44`).
- **Native check of the "Report an issue" words** (SYC-305) is a launch blocker.
- **`news.catspotters.com` verified with Resend**, the mail service, which the reporter's email needs before it can send (SYC-42 plan, line 389). **Unchecked.**
- **Turning the pre-launch pass off** is the launch itself, and had no ticket (now SYC-345).

---

## Decisions Samuel needs to make this week

Each has a recommendation. D1 is the one that moves the date. All are on SYC-347 except D3 (SYC-306).

### D1. What launches on 31 October: the web app, or the store apps too?

| Option | What visitors get on 31 Oct | Benefits | Risks |
|---|---|---|---|
| **A. Web app on 31 Oct; store apps follow when approved (recommended)** | Scan a QR code, the app opens in the browser. Later: "Get it on the App Store / Google Play" | The date holds. Testers already use the web app every day. A QR code needs no install, which suits a tourist with five days on the island | The website needs a signal to open, and has no offline map pictures (SYC-169, SYC-167). Push notifications don't reach web users |
| B. Wait for both stores | Everything at once | One announcement | Almost certainly misses October. The builds don't exist yet, and Play's 14-day test (if it applies) couldn't finish before 29 Oct even if it started today |
| C. Web on 31 Oct, iPhone only by 31 Oct | Web plus iPhone | iPhone users get the full app | Depends on Apple enrolment being done already (unchecked) and an Apple review inside about a week. Splits attention in the riskiest week |

**Recommendation: A.** It keeps the date, and the QR codes work the same either way.

**D1b. Whose name the store accounts are in.** Fair Shake as an organisation needs extra verification (Apple needs a D-U-N-S company number, which can take weeks) but avoids Google's 14-day test for personal accounts. Samuel personally is quicker to set up, but brings the 14-day test on Android. **Recommendation:** whichever account already exists; if neither does, Samuel personally for Apple (days, not weeks) and start the Android 14-day test on Monday 19 October with the WhatsApp testers.

### D2. The phone app's permanent id and the store name

The app's id is `com.syroscatspotters.app` (`app.json:18,21`). Once a build is in a store, it can never change. Visitors never see it. The store **name** ("Cat Spotters (Syros)" and per-language names, spec §2.1, §5) needs Syros Cats' final view.

**Recommendation:** keep the id. Ask Syros Cats for the store name this week; with no answer by Monday 19 October, use "Cat Spotters (Syros)" (store names can change later; ids can't).

### D3. The launch web address (SYC-306)

Turnstile, the QR codes and the staff sign-in all need it. Keeping `apptest.catspotters.com` sends the public to a "test" address.

**Recommendation:** `app.catspotters.com`, decided by Friday 16 October. Claude sets up the address and Turnstile through the Cloudflare API and checks them end to end by Tuesday 27 October, so the first real test isn't the day before launch. `apptest` keeps working through November so staff sign-in can't break on launch day.

### D4. Two more cuts, if the date is at risk

Samuel agreed two cuts: email capture first, then the rest of the feeding-site map. Two more, in this order:

3. **Starter facts at 10 per language instead of the ~20 in spec §2.2** (`PRODUCT-SPEC.md:49`). The facts spec (PR #174) already tags 10 of them as "core", so this cut means launching with the core 10 and adding the other 10 in the first update. The spec's own recommendation is all 20; the cut is only for if the date is at risk.
4. **"Report an issue" PRs 7.2 (deleting a photo for good) and 8.1 (the one-year clean-up) move to the first week of November.** The team can still hide a photo at once; until 7.2 ships, Claude deletes on request. 8.1 has nothing to do for a year.

**Recommendation:** accept both as cut candidates. Neither changes what a visitor sees on 31 October.

### D5. "Report an issue" in the app before the phone apps' Turnstile check exists

The approved SYC-44 plan holds the app's report screen (PR 6.2) until both the website's and the phone apps' Turnstile checks exist (PRs 1.2 and 1.3). With D1 = A, the phone apps aren't public on 31 October.

| Option | Benefits | Risks |
|---|---|---|
| **A. Ship 6.2 on the website once 1.2 is in; the store apps get it with 1.3 (recommended)** | Visitors can report an issue on launch day | Changes the approved order. The phone apps' saved-report path is first tested with 1.3 |
| B. Keep the approved order | No change to the plan | 6.2 waits for 1.3, which needs a store build; "Report an issue" probably misses 31 October |

**Recommendation: A**, with 1.3 made a condition of the store release.

---

## The critical path

Working backwards from Saturday 31 October.

| By | What | Owner | Why that date |
|---|---|---|---|
| **Fri 16 Oct** | D1–D5 decided; store accounts checked, and registered if missing | Samuel | The store accounts are the longest wait |
| **Fri 16 Oct** | Match-wait spec (SYC-343) written and reviewed (done: PR #174); email-capture plan (SYC-344) written and reviewed; `news.catspotters.com` checked with Resend | Claude | Their words must reach Johnny by the 22nd |
| **Mon 19 Oct** | Match-wait spec and email-capture plan approved | Samuel | Building starts 19–20 Oct |
| **Mon 19 Oct** | Syros Cats answer the 5 feeding-nudge questions and sign off 9 of the facts (PR #174) | Syros Cats, asked by Samuel | Unanswered items fall back to defaults the team can change in settings, so this blocks nothing; answers just make launch-day text right |
| **Mon 19 Oct** | First store builds; Android closed test started if needed | Claude, with Samuel for account steps | Starts Google's 14-day clock |
| **Tue 20 Oct** | Privacy policy spec approved (SYC-82) | Samuel | The policy must be live before store submission |
| **Thu 22 Oct** | **Copy freeze.** Every new visitor-facing sentence written in English and drafted in Greek and French, including screens not built yet (their words are in the specs) | Claude | Johnny's pack |
| **Thu 22 Oct** | Privacy policy and support page live on catspotters.com | Claude publishes; Samuel confirms the wording with Syros Cats | Store submission |
| **Fri 23 Oct** | Johnny's pack sent (SYC-346); liability check done (SYC-171) | Samuel | |
| **Fri 23 Oct** | Store apps submitted, if the accounts and builds are ready | Claude, Samuel for console steps | 1–2 weeks of review |
| **Mon 26 Oct** | Turnstile secret key in Replit; `/api/healthz` shows it configured | Samuel pastes, Claude checks | Without it, every report is refused once the pass is off (`turnstile.ts:237`) |
| **Tue 27 Oct** | Launch address live end to end; Johnny's corrections back | Claude; Johnny | |
| **Wed 28 Oct** | **Feature freeze.** Everything that launches is merged | Claude, Samuel merges | Two days to publish, check and fix |
| **Thu 29 Oct** | Final publish | Samuel pulls, Claude publishes | One clear day |
| **Fri 30 Oct** | Launch-day checklist run on the live site; Syros Cats told the date | Claude, Samuel | |
| **Sat 31 Oct** | Pre-launch pass off; QR codes go out | Claude switches, Samuel and Syros Cats announce | Launch |

---

## The publish calendar

Samuel merges in two windows a day (morning and evening), each a batch of PRs that have passed review and CI. About 30 build PRs fit through 13 working days at two or three a window. Publishes happen on fixed days so database changes go out in order:

| Publish | PRs going live | Database change |
|---|---|---|
| **Fri 16 Oct** | SYC-209 3.2; SYC-279 cache rule; Turnstile website part (SYC-170 1.2); SYC-44 4.1 | `0023_issue_reports` |
| **Mon 19 Oct** | SYC-44 4.2; SYC-42 Slice 3 (reporter's email); SYC-209 3.3; the rename (SYC-34) | 4.2's one-line change, then Slice 3's if it has one |
| **Wed 21 Oct** | SYC-44 5.2 then 5.1; SYC-209 3.4; "Likely sterilised" switched on (SYC-75) | none |
| **Fri 23 Oct** | SYC-44 6.1, 6.2; match-wait screen PR 1 (server pieces and the facts); email capture Slice 1 (the nightly check, watch-only) | two migrations, in merge order, each taking the next free number from `0027`: the match-wait one (`app_settings` and `donation_link_taps`, seeded with the donation address) and email capture's `cat_news_check` |
| **Mon 26 Oct** | SYC-44 7.1; match-wait screen PR 2 (the feeding nudge everywhere); more than one server allowed (SYC-105) | none |
| **Wed 28 Oct** | Johnny's corrections; SYC-44 7.2 and 8.1 unless cut | 7.2's `photo_removal` |
| **Thu 29 Oct** | Fixes only | none |

A PR that misses its slot goes in the next one; if that pushes past Wednesday 28, it's cut in the agreed order. Each publish: database changes first through `db-ops` on Neon (with a Neon snapshot first; Samuel switches the session to "ask" mode for that step), then Samuel's pull, then Claude publishes and checks `/api/healthz` shows the new version before anything else.

**Database changes are never numbered by hand**: each takes the next free number after rebasing on the latest `main` (`lib/db/migrations/README.md`). The highest on `main` was `0022` on 15 Oct morning and is `0026` by that evening (`0023` issue reports, `0024` refusing deletion of sites and colonies, `0025` mail deliveries, `0026` dropping the old resend key, #188). Two are never generated at the same time in different worktrees.

---

## The schedule, wave by wave

Each build PR follows the usual pipeline: its own worktree off fresh `origin/main`, one PR, an independent adversarial review in its **own** worktree, CI green, merged with `/ship`, Linear synced, worktree removed. Auto-merge isn't available on this repository's GitHub plan, so every merge waits for Samuel.

**A rule for every PR from 22 October:** no new visitor-facing words unless they were in Johnny's pack. Anything new goes in a short, flagged second pack.

### Wave 0: Thursday 15 – Friday 16 October · decisions and the long waits

**Samuel**
- D1–D5. Check the Apple and Google accounts; register what's missing.
- One message to Syros Cats: the store name; reports will arrive at admin@syroscats.com (SYC-173); what the location blurring does and doesn't protect (SYC-67); the launch date; would they check the starter facts next week.
- Ask Johnny to hold Thursday 22 – Tuesday 27 October (SYC-283, SYC-346).
- Start the liability check (SYC-171).

**Claude**
- The match-wait spec (SYC-343): **done** as PR #174 (feeding nudge and starter facts, reviewed, with Greek and French drafts). Samuel is being taken through its 10 decisions by that session.
- Before the match-wait build starts: measure how long sending a sighting takes on the live server (the middle and slow-end times, p50 and p90), since the card is shown while it sends.
- The email-capture plan (SYC-344). It starts from what SYC-42 Slice 3 builds: **Slice 3 owns the "is this you?" email, consent records and the do-not-email list**; email capture adds only the asking screens and the nightly job. Cutting email capture then removes nothing a reporter needs.
- Check `news.catspotters.com` with Resend and fix its DNS records through the Cloudflare API if needed.
- Store set-up (SYC-323): `eas.json`, build profiles, the Android map key request.
- Message the live sessions on this repo with the publish calendar, so their PRs land in the right slot.

### Wave 1: Saturday 17 – Wednesday 21 October · most of the building

| Stream | PRs | Needs first |
|---|---|---|
| Feeding-site map | SYC-209 3.3, then 3.4 | 3.2 merged; 0.2 (merged) |
| Report an issue, server | SYC-44 4.2, 5.2, then 5.1 | 4.1 live (Fri 16 publish) |
| Reporter's email | SYC-42 Slice 3 (other session) | `news.` verified |
| Email capture | Slice 1 only before launch: the nightly news check, watch-only, sending nothing, built Mon 19 – Fri 23. Its job runs from the mail Worker, which moves to the launch address with the switch-over (SYC-345). Slices 2–5 (the asks, Settings, the news email) follow after launch | Plan approved (PR #186) |
| Match-wait screen | Plan approved 15 Oct (PR #187). **PR 1, Fri 23:** the server pieces (a settings table, the resident-signals route, the donation-tap count, the `/api/go/feed` link, which works even before launch) plus the facts during the wait. **PR 2, Mon 26:** the feeding nudge everywhere (during the wait, on the result screen, the visitors' daily one-liner, the button). The nudge waits for PR 2 so it never shows without its count. The €1/€30 figures and the button are on at launch (Samuel, D6); Syros Cats confirm them. Until a dashboard page lands (SYC-383, first week of November), Claude changes settings with a `db-ops set-setting` command, with Samuel's OK | Before PR 1: the send-time measurement, run on a temporary Neon branch (ask mode) |
| Rename | SYC-34: app name and per-language names | D2 |
| "Likely sterilised" | SYC-75: confirm the three conditions on the live site, then the one-line switch | Nothing |
| Store builds | First iPhone and Android builds | Accounts |
| Words for Johnny | All "Report an issue" words from its spec (§2, §4); the cat-in-trouble drafts checked against `docs/specs/source/safety-copy-translations.md`; "vous"/"tu" and formal/informal Greek settled | Nothing |
| Privacy policy and support page | Final text (SYC-66, with SYC-124, SYC-248, SYC-265, SYC-110, and one line on the donation-link tap count from the match-wait spec); the support page | SYC-82 approved |

### Wave 2: Thursday 22 – Tuesday 27 October · the visible parts, while Johnny reviews

- **Thursday 22: copy freeze.** Claude assembles Johnny's pack (SYC-346): every new Greek and French sentence, grouped by screen, English beside it. It includes the cat-news email lines (Samuel chose the reader's language from day one, email-capture Decision 7). The reporter's emails go out in English for everyone at launch until Johnny has checked their Greek and French (Samuel, 15 Oct), so they are in the pack but don't block launch.
- **Friday 23:** Samuel sends the pack. Store apps submitted if ready.
- SYC-44 6.1 and 6.2 (the app's side of "Report an issue"), then 7.1 (the team's Issues section). 7.2 and 8.1 if not cut.
- Email capture: nothing more before launch. Slices 2–5 start after 31 October; the asks switch on once the two-week rule is met (about 14 November at the earliest).
- SYC-105: check a limit holds across a republish, then allow more than one server.
- **Monday 26:** the Turnstile secret key in Replit, checked through `/api/healthz`.
- Clocks change in Athens on Sunday 25 October. "Report an issue" counts its daily limit by Athens midnight; its tests cover the change, and Claude checks it live on Monday 26.
- **Tuesday 27:** the launch address live end to end: the page opens, a report passes Turnstile there, and staff sign in through it (SYC-191).

### Wave 3: Wednesday 28 – Friday 30 October · freeze, publish, check

- **Wednesday 28: feature freeze.** Johnny's corrections applied in one PR. Anything unmerged is cut, in the agreed order.
- **Thursday 29:** final publish.
- **Friday 30:** the launch-day checklist below, run on the live site with the pass still on. Samuel and Syros Cats agree the announcement.

### Saturday 31 October: launch

Claude works the launch-day checklist (SYC-345), switches the pre-launch pass off, and watches the first hours. Tester data stays as the island's first records (Samuel, 4 Oct, SYC-201). SYC-114 (deleting the gate's code) follows in November.

---

## The launch-day checklist (SYC-345)

Each line has a check that can fail. Run on Friday 30 with the pass on, then the switch-dependent ones again after it's off.

| Condition | Check |
|---|---|
| Turnstile on both forms (SYC-170 1.1, 1.2) | `/api/healthz` shows the secret configured. After switch-off: a report with no token is refused, a real one from the website is accepted |
| Shared limits live (SYC-105) | A limit still holds after a republish; the number of servers is what `docs/DEPLOYMENT.md` says |
| SYC-130's change to the public home description live (DECISIONS Part 2q) | The public cat payload carries no home description where the plan says it shouldn't |
| Location blurring live (SYC-41; SYC-114 step 0) | A public cat's position is on the 250 m grid |
| Donation link (`/api/go/feed`, match-wait plan D3) | One live tap after switch-off goes to the donation page and is counted |
| Launch address (SYC-306, SYC-191, SYC-229) | Opens without the password after switch-off; staff sign-in works through it; same proxy hops as `apptest` |
| Privacy policy and support page | Both pages answer at their addresses |
| Report inbox (SYC-173) | A marked test report reaches admin@syroscats.com, not spam |
| Reporter's email | A test report with Samuel's address gets one "is this you?" email, then the acknowledgement |
| Feeding-site map on phones (SYC-287) | The team's tap-to-place map works in an iPhone and an Android phone browser |
| The live version | `/api/healthz` shows the launch commit |

**Rollback:** turning the pass back on is one setting, and it's the **only** way back from refusing: while the pass is off, Turnstile refuses whatever its own setting says (`turnstile.ts:219`). The exact step is written into SYC-345 before switching.

---

## The store release (after 31 October, if D1 = A)

The store apps go live when all of this is true. Dates are the earliest each can be done.

| Item | Owner | By |
|---|---|---|
| Apple and Google accounts | Samuel | Fri 16 Oct |
| `eas.json`, build profiles, first builds (SYC-323) | Claude | Mon 19 Oct |
| Android map key (the map is blank without it) | Samuel creates it in Google Cloud; Claude puts it in the build | Mon 19 Oct |
| Permission wording in three languages (Apple rejects vague ones) | Claude drafts, in Johnny's pack | Thu 22 Oct |
| Privacy policy and support page live | Claude | Thu 22 Oct |
| Answers for Apple's privacy labels, Google's data-safety form and both age-rating questionnaires | Claude drafts, Samuel enters them | Fri 23 Oct |
| Store text and screenshots in three languages, icon | Claude | Fri 23 Oct |
| Turnstile in the phone apps (SYC-170 1.3) | Claude | before submission |
| Blurred map checked inside the apps on real phones (SYC-228) | Claude on a simulator, Samuel or a tester on a real phone | before release |
| Data agreement with Resend accepted, and the "delete my data" test on the live site (`privacy-policy.md`) | Samuel accepts; Claude tests | Fri 23 Oct |
| Google's 14-day closed test, if it applies | Testers | from Mon 19 Oct |

---

## Owners

| Who | What only they can do |
|---|---|
| **Samuel** | D1–D5. Store accounts and console steps. Approve the match-wait spec, the email-capture plan and the privacy policy spec. Liability check (SYC-171). Every merge. The Replit pull before each publish. Pasting the Turnstile key. Sending Johnny's pack. The announcement |
| **Syros Cats** | The store name. Confirm the report inbox works (SYC-173). Accept the location-blurring trade-off (SYC-67). Confirm the privacy policy's wording, since they're the data controller (SYC-66). Check the starter facts. Pins at the vet clinics (SYC-68; not launch-blocking, since pins can change without a release). Where the QR codes go (SYC-51) |
| **Johnny** | Native check of all new Greek and French, 22–27 October (SYC-346, covering SYC-4, SYC-154, SYC-172, SYC-305, SYC-126) |
| **Claude** | Specs, plans, building, reviews, translation drafts, store set-up and listing text, the privacy and support pages, address and Turnstile set-up, database changes and publishes, live checks, Linear |

---

## The cut line

**Must launch (if one of these slips, the date moves):**

- Turnstile refusing bots on both report forms on the website (SYC-170 1.1, 1.2, and the key in Replit).
- "Report an issue" for visitors and the team: SYC-44 4.1, 4.2, 5.1, 5.2, 6.1, 6.2 (website, D5), 7.1.
- Hidden photos kept out of caches (SYC-279).
- The reporter's email (SYC-42 Slice 3).
- The rename (SYC-34).
- "Likely sterilised" shown publicly (SYC-75), after its live check.
- Feeding nudge and starter facts (SYC-36, SYC-48).
- Greek and French for every visitor-facing screen, native-checked.
- Privacy policy and support page live.
- Liability check done (SYC-171); Syros Cats told about the report inbox (SYC-173).
- Everything on the launch-day checklist.

**Cut, in this order, if the date is at risk:**

1. Email capture (SYC-45). Agreed 12 Oct. Already reduced to its watch-only nightly check before launch (Samuel, 15 Oct), so cutting it means dropping that check and starting the two-week clock later. Reporters can still leave an email (that's SYC-42 Slice 3).
2. The rest of the feeding-site map: SYC-209 3.3 and 3.4. Agreed 12 Oct. **The team's map would start empty**: they could see the read-only pages from 3.2 but couldn't add a site until 3.3 and 3.4 ship.
3. Starter facts: the 10 "core" ones only, the rest in the first update (proposed, D4).
4. SYC-44 7.2 and 8.1 to the first week of November (proposed, D4).

**Not in the spec, proposed outside the launch (awaiting Samuel):** SYC-161, reading each cat's coat colour from its photo. Its own plan (branch `claude/syc-161-plan`, Decision B) proposes it isn't a launch item, and is cut before any of the cuts above. If it lands, PRs 1 and 2 go in the Fri 23 publish and PR 3 (colour chips in "Find the cat") on Mon 26, with no database change. Its colours only go public once SYC-2 PR 3.1 (the team's "Mark wrong" for colour) is live, and nobody is building 3.1 yet. Its six new "Find the cat" strings go in Johnny's pack either way.

**After launch by approved plans:** SYC-209 Slice 4 (guardians, needs roles), 5.1 (forgetting a guardian's name, with SYC-208) and Slice 6 (public feeding sites); SYC-53 roles and invites; SYC-114 gate code removal; the store apps going live.

---

## Risks

| Risk | Effect | What reduces it |
|---|---|---|
| Google's 14-day closed test applies | Android app in December | Start it on 19 October; the web app covers Android visitors meanwhile |
| Apple enrolment not done, or needs a company number | iPhone app weeks late | Check on 16 October; enrol Samuel personally if the organisation route is slow (D1b) |
| Johnny unavailable 22–27 Oct | Greek and French go live unchecked | Ask this week. Fallback, Samuel's call: English on the screens Johnny hasn't checked, rather than unchecked text |
| Merges and publishes queue behind Samuel | Built work sits unmerged | Two merge windows a day; the publish calendar; Claude prepares each `/ship` so Samuel's step is one approval |
| A publish slips a day | Everything behind it shifts | Each slot has one day of slack before Wednesday 28; after that, cut in order |
| Turnstile key missing at switch-off | Every report refused | Pasted and checked on Monday 26, not launch week |
| Launch address breaks staff sign-in | Team locked out on launch day | Tested end to end on Tuesday 27; `apptest` kept working |

---

## Model delegation

This session runs on Opus. The plan and its synthesis stay here: weighing store timelines, the spec and the cut order against each other is judgment, not mechanical work. Everything else goes to the cheapest tier that can do it, and each package names a check that can fail.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Adversarial review of this plan | Sonnet | Checking claims against the repo | Every finding checked against its source before it was folded in; two were rejected with evidence (review file) |
| Match-wait spec (SYC-343), done as PR #174 | Opus | Public wording about feeding street cats, where a wrong call teaches tourists the wrong thing | Sonnet adversarial review checks it against spec §2.2, SYC-36, SYC-48 and the canonical facts in `CLAUDE.md` (€50–60, "cat guardian", "spotter"); Samuel approves |
| Email-capture plan (SYC-344) | Opus | Consent and the "is this you?" rule, where a mistake emails someone who never agreed | Sonnet adversarial review checks that every rule in `email-capture.md` §4–§5.6 maps to a named test in the plan; Samuel approves |
| Clear-plan build PRs: SYC-209 3.3, 3.4; SYC-44 4.2, 6.1, 6.2, 7.1, 8.1; SYC-34; the two match-wait PRs | Sonnet | Each has a written plan with named tests | CI (types, tests, the database-change check); the plan's named tests; an adversarial review in its own worktree; a browser check at 390 px and desktop with data for anything visible |
| SYC-75 switch-on | Sonnet | One line, but it changes what the public sees | The existing test for the hidden case is changed to prove the shown case; after publish, a live check: a cat with a clipped-tip sighting and no team entry shows "Probably sterilised", and a "can't tell" cat shows "Not known yet" |
| SYC-44 5.1 (the report and the hide) | Opus | A wrong-but-green result hides photos it shouldn't, or misses ones it should | Mutation probes from its plan: fail the outbox write and no hide remains (T5-1); count a rolling 24 hours instead of the Athens day and T5-5 goes red; remove the lock and T5-10 goes red. Opus adversarial review |
| SYC-44 5.2 (the alert email and its cap) | Opus | A broken cap floods Syros Cats' inbox, silently | Mutation probe: remove the cap and its test goes red. Opus review |
| SYC-44 7.2 (deleting a photo for good) | Opus | A missed copy of the photo means it isn't really gone | Mutation probe: skip one place the photo is kept and the full-table search test goes red. Every place the photo lives is listed in the PR (main photo, sighting, matching reference, embedding) |
| SYC-170 1.3 (Turnstile in the phone apps) | Opus | Security path on real phones | Mutation probe: remove the allowed-pages list and T1-15 ("navigation outside the list is refused") goes red; a real build on a simulator passes a report |
| Starter facts and feeding-nudge words, English | Sonnet | Writing to a spec | Samuel and Syros Cats check every fact; nothing is generated while the app runs |
| Greek and French drafts | Sonnet | Translation to a glossary | Johnny's review; the key-parity test catches missing keys; if Johnny is unavailable, Samuel decides English-only for unchecked screens |
| Store set-up and listing text | Sonnet | Configuration and copy | A real build installs and opens; listing text checked against the agreed names |
| Key-parity sweeps, Linear status updates | Haiku | Mechanical | The parity test; the session model re-reads every Linear change it makes (all of them, since they are few) |
| Launch-day switch-off and checks | Opus (this session) | Irreversible and public | The launch-day checklist, each line with its own check, written before the switch |

Workflow scripts set `model` on every `agent()` call. Chips started with `spawn_task` run on the parent's model whatever their brief says, so their cards say so.

---

## Linear

Filed or updated with this plan (team SYC, project P-SYC-54):

- **SYC-343** (new): spec for the match-wait screen, blocking SYC-36 and SYC-48.
- **SYC-344** (new): the email-capture plan, blocking SYC-45.
- **SYC-345** (new): launch day, switching off the pre-launch pass, with the checklist.
- **SYC-346** (new): Johnny's review pack at the copy freeze.
- **SYC-347** (new, Samuel): decisions D1, D2, D4 and D5. D3 is SYC-306.
- SYC-323, SYC-306, SYC-305 and SYC-228 moved into the project.

## What the adversarial review changed

The review (`mvp-launch-31-oct-review.md`) raised 16 findings. Fourteen were accepted, two only in part:

- **Rejected in part:** it said PR 0.2 of SYC-209 hadn't merged (it did, #125); and that testers' phone builds would break at launch (none exists; testers use the website). Its point about how to roll back was right and is in the checklist.
- **Added:** decision D5 (the app's report screen before the phone apps' Turnstile check); a publish calendar and merge budget; the reporter's email owning the "is this you?" check, so cutting email capture removes nothing; `news.catspotters.com` checked in Wave 0; "Likely sterilised" as a launch item with a live check; a store-release checklist (support page, privacy labels, data-safety form, age rating, permission wording, screenshots, map key, Resend data agreement, deletion test); the Turnstile key on Monday 26 and the launch address on Tuesday 27; the spec §2.6 exception stated up front; the empty-map consequence of cut 2; a named check for every delegated package, with Turnstile in the phone apps moved to Opus; a glossary; one launch-day checklist.
