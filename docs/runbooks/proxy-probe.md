# Proxy probe (SYC-100)

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md) §C. **Design:** `artifacts/api-server/src/lib/proxyProbe.ts`.

`app.ts` sets `app.set("trust proxy", 1)`, assuming exactly one proxy hop between
a real visitor and the server (Replit's own front door). That assumption has
never been checked against the live deployment. If the real chain has more
hops, `req.ip` resolves to a Replit-internal address instead of the visitor's,
every visitor lands in one rate-limit bucket together, and `photoLimiter`
(SYC-65/92) starts 429ing everyone once the budget fills. If it's too
trusting the other way, a visitor can fake their address and dodge the limit.

This probe answers the question end to end, without ever putting a real
visitor's IP address — or even a test one — in a log line Claude can read.
It is a diagnostic only: this PR does not change `trust proxy` itself.

## How it's gated

`GET /api/healthz` (always open, outside the pre-launch gate) runs one extra
check on every request: if the environment variable `PROXY_PROBE_TOKEN` is
unset, nothing happens — the diagnostic doesn't exist. If it's set, a request
needs a matching `X-Proxy-Probe: <token>` header (compared in constant time)
before anything is logged. Without the header, or with the wrong value, the
route behaves exactly as it does today.

A matching request logs exactly one line, and never a raw IP:

```
proxy-probe: ip_kind=<public|private|loopback|unknown> ip_matches_xff_first=<bool> ip_matches_xff_last=<bool> xff_hops=<n>
```

- `ip_kind` — what `req.ip` (the address Express decided is the client)
  looks like: a RFC1918/CGNAT/link-local/loopback address, or `public`.
- `ip_matches_xff_first` / `ip_matches_xff_last` — whether `req.ip` equals
  the first or last entry of the `X-Forwarded-For` header, without ever
  printing either value.
- `xff_hops` — how many comma-separated entries were in `X-Forwarded-For`.
  This is the field that reflects the real chain length. (There is
  deliberately no `req.ips`-derived field: under a numeric `trust proxy`
  setting, `proxy-addr`'s scan stops at the first untrusted address, so
  `req.ips.length` is structurally capped at 0 or 1 no matter how many real
  proxy hops exist upstream — it reads `1` whether there's truly one hop or
  three still-under-trusted ones, so it can't diagnose "too few hops" and
  was left out rather than published as a count it isn't.)

## Running the check

Claude can't hold `PROXY_PROBE_TOKEN` either (same rule as every other
deployment secret — see `docs/runbooks/neon-database.md`), so the probe runs
from a GitHub Actions job that reads the token from a GitHub secret, not from
a curl Claude types with the value in it.

1. **Samuel sets the secret once**, pasted directly into GitHub, never into
   chat: `PROXY_PROBE_TOKEN` as a secret on the repo's `production`
   Environment (the same Environment `db-ops.yml`'s production runs use —
   see `.github/workflows/db-ops.yml`). Any long random value works, e.g.
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
   The same value also needs to reach the live deployment's own environment
   (as `PROXY_PROBE_TOKEN`) — a Replit deployment secret, set the same way
   the `PRELAUNCH_*` secrets are (`docs/runbooks/pre-launch-gate.md`).

2. **Claude runs the workflow:**

   ```
   gh workflow run proxy-probe.yml --ref main
   gh run watch
   gh run view --log
   ```

   (`--ref main` always, for the same reason `db-ops.yml` always pins it —
   see `docs/superpowers/plans/syc-121-neon-switchover.md` Part A.3.) It
   sends two requests to `/api/healthz`: one with a spoofed
   `X-Forwarded-For: 203.0.113.77`, one with none. Neither step prints the
   response body, a header value, or the token — only an HTTP status code.

3. **Claude reads the result via the Replit agent** (never by asking Samuel
   to open the dashboard — `browser-flows-need-a-browser` and the
   do-it-yourself rules on probing credentialed services both point the same
   way): ask it for the two most recent `proxy-probe` log lines. Each is the
   JSON line shown above; nothing else in it needs redacting.

## Reading the two lines

| Spoofed-XFF probe shows | No-XFF probe shows | Means | Fix |
|---|---|---|---|
| `ip_kind=public`, `ip_matches_xff_first=false` | `ip_kind=public` | `trust proxy: 1` is correct — Replit's one real hop is trusted, the spoofed value is ignored | None. Tick the DEPLOYMENT.md §C box. |
| `ip_kind=private` or `ip_kind=loopback` | same | Too few hops trusted — `req.ip` is resolving to a Replit-internal address, not the visitor | Raise the `trust proxy` count by the difference and re-run the probe |
| `ip_matches_xff_first=true` (on the spoofed-XFF probe) | — | Too many hops trusted — a visitor-supplied value is being believed as the client address | Lower the `trust proxy` count and re-run the probe |
| `xff_hops=0` on both probes | | Replit isn't forwarding `X-Forwarded-For` at all, or the deployment is unreachable without a pre-launch pass | Check the deployment's logs directly before touching `trust proxy` |

If a fix is needed, change the number in `app.set("trust proxy", <n>)`
(`artifacts/api-server/src/app.ts`) in its own small PR, redeploy, and run
this probe again to confirm.

## Afterwards

Remove the probe once the hop count is confirmed and stable — it's a
diagnostic, not something that should live in the API indefinitely. Tracked
as a follow-up ticket rather than done inline here, so this PR stays reviewable.
