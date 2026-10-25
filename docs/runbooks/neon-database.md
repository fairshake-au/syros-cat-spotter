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

`--ref main` is always given (see the plan's Part A.3 for why). `target` is `development`, `rehearsal` or `production`. `command` is one of: `fingerprint-source`, `copy-rehearsal`, `copy-cutover`, `verify`, `verify-history`, `migrate`, `migrate-rollback`, `smoke`, `carry-back-dry-run`, `carry-back-apply`, `people-add`, `people-list`, `people-set-roles`, `people-mark-left`, `people-sign-out-everywhere`, `set-setting`, `list-settings`, `photo-list`, `photo-hide`, `photo-restore`, `photo-remove` (SYC-462; `docs/runbooks/photo-removal.md`), `fingerprint-accuracy` (SYC-527 piece 3: the looks-like index's read-only smoke test; prints ranks and counts only).

## The match-wait switches (`set-setting`, `list-settings`)

The feeding nudge's donation link and the starter facts that are switched off live in the `app_settings` table (SYC-36 / SYC-48, match-wait plan PR 1, Samuel's Decision 1). Until the team dashboard has a page for them (SYC-383), Claude changes them through `db-ops`, **with Samuel's OK for each change**, and records each change on SYC-36. Both commands run against `development` or `production` only.

| `setting_key` | `setting_value` (JSON) | What it does |
|---|---|---|
| `feed_nudge_donate_url` | `"https://syroscats.com/donations"` (quotes included), or `""` | The page **Help feed a cat** opens. Empty switches the link **and** the €1/€30 figures off (the nudge's words-only form). https only. The migration seeds Syros Cats' page (Samuel's Decision 6) |
| `starter_facts_hidden` | `["fact.earTip","fact.cost"]`, or `[]` | Facts the app must not show. With no row, the nine that need Syros Cats' yes are hidden. `[]` shows all twenty. Unknown ids are refused |
| `feed_tap_count` | `true` or `false` | Whether a tap on **Help feed a cat** is counted (one number per day). No row means counted |
| `photo_removal_on` | `true` or `false` | SYC-462: whether `photo-remove` may run on `production`. Set to `true` once, after the live build is confirmed to include SYC-462 (`docs/runbooks/photo-removal.md`, go-live). No row means off. The server doesn't read it |
| `standard_sterilisation_price_eur` | `60`, a whole number from `1` to `500` | SYC-396 PR 2.3: the standard sterilisation price in euros, for the trapping planner's estimate and the vet-visit form's cost. No row means €60. Team-only: the app is never sent it. Change it on the team dashboard's **Vet settings** page (SYC-396 PR 3.1b), which keeps the history of who changed it and when. Use `set-setting` only as a fallback, when the page can't be used: a change made here leaves no history row, so the page's history won't show it |

```
gh workflow run db-ops.yml --ref main -f target=production -f command=list-settings
gh workflow run db-ops.yml --ref main -f target=production -f command=set-setting -f setting_key=starter_facts_hidden -f 'setting_value=["fact.vacuum"]'
```

A wrong key or a value of the wrong shape is refused and nothing changes. The command prints every switch afterwards. Then wait a minute (the server's cache) and check what phones will get, with no connection string involved: `curl -s https://<api host>/api/app-settings` (the testers' pass header is needed until launch). Phones pick a change up the next time they open the app with a signal.

## The staff list (`people-add`, `people-list`, `people-set-roles`, `people-mark-left`, `people-sign-out-everywhere`)

The list of people who can sign in to the staff dashboard (SYC-43) is managed through `db-ops` until the people screen exists (SYC-104). The `people-*` commands run against `development` or `production` only.

**A person's email and name are never workflow inputs.** Inputs are stored with the run and can reach the log. Instead, the email and name go in short-lived Environment secrets, `PEOPLE_EMAIL` and `PEOPLE_NAME`, plus **`PEOPLE_EMAIL_CONFIRM`, the address typed a second time** (SYC-131, after a typo in a 3 Oct `people-add` went unnoticed). Every command that names a person refuses unless the two addresses match, ignoring case and surrounding spaces, and changes nothing. They're set from a terminal tab just before the run and deleted straight after. The script masks all three before doing anything else and refuses to show output that contains any of them. The role is a fixed choice: `staff`, `guardian` or `vet` for `people-add` (a cat guardian also needs `people_colony`, the colony's number; `volunteer` is retired, SYC-53 PR 0.3). `people-add` adds the person directly, joined at once. The output shows the person's id and role only. `people-list` shows ids, roles, session versions, who added each person, for anyone marked as left, `LEFT` with when and by whom, and each person's history (the kinds of change recorded for them, oldest first, never a name or an address). Never an address or a name. `people-add` for an address that has left brings back the same person (same id, history intact) and says "Rejoined".

**Seeding Samuel and Jacky after the cutover — the post-go-live procedure for any production database change (SYC-121/SYC-178).** Since go-live, every production database change (this migration, then the seed) follows the same five steps, in order. **The old Replit project is retired and must never be published again** — all of this targets the EU (new) Replit project only.

1. **Neon snapshot.** Take a snapshot of `production` before changing anything (Neon console, or the Neon MCP's `create_snapshot`), so there's a known-good point to restore to.
2. **`db-ops migrate`.** `gh workflow run db-ops.yml --ref main -f target=production -f command=migrate`, watch it, read the log. This applies this PR's `0003_people_and_staff_sign_in` migration (creates `people`, `person_scopes`, `team_handoff_spent`; no backfill).
3. **`db-ops verify-history`, not `verify`.** `gh workflow run db-ops.yml --ref main -f target=production -f command=verify-history`. It reads production's record of applied migrations and checks it against the migration list on `main`: every migration applied once, none missing, none the code doesn't know, none edited since, all in the right order. It's read-only and needs no other database (SYC-178). `verify` compares Neon with the old Replit database row for row, which only made sense before cutover, so it now fails misleadingly every time. Then Claude looks at the new objects themselves with the Neon MCP's `run_sql` (SELECT only), e.g. `SELECT count(*) FROM people` on a new, empty table.
4. **EU project pull + republish.** Pull `main` into the EU (new) Replit project's workspace and republish it, so the running app matches the new schema.
5. **Smoke against `https://apptest.catspotters.com`.** `gh workflow run db-ops.yml --ref main -f target=production -f command=smoke -f base_url=https://apptest.catspotters.com`, confirming the live app is healthy against the migrated schema.

Only once all five steps are green, seed Samuel and Jacky. Run each block in a terminal tab where `SEED_EMAIL` and `SEED_NAME` are already set in the tab's environment. Never type the values into chat. `printf` pipes each value to `gh` without echoing it.

Samuel (set `SEED_EMAIL` and `SEED_NAME` for Samuel first):

```bash
cd /Users/samuelporter/Projects/syros-cat-spotter
printf '%s' "$SEED_EMAIL" | gh secret set PEOPLE_EMAIL --env production
printf '%s' "$SEED_NAME" | gh secret set PEOPLE_NAME --env production
printf 'Type the address again: '; stty -echo; IFS= read -r SEED_EMAIL_CONFIRM; stty echo; echo
test -n "$SEED_EMAIL_CONFIRM" && printf '%s' "$SEED_EMAIL_CONFIRM" | gh secret set PEOPLE_EMAIL_CONFIRM --env production
unset SEED_EMAIL_CONFIRM
gh workflow run db-ops.yml --ref main -f target=production -f command=people-add -f people_role=staff
sleep 5
gh run watch "$(gh run list --workflow db-ops.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh secret delete PEOPLE_EMAIL --env production
gh secret delete PEOPLE_NAME --env production
gh secret delete PEOPLE_EMAIL_CONFIRM --env production
```

The confirmation is typed by hand, hidden, at the prompt (this works in zsh, macOS's default shell, and in bash). Don't copy it from `SEED_EMAIL`: a copy would repeat the same typo. If nothing was typed, the secret isn't set and db-ops refuses to run.

Jacky: set `SEED_EMAIL` and `SEED_NAME` for Jacky in the tab, then run the same block again.

Then check the list, which should show two ids, both `staff`:

```bash
gh workflow run db-ops.yml --ref main -f target=production -f command=people-list
sleep 5
gh run watch "$(gh run list --workflow db-ops.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run view "$(gh run list --workflow db-ops.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --log
```

**Management (`people-set-roles`, SYC-53 PR 0.3, Decision A1).** `management` is never given by `people-add`; it is added beside `staff` with `people-set-roles`, which is additive: `-f people_change=add` (or `remove`) and `-f people_role=management` change that one role and leave the rest alone. It needs the same three secrets as `people-add` minus the name, prints the person's roles before and after (ids and role names only), and refuses a result without `staff` unless `-f confirm=FORCE`: until SYC-53 PR 0.5 only `staff` lets anyone sign in, so removing it would lock even a manager out. `people_role` and `people_change` have no defaults; always pass both. A whole new list (`--replace`) is only offered by the `people` command itself, not by db-ops.

```bash
gh workflow run db-ops.yml --ref main -f target=production -f command=people-set-roles -f people_change=add -f people_role=management
```

**Making Samuel, Jacky and Susan management (SYC-53 PR 0.3's post-merge run).** Claude does this end to end; Samuel types nothing but his approval.

1. **Before migrating each database (development, then production), Claude runs these read-only checks** with the Neon MCP's `run_sql`:

   ```sql
   select count(*) from observations where role_at_time = 'admin';  -- must be 0
   select s.id, s.person_id, s.role, s.colony_id, p.left_at is not null as left from person_scopes s join people p on p.id = s.person_id where s.role not in ('staff','guardian','vet') or (s.role = 'guardian' and s.colony_id is null) or (s.role = 'staff' and s.colony_id is not null);  -- must be empty
   select role, colony_id is null as island, count(*) from person_scopes group by 1, 2;
   select count(*) filter (where left_at is null) as on_list, count(*) from people;
   select id, name from people where left_at is null order by name;
   ```

2. **The approval list.** Before the production run, Claude shows Samuel the list from production *with names* (`select p.id, p.name, array_agg(s.role order by s.role) from people p join person_scopes s on s.person_id = p.id where p.left_at is null group by 1, 2 order by 2`, read-only): the three who become management, and everyone else, who stays team-only. Samuel approves it in chat. Nothing runs before that.
3. **Development first, then production** (spec §15.2 step 5), each after its own `migrate` and `verify-history`.
4. **The address secrets, without Samuel typing anything.** For each approved person id, Claude reads that person's address from *that* database with `run_sql` (`select email from people where id = '<id>'`), and pipes it straight into the secrets, never printing it in chat or in a log:

   ```bash
   cd /Users/samuelporter/Projects/syros-cat-spotter
   printf '%s' "$ADDRESS" | gh secret set PEOPLE_EMAIL --env production
   printf '%s' "$ADDRESS" | gh secret set PEOPLE_EMAIL_CONFIRM --env production
   unset ADDRESS
   gh workflow run db-ops.yml --ref main -f target=production -f command=people-set-roles -f people_change=add -f people_role=management
   sleep 5
   gh run watch "$(gh run list --workflow db-ops.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   gh secret delete PEOPLE_EMAIL --env production
   gh secret delete PEOPLE_EMAIL_CONFIRM --env production
   ```

   The address comes from the database by id, so it can't carry a typo. The confirmation is there to catch typing mistakes, and nothing is typed here. For development, use `--env development` and `target=development`. The run prints the roles before and after; each person keeps `staff`.
5. **Verification on each database** (read-only `run_sql`): `select s.role, s.reach, count(*) from person_scopes s join people p on p.id = s.person_id where p.left_at is null group by 1, 2 order by 1, 2` shows exactly 3 `management` / `island` rows beside the `staff` rows; `select p.id from people p join person_scopes s on s.person_id = p.id where s.role = 'management'` returns the three approved ids; `select count(*) from people where accepted_at is null and left_at is null` is 0. **SYC-53 PR 0.5 does not merge until production shows exactly three managers.**

To check that an id belongs to the right person, use the Neon MCP's `run_sql` with a `SELECT` on production. Someone who leaves is **marked as left** (`people mark-left`), not removed (SYC-43 part 2, Decision 7): they can't sign in, their sessions end at their next request, and everything they did stays attributed to them. There is no remove (SYC-53 PR 0.1): every person has an `added` event in the record of who changed what (`person_events`), so a hard delete can never succeed. Marking as left is the only way off the list. **Rolling back the app to a build from before `0007_people_left` re-admits everyone marked as left**, because the old code ignores `left_at`. Fix forward instead; if you can't, follow the CAUTION in that migration first. For development, swap in `--env development` and `target=development`.

**The two doors (SYC-53 PR 0.4 and W1).** Since PR 0.4 the sign-in Worker's question (`POST /api/internal/people/allowed`) answers a workspace door and a dashboard door when asked with `version: 2`. **Once W1 (the Worker that asks that way) is live, never roll the app back to a build from before PR 0.4 without first rolling the Worker back** (`wrangler rollback <the version id recorded before W1 deployed>`, in `catspotters-website`). An older app ignores `version`, the Worker finds no doors and treats that as no door at all, and **the whole team, Samuel included, is locked out of both the workspace and the dashboard**. Only the `admins` break-glass row still reaches the workspace. Worker first, then the app.

### Someone leaves, a mistaken add, or a stolen session (SYC-131)

- **`people-mark-left`**: for someone who leaves. They can't sign in, their open sessions end at their next request, and everything they did stays attributed to them. The output names their id and `left_by` is `cli:db-ops:<GitHub actor>`. Adding the same address again later brings back the same person.
- **`people-sign-out-everywhere`**: ends every open session for that person, for example after a lost phone. They can sign in again.

Each needs `PEOPLE_EMAIL` and `PEOPLE_EMAIL_CONFIRM` (no name, no role). Set `SEED_EMAIL` in the tab, then:

```bash
cd /Users/samuelporter/Projects/syros-cat-spotter
printf '%s' "$SEED_EMAIL" | gh secret set PEOPLE_EMAIL --env production
printf 'Type the address again: '; stty -echo; IFS= read -r SEED_EMAIL_CONFIRM; stty echo; echo
test -n "$SEED_EMAIL_CONFIRM" && printf '%s' "$SEED_EMAIL_CONFIRM" | gh secret set PEOPLE_EMAIL_CONFIRM --env production
unset SEED_EMAIL_CONFIRM
gh workflow run db-ops.yml --ref main -f target=production -f command=people-mark-left
sleep 5
gh run watch "$(gh run list --workflow db-ops.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh secret delete PEOPLE_EMAIL --env production
gh secret delete PEOPLE_EMAIL_CONFIRM --env production
```

Swap `people-mark-left` for `people-sign-out-everywhere` as needed. Then `people-list` to check: a left person shows `LEFT <when> by <who>`.

The workflow never prints a connection string — only host names, counts and hashes. If a log ever shows one, that's a bug: stop and fix `scripts/db-ops.sh` before running it again.

## Resetting the development branch

If `migrate` refuses the Neon `development` branch ("cannot be adopted", or "the database is ahead of this code"), it's disposable: Neon console → **Branches** → `development` → **Reset from parent**. This replaces the old "drop the `public` and `drizzle` schemas by hand" advice — Neon's reset does the same thing without touching `production`. Then run `migrate` again (or let the next Git-pane pull's `post-merge.sh` do it).

**Never reset `production`.** There, fix drift by hand, guided by the differences `migrate` prints.

**Resetting `rehearsal` before re-running the switchover plan's Part D (added 30 Sep):** the plan's D.8 recovery drill ends with `rehearsal` in a "cut over" state that both copy commands refuse, and `rehearsal` (a child branch) can't be restored from a snapshot the way `production` can (see "Snapshots and restores only work on a root branch" below, under "Restoring to a point in time"). Before a re-run, reset it from `production` the same way as `development` above — Neon console → **Branches** → `rehearsal` → **Reset from parent**, or delete and recreate it. This discards `rehearsal`'s contents, so get Samuel's OK first, same as any other data-discarding step.

## Restoring to a point in time

> **After any restore, snapshot swap or carry-back, re-apply photo removals (SYC-462).** For every row on the "Photo removals" ledger dated after the restore point, run `photo-hide` then `photo-remove` (`docs/runbooks/photo-removal.md`, "After any restore") before visitors reach the restored database. A restore brings back pictures removed since its moment.

**Two different things are both called "restore" here — they behave differently, and this runbook used to blur them (corrected after the Fable review, 30 Sep):**

- **A point-in-time restore to a new branch** (Neon console: **Branches** → `production` → **Restore**, pick a timestamp): Neon creates a **new, separate branch** at that point, leaving `production` untouched. Nothing is pointed at it until someone decides to — it's reviewable first, and nothing about `production`'s connection string or password changes, because `production` itself hasn't moved.
- **`restore_snapshot` onto `production`** (the plan's Part D/E/F recovery route, via `db-ops`/the Neon MCP): this **swaps `production` in place** — a new branch id takes over the `production` name and the pooled endpoint, and the replaced branch is kept as "`production (old)`". **When `production`'s "protected" setting is on, this changes the `neondb_owner` password** (see below), which a plain point-in-time restore to a new branch does not. **With protection off — the state `production` is in for the whole cutover window — the password survives the restore** (confirmed by the dress rehearsal's re-run, 30 Sep; see below).

Neon's restore window on `production` is **7 days** (the paid "Launch" plan; the plan's Part C.3 sets this when the project is created). For anything bigger than a restore (the old database intact, testers' new Neon rows carried back), that's the rollback procedure in the plan's Part F, run through `db-ops`'s `carry-back-dry-run`/`carry-back-apply` commands, never by hand.

**Snapshots and restores only work on a root branch.** `production` is a root branch; `rehearsal` and `development` are children of it and can't take or restore a snapshot directly (found in the 30 Sep dress rehearsal, when the plan's D.8 drill had to move from `rehearsal` to `production` for this reason — see the plan's Part D.8 and A.1). Plan any snapshot-based recovery against `production` itself.

---

## Dress rehearsal findings (30 Sep 2026) — snapshot restores, secrets, and logs

*Kept as its own section, separate from any concurrent edits to the sections above and to `db-ops.sh`/`db-ops.yml`, so it merges cleanly alongside other in-flight runbook changes (see this PR's description).*

### A snapshot restore onto a *protected* `production` changes the `neondb_owner` password — confirmed fixed by switching protection off

Confirmed twice on 30 Sep, including a clean repeat with no password reset in between: restoring a Neon snapshot onto a **protected** `production` swaps in a **new branch id** and leaves the saved connection string's **password no longer valid**, even though Neon's own docs say the connection string is kept. The pooled endpoint (`ep-fancy-union-b1al1ulz`) and its hostname are unaffected — only the branch id and the password change. The replaced branch is kept by Neon under the name "`production (old)`" (a second restore in the same session can leave "`production (old) (1)`" too).

**Confirmed by the dress rehearsal's re-run (30 Sep): with `production`'s protection switched off, a `restore_snapshot` keeps the existing password.** The re-run restored with protection off and, with **no re-paste and no republish**, both the existing `NEON_PROD_DIRECT_URL` and `APP_DATABASE_URL` worked immediately; compute limits also stayed at 0.25–1 CU / 300 s (a restore with protection off didn't reset them to 8 CU either), and the restore itself took about 1 second. `production`'s protection is switched off for the whole cutover window (switchover plan A.1/E.0), so this is now the **normal path**.

**The normal path after any restore onto `production`, before running `db-ops` or republishing Replit again:**

1. **Claude, via the Neon MCP:** verify the restored `production` **read-only** with `run_sql` — row counts match the last-known-good fingerprint, `switchover.rehearsal_marker` present, `switchover.cutover_done` absent.
2. **Claude, via the Neon MCP:** **rename** (never delete) the leftover "`production (old)`" branch to `pre-restore-<attempt>-<hhmm>` (`list_branches`, then rename). **Don't delete it here** — it can be the parent of a kept archive or recovery branch, and Neon refuses to delete a branch with children. It's deleted only at E.13/G.1, with Samuel's OK.
3. **Claude, via the Neon MCP:** check `production`'s compute limits; re-set to **0.25–1 CU, suspend after 300 s** only if they've changed.
4. **Claude:** run `db-ops -f target=production -f command=verify-history` (and `fingerprint-source` if the old database still matters) using the **existing** `NEON_PROD_DIRECT_URL`, then `db-ops -f command=smoke -f base_url=<the EU project's own *.replit.app address>` — **no republish.** (In most recoveries `apptest.catspotters.com` isn't pointed at the EU project, so `smoke`'s default `base_url` would resolve to the wrong place and fail misleadingly; use the explicit EU address.) **Republish only if the start-up log shows a stale instance** still answering.

**The re-paste procedure below is now a fallback only** — run it if step 4 fails with "password authentication failed" (which means protection was on for this restore, or something else changed the password):

1. **Claude, via the Neon MCP:** verify the restored `production` **read-only** with `run_sql` first — row counts match the last-known-good fingerprint, `switchover.rehearsal_marker` present, `switchover.cutover_done` absent.
2. **Claude, via the Neon MCP:** **rename** (never delete) the leftover "`production (old)`" branch to `pre-restore-<attempt>-<hhmm>` (`list_branches`, then rename). **Don't delete it here** — it can be the parent of a kept archive or recovery branch, and Neon refuses to delete a branch with children. It's deleted only at E.13/G.1, with Samuel's OK.
3. **Claude, via the Neon MCP:** re-set `production`'s compute to **0.25–1 CU, suspend after 300 s** — a restore onto a *protected* branch resets the endpoint's autoscaling max to **8 CU**.
4. **Samuel:** open Neon Connect for **Branch: production** twice — pooling **off** into GitHub `production` environment secret `NEON_PROD_DIRECT_URL`; pooling **on** into **the EU (new) project's** deployment secret `APP_DATABASE_URL` (Neon Connect gives `sslmode=require`; change it to `verify-full` after pasting, as in the plan's C.4) — then **republish the EU project. Never the old project** (the domain may have just been reconnected to it, which makes "the live Replit project" ambiguous — it always means the EU one here).
5. **Claude:** wait for a **new instance start-up** log line (the start-up log from `lib/db` §B.2 in the plan) before judging anything — Replit's autoscale can keep serving the previous instance for a minute or two after a republish — then run `smoke`. **If `apptest.catspotters.com` isn't currently pointed at the EU project** (true for most of a rollback recovery), pass `-f base_url=<the EU project's own *.replit.app address>` — otherwise `smoke` resolves against whichever project the domain is on right now and can fail misleadingly.

Do the fallback steps above in order: the dress rehearsal's first live run (with protection on) took **~26 minutes** because the first Replit paste came from a stale look-alike branch name and a republish happened before the paste landed. Done in order, it's **estimated at ~5 minutes** — not yet measured end to end. See the plan's A.1 and F.1 for the full normal-path-versus-fallback reasoning.

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

Weekly-result bell entries (`notifications` rows whose `kind` is not `cat`) stay on Neon: the old database can't hold them, so they are not carried back and neither side counts them in the comparison.

Re-running it is safe. A failed apply changes nothing, and a second apply after a successful one finds nothing to do. If testers write on Neon again after an apply (say, before the domain move finished), a second pass carries those back too. After each successful apply, carry-back records what it left in the old database, in a small `switchover.carry_back_done` table outside the app's own tables. It creates this only when applying, never in a dry run. Anyone else's writes to the old database are still refused.

Where a cat name or username moves between rows (a rename and a new cat taking the old name, or two usernames swapped), carry-back briefly sets the unique indexes aside and rebuilds them exactly, all inside the same transaction. It doesn't do this for unique *constraints*. The baseline has none, and the old database's schema is never changed (R0).

### Aftercare checks after cutover (plan E.13)

At T-live plus 1 hour, 1 day and 7 days, and before the old database is deleted (G.1), run:

- `db-ops -f target=production -f command=fingerprint-source`: the old database must be unchanged since the copy (compare it with E.5's).
- `db-ops -f target=production -f command=carry-back-dry-run`: read-only on both sides. It prints exactly what testers have changed on Neon since cutover (what a rollback would carry back), and it confirms the old database is still unchanged since the copy.

Don't use `verify` for this. It compares Neon with the old database row for row, so it fails as soon as testers have written anything on Neon. To check the migration history on its own, use `verify-history`.

### `verify-history` (SYC-178)

`db-ops -f target=production -f command=verify-history` checks the target's record of applied migrations (`drizzle.__drizzle_migrations`) against `lib/db/migrations/meta/_journal.json` on `main`. It fails, naming the migration, when one is:

- **missing**: in the journal but not applied (either not yet, or skipped while later ones were applied);
- **extra**: applied, but not in the journal on `main` (the database is ahead of the code, or something was applied by hand);
- **edited**: applied, but the file has changed since (its hash differs);
- **out of order**: applied after a migration that comes later in the journal;
- **recorded twice**.

It opens a read-only session and connects to nothing but the target, so it's safe on production at any time. The same check runs at the end of `verify`. Locally: `DATABASE_URL=… pnpm --filter @workspace/db run migrate:history`.

A failure after a deploy usually means one of two things. If a migration is **missing**, `migrate` didn't run or didn't finish: read its log and run it again. If one is **extra**, production has a migration from a branch that isn't on `main` yet (or main's journal was rewritten): don't publish, and find which branch it came from before doing anything else. Running `migrate` again won't help: it refuses a database that's ahead of the code, for the same reason.

## Read-only checks without a connection string

The Neon MCP's `run_sql` (SELECT only), `describe_table_schema` and `list_branches` work without a connection string, so Claude uses them as an independent second look after any `db-ops` write. Writes to Neon never go through the MCP — always through `db-ops`, so every change is in the workflow's history.
