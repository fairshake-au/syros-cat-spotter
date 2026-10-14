# Review: SYC-44 / SYC-170 implementation plan ("Report an issue" and Turnstile)

**Target:** `docs/superpowers/plans/syc-44-report-an-issue.md` (699 lines), on `origin/claude/syc-44-plan` at `d528be6`.
**Reviewer:** independent adversarial pass (Sonnet). No sub-agents. Own worktree, own branch (`claude/syc-44-plan-review`).
**Date:** 13 October 2026.
**Spec carried out:** `docs/specs/report-an-issue.md` v1.2. D1 to D14 are final and were not argued with. Only the plan's carrying-out was tested.

**What I checked.** I read the whole plan, the spec (§2 to §13, all of D1 to D14), the spec's review, DECISIONS Part 2b, roles §6.2, hosting §6.5, the SYC-43 part 2 plan, the SYC-53 plan and claiming-a-cat D9. I then checked the plan's claims against the code on this branch (same as `main`): `routes/reports.ts`, `routes/photos.ts`, `routes/teamReports.ts`, `routes/teamPhotos.ts`, `routes/sightings.ts`, `lib/photoVisibility.ts`, `lib/welfareQueue.ts`, `lib/welfareActions.ts`, `lib/welfareTie.ts`, `lib/capabilities.ts`, `lib/mail/send.ts`, `lib/mail/outbox.ts`, `lib/severPerson.ts`, `lib/deviceAuth.ts`, `middlewares/rateLimit.ts`, `middlewares/newDeviceLimit.ts`, `app.ts`, the schema files for `welfare_reports`, `photos` and `photo_visibility_events`, migrations 0001 to 0015, and in the app `lib/reportQueue.ts`, `context/ReportQueueContext.tsx`, `server/serve-web.js` and `app/cat/[id].tsx`. I ran my own searches for every reader of `welfare_reports`, `photos.data` and public photo ids. I also probed `apptest.catspotters.com` live to check claim C1.

---

## Summary

This is a careful plan. The slice order is mostly right. The structural guards (T4-0, P6-0, T7-8) are the right idea. The twelve "spec versus code" claims (C1 to C12) are all true when checked against the code. The three decisions for Samuel are real. No canonical-fact breach (no "colony carer", no "snapper", no "built today versus proposed", no claim that the app works fully offline).

But it has **one blocker and seven majors**. The blocker is a deployment hole: Slice 4's migration swaps a unique key that the currently live code relies on, and the rollout migrates before it publishes. For the gap between those two steps, every cat-in-trouble report fails. The majors are mostly places where the plan says "every place" or "never" and the code says otherwise:

- A photo address that rotates breaks the existing lock-by-address in `setPhotoVisibility` and the team page's landing.
- The address limits would be easy to dodge on IPv6.
- One of the plan's own tests (T5-4) cannot pass as written, because the daily brake always trips first.
- A live writer on `welfare_reports` (the photo upload) was missed, and the structural guard cannot see it.
- Turnstile has no defined behaviour for a wrong secret, and nothing ties "pass off" to "Turnstile enforced".
- The privacy fix for the home description is not a launch condition.

None of these needs a design change. Each is a plan edit.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Slice 4's migration drops the unique key the live report routes upsert on; rollout migrates before publishing, so every cat-in-trouble report fails in between | Blocker | CONFIRMED (`routes/reports.ts:123,168`; `schema/welfare.ts:88`; plan Rollout step 2) |
| 2 | Turnstile has no defined behaviour for a wrong or missing secret, a `429`/error-code reply, or `off`/`observe` mode on `/api/issues`; nothing in code ties `PRELAUNCH_GATE=off` to `enforce` | Major | CONFIRMED (gap in plan; `lib/prelaunch.ts`, `reports.ts` today) |
| 3 | Rotating `public_id` breaks `setPhotoVisibility`'s lock (it locks `where public_id = …`), makes a lost race say "No such photo", and breaks the team page's landing after Hide/Restore | Major | CONFIRMED (`photoVisibility.ts:192`, `teamPhotos.ts:37-106`, `catPages.ts:572`) |
| 4 | Per-address limit keys are "SHA-256 of the address": IPv6 is not grouped by /56 as today's limits are, so every address limit is dodged by rotating inside a home IPv6 block | Major | CONFIRMED (`newDeviceLimit.ts:29-33`) |
| 5 | T5-4 and the per-address hide limit cannot be reached: five hides in an hour from one address is exactly the brake, which is checked first | Major | CONFIRMED (plan rule order, 5.1) |
| 6 | `PUT /api/reports/:publicId/photo` is a writer on `welfare_reports` the plan's sweep missed; a reporter can aim it at their own issue row. T4-0 is file-level and cannot see it | Major | CONFIRMED (`reports.ts:211-282`) |
| 7 | On `/api/issues` the token check comes before every per-address limit, so junk tokens cause unlimited calls to Cloudflare, and slowness there turns into "unreachable" and then accepted unchecked rows | Major | PLAUSIBLE (plan 5.1 steps 4 to 5; spec §13 order) |
| 8 | Decision 2 option A relies on SYC-130 hiding the home description, but on `main` it is public and pushed, and SYC-130 is not a launch-day precondition | Major | CONFIRMED (`routes/cats.ts:428`, `catHelpers.ts:165`) |
| 9 | Decision 3 leaves out the obvious option (a team "hidden for privacy" tick) and ties an irreversible button to a claim any stranger can file | Minor | CONFIRMED (plan Decision 3; `teamPhotos.ts` Body has only free-text `reason`) |
| 10 | The duplicate-send reply ("hidden as it was") has no stored value to read: a resend can say the opposite of the first answer, or say "hidden" after a restore. A same-`clientRef` race is unhandled | Minor | CONFIRMED (4.1 columns; 5.1 step 2) |
| 11 | The photo-bytes reader list for removal misses the repeat-sighting path | Minor | CONFIRMED (`sightings.ts:527-537`) |
| 12 | Order: 5.1 queues an `issue_alert` that only exists in 5.2; 7.2 needs 7.1's button but lists neither | Minor | CONFIRMED (order table) |
| 13 | "Keep hidden" has no check that the photo is still hidden, and T7-4's "exactly one event each" is wrong for it | Minor | CONFIRMED (`setPhotoVisibility` returns `already` and writes nothing) |
| 14 | The reported-photo route is the same route as the catalogue photo route; the plan never says how it tells them apart. T7-1's probe covers only the strip | Minor | CONFIRMED (`teamReports.ts:94-109`; roles §6.2 note 4) |
| 15 | The unchecked limit (3 an hour) counts drafts too, so one real report in an outage uses two of three | Minor | PLAUSIBLE (1.1 step 4) |
| 16 | Moving limits into Postgres: no stated fail mode, and a counter error would 500 the cat-in-trouble route | Minor | PLAUSIBLE (2.1) |
| 17 | Test and probe gaps: spec tests 9 and 13 only partly mapped; several silent-failure guards have no probe; no DB check that a hiding reason carries a photo; D2's narrow hint not named | Minor | CONFIRMED (test map; mutation list) |
| 18 | Model delegation: the production Cloudflare widget is given to Sonnet while "production steps" are the session model's; the limits store (the base of every abuse limit and the brake) is Sonnet with only a spot review | Minor | CONFIRMED (delegation table) |
| 19 | Two small calls drift from D12: the team note is kept for ever, and a failed digest send loses the day | Minor | CONFIRMED (small calls; 5.2) |

---

## Blocker and majors, in detail

### 1. Blocker: Slice 4's migration breaks the live report routes until the code is published

**What the plan says.** PR 4.1 changes the resend key: "the unique `(reporter_device, client_ref)` becomes `(reporter_device, kind, client_ref)`", and the rollback "puts back … the old unique key". The Rollout says: "Migrate before publish, as with every migration so far" (step 2), then Samuel publishes (step 3). It also says each PR "leaves `main` safe on its own".

**Why it breaks.** Both live upserts name the old key as their conflict target: `routes/reports.ts:122-124` (draft) and `:167-169` (submit) use `onConflictDoUpdate({ target: [reporterDevice, clientRef] })`. The index is the plain unique index `welfare_reports_device_client_ref_key` (`lib/db/src/schema/welfare.ts:88-91`). Once the migration drops it, Postgres answers `there is no unique or exclusion constraint matching the ON CONFLICT specification` (42P10). So from the moment production is migrated until the new code is live, every `POST /api/reports` and `POST /api/reports/draft` returns 500. The same hole opens again on any code-only rollback after the migration. Those are the cat-in-trouble routes, the most important routes in the app. The pre-launch pass limits who can hit them today, but the plan's own rule ("main safe on its own") is broken, and the fix is cheap.

**Fix.** Two steps instead of one.
- **4.1:** add the new unique index `(reporter_device, kind, client_ref)` and all the new columns, and **keep the old index**. The new code's `ON CONFLICT (reporter_device, kind, client_ref)` works because the new index exists, and the old code still works because the old one does. A content row cannot clash with a welfare row on the old key in practice (random `clientRef`), and no content row is written before Slice 5.
- **A small 4.2, after 4.1 is published and before 5.1:** drop the old index. Its rollback re-creates it.
- Add a test that runs the old conflict target against the 4.1 schema (the "old code still works" check).

### 2. Major: Turnstile's failure modes are not pinned down, and nothing ties "gate off" to "Turnstile on"

**What the plan says.** `TURNSTILE_MODE` is `off`, `observe` or `enforce`. `rejected` covers "`success: false`". `unreachable` is a timeout or a 5xx. Launch day is a checklist: `PRELAUNCH_GATE=off` only after `enforce` is live (Rollout step 6). 5.1 says "rejected → 428" with no word on the mode.

**Why it breaks.** Four holes.
1. **A bad or missing `TURNSTILE_SECRET_KEY` in `enforce`.** Cloudflare answers `success: false` with `missing-input-secret` or `invalid-input-secret`. The plan maps every `success: false` to `rejected`, so every real person gets `428`, the app dutifully fetches a fresh token, and every send fails for ever. The cat-in-trouble form is dead and the report is "saved on the phone" with a friendly message. Every test stays green. The only secret step is a human paste into Replit (plan, 1.0 step 2), which is exactly how a typo happens.
2. **Other Cloudflare replies are unclassified:** a `429` from siteverify, a non-JSON body, and `internal-error` (which Cloudflare documents as retryable). Each is "our side", not "the sender's choice".
3. **`off` and `observe` on `/api/issues`.** Spec §8.1 rule (i) says a hide needs a verified token. If `verifyTurnstile` returns `ok` in `off`/`observe` mode (the natural reading, since it "refuses nothing"), a tokenless request hides a photo. 5.1 and T5-2 do not say what the issue route does outside `enforce`.
4. **Launch day is a checklist, not a guard.** `lib/prelaunch.ts:29-34` is the only thing that turns the gate off, and it knows nothing about Turnstile. If `PRELAUNCH_GATE=off` goes live with `TURNSTILE_MODE` unset or `observe`, the cat-in-trouble queue is open to scripts. This is a silent failure with no structural guard, which the plan otherwise insists on.

**Fix.**
- Classify by Cloudflare's `error-codes`: `missing-input-secret` / `invalid-input-secret` / `internal-error` / `429` / non-JSON / 5xx / timeout are `unreachable` (our side) **and** log loudly (and count toward the "N unchecked" banner). Only token-shaped codes (`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate`, a mismatch) are `rejected`.
- In any mode but `enforce`, `/api/issues` never hides (it is treated as `unchecked`).
- Add a boot-time assertion beside the existing startup lines (`lib/prelaunch.ts:142`): when `gateEnabled()` is false and `TURNSTILE_MODE !== 'enforce'` or the secret is missing, refuse to start (or at minimum log an error and fail `/api/healthz`).
- A mutation probe for each: wrong secret, `429`, mode `observe` on the issue route, gate off with mode `observe`.

### 3. Major: rotating the public address breaks the existing lock and the team page

**What the plan says.** 3.1 changes `setPhotoVisibility` "inside its existing lock" to move the old id into history and set a new one. 5.1 locks "the same `for update` as `setPhotoVisibility`". T3-4: "six simultaneous hides of one photo rotate once".

**Why it breaks.** That lock is `select id from photos where public_id = ${input.publicId} for update` (`lib/photoVisibility.ts:191-193`). In Postgres, a waiting `FOR UPDATE` re-checks its `WHERE` after the first transaction commits; once the first hide has changed `public_id`, the five waiters match no row. They get `not_found`, not `already`. So:
- Two team members (or a double tap) on the team page: the loser sees "That photo doesn't exist. Nothing was changed." (`routes/teamPhotos.ts:74-90`) instead of "already hidden". T3-4 would pass (it only counts rotations) while the behaviour regresses.
- A report-hide racing a team hide, or two reports on one photo, will get "not found" at the lock if it locks by the id it was given. That is exactly the race 5.1's rules are meant to be exact under.
- After a hide or restore the team page redirects with `p=<publicId>` taken from the **request** (`teamPhotos.ts:37-40, 100-106`). The page then looks for that id (`lib/teamPages/catPages.ts:572`, `landed = v.photos.some(p => p.publicId === opts.photo)`), no longer finds it, and silently drops the "hidden / restored" notice and the scroll anchor. Nothing fails; the team just loses confirmation of what they did.

**Fix.** Resolve the id (current or retired) to `photos.id` **first**, then lock `where id = …` (and make 5.1 do the same). Return the photo's **new** `publicId` in the outcome and use it in `backTo`. Add tests: the loser of a six-way race gets `already`, not `not_found`; a stale id from a second tab gets `already`; the redirect lands on the new id; two reports on one photo racing give one hide and one `already_hidden`.

### 4. Major: IPv6 addresses are not grouped, so the address limits are easy to dodge

**What the plan says.** 2.1: "`key` is a SHA-256 of the address and a salt that changes every day." These keys hold the report limit (20 an hour), the hide limits (5 an hour, 15 a day), the unchecked limit (3 an hour), the new-phone cap and the AI limits.

**Why it breaks.** Today's limits deliberately count an IPv6 address by its /56 network and an IPv4-mapped address as the IPv4 one, "since anyone with an IPv6 connection can pick a fresh address from their block on every request" (`middlewares/newDeviceLimit.ts:29-37`, `ipKeyGenerator`). A raw hash of `req.ip` throws that protection away: one home connection can mint a fresh key per request and never meet any limit, including the 3-an-hour unchecked limit. Moving the limits into Postgres would make them weaker than the in-memory ones they replace.

**Fix.** Say in 2.1 that the key is `sha256(salt + ipKeyGenerator(req.ip))`, and test it: two addresses in the same /56 share one bucket (T2-5), with a mutation probe (hash the raw address, T2-5 red).

### 5. Major: T5-4 cannot be written as stated, and the per-address hide limit is dead

**What the plan says.** The rule order in 5.1 puts "the brake" (iv) before the "address hide limits, 5 an hour and 15 a day". T5-4: "The 6th hide from one address in an hour doesn't hide and records `address_limit` … on a day the brake hasn't tripped."

**Why it breaks.** For an address to have had five hides in the hour, there must already have been five report-hides that Athens day. That is the brake's threshold, so the brake has tripped. The sixth from that address gets `brake`, never `address_limit`. The only way to see `address_limit` first is a window that straddles midnight, which is not what the test says. As ordered, the address hide limit never fires, and T5-4 (and its probe "consume outside the transaction → red on the rollback case") cannot be built. The spec has the same gap, but the plan is where a builder will hit it.

**Fix.** Make the thresholds configuration values (brake, hides per address per hour) so a test can raise one while exercising the other. Test the address limit with the brake raised, and the brake with the address limit raised. Tell Samuel plainly that at brake = 5 the address limit is a second line that one address cannot reach alone (it matters if the brake is raised later).

### 6. Major: the photo upload is a writer on `welfare_reports` the sweep missed, and T4-0 cannot see it

**What the plan says.** Slice 4's table lists "every reader and writer of `welfare_reports`", with `routes/reports.ts` down only for "submit and draft upserts". T4-0 is "a source test [that] lists every file … that names `welfareReportsTable`", with an allowlist of files.

**Why it breaks.** `PUT /reports/:publicId/photo` (`routes/reports.ts:211-282`) selects `welfare_reports` by `publicId` and `isDraft = false`, with no `kind` filter, and only checks that `reporterDevice` matches. `POST /api/issues` hands the reporter the row's `publicId`, and the reporter has the same device, so the reporter can send a photo to their own issue row. The route then inserts into `welfare_report_photos` and sets `photo_state = 'attached'`. The migration's own check (content rows must be `photo_state = 'none'`) turns that into a 500 rather than corrupt data, but only if the check is written exactly as the plan says. A tokenless route is being pointed at a table it was never meant for. More important, `routes/reports.ts` is **already in the allowlist**, so T4-0 stays green however many routes are added to that file. A file-level allowlist is blind to new code in an allowed file.

**Fix.** Add `PUT /reports/:publicId/photo` to the sweep table with the rule `kind = 'welfare'` (a content row answers the same 404 as an unknown report) and a named test (T4-8). Make T4-0 check per query: for example, every `from(welfareReportsTable)` / `update(welfareReportsTable)` must carry a `kind` condition or a `// kind: …` annotation. Add a probe: add an unannotated query to an allowed file, T4-0 red.

### 7. Major (plausible): the token is checked before any per-address limit on `/api/issues`

**What the plan says.** 5.1 order: body and device, duplicate, courtesy, **token**, **address limit (20 an hour)**, then the work. (Spec §13 has the same order.)

**Why it breaks.** The existing welfare routes have `reportLimiter` and `draftLimiter` as middleware **before** the handler (`reports.ts:101,145`). The issue route puts its limit after the token call, so nothing in front stops a client making the server call Cloudflare once per request. Two bad outcomes: (a) unbounded outbound calls and a risk that Cloudflare rate-limits our secret, and (b) under load or a Cloudflare slowdown, requests time out and are classed `unreachable`, which the plan **accepts into the queue as unchecked rows** (limit 3 an hour per address, but it is per address, so many addresses scale it). An attacker can therefore help produce the "outage" that lets unchecked rows in. Combined with finding 2 (a `429` from Cloudflare counted as "unreachable"), this is a way to land rows without a valid token.

**Fix.** Put a cheap per-address ceiling in front of the token step on `/api/issues` (and keep it on the welfare routes), cap concurrent siteverify calls, and add a small circuit breaker on `unreachable` (after N consecutive timeouts the server stops creating unchecked rows for a few minutes and answers `503` with `Retry-After`; the phone keeps the report). Test it.

### 8. Major: Decision 2's safety net (SYC-130) is not a launch condition

**What the plan says.** Decision 2 recommends dropping `clear_home_description` because SYC-130 makes the home description "owner and team only". It admits "if SYC-130's build slipped past launch, the description would still be public … The fix then is to ship SYC-130's privacy change". The launch-day step (Rollout 6) does not list it.

**Why it breaks.** On `main` today the home description is in the public cat payload (`lib/catHelpers.ts:90,126,165,478`; `routes/cats.ts:118`) and is **pushed to followers** when a cat is claimed (`routes/cats.ts:428`). So until SYC-130's change is live, a neighbour's `location_revealing` report has no tool at all and the text stays public and pushed. The decision is presented as low-risk; the dependency is one sentence.

**Fix.** Add "SYC-130's privacy change (home note out of the public payload and out of pushes) is live" to the launch-day preconditions, and put it in Decision 2's option A as a condition, with a note that SYC-232 (the push) is also needed. If it cannot be a precondition, say so and re-ask Samuel with option B.

## Minors, in detail

### 9. Minor: Decision 3 is missing the obvious option, and its recommended rule hands the button to any stranger

**What the plan says.** Decision 3 offers A (hidden now, and someone reported it as `photo_private`), B (either hiding reason) and C (any hidden photo). It recommends A.

**Why it falls short.** The spec's D5 says "already hidden for a privacy reason". The realistic case the plan doesn't offer: a team member sees a face in a photo, hides it by hand (the form takes only free-text `reason`, `teamPhotos.ts` `Body`), and then cannot delete it unless a stranger also files a `photo_private` report. Under A, the irreversible button is unlocked by a claim anyone can make with a free device. The delete still needs a person and a typed `DELETE`, so this is not a hole, but "ALL realistic options" is not met.
**Fix.** Add option D: the team's hide form gets a "hidden for privacy" tick (stored on the event), and the button appears for a photo hidden with that tick **or** reported as `photo_private`. Recommend A or D with the reason. Say in A's risks that a public report unlocks the button.

### 10. Minor: the duplicate reply has nothing to read from, and a same-`clientRef` race is unhandled

**What the plan says.** Step 2: a duplicate replies "with what it did (`200`, `hidden` as it was)". The reply's `hidden` is "read from the database after the hide step, never from the reason" (and the headline: "nobody is ever told a photo is down when it isn't").
**Why it falls short.** 4.1 stores `hidden_by_report` and `hide_skipped`, but not the answer that was given. A report on an already-hidden photo is answered `hidden: true` the first time (`hide_skipped = already_hidden`, `hidden_by_report = false`), so a resend after a lost response would say `hidden: false` ("not hidden yet") for a photo that is hidden. Conversely, if a team member has restored the photo in between, "hidden as it was" says it is down when it is not. Also the check in step 2 is a read: two concurrent sends of one `clientRef` (a double tap, or app retry plus resend) both pass it, and the second insert hits the unique key, which the plan does not handle (a 500).
**Fix.** On a duplicate, compute `hidden` from the live state (is `photo_id` hidden now?), not a stored value. Insert with `ON CONFLICT … DO NOTHING RETURNING` and fall back to the duplicate path when nothing is returned. Add a test for the lost-response resend and the concurrent pair.

### 11. Minor: the "every reader of photo bytes" table misses the repeat-sighting path

**What the plan says.** 7.2's table lists `computeMatchCandidates` as the matching reader, and T7-8 guards new readers.
**Why it falls short.** `routes/sightings.ts:527-537` reads a sighting's own photo (`existingPhoto.data`) and passes it to `computeMatchCandidates` when a device repeats a submission. It only guards `existingPhoto` being absent, not `data` being null. After a removal, that repeat call would feed `null` to the matcher and 500. The type checker will catch it once `data` is `string | null`, but the plan calls the table complete and it is not.
**Fix.** Add the row ("a repeat submission for a sighting whose photo was removed returns the sighting with no fresh matches, as the missing-row branch already does") and a test. Treat `data == null` the same as a missing row.

### 12. Minor: two ordering slips

- **5.1 before 5.2.** 5.1 step 7.4 queues the `issue_alert`, but the `issue_alert` purpose, builder and `processRow` branch arrive in 5.2. Merged alone, 5.1 either cannot compile its enqueue or hides photos with no email and no dashboard (the Issues section is Slice 7). **Fix:** swap them (5.2's purpose and builder first), or fold the purpose and a stub builder into 5.1.
- **7.2 needs 7.1.** The delete button lives "on the Issues row and the team cat page", but the table lists 7.2's needs as "5.1; Decisions 2 and 3; docs 0.1". **Fix:** add 7.1.

### 13. Minor: "Keep hidden" and "Restore" have holes

**What the plan says.** "Keep hidden (`hide_photo`; closes as Done)". T7-4: "Keep hidden and Restore close the report and write exactly one event each".
**Why it falls short.** For an already-hidden photo, `setPhotoVisibility` returns `already` and writes nothing (`photoVisibility.ts:197-198`), so Keep hidden writes no visibility event (only a report-state event). And it never checks the photo is still hidden: if a colleague restored it, "Keep hidden" closes the report as Done on a public photo. T7-4 as written fails or tests the wrong thing.
**Fix.** Define the events (visibility event versus state event) per action. "Keep hidden" refuses with a message if the photo is no longer hidden. Add that test.

### 14. Minor: how the reported-photo route is told apart, and which probes are missing

**What the plan says.** 7.1: `view_welfare_queue` gates "the team photo route for a reported photo". T7-1 has a mutation probe for the strip only.
**Why it falls short.** There is one catalogue route, `GET /api/team/photos/:publicId` (`routes/teamReports.ts:94-109`), gated by `view_exact_location`, and SYC-53 PR 0.5 plans to give it a target (the photo's cat) so a guardian can use it for her colony (roles spec §6.2 note 4, line 315). The plan never says how the route decides a photo is "reported" (a lookup on `welfare_reports.photo_id` for a content row?) or what a guardian gets. A guardian who holds `view_exact_location` for the cat would otherwise be served a reported photo. Also, only the strip has a probe; the section, the alert links and the photo route do not.
**Fix.** Specify the rule (a photo that is the `photo_id` of any `kind = 'content'` row needs `view_welfare_queue` as well), and add one probe per gated surface (drop the check, T7-1 red).

### 15. Minor (plausible): drafts eat the unchecked allowance

**What the plan says.** 1.1: during an outage the draft route "writes a collapsed unchecked draft", behind "the unchecked limit (3 an hour per address, both forms together)".
**Why it falls short.** If a draft counts, one real report in an outage costs two of the three (draft, then submit), so a second person on the same café or hotel connection gets `429` for an hour. The app keeps the report, but a hurt-cat report is delayed up to an hour.
**Fix.** Count only reports, not drafts, toward the 3. Or give drafts their own (higher) unchecked cap. Say which, and test it (T1-3b).

### 16. Minor (plausible): no stated failure mode for the Postgres limit store

**What the plan says.** 2.1 moves nearly every limiter onto `consume()` in Postgres.
**Why it falls short.** Today a limiter cannot fail. After this, a counter write that errors (lock contention, a deadlock on a hot key, a short database blip) will 500 the cat-in-trouble route, because the limiter sits in front of it.
**Fix.** Say what happens on a store error: fail open for the welfare routes (log loudly), fail closed for the hide limits and brake (the hide just doesn't happen, the report still queues). Test both.

### 17. Minor: test and probe gaps

- **Spec test 9** (content row never shows "Photo still uploading") is mapped to T4-1, which is the byte-for-byte welfare snapshot. Nothing tests that the database refuses a content row with `photo_state <> 'none'`. Add T4-9.
- **Spec test 13** includes "the secret is never logged". T1-6 covers the token only. Add the secret to the captured-logger test.
- **Silent-failure guards without a mutation probe:** T1-6 (token never logged), T4-2 (banner counts both purposes), T4-5 (`wrong_kind` in the outbox), T4-7 (delete-my-data on a content row), T7-8 and P6-0 (source tests: the plan gives a probe for T4-0 only), T8-3 (reopened report not swept), and the courtesy 24-hour check.
- **No database check that a hiding reason carries a photo.** 4.1 enforces `(kind = 'content') = (reason is not null)` but not `reason in ('photo_private', …) ⇒ photo_id is not null`.
- **D2's narrow hint** ("faces, house numbers, number plates, inside a home or garden") is not named in 6.2's strings; only "hint" is. Name it, with a test that the string is the narrow one in all three languages.

### 18. Minor: the delegation section

- 1.0 gives "Cloudflare widget via API" to **Sonnet**, using the production wrangler token, while the table's last row says "Production steps (Cloudflare widget, migrations, snapshots, probes)" belong to the session model. These two lines disagree. Move the production widget creation to the session model (Sonnet can do the spike page and the simulator run).
- 2.1 (the limits store) is Sonnet with an Opus spot review. It is the base of the brake, the hide limits, the unchecked limit and the new-phone cap, and finding 4 shows a key-shape slip is exactly the bug that would go unseen. Either raise it to Opus with the one-line reason, or name the Opus review as a gate (not a spot check) with the T2-5 probe.
- The reviewer rule "Opus for 1.1, 3.1, 5.1 and 7.2: equal tier to the builder" justifies the escalation only by symmetry. Add the one-line reason (these four carry the abuse and privacy risk) as the other escalations have.
- Every escalated package does name concrete assurance, and every Sonnet/Haiku package has tests plus a probe or a read-through. The slips are the ones above.

### 19. Minor: two small calls drift from D12

- "The team's note is kept" (small call). D12 says "the note is deleted and a bare record stays". A team note often quotes the reporter. Either clear the team note too, or record it as a decision for Samuel (it is a one-line "object to any" item that changes retention).
- The digest is "claimed with `insert … on conflict do nothing`" before it is sent (5.2). If the send then fails, that Athens day's digest is lost. Claim and send in one step, or release the claim on failure, or retry until sent.

---

## Checked and found correct

- **C1 to C12, all true against the code.** C1 (live probe 13/14 Oct: `server: Google Frontend`, `via: 1.1 google`; `routes/photos.ts:59-65`); C2 (home note is public on `main`; SYC-130 decided otherwise); C4 (`send.ts:43-44` says shedding does not exist yet); C5 (`lat`/`lng` NOT NULL, unique key as described, no `reason`/`photo_id` columns); C6 (`capabilities.ts` has exactly 12 names, `can()` is "is staff"); C7 (`sightings.ts:242-282` sends each nearby cat's main photo with no hidden check); C8 (`serve-web.js:402-409`, headers only while the gate is on); C9 (`ReportQueueContext.tsx:242-252`); C10 (no welfare retention job anywhere in `api-server/src`); C12 (DECISIONS' last Part is 2p).
- **`isPermanentRefusal` counts `428` as a refusal** (`reportQueue.ts:145-148`), exactly as the plan says, so the `428` rule in 1.2 is needed.
- **The existing welfare close and tie guards are real work**: `moveReportState` writes the `welfare_outcome` for any report with a `cat_id`, and content rows will have one, so the Slice 4 guard belongs in the first PR, as planned.
- **Slice 4 sweep otherwise complete** (apart from finding 6): `welfareQueue.ts`, `welfareActions.ts`, `welfareTie.ts`, `mail/outbox.ts`, `severPerson.ts`, the queue test kit. `severPerson` correctly takes no kind filter.
- **The photo-address builder rule is real.** `publicPhotoUrl()` is the only builder (`photoVisibility.ts:62-70`); the cat list, cat detail, notifications, matching candidates and the hand-pick list all go through it (`catHelpers.ts`, `catNames.ts`, `routes/sightings.ts:318,863,1124-1133`). Rotating `photos.public_id` does not break the push fan-out, notifications, SYC-166 or welfare report photos (those use a different table and their own ids), because none of them stores a photo address.
- **The event table can take the new writer.** `photo_visibility_events_author_ck` already allows `report:<id>` with no person, and the add-only trigger does not stop the plan's design.
- **Decisions 1 and 2 are real and fairly set out; Decision 1 is rightly recommended** (`private` costs nothing today and makes D14 true whatever is later put in front). Decision 2's recommendation is sound, apart from finding 8.
- **D1 to D14 carried out.** D1 conditions all present (kind filter, tie ban, no outcome on close, resend key, banner, retention by kind, rollback). D2, D3 (five rules; Athens time in SQL; advisory lock on the brake; restore-ever keyed to `photos.id`), D4 (tile), D5 (one write, graceful degradation list, typed word, matching skip), D7 (no push, no tie), D8, D9 (no email box), D10, D11 (duplicate check before the token; `428` versus unchecked; drafts need a token; upgrade case), D12, D13 (order) and D14 (rotation, retired list) are each in a slice and a test.
- **Spec §13 tests 1 to 21 are all mapped** (the "Where each of the spec's tests is built" table), with the partial-coverage notes in finding 17.
- **Canonical facts**: no "colony carer" (the plan says "cat guardian"), no "snapper", no sterilisation cost mentioned, no "built today versus proposed" framing in a spec, and the "no signal" section is precise (saving works, sending needs a connection and the app open; the dashboard does not work offline).
- **Rollout, other than finding 1**: migrate before publish with a snapshot, wait for `/api/healthz` to show the commit, rollbacks written with the "deletes every issue report" and "cannot restore bytes" warnings in capitals, and "ask mode" for Neon snapshots.
- **Model delegation**: each escalation to Opus has a stated reason, every package names a test and most name a probe, and sub-agents are barred from spawning others.

