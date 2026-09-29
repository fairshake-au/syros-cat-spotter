# Pre-launch gate (SYC-113)

**Companion to:** [DEPLOYMENT.md](../DEPLOYMENT.md) §C. **Design:** `docs/superpowers/plans/syc-113-pre-launch-gates.md`.

Until launch, `apptest.catspotters.com` is kept private by two gates in our own code, not by Replit's "Password protected" setting:

- **The website** shows a Cat Spotters password page. The right password sets a cookie (`__Host-cs_prelaunch`) that lasts 28 days on that browser.
- **The API** refuses every `/api` request without a pass: `401 {"error":"prelaunch_pass_required"}`. A pass is the website cookie, the tester key built into the TestFlight and Play test builds (`X-Prelaunch-Key`), or, on `/api/internal/*` only, the sign-in Worker's bearer. `/api/healthz` is always open (Replit's health check). `/api/team/*` has its own staff sign-in and skips the pass.

Keys and passwords are never pasted into chat, tickets, routines or this file.

## Settings

| Setting | Where | What |
|---|---|---|
| `PRELAUNCH_GATE` | Replit deployment (both services) | `on` or `off`. **Unset means on** in production. Any other value also means on, with a warning in the log. |
| `PRELAUNCH_WEB_PASSWORD` | Replit deployment secret | The shared website password. A long passphrase. |
| `PRELAUNCH_SESSION_KEYS` | Replit deployment secret | One or two random 32-byte keys, base64url, comma-separated. They sign the website cookie. |
| `PRELAUNCH_TESTER_KEYS` | Replit deployment secret | One or two tester keys, comma-separated. |
| `EXPO_PUBLIC_PRELAUNCH_KEY` | **EAS build environment only**, never Replit | The tester key baked into store builds. The web build refuses to run if it's set, and scans its own output for every `PRELAUNCH_TESTER_KEYS` value. |
| `INTERNAL_PEOPLE_TOKEN` | Replit deployment secret and Worker secret | The sign-in Worker's pass on `/api/internal/*` (SYC-43 / PR #20). |

To make a key in a terminal (the value goes straight into the secret form, not into chat):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**If a setting is missing while the gate is on, it fails closed:** the website shows "Cat Spotters isn't available right now" (503), and the API answers `503 {"error":"prelaunch_not_configured"}` to everything except `/api/healthz`. The start-up logs say which settings are present, never their values:

```
prelaunch gate: on (session keys: 1, tester keys: 1, internal token: yes)
```

## Rotating

- **The website password.** Change `PRELAUNCH_WEB_PASSWORD` and publish. People already logged in stay logged in until their cookie runs out; to log everyone out too, rotate the session keys as well.
- **The session keys (logs every website visitor out).** Replace `PRELAUNCH_SESSION_KEYS` with one new key and publish. To change keys without logging people out, set `new,old` for 28 days (new cookies use the first key; either is accepted), then drop the old one.
- **The tester key.** Set `PRELAUNCH_TESTER_KEYS` to `old,new` and publish. Put the new key in EAS (`eas env:update` for the store build profiles) and ship new test builds. Once testers are on the new build, set `PRELAUNCH_TESTER_KEYS` to just `new` and publish. Old builds then get "Cat Spotters isn't open yet."

## Calling the API by hand

While the gate is on, add the tester key header, read from the terminal's environment:

```
curl -sS -H "X-Prelaunch-Key: $PRELAUNCH_KEY" https://apptest.catspotters.com/api/cats
```

That includes owner updates (`POST /api/cats/:id/updates` with `OWNER_SECRET`). `artifacts/api-server/scripts/security-check.mjs` sends the header itself when `PRELAUNCH_KEY` is set. Never put the key in a URL.

## Turning it off (launch day)

In order, each step checked from live sources and recorded on SYC-114 before the next:

0. **Confirm location blurring is live first** (data spine PR 6 merged, and a live probe with the tester key shows the public cat list returns no exact coordinates). If it isn't, stop: the gate stays on. Nothing in the code enforces this; this step does.
1. Set `PRELAUNCH_GATE=off` on the Replit deployment and publish.
2. Probe: `/api/cats` with no pass → 200; a photo with no pass → 200 with `Cache-Control: public`; `/` → the real site; `/robots.txt` → the normal file; the log says `prelaunch gate: off`.
3. Leave the tester key in old builds; it's ignored.
4. Later, in an ordinary PR: delete the gate code, `/_gate/*`, the settings and the EAS variable.

**Rolling back** before launch: set the new EU project (SYC-121) back to "Password protected" (a publish), which puts Replit's wall in front again. Until SYC-121's cutover, the old project stays Password protected and untouched as its way back.

## Moving to the new EU project (SYC-121)

Public goes live on the new EU project's **first** publish (SYC-121 C.6), with this code, `PRELAUNCH_GATE` unset (so on) and the `PRELAUNCH_*` secrets already set. The existing deployment is not switched to Public: there's no unpublish and no outage. The old project stays Password protected as SYC-121's way back, and `apptest.catspotters.com` moves to the new project at SYC-121's cutover (E.10).

Nothing in the gates depends on which Repl they run in:

- **No hostname anywhere.** The website cookie has no `Domain` (the `__Host-` rules forbid one), so it belongs to whichever https host set it: `apptest.catspotters.com` and the new project's `*.replit.app` address each get their own cookie. A tester logs in once per address. `__Host-` works on any https host, including `*.replit.app`.
- **No Replit settings are read.** The gates read only `PRELAUNCH_*`, `INTERNAL_PEOPLE_TOKEN`, `NODE_ENV`, `BASE_PATH` and `PORT`. The API's `NODE_ENV=production` comes from `artifacts/api-server/.replit-artifact/artifact.toml`, which is in the repo and so comes with the code to the new project. The website gate doesn't look at `NODE_ENV` at all.
- **The tester key isn't tied to a host.** A store build sends it to whatever address it was built for.
- **One shared assumption:** the wrong-password limit, like the API's rate limits, trusts the right-most `X-Forwarded-For` entry (one proxy hop). Still unverified for Replit, as DEPLOYMENT.md §C already notes.
- **The secrets must be set in the new project before its first publish.** A new project doesn't have the old one's deployment secrets. If they're missing, the gates fail closed (503), never open.

The done-checklist (plan §"Done" items 1–7, 10 and 11, plus the start-up log line) runs twice, and both sets are recorded on SYC-113: on the new project's `https://<name>.replit.app` address at SYC-121 C.7 and D.4 (without tester data first, then with the rehearsal copy), and on `https://apptest.catspotters.com` at SYC-121 E.11. Item 7's 200 case waits for SYC-83 (see SYC-121 C.7). Each time, also check that the browser keeps `__Host-cs_prelaunch` on that address after logging in (plan item 10a).

## When something looks wrong

- **The API answers `prelaunch_not_configured`.** A secret is missing from the deployment. Check the start-up log line, then the deployment secrets.
- **The website shows "isn't available right now".** `PRELAUNCH_WEB_PASSWORD` or `PRELAUNCH_SESSION_KEYS` is missing, or the session key is shorter than 32 bytes.
- **A tester's app says "Cat Spotters isn't open yet."** Their build has no key or an old one. Check which keys `PRELAUNCH_TESTER_KEYS` holds.
- **The login loops when testing locally on `http://localhost` in Safari.** Safari refuses `Secure` cookies over plain http. Use Chrome or Firefox locally; apptest is https.
- **"Too many tries. Please wait 15 minutes."** Ten wrong passwords from one address in 15 minutes. Waiting is the fix.
