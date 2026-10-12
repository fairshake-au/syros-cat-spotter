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

(Continued in the sections below.)
