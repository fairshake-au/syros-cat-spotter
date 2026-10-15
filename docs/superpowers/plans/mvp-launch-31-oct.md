# Cat Spotters MVP: the plan to launch on Saturday 31 October 2026

**Status:** draft for Samuel's approval · written 15 October 2026 · Linear project P-SYC-54 ("Cat Spotters: MVP to MLP")
**Scope:** the full MVP in `docs/PRODUCT-SPEC.md` §2, as Samuel decided on 12 October (recorded on SYC-73). Records import (SYC-49), photos out of Postgres (SYC-46) and the hosting re-decision (SYC-47) are outside the MVP by the spec.
**Evidence base:** `origin/main` at `2acae50`, `gh pr list` on 15 October, and live Linear on 15 October. Where a claim comes from somewhere else it says so; where nobody has checked, it says **unchecked**.
**Adversarial review:** `mvp-launch-31-oct-review.md`, beside this file. What changed because of it is listed at the end.

---

## The short version

There are 16 days. The building is not the hard part: 20 pull requests merged in the last three days. Three things decide whether 31 October happens:

1. **The phone apps cannot be in the stores by 31 October.** No store build has ever been made (there is no `eas.json` in the repo). If the Google Play account is a personal one, Google makes a new app run a closed test with 12 or more testers for 14 days in a row before it can even ask to go public, and Apple's review takes 1–2 weeks on top of enrolment. So the plan launches **the website version of the app** (the one testers use today) on 31 October, with the QR codes pointing at it, and submits both store apps as early as possible so they follow in November. **This is Samuel's call, and the first decision below.**
2. **All the new Greek and French has to reach Johnny by Friday 23 October.** That means every new piece of text (starter facts, feeding nudge, "Report an issue", the rest of the cat-in-trouble flow, the reporter's email) is written in English and drafted in Greek and French by Thursday 22 October. Two of those (starter facts and the feeding nudge) don't have a spec yet.
3. **Samuel's own launch tasks**: approving the privacy policy, the liability check on the injured-cat advice, and three conversations with Syros Cats. Each one is small, but each one blocks launch on its own, and only Samuel can do them.

If the date slips, Samuel's agreed order is: **email capture goes first, then the rest of the feeding-site map.** This plan adds a third and fourth candidate for him to agree or reject (see "The cut line").

---

## What "launched" means on 31 October

On Saturday 31 October:

- Anyone on Syros can open the app on the web at its launch address, without the tester password, in English, Greek or French.
- They can spot a cat, see the approximate map, report a cat in trouble, and report a problem with any cat or photo. The two report forms are protected by Cloudflare's bot check (Turnstile), switched to **refuse** bots, not just log them.
- Syros Cats' staff use their dashboard for the welfare queue, the new issue reports, record corrections, colonies and the private feeding-site map.
- A privacy policy is live on catspotters.com.
- QR materials in cafés, hotels and at the Kini feeders point at the web app.
- The iPhone and Android apps are submitted to Apple and Google, and go live when the stores approve them.

What this does **not** mean: guardians and volunteers signing in (roles and invites, SYC-53, is MLP), public feeding sites on the visitors' map (SYC-209 Slice 6, after launch by the approved plan), or the records import.

---

## Where things stand on 15 October

Checked against `origin/main` (`2acae50`), `gh pr list` and Linear on 15 October.

| Spec item | Where it is | Evidence |
|---|---|---|
| §2.1 Rename to "Cat Spotters (Syros)" | **Not done.** `app.json` still says "Syros Cat Spotters"; the phone app's id is `com.syroscatspotters.app` | `artifacts/cat-spotter/app.json:3,18,21`; SYC-34 Backlog |
| §2.1 €50–60 copy, French title, "clipped tip" | Done | SYC-14, SYC-15 Done |
| §2.2 Keep-your-distance screen | Done | SYC-35 Done |
| §2.2 Feeding nudge | **No spec, nothing built** | SYC-36 Backlog |
| §2.2 ~20 starter facts per language | **No spec, no content, nothing built** | SYC-48 Backlog |
| §2.3 500 m matching, 25/15 points, ear-tip question, note + food/water | Done | SYC-39, SYC-38, SYC-37, SYC-74 Done |
| §2.4 Life status | Done | SYC-40 Done |
| §2.4 Sterilised Confirmed/Likely | Built, but "Likely" is hidden from the public by a switch that is still off | `artifacts/api-server/src/lib/likelyGate.ts:33`; SYC-75 In Progress |
| §2.4 Approximate public locations | Done | SYC-41 Done |
| §2.5 Cat-in-trouble report, queue, capacity messaging | Done and live with testers | SYC-42 comments (9 Oct, build `cfe2d53`) |
| §2.5 Reporter's acknowledgement and status email | **Being built** in another session (SYC-42 Slice 3) | session "Build SYC-42 Slice 3" running 15 Oct |
| §2.5 Greek and French for the rest of the report flow | Drafted (all 522 keys exist in Greek and French), **not native-checked** | `artifacts/cat-spotter/lib/i18n.ts` key count; SYC-172 Backlog |
| §2.6 Staff sign-in and dashboard, welfare queue, corrections | Done | SYC-43 comments; SYC-103 Done |
| §2.6 Colonies and colony naming | Done (SYC-209 PRs 2.1, 2.2 merged) | `git log origin/main` |
| §2.6 Private feeding-site map | Map tiles done (PR 3.1, #161). Pages in review (PR 3.2, #169). Adding/moving sites (3.3, 3.4) not started | `gh pr list`; SYC-209 plan |
| §2.6 Per-site public toggle | **After launch** by the approved SYC-209 plan (Slice 6) | SYC-209 plan, "Slice 6" |
| §2.6 "Report an issue" | Docs only (PR 0.1). Database change (PR 4.1, migration `0023`) being built. ~10 PRs to go | SYC-44 plan; session list |
| §2.7 Email capture | Spec approved 28 Sep. **No plan; the screens and the nightly job are not built.** The address, consent and suppression tables already exist (migration `0012`, from SYC-3) | `docs/specs/email-capture.md`; SYC-45 Backlog |
| §2.8 Migrations, photo hardening | Done | SYC-64, SYC-98, SYC-121 Done |
| Turnstile on the report forms | Server check in "observe" mode (#151, #163). It switches itself to **refuse** when the pre-launch gate is turned off (`TURNSTILE_MODE`, `artifacts/api-server/src/lib/turnstile.ts`). Its secret key is **not yet in Replit** (commit message of #163). Website part (PR 1.2) being built. Phone-app part (PR 1.3) not started | SYC-170; `gh pr list` |
| Shared rate limits | Counted in Postgres (#150). Left: check across a redeploy, then lift the one-server limit | SYC-105 comment, 15 Oct |
| Hidden photos kept out of caches | In review (#168) | SYC-279 |
| Deleting a hidden photo for good | Decided in the SYC-44 plan (Decision 3: button on a privacy-hidden photo); built as SYC-44 PR 7.2 | SYC-44 plan; SYC-246 |
| How Replit applies database changes | Superseded: migrations now go through `db-ops` on Neon | SYC-102 comment 7 Oct; SYC-121 Done |

**Not in the spec but needed to launch** (found while writing this plan):

- **Store builds** (SYC-323): no `eas.json`, no TestFlight or Play build has ever been made, and the stores also need Apple's privacy "nutrition labels" and Google's data-safety form (`docs/DEPLOYMENT.md:25-26`). Nobody has recorded whether the Google Play and Apple developer accounts exist. I searched Gmail for the last 90 days: there is Apple developer newsletter mail but no Apple enrolment confirmation and no Google Play Console mail. That is not proof they don't exist (another address may hold them), so this is **unchecked**.
- **The launch web address** (SYC-306) isn't decided, and Turnstile only allows `apptest.catspotters.com` today.
- **Native check of the "Report an issue" words** (SYC-305) is marked a launch blocker.
- **Turning the pre-launch pass off** is the launch itself. SYC-114 deletes the gate's code *after* launch; nothing is ticketed for the switch-off and the checks around it. Filed as a new ticket (see "Linear").

---

## Decisions Samuel needs to make this week

Each has a recommendation. The first two are the ones that move the date.

### D1. What launches on 31 October: the web app, or the store apps too?

| Option | What visitors get on 31 Oct | Benefits | Risks |
|---|---|---|---|
| **A. Web app on 31 Oct; store apps follow when approved (recommended)** | Scan a QR code, the app opens in the browser. Works on any phone. Later: "Get it on the App Store / Google Play" | The date holds. Testers already use the web app every day. QR codes need no install, which suits a tourist with five days on the island | The web app's offline support is weaker than the phone apps' (no offline app shell, SYC-169; no offline map tiles, SYC-167). Push notifications don't reach web users |
| B. Wait for both stores | Everything at once | One announcement | Almost certainly misses October. Play's 14-day test (if a personal account) can't finish before 29 Oct even if it started today, and the builds don't exist yet |
| C. Web on 31 Oct, iPhone only by 31 Oct | Web plus iPhone | iPhone users get the full app | Depends on Apple enrolment being done already (unchecked) and an Apple review inside ~7 days. Splits attention in the riskiest week |

**Recommendation: A.** It keeps the date, and the QR codes work the same either way. The store apps are submitted by Friday 23 October and announced when they're live.

### D2. The phone app's permanent id and the store name

The app's id is `com.syroscatspotters.app`. Once a build is in a store, that id can never change. It's invisible to visitors, so keeping it is fine, but it has to be settled before the first store build (Monday 19 October). The store **name** ("Cat Spotters (Syros)" and per-language names, spec §2.1, §5) needs Syros Cats' final view.

**Recommendation:** keep the id as it is (nobody sees it, and changing it later is impossible anyway). Ask Syros Cats for the store name this week; if there's no answer by Monday 19 October, use "Cat Spotters (Syros)" in all three languages and change the display name later (store names can change; ids can't).

### D3. The launch web address (SYC-306)

Turnstile, the hostname list and the QR codes all need it. Options: keep `apptest.catspotters.com` (wrong name for a public launch), or a new address such as `app.catspotters.com`.

**Recommendation:** `app.catspotters.com`, decided by Friday 16 October so the DNS, the Turnstile widget and the QR artwork can be done in parallel. Claude does the DNS and Turnstile changes through the Cloudflare API (token at `~/.cloudflare/api-token`), then probes them.

### D4. Two more things that can be cut if the date is at risk

Samuel agreed two cuts: email capture first, then the rest of the feeding-site map. This plan proposes two more, in this order, for Samuel to accept or reject now rather than in the last week:

3. **Starter facts at 10 per language instead of ~20.** Fewer facts to write, check and translate; the match-wait screen still has something to show.
4. **"Report an issue" PRs 7.2 (deleting a photo for good) and 8.1 (the one-year clean-up) move to the first week of November.** Until 7.2 ships, the team can still hide a photo straight away; real deletion is done by Claude on request. 8.1 can't do anything for a year anyway.

**Recommendation:** accept both as cut candidates. Neither changes what a visitor sees on 31 October.

---

## The critical path

Working backwards from Saturday 31 October.

| Must be done by | What | Owner | Why that date |
|---|---|---|---|
| **Fri 16 Oct** | D1, D3 decided; Google Play account type known and registered if missing; Apple enrolment checked | Samuel | Play's 14-day test and Apple enrolment are the longest waits in the plan |
| **Fri 16 Oct** | Specs for the feeding nudge and starter facts written and reviewed | Claude | Their words must reach Johnny by 23 Oct |
| **Mon 19 Oct** | Specs approved (SYC-36, SYC-48), email-capture plan approved (SYC-45) | Samuel | Building starts 19–20 Oct |
| **Mon 19 Oct** | First store builds (TestFlight and Play closed test) | Claude, with Samuel's account access | Starts Play's 14-day clock if it applies |
| **Tue 20 Oct** | Privacy policy spec approved (SYC-82) | Samuel | Stores need a live policy URL before submission |
| **Thu 22 Oct** | **Copy freeze.** Every new English string written, Greek and French drafted | Claude | Johnny needs it on the 23rd |
| **Thu 22 Oct** | Privacy policy live on catspotters.com (SYC-66, plus SYC-124, SYC-248, SYC-265, SYC-110) | Claude publishes, Samuel confirms controller wording with Syros Cats | Store submission |
| **Fri 23 Oct** | Johnny's review pack sent | Samuel sends, Claude prepares | Johnny needs ~3 days |
| **Fri 23 Oct** | Store apps submitted | Claude, Samuel for account steps | 1–2 weeks of review |
| **Fri 23 Oct** | Liability check on the injured-cat advice (SYC-171) | Samuel | The advice goes public on the 31st |
| **Tue 27 Oct** | Johnny's corrections back | Johnny | Two days to apply them |
| **Wed 28 Oct** | **Feature freeze.** Everything that launches is merged | Claude | Two days to publish, probe and fix |
| **Thu 29 Oct** | Turnstile secret key in Replit; launch address live; final publish | Claude (publish needs Samuel's Git-pane pull) | One clear day before launch |
| **Fri 30 Oct** | Launch-readiness check on the live build; Syros Cats told the date | Claude, Samuel | |
| **Sat 31 Oct** | Pre-launch pass off; QR codes go out | Claude switches, Samuel and Syros Cats announce | Launch |

---

## The schedule, wave by wave

Each build PR follows the usual pipeline: its own worktree off fresh `origin/main`, one PR, an independent adversarial review in its **own** worktree, CI green, merged with `/ship`, Linear synced, worktree removed. Merges wait for Samuel (this repo is on GitHub's Free plan, so auto-merge isn't available). Getting merged code live needs Samuel's pull in Replit's Git pane, then Claude publishes and checks `/api/healthz` shows the new commit.

### Wave 0: Thursday 15 – Friday 16 October · decisions and the long waits

**Samuel**
- Decide D1–D4.
- Google Play Console: check whether an account exists and whether it is personal or an organisation; register if not (one-off fee). Check Apple Developer enrolment.
- Ask Syros Cats (one message): the final store name; tell them reports arrive at admin@syroscats.com (SYC-173); the location-blurring conversation (SYC-67); the launch date.
- Ask Johnny (SYC-283) to hold Friday 23 – Tuesday 27 October for the Greek and French review.
- Start the liability check (SYC-171).

**Claude**
- Write the spec for the feeding nudge and the starter facts. Recommendation: **one spec**, "What you see while we look for your cat", because both appear on the match-wait screen and share its space. Adversarial review, then render it for Samuel.
- Write the email-capture implementation plan (SYC-45) from the approved spec, with an adversarial review.
- Finish the PRs already in flight (owned by the other sessions; listed under "What runs in parallel").
- Start the store-build set-up (SYC-323): `eas.json`, the Android map key, build profiles. Nothing is submitted without Samuel's account step.

### Wave 1: Saturday 17 – Wednesday 21 October · the bulk of the building

Runs in parallel, each in its own worktree:

| Stream | PRs | Needs first |
|---|---|---|
| Feeding-site map | SYC-209 3.3 (add, move, retire, change colony), then 3.4 ("Make a feeding site here") | 3.2 merged |
| Report an issue, server | SYC-44 4.2 (after 4.1 is live), 5.2 (the alert email), then 5.1 (the report and the hide) | 4.1 published; SYC-105 PR 2.1 (done); Turnstile 1.1 (done) |
| Turnstile, phone apps | SYC-170 PR 1.3. With D1 = A this blocks the **store release**, not 31 October (nobody uses a store build on launch day) | The spike's findings (`docs/research/syc-170-turnstile-spike.md`); the first store build |
| Email capture | SYC-45 slices from the plan | Plan approved Mon 19 Oct |
| Match-wait content | Feeding nudge and starter facts (English first, then Greek and French drafts) | Spec approved Mon 19 Oct |
| Rename | SYC-34: app name and per-language names in the app | D2 |
| Store builds | First TestFlight and Play closed-test builds | Accounts from Wave 0 |
| Report-flow translations | SYC-172: the Greek and French drafts exist; check them against `docs/specs/source/safety-copy-translations.md` and settle "vous"/"tu" before they go in Johnny's pack | Nothing |
| Privacy policy | Write the final text and publish it (SYC-66, SYC-124, SYC-248, SYC-265, SYC-110) | SYC-82 approved |

### Wave 2: Thursday 22 – Tuesday 27 October · the visible parts, while Johnny reviews

- **Thursday 22: copy freeze.** Claude assembles Johnny's pack: every new Greek and French string, grouped by screen, with the English beside it and a note on the "vous"/"tu" and formal/informal choices (SYC-154, SYC-172).
- **Friday 23:** Samuel sends the pack. Store apps submitted.
- SYC-44 6.1 and 6.2 (the app's side of "Report an issue"), then 7.1 (the team's Issues section). 7.2 and 8.1 if not cut.
- SYC-75: flip the switch that shows "Likely sterilised" publicly, once the three conditions in `likelyGate.ts` are confirmed live.
- Email capture's remaining slices (first to cut).
- SYC-105 step 4: check a limit holds across a redeploy, then lift the one-server limit.
- Clocks change in Athens on Sunday 25 October. The "Report an issue" daily brake counts by Athens midnight; its test (T5-5) already covers this, and a live check is added on Monday 26.

### Wave 3: Wednesday 28 – Friday 30 October · freeze, publish, check

- **Wednesday 28: feature freeze.** Johnny's corrections applied (one PR). Anything unmerged is cut, in the agreed order.
- **Thursday 29:** Turnstile's secret key in Replit (Samuel pastes it; Claude never handles the value) and a check that the forms accept a real token in observe mode. It switches itself to "refuse" when the pre-launch gate goes off on the 31st; the launch address live, in the Turnstile widget and the hostname list, and behind the same proxy hops (SYC-229); the sign-in Worker's address checked (SYC-191). Final publish.
- **Friday 30:** launch-readiness check on the live build: spot a cat, report a cat in trouble, report an issue, the dashboard at phone and desktop widths, each in three languages; a test report reaches admin@syroscats.com, not spam (SYC-173); the blurred map on a real iPhone and Android phone (SYC-228, SYC-287). Samuel and Syros Cats agree the announcement.

### Saturday 31 October: launch

Claude switches the pre-launch pass off, probes that a visitor with no password can open the app and that the report forms refuse a missing Turnstile token, and watches the logs for the first hours. Tester data stays as the island's first records (Samuel, 4 Oct, SYC-201). SYC-114 (deleting the gate's code) follows in November.

---

## What runs in parallel, and the database changes

### Work already in flight on 15 October (other sessions)

| PR | What | Owner session |
|---|---|---|
| #169 | SYC-209 PR 3.2, the Feeding sites pages | "Build SYC-209 PR 3.1" session |
| #168 | SYC-279 PR 3.1, photos never kept by shared caches | same |
| not yet open | SYC-44 PR 4.1, migration `0023_issue_reports` | same |
| not yet open | SYC-170 PR 1.2, Turnstile on the website | same |
| not yet open | SYC-42 Slice 3, the reporter's email | "Build SYC-42 Slice 3" session |
| #146 | SYC-170 spike (not for merge, except its note) | — |

This plan is a docs-only PR and touches no code, so it doesn't need a merge order with them.

### Database changes, in order

Migration numbers are **never** chosen by hand: each takes the next free number when it is generated after rebasing on the latest `main` (`lib/db/migrations/README.md`). The highest on `main` today is `0022_map_tile_cache`. The expected order:

| Order | Migration | PR | Notes |
|---|---|---|---|
| 1 | `0023_issue_reports` | SYC-44 PR 4.1 | Claimed by the in-flight PR |
| 2 | next free (expected `0024`) | SYC-42 Slice 3, the reporter's email | Reuses the address and consent tables from `0012`; may add `mail_deliveries` for bounces. The building session settles it |
| 3 | next free | SYC-44 PR 4.2, a one-line migration dropping the old resend key | **Only after 4.1 is published to production** |
| 4 | next free, if any | SYC-45 email capture | The core tables exist; the plan (Wave 0) says whether the nightly job needs one |
| 5 | next free | SYC-44 PR 7.2, `photo_removal` | Cut candidate 4 |
| — | none | SYC-209 3.3, 3.4; SYC-44 5.x, 6.x, 7.1, 8.1; SYC-34; SYC-36/48; SYC-75 | Code and content only |

Two migrations must never be generated at the same time in different worktrees: the second to merge renumbers after rebasing, and CI's "Test migrations" step checks the real history. Every production migration goes **migrate before publish**, through `db-ops` on Neon, with a Neon snapshot first (Samuel switches the session to "ask" mode for that step).

---

## Owners

| Who | What only they can do |
|---|---|
| **Samuel** | D1–D4. Store accounts (Apple, Google). Approve the match-wait spec, the email-capture plan and the privacy policy spec. Liability check (SYC-171). Every merge. The Git-pane pull before each publish. Sending Johnny's pack. The launch announcement |
| **Syros Cats** | Final store name. Confirm the report inbox works (SYC-173). Accept the location-blurring trade-off (SYC-67). Controller wording in the privacy policy (SYC-66). Fact-check the starter facts. Pins at the vet clinics (SYC-68, needs someone on the island; not launch-blocking, since pins can change without a release). QR placement (SYC-51) |
| **Johnny** | Native check of all new Greek and French, 23–27 October (SYC-4, SYC-283, SYC-154, SYC-172, SYC-305) |
| **Claude** | Specs, plans, building, reviews, translation drafts, store builds and listings text, privacy policy page, DNS and Turnstile changes, migrations and publishes, live checks, Linear |

---

## The cut line

**Must launch (if any of these slips, the date moves):**

- Turnstile refusing bots on both report forms on the website (SYC-170 PRs 1.1, 1.2, and the secret key in Replit). PR 1.3 (phone apps) blocks the store release.
- "Report an issue" from a visitor's side and the team's Issues section: SYC-44 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 7.1. (The plan has 6.2 wait for 1.3 as well; with D1 = A, 6.2 ships on the website first and the phone apps pick it up with 1.3.)
- Hidden photos kept out of caches (SYC-279).
- The reporter's acknowledgement email (SYC-42 Slice 3, spec §2.5).
- The rename (SYC-34).
- Feeding nudge and starter facts (SYC-36, SYC-48), at 10 per language if cut 3 is used.
- Greek and French for every visitor-facing screen, native-checked (SYC-172, SYC-305, SYC-154).
- Privacy policy live (SYC-66 and its add-ons).
- Liability check done (SYC-171), Syros Cats told about the report inbox (SYC-173).
- SYC-130's change to the public home description live (DECISIONS Part 2q says the pass can't come off without it; SYC-130 is Done, to be confirmed on the live build).
- The launch address and the pre-launch pass switched off safely.

**Cut, in this order, if the date is at risk:**

1. Email capture (SYC-45) (agreed 12 Oct).
2. The rest of the feeding-site map: SYC-209 3.3 and 3.4 (agreed 12 Oct). The team keeps the read-only map from 3.2.
3. Starter facts down to 10 per language (proposed, D4).
4. SYC-44 7.2 and 8.1 to the first week of November (proposed, D4).

**Already after launch by approved plans:** SYC-209 Slice 4 (guardians, needs roles), 5.1 (forgetting a guardian's name, with SYC-208), Slice 6 (public feeding sites); SYC-53 roles and invites; SYC-114 gate code removal; the store apps going live (if D1 = A).

---

## Risks

| Risk | Effect | What reduces it |
|---|---|---|
| Google Play needs the 14-day closed test | Android app in December, not November | Start the test on 19 October with the WhatsApp testers; web app covers Android visitors meanwhile |
| Apple enrolment not done, or needs a D-U-N-S number | iPhone app weeks late | Check on 16 October; enrol as an individual if the organisation route is slow |
| Johnny unavailable 23–27 Oct | Greek and French go live machine-drafted | Ask this week. Fallback: launch with Greek and French for the screens he has checked and English for the rest, rather than unchecked text (Samuel's call) |
| Merges and publishes queue behind Samuel | Built work sits unmerged | Batch merges twice a day; Claude prepares each `/ship` so Samuel's step is one approval |
| Two sessions generate a migration at once | Renumbering, CI failure | Migrations go one at a time, in the order above |
| Launch address change breaks staff sign-in | Team locked out on launch day | SYC-191 check on 29 Oct; keep `apptest` working in parallel through November |

---

## Model delegation

This session runs on Opus. The plan and its synthesis stay here: it weighs the store timelines, the spec and the cut order against each other, which is judgment rather than mechanical work. Everything else goes to the cheapest tier that can do it, with a named check.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| This plan's adversarial review | Sonnet | Reading and checking claims against the repo and Linear; no build | Every finding is checked against the source before it's folded in; the review is committed beside the plan |
| Match-wait spec (SYC-36, SYC-48) and the email-capture plan (SYC-45) | Opus, one each | Product judgment and privacy rules (consent, verification, F7b) where a wrong call reaches the public | Sonnet adversarial review of each; Samuel approves before any build |
| Clear-plan build PRs: SYC-209 3.3, 3.4; SYC-44 4.2, 6.1, 6.2, 7.1, 8.1; SYC-34 rename; SYC-75 flip; SYC-170 1.3 | Sonnet | Each has a written plan with named tests | CI (typecheck, tests, migration check); independent adversarial review in its own worktree; browser check at 390 px and desktop for anything visible |
| Silent-failure PRs: SYC-44 5.1 (the hide and the daily brake), 5.2, 7.2 (deleting for good); SYC-45 consent and "is this you?" check; Turnstile switched to refuse | Opus builder | A wrong-but-green result here is a privacy or abuse failure nobody sees | The plan's named **mutation probes** (break the site, a named test goes red, restore); Opus adversarial review; a live probe after publish (e.g. a report without a token is refused) |
| Starter facts and feeding-nudge content, English | Sonnet drafts | Writing to a spec | Samuel and Syros Cats check every fact; nothing generated at runtime |
| Greek and French drafts | Sonnet | Translation to a glossary | Johnny's native review is the real check; the i18n parity test catches missing keys |
| Store set-up (`eas.json`, build profiles) and listing text | Sonnet | Configuration and copy | A real TestFlight and Play build installs and opens; listing text checked against the spec's names |
| i18n key-parity sweeps, Linear status syncs, checklist ticking | Haiku | Mechanical | The parity test; spot check by the session model |
| Launch-day switch-off and probes | Opus (this session) | Irreversible and public | Probes written before the switch: a visitor with no password gets the app; a report without a token is refused; `/api/healthz` shows the launch commit |

Workflow scripts set `model` on every `agent()` call. Chips started with `spawn_task` run on the parent's model whatever their brief says, so their cards say so.

---

## Linear

Filed or updated with this plan (team SYC, project P-SYC-54):

- New: a spec ticket for the match-wait content (feeding nudge and starter facts), blocking SYC-36 and SYC-48.
- New: the email-capture implementation plan, blocking SYC-45.
- New: the launch-day switch-off of the pre-launch pass and its checks.
- New: Johnny's review pack, assembled at the copy freeze on 22 October.
- SYC-323, SYC-306, SYC-305 and SYC-228 added to the project, since they block launch and weren't in it.

## What the adversarial review changed

(Filled in after the review.)
