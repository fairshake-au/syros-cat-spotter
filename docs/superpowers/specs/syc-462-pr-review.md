# Adversarial review: PR #237 (SYC-462)

**Reviewer:** Sonnet subagent, run in its own worktree. **Date:** 19 October 2026. **Head reviewed:** `1af110c7`.

*The author's session committed this review verbatim, condensed for length with every finding kept. How each finding was handled is in the "Disposition" section at the end.*

## Verdict

Do not merge as it stands. Two Majors need fixing first (F1, F2); the rest can be fast-follows.

These held up, and the reviewer couldn't refute them:
- the migration;
- the code that reads photos;
- the lock ordering;
- the carry-back change.

lib/db photoRemoval suite: 48/48 on this head.

## Findings

**F1. Major.** Running `photo-remove` again after a NOT GONE run reports GONE (exit 0), which hides a leftover copy.

On the "already removed" path, `searchFor` gets `bytes: null`, and the bytes line becomes `ok: true` with the note "checked during the removal run". The removal commits before the result is known, so a NOT GONE first run is followed by GONE on the second.

The reviewer proved this with a throwaway probe:
- setup: a `zz_copy` table holding the picture's base64;
- first run: `removed NOT GONE`;
- second run: `already GONE`.

The runbook's advice "NOT VERIFIED … run photo-remove again" leads straight into this.

**F2. Major (runbook).** The old Replit database isn't in step 10 or in the "up to [N] days" of the reply.

It keeps the picture's bytes until it's deleted (spec §3.4: cutover + 30 days). Carry-back only blanks the bytes if someone runs it. So N can be too small.

**F3. Minor.** A scan timeout inside the removal's transaction fails with a misleading message, and the bytes NOT VERIFIED branch can never run.

`timed()` catches the timeout (57014), then runs `reset statement_timeout` in a transaction that has already aborted. The probe with `timeoutMs: 1` showed:
- it throws "current transaction is aborted";
- nothing changes (safe);
- the CLI exits 1, not 4.

Fix: use `set local` or a savepoint, and give the operator a clear message.

**F4. Minor.** Nothing tests how `db-ops.sh` passes `PHOTO_ID_CONFIRM` through.

The reviewer changed the script to fill the confirmation from `PHOTO_ID`, and the tests stayed green. The CLI's own check is tested.

**F5. Minor (unverified).** `variantFor`'s conditional insert isn't airtight under READ COMMITTED.

Its EXISTS sees the old snapshot while the removal holds the row lock. The foreign-key check then waits for the removal to commit, and the insert goes through.

The re-check after commit catches the leftover version, but reports it as NOT GONE, which is a false alarm.

Fix: lock the photo row `for key share` before inserting.

**F6. Nit (unverified).** `photoState`'s subqueries run in the same statement as `FOR UPDATE`, so they read the snapshot from before the lock wait.

A restore that commits while the removal waits could be overridden. `hide.ts` has the same pattern.

Fix: take the lock first, then read the state.

**F7. Minor.** Public-log gaps the code can't close:
- the workflow inputs (`photo_ref` and the rest) appear on the public run page before the CLI validates them;
- `photo-list` builds up a public record of which cats had privacy requests.

**F8. Minor.** A `photo_private` report on its own makes a photo eligible, even if it was hidden for another reason.

The team's approval is still required.

**F9. Nit.** T13 checks only the api-server's `.ts` text, so it misses raw SQL and aliased imports.

The reviewer's grep of the whole repo found no unguarded reader of the picture.

## Mutations the reviewer tried

| What was broken | Caught? |
|---|---|
| The CLI's confirm check | Yes: `cli.test.ts` went red |
| `db-ops.sh` filling the confirmation from `PHOTO_ID` | **No**: the tests stayed green (F4) |
| The migration trigger's condition | Yes: T0c went red |

## Verified correct

- **Migration and journal:**
  - 0034's `prevId` is 0033's `id`;
  - idx 34 follows idx 33;
  - only `photos` differs between them.
- **Readers of the picture:** all of them handle a removed photo; nothing writes `data` back.
- **Locks:** no deadlock cycle between `removePhoto`, `setPhotoVisibility` and `issues/hide`.
- **Hot paths:**
  - `hiddenPhotoIds` adds one indexed `IN` query per call (no N+1);
  - `photoRemoved` is left out unless true, so the snapshots are unchanged.
- **Carry-back:** the projection only touches the projected reads of `photos.data`, and is a no-op for rows that have data.
- **CLI and db-ops:** the CLI and `db-ops.sh` flow is correct.
- **Runbook:** matches the code, apart from F1 and F3.

**Unverified:**
- whether the old Replit database still exists;
- whether `NEON_PROD_URL` is pooled or direct (a session-level `set` outside a transaction would be unsafe on a transaction-mode pooler).

---

## Disposition (added by the author, 19 October 2026)

| # | Severity | Disposition |
|---|---|---|
| F1 | Major | **Fixed.** On a re-run after removal, the byte check is `not_verified`, because the fingerprint only exists during the removal run. The CLI prints "ALREADY REMOVED", never GONE, and points to the removal run's log. Its exit code is 0 only if every other check passes, and 3 if any fails. Test: NOT GONE, then a re-run that still isn't GONE. The runbook is reworded. |
| F2 | Major | **Fixed (runbook).** Step 10 now lists the old Replit database and its deletion date, with a decision: wait for it to be deleted, or blank the picture there through Samuel. The reply's N counts it. |
| F3 | Minor | **Fixed.** The scan runs under a savepoint with `set local statement_timeout`. A timeout inside the removal rolls the whole removal back and returns `timed_out`: nothing changes, the exit code is 4, and the message says so. Outside a transaction, each scan runs in its own short transaction. That also settles the pooled-connection doubt, since nothing session-level is set. A test covers it. |
| F4 | Minor | **Fixed.** New db-ops tests: `photo-remove` with `CONFIRM=REMOVE` and a missing or mismatched `PHOTO_ID_CONFIRM` is refused, and the row is unchanged. |
| F5 | Minor | **Fixed.** `variantFor` saves inside a transaction after `select … for key share` on the photo row, re-checking `data is not null` once the removal's lock is released. |
| F6 | Nit | **Fixed.** `removePhoto`, `hidePhotoForPrivacy` and `restorePhoto` take the photo-row lock in one statement, then read the state in the next. |
| F7 | Minor | **Accepted.** The approved spec weighs this (§5.1). The input description already says "Never a name". The runbook gains a line: check `photo_ref` before dispatching. |
| F8 | Minor | **Accepted.** This is Decision 3 as approved (a `photo_private` report counts). Runbook step 3 now spells out that the approver confirms the photo shows a person or a private place. |
| F9 | Nit | **Accepted.** The reviewer's repo-wide grep confirms there's no gap today. |
