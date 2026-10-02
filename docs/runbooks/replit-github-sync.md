# Replit ↔ GitHub sync (SYC-96)

**Symptom:** the Replit workspace's agent can't `git fetch`/pull from GitHub. Either:
- `remote: Invalid username or token. Password authentication is not supported for Git operations.` (the pre-28-Sep state), or
- `fatal: 'origin' does not appear to be a git repository` (after a Git-pane-only reconnect — see below).

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md), which links here.

**After the SYC-121 move: this is about the new EU project, never the old one.** The Git-pane pull described below happens in the **new** Replit project (`Syros-Cat-Spotter-EU`); its `post-merge.sh` migrates the Neon `development` branch. **Never pull in the old project** — the SYC-121 plan's rule R2 keeps it frozen (no edits, no publishes, no pulls) so it stays intact as the way back until the retention date. See `docs/runbooks/neon-database.md` and the SYC-121 plan (`docs/superpowers/plans/syc-121-neon-switchover.md`, Part A.5).

## Decision, 29 Sep 2026: Samuel syncs by hand through the Git pane

**Do not disconnect GitHub in Replit.** When Samuel tried the account-level reconnect (option 3 below), Replit warned that disconnecting GitHub would break the app, so it was stopped before anything changed. The deploy-key fallback was offered and declined.

**The process now:** Samuel pulls `main` in the Repl's **Git pane** and publishes when asked. Claude does not try to make the Replit agent fetch by itself. Claude prepares everything else (what's changed, whether a database migration is included, the exact order of steps) and verifies after each deploy.

Pulling in the Git pane runs `scripts/post-merge.sh` (`.replit` `[postMerge]`), which installs dependencies and runs `migrate` against the **development** database. Production is separate: follow `DEPLOYMENT.md`'s schema-change order before publishing any change that includes a migration.

The rest of this file records the diagnosis and the options, in case the automated route is ever wanted again.

**If the Git pane says "not connected to any git providers" (1 Oct 2026):** the GitHub sign-in it uses lives in Samuel's Replit **account settings → Git Providers**, not in the project's settings. Click **Connect** next to GitHub and approve. When nothing is connected, connecting is safe: it is not the disconnect warned about above. On 1 Oct, Connect failed during a Replit integrations outage and worked once Replit fixed it. If it connects but still can't pull, the repo belongs to the `fairshake-au` organisation: grant the Replit OAuth app access to it under GitHub → Settings → Applications → Authorized OAuth Apps → Replit → Organization access.

## Root cause (diagnosed 28 Sep 2026)

The workspace has **two independent GitHub auth paths** that don't share credentials:

1. **The Git pane (Tools → Git) in the browser UI.** This is what Samuel used on 28 Sep ("reconnected GitHub and pulled from Replit's Git pane"). It got the workspace to `476b56f`.
2. **The shell's git, which is what the Replit *agent* uses.** In the shell there is **no remote named `origin`** — the GitHub remote is auto-named something like `subrepl-0jykf9qw`, alongside ~60 unrelated internal `subrepl-*` SSH remotes that point at Replit's own infra, not GitHub. Its auth goes through `GIT_ASKPASS`, which — per Replit's own docs — needs a **one-time-per-session interactive dialog in the browser** ("pass GitHub credentials to the shell") the first time a session's shell needs the token. An autonomous agent session has no one to click that dialog, so the ASKPASS helper comes back empty and git reports the same "Invalid username or token" error, even right after the Git pane reconnect fixed path 1.

Confirmed via the Replit MCP `ask_question` tool (read-only — no changes made while diagnosing):
- `git remote -v` → no `origin`; GitHub remote is `subrepl-0jykf9qw` (HTTPS).
- `git fetch subrepl-0jykf9qw` → same "Invalid username or token" error as the ticket, *after* Samuel's 28 Sep reconnect.
- No `credential.helper`, no `~/.git-credentials`; `GIT_ASKPASS` is set (Replit's own helper).
- `gh api orgs/fairshake-au/installations` → only the **Claude** and **Cursor** GitHub Apps are installed on the org. There's no Replit GitHub App installation backing this — the shell's connector is a personal-account OAuth link, which is exactly the kind of thing that goes stale independently of the UI Git pane.

## Fix options considered

1. **Read-only deploy key, generated inside the workspace.** This was the preferred fix (least access, single repo, doesn't expire). It was attempted via `update_app_using_prompt`, asking the Replit agent to generate an ed25519 keypair itself and store the private half as a Replit Secret, so the private key would never transit any of Claude's tool calls or logs. **Blocked:** the Replit agent confirmed it has no tool/CLI/API to write into the workspace's Secrets store — only a UI form that requires a human to type the value in. Per SYC-96's explicit instruction ("if you can't [install the private half into Replit Secrets safely], STOP and report instead"), this path was abandoned rather than falling back to storing the key as a bare unmanaged file.
2. **Rebuild the deploy flow to pull straight from GitHub, no Replit git sync at all.** Real option, but it's a bigger change to the deploy pipeline (touches the area PR #13/SYC-64 owns, plus CI) and needs its own spec under the standard pipeline gate. Not needed to satisfy this ticket's narrower "done when" (the agent can fetch), so left for a separate ticket if Samuel wants to pursue it later.
3. **A fresh GitHub reconnect, but at the account-level Connectors page, not the Git pane.** **Not taken:** Replit warns that disconnecting GitHub breaks the app (29 Sep 2026). Replit's own docs point at `https://replit.com/integrations` (or the workspace's own Connectors/Secrets sidebar → GitHub) as the durable, token-backed connector — distinct from the Git pane's own "Connect" button, which only appears to refresh Git-pane-local auth. This is an OAuth authorize screen; nothing in the Replit or GitHub API can click through it on Samuel's behalf. Trade-off: least effort of the three options, but broadest access — it's a personal OAuth link with org-wide scope, not scoped to this one repo, and it can go stale again the same way it did this time.

## Checking the workspace after a manual pull (Claude)

Ask the Replit agent (via `ask_question`, read-only) for `git log -1 --format=%H` and compare it with `git rev-parse origin/main`. It doesn't need to fetch for this.

## If automation is wanted later

The option that doesn't touch the existing GitHub link is a read-only deploy key scoped to just this repo.

- Claude generates the keypair, adds the public half to GitHub with `gh repo deploy-key add --read-only`, and points the shell's git remote at the SSH URL.
- Samuel pastes the **private half straight into the Repl's Secrets pane** once — never into chat, a file, or a prompt. Claude never sees or handles the private key.
- It's narrower than the account-level reconnect (this repo only, not org-wide) and doesn't expire the way a personal OAuth link does.

**Not recommended:** a `GIT_URL`-with-token-in-the-URL secret (e.g. `https://<token>@github.com/...` stored as one secret). It looks simpler but a token embedded in a URL routinely leaks into shell history, process listings, and `git remote -v` output/logs — a deploy key achieves the same access with narrower scope and without that leak surface.

## Standing rule

Never ask Samuel to disconnect GitHub in Replit. If the Git pane's own pull stops working, reconnect from the Git pane (that fixed it on 28 Sep), and otherwise raise it with Samuel before trying anything else.
