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
