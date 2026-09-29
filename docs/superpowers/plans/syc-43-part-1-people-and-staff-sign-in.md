# SYC-43 part 1: the list of people, and staff sign-in on the app's side

**For approval by Samuel. Nothing is built until he approves it.**
**Spec:** `docs/specs/team-access-and-welfare-queue.md` §2.4, §2.7, §2.8, §2.9, §2.11, §7.3, §8.2, §8.4, §8.6. Approved 28 Sep 2026 with the edits in `DECISIONS.md` Part 2b. None of those edits touch sign-in, roles or `people`, so the spec text applies as written.
**Linear:** SYC-43 (staff dashboard). This part unblocks SYC-83 (the Worker checks this list), SYC-29 (adding the Syros Cats people) and, through those, SYC-85 (retiring the shared password).
**Code lives in** this repo: `lib/db` and `artifacts/api-server`. The Worker changes that use it are in `fairshake-au/catspotters-website` and are separate tickets (see "What this part does not do").

## In plain English

Today there are two lists of who works at Syros Cats: a table in the website's database that the sign-in page checks, and nothing at all on the app's side. The approved design has **one list**, kept next to the cat data, that both systems read. Take someone off it and they lose access everywhere at their next click.

This part builds that list and the app's half of signing in:

1. **The list itself.** One row per person: their own email address, their name, and who added them and when. What each person is allowed to do is kept in a second small table, so one person can later hold two roles, such as staff and the cat guardian of her own street.
2. **Shared mailboxes can't be added.** `admin@syroscats.com` and addresses like it are refused by the database itself, with a message saying why. Each person signs in with their own address.
3. **A private question the sign-in page can ask the app:** "is this address on the list?" Only the sign-in page can ask it, using its own secret key. This is exactly what SYC-83 needs.
4. **The door into the dashboard.** When a signed-in person taps "Cat Spotters dashboard" on `admin.catspotters.com`, the sign-in page hands them over with a one-minute pass that only it can create. The app checks the pass carefully and gives them a 30-day session on `team.catspotters.com`. A failed check always gets the same plain refusal and a way back to the sign-in page.
5. **"Sign out everywhere" for one person.** If someone's session is ever stolen, one command signs that person out on every device without affecting anyone else.

**What staff notice after this part ships: nothing yet.** It is the foundation. Staff see a change when the Worker work lands (the sign-in page reads this list, and gets the "Cat Spotters dashboard" link). Until the queue screen exists (a later part of SYC-43), the dashboard link lands on a one-line page: "You're signed in as Susan. The welfare queue is coming soon", with a Sign out button.

## Four decisions for Samuel, each with a recommendation (1 and 2 decided; 3 and 4 open)

### Decision 1: The private question's address must start with `/api/` (a clash between the spec and the code)

**Decided by Samuel, 29 Sep 2026: A (`/api/internal/people/allowed`).**

The spec names the endpoint `GET /internal/people/allowed`. But the app is hosted on Replit, and Replit only sends paths starting with `/api` to the API server (`artifacts/api-server/.replit-artifact/artifact.toml`: `paths = ["/api"]`). A request to `/internal/...` would never reach it.

- **A. Recommended: use `/api/internal/people/allowed`.** It behaves the same as the spec intends, with a prefix Replit will route. *Risk:* none worth naming. The Worker simply uses this address.
- B. Add `/internal` to the Replit routing. *Risk:* it changes hosting configuration for everything else deployed, to save six characters.

### Decision 2: Send the address in the request body, not in the web address

**Decided by Samuel, 29 Sep 2026: A (`POST`, with the address in the body).**

The spec says `GET`. With a `GET`, the email address has to go in the web address itself, and web addresses are written into hosting and proxy logs we don't control. Our own logs already remove the query string, but Replit's might not.

- **A. Recommended: `POST`, with the address in the body.** Staff email addresses never appear in any log. *Risk:* a small wording change from the spec, recorded here.
- B. `GET` exactly as written. *Risk:* every sign-in writes a staff address into logs outside our control. That is the list of who has access, which is the exact thing the sign-in page is designed not to reveal (§2.1).

### Decision 3: Who builds the "Cat Spotters dashboard" link on the sign-in page

The app can check a pass, but something has to create it. That is the Worker, which lives in the other repository. SYC-83 already changes the same Worker file to ask the app's list.

- **A. Recommended: a new ticket that ships in the same Worker change as SYC-83.** Both use the same new secret setup and the same deploy, and both can be tested end to end together. *Risk:* that Worker change gets bigger. It stays reviewable because each half has its own tests.
- B. Two separate Worker changes. *Risk:* two deploys and two rounds of secret setup for work that has to go live together anyway.

### Decision 4: How the first people get onto the list, before there's a screen for it

The spec's screen for managing people (`manage_people`) belongs with the rest of the dashboard, later in SYC-43. SYC-29 needs people added before then.

- **A. Recommended: a small command, `people add / list / remove / sign-out-everywhere`, run by Claude against the database.** The same rules apply as for any future screen, because the database itself refuses shared mailboxes and badly formed addresses. Samuel and Jacky, the two people in today's `admins` table, are added first. *Risk:* until the screen exists, adding someone means asking Claude. That is a stopgap, and it sits uneasily with spec §10 ("without anybody running a database command"), so the screen is ticketed rather than left implied.
- B. Build the people screen now. *Risk:* a whole screen with its own design questions, in a part meant to be the smallest foundation.

## What this part builds

### 1. Database: one new migration, `<NNNN>_people_and_staff_sign_in`

**Its number is the next free one at merge time, expected `0003`.** `0002` is taken by SYC-98 (`photos.public_id`, branch `claude/syc-98-photo-public-ids`). The data spine plan (`docs/superpowers/plans/data-spine.md`) also queues `0003`–`0005`. The migration is **generated only after rebasing onto the latest `main`**, never numbered by hand. Migrations merge **one at a time**, so `lib/db/migrations/meta/_journal.json` and the snapshots never have two branches claiming the same slot. If another migration merges first, delete this one and its `meta/` entries and run `generate` again on top, as `lib/db/migrations/README.md` says.

Three new tables. No existing table or column changes, so nothing a spotter sees can change.

**`people`** (spec §2.9, §8.4)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key, `default gen_random_uuid()` | The stable id. It goes into the hand-off pass as `sub`, and later into `observations.account_id` (which is text) as the person's attribution. It is never the email. |
| `email` | `text`, not null, unique | Lower-cased and trimmed |
| `name` | `text`, not null | |
| `session_version` | `integer`, not null, default `1` | Increasing it signs this person out everywhere (§2.9) |
| `added_at` | `timestamptz`, not null, default `now()` | |
| `added_by` | `text`, nullable | The adding person's id, or `cli:<operator>` for the command in Decision 4. Text with no foreign key, like `colonies.created_by`, so removing whoever added somebody never blocks anything. |

Checks enforced by the database, so every way in obeys them (the command now, the screen later, a hand-typed SQL statement):
- `people_email_lowercase_ck`: `email = lower(btrim(email))`.
- `people_email_shape_ck`: exactly one `@`, with something either side.
- `people_email_not_role_ck`: the part before the `@`, ignoring anything after a `+`, is not one of `admin`, `info`, `hello`, `contact`, `team`, `office`, `support` (the §2.8 deny-list, word for word). So `admin@syroscats.com` and `admin+cats@syroscats.com` are both refused.

The same list lives in one TypeScript function, `checkPersonEmail()` in `lib/db/src/people.ts`, which gives the plain-English message ("admin@ is a shared mailbox. Every person needs their own address, so we can tell who did what. A personal address is fine."). A test pins the TypeScript list and the database list to each other, so they can't drift.

**`person_scopes`** (spec §7.3)

| Column | Type | Notes |
|---|---|---|
| `id` | `serial`, primary key | |
| `person_id` | `uuid`, not null, references `people(id)` **on delete cascade** | Removing a person removes their roles in the same step, so it is still "one deletion" (§2.9) |
| `role` | `text`, not null | Check: one of `staff`, `guardian`, `volunteer`, `vet`. Only `staff` grants anything in this part (§7.1). The other three are accepted now so that §7.2 doesn't need a migration to store them. |
| `colony_id` | `integer`, nullable, references `colonies(id)` | Null means "not tied to a colony". It points at the data spine's table, as §3.2 requires. |

A unique **constraint** on `(person_id, role, colony_id)` **with nulls treated as equal** (Postgres 15+, and CI and Replit both run 16), so the same role can't be given twice. It must be written as `unique("person_scopes_role_scope_unique").on(t.personId, t.role, t.colonyId).nullsNotDistinct()`, not `uniqueIndex(...)`. In the pinned drizzle-orm (0.45.2), only the constraint builder has `nullsNotDistinct()`. A plain unique index would treat every staff row's empty `colony_id` as different, so one person could quietly get `staff` twice.

**`team_handoff_spent`** (spec §2.4 step 5)

| Column | Type | Notes |
|---|---|---|
| `jti` | `text`, primary key | The pass's single-use id |
| `spent_at` | `timestamptz`, not null, default `now()` | |

This is how "used once" holds across several servers: the pass is spent with one `INSERT … ON CONFLICT DO NOTHING RETURNING`, which only one server can win. Rows older than ten minutes are deleted during each hand-off. That is long past any pass's life.

**Rollback block** (hand-written, per `lib/db/migrations/README.md`):
```sql
-- CAUTION: this rollback deletes the list of people. Take a backup first.
-- rollback-begin
-- DROP TABLE "team_handoff_spent";
-- DROP TABLE "person_scopes";
-- DROP TABLE "people";
-- rollback-end
```

All tables, checks and indexes are declared in `lib/db/src/schema/people.ts`, so `migrate:check` sees them. `gen_random_uuid()` is built into Postgres 13+ and needs no extension.

### 2. Rules shared by every way into the list: `lib/db/src/people.ts`

- `normaliseEmail(raw)`: trims and lower-cases.
- `checkPersonEmail(email)`: returns `ok` or the plain-English refusal above.
- `addPerson({ email, name, addedBy, roles })`: one transaction that runs `checkPersonEmail()`, creates the id with `crypto.randomUUID()`, and writes the person and their roles. It never depends on a database default or check being present.
- `removePerson(email)`: one transaction that deletes their roles and then the person. It doesn't rely on the cascade reaching production (see SYC-102 below), though the cascade is still declared.
- `signOutEverywhere(email)`: `session_version = session_version + 1`.
- `findAllowedPerson(email)`: `{ id, name, email, sessionVersion } | null`.

These are exported from `@workspace/db`. The dashboard's future `manage_people` screen will call the same functions.

### 3. The command: `lib/db/src/people/cli.ts`

`pnpm --filter @workspace/db run people -- add --email … --name … [--role staff]`, plus `list`, `remove --email …` and `sign-out-everywhere --email …`. It prints only what it did, never a secret. `remove` and `sign-out-everywhere` ask for the address to be typed a second time to confirm.

### 4. The private question: `POST /api/internal/people/allowed`

New file `artifacts/api-server/src/routes/internal.ts`.

- **Who may ask:** only a caller presenting `Authorization: Bearer <INTERNAL_PEOPLE_TOKEN>`. Both sides are hashed with SHA-256 and compared in constant time, following the pattern in `lib/deviceAuth.ts`. The token lives in a Replit deployment secret (API) and a wrangler secret (Worker), per §2.11.
- **If the token isn't configured on the server: `503`**, every time, whatever was sent. It fails closed, never open. Wrong or missing token: `401`.
- **Body:** `{ "email": "..." }`, normalised the same way as on insert.
- **Answer:** `200 { "allowed": true, "personId", "name", "sessionVersion" }` or `200 { "allowed": false }`. The Worker needs the id and session version to create the hand-off pass (`sub`, `sv`). The two answers take the same database work (one indexed lookup). Hiding timing from the public is the Worker's padded deadline (§2.5), which this call sits inside (§2.7).
- **No CORS headers at all** on `/api/internal/*`. It is server-to-server, and a browser has no business reading it.
- Logs record the outcome and request id, **never the address**.

### 5. The hand-off check: `POST /api/team/handoff`

New files: `artifacts/api-server/src/lib/teamAuth/handoff.ts` (checks the pass), `lib/teamAuth/config.ts` (reads settings) and `routes/team.ts`.

**Settings are read on every request, never cached when the file loads.** This follows the `OWNER_SECRET` precedent in `routes/notifications.ts`. It lets one test run check "not configured", "configured" and "mid key change" without reloading modules, and it means a removed secret takes effect straight away. Parsing a 32-byte key on each hand-off costs nothing at this volume.

The Worker's "Cat Spotters dashboard" button is a small form that **POSTs** the pass to `https://team.catspotters.com/api/team/handoff`. A POST keeps the pass out of the address bar, browser history, logs and `Referer` headers. The spec says the link "carries it once" and doesn't specify how, so this follows it.

Checks, **in the spec's order (§2.4), each one mandatory:**

0. **The request must come from the sign-in page:** `Origin` must be exactly `https://admin.catspotters.com`. This stops another site signing a staff member into someone else's session (login CSRF), the same gap SYC-25 closed on the Worker side.
1. **Parse without trusting the header.** The algorithm is fixed in code as Ed25519 (`crypto.verify(null, …)` with an Ed25519 key object). The token's own `alg` is never used to choose how to check it. As an extra guard, a header whose `alg` isn't exactly `EdDSA` is refused outright. Exactly three base64url parts, with a size cap of 2 KB.
2. **Signature** against the pinned public key, or either of two during a key change. `TEAM_HANDOFF_PUBLIC_KEYS` holds one or two raw Ed25519 public keys, base64url-encoded. **These are not secret:** a public key can only check passes, never create them, which is the point of §2.4 option B.
3. **`iss` is exactly `https://admin.catspotters.com` and `aud` is exactly `https://team.catspotters.com`.**
4. **Time:** `exp` and `iat` are checked with 60 seconds' allowance each way. Beyond the spec, a pass whose `exp − iat` is over 60 seconds is also refused, so a mistake on the Worker side can't create long-lived passes that still check out.
5. **Single use:** `jti` is spent in `team_handoff_spent`. If it was already there, refuse.
6. **Still on the list:** look `sub` up in `people`. If they're gone, refuse. If `sv` is lower than the row's `session_version`, refuse.
7. **Only then** issue the session (below) and send `303` to `https://team.catspotters.com/api/team/`.

**On any failure (§2.4), the same thing happens every time:** status `401`. A request expecting JSON gets exactly `{"error":"not_signed_in"}`. A browser page load (`Sec-Fetch-Mode: navigate`) gets the same `401` status with a tiny fixed page that **redirects straight back** to `https://admin.catspotters.com/` (`<meta http-equiv="refresh" content="0;url=…">`, plus a plain link in case refresh is blocked). This is the spec's "redirect for browsers". A `303` would lose the `401` status that every failure must share, so the redirect happens inside the page. Nothing says which check failed. The real reason goes into the server log with the `jti` and the request id. There is no fallback, no development bypass, and no reading of any identity header.

A courtesy limit of 60 hand-offs per 15 minutes per IP uses the existing in-memory limiter. It exists to cap signature-checking work, not as a security control (see "Rate limits" below).

### 6. The dashboard session: `__Host-cs_team`

New file `artifacts/api-server/src/lib/teamAuth/session.ts`.

- **Cookie** `__Host-cs_team`: `HttpOnly; Secure; SameSite=Lax; Path=/`, with no `Domain` (the `__Host-` prefix requires this), lasting 30 days. It only ever exists on `team.catspotters.com` (§2.6).
- **Contents:** `{ pid, sv, exp }`, signed with HMAC-SHA256 under `TEAM_SESSION_KEYS`, a Replit deployment secret. That setting holds one key, or two during a change: new sessions are signed with the first, and either is accepted. The check runs in constant time. **A session with no readable expiry is refused**, not treated as never expiring (the same rule §8.1 keeps on the Worker).
- **Every cookie with that name is tried, not just the last one** (the §8.1 rule, copied for consistency).
- **`requireTeam(capability)` middleware** (`middlewares/requireTeam.ts`) runs on every dashboard request. It checks the cookie, **looks the person up in `people` again, and compares `session_version`** (§8.2). Then it checks the named capability. A failure gets the same `401` as the hand-off. Removal and "sign out everywhere" therefore take effect at the next request.
- `POST /api/team/signout` clears the cookie on this device (§2.1). Like every future dashboard `POST`, it requires `Origin: https://team.catspotters.com`.
- `GET /api/team/me` returns `{ name, email, capabilities }` for the future screens.
- `GET /api/team/` shows the one-line signed-in page with a Sign out button. It is plain server-rendered HTML with no scripts, and the future queue screen replaces it.
- **No CORS headers on `/api/team/*`.** The dashboard is same-origin (§2.6). `app.ts`'s CORS switch skips `/api/team/` and `/api/internal/`, as it already special-cases `/api/photos/`. Replacing the wildcard `cors()` everywhere else is its own ticket (§8.2).

### 7. Capabilities: `artifacts/api-server/src/lib/capabilities.ts`

The twelve names from §7.3, as a fixed list: `view_exact_location`, `hide_photo`, `restore_photo`, `rename_cat`, `rename_colony`, `set_life_status`, `set_sterilisation`, `set_site_public`, `change_report_state`, `add_team_note`, `manage_people`, `action_deletion_request`.

One function, `can(person, capability, target?)`, is the **only** place a permission is decided. In this part, a `staff` scope grants all twelve (§7.1), and `guardian`, `volunteer` and `vet` grant none. When those roles arrive, only this function changes. `requireTeam` calls it by name, so no screen ever asks "is this person staff?".

## Where this meets the data spine plan

A separate plan, `docs/superpowers/plans/data-spine.md` (branch `claude/data-spine-plan`, SYC-40 / SYC-52), sets the order of data spine steps 2–8 and leaves SYC-43 to this plan. The two plans meet in three places:
- **Migration order.** That plan also queues migrations `0003`–`0005`. Whichever merges second regenerates its number (see §1).
- **Staff attribution.** When the dashboard writes observations, `observations.account_id` holds the person's `people.id` (a uuid, stored as text) and `roleAtTime` is `staff`. This matches that plan's correction endpoints (its PR 8). It will settle the author for machine-written rows (its "Q1") in a separate namespace, such as `system:…`, which can't collide with a uuid.
- **The gate on its correction endpoints.** Its PR 8 sits behind this part's `requireTeam` and `can()` (`set_life_status`, `set_sterilisation`), so it can't ship before this part does. Its staff deletion action also uses `action_deletion_request` from here. This part adds no endpoints of that kind.

## What this part does not do

Each item is ticketed. Existing tickets were checked first, and SYC-103 to SYC-106 are new:

| Not here | Where it goes |
|---|---|
| The sign-in page checks this list instead of the D1 `admins` table, and `admins` shrinks to the one break-glass row | **SYC-83** (Worker) |
| The Worker creates the hand-off pass and shows the "Cat Spotters dashboard" button | **SYC-103** (Decision 3), shipping with SYC-83 |
| A screen for managing people | **SYC-104**, a later part of SYC-43 |
| Rate limits counted in Postgres so they hold across servers, with the deployment pinned to one server until then (§2.6 option C) | **SYC-105** |
| Replacing the wildcard `cors()` on the rest of the API with an allow-list (§2.6, §8.2) | **SYC-106** |
| The welfare queue, feeding-site map, corrections and colony naming screens | SYC-43, later parts |
| A dashboard banner for sign-in limits and mail failures | SYC-43, later part (already noted there) |
| Anything to do with deleting a spotter's data | SYC-63 (another session is planning it now). This part doesn't touch that path. |

## Tests

`lib/db` tests run on a throwaway database built from the real migrations, like `dataSpine.test.ts`. API tests use supertest against the real app and the CI Postgres, like the existing route tests. Spec §8.6 numbers are in brackets.

**Database (`lib/db/src/migrate/people.test.ts`)**
1. **[§8.6 #10]** Each deny-listed address (`admin@`, `info@`, `hello@`, `contact@`, `team@`, `office@`, `support@`), and `admin+x@`, is refused by a raw SQL `INSERT`, not only by the TypeScript check.
2. Mixed-case or padded email is refused by the database. `addPerson` normalises it and succeeds.
3. The TypeScript deny-list and the database check agree: every entry in the TS list is refused by the database, and an address the TS check allows (`susan@…`) is accepted.
4. Removing a person removes their scopes (cascade). A duplicate `(person, role, no colony)` is refused.
5. This migration's rollback restores the schema from before it exactly, and up/down/up works (the runner's existing harness).

**The private question (`routes/internal.people.test.ts`)**
6. No token configured on the server → `503`, even with a token sent. Wrong or missing token → `401`. A right token and an unknown address → `{allowed:false}`. A listed address in capitals → `allowed:true` with the id and session version.
7. The response has no `Access-Control-Allow-Origin` header, even when the request carries an `Origin`.
8. The logged line for the request doesn't contain the address.

**The hand-off (`routes/team.handoff.test.ts`)**. The test creates its own Ed25519 key pair in memory. No real key appears anywhere in the repo.
9. **[§8.6 #6]** A good pass → `303` plus a `__Host-cs_team` cookie with the right flags. Then each of these → an **identical** `401` (same status, same body, byte for byte): bad signature, wrong `aud`, wrong `iss`, expired, `iat` more than 60 s in the future, `exp − iat` over 60, replayed `jti`, unknown `sub`, stale `sv`, wrong `Origin`, no `Origin`, malformed token.
10. **[§8.6 #7]** A pass signed with HMAC-SHA256 using the public key's bytes as the secret, with header `alg: HS256`, is refused. So is `alg: none` with an empty signature.
11. **Replay across two servers:** two separately imported app instances sharing the database. A pass spent on one is refused by the other.
12. During a key change, with two public keys configured, a pass signed by either key is accepted. With one key, a pass signed by the other is refused.
13. A browser load (`Sec-Fetch-Mode: navigate`) gets the same `401` status, and the page's meta refresh points exactly at `https://admin.catspotters.com/`. The body is identical whichever check failed.

**The session (`routes/team.session.test.ts`)**
14. **[§8.6 #11]** Sign in, then `signOutEverywhere` → the same cookie gets `401` on the very next request.
15. Remove the person → the same cookie gets `401` on the very next request.
16. A tampered cookie, a cookie signed with an unknown key, an expired cookie, and a cookie with no expiry field are all refused. With two session keys configured, a cookie signed with the second key is accepted.
17. Two cookies with that name (a bad one first) → the good one is used.
18. `POST /api/team/signout` from the wrong `Origin` is refused. From the right one, it clears the cookie.
19. `can()`: `staff` has all twelve capabilities, `guardian` has none, and an unknown capability name is a type error (checked by `tsc`, with an `expect-error` line).

**Mutation checks** (break it on purpose, confirm the named test goes red, put it back). These guards fail *silently*: a broken one still "works" for a real user, so a green suite alone proves nothing.
- Choose the verifier from the token's `alg` → test 10 must fail.
- Treat a missing `Origin` header as allowed on `/api/team/handoff` → the no-`Origin` case of test 9 must fail. (The live Worker carries the warning comment "a missing Origin is not a free pass", because `SameSite=Lax` treats every `*.catspotters.com` host as same-site.)
- Accept any `Origin` ending in `catspotters.com` → the wrong-`Origin` case of test 9 (sent as `https://evil.catspotters.com`) must fail.
- Skip the `aud` check → test 9 (wrong `aud`) must fail.
- Spend `jti` in memory instead of in Postgres → test 11 must fail.
- Drop the `session_version` comparison in `requireTeam` → test 14 must fail.
- Drop the `people` re-lookup in `requireTeam` → test 15 must fail.
- Treat a missing session expiry as "never expires" → test 16 must fail.
- Remove `team` from the database deny-list only → tests 1 and 3 must fail.
- Return `200 {allowed:false}` instead of `503` when the token isn't configured → test 6 must fail.

**Every reader of the invariant "only people on the list, at their current session version, get in"**, so nothing is forgotten: the hand-off route (step 6), `requireTeam` (every dashboard route, now and later), the private question (the Worker), and the future Worker `session()` check (SYC-83). Only the first three are in this repo. The PR description lists them, and a later dashboard route that doesn't use `requireTeam` is a review failure.

## Getting this to production: blocked on SYC-102

**Nothing in this part is pulled into the real Repl or published until SYC-102 is resolved** (Samuel's instruction, 29 Sep). SYC-102's findings so far: Replit manages the production Postgres separately from dev, and the workspace can't reach it (only a read-only query tool), so `DEPLOYMENT.md`'s "run `migrate` against production" can't be done. On Publish, Replit compares dev's structure with production's and applies the difference itself. Its docs only promise adding and dropping **tables and columns**. Triggers, functions, the `drizzle` history schema, seed rows and backfills may not arrive. The live test site is `apptest.catspotters.com`, behind Replit's private-deployment gate. `api.catspotters.com` and `team.catspotters.com` don't exist in DNS yet.

The migration is designed to be **plain tables and columns wherever possible: no triggers, no functions, no backfill.** Here is everything in it that goes beyond that, and how each gets to production:

| Piece | Plain table or column? | How it reaches production | If it doesn't arrive |
|---|---|---|---|
| `people`, `person_scopes`, `team_handoff_spent` tables and their columns | Yes | Publish's structural copy, the part Replit's docs do promise | n/a |
| `gen_random_uuid()` default on `people.id` | Column default; not promised | Doesn't matter: `addPerson()` creates the id in TypeScript (`crypto.randomUUID()`), so no insert relies on the default | Nothing breaks |
| **CHECK constraints refusing shared mailboxes and badly formed addresses** | No | Waits on SYC-102. Meanwhile the same rules run in `checkPersonEmail()`, which `addPerson()` always calls, so the command refuses them regardless | Only a hand-typed SQL insert could get past, and nobody can write to production by hand today. After publish, Claude confirms with the read-only query tool (`pg_constraint`) that the three checks exist, and reports it if they don't |
| Unique email, unique role-and-scope constraint, foreign keys (`person_scopes` → `people` with cascade, → `colonies`) | No | Waits on SYC-102, with the same read-only check after publish | The cascade matters most: without it, removing a person would fail on their roles. So `removePerson()` deletes the roles explicitly in the same transaction, and doesn't rely on the cascade. A missing unique email or role constraint is caught by `addPerson()` looking first, inside the transaction |
| Migration history row in the `drizzle` schema | No | Waits on SYC-102 (the same problem applies to `0000`–`0002`) | n/a for this part |
| **Seed rows (Samuel and Jacky)** | Data, not structure. *Update: SYC-102's throwaway-app test (round 1, 29 Sep) saw Publish copy **rows**, triggers, functions and the `drizzle` history too, not just structure. If that holds, the risk runs the other way: whatever is in dev's `people` would be copied to production. **So dev's `people` may only ever hold real staff, never test people.** Tests use their own throwaway databases, as they already do.* | **Waits on SYC-102.** The `people` command can't reach production, because the workspace can't. The route will be whatever SYC-102 settles for data. If SYC-102 finds no route, the fallback is a one-time, idempotent seed the API runs at startup from a deployment setting, only while `people` is empty. That goes back to Samuel as a decision; it isn't built now | Nobody can sign in to the dashboard. That fails closed, which is the safe direction |
| Break-glass row | Not in Postgres at all: it stays in the Worker's D1 `admins` table (§2.7), which SYC-83 handles through `wrangler` | Unaffected by SYC-102 | n/a |

## Getting past Replit's login wall: blocked on SYC-113

**Found by live probe, 29 Sep 2026.** Every path on `https://apptest.catspotters.com` answers `307` to `https://replit.com/__replshield?redirect=…`. That includes `/api/healthz` and a `POST` to an unknown `/api/` path. The test deployment sits behind Replit's login wall (a private or password-protected deployment). While it does, the Worker's server-to-server call to `POST /api/internal/people/allowed` **can never reach the API**, whatever the path. It gets a redirect to a Replit login page, so sign-in fails closed for everyone, staff included. The dashboard hand-off to `team.` has the same problem if that host sits behind the same wall.

The options, tracked in **SYC-113**. **I haven't verified which of them Replit supports.**
1. Make the deployment public once the shared-password document pages are retired (SYC-85 / D7).
2. Give the API its own public hostname (for example `api.catspotters.com`), after working out whether the wall applies per deployment or per domain.
3. Have the Worker reach the API some other way, such as a Replit-supported route for server-to-server calls, if one exists.

**Failing closed has to cover this case explicitly (a requirement on SYC-83's Worker code, recorded here so it isn't lost).** The Worker calls with `redirect: "manual"` and treats **anything other than a `200` whose `Content-Type` is `application/json` with a boolean `allowed`** as "unavailable". That includes any `3xx`, any HTML page, a `401` or `503`, a timeout and unreadable JSON. It then shows the honest "Sign-in is temporarily unavailable" message and never creates a link. **Test (in the Worker's suite):** a stubbed API answering `307` to a replit.com URL, and one answering `200` with an HTML login page, each create no token and show the unavailable message. **Mutation check:** follow redirects, or accept any `200` → that test must fail. On this side, test 6 already pins the API's own refusals (`401`/`503`) as JSON, so the Worker never has to guess.

## Rollout order

1. **Merge.** CI runs `migrate:check`, the migration tests and the API tests. Merging changes only GitHub. **Nothing is pulled into the real Repl, and nothing is published, until SYC-102 is resolved.** When it is, the Git-pane pull runs `migrate` against the **dev** database only, through `post-merge.sh`.
2. **Production database and API: blocked on SYC-102, and the Worker's route in is blocked on SYC-113.** Follow the deploy order SYC-102 writes down, not today's `DEPLOYMENT.md` line. Then run the read-only check for the constraints in the table above. `api.catspotters.com` and `team.catspotters.com` also wait on SYC-32.
3. **Keys and secrets (Claude, with one paste each from Samuel).** Claude creates the Ed25519 key pair and the `INTERNAL_PEOPLE_TOKEN` in a terminal tab. The private key goes **straight** into `wrangler secret put TEAM_HANDOFF_PRIVATE_KEY` and is never printed, saved to a file, or put in chat. The same applies to `INTERNAL_PEOPLE_TOKEN` on the Worker. Samuel pastes `INTERNAL_PEOPLE_TOKEN` and a fresh `TEAM_SESSION_KEYS` into Replit's deployment secrets, from a terminal tab Claude opens, since Replit secrets can't be set from here. `TEAM_HANDOFF_PUBLIC_KEYS` is not secret and goes in as a plain setting.
4. **Seed the list:** Samuel and Jacky (`jackystorey@hotmail.com`), both `staff`, matching today's `admins`. On dev, Claude uses the command. On production, the route SYC-102 settles (see the table above).
5. **Probe (Claude):** `curl` the private question with the right token, the wrong token and no token (expect 200 / 401 / 401). A 503 means the secret is missing. Create a test pass locally with a throwaway key **against the dev deployment only**, and check that one pass signs in once and fails the second time.
6. **`team.catspotters.com` (Samuel, about five minutes):** add it as a second custom domain on the same Replit deployment, and add the DNS record Replit asks for. Claude's Cloudflare token can't write DNS (found during SYC-25). Claude then checks it resolves and serves `/api/healthz`.
7. **Worker side:** SYC-83 plus the hand-off ticket, in `catspotters-website`, each with its own plan and review.
8. **End to end in a real browser:** Samuel signs in on `admin.catspotters.com`, taps "Cat Spotters dashboard", and sees "You're signed in as Samuel". Then Claude runs `sign-out-everywhere` for him, and his next click returns him to the sign-in page. This is checked in a browser, not only with curl (browser flows need a browser: SYC-25).
9. **Then** SYC-29 (the rest of the Syros Cats people, one `people add` each) and SYC-85 (retire the shared password the same day).

**Rolling back:** on dev, `migrate:rollback` is safe until real people are on the list. On production it can't be run from the workspace, so the production rollback route is SYC-102's too. After that, take a backup first, as the rollback block warns. The API routes can be switched off by removing `INTERNAL_PEOPLE_TOKEN` (the private question returns `503`, and the Worker fails closed with "Sign-in is temporarily unavailable") and emptying `TEAM_HANDOFF_PUBLIC_KEYS` (every hand-off is refused).

## Rate limits: stated, not skipped

Spec §2.6 wants the API's limits counted in Postgres (option C), with the deployment pinned to one server until then (option B, "from day one"). This part adds no new limit that security depends on. The pass is single-use in Postgres, and the session is checked against the database on every request. The only new limit is the courtesy one on `/api/team/handoff`. So the Postgres limit store stays its own ticket, and **the one-server pin goes on that ticket as a step before the first production deploy**, so it isn't forgotten.

## Model delegation

The session model is Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Schema file, `generate`, rollback block, `people.ts` helpers, the command | Sonnet | Clear spec with an exact column list. Follows the `0001` precedent | `migrate:check` in CI, database tests 1–5, and the session model reviews the generated SQL line by line before commit |
| Private question route (§4) | Sonnet | Small route with a named pattern (`deviceAuth.ts`) | Tests 6–8, mutation check (503 → 200) |
| Hand-off check and session (§5, §6), `requireTeam`, `can()` | **Opus** | *Escalated:* token checking is where a plausible-looking mistake (trusting `alg`, a skipped claim, a replay across servers) is a silent security hole that a green suite doesn't catch | Tests 9–19, **all eight mutation checks**, and the adversarial review below |
| `app.ts` CORS skip and route registration | Haiku | A two-line mechanical change following the existing `/api/photos/` branch | Test 7 plus a no-CORS assertion on `/api/team/me`, and typecheck |
| Adversarial review of the built change | **Opus**, in its own worktree | *Escalated:* the review has to find the security holes the implementer didn't think of, which is the hardest judgement in this work | The session model checks each finding before it is fixed or dismissed |
| Rollout steps 3–8 (secrets, seeding, probes) | Session model (Opus) | Handles secrets and production data, so it isn't delegated | The probes in steps 5 and 8 |

## Crash-proofing for the build

The build happens in its own worktree, branched from fresh `origin/main`. Each numbered section above is its own commit. A `CHECKPOINT.md` in the worktree root records what's done and what's next after each commit.

## Adversarial review of this plan

Reviewed by a Sonnet critic in its own worktree against the spec, `DECISIONS.md` Part 2b, the code on `main` and the live Worker source. It found no blockers. Every finding was checked by the session model and is folded in above:

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Major | The "no duplicate role" rule couldn't be built as a unique *index*: the pinned drizzle-orm 0.45.2 only offers "treat empty colony as equal" (`nullsNotDistinct()`) on a unique *constraint*. A plain index would let one person get `staff` twice. Confirmed in `drizzle-orm/pg-core/unique-constraint.d.ts`. | The plan now names the exact constraint to write. Database test 4 already catches the silent version. |
| 2 | Major | No mutation check proved the hand-off's `Origin` guard is watched by a test, which is the exact login-CSRF gap the Worker already had to close. | Two mutation checks added: a missing `Origin`, and a look-alike `*.catspotters.com` origin. |
| 3 | Minor | The spec says failures *redirect* browsers back to the sign-in page. The plan said "a page linking back". | The page now redirects immediately inside a `401` (meta refresh, with a plain link as fallback). Test 13 checks the target. |
| 4 | Minor | The plan didn't say when settings are read. Caching them at load would stop the tests from checking the "not configured" and "key change" cases. | Settings are read per request, following `OWNER_SECRET`. |

Checked and confirmed fine by the reviewer: the constant-time token comparison, cross-server single use through Postgres, the algorithm fixed in code, CI's Postgres 16, the `check()` precedent, and the live Worker's current state. The Worker has no dashboard link yet and still reads `admins`, and both SYC-25 fixes are live.
