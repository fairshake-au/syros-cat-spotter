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

## Restoring to a point in time

Neon's restore window on `production` is **7 days** (the paid "Launch" plan; the plan's Part C.3 sets this when the project is created). In the Neon console: **Branches** → `production` → **Restore**, pick a timestamp, and Neon creates a new branch at that point rather than mutating `production` in place — so a restore is reviewable before anything is pointed at it. For anything bigger than a point-in-time restore (the old database intact, testers' new Neon rows carried back), that's the rollback procedure in the plan's Part F, run through `db-ops`'s `carry-back-dry-run`/`carry-back-apply` commands, never by hand.

## Read-only checks without a connection string

The Neon MCP's `run_sql` (SELECT only), `describe_table_schema` and `list_branches` work without a connection string, so Claude uses them as an independent second look after any `db-ops` write. Writes to Neon never go through the MCP — always through `db-ops`, so every change is in the workflow's history.
