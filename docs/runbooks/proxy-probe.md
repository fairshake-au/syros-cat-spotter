# Proxy probe (SYC-100) — historical note

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md) §C.

This was a token-gated diagnostic on `GET /api/healthz` that measured how
many proxy hops sit between a real visitor and the server on the live
Replit deployment, without ever logging a raw IP address (or even a hash of
one) — only counts, kinds and booleans. It existed to check (and if needed
fix) the `app.set("trust proxy", <n>)` setting in
`artifacts/api-server/src/app.ts`, which rate limiting (SYC-65/92) depends
on for `req.ip` to resolve to the actual visitor rather than a shared proxy
hop.

## What it found

**Measured live, 3 Oct 2026.** The visitor sits **4 hops** from the server.
`trust proxy` was set to **4** accordingly:

- First live run (2 Oct, run 37056715860) showed 4 `X-Forwarded-For` entries
  with no client-supplied header, but `ip_kind=public` alone couldn't prove
  which entry was the real visitor rather than a Google front-end hop.
- A confirmation probe (run 37091945054, 3 Oct 03:04 UTC) added a
  hash-matched "is this address really the caller" check:
  `client_pos_from_right=4` on all three probes, including a spoofed-XFF
  one — so position 4 is the client, not a downstream hop.
- [PR #63](https://github.com/fairshake-au/syros-cat-spotter/pull/63) set
  `trust proxy` to 4 (merged `ffe8c82`), cross-checked against `proxy-addr`
  directly before merging.
- Verified again after Samuel's republish (run 37101007731, 3 Oct 05:48
  UTC): no-spoof probes show `ip_matches_xff_first=true`; the spoofed probe
  still resolves to position 4 and is correctly not trusted.

`docs/DEPLOYMENT.md` §C is ticked with this result.

## What happened to the code

Removed under **SYC-187**, now that the hop count is confirmed and stable —
it was a diagnostic, not something meant to live in the API indefinitely.
Deleted: `runProxyProbe` (called from `GET /api/healthz`),
`artifacts/api-server/src/lib/proxyProbe.ts` and its tests,
`artifacts/api-server/src/routes/health.proxyProbe.test.ts`, and
`.github/workflows/proxy-probe.yml`. The `PROXY_PROBE_TOKEN` secret is
removed from the GitHub `production` Environment and the Replit EU
deployment as a follow-up to the same ticket.

**If Replit's proxy chain ever changes** (different hop count, migrating
off Replit, etc.), `trust proxy` will need re-measuring. The probe's design,
code and this runbook's original "how to run it" / "reading the lines"
instructions are preserved in git history — see
[PR #57](https://github.com/fairshake-au/syros-cat-spotter/pull/57) (initial
probe) and [PR #60](https://github.com/fairshake-au/syros-cat-spotter/pull/60)
(confirmation probe with the hash-match check) — and can be restored from
there rather than rebuilt from scratch.
