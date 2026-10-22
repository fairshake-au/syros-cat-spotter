# SYC-44 PR 8.1 review (Sonnet, adversarial)

**Head SHA reviewed:** 632445ff3304e6b03cc509001d6a48e0e4a755c4. Reviewed in its own worktree (`.claude/worktrees/agent-a74bfbe35aa0790d9`), read-only. The reviewer did not run the suite, so its findings come from reading the code and the plan.

**Verdict:** Approve. No blocker and no major issue. The SQL does what the plan says and clears no more than it should. There is no place where the note text survives that the plan meant to cover. Four minor or nit points follow.

| # | Severity | Summary | Status / evidence | What was done |
|---|---|---|---|---|
| F1 | Minor | The queue and the row page show "Nothing written" for a cleared note, because nothing reads `note_cleared_at` | CONFIRMED: `lib/issues/queue.ts:132-183`, `teamPages/queuePage.ts:314-319` | **Filed** as its own ticket. The queue page belongs to #276 right now |
| F2 | Minor | A closed content row with a null `state_changed_at` is never swept | PLAUSIBLE: `retention.ts:38`. No real code path produces such a row | **Fixed**: the age is counted from `coalesce(state_changed_at, created_at)`, with a test |
| F3 | Minor | `lastSweep` is set before the work runs, so one failure delays the clean-up by 24 hours | CONFIRMED: `retention.ts:52-57` | **Fixed**: the `catch` resets the guard, so the next drain tries again |
| F4 | Nit | No test that the drain calls the sweep; no test for a row with no notes | CONFIRMED | **Fixed**: a route test in `internalMail.test.ts`, and a test for the no-notes row |
| F5 | Note | "Photo hidden" alert emails already sent to the shared inbox contain the reporter's note | CONFIRMED: `lib/issues/alertEmail.ts:90` | **Noted on SYC-248** (privacy wording). Outside this PR |

## What the reviewer checked and found correct

- **Scope.**
  - Only `kind = 'content'` rows in `done` or `nothing_needed` are swept, and only once they have been closed for more than a year.
  - Welfare rows and open rows are left alone.
  - Drafts can't be closed (`welfareActions.ts:108-115`).
- **A report reopened while the sweep runs.** The state check is evaluated again under the row lock, so the reopened report is skipped.
- **Every real close stamps `state_changed_at`** (`welfareActions.ts:108`). That includes Keep hidden and Restore.
- **No copies of the note elsewhere.**
  - `mail_outbox` payloads hold no note: the alert email's body is rebuilt from the live row when it is sent.
  - The digest lists no notes.
  - `report_state_events.reporter_message` is for welfare reports only.
  - `photo_visibility_events.reason` holds the reason key, not the note.
- **Nulls.** `team_note_by` and `team_note_at` are cleared along with `team_note`. No check constraint ties them together. The queue page shows "None yet" when they are empty. If someone writes a team note on a closed report after it has been cleared, it goes on the next run.
- **Time.** `interval '1 year'` counts calendar years, so a leap day is handled. Daylight-saving shifts move the line by an hour at most.
- **The drain.**
  - The sweep runs after the overdue-welfare check, and it never throws, so the drain's status code is unchanged.
  - Several servers or a restart only run it again, which changes nothing the second time.
- **Speed.** The `(kind, state, created_at)` index narrows the daily scan. That is fine at island scale.
- **Repo rules.** No migration. `docs/specs/privacy-policy.md` is untouched.

## F1. Cleared notes look like "Nothing written"

A closed report that is more than a year old shows "Nothing written" on the Issues queue, so the team can't tell an empty report from a cleared one. Fix: select `note_cleared_at` and show something like "Cleared after a year". Deferred to its own ticket.

## F2. Closed rows with a null `state_changed_at`

`state_changed_at < …` is false when the column is null, so such a row would keep its notes for ever. Only hand-written data can produce one. Fixed by falling back to `created_at`, which errs towards clearing.

## F3. A failure delayed the next try by a day

Fixed: the guard resets on failure, so the next drain (about 2 hours later) tries again.

## F4. Test gaps

Before the fix, deleting the drain hook passed every test. A route test now seeds a closed issue that is two years old, drains, and checks that its notes are gone.

## F5. Sent emails are outside this clean-up

`buildIssueAlert` puts the reporter's note in the "Photo hidden" email to the shared inbox. That copy stays in the mailbox after the database clean-up. SYC-248's wording shouldn't promise more than the database clean-up does.
