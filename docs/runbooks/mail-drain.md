# Mail drain (SYC-42 layer 3, SYC-231)

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md). **Design:** `docs/superpowers/plans/syc-42-cat-in-trouble.md` item 1.6.

Cat-report alerts to Syros Cats normally go out the moment a report is filed, or on the next request to the app. The mail drain is the safety net: every 2 hours something asks the app to send whatever is still queued, and **if a cat-report alert has been waiting for over an hour, Samuel gets an email**. Because the check runs every 2 hours, that email arrives 1 to 3 hours after the alert got stuck (Samuel's choice, 14 Oct 2026; it was every 10 minutes at first). That email goes through Cloudflare, not Resend, so it still arrives when Resend is the thing that's broken. It pages nobody: it's about the system, not about a cat.

## What runs it

| What | Where | How often |
|---|---|---|
| **`mail-drain-cron` Cloudflare Worker** (the main one) | `infra/mail-drain-cron/`, Cloudflare account, cron trigger | Every 2 hours, on the hour (UTC), reliably |
| **`mail-drain.yml` GitHub workflow** (a backup) | `.github/workflows/mail-drain.yml` | Asked for every 3 hours; GitHub often runs it later. Also runs by hand from the Actions tab |

**What a 2-hour check means for a retry.** An email whose first send fails is retried on the next visit to the app, or at the next timer run, whichever comes first. On a quiet night that can be up to 2 hours (3 if only the GitHub backup runs). Busy hours are much quicker because every visit triggers a retry.

Both call `POST https://apptest.catspotters.com/api/internal/mail/drain` with `Authorization: Bearer <MAIL_DRAIN_TOKEN>`. Two callers at once is safe: each queued email is claimed by one of them only.

The app answers:

- **200** `{"overdue":0,...}`: all fine. The Worker only counts it as fine if the reply really is this JSON; any other 200 (a login wall, a holding page) counts as a failed call. It doesn't follow redirects either.
- **500** `{"error":"welfare_alert_overdue",...}`: a cat-report alert has been unsent for over an hour.
- **401**: the token doesn't match (or, before launch, the pre-launch gate didn't accept it).
- **503** `{"error":"not_configured"}`: Replit has no `MAIL_DRAIN_TOKEN`.

## The alarm emails

The Worker emails **sam@fairshake.au** (a verified Cloudflare Email Routing address on catspotters.com) from `mail-drain@catspotters.com`:

| Subject starts | Means | Repeats |
|---|---|---|
| "a cat-report alert to Syros Cats is over an hour late" | The app is up but can't send the alert. Check `RESEND_API_KEY` and `WELFARE_ALERT_TO` in Replit, and Resend's log. The report itself is safe in the database. | At every run (every 2 hours) while it lasts |
| "the mail drain call failed (HTTP …)" | The app is down, asleep and not waking, or refusing the token (401) | About every 4 hours (every other run) |
| "the mail drain has no token" | The Worker lost its secret | About every 4 hours |
| "the mail drain is back to normal" | The first good run after any of the above | Once |

The GitHub backup, when it fails, makes GitHub email Samuel about a failed run, as before. A failed GitHub run can also be GitHub's own fault: the 5 Oct 2026 20:37 UTC failure was GitHub never giving the job a machine to run on (it waited 15 minutes and was cancelled). If the Worker hasn't emailed, a lone GitHub failure is probably GitHub.

## Where the token lives

`MAIL_DRAIN_TOKEN` is in three places, never in a file, chat, ticket or this runbook:

1. Replit deployment secrets (the app checks it).
2. The Worker's secrets (`wrangler secret list` in `infra/mail-drain-cron` shows the name only).
3. GitHub, `production` environment secret (the backup workflow).

It opens one thing only: asking the app to send mail that was already queued.

## Checking it's running

- **Live logs:** from `infra/mail-drain-cron`, `npx wrangler tail mail-drain-cron`. Each tick logs one line: `{"event":"mail_drain","kind":"ok","status":200,...}`.
- **History:** Cloudflare dashboard, Workers & Pages, `mail-drain-cron`, Logs (observability is on), or the Cron events tab.

## Rotating the token

1. Make a new one in a terminal into a file only you can read, for example `umask 077; openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n' > token`.
2. Samuel replaces `MAIL_DRAIN_TOKEN` in Replit's deployment secrets with it and republishes.
3. Wait until a call with the new token gets a 200 (until then the app answers 401).
4. Worker: `printf 'MAIL_DRAIN_TOKEN=%s\n' "$(cat token)" > worker.env` then `npx wrangler deploy --secrets-file worker.env` from `infra/mail-drain-cron`. Delete `worker.env`.
5. GitHub: `gh secret set MAIL_DRAIN_TOKEN --env production < token`. Delete `token`.

Between steps 2 and 4 the Worker gets 401s and may send one "call failed" email. That's expected.

## Changing the Worker

Code is in `infra/mail-drain-cron/src` (the tick's logic is `drain.js`; tests: `npm test` in that folder, also run by CI). Deploy with `npx wrangler deploy` from that folder; the secret carries over between deploys.

## The nightly news check (SYC-45 Slice 1)

The same Worker has a second cron, `30 0 * * *` (UTC): 03:30 in Athens in summer time and 02:30 in winter time, always the same Athens night. It asks the app to run the **nightly news check** (`docs/superpowers/plans/syc-344-email-capture.md`, Slice 1). The check looks at every followed cat for good news (confirmed sterilised, found a home, seen again after four months or more) and records what it finds. **It sends nobody anything**: it is watch only, to start the two-week clock that cat-news emails need before they can switch on (spec §10.1, Risk 1). `news-nightly.yml` is the daily backup (06:17 UTC), switched on by the repo variable `NEWS_NIGHTLY_ENABLED = true`.

Both call `POST /api/internal/news/nightly`, then the Worker calls `GET /api/internal/news/last-run`, each with `Authorization: Bearer <NEWS_JOB_TOKEN>`. That token opens only those two paths. It lives in the same three places as `MAIL_DRAIN_TOKEN` (Replit deployment secrets, the Worker's secrets, the GitHub `production` environment), never in a file. The check runs once per Athens night whoever calls: a second call answers `{"already": true}`, and one made while another is running answers `{"busy": true}`. A run that crashes claims nothing, so the backup runs it again.

Samuel gets an email (through Cloudflare, like the drain's) when:

- the call fails (not a 200, or a 200 that isn't the check's answer);
- more than 50 "sterilised" or "homed" changes were found in one night: those are all held back (`silencedBulk: true`), because that looks like a batch of corrections, not news. "Seen again" has its own limit of 200, and tripping it holds back only "seen again" news, so a busy spring night of real sightings never hides a real sterilisation (Samuel, 18 Oct 2026, SYC-475);
- no night has finished in 36 hours;
- the Worker has no `NEWS_JOB_TOKEN`.

What the check found is at `GET /api/team/news-changes` (staff only, the last 30 days), and a person marks one looked at with `POST /api/team/news-changes/:id/review` (an optional `note`). The clock needs at least one reviewed, genuine change.

## The nightly fingerprint batch (SYC-527 piece 3)

"Find from a photo" compares a photo against each cat's picture by a stored "fingerprint" of that picture (the looks-like index; spec `docs/specs/find-from-a-photo-whole-island.md` §7). Searches top up a few missing ones, but the bulk is made overnight. `fingerprints-nightly.yml` runs at 01:41 UTC (04:41 in Athens in summer time, 03:41 in winter time) and calls `POST /api/internal/fingerprints/nightly` with `Authorization: Bearer <FINGERPRINT_JOB_TOKEN>`. That token opens only that path, and no other token opens it. The app fingerprints every active cat's display photo that has none (a cat whose main photo the team hid is covered by its stand-in; a hidden photo never gets a fingerprint), oldest first, and stops starting new photos after 4 minutes. It answers `{"made", "failed", "left"}`, counts only; `left` is how many were not reached, and the next night carries on. The request stays open for the whole run (up to about 4 minutes and a little more; the workflow waits up to 330 seconds). The run fails, and GitHub emails Samuel, on any answer but 200. Unlike the news check it has no Worker caller: the GitHub schedule is the only one.

The first run (the backfill) is done by hand: after the migration has run and `/api/healthz` shows the new build, start the workflow from the Actions tab (a manual run goes whether or not the switch is on). If `left` is not 0, run it again until it is. Put the counts on SYC-527, then set the repo variable `FINGERPRINTS_NIGHTLY_ENABLED` to `true` to switch the nightly schedule on. Switching it off again is setting the variable to anything else.

The token rollout, in words and never with a value on screen or in a chat, routine or prompt:

- make the token into a file that has no line break at the end;
- set it from that file as the `FINGERPRINT_JOB_TOKEN` secret in GitHub's `production` environment, and as a deployment secret in Replit;
- check from Replit that the pasted value has no stray space or line break;
- give Samuel a one-line heads-up first, and deploy only after the app shows the new build.

Until the token exists in the app, the route answers 503 and the workflow's manual run fails with that, which is the right alarm.
