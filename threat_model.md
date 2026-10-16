# Threat Model

## Project Overview

Syros Cat Spotter is an Expo (React Native) mobile app backed by an Express API server and PostgreSQL database. Tourists and residents photograph street cats on Syros, Greece; an AI vision model (OpenAI via Replit proxy) matches photos against known cats. The app is fully anonymous — identity is a per-device UUID with no accounts or passwords. Gamification awards points and badges per sighting. The app is not yet deployed to production (deployment info shows `isDeployed: false`).

Tech stack: Expo (iOS/Android/Web), Express, Drizzle ORM, PostgreSQL, OpenAI Vision, Expo Push Notifications.

## Assets

- **Photo data** — base64-encoded cat photos stored in Postgres. Submitted by any anonymous user; publicly accessible by sequential integer ID.
- **Device IDs** — the sole authentication credential. A UUID stored on-device; whoever holds it can act as that spotter.
- **Spotter profiles** — nickname, username, points, badges. Tied to a device ID.
- **Push tokens** — Expo push tokens allowing delivery of notifications to specific devices.
- **OpenAI API credits** — AI matching and name suggestion calls consume paid API quota.
- **Cat registry** — cat names, locations, descriptions, owner info. Public read, write-gated on deviceId.

## Trust Boundaries

- **Mobile app / API** — all requests cross this boundary unauthenticated. The sole credential is the device ID supplied in request bodies and path parameters. No session token, JWT, or API key is validated for regular user actions.
- **API / PostgreSQL** — Drizzle ORM with parameterized queries; no raw SQL interpolation of user input observed.
- **API / OpenAI** — server-side calls using Replit AI Integration proxy. No user-supplied prompt injection path (prompt is server-authored; only photos are user-controlled).
- **Admin / owner endpoint** — `POST /api/cats/:catId/updates` requires `Bearer OWNER_SECRET` header. Only this one endpoint has real authentication.
- **Public / per-device** — profile, notification, and sighting resolution endpoints are scoped to a deviceId, but that deviceId is not cryptographically verified; knowledge of it is sufficient to impersonate.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/routes/` (all routes mounted under `/api`)
- Highest-risk areas: `sightings.ts` (AI calls + points), `notifications.ts` (push tokens), `profiles.ts` (username claims)
- Admin surface: `POST /api/cats/:catId/updates` protected by `OWNER_SECRET`; all other routes are public/deviceId-scoped
- Dev-only: `artifacts/mockup-sandbox/` (design canvas, not production-reachable); `artifacts/cat-spotter/server/serve.js` (static file server for Expo web build)
- No deployment active; no live production exposure confirmed at scan time

## Threat Categories

### Spoofing

The device UUID is the only credential. It is transmitted in plain request bodies and path parameters. Any party that observes or guesses a device ID can impersonate that spotter — reading their notifications, overwriting their nickname/username, registering their push token, and resolving sightings on their behalf. This is an accepted design trade-off for anonymous operation, but the blast radius is real: push-token registration in particular allows a third party to silently redirect a victim's notifications.

The `OWNER_SECRET` environment variable guards the one privileged endpoint; if unset, the endpoint returns 503 (safe fail).

### Tampering

No rate limiting or authentication guards the two AI-backed write endpoints (`POST /sightings`, `POST /cats/name-suggestions`). An attacker can flood these to exhaust paid API quota. Cat name creation and renaming (`POST /cats`, `POST /sightings/:id/resolve`, `PATCH /cats/:catId`) now apply the same offensive-language filter used for nicknames and usernames, rejecting offensive names with `400 OFFENSIVE_NAME`.

### Information Disclosure

**Outbound Open map links (D9, 15 Oct 2026; SYC-395).** A position goes to Google only when an island-wide team member taps "Open map" on a dashboard position. This never happens for cat guardians, for owners' homes, or for the public.
- The link is built only by `lib/teamPages/position.ts`, behind `isIslandWide(person)`.
- `positions.source.test.ts` fails if any other page or route names a map company or prints a position itself.
- `position.guard.source.test.ts` limits which files may import the builder.
- The guardian-view tests fail if a guardian's page carries a map company's address.
- This reverses SYC-245 / SYC-255 Decision 2B and plan rule K13 for outbound links only. No position ever appears in one of our own addresses.

Photos are stored by sequential integer ID and served without access control; any caller can enumerate all uploaded cat photos via `GET /api/photos/:n`. Notification feeds are readable by anyone who knows a device ID (`GET /api/notifications/:deviceId`). The leaderboard exposes `spotterCode` (a short hash of deviceId) rather than raw deviceIds — appropriate. Raw device IDs are never returned in list responses.

### Denial of Service

No rate limiting exists anywhere in the API. `POST /sightings` accepts up to 25 MB JSON bodies (base64 photos), performs image decoding, database writes, and an OpenAI multi-image vision call per request. `POST /cats/name-suggestions` also calls OpenAI. Both are unauthenticated. Sustained abuse could exhaust API credits and degrade service.

### Elevation of Privilege

No privilege escalation paths identified. The only admin endpoint (`POST /cats/:catId/updates`) is bearer-token protected. Regular users cannot reach admin functions.
