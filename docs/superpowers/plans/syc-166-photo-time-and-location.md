# Starting the map where (and when) a library photo was taken: implementation plan (SYC-166)

**Spec:** `docs/specs/photo-location-from-library.md`, approved by Samuel on 14 October 2026, every decision as recommended (Decisions 1 to 7). Its [review](../../specs/reviews/photo-location-from-library-review.md) is folded into the spec (§13).
**Samuel's condition on the build (Linear, 14 October):** build the photo's date and time first, because it works whatever the device check finds. "Start the map where the photo was taken" is a separate, later slice that waits on the device check (SYC-280). **SYC-258 ships first**, and SYC-166 must not ship before it (spec §5.1).
**Status:** for Samuel's approval. Nothing here is built. This document changes no code.
**Checked against:** `origin/main` at `7089870` (13 October 2026). Every "exists today" claim names the file and line it was read at on that commit. Platform claims the spec marks **[confirm]** are not treated as fact anywhere below.

---

## In plain English

**What a spotter sees when it is all built.** A spotter picks an old photo from their library. The sighting is dated to the day the photo was **taken**, not the day they picked it, and the screen says so ("Photo taken 3 October, 18:42 (Greek time)"). If the photo says where it was taken (iPhone app, and website photos exported from a laptop, expected but not yet proven), the map opens on that spot and a line says so. If it doesn't, the map opens near them, or in Ermoupoli if their phone has no usable position, and a line says so honestly. A photo more than 21 days old is turned away with a plain explanation and the library offered again. A photo taken away from Syros stops with "This photo was taken away from Syros" and an "It was on Syros" way out. Two different photos taken in the same second both count. Picking the same photo twice says "You've already logged this photo."

**What an owner sees.** If a sighting of their cat comes from a photo more than a day old, the push says "Agatha was seen on Tuesday" instead of "spotted again!". The evening round-up for everyone else is unchanged.

**What the reward screen says.** "Last seen" is the newest sighting of that cat, so logging a 10-day-old photo can never make a cat look as if nobody had seen it for 10 days.

**What nobody sees.** The photo's exact position is used once, on the phone, to place the map. It never goes in a web address, a log, a saved-for-later item or a new field. The only position saved is the pin the spotter confirms.

**What each kind of phone gets, honestly.** This is the spec's expectation, not a fact until the device check (SYC-280) has run: iPhone app, time and place; Android app, time only; website on a phone, little or nothing; website with a photo exported to a laptop, both. The plan is built so that every one of those outcomes has a defined behaviour (spec §4.3) and none breaks the feature.

**No database change in any slice.** No migration, so none of these slices queues behind migrations 0015 and 0016 (SYC-209, SYC-53).

---

## The slices at a glance

Each slice is its own fresh worktree off `origin/main`, its own PR, and leaves `main` safe on its own. They go in this order. Slices 2 and 3 are independent of each other once 1 is merged; 4 builds on 2; 5 builds on 1, 2 and 4.

| # | Slice | Needs | Ships | Platforms touched |
|---|---|---|---|---|
| 1 | **SYC-258:** the review screen's address carries a rounded position only | nothing | first, alone | all (one pure file) |
| 2 | **The photo's date and time:** clock order, the 21-day limit, the "photo has no time" line, same-second and same-photo fixes. Also the XMP line in the server's photo test (SYC-260) | slice 1 merged | next | iPhone app, Android app. The website keeps today's behaviour in this slice (see 2W) |
| 2W | **The website's time reader** (a small JPEG reader that reads time tags only) | slice 2 merged; Decision A below | right after 2, or after SYC-280's C6/C8, Samuel's call | website |
| 3 | **Owner's "seen on Tuesday" push, and the reward screen's last-seen date** | nothing in the app; independent of 2 | any time after 1 | server only |
| 4 | **Ermoupoli start** when there is no usable phone position | slice 2 merged (shares the pick-handling code in the Spot screen) | after 2 | iPhone, Android, website |
| 5 | **WAITS ON SYC-280.** The map starts at the photo's position; the "doesn't say where" lines; the off-island stop screen | slices 1, 2, 4 merged **and** the §4.2 results table filled in **and** Samuel's go-ahead on §4.3's "still worth it?" question | last | only the platforms where the check shows location arrives |

**One departure from the brief's slice list, flagged here and in "Spec vs code".** The brief put "off-island stop screen and Ermoupoli start" together as slice 4. The off-island screen needs the photo's position, and nothing reads that position until slice 5. So the Ermoupoli start (which needs no photo position) is slice 4, and the off-island screen moves into slice 5, where it can actually be built and tested.

**Honest lines never get ahead of the code.** A line that says "this photo doesn't say where it was taken" is only true on a platform where we have either read the photo or confirmed the platform removes the location. So `mapStartedAtYou` and `photoNoTime` appear only where that is so (slice 2 on the website shows neither; slice 5 decides the location lines per platform from the device check). The existing "It starts near where you are" hint stays for library photos until slice 5 replaces it.

---

## Slice 1 · SYC-258: the review screen's address carries a rounded position only

**What a spotter sees afterwards.** Nothing. After "Check for matches" the review screen opens exactly as before, with the same "Cats known around here" list. The difference is in the website's address bar and browser history: the spot's position is there as about 110 m of blur (three decimal places, like `37.441`), not to the metre. Without this, a pin that started at a photo (her friend's garden, a hotel room) would sit to the metre in the history of whoever logged it (spec §5.1).

**Branch / PR:** `claude/syc-258-round-review-position`, one PR, no spec dependency.

### What the code does today (verified on `7089870`)

- `buildReviewParams` is the only way to build the review route. It copies the position through `safeLocation` unrounded: `artifacts/cat-spotter/lib/reviewParams.ts:72-78` (the check) and `:96-100` (the copy into `data.lat` / `data.lng`). The result is one JSON string in a single `data` param (`:105`), which expo-router puts in the browser address and history on the website.
- **Only one call site passes a position.** The "sent" path in `app/(tabs)/spot.tsx:487-495` passes `finalCoords.latitude` / `.longitude`. The other two callers, `reviewPending` (`spot.tsx:531-537`) and `ReviewReadyBanner.tsx:37-44`, pass none: a queued item's review screen reads the position from the queue in memory (`app/review.tsx:122-125`), not from the route. The ticket (SYC-258) names three call sites; the code has one. Rounding in the builder is still the right place, because it is the single choke point that every present and future caller goes through, and `lib/__tests__/reviewRoutes.test.ts` already fails any `/review` navigation that bypasses it.
- What the position is for: `app/review.tsx:122-131` builds the "nearby" set from it with `pickerList(from, cats, "")`, a 1.5 km rule (`choose-a-different-cat.md` §4). The server checks a pick against its own stored location, so nothing that matters loses accuracy.

### Decision taken in this plan (Samuel can overrule)

The ticket offers two fixes: round in the builder, or keep the position in memory beside the review store (as SYC-76 did for the photo). **This plan does the rounding**: it is ten lines in one pure file, it covers every caller, and the only consumer is a 1.5 km list. Rounding to three decimals moves a point by at most about 70 m (0.0005 degrees is about 55 m of latitude, about 44 m of longitude at 37.4 N), against a 1.5 km edge. The in-memory option would touch `review.tsx`, `spot.tsx` and a new store for no gain a spotter could feel. It stays available if a later change needs the exact pin on the review screen.

### Files

- Edit `artifacts/cat-spotter/lib/reviewParams.ts`: a new exported `ROUTE_POSITION_DECIMALS = 3` and `roundForRoute(n)`; `safeLocation` returns the rounded pair; `parseReviewParams` also rounds what it reads back (idempotent, so an old address from history can never re-introduce precision).
- Edit `artifacts/cat-spotter/lib/__tests__/reviewParams.test.ts`.
- No other file.

### Steps (test first, each its own commit)

1. **Tests that fail on `main`** (add to `reviewParams.test.ts`), by value, not by field name (spec §9 test 6c, SYC-258's own note):
   - `rounds the position to three decimals in the serialised route`: build with the fixture `lat: 37.4412345, lng: 24.9412345`; assert `params.data` contains neither `"37.4412345"` nor any number with four or more decimals (`expect(params.data).not.toMatch(/\d\.\d{4,}/)`), and `parseReviewParams(params.data)` gives `{ lat: 37.441, lng: 24.941 }`.
   - `a pin equal to a photo's position does not leak it`: the fixture is the same value used for the photo-position fixtures in slice 5, so the assertion is already in place when a photo position first exists. Assert on the whole serialised `data` string, not on the `lat` key, so a new key name cannot slip by.
   - `rounding is stable`: rounding the parsed value again changes nothing.
   - `rounding never moves a point more than 80 m`: random points inside the island rectangle; haversine distance between input and output is under 80 m.
   - `still drops non-numbers, non-finite values and out-of-range values` (the existing guards, now exercised on the rounded path).
   - `negative and zero coordinates round without "-0"`: `-0.0004` becomes `0`, not `-0` (JSON writes `0`; assert it).
2. **The change** in `reviewParams.ts`. Update the file's header comment: the "two short numbers" paragraph (`:19-22`) now says "rounded to about 110 m, so the address never carries a spot to the metre".
3. **Check nothing else assumed the exact value.** Run the whole `cat-spotter` suite (`pnpm --filter @workspace/cat-spotter test`, `typecheck`). `review.tsx` reads `data.lat` only to build the nearby set, so no test should move.

### Mutation probes (the guard is against a silent failure, so a green suite is not enough)

Do each, confirm the named test goes red, restore:
1. Remove the rounding in `safeLocation` -> `rounds the position to three decimals` red.
2. Round to four decimals -> the `\d{4,}` assertion red.
3. Round in `buildReviewParams` but not in `parseReviewParams`'s output, and separately the reverse -> the matching test red (one covers the address, one the read-back).
4. Add a second path that writes the raw value under a new key (`lat2`) -> the whole-string assertion red. This is the "where else must this hold?" probe: the test must read the serialised string, which is why it does.
5. Bypass: add a `router.push({ pathname: '/review', params: { data: JSON.stringify({ lat: 1 }) } })` in a scratch file -> `reviewRoutes.test.ts` red (already exists).

### Verification

- Automated: `cat-spotter` `typecheck` and `test` green. No server change, so no server run beyond CI.
- **Browser check, because the website is the exposed surface** (both widths, one language is enough because no copy changes): run the API and website locally with a database that has cats, spot a cat with a pin dragged to an unrounded point, and after "Check for matches" read `location.href` and `history.state` with the browser tool. Assert neither contains a number with four or more decimals. Do it at ~390 px and at desktop width. Then confirm "Cats known around here" lists the expected nearby cats.
- Real-device check: none needed (pure string change). The iPhone/Android apps do not show the route.
- Note for the PR body: browser histories that already hold exact positions from earlier builds are not cleaned by this. Nothing public has launched with them (the app is pre-launch behind the tester key), and the PR says so rather than implying a clean-up.

### Rollback

Revert. No data is stored in the new form; an address built before the revert is simply less precise.

---

## Slice 2 · The photo's date and time (iPhone app, Android app; the website keeps today's behaviour)

**What a spotter sees afterwards.** On the iPhone and Android apps, picking a photo from the library dates the sighting to when the photo was **taken**. Under the photo a line says "Photo taken 3 October, 18:42 (Greek time)", always in Greek time whatever the phone's own zone is, so it matches how the streak day is counted. A photo from more than 21 days ago is not accepted: they see "This photo was taken on 12 September, more than 21 days ago. We can only record sightings from the last 21 days. Please choose a newer photo." with a button that opens the library again. A screenshot or forwarded photo that carries no time is recorded as now, and the screen says "This photo doesn't say when it was taken, so the sighting will be recorded as now." Two different photos from the same second both count as sightings (the second gets one millisecond later), and picking the same photo twice says "You've already logged this photo." On the **website** nothing changes in this slice: the photo is still dated to the moment it is picked, and no line claims otherwise, because the website reader is slice 2W. The camera is untouched: a photo taken now is dated now.

**Branch / PR:** `claude/syc-166-photo-time`, one PR, after slice 1 is merged. It does **not** wait on SYC-280 (Samuel, 14 October): the clock order is built to give a defined answer for every combination of tags the device check could report.

### What the code does today (verified on `7089870`)

- **Pick sets the time to now.** `pickPhoto` (`artifacts/cat-spotter/app/(tabs)/spot.tsx:290-296`) calls `setCapturedAt(new Date().toISOString())` for both the library and the system-camera shutter. The live camera does the same at `:351`. The state lives at `:145` and is read at submit: `const sightingTime = capturedAt ?? new Date().toISOString()` (`:424`), then sent as `capturedAt` (`:449`) or queued as `createdAt` (`:459`). The queue sends it back as `capturedAt: item.createdAt` (`context/OfflineContext.tsx:401`).
- **The library picker** is called with `base64: true`, `quality: 1`, `preferredAssetRepresentationMode: Current` (`spot.tsx:272-279`), and **no `exif` option**, so no tags come back today. The picker is `expo-image-picker ~17.0.9` (`package.json:48`), resolved to 17.0.11 in `pnpm-lock.yaml:3936`. Its `exif` option exists for iOS and Android only (`ImagePicker.types.d.ts`, the `exif?: boolean` doc); its website code does not read tags (`ExponentImagePicker.web.js:111`, "TODO ... add exif support"), and it does return the chosen `File` and, with `base64: true`, the base64 of the whole file.
- **Compression happens after the tags are available, and it does not need to matter.** `toPickedPhoto` (`spot.tsx:97-109`) uses the picker's own base64 unless it is over 15 MB, in which case `shrink` re-encodes through `ImageManipulator` (`:78-85`), which drops the tags. On a weak connection `optimizePhotoForUpload` (`:435`, `lib/photoUpload.ts:42`) re-encodes again, at send time. Both run on the *picture*; neither touches the picker's `asset.exif` object. So the plan reads the tags from the picker's answer **at pick time, before either step**, and holds only the parsed time (spec §4). Order matters and is tested (spec test 7).
- **The server.** `clampCaptureTime` moves a time older than 30 days to "30 days ago" without telling anyone, and a future time (more than 5 minutes ahead) to now (`artifacts/api-server/src/lib/captureTime.ts:20-23`, `:43-44`). A sighting from the same device with the same capture time is treated as a repeat: it returns the existing sighting and **never stores the second photo** (`routes/sightings.ts:511-521`, comparing `createdAt` to the clamped instant exactly; the column is `timestamptz`, `lib/db/src/schema/sightings.ts:28`, so milliseconds survive).
- **The queue's 30-day staleness** is in `lib/offlineQueue.ts:14` (`MAX_QUEUE_AGE_MS`) and `:56-64` (`markStaleItems`, comparing `createdAt` to now), **not** in `reportQueue.ts` or `queueStore.ts` (see Collisions). A photo 21 days old therefore has 9 days of saved-for-later life.
- **Time zones in the app** already use `Intl.DateTimeFormat` with `timeZone: 'Europe/Athens'` (`lib/campaignDates.ts:9-20`), so the plan has a precedent that works in the app's JS engine and does not add a date library.
- **No tag-reading code exists** anywhere in `artifacts/cat-spotter` today.

### Files

New (all pure, framework-free, so they test without React Native):
- `artifacts/cat-spotter/lib/photoClock.ts`: `extractTimeTags`, `resolvePhotoTime`, `MAX_PHOTO_AGE_DAYS = 21`, `athensWallClockToInstant`, `formatPhotoTaken`.
- `artifacts/cat-spotter/lib/pickedAsset.ts`: turns a picker asset into `{ photo, timeInfo }` (calls the injected `shrink`, reads tags from `asset.exif` **before** it).
- `artifacts/cat-spotter/lib/recentPhotos.ts`: the device's list of recent capture times and photo fingerprints (Decision 2 B).
- Tests: `lib/__tests__/photoClock.test.ts`, `pickedAsset.test.ts`, `recentPhotos.test.ts`.

Edited:
- `app/(tabs)/spot.tsx` (wiring only; the logic lives in the libs above).
- `lib/i18n.ts`: five keys in en, el, fr: `photoTakenAt`, `photoNoTime`, `photoTooOld`, `photoAlreadyLogged`, `photoAlreadyLoggedOpen`. Appended in one block headed `// SYC-166` at the end of each dictionary, to keep merges with other tickets trivial.
- `context/DeleteMyDataContext.tsx`: one line in `wipePhone` (`:88-95`) calling `clearRecentPhotos()`, see "Privacy" below.
- Server test only: `artifacts/api-server/src/lib/imageValidation.exif.test.ts` (SYC-260's XMP line).
- New server test `artifacts/api-server/src/routes/sightings.backdatedPublic.test.ts`.

**Not touched:** `lib/offlineQueue.ts`, `lib/queueStore.ts`, `lib/reportQueue.ts`, `context/OfflineContext.tsx`, `context/ReportQueueContext.tsx`, any server route, any schema.

### The clock (spec §3.4), exactly

`extractTimeTags(exif)` takes whatever `asset.exif` is and returns **only** these strings, if present: `DateTimeOriginal`, `OffsetTimeOriginal`, `SubSecTimeOriginal`, `GPSDateStamp`, `GPSTimeStamp`. It accepts a flat dictionary (Android shape) and one nested under `{Exif}` / `{GPS}` (the iPhone's native shape), and **returns nothing else**. In particular it does not return, copy or keep any latitude, longitude, altitude or accuracy value. This is the privacy line for slice 2: asking the picker for `exif: true` puts the photo's GPS in memory on the phone for the lifetime of the `asset`; the extractor is the only code that ever sees that object, and the object is not stored in state, passed on, or logged (test below). The exact key shapes must be captured from a real iPhone and Android for the fixtures; until SYC-280's results are in, the fixtures are written from the picker's documented shape and the iOS simulator (see Verification), and both shapes are accepted.

`resolvePhotoTime(tags, now)` returns one of:
1. **Photo time plus its own offset** (`DateTimeOriginal` + `OffsetTimeOriginal`): the instant is exact. Source `photo+offset`.
2. **No own offset, GPS clock present** (`GPSDateStamp` + `GPSTimeStamp`) and the two are within 24 hours of each other: offset = (photo wall-clock read as if UTC) minus (GPS time), rounded to the nearest 15 minutes. Instant = wall-clock minus that offset. Source `photo+gps-offset`. **Plan hardening, not in the spec:** the rounded offset must also be a real-world zone offset (between -12:00 and +14:00) **and** the unrounded difference must be within 3 minutes of the rounded one, otherwise the GPS clock is distrusted (a phone that reuses an hours-old fix produces an off-grid difference) and rule 3 applies. See Decision B for Samuel.
3. **Otherwise** the wall-clock is read as **Greek time** (Europe/Athens). Source `photo+athens`.
4. **The GPS clock never sets the time on its own.** If `DateTimeOriginal` is missing there is no time, even if a GPS clock exists. Result `{ kind: 'none', reason: 'missing' }`.
5. **Nonsense is ignored:** an unparseable string, an impossible date, or an instant more than 5 minutes in the future (the server's own skew, `captureTime.ts:23`) is `{ kind: 'none', reason: 'unreadable' | 'future' }`.
6. **Too old:** an instant older than `MAX_PHOTO_AGE_DAYS` (21) days is `{ kind: 'tooOld', instant }`.
7. **Sub-seconds** (`SubSecTimeOriginal`) are added as milliseconds when present. It makes a collision less likely and costs nothing; it never changes which second the photo belongs to.

`athensWallClockToInstant(naive)` converts a wall-clock reading to a UTC instant with `Intl`, not with a hard-coded +2/+3. It defines the two awkward nights: on 25 October 2026 the clocks go back at 04:00 summer time, so 03:00 to 03:59 happens twice, and the **earlier** instant is chosen; on the last Sunday of March 2027 the clocks jump from 03:00 to 04:00, and a nonexistent 03:30 is read as 04:30 summer time. Both are named tests.

`formatPhotoTaken(instant, language)` formats "3 October, 18:42" (en) in Athens time using the app's language, for the `{when}` in `photoTakenAt`. `photoTooOld`'s `{date}` uses the same formatter without the time, and `{days}` is `MAX_PHOTO_AGE_DAYS`.

### Same-second photos and the same photo twice (Decision 2 B)

`recentPhotos.ts` keeps a capped list (last 30 days, at most 200 entries) of `{ capturedAtMs, fingerprint, localId?, sightingId? }` in the device's own storage under the key `cat-spotter/recent-photos-v1` (AsyncStorage on phones, local storage on the website, as `keepSafe.ts` and `welfareGuidanceCache.ts` already do). It is **separate from the queue**: it is not built on `queueStore.ts`, carries no photo, and is written only by this slice's code.

- **Fingerprint:** file size plus a fast non-cryptographic hash (FNV-1a) of the first 64 KB of the picker's base64 (the first 87,384 characters). Same photo picked twice gives the same fingerprint; two different photos from one burst differ in size or content. It is computed once, at pick time, from the string already in memory.
- **Different photo, same second:** `uniqueCaptureTime(instantMs, fingerprint, list)` adds one millisecond at a time until the time matches no entry, **at submit time**, from the list as it stands. Because an entry is written only after a send succeeds or a save-for-later succeeds, a retry of a half-arrived send recomputes the same value and the server's own repeat protection (`sightings.ts:511-521`) still catches it. Entries from camera sightings are recorded too (time only).
- **Same photo:** if the fingerprint is in the list, the pick stops with the `photoAlreadyLogged` line and, where the sighting is still reachable, an "Open that sighting" button (`photoAlreadyLoggedOpen`). Decision C covers what "open" does.
- **Written** after "sent" (`spot.tsx:477`'s `case 'sent'`) and after a successful `enqueue` (`:453`). Nothing is written for a failed send or a photo that is cleared.
- **Delete my data** (`DeleteMyDataContext.tsx:88-95`): `wipePhone` also calls `clearRecentPhotos()`. This matters because spec §5.8 says "nothing new is stored that [delete-my-data] would miss", and Decision 2 B stores something new (see Spec vs code).

### The Spot screen

- `choosePhoto` (`spot.tsx:239-288`) passes `exif: true` to `launchImageLibraryAsync` only (not the camera: a camera photo is taken now). It returns `{ photo, timeInfo }` from `pickedAsset.ts`; `replaceRejectedPhoto` (`:398-412`) keeps ignoring the time info (it preserves the old item's time on purpose: a rejected sighting's replacement photo is for the same sighting) and gets a one-line comment saying so.
- `pickPhoto` for the library: if `timeInfo.kind === 'tooOld'`, set a new `photoProblem` state (`{ kind: 'tooOld', date }`) and **do not** set the photo. The Spot screen shows the explanation in the same card style the other photo errors use, with a "Choose from library" button that calls `pickPhoto(false)` directly from its own tap (a browser only opens a file chooser from a direct tap, which is why this is an inline card and not an `await`ed dialog; the camera code makes the same point at `spot.tsx:315-318`). If `kind === 'ok'`, `setCapturedAt(instant.toISOString())` and show `photoTakenAt`. If `none`, `setCapturedAt(now)` as today and, **on phones only**, show `photoNoTime`. On the website `timeInfo.kind` is `'unread'` and no line is shown, because we have not read the file (that is 2W).
- `photoProblem` is cleared by `clearPhoto` (`:233`) and by a new pick.
- `submit` (`:419`): `sightingTime` goes through `uniqueCaptureTime` before it is sent or queued.
- The line "Photo taken ..." sits between the photo card (`NewSpotIntro`, `:826`) and "Where did you see it?".
- `confirmLocationHint` ("It starts near where you are.") is unchanged in this slice.

### Steps (test first, each its own commit)

1. **Probe first, server:** in `imageValidation.exif.test.ts` add `expect(outputMeta.xmp).toBeUndefined()` to both existing cases and a fixture whose *input* carries an XMP block with a position (`sharp` `withMetadata` XMP, or a hand-built APP1 segment), asserting `inputMeta.xmp` is defined first, as the existing test does for EXIF (`:48-56`). If sharp's re-encode leaves XMP in, this is a **real server bug found early**: fix it in `imageValidation.ts` in the same commit and say so in the PR. (SYC-260.)
2. **`photoClock.test.ts`, red then green** (spec §9 tests 1 (time half), 2, 3, 13):
   - `photo time plus its own offset wins` (iPhone fixture, `+03:00`).
   - `GPS clock fills a missing offset`: photo `2026-10-03 18:42:10`, no offset, GPS `15:42:00 UTC` on the same date, gives 15:42:10 UTC.
   - **`GPS clock 30 minutes off the photo time: the photo time wins`** (spec §9 test 2's named fixture). Written two ways: with an own offset (own offset wins outright) and without (the 30-minute gap is off the 15-minute grid by more than 3 minutes, so the GPS clock is distrusted and Athens time is used).
   - `GPS clock alone never sets the time` (no `DateTimeOriginal` -> `none/missing`).
   - `no offset, no GPS clock -> read as Greek time`, summer and winter.
   - `25 October 2026 03:30 is one defined instant` (the earlier one); `28 March 2027 03:30 (nonexistent) resolves to 04:30`.
   - `a future time and an unreadable time fall back to none`; edge: now + 5 minutes accepted, now + 5 minutes + 1 ms refused.
   - **`the 21-day edge`**: one minute inside is `ok`, one minute outside is `tooOld`, and the `photoTooOld` text carries the right date and `21`.
   - `MAX_QUEUE_AGE_MS minus the photo limit leaves at least 9 days` (imports `MAX_QUEUE_AGE_MS` from `offlineQueue.ts`): the relationship that made 21 days the answer in Decision 1 is pinned, so changing either constant fails loudly.
   - `a phone set to Berlin still shows Greek time`: with `process.env.TZ='Europe/Berlin'` for the test, a photo at 18:42 Greek time displays "18:42 (Greek time)" (spec §9 test 13).
   - `extractTimeTags` shapes: iPhone nested `{Exif},{GPS}`, Android flat, both with a fixture GPS position of `37.4412345, 24.9412345` present in the input, and `JSON.stringify(output)` contains **no** part of it (value-based privacy test; the extractor cannot leak what it never returns).
3. **`pickedAsset.test.ts`** (spec §9 test 7): with a mocked asset and a fake `shrink`, the over-15 MB path and the weak-connection path give the **same** time info as the plain path. A source check: `.exif` is read in exactly one file (`pickedAsset.ts`), `asset.exif` is never assigned to state, passed into a hook, or logged anywhere under `app/`, `components/`, `context/`, `hooks/` or `lib/` (same style as `reviewRoutes.test.ts`'s scan).
4. **`recentPhotos.test.ts`** (spec §9 test 9): two different photos with the same second make two entries, the second one millisecond later; three in one second get +0, +1, +2; the same photo picked twice is caught (`already-logged`) and returns the stored `localId`/`sightingId`; a retry of one send (not recorded, because it never succeeded) returns the identical time; entries older than 30 days and beyond 200 are dropped; corrupt storage returns an empty list and never throws; `clearRecentPhotos` empties it.
5. **Implement** the three libs, then the Spot wiring, then the five i18n keys with the spec's §8 text verbatim, then the `wipePhone` line. `lib/__tests__/i18n.test.ts` already enforces: same keys in all three languages, same `{placeholders}`, French in "tu".
6. **Server test** `sightings.backdatedPublic.test.ts` (spec §9 test 8, new part): a sighting created with `capturedAt` 20 days ago still serialises with a **date only** in every public payload that shows it (cat list, cat page sightings list), asserted against the real serialiser output.
7. **Walk the flows** (Verification), then a draft PR.

### Tests that must exist when this slice ships (spec section 9 mapping)

Test 1 (time half), 2, 3, 7, 9, 13 and 10 (the five keys), plus 8's server parts. Tests 4, 5, 6a-6d (the position parts), 11, 12, 14, 15 belong to slices 2W to 5.

### Mutation probes (the limit, the order and the dedupe are silent failures)

1. Delete the 21-day check -> `the 21-day edge` red.
2. Make the GPS clock win over the photo time -> the 30-minute fixture red.
3. Read the wall-clock as UTC instead of Athens -> the summer/winter test and the DST tests red.
4. Accept a future time -> `a future time` red.
5. Remove the one-millisecond bump -> `two different photos with the same second` red.
6. Make the fingerprint a constant -> `two different photos` red (different photos are wrongly called the same); make it always differ -> `the same photo picked twice` red.
7. Record the entry before the send succeeds -> `a retry of one send returns the identical time` red.
8. Store `asset.exif` in state or pass it to a logger -> the source check red, and the value-based `JSON.stringify` test red if the extractor is bypassed.
9. Show `photoNoTime` on the website -> the platform test for `'unread'` red.
10. Forget `clearRecentPhotos` in `wipePhone` -> a test on `DeleteMyDataContext` (extend `ReportQueueContext.deleteMyData.test.tsx`'s pattern with a spy) red.

### Verification

- Automated: `cat-spotter` typecheck and tests; `api-server` typecheck and tests (the XMP and backdated tests).
- **Browser, the website** (nothing should change but the new keys and the unchanged behaviour): at ~390 px and desktop, in en, el (`cat-spotter/language` = `el`) and fr, with real data from the local API, pick a photo from disk and confirm: still dated to now, **no** "Photo taken" or "doesn't say when" line (honest: the reader is 2W), the flow submits, the review screen opens.
- **iOS simulator for the iPhone app** (this is where Claude can test the iPhone path directly): import fixture photos into the simulator's library with `xcrun simctl addmedia` (one with `DateTimeOriginal` and `OffsetTimeOriginal`, one older than 21 days, one screenshot-like with no tags, two from the same second), and walk: "Photo taken ..." line, the too-old card and its button, `photoNoTime`, two same-second photos both submitting, the same photo twice. Record what the simulator's picker returns for each tag in the PR; it feeds SYC-280 (C3) but is not a substitute for it.
- **Real-device check, required for every claim the spec marks [confirm]:** the merged-or-branch build on one real iPhone and one real Android phone. Pick a fresh photo and read the "Photo taken ..." line against the camera roll's own time: that proves, on the phone, **C3** (iPhone time and offset arrive) and **C4** (Android time arrives, with or without GPS clock and offset). The slice ships without it (the clock order is safe for every outcome), but the PR says plainly which results are unconfirmed, and the results go into spec §4.2's table via SYC-280. If this slice's build is the one SYC-280 uses as its "separate test build", the check costs nothing extra.
- Languages: the five new keys are drafts for SYC-4 native review.

### Rollback

Revert the PR. Sightings already saved keep their true capture times (they are ordinary valid timestamps). The recent-photos list is a few kilobytes of device storage; reverting leaves it unread and `Delete my data` from an older build would not clear it, so the revert PR also keeps `clearRecentPhotos` until the key is retired.

---

## Slice 2W · The website's time reader (time tags only)

**What a spotter sees afterwards.** On the website, a photo picked from a laptop (or from a phone browser that keeps the time) is dated to when it was taken, with the same "Photo taken ..." line, the same 21-day rule and the same same-second fixes as the apps. If the browser has removed the time, the sighting is dated to now and the screen says "This photo doesn't say when it was taken, so the sighting will be recorded as now." The website still reads **no location** in this slice.

**Why it is its own slice, and the one thing the spec leaves open.** The spec says the website reader is "sized to what the device check shows" (§4.1, Decision 4). Samuel's condition says build the date and time first because it works whatever the device check finds. Those pull in different directions for the website: the only reader worth building before the check is the **time-tags-only** one, which is also the part every surviving branch of spec §4.3 needs (the full reader, "time only on web", and everything but "neither arrives on the website"). The cost of guessing wrong is a small reader that finds nothing and degrades to today's behaviour. **This is Decision A for Samuel.** The plan recommends building 2W straight after slice 2; the alternative is to hold it until SYC-280 has filled in C6 and C8.

**Branch / PR:** `claude/syc-166-web-time-reader`, after slice 2 is merged (it reuses `photoClock.ts` and the Spot wiring).

### What the code does today

The picker's website code hands back the chosen `File` and, with `base64: true`, the base64 of the whole file (`ExponentImagePicker.web.js`, `readFile`, `readFileAsBase64`); it reads no tags (`:111`). The Spot screen's `toPickedPhoto` (`spot.tsx:97-109`) therefore holds the whole file's base64 in memory already. Safari on iPhone converts HEIC to JPEG on upload; a true HEIC from a desktop browser is not a JPEG (spec §4 table).

### Files

- New `artifacts/cat-spotter/lib/jpegTimeTags.ts` (pure): `readJpegTimeTags(base64: string): TimeTags | null`.
- Edit `lib/pickedAsset.ts` to call it on the web only, on the picker's base64, and `app/(tabs)/spot.tsx` is **not** edited (the web gets its `timeInfo` from the same function the apps do, which is the point of putting it in `pickedAsset.ts`).
- New `lib/__tests__/jpegTimeTags.test.ts`.
- Fixtures are built in the test with `sharp` (already a server dependency; for the app's tests, a tiny hand-assembled APP1 builder in `lib/__tests__/__fixtures__/` so the app does not gain a dependency).

### What the reader does (spec §4.1, narrowed)

- Decodes **only the first 64 KB** of the base64 (87,384 characters, a multiple of four) however big the file is, finds the Exif APP1 segment, walks the TIFF header (either byte order), IFD0, the Exif sub-IFD (`DateTimeOriginal`, `OffsetTimeOriginal`, `SubSecTimeOriginal`) and the GPS sub-IFD for **the two clock tags only** (`GPSDateStamp`, `GPSTimeStamp`), and returns the same `TimeTags` shape `extractTimeTags` returns.
- **It does not read location by construction**: it does not look up tag ids for latitude, longitude, altitude or accuracy at all. A source check asserts those ids do not appear in the file, so "time only" cannot drift into "location" without a visible change. Slice 5 widens it only if the device check says phone browsers keep the location.
- **Never throws, never hangs.** Every offset read is bounds-checked; IFD entry count capped (at 512); pointer cycles stopped by a visited set and a depth limit; a total step budget. Anything unsure returns `null`, which means "no information".

### Steps (test first)

1. `jpegTimeTags.test.ts` (spec §9 test 4, time-only variant): a JPEG with time tags and an own offset; one with time and a GPS clock but no offset; one with no Exif; big-endian and little-endian; truncated mid-IFD; corrupt (random bytes after the marker); a pointer loop; a 30 MB base64 string (asserts it returns in under 50 ms because only the head is decoded); a HEIC header; a PNG; an empty string; non-base64 text. All return a value or `null`, none throw. **A fixture with a GPS position inside it: the output contains no part of the position** (value-based).
2. Implement. 3. Wire into `pickedAsset.ts` for `Platform.OS === 'web'`. When the reader returns `null`, `timeInfo.kind` becomes `none/missing` and the website now shows `photoNoTime`, which is true because we *did* read the file and found nothing.
4. Extend `pickedAsset.test.ts`: web path with a time-bearing JPEG gives `ok`; with a stripped JPEG gives `none`; with a HEIC gives `none`.

### Mutation probes

1. Make the reader skip the offset tag -> the "own offset wins" web test red. 2. Make the reader decode the whole file -> the 30 MB speed test red. 3. Add a latitude tag id to the file -> the source check red. 4. Make a corrupt file throw -> the never-throws tests red. 5. Show `photoNoTime` when the reader was not run -> slice 2's `'unread'` test red.

### Verification

- **Browser, real files, three languages, ~390 px and desktop:** pick, in turn, an original phone JPEG exported to disk (keeps tags), a copy with tags stripped (`exiftool -all=`), a screenshot, an older-than-21-days photo, and a HEIC. Confirm each shows the right line, and that the old one shows the too-old card.
- **Real devices (spec marks C6 and C8 [confirm]):** pick a fresh photo in iPhone Safari and in Android Chrome on the **deployed** (or tunnelled) website, and record whether the "Photo taken ..." line appears. That is the check, and it is also what answers Decision A for the future: if neither phone browser keeps the time, 2W's value is laptop users only, and that goes in the PR.

### Rollback

Revert. The website goes back to dating library photos at the moment they are picked; nothing stored changes.

---

## Slice 3 · The owner's "seen on Tuesday" push, and the reward screen's last-seen date

**What a spotter sees afterwards.** A cat's owner who gets a push for a sighting from a photo more than 24 hours old sees "Agatha was seen on Tuesday" instead of "Agatha was spotted again!". Everyone else who follows the cat gets the unchanged evening round-up. A spotter who logs a 10-day-old photo of a cat another spotter saw yesterday is told, on the reward screen, that the cat was last seen **yesterday**, not 10 days ago.

**Branch / PR:** `claude/syc-166-owner-push-last-seen`. Server only. Independent of slices 2 to 5 and of the app: it can ship any time after slice 1, even before any app can send an old time (today's apps can already queue a sighting for days, so the owner's push for a late sync is already misleading).

### What the code does today (verified on `7089870`)

- Resolve builds the update message in `artifacts/api-server/src/routes/sightings.ts:822-829`: `isNewCat ? "<cat> was just discovered on Syros!" : "<cat> was spotted again!"`, then `createUpdateAndFanOut(...)`.
- `fanOutNotifications` (`lib/notificationFanout.ts:71-135`) writes a notification row for the followers who are the cat's owner only (`:112-115`, "only the cat's owner hears about a sighting straight away"), and pushes `opts.update.message` with the cat's name as the title (`:121-127`).
- The evening round-up (`lib/sightingRoundUp.ts`) builds its own text from cat names and never reads the update message (`roundUpText`, `:66-80`), keyed to when the update row was written (`cu.created_at` in the query at `:131-143`). So changing the stored message cannot change the round-up. Test 14 asserts that.
- Sighting updates are **excluded** from the public cat timeline (`routes/cats.ts:296-307`, `ne(updateType, "sighting")`), so a weekday in the message reaches the owner's notification row and push only.
- **Last seen on the reward screen:** the resolve response sets `lastSeenAt: sighting.createdAt` (`sightings.ts:868`), this sighting's own (possibly backdated) time. The cat list instead uses `max(sightings.created_at)` (`lib/catHelpers.ts:431`). The two disagree exactly when an older photo is logged after a newer sighting.
- Streak days (Athens, `lib/streak.ts:13`), the death rule and the team's timeline already use the stored capture time and need nothing (spec §6).

### Files

- New `artifacts/api-server/src/lib/sightingMessage.ts` (pure): `spottedAgainMessage(catName, sightingAt, now)`.
- Edit `routes/sightings.ts` in exactly two places (`:822-829` and the `countRow` query at `:835-838` / `:868`), nothing else.
- New tests `lib/sightingMessage.test.ts` and `routes/sightings.lastSeen.test.ts`; extend `routes/sightings.resolve.test.ts` or a new `routes/sightings.ownerPush.test.ts` for the push.

### Steps (test first)

1. **`sightingMessage.test.ts`** (spec test 14): within 24 hours (23 h 59 min) -> "Agatha was spotted again!"; at 24 h 01 min -> "Agatha was seen on Tuesday" (weekday computed in **Europe/Athens**, the same zone as the streak, `lib/streak.ts:13`); a sighting that is "tomorrow" by Athens vs UTC around midnight uses Athens; **older than 6 days -> "Agatha was seen on 3 October"** if Decision D is approved (otherwise the weekday, which is ambiguous beyond a week; photos can be up to 21 days old, so "Tuesday" can mean three Tuesdays ago); a new cat's message stays "was just discovered on Syros!" (no recipient exists for it, since a new cat has no owner; the test pins that no owner means no notification).
2. **Owner push route test:** with a stubbed `sendPushNotification`, resolve a sighting backdated 3 days for a cat with an owner subscribed: the push body is "... was seen on <weekday>"; backdated 1 hour: "... was spotted again!". **The evening round-up for the same two cases is byte-identical to today's** (run `sightingRoundUp`'s planner with both and assert the same `roundUpText`).
3. **`sightings.lastSeen.test.ts`** (spec test 12): cat last seen yesterday by another device; a new sighting dated 10 days ago resolves to that cat; the response's `cat.lastSeenAt` is yesterday's day, not the 10-day-old day. Second case: the new sighting is the newest -> its own day. The value goes through `serialiseCat` -> `toPublicDay` (`catHelpers.ts:160`), so it is a day, not a time.
4. **Implement:** compute `latest = max(created_at)` of the cat's sightings in the same query that already counts them (`select count(*), max(created_at) ... where cat_id = ...`), and use `latest` for `lastSeenAt`. The message helper replaces the template literal.

### Mutation probes

1. Revert `lastSeenAt` to `sighting.createdAt` -> `lastSeen` test red. 2. Compute the weekday in UTC -> the near-midnight test red. 3. Change the threshold to 48 h -> the 24 h 01 min test red. 4. Make the helper also run for the round-up text -> the round-up identity test red.

### Verification

- Server tests and typecheck. Probe with `curl` against a local API and database: create and resolve a sighting with `capturedAt` three days ago for a followed, owned cat; read the owner's notification row via the app's notifications endpoint and confirm the text; read the resolve response's `cat.lastSeenAt`.
- No app change, so no browser or device check. The push text is English only, like all server text (spec §8).

### Rollback

Revert; old texts return. Update rows already written keep their text.
