# Cat Spotters: the plan to launch on Saturday 31 October 2026

**Status:** version 2, for Samuel's approval · rewritten 18 October 2026 for his launch rescope · Linear project P-SYC-54
**Scope:** Samuel's decisions of 18 October (the two comments on P-SYC-54), which replace the "full spec §2" scope of 12 October (SYC-73). The launch is for everyone, tourists included, and comes in two steps: **31 October**, then a **second release on 16 November** (milestone "Phase 2b"). The website goes first; the phone apps go to the stores in spring.
**Evidence base:** `origin/main` and `gh pr list` on 18 October (fetched), Linear on 18 October, and the live session list. Where nobody has checked something, it says **unchecked**.
**Adversarial reviews:** version 1 in `mvp-launch-31-oct-review.md`; version 2 in `mvp-launch-31-oct-review-v2.md`. A summary of what each changed is at the end.

---

## Words used in this plan

- **The pre-launch pass:** the password that keeps the app to testers today. Turning it off is the launch.
- **Turnstile:** Cloudflare's invisible "are you a person?" check on the report forms. It only watches today; once the pass is off it refuses anything that fails.
- **Publish:** making merged code live. Samuel pulls the latest code into Replit (one click), then Claude publishes and checks the live site shows the new version.
- **Database change (migration):** a numbered change to how the database is laid out, applied before the code that needs it goes live.
- **The dashboard:** the private website Syros Cats' team and cat guardians sign in to. Visitors never see it.

---

## The short version

**Most of the 31 October list is built or nearly built. One item is not: the dashboard redesign's phases 2 to 5.**

- Of the 11 launch items, 6 need no more building, only publishing, checks or people's time. Four need one to five more pull requests each (about 12 in all). Those fit comfortably: the team merged 25, 37 and 23 pull requests a day on 14–16 October.
- The dashboard redesign (SYC-396) is different. Phases 0 and 1 are merged. Phases 2 to 5 are about **13 to 15 pull requests with no detailed plan yet**, and each phase builds on the one before. **My honest view: phase 2 fits, the first half of phase 3 probably fits, the reports and the impact report probably don't, and donations can't be built** because they wait on James. The reports would also be close to empty on launch day, because no vet visits have been logged yet and the records import is in the November release.
- **What would make the most difference:** writing the plans for phases 2, 3 and 4 together, now, for one approval on Tuesday 20 October, instead of one at a time as the approved plan says. That's decision D1.
- **What slips first if it doesn't fit,** for Samuel to approve now (D2): donations (already blocked), then the impact report, then the reports, then "Find from a photo". None of these is something a visitor sees, and each can go live on any day after 31 October without a relaunch.
- **A lot is merged but not live yet,** including the whole of dashboard phase 1, coat colours, guardian accounts and three database changes. The first publish should happen on Monday 19 October so problems surface early, not in launch week.

---

## What "launched" means on 31 October

- Anyone can open the app in a browser at its launch address, without the tester password, in English, Greek or French.
- They can spot a cat (adding extra face and body photos, SYC-415), see the approximate map, pick a photo from their library and have the map start where it was taken (SYC-166), report a cat in trouble, and report a problem with any cat or photo (SYC-44). Coats show as the colours you can see plus a pattern (SYC-398).
- Both report forms refuse bots, and every write has a limit shared across servers (SYC-170, SYC-105).
- Someone who reports a cat in trouble can leave an email address and hear back, in English at first (SYC-42 Slice 3).
- Syros Cats' team use the redesigned dashboard (SYC-396), and cat guardians can be invited to it as it's built today (SYC-53).
- A privacy policy is live on catspotters.com. It says that anyone who wants a photo removed can ask, and the team removes it by hand (SYC-462) until the button arrives in November (SYC-246).
- Every visitor-facing Greek and French sentence has been checked by Johnny.
- Vet clinics are pinned at their doors (SYC-68), and QR materials are out in cafés, hotels and at the Kini feeders (SYC-51).

The website works partly offline: spots made with no signal wait and send later, but the site itself needs a signal to open (SYC-169).

**16 November:** automatic coat colour (SYC-161), the records import if Syros Cats want it (SYC-49), photos out of the database with the hosting decision (SYC-46, SYC-47), email capture (SYC-45), deleting a photo for good (SYC-246), and anything that slipped from 31 October.
**Spring:** the rename to "Cat Spotters" (SYC-34), the store apps (SYC-50, SYC-323), public feeding sites (SYC-461), the nudge switches page (SYC-383), the cat-matching game (SYC-402), the visit summary (SYC-370).

---

## Where each 31 October item stands (18 October)

| Item | State | What's left | Evidence |
|---|---|---|---|
| **Report an issue** (SYC-44) | Server side done: 3.1, 4.1, 4.2, 5.1, 5.2 merged (#168, #170, #188, #203, #189) | 4 PRs: 6.1 (full-screen photo and hidden tile), 6.2 (the reason sheet and confirm step; nothing reaches the team until this ships), 7.1 (the team's Issues section), 8.1 (the one-year clean-up) | SYC-44 plan; `git log origin/main` |
| **Removing a photo by hand** (SYC-462, replacing SYC-246 at launch) | Not started | 1 PR: a runbook and a reviewed `db-ops` command that hides the photo, then removes it and every copy (main photo, sighting photo, extra photos, matching reference, small and medium versions, caches), with a dry run on the development database | SYC-462 |
| **Privacy policy** (SYC-66, with SYC-82, SYC-124, SYC-248, SYC-265, SYC-110) | Spec awaits Samuel's approval. **No page:** `catspotters.com/privacy` answers 404 | Samuel approves the spec, with three changes: "ask us" for photo removal, Neon, Cloudflare and Resend named, and no news-email promise yet (email capture is in November). Then 1 PR on the website | `curl` on 18 Oct; SYC-66 |
| **Bot protection and limits** (SYC-170, SYC-105) | Website, server and phone-app checks all merged (#151, #171, #196). Secret key configured in production (15 Oct) | No PR. The check switches itself to refusing when the pass goes off. SYC-105: check a limit holds across a republish, then allow more than one server. The phone-app check on a real phone moves to spring with the stores | SYC-170, SYC-105 comments |
| **Greek and French check** (SYC-4, SYC-346, SYC-172) | Strings are being collected on SYC-346 as each PR lands | Claude assembles the pack on Thu 22 Oct; Johnny checks 23–27 Oct; 1 PR of corrections | SYC-346 |
| **Vet pins** (SYC-68) | Three clinic pins sit on nearby petrol stations, 50–100 m out | Someone on Syros drops a pin at each door. Pins are settings, so no release is needed | SYC-68 |
| **QR materials** (SYC-51) | Not started; no spec | Artwork (Claude) once the launch address and the printed name are decided (D3, D4); printing and placing (Syros Cats) | SYC-51 |
| **Cat guardian accounts, as built** (SYC-53) | Slices 0–2 and the guardian screens of SYC-209 Slice 4 merged. Slice 1 is live; 2.1 and 2.2 aren't yet | No PR needed. Steps: publish; create the first colony (#229, a draft, would let a guardian start one); Samuel's go on the People screen; invite; Johnny's check of the guardian words (SYC-283) | SYC-53 plan; `gh pr list` |
| **Dashboard redesign** (SYC-396) | Phases 0 and 1 merged (#218, #219, #198, #200, #205, #206, #228, #230, #227), **not live yet** | Phases 2–5, outline only. See "The dashboard redesign" below | SYC-396 plan |
| **Coat colours and pattern** (SYC-398) | All five PRs merged (#221, #223, #225, #226, #231), not live yet | No PR. Live check after publish; Samuel's verdicts (SYC-399); the team coat-words amendment awaits Samuel (SYC-443) | SYC-398 |
| **Extra face and body photos** (SYC-415) | PRs 1–3 merged (#209, #212, #213); PR 4 open (#215) | PR 4 merges only after PR 3 is live, then a live check and switch-on (with a heads-up to Samuel first) | SYC-415 |
| **Photo location from the library** (SYC-166) | Slices 0–3 merged | 1 PR: slice 4 (start the map in Ermoupoli when there's no location). Slice 5 waits on a real-phone check and goes with the store apps | SYC-166 |

Already done and part of the launch: the cat-in-trouble flow and the reporter's email (SYC-42, #181), the waiting-screen facts and feeding nudge (SYC-36, SYC-48, #195, #202), the private feeding-site map (SYC-209 3.3, 3.4), and "Probably sterilised" shown publicly (SYC-75, switched on 15 Oct).

**Database changes on `main`, highest `0030`.** `0028` (photo versions), `0029` (sighting photos) and `0030` (guardian changes index) are merged and need applying before the next publish (unchecked whether `0030` already has been). The only change expected before launch is none: no remaining 31 October PR has a migration, unless the SYC-396 plans add one (vet visits in phase 3 probably will). SYC-246's `photo_removal` moves to November.

---

## The dashboard redesign: what fits

The spec (`docs/specs/team-dashboard-redesign.md`, approved 15 Oct) and its plan (approved 15 Oct) set out six phases. The plan says each later phase gets its own detailed plan "written when the phase before it has merged".

| Phase | What the team gets | Pull requests | Needs first | Fits by 28 Oct? |
|---|---|---|---|---|
| 0 | "Are you sure?" before retiring a site; map links for island-wide staff | 2, merged | — | **Done** |
| 1 | Named areas and place labels; smaller photo sizes; the Cats grid with filters; the cat page summary; the island map; the new menu | 7, merged | — | **Done** (not live yet) |
| 2 | **Home** (what needs doing, with counts); **Colonies list** with progress bars and flags (growing, kittens, no guardian, not visited lately); the **trapping planner**; **named areas** the team can edit; **Find from a photo** | 5 | A plan, then phase 1 | **Yes**, with a plan approved on 20 Oct. Find from a photo is the riskiest: it uses the matching model, with daily caps |
| 3 | **Vet visits** (logging a visit sets "sterilised" and "vaccinated"); **round logging**; five **reports** (sterilisation progress, colony health, coverage, welfare patterns, vet costs) with downloads | 5 or 6 (reports are likely 2 or 3 PRs) | Phase 2 | **Vet visits and round logging probably yes. Reports probably not.** They also need vet visits to give honest figures, and none have been logged yet |
| 4 | The **impact report** for funders: a fixed "as of" date, print, PDF and download | 1 or 2 | Phase 3's figures | **Probably not.** It's built on the reports, and on 31 October it would have almost nothing to show |
| 5 | **Donations** report | 1 | The donation route with James | **No.** It can't be built until James settles the route. Until then the spec has the Reports list say "Coming once donations are set up", which is its own design |

Total for phases 2–5: about 13 to 15 pull requests and three plans, in a chain where each phase waits for the one before. There are eight building days between Tuesday 20 and the feature freeze on Wednesday 28.

**Questions the spec leaves for Syros Cats** (they don't block building; its assumptions stand until answered): one sterilisation price or one per clinic; corrections to the named-area list; the "not seen lately" threshold (6 weeks assumed); the smallest area in the impact report (5 cats assumed).

---

## Decisions for Samuel

Each has a recommendation. D1 and D2 matter most.

### D1. Write the dashboard plans for phases 2, 3 and 4 now, together?

| Option | Benefits | Risks |
|---|---|---|
| **A. One combined plan for phases 2–4, written 19 Oct, reviewed, for approval on Tue 20 Oct (recommended)** | Phase 3 and 4 builders can start the day phase 2 merges, not after another write-review-approve cycle. Gives the reports a real chance | Changes the approved plan's rule. Phase 3's plan is written before phase 2's code exists, so each builder re-reads the merged code first (the plan's own rule already requires that) |
| B. One plan per phase, as approved | Each plan sees the code before it | Two more approval cycles (about two days each). Reports and the impact report almost certainly miss 31 October |

**Recommendation: A.**

### D2. What slips first, if it doesn't all fit

You kept all of phases 2–5 for 31 October. If it doesn't fit, this is the order I recommend letting things go, starting with what you'd least mind losing. My reasoning: visitors never see the dashboard, any of it can go live on any day after 31 October without a relaunch, and the reports are close to empty until vet visits and the records import exist.

1. **Donations report (phase 5).** It can't be built until James settles the route. On 31 October the Reports list says "Coming once donations are set up", which is what the spec intends.
2. **The impact report (phase 4)** → the 16 November release, when the records import may have given it something to show.
3. **The five reports and downloads (phase 3.3)** → 16 November. Vet visits and round logging stay in, so data starts building up from launch day.
4. **Find from a photo (phase 2.5)** → 16 November. The team can already find cats by look and place with phase 1's grid.
5. **Report an issue's one-year clean-up (SYC-44 8.1)** → 16 November. Nothing is a year old until October 2027.
6. **Starting the map in Ermoupoli (SYC-166 slice 4)** → 16 November.

**Never slipped:** Report an issue for visitors and the team (6.1, 6.2, 7.1), the privacy policy and the photo-removal runbook, bot protection and limits, the Greek and French check, the launch-day checklist, and dashboard Home, Colonies list, trapping planner, editable areas, vet visits and round logging.

**Recommendation:** approve this order now, so that on Wednesday 28 October the cut is already decided. I expect items 1 to 3 to slip, possibly 4.

### D3. The launch web address (SYC-306, still open)

Turnstile, the QR codes and the staff sign-in all need it, and the QR artwork can't be finished without it. **Recommendation:** `app.catspotters.com`, decided by Tuesday 20 October. Claude sets it up and the Turnstile widget through the Cloudflare API and checks it end to end by Tuesday 27. `apptest` keeps working through November so staff sign-in can't break on launch day.

### D4. The name printed on the QR materials

The rename is in spring, so the launch carries today's name. But today's name isn't consistent: the welcome screen and the phone app's settings say **"Syros Cat Spotters"**, while the app's own name in English says **"Syros Cat Spotter"**, in Greek "Γάτες της Σύρου" and in French "Chats de Syros" (`artifacts/cat-spotter/lib/i18n.ts:50, 281, 727, 1375`).

| Option | Benefits | Risks |
|---|---|---|
| **A. Print "Syros Cat Spotters", and make the English app name match (one word) (recommended)** | What people read on the poster is what they see when the app opens | A tiny wording change before Johnny's pack; posters say the old name after the spring rename |
| B. Print "Cat Spotters" now | Posters survive the rename | The app says something different until spring |

**Recommendation: A.** The web address on the poster outlives either name.

### Already settled

- **The store apps** go in spring (Samuel, 18 Oct), so the store-account owner, the app's permanent id and the phone apps' "Report an issue" check (SYC-347 D1b, D2, D5) aren't launch decisions any more. They're noted on SYC-347.
- **The earlier cut candidates** (starter facts at 10; SYC-44 7.2 and 8.1 to November) are superseded: the facts shipped in full, 7.2 is in November by Samuel's decision, and 8.1 is in D2.

---

## Day by day

Claude's building runs in parallel worktrees; the limits are Samuel's approvals and merges, the order SYC-396's phases must go in, and seven publishes. Samuel merges in two windows a day.

| Day | Publish | Building and checks (Claude) | Samuel, Syros Cats, Johnny |
|---|---|---|---|
| **Sun 18** | — | This plan; its review | — |
| **Mon 19** | **Yes: the backlog** (dashboard phase 1, coat colours, guardian slice 2, SYC-415 PR 3, SYC-209 Slice 4; migrations `0028`–`0030` first) | Combined dashboard plan for phases 2–4 (D1) and its review. Photo-removal runbook (SYC-462). Privacy policy changes for Samuel. SYC-44 6.1. SYC-166 slice 4 | Approve this plan; D1–D4. Pull in Replit. Ask Syros Cats for door pins (SYC-68), QR placement (SYC-51) and the four dashboard questions |
| **Tue 20** | — | SYC-415 PR 4 (after PR 3 is live) and switch-on. SYC-44 6.2. Dashboard 2.1 Home, 2.2 Colonies list | **Approve the dashboard plan and the privacy spec.** Decide D3 |
| **Wed 21** | **Yes** | Dashboard 2.3 trapping planner, 2.4 editable areas. Privacy policy page live. QR artwork draft | Merges |
| **Thu 22** | — | **Copy freeze.** Johnny's pack assembled (SYC-346). SYC-44 7.1. Dashboard 2.5 Find from a photo, 3.1 vet visits | Approve the QR artwork |
| **Fri 23** | **Yes** | Dashboard 3.2 round logging, first reports. SYC-105 republish check | **Send Johnny's pack.** QR to the printer |
| **Sat 24 – Sun 25** | — | Dashboard reports, second part. Clocks change in Athens on Sunday | Johnny reviewing |
| **Mon 26** | **Yes** | Dashboard impact report (phase 4), if phase 3 merged. Report an issue's daily limit checked live after the clock change. SYC-44 8.1 | Merges |
| **Tue 27** | — | Johnny's corrections applied. Launch address checked end to end | **Johnny's corrections back** |
| **Wed 28** | **Yes: feature freeze** | Anything unmerged is cut in the D2 order | Merges; confirms the cut |
| **Thu 29** | **Yes: final, fixes only** | — | Pull in Replit |
| **Fri 30** | — | Launch-day checklist on the live site, pass still on | Agree the announcement with Syros Cats |
| **Sat 31** | — | **Pass off**, then the checks again; watch the first hours | Announce; QR codes out |

**Does it fit?** Everything except the dashboard fits with room to spare: about 12 PRs over eight days. The dashboard's 13 to 15 PRs fit only with D1 and only if nothing goes wrong. The reports (phase 3.3) land on the weekend of 24–25 October and the impact report on Monday 26, with no slack and their reviews still to come. That's why D2 matters.

**Dashboard words and Johnny:** the team dashboard stays English only (DECISIONS Part 2o), so most of phases 2–5 adds nothing to Johnny's pack. The exceptions are screens cat guardians see, which are in three languages. Any of those that phase 2 or 3 adds must be in the pack by Thursday 22, or go in a short, flagged second pack.

---

## The launch-day checklist (SYC-345)

Each line has a check that can fail. Run on Friday 30 with the pass on, then the switch-dependent ones again after it's off.

| Condition | Check |
|---|---|
| Turnstile on both forms | `/api/healthz` shows the secret configured; after switch-off, a report with no token is refused and a real one from the website is accepted |
| Shared limits (SYC-105) | A limit still holds after a republish; the number of servers matches `docs/DEPLOYMENT.md` |
| Home description rule (SYC-130, DECISIONS Part 2q) | The public cat payload carries no home description where it shouldn't |
| Location blurring (SYC-41) | A public cat's position is on the 250 m grid |
| Launch address (SYC-306, SYC-191, SYC-229) | Opens without the password after switch-off; staff and guardian sign-in work through it; the same proxy hops as `apptest` |
| Privacy policy | `catspotters.com/privacy` answers, and says "ask us" for photo removal |
| Photo removal (SYC-462) | The runbook's dry run passed on the development database |
| Report inbox (SYC-173) | A marked test report reaches admin@syroscats.com, not spam |
| Reporter's email | A test report with Samuel's address gets one "is this you?" email, then the acknowledgement |
| Report an issue | A test report about a test photo reaches the team's Issues section |
| Donation link (`/api/go/feed`) | One tap after switch-off goes to the donation page and is counted |
| The live version | `/api/healthz` shows the launch commit |

**Rollback:** turning the pass back on is one setting, and it's the only way back from Turnstile refusing (`turnstile.ts:219`). The exact step is written into SYC-345 before switching. Tester data stays as the island's first records (Samuel, 4 Oct, SYC-201).

---

## Owners

| Who | What |
|---|---|
| **Samuel** | Approve this plan and D1–D4. Approve the combined dashboard plan (Tue 20) and the privacy policy spec. Every merge, in two windows a day. The Replit pull before each publish. Sending Johnny's pack. The go-ahead to invite guardians. The announcement |
| **Syros Cats** | Door pins at the three clinics (SYC-68). QR printing and placement (SYC-51). The four dashboard questions. Report inbox confirmation (SYC-173). Privacy policy wording, as data controller (SYC-66). The €1/€30 figures (SYC-360) |
| **Johnny** | The Greek and French check, 23–27 Oct (SYC-346), including the guardian words (SYC-283) |
| **James** | The donation route, which unblocks dashboard phase 5. Not needed for 31 October |
| **Claude** | Plans, building, reviews, translation drafts, the runbook, the privacy page, QR artwork, address and Turnstile set-up, database changes and publishes, live checks, Linear |

---

## Risks

| Risk | Effect | What reduces it |
|---|---|---|
| The dashboard chain runs late | Reports and the impact report miss 31 Oct | D1 (plans together), D2 (agreed slip order); none is visitor-facing |
| The first publish carries too much | A problem in a big batch is hard to pin down | Publish on Mon 19, not later; migrations first; a live check of each feature in the batch before the next publish |
| Johnny unavailable 23–27 Oct | Greek and French go live unchecked | Ask now. Fallback (Samuel's call): English on the screens he hasn't checked |
| Nobody on Syros to pin the clinics | Pins stay 50–100 m out | Not a release item; pins can change any day |
| QR printing takes longer than four days | Posters arrive after launch | Artwork by Wed 21, printer on Fri 23; the address decided by Tue 20 |
| Launch address breaks sign-in | Team and guardians locked out | Tested on Tue 27; `apptest` kept working |

---

## Model delegation

This session runs on Opus. The plan and its trade-offs stay here: judging what fits, and in what order, is synthesis across the spec, the code and Samuel's decisions. Everything else goes to the cheapest tier that can do it, and each package names a check that can fail.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Status digest for this version | Sonnet | Reading the repo and Linear | Key claims re-checked here (SYC-396 plan outline, SYC-462, the app-name strings, the privacy page 404) |
| Adversarial review of this version | Sonnet | Checking claims against sources | Every finding checked against its source before folding in (review file) |
| Combined dashboard plan, phases 2–4 (D1) | Opus | Synthesis across the spec and nine merged PRs; vet visits change how "sterilised" is worked out | Sonnet adversarial review checking each spec section (§4–§9, §10.2) maps to a PR with named tests; Samuel approves |
| Dashboard phase 2 PRs (Home, Colonies list, trapping planner, editable areas) | Sonnet | Clear plan, standard screens | CI; the plan's tests; adversarial review in its own worktree; browser check at 390 px and desktop with data |
| Dashboard 2.5 Find from a photo | Opus | Uses the matching model with daily caps; a broken cap costs money silently | Mutation probe: remove the per-person cap and its test goes red; review |
| Dashboard 3.1 vet visits | Opus | One visit writes "sterilised" and "vaccinated" together; a wrong result is a wrong public status | Mutation probe: write only one of the two and the undo-together test goes red; live check that a logged visit changes the cat's status |
| Dashboard 3.2–4.1 (round logging, reports, impact report) | Sonnet | Reading and counting from a plan | Tests against fixed fixtures with known totals; the "as of" test fails if a later record is counted |
| SYC-44 6.1, 6.2, 7.1, 8.1; SYC-166 slice 4; SYC-415 PR 4 | Sonnet | Each has an approved plan with named tests | CI; plan tests; adversarial review; browser check |
| Photo-removal runbook and command (SYC-462) | Opus | A missed copy means the photo isn't really gone | Mutation probe: skip one place a photo is kept and the full-table search test goes red; dry run on development |
| Privacy page, QR artwork | Sonnet | Writing and layout to a spec | Samuel and Syros Cats approve; the page is checked live |
| Greek and French drafts | Sonnet | Translation to a glossary | Johnny's check; the key-parity test |
| Linear updates, key-parity sweeps | Haiku | Mechanical | The parity test; this session re-reads every Linear change |
| Launch-day switch-off | Opus (this session) | Irreversible and public | The checklist, each line with its own check |

Workflow scripts set `model` on every `agent()` call. Chips started with `spawn_task` run on the parent's model whatever their brief says, so their cards say so.

---

## Linear

- SYC-343, SYC-344, SYC-345, SYC-346 and SYC-347 were filed with version 1.
- SYC-347's remaining decisions are noted as no longer launch-blocking (Samuel, 18 Oct).
- Filed with version 2: the combined dashboard plan for phases 2–4 (D1), and the name printed on the QR materials (D4).

---

## What the adversarial reviews changed

**Version 1** (15 Oct, `mvp-launch-31-oct-review.md`): 16 findings, 14 accepted and 2 rejected in part. They added a publish calendar, the launch-day checklist, and checks for each delegated package.

**Version 2** (18 Oct, `mvp-launch-31-oct-review-v2.md`): see that file.
