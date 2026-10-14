# Mail drain (SYC-42 layer 3, SYC-231)

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md). **Design:** `docs/superpowers/plans/syc-42-cat-in-trouble.md` item 1.6.

Cat-report alerts to Syros Cats normally go out the moment a report is filed, or on the next request to the app. The mail drain is the safety net: every 2 hours something asks the app to send whatever is still queued, and **if a cat-report alert has been waiting for over an hour, Samuel gets an email**. Because the check runs every 2 hours, that email arrives 1 to 3 hours after the alert got stuck (Samuel's choice, 14 Oct 2026; it was every 10 minutes at first). That email goes through Cloudflare, not Resend, so it still arrives when Resend is the thing that's broken. It pages nobody: it's about the system, not about a cat.

## What runs it

| What | Where | How often |
|---|---|---|
| **`mail-drain-cron` Cloudflare Worker** (the main one) | `infra/mail-drain-cron/`, Cloudflare account, cron trigger | Every 2 hours, on the hour (UTC), reliably |
| **`mail-drain.yml` GitHub workflow** (a backup) | `.github/workflows/mail-drain.yml` | Asked for every 3 hours; GitHub often runs it later. Also runs by hand from the Actions tab |

Both call `POST https://apptest.catspotters.com/api/internal/mail/drain` with `Authorization: Bearer <MAIL_DRAIN_TOKEN>`. Two callers at once is safe: each queued email is claimed by one of them only.

The app answers:

- **200** `{"overdue":0,...}`: all fine.
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
