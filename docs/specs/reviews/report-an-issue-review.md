# Adversarial review: "Report an issue" on every cat and photo

**Target:** [docs/specs/report-an-issue.md](../report-an-issue.md) v1.0 draft (7 Oct 2026), draft PR #111. Covers SYC-44 and SYC-170.
**Reviewer:** independent adversarial pass, 11 October 2026.
**Checked against:** `team-access-and-welfare-queue.md` (approved, owns §6), `DECISIONS.md` (Parts 2b, 2e, 2f, 2j, 2k), `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md` (PR 5 and PR 6), `email-capture.md`, `privacy-policy.md`, `cat-record-data-spine.md`, `hosting-and-photo-storage.md`, `choose-a-different-cat.md`, the roles spec on `origin/claude/syc-53-roles-spec` (`roles-and-invites.md` §6.2), the claiming-a-cat review on `origin/claude/syc-130-claim-spec`.
**Live code read on `origin/main` (8c36f63):** `lib/db/src/schema/welfare.ts`, `routes/reports.ts`, `lib/welfareActions.ts`, `lib/welfareTie.ts`, `lib/welfareQueue.ts`, `lib/resolve.ts`, `lib/deviceAuth.ts`, `middlewares/newDeviceLimit.ts`, `middlewares/apiCors.ts`, `middlewares/prelaunchGate.ts`, `routes/photos.ts`, `lib/mail/send.ts`, `lib/mail/outbox.ts`, `app.ts`, `artifacts/cat-spotter/server/serve-web.js`, `artifacts/cat-spotter/lib/reportQueue.ts`.
**Cloudflare docs read today:** Turnstile server-side validation, mobile implementation, hostname management.
**Linear read:** SYC-44, SYC-170, SYC-105, SYC-114, SYC-150, SYC-231, SYC-232, SYC-246, SYC-247, SYC-248.

**CONFIRMED** means checked against code, a document or Cloudflare's docs. **PLAUSIBLE** means judgement.

---

## Summary

The spec is careful, and its central idea is right: the hide is written in the same database step as the report, and email only tells people about it. Most of what follows is about the edges. The serious problems are these:

- **The "unchecked" path on the welfare form makes Turnstile decorative for the welfare queue.** A script that never sends a token gets every report accepted.
- **The Turnstile hostname plan points at the wrong website.**
- **Issue alerts would share the "never drop" status of welfare alerts**, so a flood of issue reports can use up the email allowance that hurt-cat alerts need.
- **Nothing stops a mass hide** except a banner, and a hidden photo can stay in caches for a year.
- **Guardians would see issue reports** through the team cat page.
- **Several changes to approved specs are not marked as amendments.**

| # | Finding | Severity | Status |
|---|---|---|---|
| B1 | The "unchecked" fallback (D11-B) lets any script skip Turnstile on the welfare form. The draft endpoint skips it as well. | **Blocker** | CONFIRMED |
| M1 | The Turnstile hostnames are wrong: the app is served at `apptest.catspotters.com`, not `catspotters.com` | Major | CONFIRMED |
| M2 | Issue alerts would ride the never-shed `welfare_alert` purpose and could starve welfare alerts | Major | CONFIRMED |
| M3 | No global circuit breaker on report-hides, and the "hidden" message isn't tied to what the server did | Major | CONFIRMED (design gap) |
| M4 | A hidden photo is cached `public, max-age=31536000, immutable` | Major | CONFIRMED |
| M5 | Guardians can read issue reports via the team cat page strip; `view_welfare_queue` is missing | Major | CONFIRMED |
| M6 | `edit_cat_text` and `remove_photo` aren't in the roles catalogue, and `edit_cat_text` is too broad | Major | CONFIRMED |
| M7 | What happens to the token at send time is unclear, so §8.1(i) can't be tested. A blip can also lock a real privacy report out of ever hiding. | Major | CONFIRMED |
| M8 | Reusing `welfare_reports` breaks more than the spec lists (photo state, the live tie, evidence of life, the shared resend key) | Major | CONFIRMED |
| M9 | Changes to approved specs that aren't marked as amendments (hosting §6.5, email-capture, closing email, reason list) | Major | CONFIRMED |
| M10 | Canonical-fact breach: "Nothing here is built" and a built/not-built split throughout | Major | CONFIRMED |
| m1–m14 | Smaller gaps, stale facts and untestable lines | Minor | mixed |

---

## Blocker

### B1. The "unchecked" fallback lets any script skip Turnstile on the welfare form (§9.5, D11, §8.1)

**What the spec says.** If a welfare report arrives with no valid token, accept it anyway, tag it "unchecked", and cap individual alert emails for unchecked rows at about 10 an hour **in total**. Then roll the rest into one "N unchecked reports waiting" line.

**Why it breaks.** Whether a token is present is up to the sender. Under option B, a script that never sends a token gets **exactly what a real user gets: an accepted row in the welfare queue.** The only thing Turnstile still protects is the inbox. The queue, which the welfare spec calls "the scarcest resource in this entire system" (§4.4), gets no protection. The ticket says Turnstile should be checked "before a report is accepted", and option B drops that.

**How it fails.**
1. A script on 30 home-broadband proxy addresses posts 10 `urgent` reports an hour from each (the per-address limit). It sends no token.
2. All 300 an hour are accepted. The queue sorts urgent first (`welfareQueue.ts` sorts on `severity = 'urgent'` first), so they sit at the top of "Waiting for the team", above every real report.
3. The script sends the first 10 unchecked rows each hour, so it uses up the shared cap of 10 alert emails. A real tourist whose WebView failed (the case option B exists for) then gets no individual alert. Their report becomes a number in a summary line.
4. **The draft endpoint skips the check altogether.** `POST /api/reports/draft` (`routes/reports.ts`, 60 an hour per address) writes rows that show in "Started but not sent", and the spec never mentions it. The photo upload (`PUT /reports/:publicId/photo`) is tied to the device and the report, so it is safe, but the spec should say so.

**There is also a client trap the spec misses.** `reportQueue.ts` marks a report `failed` after "the server refused the text three times". So option A as described (a plain `403`) would also cause harm: after three refusals the report stops retrying. That is the real reason option A "can lose a report", and it can be fixed.

**Fix (replaces D11 for both forms).** Separate two cases:
- **The server could not reach Cloudflare** (siteverify timed out, or answered 5xx). The server sees this itself, so the client can't fake it. Accept the report as "unchecked". An issue report in this state is queued but never hides.
- **The token is missing, wrong, expired or already used.** The client controls this. Answer with a **distinct, retryable status** (for example `428 challenge_required`). Don't count it towards the three-strikes `failed` rule. The app keeps the report on the phone, as it already does, runs a fresh challenge and sends again. The reporter has already seen the vet-first advice before sending, so they lose nothing at the moment of sending. The existing 24-hour reminder covers a phone where the challenge never works.
- Unchecked rows (which are now only the Cloudflare-outage case) go **in their own list below the checked ones**, never in the urgent-first ordering. They get their own per-address limit, much lower than 10 an hour.
- **Drafts:** either need a token too (the managed widget can re-run silently for the submit), or accept drafts without a token at a much lower cap and show them collapsed. I recommend the token.
- Add tests: a request with no token gets 428 and creates no row; a siteverify timeout creates an unchecked row; the draft route follows whichever rule is chosen.

---

## Major

### M1. The Turnstile hostname plan points at the wrong website (§9.4 option A, the "Hostnames to allow" line, §13)

**CONFIRMED.** The web app and the API are one Replit deployment served at `apptest.catspotters.com`. The evidence: `DEFAULT_PUBLIC_APP_ORIGIN` in `lib/keepSafe/links.ts`, `docs/research/syc-113-replit-login-wall.md`, and the smoke `base_url` in the runbooks. `serve-web.js` serves that host. `catspotters.com` itself is the separate public site in the `catspotters-website` repository. So "a `/_challenge` route in `serve-web.js`" would serve `apptest.catspotters.com/_challenge`, not `catspotters.com/_challenge`.

Cloudflare's hostname-management page says **"adding a hostname automatically authorizes all of its subdomains."** And siteverify returns the hostname the challenge actually ran on. That has two effects:
1. A strict server check `hostname === "catspotters.com"` would refuse every real token, which all come from `apptest.`. Under the spec's own fallback rules, every issue report would then quietly stop hiding and every welfare report would become "unchecked". Nothing would visibly break.
2. Listing `catspotters.com` on the widget also authorises `team.`, `admin.`, `api.` and any future subdomain. That is broader than "only our challenge page".

**Fix.** Keep a separate list of exact expected hostnames on the server: `apptest.catspotters.com` now, plus the launch hostname once it's chosen. Note that the launch domain for the web app is not decided in any document I could find, so record it as a dependency. Add a test that a token whose `hostname` is `team.catspotters.com` is refused. The spike in §9.6 step 1 must check the exact hostname string a token from the WebView reports.

### M2. Issue alerts would share the never-shed welfare alert purpose (§5.2)

**CONFIRMED.** `send.ts` puts `welfare_alert` in `NEVER_SHED_PURPOSES`. Welfare spec §2.10 says Resend's limits apply to the whole account, and the priority budget exists so that welfare alerts are "never shed". The spec sends every issue alert through `welfare_alert`. Paid solving services can beat Turnstile cheaply (PLAUSIBLE: commercial solvers advertise Turnstile at about the price of a reCAPTCHA). So a few thousand issue reports with valid tokens (20 an hour per address) turn into a few thousand never-shed sends. They can use up the account's daily allowance on the same day a real urgent cat report needs it.

**Fix.** Give issue alerts their own purpose (for example `issue_alert`) that sits **inside** the shed order, before acknowledgements. Send individual emails only for "Photo hidden" alerts, capped per hour. Everything else goes into a digest. A test should show that 500 issue alerts in an hour cannot delay a `welfare_alert`.

### M3. No global circuit breaker on hides, and the "hidden" message isn't tied to the server's answer (§8.1, §8.3, §4.1 step 6)

**How it fails.** Each address may hide 5 photos an hour and 15 a day. A vandal renting 200 home-broadband addresses (cheap; `ipKeyGenerator` groups IPv6 by /56, which doesn't help against IPv4 proxies) can hide **3,000 photos a day**. That is plausibly the whole catalogue. Rule (ii) stops re-hiding after a restore, but the team must still restore each photo by hand, one tap at a time. The "volume banner" in rule (iii) tells the team but stops nothing. §8.3 calls this "bounded by the number of different photos and addresses", and for a catalogue this size that bound is the entire catalogue.

**Second problem.** Several rules can stop a hide-type report from actually hiding: the per-address limit, rule (ii), no token, and (with the fix below) the breaker. §4.1 step 6 still chooses the message by **reason** ("For a hide: 'The photo is hidden…'"). A privacy reporter who hits any of those rules would be told the photo is down when it isn't. That is the overpromise the spec rightly avoids for offline sends.

**Fix.**
- Add a **rule (iv): a global breaker.** Once report-hides in a rolling 24 hours pass a threshold (suggest 20; Samuel's call), new hide-type reports are queued but don't hide. The dashboard banner then has a "resume automatic hiding" button for a team member. Each report keeps its "Hidden, waiting for you" priority.
- Make the response carry `hidden: true|false`, and **choose the confirmation message from that field**. Add a test for each refusal reason: limit, rule (ii), breaker, unchecked.
- Define rule (ii) exactly: "the photo has **any** `restore` row in `photo_visibility_events`". Add a test that a later team **hide** followed by a restore keeps it protected.

### M4. A hidden photo can stay in caches for a year (§6 "What hiding does not cover", §1)

**CONFIRMED.** `routes/photos.ts` serves public photos with `Cache-Control: public, max-age=31536000, immutable` once the pre-launch gate is off. A 404 from the server doesn't clear the copy a browser, the app's image cache or any shared cache has already stored. Whether `api.catspotters.com` sits behind Cloudflare's proxy is "not recorded" (§8.2, SYC-229). If it does, the edge keeps serving the hidden photo to **anyone who has the address**, not only to people who already saw it, for up to a year. §6 mentions phone caches and screenshots, but not this, and it is the part that matters for a face or a front door.

**Fix.** Choose one and say which in the spec. (a) Cut the public photo lifetime to something short (for example a day, with no `immutable`), accepting more load. (b) If the API is proxied, purge the photo's address from the Cloudflare cache when it is hidden (the wrangler token exists), with a probe test. (c) Give the photo a new public id when it is hidden or restored, so the old address is dead everywhere. Option (c) is the most robust, and `publicPhotoUrl()` already owns building addresses. Whichever is chosen, the privacy policy should say it.

### M5. Guardians would see issue reports, and `view_welfare_queue` is missing (§5.3, §5.4, §13)

**CONFIRMED against the roles spec.** In `roles-and-invites.md` §6.2, guardians hold `view_exact_location` for their **own** colonies, which opens the team cat page. Only staff and management hold `view_welfare_queue`, which covers "the welfare queue, welfare reports". §13 adds a "Reports about this cat" strip to the **team cat page**. As written, a guardian opening a cat in her own colony would see issue reports about it: the reason, the reporter's note, and whether contact details were left.

**How it fails.** A neighbour reports `location_revealing` because a guardian's home description names her own house. The guardian then reads the neighbour's note on the cat page. That is exactly the reporter leak §10 promises can't happen ("a cat's owner, a guardian… is never told who reported it").

**Fix.** Put the strip, the Issues section, the issue alert links and the team route that serves a reported photo behind `view_welfare_queue`. Add those rows to the capability table in §5.4. Add the strip to the roles spec's route-walk test (§6.4 there): a guardian with that cat in her colony sees no strip.

### M6. Capability names clash with the roles catalogue (§5.4, D5, D6)

**CONFIRMED.** Roles spec §6.2 says: "a spec that needs a power not in this table adds a row here first." Checking each name:

| Name in this spec | In roles §6.2? | Verdict |
|---|---|---|
| `hide_photo`, `restore_photo` | Yes (island-only, staff and management) | OK |
| `rename_cat` | Yes | OK |
| `set_life_status` | Yes (placed; guardians hold it for their own colonies) | OK, but the issue row that leads to it is island-only (M5) |
| `view_exact_location` | Yes (placed) | OK for "open the cat's page" |
| `change_report_state`, `add_team_note` | Yes | OK |
| `view_welfare_queue` | Yes | **Missing from this spec** (M5) |
| `edit_cat_text` (D6) | **No** | Add a row first, and **narrow it**. As named it suggests editing any text on a cat, which would overlap `rename_cat` and SYC-2's `set_appearance`. Suggest `clear_home_description`, island-only. |
| "new" for delete (D5), `remove_photo` in D5 option B | **No** | Add a row in roles §6.2 if adopted; island-only, and probably management-only because it can't be undone |

There is also a dependency. The owner can rewrite `homeDescription` at will (`PATCH /cats/:id`, per the claiming-a-cat review, finding F3). That review recommends making the description visible only to the owner and the team. If SYC-130 adopts that, half of `location_revealing` goes away and D6's new action may not be needed. If it doesn't, clearing the text is undone the next time the owner edits. So D6 should depend on SYC-130's answer and say so.

### M7. What happens to the token at send time is unclear (§4.2, §8.1(i), §9.5)

§4.2 says a queued report "does not hold a Turnstile token. §9.5 says what happens at send time". But §9.5 never says whether the app **runs a fresh challenge when it sends from its queue**. §8.1(i) talks about "an offline-queued send with no fresh token", which suggests fresh tokens are possible. §9.5 gives "the report was sent hours later" as a reason a token is *missing*, which suggests they aren't. The two readings lead to different results: most offline privacy reports hide, or none do. Test 10 can't be written until this is settled.

**A related trap (CONFIRMED in design).** The unique key on `(reporter_device, client_ref)` means a resend returns the first row. Suppose the first send arrives during a Cloudflare blip. It is recorded as unchecked and doesn't hide. The phone's later resend with a valid token is deduplicated and also never hides. A real privacy report is then stuck until a person reads it, and the app has no way to fix that.

**Fix.** State that each send from the queue runs a fresh challenge in the foreground (the queue only sends while the app is open). If that fails, it gets B1's retryable answer. Check for a duplicate **before** verifying the token. If an existing row is unchecked, not yet decided and the photo has never been restored, a resend of the same `clientRef` with a valid token may **upgrade** it to a hide. Name a test for each path.

### M8. Reusing `welfare_reports` breaks more than §5.1 lists (D1, §5.1, test 6)

All CONFIRMED against `main`:
- **`photo_state` defaults to `'pending'`.** A content row left at the default shows "Photo still uploading" on the queue. Any reuse of the welfare alert's "wait 10 minutes for the photo" logic would also delay the email. Content rows must be written with `'none'`. (The reported catalogue photo is a `photos` row, which is a different thing from `photo_state`.)
- **"Which cat is this?" (PR 5) is live** (#108, `welfareTie.ts`). The spec says "PRs 0 to 4 are on main". Tying writes a `welfare_report` observation. `resolve.ts` lists `welfare_report` as a source of **evidence of life** (`EVIDENCE_SOURCES`). So if a `cat_died` issue row were tied to a cat, it would push that cat's "last evidence of life" later, the opposite of what the report says. The tie must not be offered on content rows. Add a test that **no `welfare_report` observation is ever written for `kind = 'content'`**, alongside test 6.
- **`welfareActions.ts` writes a `welfare_outcome` whenever `catId` is set** and the report closes. Content rows have `cat_id` set from the moment they're written, so every closed issue would write one. Test 6 catches this. Note that the guard has to go into live code, not a future PR.
- **The resend key `(reporter_device, client_ref)` is shared by both kinds.** If an issue report's `clientRef` matched a welfare report's from the same device, the server would answer "already sent" with the welfare row's id, and the issue would be silently dropped. The odds are small with random ids, but the check should include `kind`.
- **The mail-failure banner** (`welfareQueue.ts`) counts `purpose = 'welfare_alert'`. Moving issues to their own purpose (M2) means the banner query has to count both.
- **Retention.** A three-year welfare deletion job and D12's one-year issue rule can't share a job that ignores `kind`.
- **Making `lat`/`lng` optional** is an `ALTER` on a live table with a new check constraint. The plan needs a rollback block that keeps the welfare rows' guarantee.

### M9. Changes to approved specs that aren't marked as amendments (header, §12)

The header says the spec amends the welfare spec "in four places", and marks D2, D3, D4 and D11. These further changes also contradict approved text without being marked:
1. **`hosting-and-photo-storage.md` §6.5 (approved 28 Sep)** says the photo-removal path "arrives in the same window as the 'Report an issue' flow" and gives its contract: one database write, degrade gracefully, record who, when and why. D5 recommends hiding only in v1 and treats deletion as new design. That is an amendment to an approved spec and needs Samuel's explicit yes, or D5 should adopt the contract that already exists (see the decisions table).
2. **`email-capture.md`'s closed list of asks** and **`privacy-policy.md`** ("we… ask at four moments: after you've spotted a cat, at the end of a visit, after you've reported a cat in trouble, and in Settings"). An email box on Report an issue (§4.1 step 3, D9) is a new place where people are asked for an email. It amends both.
3. **The closing email.** DECISIONS Part 2b approves fixed wording for both closing states: *"Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive."* §7 proposes different wording. Either use the approved text or mark this as an amendment.
4. **The reason list.** Approved welfare §6 lists *"wrong information about this cat"* as a reason. Approved `choose-a-different-cat.md` relies on it: wrong colours "are corrected through Report an issue (*wrong information about this cat*)", and R1's "Think this cat is alive? Tell Syros Cats" opens Report an issue with the photo. This spec drops that reason into `other` and gives R1 no entry point. Either add a `wrong_info` reason (and a "this cat is alive" path for R1), or mark the change and update that spec.

### M10. Canonical-fact breach: the spec splits "built" from "proposed"

Project rule: specs are aspirational, with no "built today vs proposed" split. The spec breaks it in several places:
- Status line: **"Nothing here is built."**
- §2 "(live, SYC-43 PR 4)" ×2 and "(live, PR 4)".
- §5.4 "Everything here exists or is already planned"; the "Where it comes from" column ("PR 4, live", "SYC-150, not built", "Not built (decision D6)").
- §8.2 heading "…and what is not true yet"; §8.1 "the hide limit must be in the shared store from the start".
- D13 "which is not built yet. PRs 0 to 4 are on `main`" (also stale; see M8).

**Fix.** Describe the product as one whole. Move build order and dependencies (PR 6 first, SYC-105 before launch) into §13 and the implementation plan, phrased as order of work rather than "what exists".

Checked and clean: "cat guardian" is used, never "colony carer". There is no sterilisation figure. "Spotter" is used correctly. The two audiences are described as complementary.

## Minor

- **m1.** D13 says "PRs 0 to 4 are on main". PR 5 is merged too (#108).
- **m2.** The precondition belongs on the launch-day `PRELAUNCH_GATE=off` step. SYC-114 is the code deletion *after* launch (§9.6, §8.2, §16).
- **m3.** "Hidden WebView": in managed mode Turnstile sometimes needs a tap. The spec must show the WebView when Cloudflare asks for one, and set a timeout and a fallback, or the send hangs.
- **m4.** The Turnstile claims match Cloudflare's docs:
  - tokens last 300 s and work once;
  - siteverify returns `hostname` and `action`;
  - the mobile requirements are as stated;
  - the docs say nothing about inline HTML.

  Missing: siteverify also returns `cdata`. Bind it to `clientRef` so a token can't be moved to another report. Also reject tokens longer than 2,048 characters.
- **m5.** The "unchecked" daily digest needs a scheduler that doesn't exist, because the drain runs every 3–7 hours (SYC-231). Either show only a count on the dashboard, or add a once-in-24-hours guard to the drain.
- **m6.** "One report per photo, per reason, per device, every 24 hours" is only a courtesy, because anyone can make a new device for free. Say so. Also define what a repeat sender is told when the first report hid the photo.
- **m7.** Issue reports allow 20 an hour per address and welfare reports 10, on separate limiters, so one address gets 30 combined. Consider a shared ceiling.
- **m8.** §10 says the IP is "used for Cloudflare's check". Sending `remoteip` to Cloudflare is optional, and it is personal data going to a processor. Decide whether to send it, and record the decision under SYC-248.
- **m9.** "Reported by a spotter" is wrong for a tourist with no account. Use "reported by a member of the public".
- **m10.** Some wording can't be tested:
  - "2 others reported this photo" when "the same photo or cat-and-reason" has open reports (define what counts as the same group);
  - "visually distinct";
  - "some hours' delay".
- **m11.** Moving a sighting to another cat (SYC-150) must keep the photo's id, or rule (ii)'s restore history is lost. (Noted on SYC-150.)
- **m12.** The hint for `photo_private` lists "a doorway". Almost every street photo on Syros has one, so this widens the reason most likely to be abused. Consider "faces, house numbers, number plates, inside a home or garden".
- **m13.** Privacy policy: the line "the report and what you wrote in it stay with the cat's record" conflicts with D12, which deletes the note after a year. Update it under SYC-248.
- **m14.** On the website, "Saved on your phone" is wrong; it should say "saved in this browser". Browsers may also clear stored data (Part 2f R1). The offline copy should say both.

## D1–D13: agree or disagree

| Decision | Verdict |
|---|---|
| D1 (A, use the existing table) | **Agree**, provided every M8 item is done. |
| D2 (B, privacy reports hide too) | **Agree**, but only together with M3's global brake and m12's narrower hint. |
| D3 (B, three extra safeguards) | **Agree, and add rule (iv)**, the global brake. Define rule (ii) as "the photo has any restore row, ever". |
| D4 (A, hidden for everyone but staff, with a neutral tile) | **Agree.** It matches PR 6. |
| D5 | **Disagree as framed.** Approved hosting §6.5 already promises removal in this window and gives the contract. Recommend B, narrowly, before launch: on a hidden privacy photo only, a confirmed, management-only removal under hosting's contract, which also stops the photo being used as a matching reference. Or keep A, but mark it as an amendment to hosting §6.5 for Samuel's explicit yes. |
| D6 (A, the team acts by hand) | **Agree with conditions.** Narrow the capability and add it to roles §6.2 first. Wait for SYC-130's decision on whether the home description is public at all. |
| D7 (A, the team decides on deaths) | **Agree.** Also forbid tying a `cat_died` row to a cat (M8). |
| D8 (B, a larger photo view with the link beneath) | **Agree.** |
| D9 (A, closing email only to a verified address) | **Agree in substance.** Mark it as amending email-capture and privacy-policy, and use Part 2b's approved closing wording. |
| D10 (A, a WebView on our own challenge page) | **Agree**, with M1's hostname correction, m3's visible sheet with a timeout and fallback, and a spike that checks the exact hostname. |
| D11 | **Disagree.** Replace it with B1's split, for both forms: refuse and retry when the phone's token is bad, and mark "unchecked" only when our server couldn't reach Cloudflare. An unchecked issue report never hides. |
| D12 (A, keep one year, then drop the note) | **Agree.** It needs a retention job that checks `kind`, and the policy line fixed (m13). |
| D13 (A, build after PR 6) | **Agree.** Turnstile on the welfare form goes first, using the B1 design. |

**Recommendation changes in short:** D5 (adopt hosting's removal contract, or mark it as an amendment), D11 (replace with B1's split), and D3 (add a global brake). Conditions attach to D1, D2, D6, D9, D10 and D12.
