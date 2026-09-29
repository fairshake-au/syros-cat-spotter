# SYC-121: moving the database to Neon, switchover plan (for approval)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to build Part B task by task. Steps use checkbox (`- [ ]`) syntax. **Parts C to F are a live-data runbook.** Nobody improvises there: follow rule R0 below.

**Ticket:** SYC-121. **Decision behind it:** Samuel, 29 Sep 2026, on SYC-121: Neon, Frankfurt (`aws-eu-central-1`), on the paid pay-as-you-go ("Launch") plan from day one. The evidence is SYC-102: Replit's publish rewrites the live database structure itself, and for one change its plan was `TRUNCATE ... CASCADE`.
**Depends on:** the SYC-113 gates build PR (plan `docs/superpowers/plans/syc-113-pre-launch-gates.md`, merged as #27). SYC-98 (#24) is optional (§A.6).
**Changes how these reach production:** data spine (#23), SYC-43 part 1 (merged plan, #20), SYC-63 (#21). See Part H.
**Nothing in this plan has been done yet.** No Neon project exists, nothing has been published, and no secret has been set.

**Goal:** the live test app reads and writes a Postgres database we control, in Frankfurt, served from Replit's Europe region. Every tester's data comes across intact, and the old setup stays whole as the way back.

**Architecture:** a new Replit project (a "remix" of today's), published once in Replit's Europe region and pointed at Neon. Today's project and its database are frozen and never changed. Cutover means copying the data across during a short pause, checking it, and then moving the `apptest.catspotters.com` address from the old project to the new one. Rolling back means moving the address back. Database commands that Claude runs go through one manually triggered GitHub Actions workflow, whose secrets live in GitHub Environments. Claude never sees a connection string.

**Tech stack:** Postgres 16 (Neon, and Replit's today), node-postgres (`pg` 8.22) with Drizzle, the SYC-64 migration runner (`lib/db/src/migrate`), `pg_dump` and `pg_restore` 16, GitHub Actions, Replit Deployments (autoscale).

---

## In plain English

- **What changes for testers:** one pause of about an hour, announced in advance. After it, the website asks for the new tester password once, and everything they've spotted is still there. Store builds carry their own key and notice nothing.
- **What changes underneath:** the app moves to a copy of the project running in Europe, and the database moves to Neon in Frankfurt. The two sit side by side, so each request stays fast. Replit's publish step can no longer touch our database's structure, because our database isn't Replit's any more.
- **What stays safe:** today's Replit project and its database are **not changed at all**: no edits, no publishes, no deletions. They sit untouched until a date Samuel picks, at least 30 days after the move. If anything goes wrong, the web address goes back to the old project in one move, and anything testers added on Neon in the meantime is copied back.
- **How we know it will work:** we do the whole thing once as a dress rehearsal on a spare copy first, including the rollback, and time it. The real move happens only after the rehearsal passes.
- **What Samuel does:** about a dozen short steps in Replit, Neon and GitHub (Part C), mostly pasting a connection string into a secrets box and clicking Publish. Samuel never has to type a database command.

## The finding that shaped this plan

**Replit can't move a published app to another region.** From Replit's docs ("Publishing Geography"): *"Geography cannot be changed after publishing."* The documented route is to remix the project and publish the remix in the new region. The Replit agent confirmed this read-only on our Repl on 29 Sep. Its answer also covered what a remix carries over:

| Carries over to a remix | Doesn't |
|---|---|
| All files and configuration, and the checkpoint history | The deployment itself, and deployment-only secret overrides |
| Workspace secret **values** (it's our own app) | Custom domains (they're moved separately: Publishing → Domains) |
| | The managed database: the remix gets a fresh, empty one |
| | Connector settings. The OpenAI integration isn't guaranteed, so it's checked |
| | The GitHub link isn't guaranteed either, so it's checked |

So "republish in the EU region" in SYC-121 and SYC-113 means **publish a new project**. That is more setup, but it gives the cleanest rollback there is: the old project, with its code, its database and its region, stays exactly as it is today, and going back is moving one web address.

**Other facts checked for this plan (29 Sep, read-only):**

- Replit's production database runs **Postgres 16.15**, dev runs 16.10, and the workspace's `pg_dump` is 16.10. CI uses `postgres:16`. So Neon is created on **Postgres 16**, and every tool agrees on the version.
- `DATABASE_URL` is Replit-managed. A custom secret can be set for the workspace and **separately for the deployment**, under Publishing → Adjust settings → secrets. The Replit agent couldn't see our settings form, so the exact label is confirmed during Part C.
- The live deployment is **autoscale** and **Password protected**. Its region and maximum instance count aren't visible to any tool, so Samuel reads them (C.1).
- Unpublishing doesn't delete the database, but it does remove custom-domain links.
- The Replit agent **could not confirm** that Replit stops comparing databases on publish once the app stops using its managed database. So we don't rely on that. The new project never writes to its managed database, and the old project is never published again.
- Neon: organisation `org-gentle-king-11293783` has one project, `fair-shake-compliance` (Sydney, Postgres 17). It's unrelated and nobody touches it. `aws-eu-central-1` (AWS Europe Central 1, Frankfurt) is available. The organisation is on the free plan today (6-hour restore window).

## Scope

**In scope:** the code change so the app reads a database address we control (Part B); the Neon project and its branches; the new EU project; secrets; the copy, checks and cutover; switching to Public with the SYC-113 gates in the same move; rollback, including carrying testers' new data back; retention of the old database; documentation; and how later migrations reach production.

**Out of scope:** photos moving out of Postgres (SYC-46, D1 still holds for photos); `api.` and `team.` hostnames (SYC-32); the Postgres rate-limit store (SYC-105 item 2); changing the SYC-113 gate design.

## The rules for Parts C to F

- **R0 · Stop, don't improvise.** If any check fails, or anything happens that this plan doesn't describe, **roll back to the last safe point first (the table in Part F), then investigate.** No hand fixes to live data mid-run, no retries with changed flags, no "it's probably fine". A step is retried only if the plan says it can be.
- **R1 · Replit's databases are never written to.** Not the old project's production or dev database, and not the new project's managed one. Every connection our tooling makes to Replit production is opened **read-only at the session level** (`PGOPTIONS='-c default_transaction_read_only=on'`), so Postgres itself refuses a write. The one exception is the carry-back in a rollback (F.3), which needs Samuel's explicit go-ahead in chat and writes only what the dry run listed.
- **R2 · The old project is never pulled, published or reconfigured**, apart from its custom domain being moved away and, in a rollback, back. Its workspace isn't opened for work.
- **R3 · Never approve a Replit database review.** If Publish in either project ever shows a database review, especially one with `TRUNCATE` or `DROP` on a table with rows, **cancel it** and tell Claude. After this plan, a review can only mean something is wrongly using Replit's database.
- **R4 · Secrets never pass through chat, files, commits, Linear, or Claude's tools.** Samuel copies each connection string from the Neon or Replit console straight into a GitHub or Replit secrets box. Claude doesn't call the Neon MCP's `get_connection_string`. Claude runs database commands only through the `db-ops` workflow (Part B), whose logs never print a connection string (§B.4).
- **R5 · Production is empty until cutover, and written only once by the copy.** The copy tool refuses a production branch that already holds cutover data (§B.3).

---

## Part A · The shape of the switchover

### A.1 Neon layout

One Neon project, created by Claude through the Neon MCP **after this plan is approved and Samuel has upgraded the plan** (C.2):

| Thing | Name | Notes |
|---|---|---|
| Project | `syros-cat-spotter` | Region `aws-eu-central-1` (Frankfurt), **Postgres 16**, organisation `org-gentle-king-11293783` |
| Database | `neondb` | Neon's default. Owner role `neondb_owner` |
| **Production** | branch **`production`** (the root branch, renamed from Neon's default `main`) | **Empty until cutover** (R5). Protected branch if the plan offers it. Compute 0.25 to 1 CU, suspends after 5 idle minutes (decision Q4). Restore history set to **7 days** |
| **Development** | branch **`development`**, a child of `production` | The Replit workspace's database. Starts empty, gets its schema from `migrate`, and after cutover is **reset from `production`** (same address, now holding a copy of the real data). Reset again whenever it's wanted |
| **Rehearsal** | branch **`rehearsal`**, a child of `production` | Where every dress rehearsal is restored. Emptied between rehearsals by "reset from parent", which keeps its address the same, so its secret is pasted once |
| **Archive** | branch **`replit-final-<yyyymmdd>`**, made from `production` at cutover, **before** the app goes live | A frozen copy of exactly what came from Replit, never connected to the app. Kept until the retention date (Part G) |

CI keeps its own throwaway `postgres:16` service container and never touches Neon. Local development keeps using a local `DATABASE_URL`.

### A.2 Where each connection string lives

Every value is copied by Samuel from the console and pasted straight into the box named here (R4). Nothing else holds them.

| Secret | Where it's set | What it points at | Used by |
|---|---|---|---|
| `APP_DATABASE_URL` | New Replit project → **deployment** secrets | Neon `production`, **pooled** (`-pooler` host) | The live app |
| `DEV_DATABASE_URL` | New Replit project → **workspace** secrets | Neon `development`, **direct** | The workspace app, post-merge `migrate`, the api tests run in the workspace |
| `NEON_PROD_DIRECT_URL` | GitHub → Environment **`production`** | Neon `production`, direct | `db-ops`: copy, migrate, verify, carry-back |
| `NEON_REHEARSAL_DIRECT_URL` | GitHub → Environment **`production`** | Neon `rehearsal`, direct | `db-ops` rehearsals |
| `REPLIT_PROD_DATABASE_URL` | GitHub → Environment **`production`** | The **old** project's Replit production database | `db-ops`: fingerprint and dump (read-only sessions, R1), and carry-back only in a rollback |
| `NEON_DEV_DIRECT_URL` | GitHub → Environment **`development`** | Neon `development`, direct | `db-ops` against dev |
| `PRELAUNCH_TESTER_KEY` | GitHub → Environment **`production`** | The SYC-113 tester key (same value as in EAS) | `db-ops smoke` through the gate |

**Pooled for the app, direct for everything else** (Neon's guidance): migrations, `pg_dump`, `pg_restore` and the carry-back use session features, and the pooler runs in transaction mode. The app itself holds no session state (it uses plain queries and `db.transaction`), so the pooler suits it.

**SSL:** every Neon string uses `sslmode=verify-full`, which `pg` 8.22 treats as full certificate checking anyway, and Neon's certificates are public. If `pg` rejects the `channel_binding=require` parameter Neon adds, it's removed from the string. The rehearsal proves the exact form (D.4).

The **GitHub Environments** are restricted to the `main` branch ("Deployment branches: main only"), so a pull request's workflow can't read them.

### A.3 Where database commands run: the `db-ops` workflow (recommended; decision Q2)

Claude triggers a manual GitHub Actions workflow and reads its log:

```bash
gh workflow run db-ops.yml -f target=production -f command=migrate
gh run watch
gh run view --log
```

It's one workflow, `.github/workflows/db-ops.yml`, with a fixed list of commands (§B.4) and a `target` of `development`, `rehearsal` or `production`. The job checks out `main`, installs `postgresql-client-16`, and runs the command with the target's secret mapped to `DATABASE_URL` for that one step. Runs on the same target queue one behind another (a `concurrency` group), because the runner's lock waits indefinitely if two `migrate` runs overlap (data spine review R15).

Why here, not the Repl shell: Claude can run it end to end without Samuel acting as the executor. It's recorded (every run has a log and a commit). The secrets are write-only and masked in logs. And it's the same route for the copy, migrations, checks and the #20 `people` command. The Repl shell would need Samuel to type every command, and Replit's agent can't set secrets.

**Read-only checks can also go through the Neon MCP** (`run_sql` with `SELECT` only, `describe_table_schema`, `list_branches`). They don't need a connection string, so Claude uses them as an independent second look after each step. **Writes to Neon never go through the MCP.** They go through `db-ops`, so every change is in the runner's history or a workflow log.

### A.4 How migrations reach production after the move

**The #13 runner is the production route. Replit's publish carries code only.**

1. A PR with a migration merges to `main`. CI has already run `migrate:check` and the up/down/up tests.
2. **Development:** Samuel's next Git-pane pull in the new project runs `scripts/post-merge.sh`, which runs `pnpm --filter @workspace/db run migrate` against `DEV_DATABASE_URL`. Or Claude runs `gh workflow run db-ops.yml -f target=development -f command=migrate` without waiting for a pull.
3. **Production, before the code that needs it is published:** Claude runs `gh workflow run db-ops.yml -f target=production -f command=migrate`, which runs `pnpm --filter @workspace/db run migrate` over the direct connection, then `-f command=verify`.
4. Samuel pulls in the new project's Git pane and publishes. R3 applies: a database review means stop.
5. Claude runs `-f command=smoke` (health check, cats and a photo, sent with the tester key).
6. Rollback of a migration: `-f command=migrate-rollback` (the runner's `migrate:rollback`), taking a Neon snapshot first when real data is affected. Neon's 7-day restore is the backstop.

`docs/DEPLOYMENT.md` §C is rewritten to this by Part B. It replaces "run `migrate` against production first", which couldn't be done from Replit.

### A.5 What happens to Replit's databases

- **Old project, production database:** untouched until the retention date (Part G). It's read by `db-ops` (fingerprint and dump, read-only sessions) and written only by a rollback's carry-back.
- **Old project, dev database:** untouched. The old workspace is never pulled again (R2), so `post-merge.sh` never runs there.
- **New project's managed database** (the remix gets a fresh one): unused. The code refuses to use `DATABASE_URL` inside a Replit workspace or in production (§B.1), so nothing can fall back to it by accident, and its structure never changes. That leaves Replit's publish diff nothing to compare. Samuel declines "Copy data from original App" if the remix offers it, so tester data isn't copied into a database nobody looks after.

### A.6 What goes live at cutover

The new project publishes whatever `main` is at the time. That must include:

- **Part B's code** (the SYC-121 build PR), which is required.
- **The SYC-113 gates build PR**, which is required: switching to Public without the gates would expose exact cat locations and AI-matched uploads. Its deployment secrets (`PRELAUNCH_WEB_PASSWORD`, `PRELAUNCH_SESSION_KEYS`, `PRELAUNCH_TESTER_KEYS`) are set before the first publish of the new project. The tester key goes **only in EAS and in the GitHub `production` environment, never in Replit** (the website build refuses to run if it's set there). The Worker secret isn't needed yet (it's for SYC-83).
- **SYC-98 (#24)**, which is optional. If it's on `main`, the cutover's `migrate` applies its `0002` on Neon, which is the safe route. It isn't held back for this.
- Any other migration on `main` is applied by the cutover's `migrate`. **Nothing that needs a migration merges during the rehearsal-to-cutover window** unless it has been rehearsed (D.7).

The new project is published **Public with the gates on from its very first publish**, days before cutover, on its own `*.replit.app` address (C.6). The SYC-113 checklist is run there before any tester data is loaded into it. So on cutover day nothing about access changes: only the database copy and the web address move.

### A.7 Region and latency

The app and the database are both in Europe from the new project's first publish. There's no in-between state where an app in North America talks to Frankfurt: the old project never talks to Neon.

**If the new project were accidentally published outside Europe** (the choice is permanent), every database query would add about 100 ms. That's about 1 to 1.5 seconds on a sighting upload, which runs 10 to 15 queries one after another. It's usable for a short window but not as a standing state. C.6 therefore has a check before the first publish, and D.4 has one after it: the startup log's round-trip time to the database. If that time is above 20 ms, Samuel deletes that remix and makes a new one. No tester data is involved at that point.

**If Samuel prefers to move the database without moving the app** (for example, if C.1 shows the app is already in Europe), see decision Q1, option B.
