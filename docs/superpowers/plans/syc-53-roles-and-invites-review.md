# Review: SYC-53 roles and invites implementation plan

**Reviewer model: Sonnet** (independent adversarial pass, no agents spawned). I read `docs/superpowers/plans/syc-53-roles-and-invites.md` (branch `claude/syc-53-plan`) end to end against the approved spec (`docs/specs/roles-and-invites.md` on `origin/main`, merged via #102) and the code it describes: `artifacts/api-server/src/lib/{capabilities,resolve,observations,teamCorrections,notificationFanout}.ts`, `middlewares/requireTeam.ts`, `routes/{team,internal,observations,teamReports}.ts`, `lib/mail/send.ts`, `lib/db/src/schema/{welfare,observations}.ts`, `lib/db/migrations/README.md` and `ls lib/db/migrations` (0000 to 0014 on main, no clash). I also read the approved SYC-209 and SYC-2 specs on main, the SYC-44 spec (approved today, on `claude/syc-44-report-an-issue-spec`), and checked for the sibling plans: `claude/syc-209-plan` and `claude/syc-2-plan` exist only as worktrees sitting at main's commit, so **no sibling plan has been written yet**. Findings are most severe first. "CONFIRMED" means I checked it in code or text; "PLAUSIBLE" means it follows from what I read but I did not run it.

**Verdict.** The skeleton is sound: foundations before powers, the database refusing the dangerous rows, strict `can()`, a route walk, a 403 page before any invite path, and a Worker compatibility rule that fails closed. I could not find a slice order that leaves `main` unsafe between PRs (the full check is in "Order and safety between PRs"). But the plan does **not** build the spec completely or fully safely as written. One blocker (the "sterilised" news the plan says it reuses does not exist for dashboard records), several majors (an authority-precedence hole, a "Report an issue" filter that is not stated, spec items with no owner, a conflict with the approved SYC-2 spec, an unrecoverable-looking migration rollback, and an under-specified Worker change), and a long list of minors.

---

## BLOCKER

### B1. "The 'sterilised' news email is queued exactly once, as for a team record" describes a mechanism that does not exist (Plan 2.2, 3.1, tests T12 and T12a) — CONFIRMED

The plan's PR 2.2 says a guardian's "sterilised" makes the cat Confirmed and "the 'sterilised' news email is queued exactly once, as for a team record". T12a tests "queues the news email once", with the mutation probe "queue the email on every write → red". PR 3.1 and T12 test "never queues the 'sterilised' email". The spec has the same promise (§7.2: "Followers of that cat get the usual news").

In the code there is no such path for a dashboard record:

- `recordTeamStatement` (`lib/teamCorrections.ts:122`) only calls `writeObservation`. It sends nothing. The dashboard's `POST /team/cats/:id/sterilisation` and `POST /team/observations` do not either.
- The only place a "desexed" update is created and fanned out is the **owner-key admin care route**, `routes/notifications.ts:67-99` (`insertCatUpdate` then `fanOutNotifications`), which SYC-185 is retiring.
- `fanOutNotifications` (`lib/notificationFanout.ts`) writes in-app rows and Expo pushes. It sends no email. The `cat_news` mail purpose exists in `lib/mail/send.ts:94` but nothing calls it.

So "as for a team record" is false today. A builder following the plan has three bad outcomes open: (a) ship no news at all (the spec's promise silently dropped, and T12a's "queued once" has nothing to assert), (b) invent a new news path inside a Sonnet or Opus PR with no spec for it, or (c) make the guardian write call the owner-key route's helper, wiring a retiring route into a new feature. The effect is irreversible (the spec says it "can't be unsent"), and "exactly once" has real edge cases the plan never names: Confirmed, marked wrong, Confirmed again; a team member confirming a cat a guardian already confirmed; a guardian saying "isn't sterilised".

**Fix.** Add an explicit task to PR 2.2: a post-commit `announceSterilised(cat)` that fires only on the **transition** to Confirmed (compare the resolved answer before and after, inside the same transaction as the write), using `insertCatUpdate` plus `fanOutNotifications`. Name the real channel (in-app notification and push today; the spec says "email", so ask Samuel which he means). Ask Samuel whether the team's own dashboard confirmations should announce too, since today they do not and making only guardians announce is an odd asymmetry. Tests: announces on first Confirmed only; not on a repeat; not on an ear tip or field check; not on "isn't sterilised"; not on a superseded-then-restored sequence unless the answer actually changed. Replace the "queue on every write" probe with "drop the transition check → red".

---

## MAJOR

### M1. A guardian's statement can overwrite a vet's or the team's record, in either direction (Plan 2.2, 0.2; Decision B) — CONFIRMED in code, unspecified in spec and plan

`resolve.ts` rule 2 is "authoritative assertions, newest by `observedAt` wins, **whatever sign**". The plan adds `guardian` as an authority for `sterilised` and says nothing about precedence. The spec's §2.2 table lets a guardian "say a cat in her colony is sterilised, **or isn't**", and the plan's PR 2.2 only describes the "sterilised" direction. Failure scenarios: (1) the team records "sterilised" from the vet's paper record; a guardian who is sure the cat "was never done" taps "isn't", it is the newest statement, and the cat flips to a confirmed *not* sterilised and goes back on a trapping list; (2) the reverse, a guardian's mistaken "sterilised" outranks the team's correct "not sterilised" simply by being later (the team can fix it, but only if someone notices; the spec accepts that for the guardian's own mistaken Confirmed, not for overriding a team record). `body.observedAt` is also accepted on the generic observation routes, so "newest" is partly under the writer's control.

**Fix.** Make this a short "Decision G" for Samuel with a recommendation: a guardian's `sterilised` statement counts only when no *newer-or-equal* team, management or vet statement exists for the cat, and a guardian's "isn't" against a team record becomes a visible disagreement on the cat's page (not a flip). Ignore client `observedAt` on every guardian route. Tests: guardian "isn't" after a team "sterilised" leaves the answer unchanged; guardian "sterilised" after a team "not sterilised" likewise. Mutation probe: treat guardian like staff in the fold → red. Keep `guardian` out of the shared `AUTHORITATIVE_ROLES` set used by rule 3 (ear-tip correction) so her authority is sterilisation, colour and markings only, as spec §10.4 says.

### M2. "Report an issue" reports are not excluded by the plan, only by the hope that they have no route (Plan 3.3, T29b) — CONFIRMED mechanism, PLAUSIBLE exploit

Plan 3.3 says every "Report an issue" report "has no route for her at all". But SYC-44 (approved today) stores them in the **same table**: `welfare_reports` with `kind = 'content'` (the column and check already exist, `schema/welfare.ts:48,94`). A guardian's list route and photo route read `welfare_reports`; nothing in 3.3 says they filter `kind = 'welfare'`. Spec test 29b(ii) requires refusal of "every 'Report an issue' report"; the plan's version of (ii) lists "another colony's report, a report tied to no cat, and a guessed number" and drops this clause. SYC-44's own plan will add a photo column and a reporter-photo path to these rows; if its reports ever gain a cat tie, the guardian query returns a neighbour's note about a guardian's house, which is exactly the leak SYC-44 §10 swears to prevent.

**Fix.** State the filter in the guardian queries (`kind = 'welfare'` in SQL, not in the serialiser). Add to T29b(ii): seed a `kind = 'content'` row tied to a cat in her colony, assert 403 on the list, the detail and the photo route. Mutation probe: remove the kind filter → red. Add a line to the SYC-44 collision row: its plan must not weaken this.

### M3. Spec requirements with no owner in any plan (the "moved cat" notice and others) — CONFIRMED

Delegating T16 to "SYC-209's PRs" leaves a hole, because no sibling plan exists yet and two spec behaviours have no home:

- **A moved cat's previous guardian is told** (spec §6.8, §7.4, test 16; SYC-209's spec says the same in its "cat that is in somebody else's colony" paragraph). The line appears on the **previous guardian's page**, which is PR 2.1's page, but PR 2.1 has no such section and SYC-209 will only write the move. Fix: PR 2.1 owns the reader (derive it from `colony` observations: cat's newest colony differs from hers, within a stated window, with no destination named), with a fixture test; SYC-209 only writes. Both plans name it.
- **Field checks "marked from someone who has since left"** (spec §9.2). No PR renders this. Fix: add to PR 3.1's team cat page work, with a test using a left person.
- **The 30-day "recently marked homed/deceased" flag staying on the round sheet** (spec §7.2, test 29c). PR 2.2 defers it to "when it exists" and PR 4.2 lists the field but has no test that a cat she marked deceased 10 days ago is on the sheet, flagged, and gone at day 31. Add it to 4.2's tests.
- **The guardian's "isn't sterilised" direction** (see M1).

Also T16 and T30 are promised to SYC-209's plan by a Linear comment, which binds nothing. Fix: put them in the Linear follow-up as acceptance criteria on SYC-209, and list in this plan which of the spec's §15.3 tests it does **not** deliver (16 and the route half of 30).

### M4. Decision B conflicts with the approved SYC-2 spec, and the plan's way of fixing it is stale (Decision B, D1, "Where this collides") — CONFIRMED

SYC-2 (merged on main, `coat-markings-and-health.md`, data-model section) says coat and markings accept `guardian` "with `authorityScope: guardian_of_this_cat`". Decision B1 uses `colony:<id>` for every guardian statement and says `guardian_of_this_cat` is "left for the claim feature". Both cannot stand. The plan's fix is "a one-line edit on #104 itself, not a new PR" but #104 (and #103) **merged** in `91b32be`; the "approved, merging" wording in the plan is out of date (it also says "Checked against `00271a6`"; main has moved). SYC-209's spec (merged) also says `colonies.created_by` is "a link to people" while the plan's C7 says the existing text column is enough.

**Fix.** Add the SYC-2 correction (and the SYC-209 `created_by` wording) as a real small docs PR (a fifth, D5) before PR 2.2, because 2.2 is where the resolver learns the new scope. Refresh the plan's header and collision table to say #102, #103 and #104 are merged.

### M5. The accept page leaves out what the spec says it must tell people (Plan 1.1) — CONFIRMED

Spec §4.1 step 4 says the accept page shows "what you'll be able to see and do". Spec §12.2 and §14 cases 9 and 10 say the accept page **asks everyone to keep a lock on their phone**, and says plainly that a phone that is never opened again keeps its saved list until the browser clears it. These are the stated mitigations for the accepted lost-phone risk. PR 1.1 lists only the three promises, the name field and two buttons, and T29d pins "exactly three promises". Nothing builds or tests the other text, and a builder reading T29d may reasonably refuse to add it.

**Fix.** Add the three pieces of text to 1.1 as plain statements outside the promises, in all three languages (Johnny's list), and extend T29d: exactly three promises *and* the lock request and the never-reopened-phone sentence present, none of it phrased as a promise, none about keeping places private.

### M6. `Clear-Site-Data` and the 72-hour deletion have no named test (Plan 4.1, 4.2; spec test 26) — CONFIRMED

PR 4.1 specifies `Clear-Site-Data: "cache", "storage"` on sign-out, on sign out everywhere and on a refused field request. Its test list covers only: other responses keep `default-src 'none'`, the service worker scope, `no-store`. Spec test 26 explicitly requires "sign-out sends `Clear-Site-Data`" and "`Clear-Site-Data` is sent on sign-out and on removal". Nothing asserts it, and no mutation probe names it. Also, sign-out itself is `/api/team/signout`, outside the field path, so the header has to be sent from a route the field-page rule does not cover; the plan does not say so.

**Fix.** Add to 4.1: the header is present on `/api/team/signout`, on a field request from a person who has left, and from one who lost the placement; absent where it must be (a normal page load). Probe: remove the header from the sign-out handler → red. In 4.2 name the 72-hour boundary test at 71h59m and 72h01m by server time, and the "delete, don't hide" probe (already there).

### M7. Migration 0.3 cannot be rolled back once real rows exist, and the CI up/down/up proves nothing about that (Plan 0.3, Rollout) — CONFIRMED reasoning

0.3's rollback "restores the old role check". After `people-set-roles` there are `management` rows, and after Slice 1 there may be `guardian` and pending rows. Restoring a check that does not allow `management` fails on those rows, and dropping `accepted_at`, `reach` and the placements destroys state. The README's CI harness proves up, down, up on an **empty** database, so it will pass. The plan's "app first, then the database, or not at all" line is right but the rollback block should say, in capitals as 0.1's does, that it deletes or refuses on `management`/`guardian` rows. Related: `confirmation_items` is created in 0.3 (weeks before it is used in 3.4) and has a strict link to `feeding_sites`, which SYC-209's non-additive migration is about to reshape.

**Fix.** Move `confirmation_items` to PR 3.4's own migration (it needs 209's sites by then anyway). In 0.3's rollback block, either delete-then-restore with a printed count, or refuse with a list; add a test of up/down on a database holding a management row and a guardian row. State plainly that after `people-set-roles` the production path is fix-forward.

### M8. W1, the Worker change, is the riskiest PR and is the least specified (Plan W1) — CONFIRMED gaps

It touches the one door every team member uses, in another repository, and the plan gives it no staging, no rollback and no description of how identity survives between the emailed link and the "Open my colonies" button.

- **Rollback.** If the new Worker misbehaves the whole team, including Samuel, cannot get into the workspace; the `admins` break-glass row covers the workspace only. Fix: record the previous Worker version before deploying (`wrangler versions` / rollback command), deploy, probe a real staff address and a test guardian, and roll back on any failure. State this in the plan.
- **Dashboard-only identity.** The Worker today holds a workspace session after the link is tapped, and the hand-off is a button inside the workspace. For a dashboard-only person W1 says "no workspace session", but something must prove her verified address for the minute between link and button. The plan does not say what (a short-lived signed value, one use). Spec §6.3 says she "goes straight to the dashboard", while W1 adds an extra "Open my colonies" page; that is an unremarked deviation and the page is English-only for a Greek guardian.
- **Fail closed on a missing answer.** If the API is rolled back after W1 ships, a version-2 request gets the old shape back; the Worker must treat a missing `doors` as no door. The mutation probe "grant on `allowed` alone" covers this only if the test mocks that response; say so.
- **SYC-26 ordering.** "W1 goes first; SYC-26 rebases" is a plan, not a lock. The other repository's `syc-26-plan` worktree was not available to me; check it before starting W1.

### M9. The wrong-mailbox mitigation the spec relies on is deferred to an unscheduled ticket (Plan 1.1, "Not in this plan") — CONFIRMED

Spec §14 case 1 lists "a wrongly invited stranger's address is anonymised on withdrawal (§9.6)" among the things that **limit** the accepted wrong-mailbox risk. The plan sends that to SYC-208, which is in Backlog, and only comments on it. So when invitations go live (PR 1.1, 1.2), a withdrawn invitation leaves a stranger's address in `people` indefinitely and the spec's own mitigation list is untrue. Related: the invitation email goes through `mail_outbox`, which stores only a hash, so the address is resolved at **delivery**. The plan says the function "refuses unless that person is pending and unexpired", but does not say that check, and the address lookup, happen at drain time as well as at enqueue; an invitation withdrawn (or later anonymised) between the two must not send. The drain and the `invite_sent_at` update on delivery are new code paths in `mail` that PR 1.1 does not list.

**Fix.** Either add the small "never-accepted withdrawal replaces the address and name with SYC-208's placeholder" to 1.1, or have Samuel explicitly accept the gap in Decision form. Add the delivery-time re-check and a test (withdraw between enqueue and drain → nothing sent). List the drain change in 1.1's scope.

### M10. Model tiers and assurance are too thin in four places (Model delegation) — CONFIRMED

- **0.2 (Sonnet, "Opus spot review of the resolver diff").** This PR changes who the resolver treats as authoritative (`admin` to `management`, the shared role list) and introduces `actingRole`, which decides the role written on every statement. A slip silently de-authorises management's corrections or lets a role in. A spot review is not enough. Run it at Opus, or keep Sonnet and require a full Opus adversarial review plus the production `admin` count probe done before, not after, merge.
- **1.2 People screen (Sonnet, "Opus spot review").** This is the only place access is granted and removed. `manage_people` gating, Origin check, self-change refusal, "no free text reaches an email" all live in route code here. Needs a full adversarial review, not a spot review, and a mutation probe (drop `manage_people` from one route → the 403 test goes red).
- **3.4 "Needs an OK" (Sonnet).** Approving makes a private feeding site public, the single most sensitive position in the app. The capability re-check at decision time and the first-decision-wins update are the safety. Escalate the decide route to Opus.
- **Reviewers at the builder's tier.** "Same tier as the builder (Sonnet for Sonnet-built)" means a Sonnet reviewer for the People screen. For anything under `manage_people`, the resolver, or an exposure of positions, the reviewer should be Opus.
- **Probes named only in general.** Name these: T6 (compare expiry against the app's clock, or ignore `expires_at` → red); T13 (drop the `decided_by <> proposed_by` check, then drop the route's re-check, separately); T14 (read-then-write instead of the conditional update); T17 (drop the `reach` check); T12/3.1 (queue the news on an ear tip); T2 (already named); T27 (grant `use_workspace` on `mayEnter`); 3.2 and 5.1 have none.

---

## MINOR

1. **Two JSON routes will answer a guardian with the sign-in 401, not the 403 page (Plan 0.5, T2).** `POST /team/observations` and `POST /team/observations/:id/supersede` use `requireTeam()` with no capability and call `can()` inside (`routes/observations.ts:144,200`); on refusal they call `refuseNotSignedIn`. After 0.5 a guardian passes the door (`canSomewhere`), then the strict inner `can()` refuses her with the 401. Safe, but it is the sign-in loop the 403 page exists to prevent, and it contradicts T2 ("every capability-gated route"). The plan's route table lists these two but never says what 0.5 does with them. Give them an explicit row and answer.
2. **A signed-in person whose every placement has ended (a holiday cover on the day after her end date) gets the 401 loop (0.5, spec §6.4).** `requireTeam` refuses `!mayEnter` with `refuseNotSignedIn` today; the plan's 403 only covers "may enter but lacks the capability". She signs in, the Worker says no door, and she sees nothing explaining why. Define the page ("your access has ended; ask Syros Cats") and put the "someone whose roles grant nothing" row of T1 on it.
3. **Athens midnight is not tested (6.6, 1.2).** The form takes a date; the column is a timestamp; the spec says a placement ends at midnight Athens time. Clocks go back on 25 October 2026. Add a boundary test across that weekend.
4. **`people-set-roles` "replaces a person's roles" (0.3).** One typo (`management` without `staff`) drops a manager's `staff` row and locks them out of the team pages. Make it additive by default (`--add`/`--remove`), print before and after, and refuse a result with no island role unless forced. The same command is the break-glass, so it must be hard to misuse.
5. **`people add --role management` between 0.3 and 0.5 creates a person with no powers** (`can()` is still staff-only) and `mayEnter` is false for her. Harmless, but say it, or refuse the role in the CLI until 0.5.
6. **`findInvitee` "used only by the hand-off, the accept page and the decline route"** (1.1) is also needed by the allow-list answer for a pending invitee (so she can receive her sign-in link). Reconcile, since the "every place the list is read" inventory is the thing reviewers will check.
7. **Pending session after Yes, join (1.1).** The hand-off issues a session "marked pending"; the plan never says it is replaced on accept. Say whether accept re-issues the cookie or she signs in again, and test that the old pending cookie cannot reach a capability route after accept.
8. **`access_change_notice` scope is ambiguous (1.1).** The text says "of a team or management member"; spec §8.1 and §8.3 email the other managers for **every** access change, guardian invitations included (the common case). T15 and T19 should cover a guardian invite, role change and removal too.
9. **Private field-check photos need upload rules (3.1).** "Shaped like `welfare_report_photos`" does not say the byte cap, the type check by content rather than extension, stripping GPS and other EXIF data (a phone photo carries the exact spot), the per-person rate limit, or the `Cache-Control: private, no-store` on the serving route. Name them and test the cap and the type check.
10. **Greek guardians get English until Johnny signs off (1.0).** `LIVE_LANGUAGES` falls back to English silently, so the first Greek-speaking guardian is invited in English and the sign-in link from the Worker is English too. The spec accepts English-first, but the People screen should show "will be sent in English" when a non-live language is chosen, and `invitePerson` should record the language actually used.
11. **`removePerson` retirement and the test harness (0.1).** A strict `person_events` link plus an append-only trigger breaks any test that cleans up by deleting people. The plan names only P0-4 and P1-10. Check how `observations` tests clean up and apply the same approach to every test that creates people; budget this in 0.1.
12. **The distance sort sends a position to the server (Decision E, 4.2).** Prefer a POST body to a query string so no proxy or access log keeps it, even though the app's logger strips queries.
13. **T24 parses the Markdown table in the spec (0.5).** Fine as a drift guard, but D4 and later spec edits will break the parser; pin the table's shape in the test and fail with a message that says which row, not a parse error. The "names SYC-209 and SYC-2 cite" check must also parse those two specs, which are now on main.
14. **Plan text slips.** "19 routes under `/api/team/`" while the list beneath has 23 team routes plus 2 internal; C7 says "Slice 3 writes `created_by`" while 1.1's `createColonyWithPlacement` already writes it; the header and collision table still call #102, #103 and #104 unmerged and cite `00271a6`; rollout step 2 lists migrations (0.1, 0.3, 3.1) and would add 3.4 if its migration is moved (M7).
15. **Colony pages for guardians exist twice (Decision D).** SYC-209 lists `GET /api/team/colonies/:id` as `view_exact_location` placed; the plan builds a separate guardian serialiser at `/my/colonies/:id`. Require in SYC-209's plan that any placed holder who is not island-wide is rendered through `guardianCatView`, never the team cat view, and add 209's colony page to the "places the guard must hold" list as a named reader with a test.
16. **Check production before declaring the first guardian blocked (Decision D).** If `colonies` already holds real rows, a guardian can be invited onto one as soon as Slice 2 is live, so "waits for SYC-209" is not a gate anyone enforces, and the D3 fallback may be unneeded. Claude can read the count through db-ops before Samuel answers D.
17. **Progress notification.** The plan promises a note at each merged PR; nothing in the rollout steps shows who sends it. Add it as a rollout step.

---

## Decisions A to F

| | Verdict | Why |
|---|---|---|
| **A. Management rows added by command after the migration (A1)** | **Agree, with conditions** | Putting three people's addresses in the repository is the wrong trade, and it is the only decision that departs from a question Samuel answered (Q1), so D4 must record it. Conditions: make `people-set-roles` additive (minor 4); be honest that spec test 29a becomes a **production probe plus a seeded-database test of the command**, not a test of the migration; keep 0.5 unmergeable until the probe shows exactly three; remember the Neon snapshot step needs Samuel's "ask" mode. |
| **B. `colony:<id>` in the existing `authority_scope` (B1)** | **Agree on the shape, disagree that the plan has finished the job** | There is no database check on `authority_scope` (`0001_data_spine_tables.sql`), so B1 needs no migration, and B2 (colony inside each value shape) and B3 (new column on the biggest table) are worse. But it contradicts the **merged** SYC-2 spec (`guardian_of_this_cat`) and the data spine (M4). Conditions: a strict pattern (`^colony:[1-9][0-9]*$`), written only by the server, only for role `guardian`, rejected everywhere else in `writeObservation`; the resolver must never treat that scope as authority for a non-guardian role; a small D5 docs PR for SYC-2 before 2.2. |
| **C. `field_check_photos` table (C1)** | **Agree** | It copies the one proven private pattern and keeps public readers unable to join to it. Add the upload rules in minor 9; SYC-208 must reach these rows (the plan lists it). |
| **D. SYC-209 owns the colony screens; this plan owns the powers (D1)** | **Agree, with conditions** | One owner per screen is right. But the hand-off is weaker than it reads: no sibling plan exists, the moved-cat notice and part of T16/T30 are orphaned (M3), and two guardian colony pages will exist (minor 15). Make the hand-off binding (acceptance criteria on SYC-209, a named shared helper, the guardian-view rule). Check production colonies first (minor 16). D3 as a fallback is acceptable if Claude runs it through db-ops, but those colonies then miss SYC-209's history, so say that. |
| **E. Grouped by colony until the field page, then sorted by distance (E1)** | **Agree** | Keeps scripts off the main dashboard, as spec §12.2 intends. Send the position in a POST body (minor 12). |
| **F. A short SYC-54 screen spec before Slice 4 (F1)** | **Agree** | Slice 4 is the only part with scripts, a service worker and positions on phones. Add to that spec the accept-page wording about phone locks (M5) and the `Clear-Site-Data` behaviour on removal. |

I would add one decision the plan does not ask: **G (M1)**, how a guardian's statement ranks against a team or vet record, together with whether the team's own confirmations should announce news (B1).

---

## Order and safety between PRs (checked, with what I found)

- **0.1 to 0.3 to 0.4 to W1 to 0.5.** Safe. Between 0.3 and 0.5 `can()` is staff-only, so a guardian row grants nothing, `mayEnter` is false for her, and the allow-list answers the old shape only for workspace holders. The plan's claim that W1 must precede 0.5 is stricter than needed (0.4 alone already stops a guardian getting the workspace through the old Worker); keep the stricter order, it costs nothing. The unsafe orderings are the reverse ones and the plan forbids them: publishing before migrating (new code reading `accepted_at` before it exists would 500 every sign-in) and 0.5 before the three management rows exist (harmless today since no screen uses `manage_people`, but correct to forbid).
- **403 page before invite path.** Honoured: 0.5 precedes 1.1.
- **Invitations before guardian pages.** A guardian invited between Slice 1 and Slice 2 lands on a page that names her colonies and shows no cats (1.3). Harmless.
- **Migration numbering.** `ls lib/db/migrations` on main ends at `0014_photo_visibility`; no open PR adds a migration; the plan's "next free number at generation time" matches the README. SYC-2 adds none; SYC-209 adds at least one that is not additive. The plan's three migrations (`person_events`, `roles_and_invites`, `field_check_photos`) become four if `confirmation_items` moves (M7).
- **Handing Samuel a command.** I found none. Every migration, `people-set-roles`, wrangler deploy and probe is Claude's; Samuel's steps are approving the management list, switching to "ask" mode for the Neon snapshot, publishing in the EU Replit project, and inviting one person on a screen. The Replit publish is the existing practice, not a new ask.
- **Canonical facts.** "Spotter" only (the plan names "snapper" only to forbid it), "cat guardian", sterilisation "€50–60 per cat", and partial offline (the plan's "What works with no signal" section is precise). No "colony carer", no €25. Plain English throughout.

## Where each §15.3 test lands (gaps only)

The plan's table maps every test. The ones where what the PR actually builds falls short: **12 and 12a** (B1, M1), **16** (SYC-209, unowned: M3), **26** (`Clear-Site-Data`: M6), **29b(ii)** (content-kind row: M2), **29c** (round-sheet flag: M3), **29d** (extra accept-page text: M5), **29a** (production probe only: Decision A), **2** (two JSON routes: minor 1), **30** (route half is SYC-209's).

## What held up (no finding)

- The strictness design (`can()` with no target answers island-only, `canSomewhere` only for entry and menus) fails closed, and the route walk with a minimum count plus a mutation probe is the right backstop. The existing `team.walk.test.ts` extends naturally.
- Targets read from the record, never the request; the "newest active `colony` observation" rule with `colonyId: null` for none.
- Accept as one conditional update, withdraw and decline as the same guarded update, the last-manager check under a row lock with a concurrent test.
- The old-shape allow-list answer being `allowed: true` only for workspace holders, with identical "no" answers for unknown, left, expired and no-door addresses.
- Keeping `guardian` out of `writeObservation` until 2.2, and the vocabulary landing before anything writes it.
- Per-PR worktrees, review in its own worktree, commit-after-each-item and a checkpoint file, no nested agents.
