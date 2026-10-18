# Adversarial review: MVP launch plan (31 Oct 2026)

**Reviewer:** independent Sonnet sub-agent, 15 Oct 2026, against `origin/main` `2acae50` and `gh pr list`. It did not read Linear.
**Reviewed:** `mvp-launch-31-oct.md` at commit `e3dd0b7`.
**What happened to each finding** is in the table at the end, after the reviewer's text. The text is reproduced as returned.

---

**Verdict.** The plan is honest about the store-apps problem and gets the Turnstile secret and enforce mechanics broadly right. But its central premise ("web launches 31 Oct, phones follow") hides a break for anyone already on a phone build. Its dependency chain for SYC-44 and SYC-209 is looser than it looks. Its date budget assumes a Samuel-as-merger throughput nobody has tested. The "Model delegation" table fails the stated standard in four places. The privacy, support-page and store-label blockers are only half-listed. The spec's §2.6 per-site public toggle is deferred without being flagged as a spec deviation. None of this is fatal, but items 1–4 should be fixed before approval.

Method note: I checked the repo and `gh pr list` only. Linear tools were available but I did not use them, so every Linear status ("Done", "Backlog") is **unchecked** by me. Gmail and Play/Apple account claims are also unverifiable here.

1. **Blocker. Gate-off forces Turnstile to enforce, which will refuse every existing phone build, and the plan misses this.** `turnstile.ts:219` says `if (!gateEnabled()) return "enforce"`, whatever `TURNSTILE_MODE` says. The plan says the phone-app check (PR 1.3) only blocks the "store release". But the SYC-44 plan's rollout says enforce only after 1.3's build is "in testers' hands". On 31 Oct, with the gate off, the WhatsApp testers' TestFlight/Play builds and any dev build (all without a WebView challenge) get 428 on cat-in-trouble and issue reports. The "Wave 1" row for 1.3 calls this harmless ("nobody uses a store build on launch day"), which is false for current testers.
   *Fix:* either make 1.3 plus a tester build a launch gate, or state plainly that native testers lose reporting from 31 Oct until the new build, and tell them. Add a rollback path: because gate-off overrides the env var, the only way back from enforce is to turn the gate on again. Say so.

2. **Blocker. Items 1 and 6.2 together contradict the approved SYC-44 plan.** The plan says 6.2 "ships on the website first" and the apps pick it up with 1.3. The approved plan (`syc-44-report-an-issue.md`, step 6 table) lists 6.2 as needing "1.2 and 1.3 for the check". Shipping the web-only 6.2 is a plan deviation that nobody approved. It also means the app-side "saved list" path is untested against enforce.
   *Fix:* record it as a decision (D5) with options, or keep 6.2 behind 1.3.

3. **Major. Migration 4.1 → 4.2 costs two Samuel publishes, and the schedule does not budget them.** The SYC-44 plan (line 294) requires 4.2 to be merged and migrated "only **after** 4.1 is published". 4.1 is not yet open (the plan says so). The chain is 4.1 PR, review, merge, migrate, Samuel Git-pane pull, publish, healthz, then 4.2 PR, then 5.2, then 5.1 (which "needs 2.1, 4.2, 1.1 and 5.2"). 5.1 then needs 6.1/6.2/7.1 behind it, all by Wed 28. The plan names this chain but gives it one Wave-1 row ("Sat 17 – Wed 21") and does not count the publish round-trips. That is roughly 4 publish cycles for SYC-44 alone, plus 209, plus email capture, on one Git-pane puller.
   *Fix:* put a publish calendar in the plan (for example Mon/Wed/Fri/Tue/Thu) and map each PR to a slot.

4. **Major. SYC-209 3.4 needs 0.2, and the plan never says whether 0.2 has merged.** The 209 plan (line 220) says "0.2 before 3.4". 3.4 ships "Make a feeding site here", a button that must not appear unless 0.2's change is present (test line 383). `git log origin/main` shows 0.1/1.1/1.2/2.1/2.2/3.1 but no PR 0.2 (SYC-245, links out to map companies). The plan lists no 0.2 status and no ticket. That also matters for the welfare-alert 50 m link-stripping.
   *Fix:* state 0.2's status and add it to Wave 1 or the "in flight" table.

5. **Major. Email capture is cut first, but SYC-42 Slice 3 is a must-launch item that needs the same verification model, and the plan hand-waves the build order.** The plan's "must launch" list includes the reporter's acknowledgement email (SYC-42 Slice 3), which is built by a different session. SYC-42 plan line 166 says "whichever of SYC-3 Slice 1 and SYC-42 Slice 3 is built first creates [the tables], to SYC-3's design". The plan says the tables "already exist" via `0012_keep_my_spots_safe.sql`. They do (`email_consent_events`, `email_contacts`, `email_suppressions`, `mail_requests`, `mail_tokens`). But 0012 has no `mail_deliveries`, and the bounce webhook, the "news." identity and the F7b "is this you?" verification are not built. The plan's row 4 (SYC-45 "if any" migration) admits it does not know. So there are two consent/verification builders (42-S3 now, 45 later) and no stated rule for who owns the shared code. If Slice 3 builds a verification flow, cutting SYC-45 does not remove the consent screens. Slice 3 also needs `news.catspotters.com` verified in Resend (SYC-42 plan line 389), a prerequisite the plan never mentions.
   *Fix:* declare 42-S3 the owner of verification, consent and suppression. Say that email capture (SYC-45) is only the "ask" screens plus the nightly job. List `news.` DNS/Resend verification as a Wave-0 probe, which Claude can do through the Cloudflare API.

6. **Major. The `likelyGate` item is described correctly but its conditions are not actually verified.** The plan says "flip once the three conditions in `likelyGate.ts` are confirmed live". The constant is `LIKELY_STERILISED_PUBLIC_LIVE = false` (`likelyGate.ts:33`). The conditions are PR 8 endpoints live, SYC-103 hand-off, and a SYC-43 screen. The plan's own table marks SYC-43/103 Done but never lists PR 8's correction endpoints. The file's comment also says no `ear_tip` observations exist unless PR 7 shipped. The plan is also inconsistent on SYC-75: "In Progress" in the status table, a Wave-2 task in the schedule, and absent from "must launch" and from the cut line.
   *Fix:* either list it as a launch item with its three verified checks, or say plainly that "Likely" stays hidden at launch.

7. **Major. Missing launch blockers.** `docs/DEPLOYMENT.md` lines 25–26 and the checklist (A/B) require things the plan only partly covers:
   - A **support page** and a **support URL** are required at store submission (`DEPLOYMENT.md`, "Privacy policy + support page"). The plan lists only the privacy policy.
   - **Apple nutrition labels, Google data-safety form and age-rating questionnaires** are mentioned in one sentence but have no owner, no date and no row in the critical path.
   - **Permission strings in three languages** (Apple rejects vague ones), store **screenshots ×3 languages**, **icons/splash**, and the **Android Google Maps API key** are listed in DEPLOYMENT but absent from the schedule beyond "build profiles".
   - The privacy policy spec says the policy must be at `catspotters.com/privacy`, "linked from every ask screen, every email, and the store listing". It also requires a **signed DPA with Resend** and a verified-by-test deletion check (`privacy-policy.md:51`), and **Syros Cats named as controller**. The plan has the controller wording but not the DPA or the deletion test.
   - **Bundle id**: DEPLOYMENT says "unset today / e.g. `au.fairshake.catspotters`", but `app.json:18,21` shows `com.syroscatspotters.app`. D2's "keep it" is fine, but the entity choice (Fair Shake vs Samuel personally) drives the Play 14-day rule and is not a decision in the plan.
   - The **sign-in Worker origin** (SYC-191) is a single bullet on Thu 29; any failure there locks staff out on launch day with no prior test on the new hostname.
   *Fix:* add the above to the critical-path table with owners.

8. **Major. Dates are optimistic, and the copy freeze leaks.** The freeze is Thu 22, but the build list on the plan's own critical path still includes things that create copy after 22 Oct: SYC-44 6.1/6.2 (reason sheet, confirm step, all the strings), 7.1 (dashboard strings, English-only until SYC-53 1.0), and the email-capture slices ("Wave 2, remaining slices"). Johnny reviews 23–27, so any string finished after Thu 22 misses him. The plan's own fallback ("launch with English for the rest") is the likely outcome for the "Report an issue" confirm step, which is the most sensitive wording (it says "hidden for everyone until reviewed"). SYC-44 6.2 also depends on 5.1, which depends on 4.2 and the publish chain (item 3), so 6.2's text will not exist on 22 Oct.
   *Fix:* move the freeze to match the dependency chain, or pre-write all SYC-44 copy (it exists in spec §2/§4) into Johnny's pack by 22 Oct and tie later UI to those keys only. Add "no new strings after 22 Oct" as a PR rule.

9. **Minor. 16 days with one merger.** "20 PRs merged in 3 days" is a rate achieved while Samuel was approving docs and plans. This schedule needs about 30 build PRs plus two Git-pane pulls per publish. There is a risk row for it, but no number.
   *Fix:* state expected merges per day and the batching windows.

10. **Major. Turnstile secret, hostname and observe-to-enforce mechanics are right, but the plan misses two traps.**
    - `DEFAULT_HOSTNAMES = ["apptest.catspotters.com"]` (`turnstile.ts:44`). The plan covers the hostname list, but "observe" mode checks on Thu 29 happen on the launch hostname only if DNS and the Turnstile widget for `app.catspotters.com` exist by then. D3 sets Fri 16 for the decision but Thu 29 for "address live", leaving the first end-to-end check on the new host on the day before launch.
    - If the secret is missing when the gate goes off, the code answers 503 to **every** public report (`turnstile.ts:237`). The "Thu 29" paste has no earlier dry run; Claude cannot write Replit secrets. The plan's "one clear day" is the only buffer.
    *Fix:* paste the secret and run an observe-mode check by Mon 26, not Thu 29.

11. **Major. The spec deviation on §2.6 is understated.** Spec §2.6 (`PRODUCT-SPEC.md:67`) promises "feeding-site map (private by default, per-site public toggle)" inside the MVP. The plan's status table says "After launch by the approved SYC-209 plan (Slice 6)" and nothing more. The scope line at the top claims "the full MVP in §2". Those cannot both be true. It is a deliberate, approved deferral, but a reader skimming the scope line is misled.
    *Fix:* add one explicit line in "Scope" and "The short version": "Per-site public toggle is promised by spec §2.6 and is deferred to after launch by the approved SYC-209 plan." Put it in the first screen of the document.

12. **Minor. Cut order is coherent but incomplete.** The agreed order (email capture, then the rest of the feeding-site map) is correctly preserved. But cutting SYC-209 3.3/3.4 leaves 3.2 as a read-only map with no way to add a site, so the "private feeding-site map" the team uses at launch is empty. The plan should say this: it is a UX fact, and it undercuts the Syros Cats staff value of the map. Cut 3 (10 facts) also contradicts "~20 starter facts" in spec §2.2 without citing the spec line.

13. **Major. Model delegation fails the standard in four places.**
    - "Clear-plan build PRs … Sonnet" bundles SYC-170 1.3 (a WebView/Turnstile security path on real phones) with ordinary PRs. The SYC-44 plan calls the Turnstile path high-risk. Either move 1.3 to Opus or name a mutation probe for "navigation outside the allowed list is refused" (T1-15).
    - "SYC-75 flip", a one-line constant that changes what the public sees about sterilisation, is Sonnet with generic CI. A wrong flip is a public-data error and needs a named live probe.
    - The "Opus builder" row for silent-failure PRs says "plan's named mutation probes" but gives none of its own, and the Opus escalation is justified only by "a wrong-but-green result". The plan's Opus review rows need a concrete named probe per item (for example "report without token → 428, no row").
    - "Match-wait spec: Opus, one each" and "email-capture plan: Opus" give a justification but their Sonnet adversarial reviews have no named assurance beyond "Samuel approves".
    - The "Greek and French drafts: Sonnet" row relies on Johnny, and the plan's own risk row says Johnny might be unavailable. The fallback is "English for the rest", which the delegation row does not mention.
    - The Haiku row's assurance ("spot check by the session model") names no sample size or criterion.
    *Fix:* add one named probe or test to each row; move 1.3 and the SYC-75 flip up a tier, or justify why not.

14. **Minor. Plain English and canonical-facts check.** Mostly good. Jargon a charity reader will not parse: "observe mode", "enforce", "migrate before publish", "Git-pane pull", "db-ops", "siteverify" (not present), "hostname list", "proxy hops (SYC-229)", "D-U-N-S". Replace or gloss in the first mention. No violations found of €50–60 (the plan only says "€50–60 copy"), "cat guardian" or "spotter"; no offline overclaim, though "Works on any phone" and the QR-at-Kini line should not imply offline use (D1 table already notes weaker offline).

15. **Minor. Stale or unverifiable references.** The header says an adversarial review file `mvp-launch-31-oct-review.md` exists "beside this file"; the closing section is a placeholder "(Filled in after the review.)". The "session list" evidence for in-flight work (PR 4.1, 1.2, 42-S3) is not checkable from the repo; mark **unchecked** where it is. The claim "20 pull requests merged in the last three days" is plausible from `gh pr list` (about 28 merged since 14 Oct 02:59) but is not sourced in the plan.

16. **Minor. Missing explicit gate-off checklist items.** SYC-44 plan Rollout step 6 lists four preconditions for `PRELAUNCH_GATE=off`: enforce live on both forms, Slice 2 live with the one-instance pin lifted or deliberately kept, SYC-130 Task 4 live, and SYC-114's step 0 (blurring live). The plan's "Saturday 31 Oct" paragraph and cut line mention the first and third. The second and fourth are scattered or absent. Collect all four into one launch-day checklist with a probe per item.

---

## What happened to each finding

Each finding was checked against the source before it was accepted. Two were wrong in part.

| # | Accepted? | Checked against | What changed in the plan |
|---|---|---|---|
| 1 | **Partly.** No store or TestFlight build has ever been made (no `eas.json`), so no tester has a phone build to break; testers use the website. But the rollback point is right: with the pass off, Turnstile always refuses, and the only way back is turning the pass on again (`turnstile.ts:219`) | `turnstile.ts:212-221`; `ls artifacts/cat-spotter` | Launch-day checklist says how to roll back. Store builds must carry PR 1.3 (store-release blocker), stated plainly |
| 2 | Yes | SYC-44 plan order table | New decision D5: ship 6.2 on the website before 1.3, or hold it. Recommendation given |
| 3 | Yes | SYC-44 plan :294 | Publish calendar added, with each PR mapped to a slot |
| 4 | **No.** PR 0.2 merged as #125 (`e982618`, "SYC-245 … (SYC-209 PR 0.2)") | `git log origin/main` | Status table now names 0.2 as merged, so 3.4's dependency is met |
| 5 | Yes | SYC-42 plan :166, :232, :389 | SYC-42 Slice 3 owns the "is this you?" check, consent and suppression; SYC-45 is the asking screens plus the nightly job. `news.catspotters.com` checked in Wave 0 |
| 6 | Yes, and resolved | Data spine PR 8 (#68), corrections screen (#99), SYC-103 Done, ear-tip question SYC-37 Done | SYC-75 flip is a launch item, after a check on the live build, with a named probe |
| 7 | Yes | `docs/DEPLOYMENT.md:25-26`; `privacy-policy.md` | New "store release" checklist with owners and dates: support page, privacy labels, data-safety form, age rating, permission wording, screenshots, map key, Resend data agreement, deletion test |
| 8 | Yes | SYC-44 spec §2, §4 hold the English | All "Report an issue" words go in Johnny's pack from the spec on 22 Oct; a PR rule: no new visitor-facing words after 22 Oct without a flagged second pack |
| 9 | Yes | `gh pr list --state merged` | Merge budget stated: about 30 PRs, two merge windows a day |
| 10 | Yes | `turnstile.ts:44`, `:237` | Secret pasted and checked through `/api/healthz` by Mon 26; launch address end to end by Tue 27 |
| 11 | Yes | `PRODUCT-SPEC.md:67` | Called out in the scope line and the short version |
| 12 | Yes | `PRODUCT-SPEC.md:49` | Cut 2 says the team's map starts empty; cut 3 cites the spec |
| 13 | Yes | the plan-model-delegation standard | PR 1.3 moved to Opus with mutation probe T1-15; SYC-75 flip gets a live probe; every row names its probe |
| 14 | Yes | — | Plain-English glossary up front; jargon reworded |
| 15 | Yes | `list_sessions` 15 Oct | Closing section filled; in-flight work sourced to the session list |
| 16 | Yes | SYC-44 plan, Rollout | One launch-day checklist, four conditions plus the rest, a probe for each |
