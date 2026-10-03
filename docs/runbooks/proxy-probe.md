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

A matching request logs exactly one line, and never a raw IP or a hash of one:

```
proxy-probe: ip_kind=<public|private|loopback|unknown> ip_matches_xff_first=<bool> ip_matches_xff_last=<bool> xff_hops=<n> client_found=<bool> client_pos_from_right=<n|null>
```

- `ip_kind` — what `req.ip` (the address Express decided is the client)
  looks like: a RFC1918/CGNAT/link-local/loopback address, or `public`.
  **This does not prove the address is the real visitor** — see "Reading
  the lines" below; it only rules out the private/loopback cases.
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
- `client_found` / `client_pos_from_right` — **the actual answer.** The
  workflow learns its own public egress IP out of band (never sent to the
  server as plaintext) and sends `HMAC-SHA256(key=PROXY_PROBE_TOKEN,
  msg=<that IP>)` as the `X-Proxy-Probe-Expect` header. The server hashes
  every candidate address in `[...X-Forwarded-For entries, socket address]`
  the same way and reports which one matched, as its distance from the
  right of that chain — which is exactly the number to put in
  `app.set("trust proxy", <n>)` for `req.ip` to land on it.
  `client_pos_from_right` is `null` (and `client_found` is `false`) when
  nothing matched, or when the request didn't carry
  `X-Proxy-Probe-Expect` at all.

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
   see `docs/superpowers/plans/syc-121-neon-switchover.md` Part A.3.) The
   workflow's first step learns the runner's own public egress IP (`curl
   https://api.ipify.org`, cross-checked against `https://ifconfig.me` —
   it fails the job if they're empty or disagree) and hashes it as
   `HMAC-SHA256(key=PROXY_PROBE_TOKEN, msg=<that IP>)`. It then sends
   **three** requests to `/api/healthz`, each carrying that hash as
   `X-Proxy-Probe-Expect` alongside the existing `X-Proxy-Probe` token: two
   plain requests (to check the answer is stable run to run) and one with a
   spoofed `X-Forwarded-For: 203.0.113.77` (to check spoofing doesn't move
   the answer). No step prints the response body, a header value, the
   runner's IP, or the hash — only an HTTP status code each time.

3. **Claude reads the result via the Replit agent** (never by asking Samuel
   to open the dashboard — `browser-flows-need-a-browser` and the
   do-it-yourself rules on probing credentialed services both point the same
   way): ask it for the three most recent `proxy-probe` log lines. Each is
   the JSON line shown above; nothing else in it needs redacting.

## Reading the lines

**The decision is `client_pos_from_right`, never `ip_kind`.** The first live
run (2 Oct) showed `ip_kind=public` on the address `trust proxy: 1` was
already picking — and that turned out to be a Google front-end hop, not the
visitor, because a load-balancer's address is just as publicly routable as a
real visitor's. `ip_kind=public` only rules out "resolving to something
internal"; it can never by itself confirm "this is the client". Only a
confirmed hash match can.

1. **`client_found=false` on all three lines** — the runner's own egress IP
   never appeared anywhere in the chain Replit handed to the app (not in any
   `X-Forwarded-For` entry, not as the socket address). Check the workflow
   run for a `::error::` from the egress-IP step first (ipify/ifconfig.me
   disagreement or emptiness); if that passed, something is being rewritten
   between the runner and the app (e.g. Replit isn't forwarding the runner's
   literal IP for some other reason) — investigate before touching
   `trust proxy`.
2. **The three lines don't agree on `client_pos_from_right`** — in
   particular, if the spoofed-XFF line differs from the two plain lines,
   something about the chain isn't stable (or the spoof is somehow
   influencing which entry the real client lands on) — don't set
   `trust proxy` from a single run; re-run and investigate before trusting
   the number.
3. **All three lines agree on the same `client_pos_from_right=<n>`** — that
   `<n>` is the hop count to trust. Set `app.set("trust proxy", <n>)`
   (`artifacts/api-server/src/app.ts`) in its own small PR, redeploy, and
   run this probe again to confirm `client_pos_from_right` stays stable
   with the new setting (it should land on the same physical hop, now
   reported in `req.ip` itself — `ip_matches_xff_first`/`ip_matches_xff_last`
   can cross-check that). Tick the DEPLOYMENT.md §C box.
4. **`xff_hops=0` on the plain-request lines** — Replit isn't forwarding
   `X-Forwarded-For` at all, or the deployment is unreachable without a
   pre-launch pass. Check the deployment's logs directly before touching
   `trust proxy`.

## If the token leaks

Nothing it guards is itself sensitive — `runProxyProbe` never touches the
response, so a correct guess can't read anyone's IP or change what
`/api/healthz` returns. The actual blast radius of a leaked
`PROXY_PROBE_TOKEN` is that anyone who has it can replay a request
indefinitely and flood our own logs with `proxy-probe` lines (there's no
rate limit on this path specifically). If that happens: rotate or delete
`PROXY_PROBE_TOKEN` from both the GitHub `production` Environment and the
Replit deployment secret (same two places it was set, above) — that alone
makes the diagnostic inert again, with no redeploy needed on the code side.

## Afterwards

Remove the probe once the hop count is confirmed and stable — it's a
diagnostic, not something that should live in the API indefinitely.
Tracked as **SYC-187**, not just this paragraph: delete
`runProxyProbe`/`proxyProbe.ts` and its tests, delete
`.github/workflows/proxy-probe.yml`, delete the `PROXY_PROBE_TOKEN` secret
from both places it was set, and tick the DEPLOYMENT.md §C box.
