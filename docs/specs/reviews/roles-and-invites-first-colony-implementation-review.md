# Independent review: SYC-439 implementation

**Date:** 18 October 2026 · **Reviewer:** independent Opus subagent · **Tree:** `claude/syc-439-first-colony` at e17de8a4 (detached, in its own scratch worktree), compared with `origin/main...HEAD` against `docs/specs/roles-and-invites-first-colony.md`. How each finding was handled is in the table at the end (added by the author).

## Summary

The door is sound. The reviewer found no way for anyone except a joined, not-left person holding an in-force `start` row to get a session from it, and no route she can reach beyond the spec's list.

What was checked and found correct:
- **Who can get a session.** The person readers still require `accepted_at` set and `left_at` null, and drop ended rows.
- **Bad rows fail closed.** `isStartRow` needs role `guardian`, colony null and reach `'start'` stated explicitly.
- **What she can reach.** Every `/api/team` route goes through `requireTeam` except the hand-off (`maySignIn`), sign-out, public assets, and accept/decline (`requireInvitee`, which sends a joined person home). Her own pages, the "my colony" and "my cat" pages, `/team/me`, photos, map tiles and `/api/internal` were all checked: the own pages let her in, the rest refuse her.
- **`can()` and its neighbours.** `can()` gives a start row exactly `create_colony`. `canSomewhere`, `mayEnter` and `capabilitiesOf` ignore it, so `visibleColonyIds` is empty for her.
- **The Colonies list door** is separate; the shared `requireSeeing` door is unchanged.
- **lib/db.**
  - `start` is written only from the explicit flag.
  - `writePlacements` matches rows on role, colony and reach.
  - `setRoles --add` and `--replace` clear the start row, and `addPerson`'s rejoin deletes every row.
  - Creating a colony locks her person row, then inserts the colony, then the placement, then deletes the start row selected by reach, then writes `roles_changed` with `createdColony`. A name clash rolls everything back.
  - The migration's checks match §4.2, and its way back refuses while a start row exists.

The findings are spec requirements with no test behind them, so a one-line regression would ship green (R1 to R5), plus wording and robustness nits.

## Findings

- **R1 · Major (test gap) · The accept page's door for a starter is untested.**
  - Evidence: `teamWelcome.ts:95`.
  - Probe A (switching this line back to `mayEnter`) survived.
  - Fix: invite a starter, POST `/api/team/my/accept`, and expect a 303 to My colonies plus a session.
- **R2 · Major (test gap) · "Never 'nothing'" is proven only for the renderers, not for what the routes pass them.**
  - Evidence: `teamWelcome.ts:47` and `send.ts:428` pass `starting`.
  - Probe I (removing both lines) survived.
  - Fix: test GET `/api/team/my/welcome` as a starter invitee, and test the invitation built by `buildPersonMail` with real lookups.
- **R3 · Minor (test gap) · The create's start-row delete isn't pinned to her.**
  - Probe E (dropping the `person_id` condition) survived.
  - Fix: use two starters; one creates, and the other must keep `start`.
- **R4 · Minor (test gap) · `--replace` and Bring back are untested as writers that clear the start row.**
  - Probe B (the replace loop skips start rows) survived.
  - Fix: add lib/db tests for `--replace staff` and for `rejoinPerson` onto a colony.
- **R5 · Minor (test gap) · Change roles pre-ticking "No colony yet" is untested.**
  - Probe G (`starting: false`) survived.
  - Fix: GET the form and expect the box checked; POST it back unchanged and expect "already hold exactly that".
- **R6 · Minor · The source scan for the `starting` option is easy to slip past.**
  - Evidence: the regex `/starting:\s*true\s*}/` misses `{ starting: true, island: … }`, `as const`, and a trailing comma.
  - Probe J slipped past the scan; only the walk caught it.
  - Fix: give the option a unique name and count every word-boundary use.
- **R7 · Minor · The shipped wording differs from the approved spec §2 table.**
  - Invitation email, accept page, People row, history and Bring back each differ.
  - Fix: match the spec, or record the change.
- **R8 · Nit · The management form's hint assumes a woman ("her", "she", "herself").** Spec §2 says the People screen shouldn't.
- **R9 · Nit · The new French drafts use "gardien·ne"; the existing strings use "gardien" or "gardien(ne)".** Add it to Johnny's SYC-283 list.
- **R10 · Nit · The CLI can't remove "no colony yet" directly.** Allow `--remove guardian --start`, or say in USAGE how to clear it.

## The reviewer's own mutation probes

| # | Mutation | Result |
|---|---|---|
| A | Accept page: `maySignIn` → `mayEnter` | Survived (R1) |
| B | `setRoles --replace` skips start rows | Survived (R4) |
| C | `alreadySignedInAs` also admits `scopes.length === 0` | Killed (`team.handoff.replay.test.ts`) |
| D | `/api/internal` dashboard admits any row with a null colony | Killed (`internal.doors.test.ts`) |
| E | Create's delete loses `person_id` | Survived (R3) |
| G | Change roles prefill `starting: false` | Survived (R5) |
| I | Accept page and invitation mail stop passing `starting` | Survived (R2) |
| J | `{ starting: true, island: undefined }` on `GET /team/my/cats/:id` | The scan missed it; the walk caught it (R6) |

Every file was restored after each probe; the reviewer's worktree was clean at the end.

## Verdict

Safe on access. **Not ready until R1 and R2 have tests**; ideally R3 to R5 too, and R7 fixed or recorded.

## How each finding was handled (author, 18 October 2026)

FILLED_IN_BELOW
