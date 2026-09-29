# Replit ↔ GitHub sync (SYC-96)

**Symptom:** the Replit workspace's agent can't `git fetch`/pull from GitHub. Either:
- `remote: Invalid username or token. Password authentication is not supported for Git operations.` (the pre-28-Sep state), or
- `fatal: 'origin' does not appear to be a git repository` (after a Git-pane-only reconnect — see below).

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md), which links here.

**After the SYC-121 move: this is about the new EU project, never the old one.** The Git-pane pull described below happens in the **new** Replit project (`Syros-Cat-Spotter-EU`); its `post-merge.sh` migrates the Neon `development` branch. **Never pull in the old project** — the SYC-121 plan's rule R2 keeps it frozen (no edits, no publishes, no pulls) so it stays intact as the way back until the retention date. See `docs/runbooks/neon-database.md` and the SYC-121 plan (`docs/superpowers/plans/syc-121-neon-switchover.md`, Part A.5).

**Status: diagnosis confirmed, fix NOT yet verified.** The two-auth-paths diagnosis was confirmed live; the account-level reconnect is the fix we expect to work, but the verification check hasn't run yet. Don't treat SYC-96 as closed until the SHA check in "How to verify afterward" has passed and is recorded on the ticket.

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
3. **A fresh GitHub reconnect, but at the account-level Connectors page, not the Git pane.** This is the fix we expect to work (unverified until the check below passes). Replit's own docs point at `https://replit.com/integrations` (or the workspace's own Connectors/Secrets sidebar → GitHub) as the durable, token-backed connector — distinct from the Git pane's own "Connect" button, which only appears to refresh Git-pane-local auth. This is an OAuth authorize screen; nothing in the Replit or GitHub API can click through it on Samuel's behalf. Trade-off: least effort of the three options, but broadest access — it's a personal OAuth link with org-wide scope, not scoped to this one repo, and it can go stale again the same way it did this time.

## What Samuel needs to do (one-time, ~2 minutes)

1. Open the Syros Cat Spotter Repl → left sidebar → **Connectors** (or **Account → Connected services** if it's not in the sidebar) → find **GitHub**.
2. If it shows as connected, **disconnect it, then reconnect** — this is not the same click as the Git pane's own reconnect from earlier. When GitHub's authorize screen appears, make sure it grants access to the **fairshake-au** organisation (GitHub may show an "Organization access" section with a "Request" or "Grant" button next to fairshake-au — grant it, don't leave it pending).
3. That's it — no token to copy/paste anywhere.

## How to verify afterward (Claude can do this end to end)

Ask the Replit agent (via `ask_question`) to run `git fetch subrepl-<id>` (or `origin`, if a remote by that name has since been added) and report the exact output, then compare the resulting `subrepl-<id>/main` SHA against `git rev-parse origin/main` from a normal clone. No publish/redeploy is needed for this check — `get_publish_status` alone confirms the site is still serving the last published build while the workspace catches up.

## If the reconnect doesn't fix it

Fallback: a read-only deploy key scoped to just this repo.

- Claude generates the keypair, adds the public half to GitHub with `gh repo deploy-key add --read-only`, and points the shell's git remote at the SSH URL.
- Samuel pastes the **private half straight into the Repl's Secrets pane** once — never into chat, a file, or a prompt. Claude never sees or handles the private key.
- It's narrower than the account-level reconnect (this repo only, not org-wide) and doesn't expire the way a personal OAuth link does.

**Not recommended:** a `GIT_URL`-with-token-in-the-URL secret (e.g. `https://<token>@github.com/...` stored as one secret). It looks simpler but a token embedded in a URL routinely leaks into shell history, process listings, and `git remote -v` output/logs — a deploy key achieves the same access with narrower scope and without that leak surface.

## Standing rule once this is verified

If this connector goes stale again, start with the same **account-level Connectors page** reconnect — not the Git pane's own button, which only fixes the browser-session Git pane and leaves the agent's shell broken. Don't spend time re-diagnosing; jump straight to Connectors. Update this section if verification shows otherwise.
