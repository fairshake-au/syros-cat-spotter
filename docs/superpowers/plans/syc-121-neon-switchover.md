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

**Produces:** `logDatabaseTarget(pool: { query(sql: string): Promise<unknown> }, target: { source: string; host: string }, logger): Promise<void>`. It runs `select 1` twice after `listen`, and logs `{ source, host, roundTripMs }` from the second run (the first may include a Neon wake-up). It never blocks start-up. If the database is unreachable it logs a warning and resolves, rather than throwing. **This log line is what C.6, D.4 and E.8 read** to confirm the deployment is on the Neon production host, with a round trip under 20 ms.

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
| `guard-target --mode rehearsal\|cutover` (on `TARGET`) | **Refuses** if `switchover.cutover_done` exists, meaning production has already been cut over (R5). In `cutover` mode, it also refuses if `public` has any table and there's no `switchover.rehearsal_marker`. Otherwise it drops `public` and `drizzle`, recreates an empty `public`, and drops `switchover` in rehearsal mode | Yes, and only on Neon |
| `mark --mode rehearsal\|cutover --fingerprint <md5>` (on `TARGET`) | Creates the `switchover` schema and one row in `rehearsal_marker` or `cutover_done` (timestamp, source fingerprint) | Yes, and only on Neon |
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
  3. `guard-target --mode cutover` refuses a database with `switchover.cutover_done`. It also refuses one with tables but no marker. It accepts one with a marker and leaves it empty.
  4. **Carry-back, end to end.** Build the "old" database at `0000` with rows, and the "new" one at `0000`+`0001`+`0002` with the same rows. On "new", insert a sighting and a photo, rename a cat, delete a subscription, and add an `observations` row. The dry run reports 2 inserts, 1 update and 1 delete, with `observations` reported as having no home. After `--apply`, `compare --projected` passes, and `nextval` on "old" returns `max(id)+1`.
  5. The carry-back refuses to `--apply` when the old database has a column Neon lacks. That would mean the old schema isn't the baseline, so it stops (R0).
  6. `fingerprint` opens its source read-only: an `insert` through its client is refused with SQLSTATE `25006`.
- [ ] **Step 2:** run them and watch them fail. **Step 3:** implement. **Step 4:** they pass.
- [ ] **Step 5: mutation probes** (each must turn the named test red, then be restored):
  - Skip the update pass, and test 4 fails.
  - Skip `setval`, and test 4's `nextval` check fails.
  - Drop the `order by` from the fingerprint's aggregate, and test 1 fails (the rows were inserted in a different order).
  - Remove the read-only session option, and test 6 fails.
  - Remove the `cutover_done` check, and test 3 fails.
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
        options: [fingerprint-source, copy, verify, migrate, migrate-rollback, smoke, carry-back-dry-run, carry-back-apply]
      base_url: { type: string, required: false, description: "For smoke: defaults to https://apptest.catspotters.com" }
      confirm: { type: string, required: false, description: "Type APPLY for carry-back-apply" }
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
        run: bash scripts/db-ops.sh
```

`scripts/db-ops.sh` maps each command to exactly one action. It runs with `set -euo pipefail`, never uses `set -x`, and never echoes a variable that holds a URL:

| Command | Runs |
|---|---|
| `fingerprint-source` | `switchover fingerprint`, with the source set to `$REPLIT_URL` (read-only) |
| `copy` (refused for `development`) | `guard-target` (the mode follows the target), then a `fingerprint` of the source, then `pg_dump -Fc -n public --no-owner --no-privileges --no-publications --no-subscriptions` from Replit in a read-only session, then `pg_restore --no-owner --no-privileges --single-transaction --exit-on-error -L <the table of contents without its "SCHEMA - public" line>` into Neon, then `compare`, then a **second** `fingerprint` of the source, which must equal the first (proving nothing was written to Replit during the copy), then `mark` (the rehearsal marker, or `cutover_done`). The dump lives only in the runner's temporary folder, apart from the encrypted copy in decision Q6 |
| `verify` | `compare --projected` (Replit against Neon, on the baseline tables), plus the migration history in `drizzle.__drizzle_migrations` checked against the journal's hashes |
| `migrate` / `migrate-rollback` | `pnpm --filter @workspace/db run migrate` (or `migrate:rollback`), with `DATABASE_URL=$NEON_URL` for that one command |
| `smoke` | `pnpm --filter @workspace/db run smoke "${BASE_URL:-https://apptest.catspotters.com}"`, with `PRELAUNCH_KEY` set |
| `carry-back-dry-run` / `carry-back-apply` | Production target only. `apply` also requires `CONFIRM == APPLY` |

The restore leaves out `CREATE SCHEMA public` because Neon's empty database already has one. Dumping with `-n public` leaves out Replit's own schemas. Neither the old database nor our baseline uses an extension. D.2 confirms all of this against the real dump's table of contents.

- [ ] **Step 1:** `actionlint` and `bash -n scripts/db-ops.sh` pass.
- [ ] **Step 2: a local dry run.** Run `scripts/db-ops.sh` with `NEON_URL` and `REPLIT_URL` pointing at two local databases, with the source built at `0000` and holding rows. `copy`, `verify` and `migrate` all succeed. A second `copy` into the same target with the `production` mode is refused.
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

### Task B.7: prove the whole PR

- [ ] `pnpm --filter @workspace/db run migrate:check`, `pnpm --filter @workspace/db test`, the api-server tests and all the typechecks pass, both locally and in CI.
- [ ] The PR body records the mutation probes from B.1 and B.3, each with the test that went red.
- [ ] Ship it with `/ship`: an independent adversarial review (see Model delegation) and `/security-review`, since the PR handles secrets and adds a write path to live data.
