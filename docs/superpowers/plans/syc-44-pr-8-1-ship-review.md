# SYC-44 PR 8.1 ship review (Sonnet, adversarial)

**Head reviewed:** `2b48463af5c8fe537cf182ee4d4e42d580bc7993`. The reviewer worked read-only in its own worktree (`.claude/worktrees/agent-a4a00b29aee3c850b`). Its findings come from reading the code. The builder ran the tests separately: 25/25 passed.

**Verdict: merge.** No blocker and no major. Two nits.

| # | Severity | Summary | Status | What was done |
|---|---|---|---|---|
| 1 | Nit | `note_cleared_at` is stamped on an old closed row even when it had nothing to clear, and `notesCleared` counts that row | CONFIRMED, `retention.ts:35-43` | **Kept on purpose.** The row is marked once as having been through the year's clean-up. The comment in `retention.ts` says so, and the test "stamped once, and only once" pins it |
| 2 | Nit | A team note written on an old closed report after its clean-up stays visible until the next daily run. A reopened report keeps its old `note_cleared_at` | CONFIRMED, `welfareActions.ts:217` | **Kept**, as `retention.ts` documents. Nothing reads `note_cleared_at` yet. Added to SYC-565, the ticket that will first read it |

## What the reviewer checked and found sound

- **The fallback to `created_at` can't clear a recently closed report.**
  - Only `moveReportStateIn` changes `state`, and it sets `state_changed_at` in the same update (`welfareActions.ts:107-108`).
  - No other writer changes `state`. The others are in `welfareTie.ts`, `hide.ts`, `severPerson.ts`, `reporterEmail.ts`, `issues.ts` and `reports.ts`. Neither does any migration or script.
  - Content rows only exist since migration 0023.
- **The retry after a failure.** The route is the only caller outside the tests, and the guard is set before the `await`. When the database is failing, the sweep retries once per drain: one cheap update and one log line. If the whole database is down, the drain fails before it reaches the sweep.
- **The new drain test.**
  - The row it inserts meets every check.
  - `cleanup()` removes it, through the `${DEVICE}` prefix.
  - Vitest's per-file module isolation stops the once-a-day guard leaking into other files.
  - No other test file that runs the drain seeds a closed issue older than a year.
- **Readers of the cleared fields** all handle nulls: `queue.ts:156`, `queuePage.ts:144,150,302,477`, `welfareQueue.ts` and `alertEmail.ts:90`.
- **Concurrency.** The sweep and the team's actions are single-row updates. Under READ COMMITTED, a report reopened first is skipped by the sweep. One cleared first has already passed its year.
- **The plan and CLAUDE.md.** It matches plan lines 511-523, with no migration and no terminology issues.
