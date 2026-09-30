# SYC-121: moving the database to Neon, switchover plan (for approval)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to build Part B task by task. Steps use checkbox (`- [ ]`) syntax. **Parts C to F are a live-data runbook.** Nobody improvises there: follow rule R0 below.

**Ticket:** SYC-121. **Decision behind it:** Samuel, 29 Sep 2026, on SYC-121: Neon, Frankfurt (`aws-eu-central-1`), on the paid pay-as-you-go ("Launch") plan from day one. The evidence is SYC-102: Replit's publish rewrites the live database structure itself, and for one change its plan was `TRUNCATE ... CASCADE`.
**Depends on:** the SYC-113 gates build PR (plan `docs/superpowers/plans/syc-113-pre-launch-gates.md`, merged as #27). SYC-98 (#24) is **not** in the cutover: it goes after the move (decision Q10, §A.6).
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
- **R2 · The old project is never pulled, published or reconfigured.** There are two exceptions. Its custom domain is moved away at cutover, and back in a rollback. And in the rehearsal only, the spare address `rehearsal.catspotters.com` is attached to it and removed again, to time a domain move (D.6). Neither is a publish or touches its database. Its workspace isn't opened for work.
- **R3 · Never approve a Replit database review.** If Publish in either project ever shows a database review, especially one with `TRUNCATE` or `DROP` on a table with rows, **cancel it** and tell Claude. After this plan, a review can only mean something is wrongly using Replit's database.
- **R4 · Secrets never pass through chat, files, commits, Linear, or Claude's tools.** Samuel copies each connection string from the Neon or Replit console straight into a GitHub or Replit secrets box. Claude doesn't call the Neon MCP's `get_connection_string`. Claude runs database commands only through the `db-ops` workflow (Part B), whose logs never print a connection string (§B.4).
- **R5 · Before cutover, Neon production holds nothing, or only a marked rehearsal copy. The cutover copy is written once.** Only an empty branch or one carrying the rehearsal marker can be wiped. After cutover, the copy tool refuses production outright (§B.3).

---

## Part A · The shape of the switchover

### A.1 Neon layout

One Neon project, created by Claude through the Neon MCP **after this plan is approved and Samuel has upgraded the plan** (C.2):

| Thing | Name | Notes |
|---|---|---|
| Project | `syros-cat-spotter` | Region `aws-eu-central-1` (Frankfurt), **Postgres 16**, organisation `org-gentle-king-11293783` |
| Database | `neondb` | Neon's default. Owner role `neondb_owner` |
| **Production** | branch **`production`** (the root branch, renamed from Neon's default `main`) | Until cutover it holds nothing, or a **marked rehearsal copy** (R5). The new deployment points here from its first publish, so cutover day needs no secret change. Protected branch if the plan offers it. Compute 0.25 to 1 CU, suspends after 5 idle minutes (decision Q4). Restore history set to **7 days**. **Snapshots can only be taken and restored on a root branch** (dress rehearsal, 30 Sep): `production` qualifies, `rehearsal` doesn't, which is why D.8's recovery drill runs its `restore_snapshot` steps on `production` itself, with Samuel's explicit approval, rather than on `rehearsal`. **A snapshot restore onto `production` swaps in a new branch id and changes the `neondb_owner` password** (the connection string's password no longer matches, confirmed twice, including in a clean test with no password reset in between). The **endpoint id (`ep-fancy-union-b1al1ulz`) and its pooled host stay the same** across a restore — only the branch id changes, and the replaced branch is kept as "`production (old)`". Because the id changes, nothing in this plan or `db-ops` refers to `production` by branch id; **anything that has recorded one is stale the moment a restore happens** (see the re-paste procedure in F.1) |
| **Development** | branch **`development`**, a child of `production` | The Replit workspace's database. Starts empty, gets its schema from `migrate`, and after cutover is **reset from `production`** (same address, now holding a copy of the real data). Reset again whenever it's wanted |
| **Rehearsal** | branch **`rehearsal`**, a child of `production` | Stands in for the **old Replit database** when the rollback's carry-back is rehearsed (D.5), so the real one is never written in a rehearsal. Emptied between rehearsals by the copy tool, and its address never changes, so its secret is pasted once |
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

**`DATABASE_TARGET`** is set in each place alongside the URL. It isn't a secret, so it's an Environment **variable** in GitHub and a plain setting in Replit: `production` in the deployment and in GitHub's `production` environment, `development` in the workspace and in GitHub's `development` environment. The `db-ops` job sets `rehearsal` itself when `target=rehearsal`, since that shares the `production` environment. Tools that write data by name, starting with #20's `people` CLI (PR #28), refuse to run unless `DATABASE_TARGET` matches the target they were asked for. So a seed can't land on the wrong branch because a URL was pasted into the wrong box.

The **GitHub Environments** are restricted to the `main` branch ("Deployment branches: main only"), so a pull request's workflow can't read them.

### A.3 Where database commands run: the `db-ops` workflow (decided: Q2)

Claude triggers a manual GitHub Actions workflow and reads its log:

```bash
gh workflow run db-ops.yml --ref main -f target=production -f command=migrate
gh run watch
gh run view --log
```

**`--ref main` is always given**, and the tables below write `db-ops -f …` as shorthand for exactly this command. The reason: the Environments' "main only" rule (A.2) is checked against the **ref the run is dispatched from**, not the `ref: main` the job checks out. Without `--ref`, `gh` dispatches from the repository's default branch, which happens to be `main` today. Pinning it means the secrets guard never depends on that setting, and a run dispatched from any other branch is refused by the Environment before it starts.

It's one workflow, `.github/workflows/db-ops.yml`, with a fixed list of commands (§B.4) and a `target` of `development`, `rehearsal` or `production`. The job checks out `main`, installs `postgresql-client-16`, and runs the command with the target's secret mapped to `DATABASE_URL` for that one step. Runs on the same target queue one behind another (a `concurrency` group), because the runner's lock waits indefinitely if two `migrate` runs overlap (data spine review R15).

Why here, not the Repl shell: Claude can run it end to end without Samuel acting as the executor. It's recorded (every run has a log and a commit). The secrets are write-only and masked in logs. And it's the same route for the copy, migrations, checks and the #20 `people` command. The Repl shell would need Samuel to type every command, and Replit's agent can't set secrets.

**Read-only checks can also go through the Neon MCP** (`run_sql` with `SELECT` only, `describe_table_schema`, `list_branches`). They don't need a connection string, so Claude uses them as an independent second look after each step. **Writes to Neon never go through the MCP.** They go through `db-ops`, so every change is in the runner's history or a workflow log.

### A.4 How migrations reach production after the move

**The #13 runner is the production route. Replit's publish carries code only.**

1. A PR with a migration merges to `main`. CI has already run `migrate:check` and the up/down/up tests.
2. **Development:** Samuel's next Git-pane pull in the new project runs `scripts/post-merge.sh`, which runs `pnpm --filter @workspace/db run migrate` against `DEV_DATABASE_URL`. Or Claude runs `gh workflow run db-ops.yml --ref main -f target=development -f command=migrate` without waiting for a pull.
3. **Production, before the code that needs it is published:** Claude runs `gh workflow run db-ops.yml --ref main -f target=production -f command=migrate`, which runs `pnpm --filter @workspace/db run migrate` over the direct connection, then `-f command=verify`.
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
- **The cutover's migrations are exactly `0000` (adopted) and `0001` (applied). Nothing else** (decision Q10, 29 Sep 2026). **SYC-98 (#24) is held unmerged until the cutover is done and verified (E.13's one-hour check).** Merging it earlier would put code that expects `photos.public_id` on `main`, and the new project runs `main`.
- **The migration queue after the move** (in the order agreed with the other sessions), each through A.4's route (development first, then production before its code is published):
  1. **#24, SYC-98** (`0002_photos_public_id`).
  2. **#28, SYC-43 part 1**: regenerated on top of #24's `0002`, so it takes the next free number.
  3. The rest, in the order already agreed: SYC-63 §5 (#21's migration), then data spine PR 3's backfill, and so on (`data-spine.md`'s sequence).
- The new project's first publish (C.6) and the cutover run the `main` at the time, which carries migrations only up to `0001`. **Nothing that needs a migration merges during the rehearsal-to-cutover window** unless it has been rehearsed (D.7).

The new project is published **Public with the gates on from its very first publish**, days before cutover, on its own `*.replit.app` address (C.6). The SYC-113 checklist is run there before any tester data is loaded into it. So on cutover day nothing about access changes: only the database copy and the web address move.

### A.7 Region and latency

The app and the database are both in Europe from the new project's first publish. There's no in-between state where an app in North America talks to Frankfurt: the old project never talks to Neon.

**If the new project were accidentally published outside Europe** (the choice is permanent), every database query would add about 100 ms. That's about 1 to 1.5 seconds on a sighting upload, which runs 10 to 15 queries one after another. It's usable for a short window but not as a standing state. So C.6 step 3 has a read-back before the first publish, and C.7 has a check after it: the start-up log's round-trip time to the database. If that time is above 20 ms, Samuel deletes that remix and makes a new one. No tester data is involved at that point.

**If Samuel prefers to move the database without moving the app** (for example, if C.1 shows the app is already in Europe), see decision Q1, option B.

---

## Part B · The code change (one PR: "SYC-121 build")

It's small and mechanical, apart from the carry-back tool. It's built in its own worktree off fresh `origin/main`, one commit per task, with the usual `/ship` review. **Merging it changes nothing live.** The old project is never pulled, and the new one doesn't exist yet.

### Global constraints

- Postgres 16 everywhere. `pg` stays at 8.22. No new runtime dependencies.
- Production (`NODE_ENV=production`) **fails closed**: no `APP_DATABASE_URL`, no start. It never falls back to `DATABASE_URL`.
- Nothing prints a connection string or a password, whether in logs, errors or test output. It prints the host name at most.
- Every connection a switchover tool opens to a Replit database is read-only at the session level, except the carry-back's `--apply` (R1).
- Existing tests keep passing unchanged. CI's `DATABASE_URL` path is untouched.

### Task B.1: one place decides which database to use

**Files:**
- Create: `lib/db/src/url.ts`, `lib/db/src/url.test.ts`
- Modify: `lib/db/src/index.ts`, `lib/db/src/migrate/cli.ts` (`withClient`, `migrationsBuildTheSchema`)

**Produces:** `resolveDatabaseUrl(env: NodeJS.ProcessEnv): { url: string; source: "APP_DATABASE_URL" | "DEV_DATABASE_URL" | "DATABASE_URL" }` and `describeHost(url: string): string` (the host only), both exported from `@workspace/db`, along with `databaseTarget: { source, host }`.

- [ ] **Step 1: write the failing tests** (`url.test.ts`, pure, no database):

```ts
import { describe, expect, it } from "vitest";
import { describeHost, resolveDatabaseUrl } from "./url";

const neonProd = "postgresql://u:p@ep-prod-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full";
const neonDev = "postgresql://u:p@ep-dev.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full";
const replit = "postgresql://u:p@helium/heliumdb";

describe("resolveDatabaseUrl", () => {
  it("production uses APP_DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ NODE_ENV: "production", APP_DATABASE_URL: neonProd, DATABASE_URL: replit }))
      .toEqual({ url: neonProd, source: "APP_DATABASE_URL" });
  });
  it("production refuses to fall back to DATABASE_URL", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: replit }))
      .toThrow(/APP_DATABASE_URL must be set in production/);
  });
  it("production refuses a URL without sslmode", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "production", APP_DATABASE_URL: "postgresql://u:p@h/db" }))
      .toThrow(/sslmode/);
  });
  it("a Replit workspace uses DEV_DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ REPL_ID: "x", DEV_DATABASE_URL: neonDev, DATABASE_URL: replit }).source)
      .toBe("DEV_DATABASE_URL");
  });
  it("a Replit workspace refuses Replit's own database", () => {
    expect(() => resolveDatabaseUrl({ REPL_ID: "x", DATABASE_URL: replit })).toThrow(/DEV_DATABASE_URL/);
  });
  it("CI and local use DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://postgres:postgres@localhost:5432/t" }).source)
      .toBe("DATABASE_URL");
  });
  it("errors never contain the password", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "production", APP_DATABASE_URL: "postgresql://u:secretpw@h/db" }))
      .toThrow(expect.objectContaining({ message: expect.not.stringContaining("secretpw") }));
  });
  it("describeHost shows the host only", () => {
    expect(describeHost(neonProd)).toBe("ep-prod-pooler.eu-central-1.aws.neon.tech");
  });
});
```

- [ ] **Step 2:** `pnpm --filter @workspace/db exec vitest run src/url.test.ts`. Expected: FAIL, because `./url` doesn't exist.
- [ ] **Step 3: implement `url.ts`:**

```ts
export type DatabaseUrlSource = "APP_DATABASE_URL" | "DEV_DATABASE_URL" | "DATABASE_URL";

// SYC-121. Production reads APP_DATABASE_URL (Neon production, pooled) and never
// falls back. A Replit workspace reads DEV_DATABASE_URL (Neon development) and
// refuses Replit's own managed database, which is frozen. CI and local
// development keep DATABASE_URL.
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): { url: string; source: DatabaseUrlSource } {
  if (env.NODE_ENV === "production") {
    const url = env.APP_DATABASE_URL;
    if (!url) throw new Error("APP_DATABASE_URL must be set in production (SYC-121). Refusing to start.");
    if (!/[?&]sslmode=(require|verify-full)\b/.test(url)) {
      throw new Error(`APP_DATABASE_URL for ${describeHost(url)} has no sslmode=verify-full. Refusing to start.`);
    }
    return { url, source: "APP_DATABASE_URL" };
  }
  if (env.DEV_DATABASE_URL) return { url: env.DEV_DATABASE_URL, source: "DEV_DATABASE_URL" };
  if (env.REPL_ID) {
    throw new Error(
      "DEV_DATABASE_URL is not set. In a Replit workspace the app uses the Neon development branch; " +
        "Replit's own database is frozen (SYC-121). Add DEV_DATABASE_URL to the workspace secrets.",
    );
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  return { url: env.DATABASE_URL, source: "DATABASE_URL" };
}

export function describeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable database URL)";
  }
}
```

- [ ] **Step 4: wire it in.** `lib/db/src/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { describeHost, resolveDatabaseUrl } from "./url";

const { url, source } = resolveDatabaseUrl(process.env);
export const databaseTarget = { source, host: describeHost(url) };
export const pool = new pg.Pool({ connectionString: url });
// Neon closes idle connections when its compute suspends. Without a listener,
// an idle client's 'error' event would crash the process.
pool.on("error", (err) =>
  console.error(`database pool: idle client error on ${databaseTarget.host}: ${err.message}`),
);
export const db = drizzle(pool, { schema });
export * from "./schema";
export { describeHost, resolveDatabaseUrl } from "./url";
```

In `cli.ts`, `withClient` and `migrationsBuildTheSchema` use `resolveDatabaseUrl(process.env).url` instead of reading `DATABASE_URL` directly. `drizzle.config.ts` is unchanged, because `generate` never connects.

- [ ] **Step 5:** run `pnpm --filter @workspace/db test` and `pnpm --filter @workspace/api-server test` with only `DATABASE_URL` set (the CI path). Expected: PASS, with no other test changed.
- [ ] **Step 6: mutation probes** (each must turn the named test red, then be restored):
  - Remove the production `throw`, and "production refuses to fall back" fails.
  - Delete the `REPL_ID` branch, and "a Replit workspace refuses" fails.
  - Put `url` into the sslmode error message, and "errors never contain the password" fails.
- [ ] **Step 7: commit** with the message `SYC-121: one resolver picks the database; production requires APP_DATABASE_URL`.

### Task B.2: the API says which database it's on, and how far away it is

**Files:**
- Create: `artifacts/api-server/src/lib/databaseStartup.ts`, `artifacts/api-server/src/lib/databaseStartup.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Produces:** `logDatabaseTarget(pool: { query(sql: string): Promise<unknown> }, target: { source: string; host: string }, logger): Promise<void>`. It runs `select 1` twice after `listen`, and logs `{ source, host, roundTripMs }` from the second run (the first may include a Neon wake-up). It never blocks start-up. If the database is unreachable it logs a warning and resolves, rather than throwing. **This log line is what C.7, D.4 and E.9 read** to confirm the deployment is on the Neon production host, with a round trip under 20 ms.

- [ ] **Step 1:** write the tests with a stub pool. One checks that it logs `source`, `host` and a numeric `roundTripMs`, and that nothing logged contains `postgres`. The other uses a pool that rejects, and checks it logs a warning and resolves.
- [ ] **Step 2:** run them and see them fail. **Step 3:** implement, and call it from `index.ts` inside the `listen` callback, without awaiting it. **Step 4:** they pass.
- [ ] **Step 5: commit** with the message `SYC-121: log the database host and round trip at start-up`.

### Task B.3: the switchover tools (fingerprint, target guard, carry-back)

**Files:**
- Create: `lib/db/src/switchover/fingerprint.ts`, `guard.ts`, `carryBack.ts`, `cli.ts`, all in `lib/db/src/switchover/`
- Create: `lib/db/src/switchover/switchover.test.ts`, which uses throwaway databases on `DATABASE_URL`, the same pattern as `runner.test.ts`
- Modify: `lib/db/package.json`, adding the script `"switchover": "tsx ./src/switchover/cli.ts"`

**Produces (CLI):** `pnpm --filter @workspace/db run switchover <command>`. The source and target come from `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`.

| Command | What it does | Writes? |
|---|---|---|
| `fingerprint` (on `SOURCE`) | For each of the **nine baseline tables**, prints the row count and an md5 over every row in primary-key order, plus `last_value` and `max(id)` for each `serial` sequence. Also prints `server_version`, `datcollate`, `datctype`, the encoding, and the md5 of the `public` schema signature (reusing `schemaSignature`). It prints hashes and counts, **never row contents** | No. The session is read-only |
| `guard-target --mode rehearsal\|cutover` (on `TARGET`) | **Refuses** if `switchover.cutover_done` exists, meaning this branch has already been cut over (R5). In `cutover` mode, it also refuses if `public` has any table and there's no `switchover.rehearsal_marker`. Otherwise it drops `public` and `drizzle` and recreates an empty `public`. **It never drops `switchover.rehearsal_marker`:** the marker stays until `mark --mode cutover` replaces it, so a copy that fails anywhere before its last step can always be retried | Yes, and only on Neon |
| `mark --mode rehearsal\|cutover --fingerprint <md5>` (on `TARGET`) | Creates the `switchover` schema if needed. In rehearsal mode, it writes (or rewrites) the `rehearsal_marker` row. In cutover mode, it **deletes `rehearsal_marker` and writes `cutover_done` in one transaction** (timestamp, source fingerprint). It's the last step of a copy, so `cutover_done` exists only after a copy that passed every check | Yes, and only on Neon |
| `compare [--projected]` (on `SOURCE` and `TARGET`) | Fingerprints both and exits non-zero on **any** difference in counts, row hashes, sequences, signature, encoding or collation. `--projected` compares only the source's columns, and skips the signature (for comparisons after migrations) | No. Both sessions are read-only |
| `carry-back [--apply]` (`SOURCE` = Neon production, `TARGET` = old Replit production) | See below | Only with `--apply` |

The `switchover` schema sits outside `public`, so it never affects the runner's exact-match adoption, which compares `public` only.

**Fingerprint SQL, per table.** The same query runs on both sides, so any difference shows:

```sql
select count(*)::bigint as rows,
       md5(coalesce(string_agg(md5(t::text), '' order by <primary key columns>), '')) as hash
  from "<table>" t;
```

`t::text` includes the `bytea` photo data as hex, so the photo bytes are part of the checksum. At 38 photos this is cheap. The nine tables and their keys, from `0000_baseline.sql`, are: `photos(id)`, `cats(id)`, `sightings(id)`, `profiles(device_id)`, `cat_subscriptions(device_id, cat_id)`, `cat_updates(id)`, `notifications(id)`, `push_tokens(device_id)` and `device_credentials(device_id)`.

**Carry-back: copying testers' Neon writes back in a rollback (F.3).** The old database has the baseline schema. Neon has the baseline plus everything after it (`0001`'s new tables, `0002`'s `photos.public_id`, and so on). The carry-back makes each of the nine baseline tables in the old database **equal to Neon's rows, projected onto the old database's columns**. It runs in one transaction, by primary key:

1. For each table, read the old database's column list, and select those columns from both sides.
2. Rows only on Neon are **inserted**. Rows on both with different values are **updated**. Rows only in the old database are **deleted**. Only the app's own deletes cause those, for example a moderation removal. Inserts and updates go parents first, and deletes go children first, following the foreign keys.
3. Each `serial` sequence is set to `greatest(last_value, max(id))`.
4. `compare --projected` runs inside the same transaction. The transaction commits only if the old database now matches Neon's projection exactly. Otherwise it rolls back, and nothing changes.
5. **Without `--apply`** (a dry run, and the default), it prints, per table, the counts it *would* insert, update and delete, and the affected ids. It prints ids only, never contents. That output is what Samuel approves in F.3.

Rows in tables the old database doesn't have (`0001`'s and later) **aren't lost**. They stay on Neon, which is kept, and the dry run names them as "no home in the old database".

- [ ] **Step 1: write the failing tests** in `switchover.test.ts`, each building its own throwaway databases:
  1. `fingerprint` gives the same result for two databases holding the same rows **inserted in a different order**. Changing one byte of one photo changes the `photos` hash and nothing else.
  2. `compare` fails on a sequence behind `max(id)`, on a missing index, and on a different `datcollate` (compared at the fingerprint level).
  3. **Every state the switchover can fail in, and whether a retry passes** (a table-driven test over the four states F.1 names):
     - **S-empty**: no tables, no marker. `copy-rehearsal` and `copy-cutover` are both accepted.
     - **S-rehearsal**: rehearsal copy plus marker. Both are accepted, and the marker survives the wipe.
     - **S-failed-copy**: `copy-cutover` failed after the wipe or the restore, before `mark` ran. It's simulated three ways: failing the restore, failing `compare`, and failing the second source fingerprint. The marker is still there, `cutover_done` is absent, and a second `copy-cutover` is accepted.
     - **S-cut**: `cutover_done` exists. Both copies are refused.
     - Also: a database with tables and neither marker is refused in cutover mode, and `mark --mode cutover` leaves `rehearsal_marker` gone and `cutover_done` present, never both and never neither (it's killed between its two statements, which must be one transaction).
  4. **Carry-back, end to end.** Build the "old" database at `0000` with rows, and the "new" one at `0000`+`0001`+`0002` with the same rows. On "new", insert a sighting and a photo, rename a cat, delete a subscription, and add an `observations` row. The dry run reports 2 inserts, 1 update and 1 delete, with `observations` reported as having no home. After `--apply`, `compare --projected` passes, and `nextval` on "old" returns `max(id)+1`.
  5. The carry-back refuses to `--apply` when the old database has a column Neon lacks. That would mean the old schema isn't the baseline, so it stops (R0).
  6. `fingerprint` opens its source read-only: an `insert` through its client is refused with SQLSTATE `25006`.
- [ ] **Step 2:** run them and watch them fail. **Step 3:** implement. **Step 4:** they pass.
- [ ] **Step 5: mutation probes** (each must turn the named test red, then be restored):
  - Skip the update pass, and test 4 fails.
  - Skip `setval`, and test 4's `nextval` check fails.
  - Drop the `order by` from the fingerprint's aggregate, and test 1 fails (the rows were inserted in a different order).
  - Remove the read-only session option, and test 6 fails.
  - Remove the `cutover_done` check, and test 3 (S-cut) fails.
  - Make the guard drop `rehearsal_marker`, and test 3 (S-failed-copy) fails.
- [ ] **Step 6: commit** three times: fingerprint and compare; the guard and the marker; carry-back.

### Task B.4: the `db-ops` workflow

**Files:** Create `.github/workflows/db-ops.yml` and `scripts/db-ops.sh`.

```yaml
name: db-ops
on:
  workflow_dispatch:
    inputs:
      target: { type: choice, options: [development, rehearsal, production], required: true }
      command:
        type: choice
        required: true
        options: [fingerprint-source, copy-rehearsal, copy-cutover, verify, migrate, migrate-rollback, smoke, carry-back-dry-run, carry-back-apply]
      base_url: { type: string, required: false, description: "For smoke: defaults to https://apptest.catspotters.com" }
      confirm: { type: string, required: false, description: "Type APPLY for carry-back-apply" }
      fail_after: { type: choice, options: ["", restore, compare, fingerprint], required: false, description: "D.8 drill only; refused unless target=rehearsal" }
permissions: { contents: read }
concurrency: { group: "db-ops-${{ inputs.target }}", cancel-in-progress: false }
jobs:
  run:
    runs-on: ubuntu-24.04
    environment: ${{ inputs.target == 'development' && 'development' || 'production' }}
    steps:
      - uses: actions/checkout@v4
        with: { ref: main }
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Postgres 16 client
        run: |
          sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client-16
          /usr/lib/postgresql/16/bin/pg_dump --version
      - name: Run
        env:
          TARGET: ${{ inputs.target }}
          COMMAND: ${{ inputs.command }}
          BASE_URL: ${{ inputs.base_url }}
          CONFIRM: ${{ inputs.confirm }}
          NEON_URL: ${{ inputs.target == 'production' && secrets.NEON_PROD_DIRECT_URL || inputs.target == 'rehearsal' && secrets.NEON_REHEARSAL_DIRECT_URL || secrets.NEON_DEV_DIRECT_URL }}
          REPLIT_URL: ${{ secrets.REPLIT_PROD_DATABASE_URL }}
          PRELAUNCH_KEY: ${{ secrets.PRELAUNCH_TESTER_KEY }}
          # From the Environment's variables (A.2); rehearsal shares the production Environment.
          DATABASE_TARGET: ${{ inputs.target == 'rehearsal' && 'rehearsal' || vars.DATABASE_TARGET }}
          FAIL_AFTER: ${{ inputs.fail_after }}
          # Q6: the public key only; copy-cutover encrypts the dump with age and uploads it (7-day artifact)
          DUMP_AGE_RECIPIENT: ${{ vars.DUMP_AGE_RECIPIENT }}
        run: bash scripts/db-ops.sh
```

`scripts/db-ops.sh` maps each command to exactly one action. It runs with `set -euo pipefail`, never uses `set -x`, and never echoes a variable that holds a URL:

| Command | Runs |
|---|---|
| `fingerprint-source` | `switchover fingerprint`, with the source set to `$REPLIT_URL` (read-only) |
| `copy-rehearsal` (target `production` or `rehearsal`) and `copy-cutover` (target `production`, or `rehearsal` for D.8's recovery drill only; refused for `development`) | `guard-target` (in the command's mode), then a `fingerprint` of the source, then `pg_dump -Fc -n public --no-owner --no-privileges --no-publications --no-subscriptions` from Replit in a read-only session, then `pg_restore --no-owner --no-privileges --single-transaction --exit-on-error -L <the table of contents without its "SCHEMA - public" line>` into Neon, then `compare`, then a **second** `fingerprint` of the source, which must equal the first (proving nothing was written to Replit during the copy), then `mark` (the rehearsal marker, or `cutover_done`). **`copy-rehearsal` into `production` also restores the same dump into the `rehearsal` branch**, so the stand-in for the old database in D.5 starts from exactly the same rows. The dump lives only in the runner's temporary folder, apart from the encrypted copy in decision Q6 |
| `verify` | `compare --projected` (Replit against Neon, on the baseline tables), plus the migration history in `drizzle.__drizzle_migrations` checked against the journal's hashes |
| `migrate` / `migrate-rollback` | `pnpm --filter @workspace/db run migrate` (or `migrate:rollback`), with `DATABASE_URL=$NEON_URL` for that one command |
| `smoke` | `pnpm --filter @workspace/db run smoke "${BASE_URL:-https://apptest.catspotters.com}"`, with `PRELAUNCH_KEY` set |
| `carry-back-dry-run` / `carry-back-apply` | The source is always Neon `production`. With target `production`, the target is the **old Replit production database** (a real rollback). With target `rehearsal`, the target is the Neon `rehearsal` branch standing in for it (D.5). `apply` also requires `CONFIRM == APPLY` |

The restore leaves out `CREATE SCHEMA public` because Neon's empty database already has one. Dumping with `-n public` leaves out Replit's own schemas. Neither the old database nor our baseline uses an extension. D.2 confirms all of this against the real dump's table of contents.

- [ ] **Step 1:** `actionlint` and `bash -n scripts/db-ops.sh` pass.
- [ ] **Step 2: a local dry run.** Run `scripts/db-ops.sh` with `NEON_URL` and `REPLIT_URL` pointing at two local databases, with the source built at `0000` and holding rows. `copy-rehearsal`, `verify` and `migrate` all succeed. Then `copy-cutover` succeeds once, and a second `copy-cutover` or `copy-rehearsal` into the same target is refused.
- [ ] **Step 3:** search the dry run's whole output for `postgres://` and `postgresql://`. Nothing should be found.
- [ ] **Step 4: commit** with the message `SYC-121: db-ops workflow for copy, migrate, verify, smoke, carry-back`.

### Task B.5: `smoke` gets through the pre-launch gate

**Files:** Modify `lib/db/src/migrate/cli.ts` (`smoke`). Test: `lib/db/src/migrate/smoke.test.ts`.

With the SYC-113 gate on, `GET /api/cats` with no pass gets a 401, so today's smoke test would fail. `smoke` sends `X-Prelaunch-Key: $PRELAUNCH_KEY` on every request when that variable is set.

- [ ] **Steps:** write a test with a stub HTTP server that answers 401 without the header and 200 with it, and see it fail. Implement. Run it again and see it pass. Commit with the message `SYC-121: smoke passes the pre-launch key when set`.

### Task B.6: documentation

**Files:** `docs/DEPLOYMENT.md` §C, `lib/db/migrations/README.md`, `docs/runbooks/replit-github-sync.md`, and a new `docs/runbooks/neon-database.md`. The new file is short: where things live, running `db-ops`, resetting the development branch, and restoring to a point in time.

- `DEPLOYMENT.md` §C: replace "Production Postgres with backups enabled…" with Neon, the 7-day restore, and the rehearsal as the tested restore (with its date). Replace "Schema changes go through migrations only…" with A.4's order. Replace "Check Replit's publish step…" with R3. Add the one-instance setting (SYC-105) and the new project's name.
- `lib/db/migrations/README.md`: the paragraph "If `migrate` refuses the Replit dev database" becomes "reset the Neon `development` branch from `production`" (Neon console → Branches → development → Reset from parent). The advice to drop schemas by hand goes.
- `replit-github-sync.md`: the Git-pane pull now happens in the **new** project, and `post-merge.sh` migrates the Neon development branch. **Never pull in the old project** (R2).
- The DECISIONS.md amendment (G.3) goes into this PR **only after Samuel approves its wording**.
- [ ] **Commit** with the message `SYC-121: deployment docs for Neon`.

### Task B.8 (a separate small PR, "SYC-121: queued sightings survive the pre-launch gate"): a gate 401 means "sign in", not "failed"

**Decided by Samuel, 29 Sep 2026 (external review X4).** This is its own PR, carried by this plan and **merged before cutover**. It isn't part of the SYC-113 gates build.

**Why.** A web tester who queues a sighting before the freeze (or offline) and opens the site after cutover has no cookie for the new gate yet. The replay gets the gate's `401`. Today `classifySyncFailure` (`artifacts/cat-spotter/lib/offlineQueue.ts`) treats **any** 4xx as permanent, so the sighting silently becomes an error and is never sent. A store build without the tester key would hit the same thing.

**The gate's refusal**, from PR #30's `artifacts/api-server/src/middlewares/prelaunchGate.ts`, is status **401** with the body `{"error":"prelaunch_pass_required","message":"Cat Spotters isn't open yet."}`. `ApiError` (`lib/api-client-react/src/custom-fetch.ts`) carries `status` and the parsed `data`, so the classifier can recognise it exactly. **This must be keyed on the `error` field, not just the status,** so other 401s (for example the device-secret checks, SYC-92) keep today's handling.

**Files:**
- Modify: `artifacts/cat-spotter/lib/offlineQueue.ts` (`classifySyncFailure`, `SyncFailureDecision`), `artifacts/cat-spotter/context/OfflineContext.tsx` (the sync loop), and the queue banner component that shows pending items.
- Test: `artifacts/cat-spotter/lib/__tests__/offlineQueue.test.ts`, plus the `OfflineContext` tests.

**Produces:** a new decision `{ kind: 'needsSignIn' }`, and the exported `isPrelaunchRefusal(err: unknown): boolean`.

- [ ] **Step 1: failing tests** in `offlineQueue.test.ts`:
  - An `ApiError` with status 401 and `data.error === "prelaunch_pass_required"` gives `{ kind: 'needsSignIn' }`. It doesn't increment `failCount`, and it's never `permanent`.
  - A 401 with any other body (or no body) still gives `{ kind: 'server', permanent: true }`, as today.
  - A 403, 404 or 422 keeps today's handling.
  - A network error is still `{ kind: 'network' }`.
- [ ] **Step 2: failing tests** for the sync loop (`OfflineContext`): on `needsSignIn`, the item stays `pending` with its `failCount` unchanged. The sync pass **stops** there, so the rest of the queue isn't burned against the same refusal. The context exposes `needsSignIn: true`. After a later successful sync, `needsSignIn` is false again.
- [ ] **Step 3: the prompt.** When `needsSignIn` is true, the web build shows a banner: *"You have sightings waiting to send. Sign in to send them."* The button reloads `/`, where the gate shows its password page. After signing in, the app's normal sync-on-load sends them. Native builds show *"You have sightings waiting to send. Please update the app to send them."* (only a build without the tester key can see this). The copy is also added in Greek and French, through the existing i18n files.
- [ ] **Step 4:** implement, and run the tests until they pass.
- [ ] **Step 5: mutation probes** (each must turn the named test red, then be restored): key on the status alone, and "any other 401 stays permanent" fails; drop the `failCount` exemption, and the step 1 test fails; let the loop continue after `needsSignIn`, and the step 2 "stops" test fails.
- [ ] **Step 6: browser check** at 390 px and desktop: queue a sighting offline, clear the gate cookie, reconnect, and see the banner. Sign in, and see the sighting send.
- [ ] **Step 7: commit and ship** (`/ship`: independent review, and CI green). **This PR is a hard precondition at E.0.**

### Task B.7: prove the whole PR

- [ ] `pnpm --filter @workspace/db run migrate:check`, `pnpm --filter @workspace/db test`, the api-server tests and all the typechecks pass, both locally and in CI.
- [ ] The PR body records the mutation probes from B.1 and B.3, each with the test that went red.
- [ ] Ship it with `/ship`: an independent adversarial review (see Model delegation) and `/security-review`, since the PR handles secrets and adds a write path to live data.

---

## Part C · Setting up (days before cutover; testers notice nothing)

Order matters. Each step says who does it. **Claude never enters a payment detail or a connection string.**

**C.0 · Preconditions.** Samuel has approved this plan and answered the decisions in Part J. The SYC-121 build PR (Part B) and **the SYC-113 gates build PR (#30)** are both merged to `main`, with CI green. #30 must be merged before C.6. It works in the remix unchanged: it has no hostname dependency, takes `NODE_ENV` from `artifact.toml`, and keeps the gates shut (503) until their secrets are set. The B.8 PR can merge any time before E.0. Claude checks this with `gh pr view <n> --json state,mergedAt,files`.

**C.1 · Samuel: read the live deployment's region and size (2 minutes).**
1. Open replit.com/@fairshake-au/Syros-Cat-Spotter.
2. Click **Publishing** (the rocket icon in the left toolbar), then **Adjust settings**.
3. Under **Advanced**, read **Geography**. Under **Machine configuration**, read **Max instances**. **Don't change or save anything.** Close the panel.
4. Read the account's **Replit plan**: your avatar (top left), then **Account**, then **Plan**, or replit.com/account. It will say Starter, Core, Teams or similar.
5. Tell Claude the three values in chat. (None of them is a secret.)

Claude records them on SYC-121. If the region is already Europe, Samuel sees decision Q1 again before C.5.

**Gate before C.5: the old deployment must still exist at the end of the retention period.** Replit documents that published apps on the **Starter** plan expire after 30 days. If the old deployment expired inside the retention window, with its domain disconnected and no traffic, the rollback target would be gone. The new live app would expire the same way. So, before C.5, Claude checks the plan Samuel reported against Replit's current publishing docs, and records on SYC-121 that published apps on this plan don't expire before the retention date (Q3).
- **If the plan is Starter**, or the docs show any expiry that ends before the retention date: stop (R0). The fallback is Samuel upgrading the Replit plan (for example to Core) before C.5, which is billing, so Samuel does it. If he doesn't want to upgrade, the retention period can't be guaranteed, and this plan goes back to him for a decision before anything is built on it.
- **This check is repeated at E.0**, in case the plan changed in between.

**C.2 · Samuel: upgrade Neon to the Launch plan (3 minutes).**
1. Go to console.neon.tech, then your organisation (`org-gentle-king-11293783`), then **Billing**, then **Change plan**, then **Launch**. Confirm with your card.
2. Tell Claude "Neon upgraded".

Claude confirms read-only that the organisation's plan changed (`list_organizations`), and doesn't continue until it has.

**C.3 · Claude: create the Neon project (Neon MCP, about 5 minutes).** `create_project` (name `syros-cat-spotter`, region `aws-eu-central-1`, Postgres 16, organisation `org-gentle-king-11293783`). Rename the default branch to `production` (`update_branch`). Create `development` and `rehearsal` as children of `production` (`create_branch`). Set the restore window to 7 days (`update_project`, `history_retention_seconds: 604800`). Set compute to 0.25 to 1 CU, suspending after 5 minutes (per Q4). Mark `production` protected if the plan allows it. **Check that snapshots work on this plan:** take one of the empty `production` branch, restore it, then delete it. If that's not possible, record that E.5a falls back to point-in-time restore (F.1, last paragraph). Then Claude checks the result with `describe_project` and `list_branches`, and records the project id, branch ids and region on SYC-121 (none of those is a secret). **It doesn't call `get_connection_string`.**

**C.4 · Samuel: put five Neon connection strings where they belong (about 10 minutes).** In Neon's console, open project **syros-cat-spotter** and click **Connect** (top right of the Dashboard). In the dialog, choose Branch, Database `neondb` and Role `neondb_owner`, set **Connection pooling** on or off as shown below, and click **Copy snippet** for the connection string. Paste each one straight into its destination. If the string ends in `sslmode=require`, change that one word to `verify-full` after pasting.

| # | Branch | Pooling | Paste into |
|---|---|---|---|
| a | `production` | **off** | GitHub → repo **Settings** → **Environments** → **New environment** `production` → (**Deployment branches and tags**: *Selected branches* → add `main`) → **Add environment secret** `NEON_PROD_DIRECT_URL` |
| b | `rehearsal` | off | Same environment → secret `NEON_REHEARSAL_DIRECT_URL` |
| c | `development` | off | GitHub → **New environment** `development` (branches: `main`) → secret `NEON_DEV_DIRECT_URL` |
| d | `development` | off | Replit **new** project's workspace Secrets as `DEV_DATABASE_URL` (done in C.5, step 5) |
| e | `production` | **on** | Replit **new** project's **deployment** secrets as `APP_DATABASE_URL` (done in C.6, step 2) |

**Also in C.4 (not secrets, so Claude sets them):** the GitHub Environment variables `DATABASE_TARGET=production` (in `production`) and `DATABASE_TARGET=development` (in `development`), with `gh variable set DATABASE_TARGET --env <name> --body <value>`. Samuel adds `DATABASE_TARGET=development` to the new project's workspace secrets in C.5, and `DATABASE_TARGET=production` to its deployment secrets in C.6 (A.2).

**C.4f · Samuel: the old Replit production string, read-only use (3 minutes).** In the **old** project, open the **Database** tool (left toolbar), select **Production**, then **Settings**, and copy the connection string. Paste it into GitHub's `production` environment as `REPLIT_PROD_DATABASE_URL`. **Don't change anything in the Database tool.** (If Replit shows no connection string for production, stop: Claude diagnoses the alternative before anything else happens, per R0.)

**C.4g · Claude: the tester key into GitHub.** When the SYC-113 rollout generates the tester key in a terminal tab (its plan, "Rollout order" step 2), the same command also runs `gh secret set PRELAUNCH_TESTER_KEY --env production` from that tab's environment, so the value is never printed.

**C.4i · Samuel: the key for the offline copy (Q6, 3 minutes, once).** In Terminal on the Mac, paste this block. It installs `age` if needed, makes a key pair, keeps the private half only on the Mac, and prints only the public half:

```bash
cd /Users/samuelporter
brew install age
age-keygen -o /Users/samuelporter/syros-cutover-age.key
```

The last line prints `Public key: age1…`. Paste **that line only** into chat, since the public half isn't a secret. Keep the key file somewhere safe (for example, copy it into the password manager). Claude stores the public key as the GitHub Environment **variable** `DUMP_AGE_RECIPIENT` in `production` (`gh variable set`). `copy-cutover` encrypts the dump to it (`age -r "$DUMP_AGE_RECIPIENT"`) and uploads only the encrypted file as a workflow artifact, kept for 7 days. After E.6, Samuel downloads it from the run's page (Actions → the `db-ops` run → Artifacts) and keeps it with the key. Claude can't decrypt it.

**C.4j · DNS permission for Claude, limited to `catspotters.com` (Q7, 3 minutes).** **Checked read-only on 29 Sep:** Claude's existing Cloudflare credential is Wrangler's OAuth login. Its scopes include `zone (read)` but no DNS write. Wrangler's list of scopes it can request (`wrangler login --scopes-list`) has no DNS scope at all, and the login can't create API tokens. **So Claude can't grant this itself, and Samuel does it once in the dashboard:**
1. dash.cloudflare.com → your profile icon (top right) → **My Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit zone DNS**, click **Use template**.
3. **Permissions:** leave *Zone · DNS · Edit*. **Zone Resources:** *Include · Specific zone · `catspotters.com`*. Leave the other settings as they are. Name it `claude-dns-catspotters`.
4. **Continue to summary** → **Create Token**. Copy the token.
5. Paste it straight into the Mac's keychain, not into chat. In Terminal, paste this block, and when it asks for the password, paste the token (nothing is shown):

```bash
cd /Users/samuelporter
security add-generic-password -a claude -s cloudflare-dns-catspotters -w
```

Claude then reads it only into a command's environment, never printing it: `CF_DNS_TOKEN="$(security find-generic-password -a claude -s cloudflare-dns-catspotters -w)"`. It checks the token with Cloudflare's verify endpoint (`/client/v4/user/tokens/verify`, printing only `status`), and that it can list DNS records for `catspotters.com` and nothing else (a request for another zone must be refused). Claude uses it for E.1, E.10 and F.2 step 5's DNS changes, and checks each with `dig`. Samuel deletes the token in the same dashboard page at the retention date (G.2).

**C.4h · Claude: prove the secrets work, without showing them.** Claude runs `gh workflow run db-ops.yml --ref main -f target=production -f command=fingerprint-source` and reads the log. The expected result: nine tables with row counts that match SYC-121's figures (19 cats, 38 sightings, 38 photos, 18 profiles, or more), Postgres 16.15, and no connection string anywhere in the log. This also proves the old production database can be reached from outside Replit, which the Replit agent couldn't confirm. The fingerprint is recorded on SYC-121 as the first reference point. **Nothing has been written anywhere yet.**

**C.5 · Samuel: make the new EU project (about 15 minutes).**
1. In the **old** project, open the **⋯** menu, then **Remix** (or **Fork**). Name it `Syros-Cat-Spotter-EU`. If it offers **"Copy data from original App"**, **leave it unticked**.
2. Open the new project. Check the **Secrets** pane: the old project's secrets are there (for example `OWNER_SECRET` and the `CAMPAIGN_*` values). Tell Claude which names are present. Don't send the values.
3. Check **Integrations** (or **Connectors**) for **OpenAI**. If it isn't enabled, enable it. Claude then checks, read-only through the Replit agent, that `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` exist in the new workspace.
4. Open **Git** in the new project. If it shows the `fairshake-au/syros-cat-spotter` repository, pull `main`. If it shows no repository, **connect GitHub from the new project's Git pane** (this adds a link and doesn't disconnect anything in the old project; the "never disconnect GitHub" rule is about the old project) and pull `main`.
5. **Before that pull**, add the workspace secret `DEV_DATABASE_URL` (C.4d). The pull runs `post-merge.sh`, which now migrates the Neon `development` branch. Without the secret, it stops with "DEV_DATABASE_URL is not set" (B.1), which is the safe failure: pull again after adding it.
6. Tell Claude "EU project pulled". Claude checks through the Replit agent (read-only) that `git log -1` in the new project matches `origin/main`, and uses the Neon MCP to check that `development` now has the full migration history.

**C.6 · Samuel: the new project's first publish, in Europe, Public, with the gates on (about 20 minutes).** This is permanent for the region, so check it twice.
1. In the new project, click **Publishing**. Choose **Autoscale**.
2. **Deployment secrets:** add `APP_DATABASE_URL` (C.4e, the `production` branch with pooling on), plus the SYC-113 settings `PRELAUNCH_WEB_PASSWORD`, `PRELAUNCH_SESSION_KEYS` and `PRELAUNCH_TESTER_KEYS` (pasted from the terminal tab the SYC-113 rollout opens). **Don't add `EXPO_PUBLIC_PRELAUNCH_KEY` here.** Leave `PRELAUNCH_GATE` unset, which means on.
3. **Advanced → Geography: Europe.** Before clicking on, read it back to Claude in chat.
4. **Machine configuration → Max instances: 1** (SYC-105, until the Postgres rate-limit store exists).
5. **Access: Public.** Don't connect `apptest.catspotters.com` yet.
6. Click **Publish**. If Replit shows **any database review, cancel it** (R3) and tell Claude.
7. Tell Claude the new `*.replit.app` address. It's a public address, not a secret.

**C.7 · Claude: check the new project before any real data is in it.** At this point Neon `production` is empty, so the app runs with no schema. `/api/cats` returns a server error, and that's expected. Claude runs:
- The deployment log line from B.2: `source: APP_DATABASE_URL`, the host is the `production` branch's pooled endpoint (checked against the endpoint id from C.3), and the round trip is **under 20 ms**. **If it's over 20 ms, the project isn't in Europe:** unpublish it, delete the remix, and redo C.5 and C.6. No tester data is involved yet.
- The SYC-113 "Done" checklist items **1, 2, 3, 4, 10, 11 and 12** against the `*.replit.app` address. For **item 7**, only its refusal halves run until SYC-83 sets `INTERNAL_PEOPLE_TOKEN`. `POST /api/internal/people/allowed` with nothing, and with the tester key, must each get a JSON refusal (**401**, or **503** `not_configured` while the token is unset), **never a 200, never HTML, and never a `307`**. The 200 case with the Worker's bearer waits for SYC-83's own probes. Items that need data (5, 6, 10a and 10b) and real builds (8 and 9) run in D.4. **If any "must be refused" probe answers 200, Samuel sets the project back to Password protected before anything else.** That's SYC-113's rule, unchanged.

---

## Part D · The dress rehearsal (the whole run on copies, including the rollback)

It runs against a live copy of tester data, with the old app still serving testers, so testers notice nothing. Claude runs it end to end. Samuel's part is two short checks, D.4's real devices and D.6's domain move. **Everything is timed**, and the times are recorded on SYC-121. **The real cutover is scheduled only after a rehearsal passes every check.** If a rehearsal fails, the fix goes through a normal PR, and the rehearsal is run again in full.

| Step | Claude runs | Passes when |
|---|---|---|
| **D.1** Reference point | `db-ops -f target=production -f command=fingerprint-source` | Recorded. Counts are at least those in C.4h |
| **D.2** Copy | `db-ops -f target=production -f command=copy-rehearsal` | `compare` reports zero differences: counts, **photo bytes** (the row hash covers them), sequences, schema signature, encoding and collation. The source fingerprint is the same before and after the dump (nothing was written to Replit). The dump's table of contents holds only `public` objects and no extensions (the log lists them) |
| **D.3** Migrations | `db-ops -f target=production -f command=migrate`, then `-f command=verify` | The runner prints **"adopted baseline: live schema matches it"**, then **`applied: 0001_data_spine_tables`** and nothing else (Q10: `0002` comes after the move). If any other migration appears, stop (R0), because something merged that shouldn't have. `verify` passes. Through the Neon MCP (read-only `run_sql`): `drizzle.__drizzle_migrations` has one row per journal entry; the triggers `observations_append_only`, `cat_identity_append_only`, `observations_no_truncate` and `cat_identity_no_truncate` exist; for every `serial` sequence, `last_value >= max(id)`; and `datcollate` matches Replit's (from D.1) |
| **D.4** The app on the copy | `db-ops -f command=smoke -f base_url=<new replit.app address>`, then the remaining SYC-113 checklist items (5, 6 and 10a). **Item 10b** (old photo links redirect) is about SYC-98, so it's checked when #24 ships after the move, not here (Q10). A real browser at **390 px and desktop**: type the tester password, see cats with photos on the map, open a cat, check its sightings. One sighting is posted through the website with the tester key, to exercise AI matching on the new project's OpenAI integration | All pass. Cat and sighting counts shown in the app match D.1. The start-up log shows the production host and a round trip under 20 ms |
| **D.4b** Samuel, real devices (optional in the rehearsal, required at cutover if store builds exist) | A TestFlight or Play build pointed at the new address, if one exists | The SYC-113 items 8 and 9 pass |
| **D.5** Rollback rehearsal, data | 1. The `rehearsal` branch already holds the same dump as production (D.2 loaded both), at the baseline schema, **standing in for the old Replit database**. 2. Through the new app (tester key): post two sightings with photos, rename a cat, and remove a subscription. That makes production "Neon after testers used it". 3. `db-ops -f target=rehearsal -f command=carry-back-dry-run`. 4. `db-ops -f target=rehearsal -f command=carry-back-apply -f confirm=APPLY` | The dry run lists exactly those changes by id (2 sightings, 2 photos, 1 cat updated, 1 subscription deleted, plus any `0001` rows under "no home"). After apply, `compare --projected` passes and `nextval` is correct. **The real old database was never written by our tools:** every connection to it was read-only (R1), and carry-back's target in a rehearsal is the Neon `rehearsal` branch. (A final `fingerprint-source` can differ from D.1's only by testers' own new rows through the old app, which isn't frozen during a rehearsal) |
| **D.6** Rollback rehearsal, the address | Samuel: attach `rehearsal.catspotters.com` to the **new** project (Publishing → Domains → Connect), and add the DNS records Replit shows in Cloudflare. Claude times it until `https://rehearsal.catspotters.com/api/healthz` answers 200. Then Samuel attaches it to the **old** project (Replit offers "move to this project"), and Claude times it until the address answers with the old project's `307` to `replit.com/__replshield`. Then Samuel removes it from both | Both moves complete. The times are recorded, and so are **both projects' DNS values** (A and TXT), which F.2 uses. If the old and new values differ, the rollback needs a DNS change as well as the Replit click, and F.2 says so. **These times are an estimate, not a promise.** It's a similar operation on a different hostname: a fresh address with no certificate history, not one that's being moved from another project with its old certificate still around. So E.10 and F.2 step 5 are watched live, with a maximum wait, rather than assumed to take D.6's time. **Measured, 30 Sep 2026:** new → EU project: live within **~2 minutes** (a cert was issued at once). **Back to the old project: stuck at "SSL certificate pending" / "This app isn't live yet" for ~24 minutes** — a materially worse number than the new-project direction, now the planning figure for F.2 step 5 and E.10's rollback path. The workaround that worked: **disconnect, then reconnect** the domain on the old project, which made Replit **auto-republish the old project** and the address went live within about a minute of that. The old database was verified unchanged by `fingerprint-source` afterwards (see the Dress rehearsal findings below). **Both hostnames share the same A record** (`34.111.179.208`; Replit routes by hostname, not IP), and Replit **left the losing project's `replit-verify` TXT record in place** rather than removing it — whether a leftover TXT matters is unproven; treat it as an open question, not a known-safe leftover, until a second clean round tests it |
| **D.8** Recovery drill: rolling back from each Neon state | **Runs on `production` itself, not `rehearsal` (corrected 30 Sep; Samuel approved).** The plan originally said `rehearsal`, but Neon only takes and restores snapshots on a **root branch**, and `rehearsal` is a child of `production`. `production` was empty or held only rehearsal data at drill time, so this was safe and Samuel signed off on it live. 1. `create_snapshot` of `production` (it's in S-rehearsal). 2. `copy-cutover -f target=production` succeeds, which gives **S-cut** (step 2 done: `compare` showed no differences, marked `cutover_done`, encrypted dump uploaded as a workflow artifact). 3. A second `copy-cutover` and a `copy-rehearsal` are both **refused** ("already been cut over") — confirmed. 4. `restore_snapshot` from step 1: `production` is back in S-rehearsal with its data and migrations intact, and `copy-cutover` is accepted again — confirmed, **apart from the password finding (A.1): the restore changed the `neondb_owner` password and swapped in a new branch id**, which needed the re-paste procedure (F.1) before `db-ops` worked again. 5. S-failed-copy: as planned. 6. End by restoring the step 1 snapshot | Every refusal and every acceptance was exactly as F.1 (as amended) says. **The password change is now a documented, expected part of every snapshot restore** — see A.1 and F.1's re-paste procedure. **Timed:** the restore itself is fast (about a second to move the endpoint); the **re-paste drill that follows a restore took ~26 minutes** end to end on 30 Sep (with slips — see F.1), against an expected ~5 minutes once the leftover-branch and republish-order mistakes are avoided |
| **D.7** Close | Claude posts the timings and results on SYC-121 (including D.8's), and a go/no-go for a cutover date | Every row above passed |

**The migration freeze after a passing rehearsal:** until cutover, no PR that adds a migration merges, unless D.2 to D.4 are run again with it. Code-only PRs can merge, because the cutover publishes nothing new (the new project is already running `main` from C.6). If code does change, Samuel pulls and republishes the new project before cutover, and Claude reruns D.4.

**Expected timings (to be replaced by the measured ones):** D.2 copy under 2 minutes (18 MB), D.3 under 1 minute, D.4 about 15 minutes, D.5 about 10 minutes, and a domain move a few minutes plus DNS, which Cloudflare serves at a 60-second TTL (E.1).

---

## Part E · Cutover day (about an hour of paused saving; testers are told in advance)

**Go/no-go (E.0), checked by Claude from live sources and posted on SYC-121 before E.3:** the Replit plan gate from C.1 still holds (no expiry before the retention date). **The B.8 PR (queued sightings survive the gate) is merged and published in the new project** (a hard precondition: `gh pr view` shows it merged, and the new project's `git log -1` includes it). A rehearsal passed (Part D) with no migration merged since. The new project is running `main` (compared through the Replit agent). `fingerprint-source` works. Samuel is available for the whole window. It isn't a busy time on the island: early morning Greek time is best, when Replit's logs show the fewest requests.

| Step | Who | What | Check before moving on |
|---|---|---|---|
| **E.1** The day before | Claude (the DNS-only token from C.4j, per Q7) | Set the TTL of the `apptest` records to **1 minute**, so a domain move takes effect quickly | Claude checks with `dig` that the lower TTL is being served |
| **E.2** The day before | Samuel | Sends the tester message (Part I, message 1) to the WhatsApp group | — |
| **E.3** T-0 | Claude | **The record before anything changes:** `fingerprint-source`. The counts and hashes are posted on SYC-121. (The encrypted dump for Samuel (Q6) comes from E.6: `copy-cutover` is the only command that produces it, encrypting the same dump it restores, before the restore) | Recorded. The counts are plausible (no fewer than D.1's) |
| **E.4** Freeze | Samuel | **Old** project → Publishing → Domains → `apptest.catspotters.com` → **Disconnect**. (It isn't an unpublish. The old deployment keeps running on its own address behind Replit's wall, and its database isn't touched) | Claude: `curl -sI https://apptest.catspotters.com/api/healthz` no longer returns the old app (it's no longer a `307` to `replit.com/__replshield`). The time is recorded as **T-freeze** |
| **E.5** Quiet check | Claude | `fingerprint-source` twice, 2 minutes apart | Both equal. **Nothing is writing to the old database** |
| **E.5a** Snapshot | Claude (Neon MCP) | `create_snapshot` of `production`, named `pre-cutover-<yyyymmdd>-<attempt>`, while it's still in S-rehearsal. **`production` is a root branch, which is required:** the dress rehearsal (30 Sep) confirmed Neon only takes and restores snapshots on root branches, which is why this step (and every recovery restore) runs against `production` and not a child branch | The snapshot exists (`list_snapshots`). **Every recovery from E.7 onward restores this snapshot** (F.1), following the **re-paste procedure** added there, because restoring it changes `production`'s branch id and the `neondb_owner` password |
| **E.6** Copy | Claude | `db-ops -f target=production -f command=copy-cutover` | As D.2: zero differences, including photo bytes and sequences; the source fingerprint equals E.5's before and after the dump; `switchover.cutover_done` written |
| **E.7** Archive | Claude (Neon MCP) | `create_branch` `replit-final-<yyyymmdd>-<attempt>` from `production`, **before** any migration (numbered per attempt, so a retry never clashes with a failed attempt's branch) | The branch exists. A read-only `run_sql` count on it matches E.5 |
| **E.8** Migrations | Claude | `db-ops -f command=migrate`, then `-f command=verify`, then the MCP checks from D.3 | Exactly as in D.3: baseline adopted, **only `0001_data_spine_tables` applied**, triggers present, sequences correct |
| **E.9** The app on real data | Claude | `smoke` against the `*.replit.app` address. The start-up log (production host, round trip under 20 ms). A browser check at 390 px and desktop | Counts in the app match E.5. The start-up log is right |
| **E.10** Address | Samuel | **New** project → Publishing → Domains → **Connect** `apptest.catspotters.com`. Claude updates the Cloudflare records to the new values if D.6 found them different (C.4j token) | **Watched live, not assumed to match D.6.** Claude polls every 30 seconds until `/api/healthz` on `apptest` returns **200 with no `307`** (SYC-113 probe 1), from the new app's host (the start-up log shows the request), with a **valid TLS certificate for `apptest.catspotters.com`** (`curl` without `-k`, and `openssl s_client` showing the issuer and dates). The time is recorded as **T-live**. **Maximum wait: 20 minutes from the Connect click.** If it isn't all true by then, the F.1 E.10 rollback starts. There's no extending the wait (R0) |
| **E.11** Full checks on the real address | Claude, and Samuel for devices | The SYC-113 "Done" checklist against `apptest.catspotters.com` (all items, except that item 7 is as in C.7, its refusal halves only until SYC-83, and item 10b waits for #24 after the move); `smoke`; **SYC-100's proxy check** (a request with a made-up `X-Forwarded-For` value, and confirming from the deployment log that `req.ip` is the real client address, not the made-up one and not a Replit-internal address); items 8 and 9 on a real TestFlight or Play build if they exist. **The queued-sighting replay (B.8):** a sighting queued in a browser on the old app **before E.4** (Samuel queues one in airplane mode, on a phone, at E.3), sent after T-live with no new-gate cookie. It must show the "Sign in to send them" banner, and **after signing in it must arrive**: it shows on the cat, and a read-only count on Neon goes up by one | All pass. SYC-100's result is recorded on SYC-100, with the `trust proxy` setting fixed in a follow-up PR if it's wrong |
| **E.12** Open | Samuel | Sends Part I, message 2 | — |
| **E.13** Aftercare | Claude | At T-live plus 1 hour, 1 day and 7 days: `fingerprint-source` (the old database must be **unchanged since E.5**, which proves the way back is intact) and `db-ops -f target=production -f command=carry-back-dry-run` (read-only on both sides: it prints exactly what testers have changed on Neon since cutover, by id, which a rollback would carry back, and confirms the old database is unchanged since the copy). (`verify` isn't used here: it can't pass once testers have written on Neon.) The Neon MCP's `list_slow_queries` and the deployment's error log are checked at the same points | Unchanged, and no new error class. Posted on SYC-121 each time |

**The downtime window is E.4 to E.10.** From the rehearsal's figures, that's expected to be 20 to 40 minutes. Testers are told an hour.

**What testers see during the window:** the website and the app can't reach apptest (a Replit "not found" page, or a connection error). The phone app's offline queue (partial offline support; see `offline-queue-on-web.md`) holds sightings taken in that window, and sends them once apptest answers again. They land on Neon. The website's queue does the same on browsers that keep IndexedDB.

---

## Part F · Rollback: a first-class procedure, rehearsed in D.5 and D.6

### F.1 Every step's failure signal, and the way back from it

"Roll back" always means R0: undo to the last safe point **first**, then investigate. There's **no point of no return inside the retention window** (Part G). The old project and its database stay exactly as they were at E.5, and they can be put back in front of testers at any time until Samuel's retention date.

**The Neon states** (the guard rules are in §B.3, and each state has a test in B.3 test 3):
- **S-empty:** nothing in `production`.
- **S-rehearsal:** a rehearsal copy plus `rehearsal_marker`.
- **S-failed-copy:** `copy-cutover` stopped before its last step. The marker is still present and `cutover_done` is absent.
- **S-cut:** `cutover_done` exists and the marker has gone.

`copy-cutover` is accepted in S-empty, S-rehearsal and S-failed-copy, and **refused in S-cut**. So every failure from E.7 onward needs production put back to S-rehearsal before a retry. That's the job of the **pre-cutover snapshot** taken at E.5a.

| Step | What "failed" looks like | Neon state at the failure | Rollback from here | Why the retry passes the guards | Data at risk |
|---|---|---|---|---|---|
| C.1 to C.7 | Any step errors; a check in C.4h or C.7 fails; the region isn't Europe; a database review appears; the Replit plan is Starter (C.1) | S-empty | Stop. Nothing live has changed. Fix it through a PR or a corrected setting, and redo the step. A remix in the wrong region is deleted and remade | S-empty accepts every copy | None. Testers stay on the old project throughout |
| D.1 to D.8 | Any "Passes when" isn't met | S-empty or S-rehearsal (`rehearsal`: any state, since D.8 walks it through all of them) | Stop. The rehearsal's failure becomes a fix PR plus a full rehearsal rerun | `copy-rehearsal` accepts S-empty and S-rehearsal. The `rehearsal` branch is left in S-rehearsal at the end of D.8 | None |
| E.3 | The fingerprint fails to run, or shows fewer rows than D.1 | S-rehearsal | Stop before the freeze. Testers are unaffected | Nothing was written | None |
| E.4 | The address still reaches the old app after 5 minutes | S-rehearsal | Samuel reconnects the domain to the old project, if it had been disconnected at all (F.2 step 5) | Nothing was written | None |
| E.5 | The two fingerprints differ (something is still writing) | S-rehearsal | **Reconnect the domain to the old project (F.2 step 5 alone).** Find the writer before trying again | Nothing was written on Neon | None |
| E.5a | The snapshot can't be taken | S-rehearsal | Reconnect the domain to the old project. Don't continue without a snapshot | Nothing was written on Neon | None |
| E.6 | `copy-cutover` fails at any point: the wipe, encrypting the dump (checked before the wipe, done before the restore), the restore, `compare`, or the second source fingerprint | **S-failed-copy.** The marker is kept by design, and `cutover_done` is only written by the last step | Reconnect the domain to the old project (**one action**) | A retry's `copy-cutover` finds the marker and no `cutover_done`, so it's accepted (tested: B.3 test 3, S-failed-copy) | None. No tester has written on Neon |
| E.7 | The archive branch can't be created | **S-cut** | **First, retry E.7 once** (it's a Neon API call, and it changes nothing in `production`). If that fails too: reconnect the domain to the old project, then Claude **restores `production` from the E.5a snapshot** (Neon MCP `restore_snapshot`) | Restoring the snapshot puts production back in **S-rehearsal**, so the next `copy-cutover` is accepted. Proved in D.8 | None |
| E.8 | The runner refuses to adopt the baseline, a migration fails, `verify` fails, or a trigger is missing | **S-cut**, plus an archive branch (the runner is one transaction, so migrations are all or nothing) | Reconnect the domain to the old project. **Don't fix production's schema by hand.** Claude restores `production` from the E.5a snapshot, and deletes that attempt's archive branch (they're numbered per attempt, so a retry never clashes with it) | As for E.7: the snapshot restore gives S-rehearsal | None |
| E.9 | Smoke fails, counts differ, or the log shows the wrong host or a slow round trip | **S-cut**, with migrations applied | Reconnect the domain to the old project. Restore `production` from the E.5a snapshot before the next attempt | As for E.7 | None |
| E.10 | `apptest` isn't serving the new app with a valid certificate within the **maximum wait of 20 minutes** (E.10 is watched live, and isn't assumed to match D.6's timing) | **S-cut**, with migrations applied | Disconnect `apptest` from the new project, reconnect it to the old one, and put DNS back to the old values. Restore `production` from the E.5a snapshot before the next attempt | As for E.7 | None. Some requests may have reached the new app once it began answering, so Claude runs `carry-back-dry-run` anyway. If it shows anything, follow F.2 steps 2 to 4 before reconnecting |
| E.11 and afterwards | Any "must be refused" probe answers 200 | S-cut, live | **First**, Samuel sets the new project back to **Password protected** (SYC-113's rule: that closes the leak in one publish, and the database is unaffected). Then decide between fixing forward and a full rollback (F.2) | n/a | Exposure, not loss. Nothing is lost |
| E.11 and afterwards | Errors, a wrong count, a failed device test, or any unexplained problem | S-cut, live | **Full rollback, F.2.** Before any later retry, Claude first makes a branch `neon-after-attempt-<n>` from `production`, which keeps any rows with no home in the old database. Then `production` is restored from the E.5a snapshot, and the next cutover copies the old database afresh (it now includes the carried-back rows) | The snapshot restore gives S-rehearsal. Nothing written on Neon is lost, because it's in the kept branch | Writes made on Neon since T-live, which F.3 carries back |

**If Neon snapshots aren't available on the Launch plan** (checked in C.3), E.5a uses Neon's point-in-time restore instead: `production` is restored to T-freeze, which is inside the 7-day window. In that case, a retry after more than 7 days needs a revised plan (R0), because the guard can't be released any other way.

### F.2 The full rollback, after testers have used the new app

**The one action that puts testers back on the old system is moving the address back to the old project.** Everything else here makes sure no tester's new data is left behind.

| # | Who | Action | Time (rehearsed in D.5 and D.6) |
|---|---|---|---|
| 1 | Samuel | **New** project → Publishing → Domains → **Disconnect** `apptest.catspotters.com`. That stops new writes on Neon (freeze) | 1 minute |
| 2 | Claude | `db-ops -f target=production -f command=carry-back-dry-run`, and posts in chat, per table, what would be inserted, updated and deleted, plus what has no home in the old database | 2 minutes |
| 3 | Samuel | Replies in chat: **"apply"**, or **"accept the loss"** (only sensible if the dry run shows nothing, or only test rows). This is the one written sign-off R1 requires | — |
| 4 | Claude | `db-ops -f target=production -f command=carry-back-apply -f confirm=APPLY`. It commits only if the old database then matches Neon exactly (projected). Then `fingerprint-source` is posted | 2 minutes |
| 5 | Samuel | **Old** project → Publishing → Domains → **Connect** `apptest.catspotters.com` ("move to this project"). If D.6 found different DNS values, Claude puts the old ones back in Cloudflare (C.4j token). Claude watches it live, as in E.10 (the old app's `307` to `replit.com/__replshield`, and a valid certificate). **If it isn't serving within 20 minutes**, web testers are given the old deployment's own `*.replit.app` address as a stop-gap (behind the same Replit wall they already use), and Claude diagnoses the domain with Replit's agent. Nothing about the data changes | 3 to 10 minutes as estimated, with a maximum of 20 |
| 6 | Claude | `curl` `apptest` returns the old app's `307` to `replit.com/__replshield` (Password protected, as before). Posts on SYC-121 and tells Samuel to send Part I, message 3 | 2 minutes |

**About 15 to 25 minutes in total**, replaced by the rehearsal's measured times. Store builds that carry only the tester key can't get past Replit's wall on the old project. That's the situation before the switch, and it's why SYC-113 exists.

**If the problem is before T-live** (E.4 to E.10), the rollback is **step 5 alone**. No tester has written to Neon, so there's nothing to carry back.

### F.3 Testers' writes on Neon, if we roll back

- **What's carried back:** every row in the nine tables the old database has, made identical to Neon's version (inserts, updates and deletes), in one transaction that commits only if the result matches exactly (§B.3). New columns the old database lacks, for example SYC-98's `public_id`, are dropped in the copy. The old app uses the numeric photo ids, which are kept.
- **What isn't:** rows in tables the old database lacks (`0001` and later). Before any feature writes to them, there are none. Once one does, the dry run lists them, and they **stay on Neon**, which is kept, until the feature is back.
- **Tested before it's ever needed:** B.3 test 4 in CI, and D.5 against a copy.
- **If Neon itself is unreachable** (an outage), the carry-back can't read it. Samuel then chooses between waiting for Neon and rolling back with step 5 alone, accepting that writes made since T-live are held on Neon until it's back. They're recovered later by hand, and ticketed, because by then the old app will have its own new rows, and the carry-back mirrors rather than merges. Neon's 7-day restore protects those writes in the meantime.

### F.4 Can the three changes be undone separately?

| Change | Undone on its own? | How |
|---|---|---|
| Access: Public with the gates | **Yes** | New project → Publishing → Access: **Password protected** → publish. The database and region don't change. That's SYC-113's rollback |
| Region: Europe | Only by going back to the old project | Region is permanent per project, and there's no reason to be in Europe on the old database |
| Database: Neon | **Not on its own** | The new code expects the post-cutover schema (`0001` at cutover, and `0002` onward once the post-move queue starts), which the old database doesn't have. Pointing the new app at the old database would need migrating the old database, which R1 forbids. So a database rollback is the full rollback (F.2) |

**Why one cutover rather than three.** Region and database move together because the new project is the only place Europe exists. Doing the database first in the old project would mean publishing the old project in place, which is the Replit database-diff risk this ticket removes, and would leave no untouched way back. Public is the one change that *could* be separated, and it effectively is: the new project runs Public with the gates from C.6, days before cutover, and passes the SYC-113 checklist before any real data is in it. On cutover day, access doesn't change at all.

### F.5 The rule for surprises

**Anything unexpected means rolling back first and investigating after.** That includes a count that's off by one, a warning nobody has seen before, a slow page, or a review screen. Rolling back loses nothing, because the carry-back is tested, and it costs 15 to 25 minutes. Improvising on live data can lose data, and there's no test for that.

---

## Part G · Retention, and the record of the decision

### G.1 How long the old setup is kept (decided: Q3, 30 days)

| What | Kept until | Then |
|---|---|---|
| **Old Replit project, its deployment, and its production and dev databases** | **Cutover + 30 days** (recommended), and never before Claude has posted a clean E.13 check from that week | Claude posts a final `fingerprint-source` and `carry-back-dry-run` (as in E.13). Samuel then unpublishes the old project and deletes its database, from its Database tool. The old project itself can stay as an archive of code at no cost. `REPLIT_PROD_DATABASE_URL` is removed from GitHub the same day |
| **Neon archive branch** `replit-final-<date>` | Launch + 30 days | Claude deletes it via the MCP, after Samuel's go-ahead in chat |
| **Encrypted dump** (if Q6 is yes) | Samuel's own copy, kept as long as he likes | — |
| **GitHub Actions dump artifact** (if Q6 is yes) | 7 days, the shortest artifact retention | It expires on its own |

**The old deployment stays published** behind Replit's password wall during the retention period, with no custom domain, so that a rollback is only a domain move, not a republish. E.13 would catch anyone writing to it through its `*.replit.app` address.

**When rollback stops being "no loss".** The carry-back puts back every row in the nine original tables. Once later features write to tables the old database doesn't have (for example SYC-43's staff list, or data spine PR 2's observations), a rollback leaves those rows on Neon, and the old app works without them. That's acceptable inside the retention window, and the dry run always lists them. The real point of no return is the retention date. After it, the way back is Neon's own restore (7 days) and the archive branch.

### G.2 Follow-ups this creates (filed in Linear when the plan is approved)

- The privacy policy and the Syros Cats ↔ Fair Shake data agreement name **Neon (Neon, Inc., a Databricks company, data held in Frankfurt)** as a processor alongside Replit, before store submission (`hosting-and-photo-storage.md` §7.10's rule, applied to the database).
- On the retention date: delete the old database, unpublish the old project, and remove the GitHub secret (G.1).
- Once SYC-105's Postgres rate-limit store lands, lift **Max instances: 1**.
- On the retention date, Samuel deletes the `claude-dns-catspotters` Cloudflare token (C.4j), unless Samuel wants to keep it for SYC-32's `api.` and `team.` records.
- Delete the throwaway app "JuicyUpbeatOutcome" (Samuel's to-do on SYC-102). It's unrelated, but still open.

### G.3 Proposed DECISIONS.md amendment (applied in the build PR only once Samuel approves this wording)

Added as a new part after Part 2g:

> ## Part 2h · The database moves to Neon, 29 September 2026 (SYC-121)
>
> Samuel decided that the app's Postgres moves from Replit's managed database to **Neon, Frankfurt (`aws-eu-central-1`), on the paid Launch plan from day one**, with a 7-day restore window. The app itself stays on Replit, **republished as a new project in Replit's Europe region**, because a Replit project's region can't be changed after it's first published.
>
> - **This supersedes D1 for the database, not for photos.** Photos stay in Postgres (now Neon's), and SYC-46 is unchanged. Compute stays on Replit.
> - **Why:** SYC-102 showed that Replit's publish rewrites the live database structure itself. It gates changes behind a review only available on its website, planned `TRUNCATE … CASCADE` for one change, and silently skipped changed safety rules and migration-history rows. With a database we control, our own migration runner (SYC-64) is the only thing that changes the schema. Replit's publish carries code only.
> - **Migrations reach production through the `db-ops` workflow**, which runs the runner against Neon before the code that needs it is published (`docs/DEPLOYMENT.md` §C).
> - **The old Replit database is kept untouched as the way back for 30 days after the cutover** (SYC-121 plan, Part G). It's never deleted before a clean week-one check. The exact date is recorded here on cutover day.
> - `hosting-and-photo-storage.md` §4.2's 15 November trigger still stands for photos and compute. For the database, it has fired early. The spec's "Replit through launch" line is corrected for the database.

And one line appended under **D1**: *"Superseded for the database by Part 2h (SYC-121, 29 Sep 2026): Postgres is on Neon, Frankfurt. Photos stay in Postgres, and compute stays on Replit."*

---

## Part H · Answers for dependent plans, and proposed edits to them

### H.1 Answers for dependent plans

**(a) Which Neon database is production, and which is development**

| Role | Neon | Reached by |
|---|---|---|
| **Production** | Project **`syros-cat-spotter`**, branch **`production`**, database `neondb` | The live app, through `APP_DATABASE_URL` (pooled). Claude's commands go through `db-ops` with `target=production` (direct) |
| **Development** | Same project, branch **`development`** | The Replit workspace of the **new** project (`DEV_DATABASE_URL`, direct), including `post-merge.sh`'s `migrate` and the api tests run there. Claude's commands go through `db-ops` with `target=development` |
| Rehearsal | Same project, branch **`rehearsal`** | Switchover rehearsals only. Nothing else uses it |
| **CI** | **Not Neon.** CI's own `postgres:16` service container, as today | `DATABASE_URL` in `.github/workflows/ci.yml` |
| **Local tests** | **Not Neon.** A local Postgres on `DATABASE_URL`, as today. Tests build their own throwaway databases on it | — |

Dev and production hold separate data. After cutover, `development` is reset from `production` (decided, Q5) and can be reset again at any time. Rows added to either never reach the other.

**(b) Where connection strings live for Claude-run commands, and the production migration route**

- **All of Claude's database commands (migrate, seed, verify, smoke, copy) run in GitHub Actions through `.github/workflows/db-ops.yml`.** The connection strings are **GitHub Environment secrets**: `NEON_PROD_DIRECT_URL` in environment `production`, and `NEON_DEV_DIRECT_URL` in environment `development`. Both environments are limited to `main`. Claude never sees them, and never calls the Neon MCP's `get_connection_string`. The Repl shell isn't used for production. **Read-only checks** (for example `pg_constraint`, `pg_trigger` and row counts) can also use the Neon MCP's `run_sql` with `SELECT` statements only, which needs no connection string.
- **Yes, the #13 runner is the production migration route.** The exact command:

  ```bash
  gh workflow run db-ops.yml --ref main -f target=production -f command=migrate
  gh run watch && gh run view --log
  gh workflow run db-ops.yml --ref main -f target=production -f command=verify
  ```

  Inside the job, that runs `pnpm --filter @workspace/db run migrate` with `DATABASE_URL` set to the production branch's **direct** URL for that one step. For development, swap `target=development`. Order: migrate production **before** publishing code that needs the change, then publish, then `-f command=smoke`.
- **For the `people` command (#20, built in PR #28):** the SYC-43 build adds `people-add` and `people-list` to `db-ops`'s command list, with the target always explicit. The `people` CLI requires `--target`, and accepts `DATABASE_URL` only when `DATABASE_TARGET` names the same target. So `db-ops` passes both: `DATABASE_TARGET` comes from the GitHub Environment (A.2) and `--target` from the workflow input. A mismatch refuses to run.
- **A staff email is never a plain workflow input** (agreed with the other session, external review X8). A `workflow_dispatch` input is stored in the run's details and can be echoed into the log. Instead:
  - **Preferred:** Claude sets a short-lived Environment secret, `PEOPLE_EMAIL`, with `gh secret set PEOPLE_EMAIL --env production` from a terminal tab, reading the address from that tab's environment (never typed into chat). `people-add` reads it, and Claude deletes the secret after the run (`gh secret delete PEOPLE_EMAIL --env production`). GitHub masks secrets in logs.
  - **Or,** if an input is ever used: the script's **first** action is `echo "::add-mask::$EMAIL"`, before any other use of the value. The value is never echoed. The `people` CLI prints the person's id and role, never the address.
  - The workflow's `set -x` ban (§B.4) applies. The B.4 output check for connection strings is extended to check that the email doesn't appear in the log.
- **Timing:** none of this reaches production until cutover (Part E) is done and verified. Until then, migrations that merge go to the Neon `development` branch only, and the migration freeze in Part D applies. **The cutover itself applies only `0000` adoption and `0001` (Q10).** After it, the queue is: **#24 (SYC-98, `0002`) → #28 (SYC-43 part 1, regenerated after #24) → the rest in the agreed order** (SYC-63 §5, then data spine PR 3's backfill, and so on), each migrated to production before its code is published.

### H.2 Proposed edits to the data spine plan (#23, `docs/superpowers/plans/data-spine.md`)

These are proposed for the session that owns #23, and **not made here**:

1. **Remove "PR P" entirely** (the §"PR P — Our migrations reach production" block, and its rows in the sequence table, Parallelism, the Model delegation table and C8). Replace it with one line: *"Migrations reach production through the SYC-121 `db-ops` workflow (the #13 runner against Neon). Replit's publish carries code only."*
2. **Q1 is answered by SYC-121.** Mark it decided ("the database moved off Replit; option D, taken on other grounds") and delete options A to C, the build-or-start-up variants, and the start-up write gate.
3. **"PR 2 deploys only after PR P is live"** and "PR 2 and PR 3 are blocked on PR P" become **"blocked on SYC-121's cutover (Part E) being complete and verified"**.
4. **"How each step reaches production"** is rewritten. The Replit-diff table, the "first publish copies everything" bullets and the `DATABASE_URL`-at-build question are removed. Keep the launch-gate paragraph (PR 5 and PR 6 before the `/api` pass comes off) unchanged. Replace the "step 1's tables may be missing their triggers" concern with: *"`0001` never reached Replit's production database. It is applied on Neon by the runner at cutover (SYC-121 E.8), and the triggers are checked there."*
5. **Data safety:** "Confirm a restorable backup point (Replit's point-in-time restore or a dump)" becomes **"Neon's 7-day restore; note the timestamp before PR 3's backfill runs"**. The "up/down/up against a copy of production" becomes **a Neon branch made from `production`** (instant), not a throwaway Replit database.
6. **Verification after each step** uses the Neon MCP's read-only `run_sql`, instead of Replit's read-only query tool.
7. **PR 5's `BLUR_GRID_SECRET`** goes into the **new** project's deployment secrets (SYC-121 C.6), not the old one's.
8. Review rows R5, R13, R15, R19 and R20 are marked **"superseded by SYC-121"**. R15's point about the runner's advisory lock waiting indefinitely still matters: `db-ops` serialises runs with a `concurrency` group, and fixing the lock itself is a small follow-up for the runner.
9. The global constraint "never approve a Replit publish database review with TRUNCATE or DROP" **stays**, reworded as SYC-121's R3.
10. **The migration queue** in the data spine plan's sequence table starts after the move: `0000` and `0001` are on Neon from the cutover, then #24 (SYC-98 `0002`), then #28 (SYC-43 part 1), then SYC-63 §5, then PR 3's backfill (Q10, decided 29 Sep).

### H.3 Proposed rollout wording for SYC-63 (#21, `docs/superpowers/plans/syc-63-self-service-deletion.md`)

**For the other session to apply. Suggested replacement text:**

> **§5, replace the "Checked against the SYC-102 publish test" block with:**
> **How this reaches production (SYC-121).** The database is on Neon, and Replit's publish no longer touches its structure. This migration, including the two CHECK constraints and the sightings append-only guard (a trigger and its function), reaches production only through the #13 runner, run by `db-ops` (`gh workflow run db-ops.yml --ref main -f target=production -f command=migrate`) **before** the code that uses it is published. The runner applies every statement exactly as written, in one transaction, so there's no partial delivery. Relaxing `NOT NULL`, the nullable columns and the index are applied the same way.
>
> **§11, replace step 0a with:**
> 0a. **SYC-121's cutover must be complete and verified before this migration reaches production.** Until then it goes to the Neon `development` branch only. Its place in the queue is after #24 (SYC-98) and #28 (SYC-43 part 1), so it's regenerated on top of them when it's built. Then:
>    - Run `db-ops` `migrate` against production **before** publishing the server code (the migrate-then-publish order in `docs/DEPLOYMENT.md` §C).
>    - **Probe, don't assume:** Claude confirms, through the Neon MCP's read-only `run_sql`, that `pg_trigger` lists the `observations` and `sightings` guards by name, and that `pg_constraint` lists both checks.
>    - Take a note of the time before running it. Neon's 7-day restore is the backstop, and the rollback block's warning (restoring `NOT NULL` fails once any row is redacted) still applies.
>    - If Replit's Publish ever shows a database review, cancel it (SYC-121 R3).
>
> **Remove** every reference to "spine PR P" and "Q1" as rollout dependencies (§5's flag and §11's 0a bullets). **Keep** step 1's dependency on data spine PRs 2, 3 and 4, unchanged.

### H.4 Notes on SYC-43 part 1 (#20, merged)

#20 already describes the Neon route. What it left open is answered in H.1: the branch names, and `db-ops` as the stored-credential route for the `people` command. Its rollout step 4 can now name `db-ops -f target=production -f command=people-add`. Its migration lands after the cutover, behind SYC-98's `0002`, as it says.

### H.5 Proposed rollout wording for the SYC-113 plan (#27, merged: `docs/superpowers/plans/syc-113-pre-launch-gates.md`)

Its "Rollout order" step 3 still describes switching the **existing** deployment to Public by unpublishing and republishing, "in the same publish as the EU-region move". SYC-121 makes that obsolete: the region can't change in place, so the Public switch happens on the **new** project's first publish. **Suggested replacement for step 3, for the owning session to apply:**

> 3. **Public goes live on the new EU project's first publish (SYC-121 C.6), not by changing the existing deployment.** A Replit project's region can't be changed after it's first published, so SYC-121 publishes a new project in Europe. That project's **first** publish is already **Public**, with this code, `PRELAUNCH_GATE` left unset (so on), and the three `PRELAUNCH_*` deployment secrets set beforehand. There's no unpublish step and no outage for this. It happens on the new project's own `*.replit.app` address, days before testers move to it. **The code and the access setting still go out together**: the new project is never published without the gate code. The old project stays **Password protected**, untouched, as SYC-121's way back. `apptest.catspotters.com` moves to the new project at SYC-121's cutover (E.10).

Step 4 needs one extra sentence: *"The checklist runs twice: on the new project's `*.replit.app` address at SYC-121 C.7 and D.4 (without tester data first, then with the rehearsal copy), and on `apptest.catspotters.com` at SYC-121 E.11. Item 7's 200 case waits for SYC-83 (see SYC-121 C.7)."* The rollback line ("set the deployment back to Password protected") is still right, applied to the **new** project.

---

## Part I · Messages to testers (for Samuel to send; plain English)

**Message 1, the day before:**
> Hi all, a quick heads-up. Tomorrow at <time> Greek time, Cat Spotters will be offline for up to an hour while we move it to a new home in Europe. Your cats, sightings and photos all come with it. If you spot a cat during that hour, the phone app will keep it and send it once we're back. On the website, it may ask you to try again later. When it's back, the website will ask for a new tester password once: **<password, shared separately>**. Thank you for testing!

**Message 2, when it's back:**
> We're back! Cat Spotters is now running from Europe. Everything you've spotted is still there. The website will ask once for the tester password I sent yesterday. If anything looks wrong or missing, tell me which cat and roughly when you spotted it, and I'll check.

**Message 3, only if we have to roll back:**
> Small change of plan: we've moved Cat Spotters back to where it was while we sort something out. Anything you added today is safe. On the website you'll see the old login page again, the same one as before. Sorry for the bother.

---

## Part J · Decisions for Samuel

**All ten decided by Samuel on 29 Sep 2026:** Q1 A · Q2 A · Q3 30 days · Q4 A · Q5 A · Q6 yes · Q7 A · Q8 A · Q9 approved (with the 30-day wording) · **Q10 B**. Each is marked below. The options are kept as the record of what was weighed.

Each decision has a recommendation. Q1 and Q2 shape the plan. The rest are settings.

**Q1 · How do we get to Europe? (This shapes the whole plan.)**
**Decided 29 Sep 2026: A: a new EU project, with the old one kept untouched.**
Replit can't change a published app's region. So "the EU republish" means publishing a new copy of the project.
- **A. A new EU project on Neon, with the old one kept untouched as the way back** *(recommended)*. *Benefits:* the cleanest rollback there is: move the web address back, and the old app, database and region are exactly as they were. The new project is tested in public (behind the gates) for days before any tester touches it. There's never a moment where the app is in America and the database in Frankfurt. *Risks:* more setup (secrets, the OpenAI integration and the GitHub link are all checked in C.5), and a web-address move on the day, which the rehearsal times. *For testers:* one pause of about an hour.
- **B. Stay in the current project and region, and switch only the database.** *Benefits:* less setup. *Risks:* if the app is in North America (C.1 tells us), every page gets slower. A sighting upload would take 1 to 1.5 seconds longer, for good. It also needs a publish of the old project, which is the Replit database-review risk this ticket exists to remove, and it leaves no untouched way back. *If C.1 shows the app is already in Europe,* B's latency cost disappears, but the rollback and review risks remain, so A is still recommended.
- **C. Database first in the current project, then Europe later.** *Risks:* two pauses for testers, and the interim is slow. It has B's publish risk too.
- **Recommendation: A.**

**Q2 · Where do Claude's database commands run?**
**Decided 29 Sep 2026: A: the `db-ops` workflow.**
- **A. A GitHub Actions workflow (`db-ops`) that Claude starts, with the database addresses kept in GitHub's secret store** *(recommended)*. *Benefits:* Claude does it end to end, every run is logged, the secrets are never visible, and it's the same route for the copy, migrations, checks and staff seeding. *Risks:* the old database's address is stored in GitHub for the retention period (removed afterwards), and the tester data passes through a GitHub runner during the copy (it's deleted when the job ends).
- **B. The Repl shell.** *Benefits:* the data never leaves Replit or Neon. *Risks:* Samuel has to type every command, and there's no log of what ran.
- **C. Claude's Mac**, with the addresses in a local file. *Risks:* the connection strings sit on disk, where Claude's tools can read them, which breaks the secrets rule.
- **Recommendation: A.**

**Q3 · How long is the old Replit database kept after the switch?**
**Decided 29 Sep 2026: 30 days.**
- **30 days** *(recommended)*: long enough to spot anything wrong through a full cycle of tester use, and short enough that the old copy doesn't drift into being a second source of truth. **14 days** is the minimum sensible. **Until launch** is the most cautious, but it keeps a stale copy of personal data around longer than it's needed.
- **Recommendation: 30 days**, and never before a clean week-one check (E.13).

**Q4 · Should Neon's database sleep when idle?**
**Decided 29 Sep 2026: A: sleep after 5 minutes.**
- **A. Sleep after 5 minutes idle** *(recommended for now)*: about $5–10 a month (SYC-121's estimate). The first request after a quiet spell waits about half a second while it wakes.
- **B. Always on (the smallest size):** about $19 a month (0.25 compute units × 730 hours × $0.106). No wake-up wait.
- **C. Sleep after an hour:** a middle ground in both cost and wake-ups.
- **Recommendation: A** during testing. Revisit at launch, when a slow first page matters more.

**Q5 · What goes in the development database?**
**Decided 29 Sep 2026: A: a refreshable copy of real data.**
- **A. A copy of the real data, refreshed from production when wanted** *(recommended)*. *Benefits:* changes are tested against real shapes and real Greek names before production. *Risks:* testers' data sits in the development copy too. The people who can see it are the same as for production (Samuel, Claude, and Replit's agent in the workspace).
- **B. Structure only, with no real rows.** *Benefits:* no personal data in development. *Risks:* bugs that only show with real data reach production first.
- **Recommendation: A.**

**Q6 · Keep a third, offline copy of the old database?**
**Decided 29 Sep 2026: yes, encrypted, with a key only Samuel holds (C.4i).**
- **Yes** *(recommended)*: at cutover, the dump is encrypted with a key only Samuel holds. Samuel runs one command on his Mac once, to make the key, and downloads one file on the day. *Benefit:* a copy outside both Replit and Neon.
- **No:** we rely on the untouched Replit database plus Neon's archive branch.
- **Recommendation: yes.** It's 18 MB, and a few minutes of Samuel's time.

**Q7 · Who changes DNS records on the day?**
**Decided 29 Sep 2026: A: a Cloudflare token for Claude that can edit DNS for `catspotters.com` only (C.4j).**
- **A. Give Claude's Cloudflare token permission to edit DNS for `catspotters.com`** *(recommended)*. *Benefits:* Claude lowers the TTL the day before, makes any change the move needs, and checks it straight away. In a rollback, that's one fewer thing for Samuel under pressure. *Risks:* a broader token (limited to this one domain).
- **B. Samuel makes the DNS changes.**
- **Recommendation: A.**

**Q8 · Should Samuel approve each production database run in GitHub?**
**Decided 29 Sep 2026: A: no approval click; runs only from `main`, one at a time.**
- **A. No approval click, but runs only from `main`, and one at a time** *(recommended)*. Every run is logged and announced in chat.
- **B. Samuel clicks "Approve" in GitHub for every production run.** *Benefit:* a human gate. *Risk:* Samuel becomes the executor for every migration.
- **Recommendation: A.**

**Q9 · Approve the DECISIONS.md wording in G.3?** *Recommendation: approve as written*, with the retention date filled in from Q3.
**Decided 29 Sep 2026: approved as written. G.3 now carries the 30-day retention wording.**

**Q10 · SYC-98 (#24): in the cutover, or after it?**
**Decided 29 Sep 2026: B, after the move, through the normal route.** The cutover applies only `0000` adoption and `0001`. #24 stays unmerged until the cutover is verified, then leads the post-move queue (A.6).
- **A. Merge it before the rehearsal, so its `0002` is applied on Neon at cutover** *(recommended)*. It never meets Replit's database, and photo links become unguessable from day one.
- **B. After cutover**, through the normal route. That's one more migration to schedule.
- **Recommendation: A**, if it's merged before the rehearsal. Otherwise B, with no delay to the move.

---

## Model delegation

This plan was written on Opus (the chip's stated tier). The build and the runbook are delegated as follows:

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| B.1 resolver and wiring | Sonnet | Clear spec, and the tests are written in this plan | The given tests. **Mutation probes** (three, listed in B.1), because a wrong fallback is a silent failure (the app writing to the wrong database). Opus spot review of the diff |
| B.2 start-up log | Haiku | Small, mechanical | Its tests, plus typecheck |
| B.3 fingerprint, guard, compare | Sonnet | Standard database code against a precise spec | Tests 1 to 3 and 6, plus **mutation probes** (order by, read-only session, cutover guard) |
| **B.3 carry-back** | **Opus** | Escalated: it's the only code that writes to the old database, and its failure modes are silent (a missed update or a wrong sequence looks fine until a tester's row is gone) | Test 4 end to end, test 5, **mutation probes** (skip update, skip setval), and the D.5 rehearsal against a real copy |
| B.4 `db-ops` workflow and script | Sonnet | Configuration and shell work to a spec | `actionlint`, the local dry run, the output grep for connection strings, and Opus review (it handles secrets) |
| B.8 queued sightings and the gate (separate PR) | Sonnet | Small, well-specified client change, with tests written in the plan | The step 1 and 2 tests; **mutation probes** (status-only matching, the `failCount` exemption, the loop stopping), because the failure being fixed is silent (a sighting quietly marked as failed); the browser check at 390 px and desktop; Opus spot review; the E.11 live replay probe |
| B.5 smoke key, B.6 docs | Haiku | Mechanical | Test for B.5; spot review of the docs against this plan |
| Build PR review | Opus, independent critic in its own worktree | Adversarial review of a live-data write path, per `/ship` | Plus `/security-review` |
| **Adversarial review of this plan** (before Samuel approves) | Opus | Samuel's pipeline requires it, and the chip was told not to spawn agents | **Done 29 Sep** by the coordinating session. Findings X1 to X8 are folded in (Review, "External review") |
| Parts C to F (the rehearsal, cutover and rollback) | Session model (Opus) | Live data and secrets, with judgement at every check. Not delegated | The checks in each step, R0, and the E.13 aftercare probes |
| Linear updates and progress notes | Haiku, if delegated at all | Mechanical | Spot read |

**Where else must the invariants hold?** (Enumerated, because a mutation probe only protects sites already thought of.)

- **"Nothing uses Replit's database":** `lib/db/src/index.ts` (the app), `cli.ts` `withClient` (migrate and rollback), `cli.ts` `migrationsBuildTheSchema` (check), `drizzle.config.ts` (generate, which doesn't connect), `lib/db` tests (CI and local only, never run in the Replit workspace's workflows), `scripts/post-merge.sh` (via the CLI), and the api-server `pretest` (via the CLI). `artifacts/api-server/scripts/security-check.mjs` doesn't connect to the database. The build checks this list again with `grep -rn "DATABASE_URL"` over the repo.
- **"No connection string is printed":** the resolver's errors, the pool's error handler, the B.2 log, the CLI's error output, `db-ops.sh`, the `pg_dump` and `pg_restore` stderr (they print host names, not passwords, and the grep in B.4 checks it), and GitHub's own secret masking as a last line.

---

## Review

### Self-review against the brief (Chip H, 29 Sep 2026)

| Requirement | Where it's met |
|---|---|
| Live tester data survives; nothing dropped from Replit | R1 (read-only sessions enforced by Postgres), R2, A.5, E.5 and E.13 (fingerprints prove the old database is unchanged), G.1 |
| Samuel upgrades Neon before any live data is copied; Claude never pays | C.2 before C.3; C.4h copies nothing |
| Secrets never in chat, files, commits or Linear | R4, A.2, C.4 (console → secret box), B.1 and B.4 (tests and a grep prove nothing prints one), and no `get_connection_string` |
| Don't publish the real Repl; one combined publish | The real (old) Repl is never published again (R2). The new project's first publish (C.6) combines Neon, Europe and Public with the gates. F.4 explains why cutover day then needs no access change |
| SYC-113 gates merged before publish; secrets set; tester key in EAS only; 12-item checklist | A.6, C.0, C.4g, C.6 step 2, C.7, D.4, E.11 |
| Replit's publish diff and the dev database | A.5; B.1 refuses `DATABASE_URL` in a workspace and in production; R3 |
| Migrations: where they run, baseline adoption, `0001`/`0002`, before or after the copy | A.4, D.3 and E.8: the copy is taken **before** `0001` exists anywhere near production, because it never reaches Replit's database. Neon adopts `0000` by exact match and applies `0001` at cutover. `0002` (#24) and later come after the move (Q10). The pitfalls: the restore leaves out `CREATE SCHEMA public`, dumps `public` only (so `drizzle` is absent and adoption runs as designed), and the `switchover` marker schema sits outside `public` so adoption isn't disturbed. Collation is compared, since the signature doesn't cover it |
| Region and latency | A.7 and the C.7 round-trip check. The "app in America, database in Frankfurt" state can't arise in option A |
| Downtime and write freeze, with no maintenance mode | E.4 (disconnect the domain from the old project; its database is untouched) and E.5 (proved quiet). Tester messages in Part I |
| Verification: row counts, photo checksums, sequences, constraints and indexes, smoke, SYC-100 | B.3 fingerprint (the row hash covers photo bytes, and the signature covers constraints and indexes), D.2 to D.4, E.6 to E.11 |
| Rollback: exact steps, and writes made on Neon | Part F |
| Retention | G.1 |
| Knock-on for #23, #20 and #21 | Part H |
| D1 superseded, with the amendment text | G.3 |

### Samuel's rollback requirements (added 29 Sep)

| # | Requirement | How it's met |
|---|---|---|
| 1 | A trigger and a rollback for every step, and the point of no return | F.1's table, step by step. There's no point of no return inside the retention window. The real one is the retention date (G.1), and G.1 also explains how rollback narrows as later features write to new tables |
| 2 | The old path stays intact, proved, with a copy Samuel controls, recorded before anything else | R1 and R2. E.3 records the counts and hashes before the freeze, and E.5 and E.13 prove no change. The copies: the untouched old database, Neon's archive branch (E.7, in Samuel's Neon account), and the encrypted dump (Q6) |
| 3 | A one-action revert: which action, how long, and who | Moving `apptest.catspotters.com` back to the old project (F.2 step 5, Samuel's clicks, 3 to 10 minutes, timed in D.6). With tester writes, it's preceded by Claude's two `db-ops` runs (about 5 minutes) |
| 4 | Writes on Neon after the switch | F.3 and the carry-back (B.3), with tests (B.3 test 4, mutation probes) and a rehearsal (D.5). "Accept the loss" needs Samuel's written sign-off (F.2 step 3) |
| 5 | A rehearsal first, including the rollback, with timings | Part D (D.5 is the data half of the rollback, D.6 the address half, and D.8 drills rolling back from every Neon state). The cutover is scheduled only after it passes |
| 6 | Can Europe and Public roll back separately from the database? | F.4: Public can (and is tested days early); Europe and the database can't, and the reason is given. The single cutover is justified there |
| 7 | Stop and don't improvise | R0 and F.5 |

### Checks run on this plan

- **Placeholders:** the only `<...>` values are ones only known on the day (a date, a time, the tester password, a PR number). No step says "TBD".
- **Names are consistent throughout:** `APP_DATABASE_URL`, `DEV_DATABASE_URL`, `NEON_PROD_DIRECT_URL`, `NEON_REHEARSAL_DIRECT_URL`, `NEON_DEV_DIRECT_URL`, `REPLIT_PROD_DATABASE_URL` and `PRELAUNCH_TESTER_KEY`. The `db-ops` commands `fingerprint-source`, `copy-rehearsal`, `copy-cutover`, `verify`, `migrate`, `migrate-rollback`, `smoke`, `carry-back-dry-run` and `carry-back-apply`. The branches `production`, `development`, `rehearsal` and `replit-final-<date>`.
- **Found and fixed while writing:**
  1. The first draft rolled back by pointing the new app at the old database. That can't work, because the new code expects `0001` (and later `0002`), so F.4 now says a database rollback is a full rollback.
  2. The first draft froze writes by unpublishing the old project, which removes its domain and would make a rollback a republish of the old project, with the review risk. It now disconnects the domain only.
  3. Keeping production empty until cutover would have forced a secret change and a republish on the day. Production now holds a marked rehearsal copy that only the cutover can replace.
  4. `smoke` would have failed against the gate (B.5).
  5. An idle Neon connection would have crashed the API through an unhandled pool error (B.1).

### Open risks, stated

- **Unverified until C.4h:** that Replit's production database accepts connections from outside Replit. The Replit agent cited the docs but hadn't tested it. If it doesn't, R0 applies: we stop and re-plan the copy step (for example, running `pg_dump` from the old project's shell with Samuel at the keyboard). Nothing live changes.
- **Unverified until C.5:** what a remix actually carries over (secrets, the OpenAI integration, the Git link). Each is checked before the first publish.
- **Unverified until D.3:** that Replit's production schema exactly matches `0000_baseline`. SYC-102 compared tables but not every column. If adoption refuses, the runner prints the differences. The fix is a reviewed change made on the Neon rehearsal copy only, and then the rehearsal runs again. Replit's database is never changed.
- **Replit's domain-move behaviour** (whether DNS values change between regions) is measured in D.6, not assumed.
- **The independent adversarial review has run** (29 Sep). Its eight findings are folded in, and recorded as X1 to X8 below.

### External review (independent adversarial review of PR #29, 29 Sep 2026), and what changed

| # | Finding | Severity | Fix |
|---|---|---|---|
| X1 | F.1's E.7 row said "retry at a later cutover", but by E.7 `copy-cutover` has already written `cutover_done`, so the guard would refuse the retry. The same bug hid in E.8 to E.10, and E.5 pointed at the wrong F.2 step | Blocker | Four named Neon states, with a **"Neon state at the failure"** and a **"why the retry passes the guards"** column for every F.1 row. The guard now keeps `rehearsal_marker` until `mark --mode cutover` swaps it for `cutover_done` atomically, so a failed copy stays retryable. **E.5a** takes a Neon snapshot before the copy, and every recovery from E.7 onward restores it. Archive branches are numbered per attempt. B.3 test 3 covers every state, with two new mutation probes. **D.8** drills rolling back from each state on the `rehearsal` branch. C.3 checks that snapshots work, with a fallback to point-in-time restore |
| X2 | Replit's docs say published apps on the Starter plan expire after 30 days. The old deployment, with no domain and no traffic, could expire inside the retention window and take the rollback target with it | Should-fix, treated as blocking | C.1 step 4: Samuel reports the plan. A **gate before C.5** (Claude confirms against Replit's docs that there's no expiry before the retention date; if it's Starter, stop, and the fallback is Samuel upgrading), repeated at E.0. F.1's C row lists it as a failure |
| X3 | D.6's timed domain move uses a different, fresh hostname, so it's an estimate for E.10, not a measurement of it | Judgement call, accepted | D.6 now says so. E.10 and F.2 step 5 are **watched live** (healthz 200 from the right app, and a valid certificate checked without `-k`), with a **20-minute maximum wait** after which the rollback starts (E.10), or the stop-gap address is used (F.2) |
| X4 | A web sighting queued before the freeze and replayed after cutover, with no new-gate cookie, gets the gate's 401. `classifySyncFailure` treats any 4xx as permanent, so it silently becomes an error | Judgement call. **Samuel decided:** a separate small PR carried by this plan, merged before cutover | **Task B.8** (its own PR): the gate's 401 with `error: "prelaunch_pass_required"` (the exact body in PR #30) means "needs sign-in". The item stays queued, the tester is prompted, and it retries after sign-in. Other 4xx responses are unchanged. It's an E.0 hard precondition, has an E.11 live replay probe, and a Model delegation row (Sonnet, with mutation probes) |
| X5 | `gh workflow run db-ops.yml` examples didn't pin `--ref main` | Nit | All seven examples now pin `--ref main`. A.3 explains why (the Environment's branch rule checks the dispatch ref, not the checkout ref) and that the `db-ops -f …` shorthand in the tables means the pinned command |
| X6 | The merged SYC-113 plan (#27) still describes "unpublish, then republish Public in one go", which SYC-121 makes obsolete | Should-fix | **H.5**: replacement wording for #27's rollout step 3 (Public on the new project's first publish, with no unpublish) and an addition to step 4, for the owning session to apply |
| X7 | SYC-113 checklist item 7 expects a 200, but `INTERNAL_PEOPLE_TOKEN` isn't set until SYC-83, so the endpoint answers 503 | Should-fix | C.7 and E.11 run only item 7's refusal halves (a JSON 401, or 503 `not_configured`; never 200, HTML or 307). The 200 case moves to SYC-83's probes |
| X8 | (From the SYC-43 session, agreed.) `people-add` mustn't take a staff email as a plain `workflow_dispatch` input, which is stored in the run's details and can reach the log | Should-fix | H.1(b): a short-lived Environment secret `PEOPLE_EMAIL`, set and deleted by Claude from a terminal tab, is preferred. If an input is ever used, `::add-mask::` is the first action and the value is never echoed. The log check also covers the email. Also added from the same session: `DATABASE_TARGET` beside every URL (A.2, C.4, and the workflow environment), which the `people` CLI (PR #28) requires to match `--target` |
