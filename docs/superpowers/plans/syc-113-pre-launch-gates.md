# SYC-113: the pre-launch gates — implementation plan (awaiting Samuel's approval)

**Linear:** SYC-113 (Replit login wall). Unblocks SYC-83 (the sign-in Worker reaching the API) and the native half of SYC-32 (store builds reaching the API). Related: SYC-85 (the in-app document password, unaffected), SYC-92 (device secret), SYC-65 / SYC-106 (CORS and rate limits), SYC-98 (photo ids, PR #24), SYC-102 (hosting, owned by another session).
**Research:** PR #25, `docs/research/syc-113-replit-login-wall.md`.
**Status:** plan only. Nothing here is built, published or configured yet.

## Samuel's decision (29 Sep 2026, recorded on PR #25)

Switch the Replit deployment (`apptest.catspotters.com`, autoscale, one Repl) from "Password protected" to **Public**, and replace Replit's wall with two gates we own until launch:

1. **Website pages:** a password checked on the server in `artifacts/cat-spotter/server/serve-web.js`, remembered by a session cookie with a sensible expiry. No check that only runs in the browser.
2. **API pre-launch pass:** every `/api/*` request must carry one of (a) the website session cookie, (b) a tester key built into the TestFlight and Play test builds, or (c) the sign-in Worker's own secret, on `/api/internal/*`. `/api/healthz` stays open, because Replit's startup health check uses it.
3. **One switch** (an environment variable) takes both off on launch day. Location blurring (data spine PRs 5 and 6) must be live first.

His condition: "so long as it definitely works." This plan is built around proving that.

## In plain English

- **Testers on the website** see a simple Cat Spotters password page the first time they visit. They type the shared password once and then use the site normally for 14 days on that browser. Everyone else sees only the password page.
- **Testers on the phone** (TestFlight and the Play closed test) notice nothing at all. Their app build carries a tester key, and sends it with every request and every photo it loads.
- **Staff signing in** through `admin.catspotters.com` notice nothing. The sign-in page's private question to the app carries its own secret, which counts as a pass.
- **Anyone else** who finds the address, a search engine, or a script gets the password page for the website and a plain "not open yet" refusal from the API. Exact cat locations, photos and sighting data stay private until launch, as they are behind Replit's wall today.
- **Replit's health check** still gets through, so the deployment starts.
- **On launch day** one setting, `PRELAUNCH_GATE=off`, turns both gates off in one publish. The API refuses to honour it until location blurring has shipped, so it can't be switched off too early by mistake.
- **"Definitely works"** is proved three ways: tests that fail if any gate is loosened (we break each gate on purpose and watch the tests catch it); a test that fails if any app screen talks to the API without going through the one place that adds the pass; and a live checklist, including a real TestFlight and Play build, run after the publish.

## What this protects against, and what it doesn't

It keeps the pre-launch build and its data away from the public, search engines and casual discovery. It does not stop a determined tester: the tester key is inside the app, and anyone who unpacks the app could find it. That is acceptable, because a tester can already see everything the app shows. The real protections stay where they are: the device secret (SYC-92) for a device's own data, staff sign-in (SYC-43) for the dashboard, and blurring (data spine) for locations after launch. The pass is a front door, not a safe.

## How the pieces fit

```
                 apptest.catspotters.com  (one Replit deployment, now Public)
                               |
         +---------------------+----------------------+
         | paths not /api                             | /api/*
         v                                            v
  serve-web.js  (website)                    api-server (Express)
  - /status, /_gate/*, /robots.txt open      - CORS answers preflights first
  - everything else needs the                - then the pre-launch pass:
    session cookie, else the                   GET/HEAD /api/healthz   -> open
    password page                              /api/internal/*         -> Worker secret only
  - sets __Host-cs_prelaunch                   everything else         -> session cookie
    after the right password                                              OR tester key
                                             - then body parsing, rate limits,
                                               device secret, routes (unchanged)
```

Both processes read the same settings, so they agree on who holds a pass:

| Setting | Where it's set | What it is |
|---|---|---|
| `PRELAUNCH_GATE` | Replit deployment (both services) | `on` or `off`. **Unset means on in production**, so a missing setting can never open the doors. Any other value also means on, with a loud log line. |
| `PRELAUNCH_WEB_PASSWORD` | Replit deployment secret | The shared website password. A long passphrase. |
| `PRELAUNCH_SESSION_KEYS` | Replit deployment secret | One or two random 32-byte keys (comma-separated, base64url) that sign the website cookie. Two only during a change: new cookies use the first, either is accepted. |
| `PRELAUNCH_TESTER_KEYS` | Replit deployment secret | One or two tester keys (comma-separated) the API accepts. Two only while an old build is being replaced. |
| `EXPO_PUBLIC_PRELAUNCH_KEY` | **EAS build environment only**, never Replit | The tester key baked into store builds. |
| `INTERNAL_PEOPLE_TOKEN` | Replit deployment secret and Worker secret | Already planned by PR #20. Reused here as the Worker's pass; no new secret. |

If the gate is on but a setting it needs is missing, it **fails closed**: the website shows "Cat Spotters isn't available right now" (503) and the API refuses everything except `/api/healthz` with 503 `{"error":"prelaunch_not_configured"}`. Both processes log one line at start-up saying whether the gate is on and which settings are present (never their values).

## What gets built

Each numbered item is its own commit, in this order.

### 1. The website gate — `artifacts/cat-spotter/server/serve-web.js`

- **Refactor for testing first** (no behaviour change): move the request handler into `createHandler(env)` and export it; only call `listen` and the "no dist" exit when the file is run directly (`require.main === module`). The existing behaviour is pinned by a short test before the gate goes in.
- **New file `server/prelaunch.js`** (Node built-ins only, like `serve-web.js`): `gateEnabled(env)`, `signSession(keys, now)`, `verifySession(keys, cookieHeader, now)`, `checkPassword(env, supplied)`.
  - Cookie `__Host-cs_prelaunch`: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, `Max-Age` 14 days. Value `v1.<expiry>.<HMAC-SHA256(expiry)>`, base64url. No expiry means refused. Every cookie with that name is tried (the PR #20 rule). Comparisons are constant-time.
  - Password check: SHA-256 both sides, `timingSafeEqual`.
- **Order of checks in the handler**, when the gate is on:
  1. Bad percent-encoding → 400 (unchanged).
  2. `/status` → 200 (unchanged; Replit's dev preview uses it).
  3. `/api/*` → JSON 404 (unchanged).
  4. `/robots.txt` → `Disallow: /` while the gate is on.
  5. `GET /_gate/login` → the password page. `POST /_gate/login` → check the password; right → set the cookie and `303` to `next`; wrong → the same page again with "That password isn't right", status 401. `POST /_gate/logout` → clear the cookie, `303` to `/`.
  6. Valid cookie → serve the site exactly as today.
  7. No valid cookie → **a page request** (no file extension) gets the password page with **status 200** (see "Replit's own health check" below) and `Cache-Control: no-store`; **a file request** (`/_expo/…`, `/assets/…`, `.js`, `.png`) gets 401 plain text. The site's own code and images are not served to people without the password.
- **`next` is checked**: only a path starting with a single `/` and not `//` or `/\` is followed; anything else goes to `/`. This stops the login page being used to bounce people to another site.
- **The login form's body is capped at 4 KB**; anything bigger gets 413 without being read further.
- **Password guessing is slowed**: 10 wrong attempts per address per 15 minutes, then 429 with "Too many tries. Please wait 15 minutes." Counted in memory per instance (autoscale may run several, which only makes the limit a little looser). The address is the right-most `X-Forwarded-For` entry, matching the API's "one proxy" assumption.
- **Every response while the gate is on** carries `X-Robots-Tag: noindex, nofollow`.
- **The password page** is one self-contained HTML string (inline CSS, no scripts, no external files), in English and Greek, with the Cat Spotters name, one password field, and one line: "Cat Spotters is being tested before launch. If you're a tester, the password is in your invite." It works at 390 px and desktop widths.
- When the gate is off, the handler behaves byte-for-byte as today, and `/_gate/*` returns 404.

### 2. The API pass — `artifacts/api-server/src/middlewares/prelaunchGate.ts`

- **New `lib/prelaunch.ts`**: `gateEnabled()` (**on unless `NODE_ENV` is exactly `development` or `test`**, so an unset or unexpected `NODE_ENV` in production can't open the API while the website stays shut; in development or test it's off unless `PRELAUNCH_GATE=on`; `PRELAUNCH_GATE=off` is honoured only as item 3 allows), `verifySession()` (the same cookie format as item 1), `matchTesterKey()`, `matchInternalToken()`. **Settings are read on every request**, following the `OWNER_SECRET` and PR #20 precedent, so tests can flip them and a removed secret takes effect at once.
- **The middleware, in order:**
  1. Gate off → `next()`.
  2. `GET` or `HEAD` on exactly `/api/healthz` → `next()`. Nothing else is open.
  3. The path is classified **after** percent-decoding, lower-casing (Express matches routes case-insensitively) and collapsing repeated slashes, so `/API/Internal/…`, `/api/%69nternal/…` and `/api//internal/…` are all treated as internal. If decoding fails → 400. Path (so normalised) starts with `/api/internal/` or is `/api/internal` → only `Authorization: Bearer <INTERNAL_PEOPLE_TOKEN>` counts. The website cookie and the tester key do **not**. If `INTERNAL_PEOPLE_TOKEN` isn't set → 503 `{"error":"not_configured"}`, matching PR #20's own behaviour so its probes (200 / 401 / 503) still read the same. PR #20's route checks the token again itself; the two checks share one helper, `lib/internalAuth.ts`, created by whichever of the two PRs lands first.
  4. Anything else → a valid `__Host-cs_prelaunch` cookie **or** an `X-Prelaunch-Key` header matching one of `PRELAUNCH_TESTER_KEYS`.
  5. No pass → **401** `{"error":"prelaunch_pass_required","message":"Cat Spotters isn't open yet."}`. Missing and wrong look identical. The response carries `Cache-Control: no-store`.
- **Where it goes in `app.ts`:** after `pino-http` and the CORS switch, **before** `express.json`. So:
  - A browser's CORS preflight (`OPTIONS`) is answered by `cors` before the gate. Preflights never carry cookies or custom headers, so gating them would break any cross-origin caller; answering them reveals nothing.
  - The 401 still carries CORS headers, so a caller's code can read the refusal instead of seeing a network error.
  - A request without a pass is refused before a 25 MB body is parsed.
- **The key is only ever read from a header**, never a query string, so it never lands in logs or browser history. The `pino-http` serialiser already logs only method, id and a cleaned URL; a test pins that the key and cookie never appear in a log line.
- **Start-up line:** `prelaunch gate: on (session keys: 1, tester keys: 1, internal token: yes)`.

### 3. The launch interlock — `artifacts/api-server/src/lib/launchReadiness.ts`

- `export const LOCATION_BLURRING_LIVE = false;` with a comment pointing at data spine PR 6, which flips it to `true` in the same commit that turns blurring on.
- `gateEnabled()` honours `PRELAUNCH_GATE=off` in production **only if** `LOCATION_BLURRING_LIVE` is true. Otherwise the gate stays on and logs `prelaunch gate: "off" requested but location blurring is not live; gate stays ON`. This turns "blurring first" from a checklist line into something the code enforces.
- The website gate (item 1) doesn't know about blurring. If the switch is flipped too early, the website opens but every API call still gets 401, so the site visibly doesn't work and nothing leaks. The launch probes catch it straight away.

### 4. Photos aren't stored by shared caches while the gate is on — `routes/photos.ts`

Photos are served with `Cache-Control: public, max-age=31536000, immutable`. With the gate on, a cache between us and the phone could keep a photo fetched with a pass and hand it to someone without one. While the gate is on, the photo route sends `private` instead of `public` (still a year, still immutable), plus `Vary: Cookie, X-Prelaunch-Key`. At launch it goes back to `public` automatically. **SYC-98 (PR #24) rewrites this route**; whichever lands second carries the change across.

### 5. The app sends the tester key — `lib/api-client-react` and `artifacts/cat-spotter`

- **`lib/api-client-react/src/custom-fetch.ts`**: add `setPrelaunchKey(key: string | null)`. When set and no `x-prelaunch-key` header is present, `customFetch` adds it. Exported from `src/index.ts`. Every generated call (67 in `generated/api.ts`, all through `customFetch`) gets it with no other change.
- **`artifacts/cat-spotter/lib/prelaunch.ts`** (new): `prelaunchKey()` returns `process.env.EXPO_PUBLIC_PRELAUNCH_KEY` trimmed, or `null` on web (the website uses the cookie) or when empty.
- **`app/_layout.tsx:30`**: next to `setBaseUrl(apiOrigin())`, add `setPrelaunchKey(prelaunchKey())`. This runs when the file loads, before any screen mounts, so the offline queue's first flush and the first push-token registration already carry the key. (The device secret is set later, asynchronously, in `DeviceContext.tsx:84`; the tester key must not wait for that.)
- **Photos**: `lib/urls.ts` gets `photoSource(path)`, returning `{ uri: absoluteUrl(path), headers: { 'X-Prelaunch-Key': key } }` on native when a key is set, and `{ uri }` otherwise. `expo-image` sends `source.headers` on iOS and Android (checked in `expo-image` 3.0.11's `Image.types.d.ts`). On web, headers are left off on purpose: `expo-image` on web would switch to a script fetch that needs CORS, and the browser already sends the cookie with a plain same-origin image load. The five photo call sites switch to it (listed in the inventory). `AppMap`'s marker type changes from `imageUrl?: string` to `image?: ImageSource`.
- **A clear message for a build without a key**: when the API answers `prelaunch_pass_required`, `ApiError.message` already carries "Cat Spotters isn't open yet." (`buildErrorMessage` reads `message`), so screens that show errors say that rather than a generic failure. No new screen.

### 6. The tester key can't leak into the public website

`EXPO_PUBLIC_*` values are written into the JavaScript at build time. If `EXPO_PUBLIC_PRELAUNCH_KEY` were set on Replit, the web build would publish the key inside the website's own code.

- **`artifacts/cat-spotter/scripts/check-web-env.js`** (new), run by `build:web` **before and after** the export:
  - Before: if `EXPO_PUBLIC_PRELAUNCH_KEY` is set in the environment **or in any `.env*` file** in `artifacts/cat-spotter` (Expo reads those files itself, so checking only the environment would miss them), it stops the build with "The tester key must only be set in EAS store builds, never for the website."
  - After: it searches every file in `dist/` for each value in `PRELAUNCH_TESTER_KEYS` (present on Replit as a deployment secret) and fails the build if any is found. This catches the key arriving by a route nobody thought of.
  - Either way the publish fails loudly instead of leaking.
- The key is set only in EAS (`eas env` for the `preview` and `production` profiles SYC-32 creates). If SYC-32 uses Replit's "Expo Launch" wizard for iOS instead, the key would have to be a Replit secret, which this check refuses. That is deliberate: SYC-32 must use EAS for the key, or a separate Repl. Flagged to SYC-32.
- Live probe (checklist item 9) searches the served website bundle for the key.

### 7. Everyday tools that call the API

- `artifacts/api-server/scripts/security-check.mjs`: send `X-Prelaunch-Key` from a `PRELAUNCH_KEY` environment variable when set, so it can still be pointed at the test deployment.
- `docs/DEPLOYMENT.md` §C and `docs/runbooks/`: a short "Pre-launch gate" section (settings, how to rotate the password and the tester key, how to turn it off). Anyone calling `POST /api/cats/:id/updates` with `OWNER_SECRET` by hand adds the tester key header too.

## The caller inventory

Every way something reaches `/api` today or is planned to. The **risk** column is what happens if that path doesn't carry a pass.

### The app (iOS, Android and web share this code)

All generated calls go through `customFetch` (`lib/api-client-react/src/custom-fetch.ts`, the `fetch` at the end of `customFetch`). There is **no other `fetch(` to our API anywhere in the app**; the only other `fetch` calls are in `scripts/build.js` (the Expo Go build tool, talking to the local Metro server) and `FileSystem.downloadAsync` in `lib/offlineTiles.ts:124` (map tiles from `tile.openstreetmap.org`, not us).

| # | Where | What | How it gets the pass |
|---|---|---|---|
| 1 | `app/_layout.tsx:30` | `setBaseUrl(apiOrigin())`, every call's address | Item 5 adds `setPrelaunchKey` beside it |
| 2 | `context/OfflineContext.tsx:349` | Offline queue sends a saved sighting (photo upload, base64 JSON) | `customFetch` |
| 3 | `app/(tabs)/spot.tsx:440` | Live sighting upload | `customFetch` |
| 4 | `app/review.tsx:111`, `:124` | Confirm or reject a match (`resolveSighting`) | `customFetch` |
| 5 | `app/review.tsx:144` | Name suggestions (`suggestCatNames`) | `customFetch` |
| 6 | `context/NotificationContext.tsx:96` | **Push-token registration** (`useRegisterPushToken`) | `customFetch` |
| 7 | `context/NotificationContext.tsx:155`, `:163`, `:175` | Notification list, mark all read, mark one read | `customFetch` |
| 8 | `context/NotificationContext.tsx:40` | `getCat` when a notification is tapped | `customFetch` |
| 9 | `context/DeviceContext.tsx:119` | `getProfile` at start-up | `customFetch` |
| 10 | `app/(tabs)/index.tsx:49`, `app/(tabs)/cats.tsx:65`, `app/(tabs)/profile.tsx:45` | Profile | `customFetch` |
| 11 | `app/(tabs)/profile.tsx:51` | Leaderboard | `customFetch` |
| 12 | `app/cat/[id].tsx:78` | Cat page | `customFetch` |
| 13 | `app/(tabs)/help.tsx:61` | Campaign | `customFetch` |
| 14 | `components/ClaimCatSheet.tsx:83`, `:84` | Claim a cat, rename | `customFetch` |
| 15 | `components/UsernameEditor.tsx:60`, `:69` | Username availability | `customFetch` |
| 16 | `components/onboarding/LanguageUsernameStep.tsx:71`, `:88`, `:98`, `:108` | Onboarding: claimed name, availability, suggestions | `customFetch` |
| 17 | `lib/usernameClaim.ts:58` | Claim a username | `customFetch` |
| 18 | `components/OwnershipNoticeBanner.tsx:48`, `hooks/useCatsWithCache.ts:23` | Cat list (the map and list screens) | `customFetch` |
| 19 | `app/cat/[id].tsx:129` | **Photo:** cat's main photo, `expo-image` | Item 5: `photoSource` |
| 20 | `app/cat/[id].tsx:345` | **Photo:** each sighting on the cat page | `photoSource` |
| 21 | `components/CatCard.tsx:36` | **Photo:** list card | `photoSource` |
| 22 | `app/review.tsx:448` | **Photo:** match candidates | `photoSource` |
| 23 | `app/(tabs)/cats.tsx:220` → `components/AppMap.tsx:69` and `components/AppMap.web.tsx:62` | **Photo:** map marker | `photoSource` |

Not callers: `components/SightingPhoto.tsx:41` and `app/(tabs)/spot.tsx:783` show the phone's own photo (a local file or `idb:` reference). `components/purropolis/Avatar.tsx:44` is never given an API address today. `app/(tabs)/help.tsx:92` opens the external donation page.

**On web**, rows 1–18 are same-origin `fetch` calls, which send the cookie by default (`customFetch` doesn't change `credentials`), and rows 19–23 are same-origin image loads, which also send it.

### Outside the app

| # | Caller | Path | Pass |
|---|---|---|---|
| 24 | Replit's start-up health check (`artifacts/api-server/.replit-artifact/artifact.toml`, `[services.production.health.startup]`) | `GET /api/healthz` | None needed: exempt |
| 25 | The sign-in Worker (SYC-83, PR #20 plan §4) | `POST /api/internal/people/allowed` | `Authorization: Bearer INTERNAL_PEOPLE_TOKEN` |
| 26 | **The staff dashboard hand-off and session (PR #20 plan §5, `team.catspotters.com/api/team/*`)** | `POST /api/team/handoff` from a form on `admin.catspotters.com`, then dashboard pages under `/api/team/` | **None of the three.** See Decision 1. |
| 27 | Owner updates by hand (`OWNER_SECRET`, `routes/notifications.ts`) | `POST /api/cats/:id/updates` | The operator adds the tester key header (item 7) |
| 28 | `artifacts/api-server/scripts/security-check.mjs` | Various | `PRELAUNCH_KEY` variable (item 7) |
| 29 | Push notifications | None: our server calls Expo's push service outward (`lib/push.ts`) | Not affected |

### Risky paths, and how each is closed

- **Photos on native (19–23).** Image loads don't go through `customFetch`. Without item 5, every photo in the store builds would be blank. Closed by `photoSource` and by a guard test (below) that fails if any file builds an image source from `absoluteUrl` directly.
- **Photo redirects on native.** SYC-98 (PR #24) redirects old photo ids to new ones for one release. iOS and Android keep custom headers when following a redirect to the same host, but that is the phone's HTTP library's behaviour, not ours, so it is checked on a real build (checklist 10b), not assumed.
- **A new screen that calls the API some other way.** Closed by a guard test that fails if app code contains `fetch(`, `XMLHttpRequest`, `axios` or `FileSystem.uploadAsync` outside an allow-list (`lib/offlineTiles.ts`, `scripts/`).
- **The offline queue flushing before the key is set.** Closed by setting the key when `_layout.tsx` loads, not inside a provider. A test imports the layout module and checks the key is set before any provider mounts.
- **A store build made without the key.** Every call fails with "Cat Spotters isn't open yet." Closed by the end-to-end check on a real build (checklist items 7–8) before testers are invited.
- **The dashboard (26).** Needs a decision (below).

## Replit's own health check on the website

The API's start-up health check is declared (`/api/healthz`). The website service (`artifacts/cat-spotter/.replit-artifact/artifact.toml`) declares none, and Replit's docs don't say for certain whether it probes `/` on an autoscale deployment. So the gate is built to pass either way: **a page request with no cookie gets the password page with status 200**, never a redirect or a 401. If Replit probes `/`, it sees a healthy 200. This is checked in the probes and costs nothing.

## How this fits with what's already there

- **CORS (SYC-65 / SYC-106).** The gate runs after the CORS switch in `app.ts`, so the `/api/photos/` allowlist and the wildcard elsewhere keep working exactly as today, preflights are answered before the gate, and refusals are readable. PR #20 adds "no CORS on `/api/internal/` and `/api/team/`"; the gate doesn't change that. The website cookie is never usable cross-origin, because no route sends `Access-Control-Allow-Credentials`.
- **Rate limits.** `aiLimiter` and `photoLimiter` are attached per route, so they run after the gate: a request with no pass is refused without using up anyone's budget. The one new limit is on wrong website passwords (item 1). Both share the unverified "one proxy hop" assumption already noted in `middlewares/rateLimit.ts`.
- **The device secret (SYC-92).** Unchanged. The pass says "this is a tester", the device secret says "this is your phone". A request needs both where both apply. `customFetch` adds both headers independently.
- **The Worker (PR #20).** Its secret is reused, not duplicated. Its fail-closed rule (anything but a JSON 200 is "unavailable") already covers a gate refusal.
- **The document password (SYC-85).** Separate, in-app, unaffected.
- **SYC-98 (PR #24).** Touches `routes/photos.ts`; see item 4.

## Development and Expo Go keep working

- **Replit workspace (dev).** The API runs with `NODE_ENV=development`, so the gate is off. The website in dev is served by Expo's own dev server, not `serve-web.js`, so it's never gated. Replit's dev address is private to the workspace already.
- **Expo Go on a phone** (the `scripts/build.js` / `server/serve.js` demo pipeline) bundles against the dev domain, where the gate is off.
- **Local development** (`EXPO_PUBLIC_API_URL=http://localhost:3001`): the gate is off unless someone sets `PRELAUNCH_GATE=on` to try it. `serve-web.js` run by hand is gated by default (it's the production server); set `PRELAUNCH_GATE=off` locally to skip it. To try the website gate on `http://localhost`, use Chrome or Firefox: Safari refuses `Secure` cookies over plain http, so the login would appear to loop there. That only affects local testing; apptest is https.
- **Tests.** Vitest runs with `NODE_ENV=test`: gate off unless a test turns it on. Existing tests are unaffected.
- **A native build pointed at the test deployment** (a dev client, or a local build with `EXPO_PUBLIC_API_URL=https://apptest.catspotters.com`) needs `EXPO_PUBLIC_PRELAUNCH_KEY` in its local environment.

## Tests

CI (Node 24, Linux) is the authority; SYC-31 means some suites can fail locally on macOS.

**Website (`artifacts/cat-spotter/server/serve-web.test.ts`, added to `vitest.config.ts`'s `include`)**, driving `createHandler` with a throwaway `dist` folder:

1. Gate off: `/`, `/cat/12`, a hashed bundle and `/status` answer exactly as today (pins the refactor).
2. Gate on, no cookie: `/` and `/cat/12` → 200 password page with `no-store`; `/_expo/static/js/x.js` → 401; `/status` → 200; `/robots.txt` → `Disallow: /`; every response has `X-Robots-Tag`.
3. Right password → 303 to `next`, and the cookie has `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, 14-day `Max-Age`. Then that cookie → the real page.
4. Wrong password → 401 page, no cookie. The eleventh wrong try from one address → 429.
5. `next` values `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:x` → all redirect to `/`.
6. Cookie refused when: tampered, signed with an unknown key, expired, no expiry, wrong version prefix. With two keys, a cookie signed by the second is accepted. Two cookies with the name, bad one first → the good one wins.
7. Gate on with `PRELAUNCH_WEB_PASSWORD` or `PRELAUNCH_SESSION_KEYS` missing → 503 for pages, and a right-looking password still gets no cookie.
8. `PRELAUNCH_GATE` unset → on. `PRELAUNCH_GATE=banana` → on.

**Shared cookie format (`lib/__fixtures__/prelaunch-cookie-vectors.json`)**: fixed key, expiry and expected cookie value. Both the website test and the API test check against the same file, so the two copies of the cookie code can't drift apart.

**API (`artifacts/api-server/src/middlewares/prelaunchGate.test.ts`)**, through `supertest` on the real `app`:

9. Gate on, no pass: `GET /api/cats`, `GET /api/photos/1`, `POST /api/sightings`, `POST /api/notifications/…`, `GET /api/campaign`, `/API/CATS` (upper case) → 401 with the exact body. `/API/Internal/people/allowed`, `/api/%69nternal/people/allowed` and `/api//internal/people/allowed` with a valid tester key → refused (treated as internal). The test walks **every route registered on the router** (read from Express's route stack), so a route added later is covered automatically.
10. `GET` and `HEAD /api/healthz` → 200 with no pass. `POST /api/healthz` and `/api/healthz-extra` → 401.
11. Valid website cookie → passes to the route. Valid tester key → passes. Second tester key during a change → passes. Wrong key, empty key, key in the query string → 401.
12. `/api/internal/people/allowed`: right bearer → passes; website cookie → 401; tester key → 401; no token configured → 503.
13. `OPTIONS` preflight with no pass → answered by CORS (204) with the allow headers, not 401. A 401 still carries `Access-Control-Allow-Origin`.
14. A 25 MB body with no pass → 401 without the JSON parser running (the parser is spied on).
15. `NODE_ENV=production`, `NODE_ENV` unset, and `NODE_ENV=staging` with `PRELAUNCH_GATE` unset → all on. `PRELAUNCH_GATE=off` with `LOCATION_BLURRING_LIVE=false` → **still on**, with the log line. `PRELAUNCH_GATE=off` with it `true` → off, and `/api/cats` answers without a pass.
16. With the gate on, a photo response says `Cache-Control: private` and `Vary` includes both pass headers; with it off, `public` as today.
17. Log lines captured during tests 11–12 never contain the key, the cookie value or the bearer token.

**App (`artifacts/cat-spotter/lib/__tests__/`)**:

18. `custom-fetch`: with `setPrelaunchKey('k')`, every generated call sends `X-Prelaunch-Key: k`; an explicit header wins; `null` sends none. (In `lib/api-client-react` or the app's suite, wherever `customFetch` is already tested.)
19. `photoSource`: native with a key → headers; web → no headers; no key → no headers.
20. **Guard: no stray callers.** Scans `app/`, `components/`, `context/`, `hooks/`, `lib/` for `fetch(`, `XMLHttpRequest`, `axios`, `uploadAsync` outside the allow-list, and for `uri: absoluteUrl(`. Any match fails with the file and line.
21. Importing `app/_layout.tsx` sets the key before any provider mounts.
22. `check-web-env.js` exits non-zero when `EXPO_PUBLIC_PRELAUNCH_KEY` is set in the environment, when it's only in a `.env.production` file, and (after-export mode) when a `PRELAUNCH_TESTER_KEYS` value appears anywhere in a `dist/` file.
23. A login body over 4 KB → 413.

### Deliberate-break checks (each must turn a test red)

The implementer makes each break on a scratch commit, runs the suite, records which test failed in the PR description, and reverts. A break that nothing catches is a missing test, added before merge.

| Break | Must fail |
|---|---|
| Accept any cookie value (skip the HMAC check) in `serve-web.js` | 6 |
| Serve files (`/_expo/…`) without a cookie | 2 |
| Treat `PRELAUNCH_GATE` unset as off | 8, 15 |
| Follow `next` without checking it | 5 |
| Remove the password rate limit | 4 |
| Make the API gate `next()` on any request that has *some* `X-Prelaunch-Key` | 11 |
| Exempt `/api/healthz` by prefix (`startsWith`) | 10 |
| Accept the tester key on `/api/internal/*` | 12 |
| Compare paths case-sensitively | 9 |
| Classify the path before percent-decoding | 9 |
| Treat an unset `NODE_ENV` as development | 15 |
| Check only `process.env`, not `.env` files, in `check-web-env.js` | 22 |
| Drop the after-export scan of `dist/` | 22 |
| Mount the gate before CORS | 13 |
| Mount the gate after `express.json` | 14 |
| Drop the `LOCATION_BLURRING_LIVE` check | 15 |
| Leave photos `public` while gated | 16 |
| Remove the header from `photoSource` | 19 |
| Add `fetch('/api/cats')` to a screen | 20 |
| Move `setPrelaunchKey` into `DeviceProvider` | 21 |
| Change one character of the cookie format in only one of the two copies | shared vectors |

## Rollout order

1. **Build now** (this plan, once approved), in its own worktree, one commit per item, behind the switch. Merging changes nothing live: the Replit deployment is still "Password protected", and nothing is pulled into the Repl until step 3.
2. **Prepare settings (Claude, with one paste each from Samuel).** Claude generates `PRELAUNCH_SESSION_KEYS`, one tester key and a passphrase in a terminal tab, never printed to chat or saved. Samuel pastes `PRELAUNCH_WEB_PASSWORD`, `PRELAUNCH_SESSION_KEYS` and `PRELAUNCH_TESTER_KEYS` into Replit's deployment secrets (they can't be set from here). The tester key also goes into EAS with `eas env:create` for the store build profiles (Claude can run this, since EAS is scriptable).
3. **The switch to Public is a publish, so it waits on SYC-102**, and ideally goes out in **the same publish as the EU-region move** the other session is proposing: changing who can access the deployment means unpublishing first (PR #25), so doing both in one go means one short outage, not two. The publish contains this code, `PRELAUNCH_GATE` left unset (so on), and the access setting changed to Public. **The code and the access change must go out together**: Public without the gate code would expose everything.
4. **Probe straight after the publish** (the checklist below). If any "must be refused" probe answers 200, set the deployment back to Password protected at once and investigate.
5. **Store builds.** SYC-32's first TestFlight and Play builds include `EXPO_PUBLIC_PRELAUNCH_KEY`. The end-to-end check (items 7–8) runs before testers are invited.
6. **Worker.** SYC-83 can then reach `/api/internal/people/allowed`; its own plan's probes run as written.

## "Done" checklist (live probes, recorded in the PR and SYC-113)

Run by Claude with `curl` unless marked; the tester key and password are read from the terminal tab's environment, never typed into chat.

| # | Probe | Expect |
|---|---|---|
| 1 | `curl -sS -D - https://apptest.catspotters.com/api/healthz` (no pass) | **200** `{"status":"ok"}`, and **no** `307` to `replit.com` |
| 2 | `GET /api/cats` with no pass | **401** `prelaunch_pass_required` |
| 3 | `GET /api/photos/<id>` with no pass | **401** |
| 4 | `GET /` with no cookie | **200** password page; `GET /_expo/static/js/web/…` → **401** |
| 5 | Log in with the password (`POST /_gate/login`), then `GET /api/cats` with the cookie | **200** with cats. In a real browser too: open the site, type the password, see cats with photos on the map, at 390 px and desktop |
| 6 | `GET /api/cats` with `X-Prelaunch-Key` | **200**. Same for a photo, and then the same photo **without** the key → **401** (proves no shared cache kept it) |
| 7 | `POST /api/internal/people/allowed` with the Worker's bearer | **200** JSON. With the tester key instead → **401**. With nothing → **401** |
| 8 | **Real TestFlight build** (Samuel, on his iPhone, about five minutes) | Cats list and map load with photos; spot a cat end to end; turn on airplane mode, spot one, turn it off, and watch the queue send it; a push notification arrives |
| 9 | **Real Play closed-test build** (Samuel or a tester on Android) | Same as 8 |
| 10 | Search the served website JavaScript for the tester key | Not found |
| 10a | In Safari and Chrome on a phone, after logging in: the browser's cookie list shows `__Host-cs_prelaunch` for apptest.catspotters.com (proves Replit's proxy passes `Set-Cookie` through untouched and the browser accepted the `__Host-` rules over HTTPS) | Present |
| 10b | In the TestFlight build, open a cat whose photo link uses an **old** photo id (SYC-98 redirects those for one release) | Photo shows: the key survives the redirect |
| 11 | `GET /robots.txt` | `Disallow: /` |
| 12 | Deployment logs | `prelaunch gate: on (session keys: 1, tester keys: 1, internal token: yes)` |

## Launch day: taking it off

Preconditions, checked from live sources (merged PR file lists and the live API), not from plans:

- Data spine PR 5 (closing the location oracle) and PR 6 (blurring) are **live in production**, and PR 6 has set `LOCATION_BLURRING_LIVE = true`.
- The launch build of the app is in the stores.

Steps:

1. Set `PRELAUNCH_GATE=off` in the Replit deployment settings and publish (Samuel, since publishing is his; Claude prepares it).
2. Probe: `/api/cats` with no pass → 200; a photo with no pass → 200 with `Cache-Control: public`; `/` → the real site; `/robots.txt` → the normal file; the log says `prelaunch gate: off`. If `/api/cats` still answers 401, the interlock held: blurring isn't marked live, so check PR 6 before anything else.
3. Leave the tester key in old test builds; it's simply ignored.
4. Later, in an ordinary PR (filed as a follow-up now): delete the gate code, `/_gate/*`, the four settings, `LOCATION_BLURRING_LIVE`, and the EAS variable, and remove the settings from Replit.

**Rolling back** at any point before launch: set the deployment back to Password protected (a publish), which puts Replit's wall in front again. Turning the gate off early is prevented by the interlock.

## Decisions for Samuel

**Decision 1 — The staff dashboard on `team.catspotters.com`.** PR #20's plan serves the dashboard from `/api/team/*`, reached by a form post from the sign-in page. Staff browsers there won't have the website password cookie, because that cookie belongs to `apptest.catspotters.com` only.

- **A. Recommended: let `/api/team/*` through the pre-launch pass, because it has its own, stronger door.** Every `/api/team/*` route already refuses anyone without a one-minute pass from the sign-in page or a staff session, checked against the people list on every request (PR #20 §5). *Benefit:* staff tap "Cat Spotters dashboard" and land in it. *Risk:* one more exemption in the gate. It is narrow, it is pinned by a test that walks every `/api/team/*` route with no staff session and expects 401, and PR #20 already calls a dashboard route without `requireTeam` a review failure.
- B. Staff also type the website password on `team.catspotters.com` first. *Risk:* an extra, confusing password step for staff, and the hand-off post from the sign-in page would bounce to a password page and lose the pass.
- C. Give the cookie `Domain=catspotters.com` so it covers both. *Risk:* the cookie would be sent to every `catspotters.com` site, including the proposals site and the Worker, and the `__Host-` protection is lost.

`/api/team/*` doesn't exist yet, so whichever lands second adds the exemption and its test.

**Decision 2 — How long the website remembers the password.** Recommended **14 days**: testers type it about twice a month; changing the key logs everyone out at once if the password leaks. 30 days (matching the staff session) means fewer prompts but a leaked cookie works longer.

**Decision 3 — The launch interlock (item 3).** Recommended **yes**: it makes "blurring first" impossible to skip by accident. *Risk:* on launch day, if PR 6 forgot to flip the flag, the switch appears not to work until someone reads the log line; the launch steps say exactly that.

## Model delegation

Per `~/.claude/skills/plan-model-delegation/SKILL.md`: cheapest adequate tier, escalations justified, each delegation with a named check.

| Work | Model | Why this tier | How it's checked |
|---|---|---|---|
| Item 1 `serve-web.js` refactor and the website gate | **Sonnet** | Clear spec, one file plus one helper, Node built-ins only | Tests 1–8, the shared vectors, and the website rows of the deliberate-break table |
| Item 2 API gate middleware and `app.ts` ordering | **Opus** | This is the security boundary; ordering against CORS and body parsing, case-insensitive routing and the internal exemption are easy to get subtly wrong | Tests 9–17 and every API row of the deliberate-break table |
| Item 3 interlock | **Haiku** | A constant and one condition | Test 15 and its break |
| Item 4 photo cache header | **Haiku** | One header behind one condition | Test 16 and its break |
| Item 5 client key, `photoSource`, five call sites, map marker type | **Sonnet** | Mechanical across several files, but must not miss a site | Tests 18–21, the guard test, typecheck, and screenshots at 390 px and desktop on web |
| Item 6 web-build guard | **Haiku** | A ten-line script | Test 22 and live probe 10 |
| Item 7 docs and `security-check.mjs` | **Haiku** | Text and one header | Spot review by the session model |
| Adversarial review of the built PR | **Sonnet**, own worktree | Independent critic, one worktree per reviewer (LIF-79) | It re-runs the deliberate breaks itself |
| Rollout steps 2–4, probes, launch-day steps | **Session model (Opus)** | Handles secrets and the live deployment | The done checklist |

The build happens in its own worktree off fresh `origin/main`, one commit per item, with a `CHECKPOINT.md` in the worktree root updated after each commit.

## Out of scope

- Publishing, changing the Replit access setting, or any DNS or Cloudflare change (rollout steps, not this PR).
- SYC-102's database and region move.
- The Worker's own changes (SYC-83, SYC-103).
- Replacing the wildcard `cors()` (its own ticket, per PR #20 §8.2).
- Migrations: none.

## Review

*To be filled in after the adversarial review.*
