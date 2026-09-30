# Neon database (SYC-121)

**Full design:** `docs/superpowers/plans/syc-121-neon-switchover.md`. This runbook is the short version: where things live, running `db-ops`, resetting the development branch, and restoring to a point in time.

## Where things live

One Neon project, `syros-cat-spotter`, region `aws-eu-central-1` (Frankfurt), Postgres 16, organisation `org-gentle-king-11293783`.

| Branch | What it's for | Who writes to it |
|---|---|---|
| `production` | The live app reads and writes here (through `APP_DATABASE_URL`, pooled) | The app, and `db-ops` for migrations |
| `development` | The Replit workspace's database (`DEV_DATABASE_URL`), reset from `production` whenever it's wanted | The workspace, `post-merge.sh`, `db-ops` |
| `rehearsal` | Stands in for the old Replit database when a rollback's carry-back is rehearsed. Never the real one | `db-ops` rehearsals only |

Every connection string lives in exactly one place (never in chat, a file, a commit, or Linear): the five destinations in the plan's Part A.2 table (GitHub Environments `production`/`development`, and the new Replit project's workspace and deployment secrets).

## Running `db-ops`

Claude triggers the workflow and reads its log — nobody types a database command by hand:

```
gh workflow run db-ops.yml --ref main -f target=production -f command=migrate
gh run watch
gh run view --log
```

`--ref main` is always given (see the plan's Part A.3 for why). `target` is `development`, `rehearsal` or `production`. `command` is one of: `fingerprint-source`, `copy-rehearsal`, `copy-cutover`, `verify`, `migrate`, `migrate-rollback`, `smoke`, `carry-back-dry-run`, `carry-back-apply`.

The workflow never prints a connection string — only host names, counts and hashes. If a log ever shows one, that's a bug: stop and fix `scripts/db-ops.sh` before running it again.

## Resetting the development branch

If `migrate` refuses the Neon `development` branch ("cannot be adopted", or "the database is ahead of this code"), it's disposable: Neon console → **Branches** → `development` → **Reset from parent**. This replaces the old "drop the `public` and `drizzle` schemas by hand" advice — Neon's reset does the same thing without touching `production`. Then run `migrate` again (or let the next Git-pane pull's `post-merge.sh` do it).

**Never reset `production`.** There, fix drift by hand, guided by the differences `migrate` prints.

**Resetting `rehearsal` before re-running the switchover plan's Part D (added 30 Sep):** the plan's D.8 recovery drill ends with `rehearsal` in a "cut over" state that both copy commands refuse, and `rehearsal` (a child branch) can't be restored from a snapshot the way `production` can (see "Snapshots and restores only work on a root branch" below, under "Restoring to a point in time"). Before a re-run, reset it from `production` the same way as `development` above — Neon console → **Branches** → `rehearsal` → **Reset from parent**, or delete and recreate it. This discards `rehearsal`'s contents, so get Samuel's OK first, same as any other data-discarding step.

## Restoring to a point in time

**Two different things are both called "restore" here — they behave differently, and this runbook used to blur them (corrected after the Fable review, 30 Sep):**

- **A point-in-time restore to a new branch** (Neon console: **Branches** → `production` → **Restore**, pick a timestamp): Neon creates a **new, separate branch** at that point, leaving `production` untouched. Nothing is pointed at it until someone decides to — it's reviewable first, and nothing about `production`'s connection string or password changes, because `production` itself hasn't moved.
- **`restore_snapshot` onto `production`** (the plan's Part D/E/F recovery route, via `db-ops`/the Neon MCP): this **swaps `production` in place** — a new branch id takes over the `production` name and the pooled endpoint, and the replaced branch is kept as "`production (old)`". **This changes the `neondb_owner` password** (see below), which a plain point-in-time restore to a new branch does not.

Neon's restore window on `production` is **7 days** (the paid "Launch" plan; the plan's Part C.3 sets this when the project is created). For anything bigger than a restore (the old database intact, testers' new Neon rows carried back), that's the rollback procedure in the plan's Part F, run through `db-ops`'s `carry-back-dry-run`/`carry-back-apply` commands, never by hand.

**Snapshots and restores only work on a root branch.** `production` is a root branch; `rehearsal` and `development` are children of it and can't take or restore a snapshot directly (found in the 30 Sep dress rehearsal, when the plan's D.8 drill had to move from `rehearsal` to `production` for this reason — see the plan's Part D.8 and A.1). Plan any snapshot-based recovery against `production` itself.

---

## Dress rehearsal findings (30 Sep 2026) — snapshot restores, secrets, and logs

*Kept as its own section, separate from any concurrent edits to the sections above and to `db-ops.sh`/`db-ops.yml`, so it merges cleanly alongside other in-flight runbook changes (see this PR's description).*

### A snapshot restore onto `production` changes the `neondb_owner` password

Confirmed twice on 30 Sep, including a clean repeat with no password reset in between: restoring a Neon snapshot onto `production` swaps in a **new branch id** and leaves the saved connection string's **password no longer valid**, even though Neon's own docs say the connection string is kept. The pooled endpoint (`ep-fancy-union-b1al1ulz`) and its hostname are unaffected — only the branch id and the password change. The replaced branch is kept by Neon under the name "`production (old)`" (a second restore in the same session can leave "`production (old) (1)`" too).

**After any restore onto `production`, before running `db-ops` or republishing Replit again:**

1. **Claude, via the Neon MCP:** verify the restored `production` **read-only** with `run_sql` first — row counts match the last-known-good fingerprint, `switchover.rehearsal_marker` present, `switchover.cutover_done` absent.
2. **Claude, via the Neon MCP:** **rename** (never delete) the leftover "`production (old)`" branch to `pre-restore-<attempt>-<hhmm>` (`list_branches`, then rename). **Don't delete it here** — it can be the parent of a kept archive or recovery branch, and Neon refuses to delete a branch with children. It's deleted only at E.13/G.1, with Samuel's OK.
3. **Claude, via the Neon MCP:** re-set `production`'s compute to **0.25–1 CU, suspend after 300 s** — a restore resets the endpoint's autoscaling max to **8 CU**.
4. **Samuel:** open Neon Connect for **Branch: production** twice — pooling **off** into GitHub `production` environment secret `NEON_PROD_DIRECT_URL`; pooling **on** into **the EU (new) project's** deployment secret `APP_DATABASE_URL` (Neon Connect gives `sslmode=require`; change it to `verify-full` after pasting, as in the plan's C.4) — then **republish the EU project. Never the old project** (the domain may have just been reconnected to it, which makes "the live Replit project" ambiguous — it always means the EU one here).
5. **Claude:** wait for a **new instance start-up** log line (the start-up log from `lib/db` §B.2 in the plan) before judging anything — Replit's autoscale can keep serving the previous instance for a minute or two after a republish — then run `smoke`. **If `apptest.catspotters.com` isn't currently pointed at the EU project** (true for most of a rollback recovery), pass `-f base_url=<the EU project's own *.replit.app address>` — otherwise `smoke` resolves against whichever project the domain is on right now and can fail misleadingly.

Do the steps above in order: the dress rehearsal's first live run took **~26 minutes** because the first Replit paste came from a stale look-alike branch name and a republish happened before the paste landed. Done in order, it's **estimated at ~5 minutes** — not yet measured end to end. This procedure is a **fallback**: see the plan's A.1 and F.1 for when it's needed versus when the cheaper path (fingerprint/verify with no re-paste, `production`'s protection switched off for the cutover window) is tried first.

### SSL root certificate for `pg_dump`/`pg_restore` (PR #33)

`pg_dump`/`pg_restore` running on the GitHub Actions runner need an explicit CA file for `sslmode=verify-full`/`verify-ca` — unlike Node's `pg`, libpq doesn't fall back to a system trust store automatically, and without one `pg_restore` fails with `root certificate file "/home/runner/.postgresql/root.crt" does not exist`. `db-ops.sh` now sets `PGSSLROOTCERT=system` for any verify-full/verify-ca connection before calling `pg_dump`/`pg_restore`, which tells libpq to use OpenSSL's own system trust store (Neon's certificates are publicly trusted, so this is sufficient).

### Reading `db-ops` logs: redact connection strings, don't drop lines about "password"

During the rehearsal, a log filter that dropped any line containing the word "password" hid the real Neon authentication error (`password authentication failed for user 'neondb_owner'`) — the line was dropped because it *mentioned* "password" in the error text, not because it contained a credential. **Redact by pattern-matching the connection-string shape itself** (the existing `postgres://`/`postgresql://` grep in `db-ops.sh`'s own output check does this correctly), never by dropping any line that merely contains a word like "password". A dropped diagnostic line can hide the actual cause of a failure.

### What carry-back does, and when it refuses

Carry-back makes the nine original tables in the old database match Neon `production`, table by table and row by row. It adds the rows testers created, updates the rows they changed, and removes the rows they deleted. Columns and tables the old database doesn't have stay on Neon, and the dry run lists them. All of this happens in one transaction, which commits only if the old database then matches Neon exactly, with its id counters moved past every id either side has used. The dry run prints ids only. Device ids appear as a short one-way hash (`#1a2b...`), and it never prints row contents, secret hashes or connection strings.

It refuses, without writing anything, when:
- **the old database changed since the copy** in a table it would write to. Every copy stores the old database's fingerprint with its marker on Neon. If the old app wrote rows after the copy, those rows could share ids with testers' rows (an id collision), and mirroring would overwrite or delete them. Recover those by hand (plan F.3).
- the old database has a column Neon lacks, so it isn't at the baseline schema (R0);
- the target carries `switchover.cutover_done` (it's a cut-over Neon branch, not the old database), or the source has no switchover marker, or source and target are the same database;
- `carry-back-apply` is run without `confirm=APPLY`.

Re-running it is safe. A failed apply changes nothing, and a second apply after a successful one finds nothing to do. If testers write on Neon again after an apply (say, before the domain move finished), a second pass carries those back too. After each successful apply, carry-back records what it left in the old database, in a small `switchover.carry_back_done` table outside the app's own tables. It creates this only when applying, never in a dry run. Anyone else's writes to the old database are still refused.

Where a cat name or username moves between rows (a rename and a new cat taking the old name, or two usernames swapped), carry-back briefly sets the unique indexes aside and rebuilds them exactly, all inside the same transaction. It doesn't do this for unique *constraints*. The baseline has none, and the old database's schema is never changed (R0).

### Aftercare checks after cutover (plan E.13)

At T-live plus 1 hour, 1 day and 7 days, and before the old database is deleted (G.1), run:

- `db-ops -f target=production -f command=fingerprint-source`: the old database must be unchanged since the copy (compare it with E.5's).
- `db-ops -f target=production -f command=carry-back-dry-run`: read-only on both sides. It prints exactly what testers have changed on Neon since cutover (what a rollback would carry back), and it confirms the old database is still unchanged since the copy.

Don't use `verify` for this. It compares Neon with the old database row for row, so it fails as soon as testers have written anything on Neon.

## Read-only checks without a connection string

The Neon MCP's `run_sql` (SELECT only), `describe_table_schema` and `list_branches` work without a connection string, so Claude uses them as an independent second look after any `db-ops` write. Writes to Neon never go through the MCP — always through `db-ops`, so every change is in the workflow's history.
