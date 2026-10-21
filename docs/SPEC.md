# Purropolis / Syros Cat Spotter — Product Specification

**Status:** Reverse-engineered from the shipped codebase (as built by Replit), 27 July 2026.
**Purpose:** This document did not exist before the app was built. It is written *backwards* from working code so that there is a single agreed description of what the product currently does — a baseline to review, correct, and then extend.

Everything in Sections 1–9 describes **behaviour that exists today**. Section 10 lists gaps and open questions. Nothing here is a proposal.

---

## 1. What the product is

A mobile app (iOS, Android, and a web build) that turns the street cats of Syros, Greece into a collectible, shared catalogue.

A person photographs a cat. An AI vision model compares that photo against cats already known nearby and answers *"have we met this cat before?"*. The person confirms a match or names a brand-new cat. Points and badges accrue. Cat lovers get notified when a cat they've met is seen again, gets desexed, or finds a home.

Three things make it more than a photo app:

1. **It is a census.** Every sighting is a dated, located, photographed record of an individual cat. That is exactly the data a colony-management charity needs and rarely has.
2. **It works with no signal.** Syros has patchy coverage and the app's users are frequently walking hills with none. Photos, locations and map tiles all work offline; the queue syncs later.
3. **It is anonymous.** No accounts, no email, no password. Identity is a per-device credential created silently on first launch.

### Positioning statement

> For visitors and residents of Syros who notice the island's street cats, Purropolis is a pocket field guide that identifies individual cats by sight, remembers who you've met, and channels that attention into the charity caring for them.

### Design identity — "Purropolis"

Sun-bleached Cycladic look: Aegean blue primary, whitewash and stone neutrals, bougainvillea / sun / terracotta / olive accents. Poppins (display), Nunito (body), Space Mono (IDs), all with Greek subsets. The wordmark is set in type — 🐾 Purr·opolis, with "opolis" in bougainvillea — there is no logo image.

Tokens live in `artifacts/cat-spotter/constants/colors.ts` and `constants/theme.ts` (mobile) and `artifacts/mockup-sandbox/src/theme/purropolis/` (web canvas). Twelve shared components: Button, IconButton, Tag, Badge, Input, Switch, Card, CatCard, StatTile, ProgressBar, Avatar, TabBar.

---

## 2. Who it is for

| Persona | What they want | How the app serves them today |
|---|---|---|
| **Tourist / visitor** (primary volume) | A fun thing to do while walking; a souvenir of "my" cats | Spot flow, collection grid, badges, streaks, leaderboard |
| **Resident cat feeder** | Recognition that a cat is *theirs*; correct information shown about it | Cat claiming, owner-only rename + home description, "has a home" notice |
| **Syros Cats staff & volunteers** (the charity) | Which cats exist, where, whether they're desexed, and donations | Care timeline, broadcast updates (owner-token endpoint), Help/campaign tab |
| **Repeat visitor / returning local** | To pick up where they left off | Server-side profile keyed to the device credential; owned-cat list re-hydrates |

**Note:** the charity's own needs are currently served by a single admin API endpoint with a shared bearer secret — there is no staff-facing interface. See §10.

---

## 3. Identity and onboarding

### 3.1 Anonymous device identity

There are no accounts. On first launch the app generates and stores two values locally:

- **`deviceId`** — e.g. `dev-<base36 time><random>`. Travels in request paths and bodies. **Not a secret.**
- **`deviceSecret`** — e.g. `sec-<time>-<32 random chars>`. Sent only in the `X-Device-Secret` header. **Never displayed, never in a URL or body.**

The server binds the SHA-256 hash of the secret to the device id on first authenticated use (**trust on first use**) and requires a match forever after. Device ids are unguessable, so someone who later observes one in traffic cannot bind or replace its credential.

This is what protects the private profile view: the profile payload includes a list of every cat the device has visited, which is closer to a location history than to a score. A path parameter alone could not authorise that.

**Public identity** is a `spotterCode` — the first four hex characters of `sha256(deviceId)`, uppercased. Raw device ids never appear in any public payload (leaderboard, cat credits, sighting lists).

### 3.2 Onboarding (three steps, one time)

The app is gated until a username has been claimed.

1. **Welcome** — brand introduction; "made with…" credit; a restore-account note.
2. **How it works** — four points: spot a cat, it joins the cat-alog, don't feed them, here's how to help. Includes the location-permission explanation and an "allow and continue" action. Skippable.
3. **Language + username** — language picker (English / Ελληνικά / Français) and a unique username, with live availability checking, a shuffle button for AI-free suggestions, and inline states for too-short / invalid / taken / offline.

Claiming the username is what unlocks the app. It is stored locally and on the server profile.

### 3.3 Language

Three languages: **English (en), Greek (el), French (fr)**. Chosen at onboarding, changeable in Profile, persisted to local storage. Roughly 250 translation keys cover the entire UI. AI-generated cat name suggestions are requested in the active language.

---

## 4. Core loop — spotting a cat

This is the heart of the product. Five stages.

### 4.1 Capture

- Take a photo, or choose one from the library.
- Photos are uploaded **as captured** — including iPhone HEIC — because the server normalises formats itself. Only assets over ~15 MB (or which the picker couldn't hand back as base64) are shrunk on-device to 900 px / JPEG 0.7 first.
- A **capture timestamp** is stamped the moment the photo is picked, not when it is submitted. Submitting can happen minutes later and across local midnight; using submit time would file the sighting on the wrong day and corrupt the user's streak.

### 4.2 Confirm the location

Submitting requires confirming the spot on a pan-to-pick map with a fixed centre pin, initialised from GPS. On web, where the map is an OpenStreetMap iframe, nudge arrows stand in for panning.

The confirmed coordinates — not the raw GPS fix — are what get submitted, online or queued.

### 4.3 Match

The server:

1. Validates and normalises the image (§8.3).
2. Stores the photo and creates a `pending` sighting, dated with the clamped capture time.
3. Finds the **10 nearest known cats** by great-circle distance. Matching against cats seen nearby is both cheaper and more accurate than comparing against the whole island.
4. Sends the new photo plus those candidates' primary photos to the vision model (`gpt-5.6-terra` via the Replit OpenAI proxy) and asks two questions: *is there a cat in this photo at all*, and *for each known cat, what is the 0–1 likelihood it is the same individual*.
5. Returns the top 3 candidates with confidence ≥ 0.1, each with a one-sentence reason.

**If the AI call fails, the sighting still exists** and the user is simply shown no candidates — a model outage degrades the experience, it never loses a photo.

### 4.4 Review and resolve

The Review screen shows the user's photo alongside candidates. Confidence is banded for display: ≥ 0.75 reads as a strong match, ≥ 0.4 as a possible one, below that as a long shot. Each cat displays a catalogue code (`SYR-0042`).

The user does exactly one of:

- **Confirm a match** to an existing cat → **15 points**
- **Name a new cat** → **25 points**, and they are recorded as its discoverer

New names must be unique across the catalogue (case-insensitive, enforced by a database index and handled for concurrent submissions) and pass the offensive-language filter. Rejections return `NAME_TAKEN` or `OFFENSIVE_NAME` and are shown inline. An AI "suggest names" button proposes playful, unused names in the user's language.

If the AI reported no cat in the photo, the screen says so rather than offering matches.

### 4.5 Consequences of resolving

Resolving a sighting, in one operation:

- Marks the sighting `resolved` and attaches it to the cat
- Awards the points to the device profile
- Recomputes badges and reports any newly earned ones
- **Auto-subscribes the spotter to that cat's updates**
- Notifies that cat's other subscribers ("*Loukoumi was spotted again!*" / "*…was just discovered on Syros!*"), excluding the spotter themselves

Only **resolved** sightings count anywhere: statistics, catalogue counts, streaks, fan counts, and "last seen".

---

## 5. Feature reference

### 5.1 Home

Greeting, current streak, nearby cats, and a collection progress readout ("12 of 142"). Every cat shows its photo; cats the device has personally spotted carry a passport-style **"Spotted"** stamp. Before a spotter's first sighting, the progress readout is replaced by a **"Spot your first cat"** button.

### 5.2 Cat-alog

Searchable grid of every cat. Filters: all / near me / has a home. Same photo-and-stamp treatment, plus a **Not spotted yet** filter. Sorted by distance when location is available, otherwise by most recently seen.

### 5.3 Cat detail

Per cat:

- Photo, name, catalogue code, description, coordinates
- **Sightings history** — every resolved sighting with its photo, spotter (username, nickname or spotter code) and date
- **Fans** — how many distinct devices have spotted this cat
- **Care timeline** — newest first: desexed / adopted / general updates, always ending with a `discovered` entry crediting the discoverer. Sighting-type updates are deliberately excluded here, because the sightings list already covers them and they would drown the care events the timeline exists to show.
- **Owner block** — owner name and home description when the cat has been claimed

### 5.4 Cat ownership (residents)

Three distinct paths:

| Action | Who | Effect |
|---|---|---|
| **Register a cat** (`POST /cats`) | Any resident | Creates an owned cat with no photo yet, no sighting required. Photo id `0` is a sentinel; the photo route 404s for it until a real photo arrives. |
| **Claim a cat** (`POST /cats/{id}/claim`) | Any device, if unclaimed | Sets owner, owner name, home description. Idempotent for the same device; `409` for anyone else. Guarded against concurrent claims. Notifies everyone who has spotted that cat: *"Loukoumi has a home!"* |
| **Edit a cat** (`PATCH /cats/{id}`) | Owner only | Rename (moderated) or update home description. Notifies spotters of the rename or update. |

Ownership is remembered locally for a fast start and re-hydrated from the server profile, so edit rights survive a reinstall.

### 5.5 Notifications

- **Subscriptions** are created automatically when you resolve a sighting for a cat.
- **Update types:** `sighting`, `desexed`, `adopted`, `general`.
- **Fan-out** writes an in-app notification row per subscriber and fires an Expo push, excluding whoever triggered it. Push delivery is fire-and-forget: it can never block or fail the request that caused it.
- **In-app inbox** grouped Today / Earlier, with per-item and mark-all-read, and an unread bell badge.
- **Broadcasts** (`POST /cats/{id}/updates`) are the charity's channel for "this cat has been desexed" and require the `OWNER_SECRET` bearer token. If that variable is unset the endpoint returns `503` — a safe failure, not an open door.

### 5.6 Gamification

**Points:** 15 per confirmed sighting, 25 per newly discovered cat.

**Badges** (computed server-side from live stats, never stored, so they can never drift):

| Badge | Earned at |
|---|---|
| `first_sighting` | 1 sighting |
| `first_discovery` | 1 discovery |
| `five_cats` | 5 distinct cats spotted |
| `ten_cats` | 10 distinct cats spotted |
| `ten_discoveries` | 10 discoveries |
| `explorer` | 25 sightings |
| `island_legend` | 500 points |

**Streak:** consecutive days with at least one resolved sighting, bucketed in **Europe/Athens**, not UTC. Syros is UTC+2/+3, so a cat spotted at 23:30 local falls on the previous UTC day — bucketing in UTC would split one evening across two days and hand out a streak nobody earned. A streak survives today-not-yet-spotted and breaks only after a full missed day. Future-dated and duplicate days are discarded.

**Leaderboard:** top 20 by points, showing spotter code, username/nickname, points, discoveries and rank. Never raw device ids.

### 5.7 Profile

Username (editable, with the same availability and moderation checks), optional nickname, language, points, streak, badges with descriptions, spotted/discovered counts, and the pending offline queue.

### 5.8 Help & info page — colony campaign

A fundraising card for the charity: title, plain-language blurb ("€10 covers a rabies vaccine. €50–60 sterilises one cat."), progress toward a goal in EUR, cats helped, donor count, days remaining, and suggested chip-in amounts (€5 / €10 / €25 / €50).

**There is no payments backend.** The app opens an external `donateUrl` in a browser; no money moves through this codebase. The campaign is server-side configuration (environment variables) so figures can be corrected without shipping an App Store release. States exist for not-yet-open, no-donations-configured, offline, and error.

The donate URL is validated twice — server and client — and only absolute `https` URLs survive. A mis-set variable or tampered response must not be able to walk a user from "Chip in €10" to an attacker's page. The destination host is displayed on the button.

---

## 6. Offline behaviour

Non-negotiable, not a nice-to-have. The app's users are frequently out of coverage.

### 6.1 Queued sightings

- Submitting with no connection saves the sighting locally: photo written to the document directory (base64 kept inline only on web, which has no file system), plus coordinates, capture time and status.
- Connectivity is watched; the queue syncs automatically on reconnect, and can be synced manually.
- On sync each item is submitted and moves to **`review`** — matching happened, the user's decision is still needed. A banner and a tab badge report *"1 spot ready to review"*.
- **Failure handling:** network errors leave the item queued untouched. Server errors increment a fail count; any `4xx`, or a third consecutive failure, marks the item permanently failed with a reason the user can read (e.g. photo unsupported, too large). Failed items can be retried.
- Items older than **30 days** are flagged stale and will never sync. That matches the server's 30-day backdating clamp — nothing is silently accepted and then filed on the wrong day.
- Orphaned photo files are cleaned up.

### 6.2 Offline maps

On first online launch the app pre-downloads OpenStreetMap tiles for Syros: zoom 11–15 island-wide plus zoom 16 over Ermoupoli and Ano Syros — roughly 350 tiles. Once downloaded, native maps switch to the local `file://` tile template. Download is retried on reconnect. Progress is shown.

### 6.3 Offline catalogue

The cat catalogue is cached so the grid, detail views and matching context remain usable without a connection.

---

## 7. Data model

| Table | Purpose | Notes |
|---|---|---|
| `photos` | Base64 image + MIME | Served by integer id at `/api/photos/{id}`, immutable cache headers |
| `cats` | Name, description, primary photo, lat/lng, discoverer, optional owner + owner name + home description | **Case-insensitive unique index on name** |
| `sightings` | Cat (null until resolved), device, photo, lat/lng, status, createdAt | `createdAt` is the *clamped capture time*, not the insert time |
| `profiles` | Device id (PK), username, nickname, points | **Case-insensitive unique index on username** |
| `device_credentials` | Device id → SHA-256 secret hash | Trust-on-first-use binding |
| `cat_subscriptions` | (device, cat) composite key | Who gets notified about which cat |
| `cat_updates` | Cat, type, message, triggering sighting | The care timeline's source |
| `notifications` | Device, update, read flag | The in-app inbox |
| `push_tokens` | Device (PK) → Expo token | |

Points are the one stored aggregate. Everything else — badges, streaks, counts, fans — is derived on read, so it cannot drift from reality.

---

## 8. Non-functional behaviour

### 8.1 Architecture

- `artifacts/cat-spotter` — Expo app (expo-router; five tabs: Home, Cat-alog, Spot, Help, Profile; plus `cat/[id]`, `review`, `notifications`). iOS 26 gets native liquid-glass tabs; other platforms get the classic tab bar.
- `artifacts/api-server` — Express API, all routes under `/api`.
- `lib/api-spec/openapi.yaml` — the contract. The typed React Query client in `lib/api-client-react` is **generated** from it; regenerate rather than hand-editing.
- `lib/db` — Drizzle schema. `lib/api-zod` — shared request validation.
- Maps are platform-split: `react-native-maps` (pinned 1.18.0) on native, an OpenStreetMap iframe on web, because `react-native-maps` does not bundle for web.

### 8.2 Authentication and authorisation

| Surface | Guard |
|---|---|
| Private profile read/write, notifications, push token, sighting resolution | `X-Device-Secret` header verified against the stored hash (timing-safe) |
| Cat edit | Device must be the recorded owner |
| Charity broadcasts | `Bearer OWNER_SECRET`; `503` when unconfigured |
| Everything else (catalogue, cat detail, leaderboard, campaign, photos) | Public |

### 8.3 Image handling

Accepts JPEG, PNG, WebP, HEIC/HEIF (including HEVC-compressed iPhone HEIC, via a WASM fallback when libvips can't decode it). Detection is by magic bytes, not by what the client claims. Every image is fully decoded — which catches corrupt and truncated files that pass a magic-byte check — EXIF-rotated upright, bounded to 2048 px on the longest edge, and re-encoded as JPEG at quality 80.

Hard caps: 20 MB input, 5 MB stored. Oversized-but-valid photos are **shrunk rather than rejected**; the user's photo is never thrown away over a size limit.

### 8.4 Content moderation

A multilingual (en/el/fr) offensive-word filter guards every public display name: usernames, nicknames, new cat names, and renames.

It normalises aggressively before matching — lowercase, strip diacritics, map leetspeak (`0→o`, `4→a`, `$→s`…), transliterate Greek to Latin — then matches short words on whole tokens only and long words (≥ 5 characters) as substrings of the collapsed string. Short words are token-matched deliberately: the Scunthorpe problem. `fuck`, `shit` and `jizz` are the exceptions allowed to match as substrings.

### 8.5 Rate limiting

The two AI-backed endpoints (`POST /sightings`, `POST /cats/name-suggestions`) are limited to **20 requests per IP per 15 minutes**. Both spend real money per call and are unauthenticated; an anonymous flood could exhaust credits and take matching down for everyone. The limit is comfortable for a person spotting cats and hostile to a tight loop. Exactly one proxy is trusted, so the client IP cannot be spoofed via `X-Forwarded-For`.

### 8.6 Resilience principles observed throughout

- Push delivery never blocks or fails the triggering request
- AI failure degrades to "no candidates", never to a lost sighting
- Clock skew is clamped, never rejected — a wrong phone clock must not cost someone their photo
- A malformed campaign environment variable throws at boot rather than rendering as `NaN` on a donation card
- An unknown currency code falls back to plain numerals rather than crashing the screen

---

## 9. Test coverage as built

Unit tests cover the logic most likely to go silently wrong: streak day-boundary arithmetic, capture-time clamping, campaign configuration, image validation across formats, and derived cat statistics. Route tests cover authentication, moderation, username claiming, upload validation, sighting resolution, cat claiming, and rate limiting.

---

## 10. Known gaps and open questions

These are observations about the current build, not proposals. Each is a candidate for the brainstorming that follows.

**Charity operations**
1. There is no staff or volunteer interface at all. Syros Cats can only broadcast updates by making an authenticated HTTP request with a shared secret.
2. `desexed` and `adopted` exist as update types but nothing about them is queryable — you cannot ask "which cats are not yet desexed", which is the charity's central operational question.
3. There is no way to flag a cat as needing help (injured, sick, pregnant, missing), which is the most time-critical thing a member of the public can observe.

**Data quality**
4. A misidentification is permanent — there is no merge, split, or correction path once two entries turn out to be the same cat, or one entry turns out to be two.
5. Cat `description` is written by the schema but never populated by any flow.
6. Cats registered by residents have no photo, and nothing prompts anyone to add one.
7. Only the first photo is ever a cat's primary photo; later sightings never update it, so a kitten stays a kitten in the catalogue forever.

**Product**
8. There is no payments path — the Help & info page links out, and campaign figures are hand-maintained environment variables.
9. There is no moderation or takedown path for a bad photo once uploaded.
10. Anonymity means a lost device is a lost profile; the "restore" copy in onboarding is not backed by a mechanism.
11. Photos are publicly enumerable by sequential integer id.
12. There is no analytics or reporting of any kind — nobody can currently answer "is this working".

---

*Sections 1–9 describe the software as it exists. Corrections to this document are corrections to my reading of the code, and should be made before any new feature work begins.*
