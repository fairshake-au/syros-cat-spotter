# Cat Spotters: the plan to launch on Saturday 31 October 2026

**Status:** version 2, for Samuel's approval · rewritten 18 October 2026 for his launch rescope · Linear project P-SYC-54
**Scope:** Samuel's decisions of 18 October (the two comments on P-SYC-54), which replace the "full spec §2" scope of 12 October (SYC-73). The launch is for everyone, tourists included, and comes in two steps: **31 October**, then a **second release on 16 November** (milestone "Phase 2b"). The website goes first; the phone apps go to the stores in spring.
**Evidence base:** `origin/main` and `gh pr list` on 18 October (fetched), the live site's version check on 18 October (build `976c0005`, built 16 Oct), Linear on 18 October, and the live session list. Where nobody has checked something, it says **unchecked**.
**Adversarial reviews:** version 1 in `mvp-launch-31-oct-review.md`; version 2 in `mvp-launch-31-oct-review-v2.md`. A summary of what each changed is at the end.

---

## Words used in this plan

- **The pre-launch pass:** the password that keeps the app to testers today. Turning it off is the launch.
- **Turnstile:** Cloudflare's invisible "are you a person?" check on the report forms. It only watches today; once the pass is off it refuses anything that fails.
- **Publish:** making merged code live. Samuel pulls the latest code into Replit (one click), then Claude publishes and checks the live site's version check shows the new build.
- **Database change (migration):** a numbered change to how the database is laid out, applied before the code that needs it goes live. Writing to the live database needs Samuel to switch Claude's session to "ask" mode first.
- **The dashboard:** the private website Syros Cats' team and cat guardians sign in to. Visitors never see it.
- **A test that's been proved to fail:** for the riskiest pieces, the builder breaks the code on purpose and shows the test goes red, so a passing test means something.

---

## The short version

**Most of the 31 October list is built. One item is not: the dashboard redesign's phases 2 to 5.**

- Of the 11 launch items, 7 need no more building, only publishing, live checks or people's time. Three need one to four more pull requests each (about 8 in all), which fits comfortably in the 8 building days.
- The dashboard redesign (SYC-396) is different. Phases 0 and 1 are merged. Phases 2 to 5 are **about 17 to 21 pull requests with no detailed plan yet**, including the screens the spec requires for cat guardians. Much of it has to go in order. **Honestly: phase 2 fits, vet visits and round logging probably fit, the five reports and the impact report probably don't, and donations can't be built** until James settles the donation route. The reports would also be close to empty on launch day, because no vet visits have been logged yet and the records import is in the November release.
- **What would make the most difference** is writing the plans for phases 2, 3 and 4 together, now, for one approval on Tuesday 20 October (D1). The approved plan says to write them one at a time.
- **If it doesn't fit,** Samuel decides on Wednesday 28 October what waits for 16 November. D2 gives the order I'd recommend then, with the numbers in front of him. It doesn't ask him to cut anything now.
- **18 merged changes aren't live yet**, including the rest of dashboard phase 1, coat colours, guardian accounts slice 2.2 and one database change (`0030`). Publishing them on Monday 19 October means any problem shows up early, not in launch week.

---

## What "launched" means on 31 October

- Anyone can open the app in a browser at **syros.catspotters.com**, without the tester password, in English, Greek or French.
- They can spot a cat, add extra face and body photos (SYC-415), see the approximate map, pick a photo from their library and have the map start where it was taken (SYC-166), report a cat in trouble, and report a problem with any cat or photo (SYC-44). Coats show as the colours you can see plus a pattern (SYC-398).
- Both report forms refuse bots, and every write has a limit shared across servers (SYC-170, SYC-105).
- Someone who reports a cat in trouble can leave an email address and hear back, in English at first (SYC-42 Slice 3).
- Syros Cats' team use the redesigned dashboard (SYC-396), and cat guardians can be invited to it as it's built today (SYC-53).
- A privacy policy is live on catspotters.com. It tells people how to ask for a photo to be removed, and the team removes it by hand (SYC-462) until the button arrives in November (SYC-246).
- Every Greek and French sentence a visitor reads has been checked by Johnny. Guardian screens added after the copy freeze may show English until he has checked them (D5).
- The vet clinics are pinned at their doors (SYC-68), and QR materials are out in cafés, hotels and at the Kini feeders (SYC-51).

The website works partly offline: spots made with no signal wait and send later, but the site itself needs a signal to open (SYC-169).

**16 November:** automatic coat colour (SYC-161); the records import, if Syros Cats want it (SYC-49); photos out of the database, with the hosting decision (SYC-46, SYC-47); email capture (SYC-45); deleting a photo for good (SYC-246). Plus anything Samuel decides on 28 October to hold back.
**Spring:** the rename to "Cat Spotters" (SYC-34), the store apps (SYC-50, SYC-323), public feeding sites (SYC-461), the nudge switches page (SYC-383), the cat-matching game (SYC-402) and the visit summary (SYC-370).

---

## Where each 31 October item stands (18 October)

"Live" means it's in the build the public site runs today (`976c0005`, 16 Oct).

| Item | State | What's left | Evidence |
|---|---|---|---|
| **Report an issue** (SYC-44) | Server side merged and live: the cache rule (its Slice 3, #168, filed as SYC-279), 4.1 #170, 4.2 #188, 5.1 #203, 5.2 #189 | 4 PRs: 6.1 (full-screen photo and the hidden-photo tile), 6.2 (the reason sheet and confirm step; nothing reaches the team until this ships), 7.1 (the team's Issues section), 8.1 (the one-year clean-up) | SYC-44 plan; `git log origin/main` |
| **Removing a photo by hand** (SYC-462, in place of SYC-246 at launch) | Not started | 1 PR: a runbook, plus a reviewed command that hides the photo and then removes it and every copy (main photo, sighting photo, extra photos, matching reference, small and medium versions, caches). Dry run on the development database | SYC-462 |
| **Privacy policy** (SYC-66, with SYC-82, SYC-124, SYC-248, SYC-265, SYC-110) | Spec awaits Samuel's approval. **No page yet:** `catspotters.com/privacy` answers 404 | Samuel approves the spec with the changes listed under "Privacy policy" below. Syros Cats confirm the wording as data controller. Then 1 PR on the website | `curl` on 18 Oct; SYC-66 |
| **Bot protection and limits** (SYC-170, SYC-105) | Website, server and phone-app checks merged (#151, #171, #196). **Secret configured and watching** on the live site | No PR. It switches itself to refusing when the pass goes off. SYC-105: check a limit holds across a republish, then allow more than one server. The real-phone check moves to spring with the stores | live version check, 18 Oct; SYC-105 |
| **Greek and French check** (SYC-4, SYC-346, SYC-172) | Strings collected on SYC-346 as each PR lands | Pack assembled Thu 22; Johnny checks 23–27; 1 PR of corrections. A second, short window for late guardian screens (D5) | SYC-346 |
| **Vet pins** (SYC-68) | Three clinic pins sit on nearby petrol stations, 50–100 m out | Someone on Syros drops a pin at each door. Pins are settings, so no release is needed | SYC-68 |
| **QR materials** (SYC-51) | Not started; no spec | Artwork (Claude) once the address and the printed name are decided (D3, D4); printing and placing (Syros Cats). Printer and lead time **unchecked** | SYC-51 |
| **Cat guardian accounts, as built** (SYC-53) | Slices 0–2 merged; Slice 1 live; 2.2 not live yet. SYC-209's guardian screens (4.1–4.3) merged | No PR needed. Steps: publish; create the first colony (#229, a draft, would let a guardian start one); Samuel's go on the People screen; Johnny's check of the guardian words (SYC-283); then invite | SYC-53 plan; `gh pr list` |
| **Dashboard redesign** (SYC-396) | Phases 0 and 1 merged; 1.1–1.3 live, 0.2 and 1.3.4–1.6 not yet | Phases 2–5, outline only. See "The dashboard redesign" | SYC-396 plan |
| **Coat colours and pattern** (SYC-398) | All five PRs merged (#221, #223, #225, #226, #231), not live yet | No PR. Live check after publish; Samuel's verdicts (SYC-399); the team coat-words amendment awaits Samuel (SYC-443) | SYC-398 |
| **Extra face and body photos** (SYC-415) | All four PRs merged (#209, #212, #213, #215); PR 4 merged 18 Oct, not live yet | No PR. After the 19 Oct publish: confirm it's off, check it live, then switch it on (with a heads-up to Samuel first) | `gh pr view 215` |
| **Photo location from the library** (SYC-166) | Slices 0–3 merged | 1 PR: slice 4 (start the map in Ermoupoli when there's no location). Slice 5 waits on a real-phone check and goes with the store apps | SYC-166 |

Already done and part of the launch: the cat-in-trouble flow and the reporter's email (SYC-42, #181), the waiting-screen facts and feeding nudge (SYC-36, SYC-48, #195, #202), the private feeding-site map (SYC-209 3.3, 3.4) and "Probably sterilised" shown publicly (SYC-75).

**Database changes.** `0023` to `0029` shipped with the live build of 16 Oct. `0030` (guardian changes index) is on `main`, not live, and goes first in the 19 Oct publish. Whether it's already applied to the live database is **unchecked** and is checked in that publish. Of the remaining work, only dashboard phase 3 is likely to need a change (vet visits); the combined plan (D1) will say. SYC-246's `photo_removal` moves to November.

---

## The dashboard redesign: what fits

The spec (`docs/specs/team-dashboard-redesign.md`) and its plan were both approved on 15 Oct. The plan details phases 0 and 1 and outlines the rest, and says each later phase gets its own plan "written when the phase before it has merged".

| Phase | What the team gets | Pull requests (estimate) | Fits by 28 Oct? |
|---|---|---|---|
| 0 | "Are you sure?" before retiring a site; map links for island-wide staff | 2, merged | **Done** |
| 1 | Named areas and place labels; smaller photo sizes; the Cats grid with filters; the cat page summary; the island map; the new menu | 7, merged | **Done** (part not live yet) |
| Before 2 | The new team powers written into the roles spec, as the spec requires "before anything is built" (§10.3) | 1 (docs) | **Yes** |
| 2 | **Home** (what needs doing, with counts); **Colonies list** with progress bars and flags; the **trapping planner**; **named areas** the team can edit; **Find from a photo** (uses the matching model, with daily caps). Plus the guardian versions of the Colonies list and planner (no costs) | 6 or 7 | **Yes**, if the plan is approved on 20 Oct |
| 3 | **Vet visits**: logging a visit sets "sterilised" and "vaccinated" together, with undo, three new powers and a standard price with history. **Round logging.** Five **reports** (sterilisation progress, colony health, coverage, welfare patterns, vet costs) with downloads. Plus guardians' read-only views of their own colonies' progress, health and vet visits | 7 to 10 (vet visits 2–3; reports 3–5) | **Vet visits and round logging probably yes. The reports probably not.** They also need logged vet visits to give honest figures |
| 4 | The **impact report** for funders: a fixed "as of" date, print, PDF and download | 1 or 2 | **Probably not.** It's built on the reports, and on 31 October it would have almost nothing to show |
| 5 | **Donations** report | 1 | **No.** It can't be built until James settles the route. Until then the spec has the Reports list say "Coming once donations are set up" |

**What has to wait for what.** The four phase 2 screens don't depend on each other, so they can be built side by side. Vet visits need only Home's shared way of counting cats, not the rest of phase 2. Round logging needs vet visits. The reports need vet visits. The impact report needs the reports.

**The arithmetic.** About 17 to 21 pull requests, from Tuesday 20 to the feature freeze on Wednesday 28. Each needs its own independent review, fixes and one of Samuel's merge windows, and reaches the live site only at a publish. Building in parallel helps phase 2. It doesn't help the chain from vet visits to reports to the impact report, which leaves the reports finishing over the weekend of 24–25 October and the impact report on Monday 26, with no slack. That only works if Samuel can merge on that weekend.

**Questions the spec leaves for Syros Cats** (SYC-442; the spec's assumptions stand until they answer): one sterilisation price or one per clinic; corrections to the named-area list; the "not seen lately" threshold (6 weeks assumed); the smallest area in the impact report (5 cats assumed).

---

## Decisions for Samuel

Each has a recommendation. **All five were decided by Samuel on 18 October.**

### D1. Write the dashboard plans for phases 2, 3 and 4 together, now? (SYC-463) · **Decided: A** (Samuel, 18 Oct, recorded on SYC-463)

The combined plan is written in its own session (the dashboard redesign worktree) as a new file under `docs/superpowers/plans/`, for approval on Tuesday 20 October.

| Option | Benefits | Risks |
|---|---|---|
| **A. One combined plan for phases 2–4, written 19 Oct and reviewed, for approval on Tue 20 Oct (recommended)** | Vet visits can start as soon as Home's counting is merged, and the reports as soon as vet visits are. It gives the reports a real chance | Changes the approved plan's rule. Phase 3's plan is written before phase 2's code exists, so each builder re-reads the merged code first, which the plan already requires |
| B. One plan per phase, as approved | Each plan sees the code before it | Two more write–review–approve cycles of about two days each. The reports and the impact report would almost certainly miss 31 October |

**Recommended A; Samuel chose A.** The combined plan starts with the roles-spec update (§10.3) and lists every guardian screen and its tests.

### D2. If it doesn't all fit: the order to decide on Wednesday 28 October · **Decided: the recommended order** (Samuel, 18 Oct, recorded on SYC-396)

You kept all of phases 2–5 for 31 October, and the plan builds for that. This isn't a request to cut anything now. It's the order I'd recommend on Wednesday 28, at the feature freeze, if not everything has merged. You'd decide then, with what's merged and what isn't in front of you.

The order runs from what visitors and the team would miss least to what they'd miss most. Nothing on it is visitor-facing, and each piece can go live on any day after 31 October without a relaunch.

1. **Donations report (phase 5).** It can't be built until James settles the route, so on 31 October the Reports list says "Coming once donations are set up", as the spec intends.
2. **The impact report (phase 4)** waits for 16 November, when the records import may have given it something to show.
3. **The five reports and downloads (phase 3)** wait for 16 November. Vet visits and round logging stay in, so data starts building up from launch day.
4. **Find from a photo (phase 2)** waits for 16 November. The team can already find cats by look and place with phase 1's grid.

**Samuel agreed this order as the fallback.** On Wednesday 28, anything on it that hasn't merged waits for 16 November, starting from the top. Never slipped: Home, the Colonies list, the trapping planner, editable areas, vet visits and round logging.

### D3. The launch web address (SYC-306) · **Decided: `syros.catspotters.com`** (Samuel, 18 Oct, recorded on SYC-306)

Turnstile, the QR codes and the staff sign-in all need it, and the QR artwork can't be finished without it. Recommended `app.catspotters.com`; **Samuel chose `syros.catspotters.com`.** It has no DNS record yet (`dig`, 18 Oct). Linking it to the Replit deployment may need Samuel's click in Replit; Claude then adds the records and the Turnstile widget through the Cloudflare API, and checks it end to end by Tuesday 27. `apptest` keeps working through November so staff and guardian sign-in can't break on launch day.

### D4. The name printed on the QR materials (SYC-464) · **Decided: A, "Syros Cat Spotters"** (Samuel, 18 Oct)

The rename is in spring, so the launch carries today's name. But today's name isn't consistent. The welcome screen says **"Syros Cat Spotters"** in all three languages. The app's own name says **"Syros Cat Spotter"** in English, "Γάτες της Σύρου" in Greek and "Chats de Syros" in French (`artifacts/cat-spotter/lib/i18n.ts:50, 281, 727, 1375`).

| Option | Benefits | Risks |
|---|---|---|
| **A. Print "Syros Cat Spotters", and make the English app name match (one word) (recommended)** | What people read on the poster is what they see when the app opens | A small wording change before Johnny's pack. Posters show the old name after the spring rename |
| B. Print "Cat Spotters" now | Posters outlast the rename | The app says something different until spring |

**Recommended A; Samuel chose A.** Posters read "Syros Cat Spotters" above `syros.catspotters.com`. The one-word fix to the English app name lands before the copy freeze on Thursday 22.

### D5. Guardian screens that arrive after the copy freeze · **Decided: A** (Samuel, 18 Oct)

The team's dashboard stays English only (DECISIONS Part 2o), but what cat guardians see is in three languages. Phase 3's guardian views will land after Johnny's pack goes out on Friday 23.

| Option | Benefits | Risks |
|---|---|---|
| **A. They show in English until Johnny checks a short second pack, with a second window of 27–29 Oct (recommended)** | Guardians get the screens at launch; nothing unchecked appears in Greek or French | A few guardian screens are in English for a few days |
| B. Hold those guardian views back until checked | Every guardian screen is in their language | Guardians wait for the progress and health views |

**Recommended A; Samuel chose A.** Ask Johnny now for both windows (noted on SYC-346).

### Already settled

- **The store apps** go in spring (Samuel, 18 Oct). So the store-account owner, the app's permanent id and the phone apps' "Report an issue" check (SYC-347) aren't launch decisions any more, as noted on SYC-347.
- **The earlier cut candidates are superseded.** The starter facts shipped in full, and deleting a photo for good is in November by Samuel's decision.

---

## Day by day

Claude's building runs in parallel worktrees. The limits are Samuel's approvals and merge windows (two a day), the order the dashboard's phases must go in, and seven publishes, each needing Samuel's pull in Replit.

| Day | Publish | Building and checks (Claude) | Samuel, Syros Cats, Johnny |
|---|---|---|---|
| **Sun 18** | — | This plan and its review | — |
| **Mon 19** | **Yes: the 18-change backlog.** Neon snapshot, then `0030` (ask mode), then publish. Live check of each feature in the batch | Combined dashboard plan for phases 2–4 and its review (D1, written in the dashboard redesign session). Photo-removal runbook (SYC-462). Privacy policy changes for Samuel. SYC-44 6.1. SYC-166 slice 4. English app name fix (SYC-464). SYC-415 confirmed off, checked, then switched on | Approve this plan. Pull in Replit; ask mode for the database step. Ask Syros Cats for door pins (SYC-68), QR printing and placement (SYC-51), privacy wording (SYC-66) and the four dashboard questions (SYC-442). Ask Johnny for both windows |
| **Tue 20** | — | Roles-spec update (§10.3). Dashboard 2.1 Home, 2.2 Colonies list, 2.3 trapping planner, 2.4 editable areas, side by side. SYC-44 6.2 | **Approve the dashboard plan and the privacy spec.** Link `syros.catspotters.com` in Replit |
| **Wed 21** | **Yes** | Dashboard 2.5 Find from a photo; 3.1 vet visits (once Home's counting is merged). Privacy page live. QR artwork | Merges. Approve the QR artwork |
| **Thu 22** | — | **Copy freeze.** Johnny's pack assembled (SYC-346). SYC-44 7.1. Vet visits, second part | Merges |
| **Fri 23** | **Yes** | Round logging; first reports. SYC-105 republish check | **Send Johnny's pack.** QR to the printer |
| **Sat 24 – Sun 25** | — | Remaining reports. Clocks change in Athens on Sunday | **Weekend merge window needed** for the reports to have a chance. Johnny reviewing |
| **Mon 26** | **Yes** | Impact report, if the reports merged. Report an issue's daily limit checked live after the clock change. SYC-44 8.1. Johnny's second pack (D5) | Merges |
| **Tue 27** | — | Johnny's corrections applied. Launch address checked end to end. Rollback step written into SYC-345 | **Johnny's corrections back** |
| **Wed 28** | **Yes: feature freeze** | — | **Decides what waits for 16 Nov (D2)** |
| **Thu 29** | **Yes: final, fixes only** | Johnny's second-pack corrections | Pull in Replit |
| **Fri 30** | — | Launch-day checklist on the live site, pass still on; a second reviewer reads the results | Agree the announcement with Syros Cats |
| **Sat 31** | — | **Pass off**, then the checks again; watch the first hours | Announce; QR codes out |

**Does it fit?** Everything outside the dashboard fits with room to spare: about 8 pull requests plus checks and people's steps. The dashboard fits through vet visits and round logging if D1 is approved on Tuesday 20 and nothing goes badly wrong. The reports need a weekend merge window and still have no slack. The impact report almost certainly waits.

---

## Privacy policy: what it must say at launch

From the spec (`docs/specs/privacy-policy.md`) and the 18 Oct changes:

- Syros Cats is the data controller. The address for requests is hello@catspotters.com, which needs to be watched, with a stated response time.
- **Photo removal:** "ask us and we'll remove it." It mustn't promise a self-service button, or suggest that hiding a photo erases it.
- **The reporter's email** (live now): what's kept, for how long, and the "is this you?" step.
- **Location:** public cats are shown on a 250 m grid, and photo location from the library is used only to start the map.
- **Suppliers:** Neon (database), Cloudflare (Turnstile), Resend (email), Replit (hosting).
- **No news-email promise yet**, since email capture is in November.
- How long "Report an issue" reports are kept (one year), and how long backups keep deleted data.

Syros Cats confirm the wording by Tuesday 20 for the page to go live on Wednesday 21.

---

## The launch-day checklist (SYC-345)

Each line has a check that can fail. Run on Friday 30 with the pass on, then the switch-dependent ones again after it's off. **Blurring is a hard gate:** if it fails, the pass stays on.

| Condition | Check |
|---|---|
| **Location blurring (SYC-41, SYC-114 step 0), checked before the switch** | The public cat list carries no exact positions; each cat is on the 250 m grid |
| Turnstile on both forms | The site's version check shows the secret configured. After switch-off, a report with no token is refused and a real one from the website is accepted |
| Shared limits (SYC-105) | A limit still holds after a republish; the number of servers matches `docs/DEPLOYMENT.md` |
| Home description rule (SYC-130, DECISIONS Part 2q) | The public cat details carry no home description where they shouldn't |
| Launch address (SYC-306, SYC-191, SYC-229) | It opens without the password after switch-off; staff and guardian sign-in work through it; visitor limits can't be dodged with a fake address |
| Privacy policy | `catspotters.com/privacy` answers and says how to ask for a photo to be removed |
| Photo removal (SYC-462) | The runbook's dry run passed on the development database |
| Report inbox (SYC-173) | A marked test report reaches admin@syroscats.com, not spam |
| Reporter's email | A test report with Samuel's address gets one "is this you?" email, then the acknowledgement |
| Report an issue | A test report about a test photo reaches the team's Issues section |
| Vet visits (if live) | Logging and undoing a visit on a test cat changes, then restores, its public "sterilised" status |
| Donation link | One tap after switch-off goes to the donation page and is counted |
| The live version | The version check shows the launch build |
| Licence | The licence PR (#233) is merged, or Samuel has decided to announce without it (the repo has been public since 18 Oct) |

**Rollback:** turning the pass back on is one setting, and it's the only way back from Turnstile refusing (`turnstile.ts:219`). The exact step is written into SYC-345 by Tuesday 27. Tester data stays as the island's first records (Samuel, 4 Oct, SYC-201).

---

## Owners

| Who | What |
|---|---|
| **Samuel** | Approve this plan and (D1–D5 all decided 18 Oct). Approve the combined dashboard plan and the privacy spec (Tue 20). Every merge, in two windows a day, plus one weekend window on 24–25 Oct. The Replit pull and "ask" mode for each publish with a database change. Send Johnny's pack. Give the go-ahead to invite guardians. The announcement |
| **Syros Cats** | Door pins at the three clinics (SYC-68). QR printing and placement (SYC-51). The four dashboard questions (SYC-442). Confirm the report inbox (SYC-173). Privacy policy wording, as data controller (SYC-66), by Tue 20. The €1 and €30 figures on the feeding nudge (SYC-360) |
| **Johnny** | The Greek and French check, 23–27 Oct (SYC-346), including the guardian words (SYC-283), and a short second window, 27–29 Oct (D5) |
| **James** | The donation route, which unblocks dashboard phase 5. Not needed for 31 October |
| **Claude** | Plans, building, reviews, translation drafts, the runbook, the privacy page, QR artwork, address and Turnstile set-up, database changes and publishes, live checks, Linear |

---

## Risks

| Risk | Effect | What reduces it |
|---|---|---|
| The dashboard chain runs late | Reports and the impact report miss 31 Oct | D1 (plans together); D2 (the order agreed in advance); a weekend merge window. Nothing on it is visitor-facing |
| **Vet visits set a wrong public status** | A cat shows "sterilised" when it isn't, or the reverse | Logging a visit and its undo are tested together; the test is proved to fail if only one is written; a live check on a test cat before launch |
| The 19 Oct publish carries 18 changes | A problem in a big batch is hard to pin down | Database change first, with a snapshot; a live check of each feature before the next publish |
| Johnny unavailable 23–29 Oct | Greek and French go live unchecked | Ask now. Fallback, Samuel's call: English on the screens he hasn't checked |
| Nobody on Syros to pin the clinics | Pins stay 50–100 m out | Not a release item; pins can change any day |
| QR printing or delivery to Syros takes more than 8 days | Posters arrive after launch | Artwork on Wed 21, to the printer on Fri 23. Printing on Syros as a fallback; printer and lead time **unchecked** |
| Launch address breaks sign-in | Team and guardians locked out | Tested on Tue 27; `apptest` kept working |

---

## Model delegation

This session runs on Opus. The plan and its trade-offs stay here, because judging what fits and in what order means weighing the spec, the code and Samuel's decisions together. Everything else goes to the cheapest tier that can do it, and each package names a check that can fail.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Status digest for this version | Sonnet | Reading the repo and Linear | Key claims re-checked here: the SYC-396 outline, SYC-462, the app-name strings, the privacy page 404, the live build |
| Adversarial review of this version | Sonnet, read-only | Checking claims against sources | Every finding checked against its source before it was folded in (review file) |
| Combined dashboard plan, phases 2–4 (D1) | Opus | Synthesis across the spec and the merged code. Vet visits change how "sterilised" is worked out | A Sonnet adversarial review that checks each spec section (§4–§9, §10.2, §10.3) maps to a PR with named tests; Samuel approves |
| Dashboard phase 2 screens (Home, Colonies list, trapping planner, editable areas) | Sonnet | Clear plan, standard screens | CI; the plan's tests; an independent review in its own worktree; a browser check at phone and desktop widths with data |
| Dashboard 2.5 Find from a photo | Opus | Uses the matching model with daily caps; a broken cap costs money without anyone noticing | Remove the per-person cap and its test must go red; review |
| Dashboard 3.1 vet visits | Opus | One visit writes "sterilised" and "vaccinated" together; a wrong result is a wrong public status | Write only one of the two and the undo-together test must go red; live check on a test cat |
| Dashboard round logging, reports, impact report | Sonnet | Counting from a plan | Tests against fixed data with known totals. Count a record dated after the "as of" date and the impact report's test must go red |
| SYC-44 6.1, 6.2, 7.1, 8.1; SYC-166 slice 4 | Sonnet | Each has an approved plan with named tests | CI; the plan's tests; review; browser check |
| Photo-removal runbook and command (SYC-462) | Opus | A missed copy means the photo isn't really gone | Skip one place a photo is kept and the full search test must go red; dry run on development |
| Privacy page, QR artwork | Sonnet | Writing and layout to a spec | Samuel and Syros Cats approve; the page is checked live |
| Greek and French drafts | Sonnet | Translation to a glossary | Johnny's check; the test that every language has every string |
| Linear updates, string-coverage sweeps | Haiku | Mechanical | The coverage test; this session re-reads every Linear change |
| Launch-day switch-off | Opus (this session) | Irreversible and public | The checklist, each line with its own check; a separate Sonnet reviewer reads the Friday results before the switch |

Workflow scripts set `model` on every `agent()` call. Chips started with `spawn_task` run on the parent's model whatever their brief says, so their cards say so.

---

## Linear

- Filed with version 1: SYC-343, SYC-344, SYC-345, SYC-346, SYC-347. SYC-347's remaining questions aren't launch decisions any more (noted there, 18 Oct).
- Filed with version 2: **SYC-463** (the combined dashboard plan, D1) and **SYC-464** (the printed name, D4).

---

## What the adversarial reviews changed

**Version 1** (15 Oct, `mvp-launch-31-oct-review.md`) raised 16 findings: 14 were accepted and 2 rejected in part. It added a publish calendar, the launch-day checklist and checks for each delegated package.

**Version 2** (18 Oct, `mvp-launch-31-oct-review-v2.md`) raised 13 findings. All were accepted, two only in part. Corrections:

- SYC-415 PR 4 has merged.
- Only `0030` remains unpublished.
- The dashboard estimate rises to 17–21 PRs, including the roles-spec step and the guardian screens.
- The real order of what waits for what is set out, and a weekend merge window is named.
- A second Johnny window is added (D5).
- D2 is reframed as a fallback for Samuel to decide on 28 Oct, not a cut now.
- Vet-visit correctness is added to the risks.
- The QR timeline is corrected.
- The privacy policy's launch contents are listed.
- Blurring is now a hard gate before the switch.
- The licence is a checklist line.

Rejected in part:

- #168 is SYC-44's own Slice 3, filed as SYC-279, so it is correctly counted under Report an issue.
- The Turnstile secret is now confirmed configured on the live site.
