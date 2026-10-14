# Starting the map where (and when) a library photo was taken: implementation plan (SYC-166)

**Spec:** `docs/specs/photo-location-from-library.md`, approved by Samuel on 14 October 2026, every decision as recommended (Decisions 1 to 7). Its [review](../../specs/reviews/photo-location-from-library-review.md) is folded into the spec (§13).
**Samuel's condition on the build (Linear, 14 October):** build the photo's date and time first, because it works whatever the device check finds. "Start the map where the photo was taken" is a separate, later slice that waits on the device check (SYC-280). **SYC-258 ships first**, and SYC-166 must not ship before it (spec §5.1).
**Status:** for Samuel's approval. Nothing here is built. This document changes no code.
**Checked against:** `origin/main` at `7089870` (merged 14 October 2026, 04:04 UTC). Every "exists today" claim names the file and line it was read at on that commit. Platform claims the spec marks **[confirm]** are not treated as fact anywhere below.

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
- `lib/i18n.ts`: five keys in en, el, fr: `photoTakenAt`, `photoNoTime`, `photoTooOld`, `photoAlreadyLogged`, `photoAlreadyLoggedOpen`. Inserted as one clearly named block headed `// SYC-166 slice 2` in each dictionary. Expect a rebase: other tickets add keys too, so textual conflicts are likely and are resolved by keeping both blocks.
- `context/DeleteMyDataContext.tsx`: one line in `wipePhone` (`:88-95`) calling `clearRecentPhotos()`, see "Privacy" below.
- `app/review.tsx`: **only if Decision C2 is approved**, one call after a successful resolve that records the cat's number against the photo's entry in the recent-photos list (so "Open that sighting" can reach the cat's page).
- Server test only: `artifacts/api-server/src/lib/imageValidation.exif.test.ts` (SYC-260's XMP line).
- New server test `artifacts/api-server/src/routes/sightings.backdatedPublic.test.ts`.

**Not touched:** `lib/offlineQueue.ts`, `lib/queueStore.ts`, `lib/reportQueue.ts`, `context/OfflineContext.tsx`, `context/ReportQueueContext.tsx`, any server route, any schema.

### The clock (spec §3.4), exactly

`extractTimeTags(exif)` takes whatever `asset.exif` is and returns **only** these strings, if present: `DateTimeOriginal`, `OffsetTimeOriginal`, `SubSecTimeOriginal`, `GPSDateStamp`, `GPSTimeStamp`. It accepts a flat dictionary (Android shape) and one nested under `{Exif}` / `{GPS}` (the iPhone's native shape), and **returns nothing else**. In particular it does not return, copy or keep any latitude, longitude, altitude or accuracy value. This is the privacy line for slice 2: asking the picker for `exif: true` puts the photo's GPS in memory on the phone for the lifetime of the `asset`; the extractor is the only code that ever sees that object, and the object is not stored in state, passed on, or logged (test below). The exact key shapes must be captured from a real iPhone and Android for the fixtures; until SYC-280's results are in, the fixtures are written from the picker's documented shape and the iOS simulator (see Verification), and both shapes are accepted.

`resolvePhotoTime(tags, now)` returns one of:
1. **Photo time plus its own offset** (`DateTimeOriginal` + `OffsetTimeOriginal`): the instant is exact. Source `photo+offset`.
2. **No own offset, GPS clock present** (`GPSDateStamp` + `GPSTimeStamp`) and the two are within 24 hours of each other: offset = (photo wall-clock read as if UTC) minus (GPS time), rounded to the nearest 15 minutes. Instant = wall-clock minus that offset. Source `photo+gps-offset`. **Plan hardening, not in the spec:** the derived offset is accepted only if it is within 3 minutes of a **whole-hour** offset between -12:00 and +14:00. A phone that reuses an hours-old fix gives an off-grid difference; and a 30-minute-stale fix gives a derived offset of 2:30 or 3:30, which is on the 15-minute grid and would otherwise shift the photo by 30 minutes, so half-hour zones are not inferred (a photo from a half-hour zone is read as Greek time). An hour-stale fix still passes and is wrong by an hour: a known limit. See Decision B for Samuel.
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
- **Written** only for a sighting the server accepted as a cat photo (after "sent" with `isCatPhoto !== false`, not a `rejected` outcome, `spot.tsx:477`'s `case 'sent'`), so a photo rejected as "not a cat" or one that fails matching can be re-picked (review M5)); previously: after "sent" (`spot.tsx:477`'s `case 'sent'`) and after a successful `enqueue` (`:453`). Nothing is written for a failed send or a photo that is cleared.
- **Delete my data** (`DeleteMyDataContext.tsx:88-95`): `wipePhone` also calls `clearRecentPhotos()`. This matters because spec §5.8 says "nothing new is stored that [delete-my-data] would miss", and Decision 2 B stores something new (see Spec vs code).

### The Spot screen

- `choosePhoto` (`spot.tsx:239-288`) passes `exif: true` to `launchImageLibraryAsync` only (not the camera: a camera photo is taken now). It returns `{ photo, timeInfo }` from `pickedAsset.ts`; `replaceRejectedPhoto` (`:398-412`) keeps ignoring the time info (it preserves the old item's time on purpose: a rejected sighting's replacement photo is for the same sighting) and gets a one-line comment saying so.
- `pickPhoto` for the library: if `timeInfo.kind === 'tooOld'`, set a new `photoProblem` state (`{ kind: 'tooOld', date }`) and **do not** set the photo. The Spot screen shows the explanation in the same card style the other photo errors use, with a "Choose from library" button that calls `pickPhoto(false)` directly from its own tap (a browser only opens a file chooser from a direct tap, which is why this is an inline card and not an `await`ed dialog; the camera code makes the same point at `spot.tsx:315-318`). If `kind === 'ok'`, `setCapturedAt(instant.toISOString())` and show `photoTakenAt`. If `none`, `setCapturedAt(now)` as today. `photoNoTime` is shown **on phones only, and only when the picker returned a populated `exif` object with no usable time** (including a future or malformed time, for which the same line is shown: the photo does say something, but nothing we can use; the PR says so). **An absent, null or empty `exif` is `unread`**: no line, recorded as now, because Android's picker may return nothing for a JPEG that does carry a time (C4 unconfirmed) and "doesn't say when" would then be untrue. On the website `timeInfo.kind` is `'unread'` and no line is shown, because we have not read the file (that is 2W).
- `photoProblem` is cleared by `clearPhoto` (`:233`) and by a new pick.
- `submit` (`:419`): `sightingTime` goes through `uniqueCaptureTime` before it is sent or queued.
- The line "Photo taken ..." sits between the photo card (`NewSpotIntro`, `:826`) and "Where did you see it?".
- `confirmLocationHint` ("It starts near where you are.") is unchanged in this slice.

### Steps (test first, each its own commit)

1. **Probe first, server:** in `imageValidation.exif.test.ts` add `expect(outputMeta.xmp).toBeUndefined()` to both existing cases and a fixture whose *input* carries an XMP block with a position (`sharp` `withMetadata` XMP, or a hand-built APP1 segment), asserting `inputMeta.xmp` is defined first, as the existing test does for EXIF (`:48-56`). If sharp's re-encode leaves XMP in, this is a **real server bug found early**: fix it in `imageValidation.ts` in the same commit and say so in the PR. (SYC-260.)
2. **`photoClock.test.ts`, red then green** (spec §9 tests 1 (time half), 2, 3, 13):
   - `photo time plus its own offset wins` (iPhone fixture, `+03:00`).
   - `GPS clock fills a missing offset`: photo `2026-10-03 18:42:10`, no offset, GPS `15:42:00 UTC` on the same date, gives 15:42:10 UTC.
   - **`GPS clock 30 minutes off the photo time: the photo time wins`** (spec §9 test 2's named fixture). Written two ways: with an own offset (own offset wins outright), and without one (the derived offset would be 2:30 or 3:30, a half-hour zone, so the GPS clock is distrusted and Athens time is used; under the spec's literal rule it would be accepted, which is Decision B's sub-question). Separate cases with a **7-minute** and an **11-minute** gap (off-grid, so distrusted) and a **60-minute** gap (accepted, wrong by an hour: the pinned known limit).
   - `GPS clock alone never sets the time` (no `DateTimeOriginal` -> `none/missing`).
   - `no offset, no GPS clock -> read as Greek time`, summer and winter.
   - `25 October 2026 03:30 is one defined instant` (the earlier one); `28 March 2027 03:30 (nonexistent) resolves to 04:30`.
   - `OffsetTimeOriginal` oddities: `""`, `"+0300"` (no colon), `"Z"`, `"+25:00"` and `"garbage"` are each either parsed to the same instant as the canonical form (`+0300`, `Z`) or treated as absent (empty, out of range, garbage), never thrown on; a future-dated and a `0000:00:00 00:00:00` photo time give `none` with the `photoNoTime` line.
   - `a future time and an unreadable time fall back to none`; edge: now + 5 minutes accepted, now + 5 minutes + 1 ms refused.
   - **`the 21-day edge`**: one minute inside is `ok`, one minute outside is `tooOld`, and the `photoTooOld` text carries the right date and `21`.
   - `MAX_QUEUE_AGE_MS minus the photo limit leaves at least 9 days` (imports `MAX_QUEUE_AGE_MS` from `offlineQueue.ts`): the relationship that made 21 days the answer in Decision 1 is pinned, so changing either constant fails loudly.
   - `a phone set to Berlin still shows Greek time`: with `process.env.TZ='Europe/Berlin'` for the test, a photo at 18:42 Greek time displays "18:42 (Greek time)" (spec §9 test 13).
   - `extractTimeTags` shapes: iPhone nested `{Exif},{GPS}`, Android flat, both with a fixture GPS position of `37.4412345, 24.9412345` present in the input, and `JSON.stringify(output)` contains **no** part of it (value-based privacy test; the extractor cannot leak what it never returns).
3. **`pickedAsset.test.ts`** (spec §9 test 7): with a mocked asset and a fake `shrink`, the over-15 MB path and the weak-connection path give the **same** time info as the plain path. A source check: `.exif` is read in exactly one file (`pickedAsset.ts`), `asset.exif` is never assigned to state, passed into a hook, or logged anywhere under `app/`, `components/`, `context/`, `hooks/` or `lib/` (same style as `reviewRoutes.test.ts`'s scan).
4. **`recentPhotos.test.ts`** (spec §9 test 9): a photo the server rejected as not-a-cat (`isCatPhoto: false`) or whose send was rejected is **not** recorded, and re-picking it is allowed; two different photos with the same second make two entries, the second one millisecond later; three in one second get +0, +1, +2; the same photo picked twice is caught (`already-logged`) and returns the stored `localId`/`sightingId`; a retry of one send (not recorded, because it never succeeded) returns the identical time; entries older than 30 days and beyond 200 are dropped; corrupt storage returns an empty list and never throws; `clearRecentPhotos` empties it.
5. **Implement** the three libs, then the Spot wiring, then the five i18n keys with the spec's §8 text verbatim, then the `wipePhone` line. `lib/__tests__/i18n.test.ts` already enforces: same keys in all three languages, same `{placeholders}`, French in "tu".
6. **Server test** `sightings.backdatedPublic.test.ts` (spec §9 test 8, new part): a sighting created with `capturedAt` 20 days ago still serialises with a **date only** in every public payload that shows it (cat list, cat page sightings list), asserted against the real serialiser output.
7. **Walk the flows** (Verification), then a draft PR.

### Tests that must exist when this slice ships (spec section 9 mapping)

Test 1 (time half), 2, 3, 7, 9, 13 and 10 (the five keys), plus 8's server parts. Also **6a and 6b** (the request carries exactly `deviceId, photoBase64, lat, lng, capturedAt`, with the confirmed pin; the queued item's keys equal the existing set exactly; both asserted in a case where the pin differs from anything photo-derived), cheap and in this slice. Tests 4 (slice 2W), 5 (slice 4/5), 6c (slice 1), 6d and the position parts (slice 5), 11 (5), 12 and 14 (3), 15 (5).

### Mutation probes (the limit, the order and the dedupe are silent failures)

1. Delete the 21-day check -> `the 21-day edge` red.
2. Make the GPS clock win over the photo time -> the own-offset 30-minute fixture red. Accept half-hour offsets -> the no-offset 30-minute case red. Remove the 3-minute tolerance -> the 7- and 11-minute cases red.
3. Read the wall-clock as UTC instead of Athens -> the summer/winter test and the DST tests red.
4. Accept a future time -> `a future time` red.
5. Remove the one-millisecond bump -> `two different photos with the same second` red.
6. Make the fingerprint a constant -> `two different photos` red (different photos are wrongly called the same); make it always differ -> `the same photo picked twice` red.
7. Record the entry before the send succeeds -> `a retry of one send returns the identical time` red.
8. Store `asset.exif` in state or pass it to a logger -> the source check red, and the value-based `JSON.stringify` test red if the extractor is bypassed.
9. Show `photoNoTime` on the website, or when `exif` is empty/null on a phone -> the `'unread'` tests red (tests: `empty exif object -> unread`, `null exif -> unread`, `exif with only GPS keys and no time -> none, line shown`).
11. Add a field (a `photoTakenLat` or any new key) to the request body or to the queued item -> the key-set tests red.
10a. Record the fingerprint for a rejected photo -> the not-a-cat re-pick test red.
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

**Why it is its own slice, and the one thing the spec leaves open.** The spec says the website reader is "sized to what the device check shows" (§4.1, Decision 4). Samuel's condition says build the date and time first because it works whatever the device check finds. Those pull in different directions for the website: the only reader worth building before the check is the **time-tags-only** one, which is also the part every surviving branch of spec §4.3 needs (the full reader, "time only on web", and everything but "neither arrives on the website"). The cost of guessing wrong is a small reader that finds nothing and degrades to today's behaviour. **Building the website reader before the device check departs from approved Decision 4's wording ("built after the device check") and needs Samuel's explicit yes; approving this plan is not that yes.** If he says no, 2W moves to after SYC-280 and slice 2 ships as written. **This is Decision A for Samuel.** The plan recommends building 2W straight after slice 2; the alternative is to hold it until SYC-280 has filled in C6 and C8.

**Branch / PR:** `claude/syc-166-web-time-reader`, after slice 2 is merged **and Samuel has said yes to Decision A** (it reuses `photoClock.ts` and the Spot wiring).

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

1. `jpegTimeTags.test.ts` (spec §9 test 4, time-only variant): a JPEG with time tags and an own offset; one with time and a GPS clock but no offset; one with no Exif; big-endian and little-endian; truncated mid-IFD; corrupt (random bytes after the marker); a pointer loop; a 30 MB base64 string (asserts it returns in under 50 ms because only the head is decoded); a HEIC header; a PNG; an empty string; non-base64 text. All return a value or `null`, none throw. Plus a **fuzz test**: 2,000 random single-byte mutations and truncations of a valid fixture (seeded, so failures reproduce), none of which may throw or exceed the step budget. **A fixture with a GPS position inside it: the output contains no part of the position** (value-based).
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
- `fanOutNotifications` (`lib/notificationFanout.ts:71-135`) writes a notification row for the followers who are the cat's owner only (`:106-109`, "only the cat's owner hears about a sighting straight away"), and pushes `opts.update.message` with the cat's name as the title (`:120-127`).
- The evening round-up (`lib/sightingRoundUp.ts`) builds its own text from cat names and never reads the update message (`roundUpText`, `:67-80`), keyed to when the update row was written (`cu.created_at` in the query at `:130-140`). So changing the stored message cannot change the round-up. Test 14 asserts that.
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

---

## Slice 4 · The map always has a start: Ermoupoli when there is no usable phone position

**What a spotter sees afterwards.** A spotter who picks a library photo while their phone has no usable position (location refused, still searching after a few seconds, or the phone is not on Syros: a tourist logging from the plane) no longer sees a missing map and a disabled "Check for matches". The map opens on Ermoupoli with "We've started the map in Ermoupoli. Drag it to where you saw the cat.", the button works, and they drag the pin to the right street. A spotter whose phone is on Syros sees exactly what they see today. The camera is unchanged (spec §1; see Decision F for the one camera dead end that remains).

**Branch / PR:** `claude/syc-166-ermoupoli-start`, after slice 2 is merged. No spec dependency on the device check: this slice needs no photo position.

### What the code does today (verified on `7089870`)

- The pin starts only from the phone: `spot.tsx:228-231` sets `pickedCoords` once `photo && coords && !pickedCoords`. With no `coords` the map is never rendered (`:861`, `{pickedCoords && <LocationPicker .../>}`) and "Check for matches" stays disabled (`:885`, `disabled={!pickedCoords || ...}`). Location permission refused shows the red `locationDenied` text (`:854-860`).
- `useLocation` (`hooks/useLocation.ts`) gives `coords`, `denied`, `loading`. On the phone, a position that does not arrive in 15 seconds with no cached fix sets `denied` (`:56-86` region, the `Promise.race` timeout); on the website the browser call times out at 10 seconds (`timeout: 10000`, `hooks/useLocation.ts:28-30`).
- The map positions itself from its first coordinates only (`components/LocationPicker.tsx:30-32`, native; `LocationPicker.web.tsx:47`, web), so a screen that changes its start must give the picker a fresh `key` (spec §9 test 5's parenthesis). `<LocationPicker>` has no `key` today (`spot.tsx:862`).
- The island rectangle exists only as an un-exported constant in the tile downloader: `lib/offlineTiles.ts:19`, `{ minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 }`. It is a tile box, not a coastline, and nothing checks a position against it.

### Files

- New `artifacts/cat-spotter/lib/island.ts` (pure): `SYROS_RECT` (moved from `offlineTiles.ts`), `isOnSyros(lat, lng, marginDeg = 0.02)`, `ERMOUPOLI = { latitude: 37.4449, longitude: 24.9433 }`. SYC-249 (the server's on-Syros check) will want the same rectangle; keeping it in one small file makes it copyable to the server unchanged.
- New `artifacts/cat-spotter/lib/mapStart.ts` (pure): `resolveMapStart(input)`.
- Edit `lib/offlineTiles.ts` (import the rectangle; one line, no behaviour change).
- Edit `app/(tabs)/spot.tsx` (use the resolver; `key` the picker; the Ermoupoli line; the red denied text hidden when the map already has a start).
- Edit `lib/i18n.ts`: `mapStartedInTown` in en, el, fr, in the same `// SYC-166` block.
- Tests: `lib/__tests__/island.test.ts`, `mapStart.test.ts`.

### `resolveMapStart`

Input: `{ source: 'library' | 'camera' | 'live', phone: {coords|null, denied, loading}, waitedMs, photoPosition?: undefined }` (the `photoPosition` field is slice 5's; the resolver is written to take it from the start so slice 5 adds a branch, not a rewrite). Output: `{ status: 'waiting' }` or `{ status: 'ready', coords, origin: 'phone' | 'town' }`.

- Camera and live-camera picks: unchanged (`origin: 'phone'` when coords arrive; `waiting` otherwise; it never falls back to Ermoupoli).
- Library pick, phone position on Syros (`isOnSyros` with the margin): `origin: 'phone'`.
- Library pick, phone position **not on Syros**, or `denied`, or still searching after `MAP_START_WAIT_MS = 4000`: `origin: 'town'` -> `ERMOUPOLI`.
- A start from Ermoupoli **may be replaced by a later on-Syros phone fix until the spotter first touches the map** (drag, tap or zoom); after that, nothing replaces it, so the pin never jumps under a spotter who has begun dragging. A start that came from the phone is never replaced. Test: late fix before touch moves the pin; after touch it does not.
- Retake and re-pick reset it; the picker is remounted with `key={pickCount}` (a counter bumped in `pickPhoto`), so a new start actually repositions the map.

The "until first touch" rule keeps a slow-GPS spotter from being frozen on Ermoupoli. The wait of four seconds and the island margin of 0.02 degrees (about 2 km) are the plan's own numbers; the spec says only "still searching" and "a small margin". They are Decision E. Why 0.02: the nearest other islands are well clear of the rectangle plus 2 km (Tinos town, at 25.163 E, is more than 10 km past the rectangle's east edge at 25.01 E; Mykonos and Paros are further), while the rectangle itself is a tile box, so a margin lets a photo taken at the very edge of the coast count as Syros.

### Words (spec §8)

`mapStartedInTown`: en "We've started the map in Ermoupoli. Drag it to where you saw the cat.", el "Ξεκινήσαμε τον χάρτη στην Ερμούπολη. Σύρε τον εκεί όπου είδες τη γάτα.", fr "On a démarré la carte à Ermoupoli. Fais-la glisser là où tu as vu le chat." It replaces `confirmLocationHint` only when `origin === 'town'`. When `origin === 'phone'` for a library photo, `confirmLocationHint` stays ("It starts near where you are.") until slice 5 replaces it, because until slice 5 that sentence is still true. No other new line ships here; in particular **not** `mapStartedAtYou`, which says the photo "doesn't say where it was taken" and would be false for an iPhone photo we have not yet read.

### Steps (test first)

1. `island.test.ts`: points inside the rectangle; each edge exactly, one metre inside and one metre outside the margin; known places outside, with real coordinates: Tinos town (37.538, 25.163), Mykonos town (37.447, 25.329), Parikia on Paros (37.085, 25.150), Athens (37.984, 23.727), Munich (48.137, 11.575), and Null Island (0, 0) are all **not** on Syros; Ermoupoli and two coastal points taken from a map when the test is written (Finikas, Kini) are.
2. `mapStart.test.ts` (spec §9 test 5): library + phone on Syros -> phone; library + phone in Munich -> Ermoupoli; library + denied -> Ermoupoli; library + still loading at 3,999 ms -> `waiting`, at 4,000 ms -> Ermoupoli; library + phone fix arrives *after* the town start and **before** any touch -> the start moves to the fix; **after** a touch -> it does not move; camera + denied -> never Ermoupoli; the button's enabled state follows `status === 'ready'`.
3. A component test for the Spot screen's "Check for matches" button (the repo renders components through react-native-web, `vitest.config.ts`): enabled once the start is `ready`, disabled while `waiting`.
4. Implement; add the key and the three strings.

### Mutation probes

1. Make the resolver fall back to Ermoupoli for the camera too -> the camera test red. 2. Drop the margin -> the edge test red. 3. Let a late phone fix overwrite the start after a touch -> the "does not move" test red; never replace at all -> the "before touch" test red. 4. Remove the picker `key` -> a test that re-picks and asserts the picker's initial coordinates changed (render both, as `LocationPicker.web.tsx:47` fixes its start in `useState`) red. 5. Show the Ermoupoli line when the start is the phone -> the line test red.

### Verification

- Automated: typecheck, tests.
- **Browser, both widths, en/el/fr, real data:** in the website with Chrome's location override set to Munich, then "block" in site settings, then a Syros position, pick a photo each time and confirm map, line and button. The 4-second wait is checked with the position override delayed.
- **iOS simulator:** Features -> Location -> None / Custom (Munich) / Custom (Ermoupoli).
- **Real-device check:** none required for this slice (no platform claim marked [confirm]); a quick pass on one real iPhone and one real Android with location refused is cheap and goes in the PR.

### Rollback

Revert. Nothing is stored.

---

## Slice 5 · The map starts where the photo was taken (WAITS ON SYC-280)

**What a spotter sees afterwards, per platform, and only where the device check says the position arrives.** Where the photo says where it was taken, the map opens on that spot with "We've started the map where this photo was taken. Drag it if that's not quite right." (or the firmer "only approximate" line when the photo records a rough fix); the saved sighting is still only the pin they confirm. A spotter with location switched off is no longer stuck. Where the photo does not say where (and we know the platform removes it), the map starts near them or in Ermoupoli and a line says honestly "This photo doesn't say where it was taken, so the map starts near where you are now." A photo whose position is **not on Syros** stops with "This photo was taken away from Syros. Cat Spotter only records cats on Syros." and two buttons, "Choose another photo" and a quiet "It was on Syros", which carries on as if the photo had no position (the photo's time is still used).

**Branch / PR:** `claude/syc-166-map-start-at-photo`, one PR per outcome row below if more than one platform is in scope.

### Gate (nothing in this slice starts until all four are true)

1. Slice 1 (SYC-258) is merged. The spec forbids shipping SYC-166 location work before it (§5.1).
2. Slices 2 and 4 are merged.
3. SYC-280's device check has run and the **results table in spec §4.2 is filled in** (a docs-only PR from whoever ran it; Claude can fill the iPhone simulator rows but the real-device rows are Samuel's or a tester's).
4. Samuel has answered the §4.3 question: **"if every phone path turns out to be time only, is the map-start work still worth building?"** (Decision G). If the answer is no, this slice reduces to the honest lines (below) and the rest is closed.

### Plan by outcome (spec §4.3). The plan does not read location on a guess: each row is built only if its row is confirmed.

| Device-check result | What this slice builds |
|---|---|
| **iPhone app: location arrives (C1), with or without the chooser's "Options -> Location" switch** | Native position reader on the picker's `exif`. If it arrives only with the iOS 17 "Location" option switched on and that option is off by default, the iPhone app is a "time only" row and a hint is considered (follow-up ticket "to file", not built here). |
| **Android app: location never arrives (C2, expected)** | Nothing to read. The honest line `mapStartedAtYou` is shown on Android library picks, because the platform is known to remove the location (Decision 5 of the spec; SYC-259 revisits). No reader code. |
| **Website: phone browsers keep location (C5/C7 pass)** | Widen slice 2W's reader to read the GPS position as well as the clock (the full reader). |
| **Website: phone browsers remove location but keep time** | Nothing to widen: the website reader stays time-only (spec "time only on web"). A time-only reader has not read the photo's position, so for a laptop-exported JPEG that does carry one, the spec's line "This photo doesn't say where it was taken" would be **untrue**. The plan therefore uses a neutral line on the website in this row ("The website can't read where a photo was taken, so the map starts near where you are now. Drag it to where you saw the cat.", one extra key in three languages). **Decision H.** |
| **Neither arrives on the website** | Slice 2W's `photoNoTime` becomes the honest line; no website location work at all. |
| **Locations arrive everywhere** | All of the above, full feature, nothing conditional. |

### What the code will do (for the rows that are built)

- **New `lib/photoPosition.ts` (pure):** `readPhotoPosition(exif)` returns `{ lat, lng, approx } | null`. It handles the iPhone shape (unsigned latitude plus `N`/`S` letter), the Android shape (signed plus letter, which must not double-negate), and the website's degrees-minutes-seconds rationals. Exactly 0, 0 is "missing", not a point in the sea. Out-of-range and non-numeric values are "missing". `GPSHPositioningError` over 150 m sets `approx` (spec §3.1, §6; `mapStartedApprox`).
- **`pickedAsset.ts`** calls it next to the time extractor, on the same `asset.exif`, and returns the position as part of the pick result. It is held **in React state on the Spot screen only** and cleared with the photo (`clearPhoto`, `spot.tsx:233`). It is never put in a route parameter, a queue field, a log line, an error message or a storage key (see "Privacy paths").
- **`mapStart.ts`:** the resolver gains its first branch: photo position on Syros -> `origin: 'photo'` immediately, **even if the phone's own position arrives afterwards** (spec test 5); photo position off Syros -> `{ status: 'offIsland' }`; no photo position -> slice 4's rules. `denied` is no longer a dead end when the photo supplied a start, and the red `locationDenied` text is hidden in that case (it hides today only when nothing is denied, `spot.tsx:854`).
- **The off-island stop screen** reuses slice 2's `photoProblem` card: "Choose another photo" calls `pickPhoto(false)` from its own tap; "It was on Syros" sets a flag that treats the photo as having no position (the time is kept) and re-runs the resolver.
- **The lines** (`mapStartedAtPhoto`, `mapStartedApprox`, `mapStartedAtYou`, `photoOffIsland`, `photoOffIslandChoose`, `photoOffIslandOverride`; spec §8, six keys) replace `confirmLocationHint` for library photos; the camera keeps it (spec §8).
- **Twelve keys, not eleven.** Spec §8's table lists twelve keys and its text says eleven (see Spec vs code); slices 2, 4 and 5 add 5, 1 and 6.

### Steps (test first)

1. `photoPosition.test.ts` (spec test 1, position half): every shape, both hemispheres, western longitudes, the 0,0 rule, out-of-range, non-numeric, `GPSHPositioningError` over and under 150, and a **fixture lifted from the device check** for each platform that delivered a position.
2. `mapStart.test.ts` additions (spec test 5): photo on Syros + phone fix arrives later -> stays at the photo; photo position + `denied` -> ready; no photo position + phone off-island -> Ermoupoli; "It was on Syros" -> as no position, time kept; retake and re-pick reset it.
3. Off-island tests (spec test 11) with real coordinates (Tinos, Mykonos, Athens, Munich): stop screen; "Choose another photo" re-offers the library; "It was on Syros" continues; a position on Syros never triggers it.
4. **Privacy tests, by value** (spec test 6): see the next section.
5. Offline test (spec test 15): website with the network off, a library photo with a position still starts the pin there and saves for later; **no assertion claims the map shows streets** (the website has no offline map, SYC-167).
6. Implement; wire the lines; add the six keys.

### Mutation probes

1. Let the phone's late fix overwrite a photo start -> test 5 red. 2. Put the photo position into `buildReviewParams` unrounded -> slice 1's whole-string test red. 3. Add `photoPosition` to the queued item or to the request body -> the key-set tests red. 4. Make `readPhotoPosition` double-negate the Android shape -> its fixture red. 5. Treat 0,0 as a point -> red. 6. Remove the off-island check, or make the margin huge -> test 11 red. 7. Log the parsed position -> the console-spy test red.

### Verification

- **Browser, three languages, ~390 px and desktop, real data,** for the website rows that are built; **iOS simulator** for the iPhone app with fixture photos carrying a position on Syros, off Syros (Mykonos), a rough fix (`GPSHPositioningError` 400), and none; **a real iPhone and a real Android** wherever the spec marks the platform claim **[confirm]** (C1, C2, C5, C7): the PR shows what the screen did on each, matching the results table in spec §4.2.
- Update `docs/specs/photo-location-from-library.md` §1 and §4 from "expectation" to fact for each confirmed row, in the same PR as the code that depends on it.

### Rollback

Revert. The pin is the only thing ever saved, so no stored data depends on this slice.

---

## Privacy: every path where a photo's position (or the exact pin) could escape

The spec's promise (§5): the photo's position is read on the phone, used to place the map, and is never stored as its own field, never logged, never sent anywhere new. The table lists every path the code offers, who owns the guard, and the test that proves it. A path with no test is a gap; there are none below.

| # | Path | Exists today? | Guard | Test (by value, not by field name) | Slice |
|---|---|---|---|---|---|
| P1 | **The review screen's address** (website address bar and history) carries the confirmed pin; an unmoved pin that started at a photo equals the photo's position | Yes, unrounded: `lib/reviewParams.ts:72-100`, passed from `spot.tsx:487-495` | Round to three decimals (about 110 m) in the one builder | Whole serialised string has no number with 4+ decimals; read-back equals the rounded value; mutation probes 1-4 | 1 |
| P2 | **The picker's `exif` object** holds the photo's full tags, GPS included, once `exif: true` is requested | No (not requested today) | One extractor is the only reader; it returns time strings only; the object is never stored, passed on or logged | `JSON.stringify(extractTimeTags(fixtureWithPosition))` contains no part of the fixture position; source scan: `.exif` read in exactly one file | 2 |
| P3 | **The parsed photo position in the app** | No | Held in the Spot screen's React state only; cleared by `clearPhoto`; module only imported by `pickedAsset.ts` (spec §9 test 6d) | Source check on imports; a test that after `clearPhoto` and after submit the state is `null` | 5 |
| P4 | **The saved-for-later item** | Position of the *pin* only (`spot.tsx:453-461`) | The queued item's keys equal the existing key set exactly; no new field | `Object.keys(enqueueArg)` equals `['localId','photoBase64','photoUri','lat','lng','createdAt']` (spec §9 test 6b) | 2 (time), 5 (position) |
| P5 | **The upload request** | Pin and `capturedAt` only (`spot.tsx:441-450`) | The request body's keys equal the existing set | Keys of the `createSighting` argument equal `['deviceId','photoBase64','lat','lng','capturedAt']` (test 6a); the value equals the confirmed pin, not the photo position, in a case where they differ | 2, 5 |
| P6 | **The photo file itself** still carries its tags on the phone until it is sent (queue, review photo store, upload) | Yes, unchanged (spec §5.4) | The server re-encodes without metadata before storing or matching (`validatePhotoBase64`, `sightings.ts:556`) | `imageValidation.exif.test.ts` (existing) **plus the XMP line (SYC-260), added as step 1 of slice 2**, with an XMP-carrying input fixture. Name data spine test 8 and 13 (`cat-record-data-spine.md` §10.8) in each PR description | 2 |
| P7 | **The welfare ("This cat needs help") handoff** takes the photo and the confirmed pin (`lib/reportHandoff.ts`, in memory only) | Yes, unchanged | The welfare route uses the same server stripper (spec §5.4); in-memory only | Confirm the existing welfare-route test covers a GPS-bearing photo; add the one-line case in slice 2 if it does not | 2 |
| P8 | **Console and error output** | Three unrelated `console.*` calls (`context/OfflineContext.tsx:498`, `context/DeviceContext.tsx:279`, `context/NotificationContext.tsx:128`) and `components/ErrorFallback.tsx:31`; none receives an item or a position. **No error-reporting service exists in the app** (searched) | No new logging in any new file | A console-spy test around `extractTimeTags`, `readPhotoPosition`, `resolveMapStart` and the Spot pick handler: nothing logged for a fixture photo | 2, 5 |
| P9 | **Server logs** | Request bodies are not logged; only headers are redacted (`lib/logger.ts:5-10`) and errors are logged as name and code (`safeError`, `:25-40`) | Unchanged; no new log line in the server slices | Run `app.logRedaction.test.ts` and `logger.test.ts` and name them in the PR; slice 3 adds no `logger.*` call (assert with a log-capture test around the resolve route with a backdated sighting) | 3 |
| P10 | **The owner's push text** | Cat name and a fixed sentence | Slice 3 adds a weekday (or a date) and nothing positional | `sightingMessage.test.ts` asserts the output matches `^[^\d]*(Monday\|...\|Sunday\|\d{1,2} [A-Z][a-z]+)$` and contains no digit pair resembling a coordinate | 3 |
| P11 | **Public payloads** (a backdated sighting) | Date only (`catHelpers.ts:160`) | Unchanged | `sightings.backdatedPublic.test.ts`; data spine test 8 stays green | 2 |
| P12 | **The recent-photos list** (new) | New | Stores capture times and a fingerprint, **never a position**; capped at 30 days and 200 entries; wiped by Delete my data | `recentPhotos.test.ts`: the stored JSON for a fixture with a position contains no part of it; `clearRecentPhotos` is called by `wipePhone` | 2 |
| P13 | **Third parties** | OpenStreetMap map tiles on the website learn the area the map is showing (spec §5.6) | Not new in kind; SYC-167 would reduce it. The AI matcher receives the stripped JPEG, never the original (`matching.ts` via `validatePhotoBase64`) | Existing matcher tests; no new third party is added by any slice | 5 |
| P14 | **Push and email carrying a place** | None carries a coordinate | No slice adds one | Covered by P10 | 3 |

**Principle behind the table.** The guard is always at the narrowest point (the extractor, the route builder, the one resolver) and the test reads the *serialised result*, so a new key name or a second code path cannot slip by (the plan's own "where else must this hold?" list is rows P1 to P14).

---

## Collisions with work in flight

| In flight | What it touches | How these slices avoid it |
|---|---|---|
| **SYC-44** ("Report an issue", plan on `claude/syc-44-plan`, build not started; it extends the welfare **report** queue and `ReportQueueContext`) | `lib/reportQueue.ts`, `lib/queueStore.ts` (the generic store, `queueStore.generic.test.ts`), `context/ReportQueueContext.tsx`, server report routes | **None of the five slices edits any of those files.** The 30-day staleness this work depends on is in `lib/offlineQueue.ts:14,56-64` (the *sighting* queue), which no slice edits either. The new recent-photos store is deliberately **not** built on `queueStore.ts`: it is a small capped list in its own key, so SYC-44 can change the generic store without touching it. The only shared file is `context/DeleteMyDataContext.tsx` (one added line in `wipePhone`, slice 2); if SYC-44 has edited it by then, rebase and keep both lines. A reviewer checks `git diff --name-only origin/main...HEAD` against this list in every PR. |
| **SYC-53** (roles and invites; person events as migration 0016, `authorityLevel`) | Server roles, schema | No slice touches the schema or a migration. No migration number is used by any slice. |
| **SYC-209** (feeding sites; migration 0015 merged, colonies pages in flight) | Cats pages, `app/cat/[id].tsx`, cat serialiser | Slice 3 changes only the resolve route's message and `lastSeenAt` and does not touch `serialiseCat` or cat pages. Slices 2/4/5 are confined to the Spot screen and new libs. |
| **SYC-2** (coat, markings, health; PR 1.2 on a branch) | Answers routes in `routes/sightings.ts`, observation kinds | Slice 3 edits two small regions of `routes/sightings.ts` (`:822-829`, `:835-868`); the helper lives in a new file so the edit stays tiny. **Before opening slice 3's PR, `git fetch` and run `git diff origin/main...origin/claude/syc-2-pr-1-2 -- artifacts/api-server/src/routes/sightings.ts`** (and the same for any open SYC-209/SYC-53 branch); if the regions overlap, rebase onto whatever merged first, never the reverse. |
| **`lib/i18n.ts`** (every ticket adds keys) | One 1,500-line file | Each slice inserts its keys as its own clearly named block (`// SYC-166 slice N`) in each of the three dictionaries. Expect a rebase and a textual conflict; resolve by keeping both blocks, and rebase immediately before opening the PR. `i18n.test.ts` fails on a missing or extra key. |
| **`app/(tabs)/spot.tsx`** (1,136 lines, shared with camera and offline work) | The Spot screen | Logic lives in new libs (`photoClock`, `pickedAsset`, `recentPhotos`, `mapStart`, `island`); the screen gets wiring only. `replaceRejectedPhoto` is left alone. |
| **Review agents** | Worktrees | One worktree per review agent, never shared (`LIF-79`). Mutation probes mutate the tree, so the reviewer works in its own checkout of the PR branch. |

Slices are numbered so that nothing needs more than one open PR at a time except 2W and 3, which are independent of each other and can overlap.

---

## Model delegation

**The session writing and orchestrating this plan runs on Sonnet.** Sonnet is the default tier for the build; the plan escalates to Opus only where a mistake would be a silent location-privacy failure, with a one-line reason each, and delegates mechanical work to Haiku with a named check. **Every sub-agent prompt states its tier, restates the crash-proofing rule verbatim ("commit after each item; write a checkpoint note, what is done and what is next, to the worktree; never hold work only in memory"), and forbids sub-delegation.** Each sub-agent works in its own worktree off fresh `origin/main`; each review agent in its own, never shared (`LIF-79`). "Review and merge" goes through `/ship` (an independent adversarial review is run because Claude built the PR; the `/ship` run folds findings in, checks CI, merges, flips SYC-166 and the slice's ticket, files deferred items, removes the worktree and branch, and pulls `main`). Real-device checks are done by Samuel or a tester and are not delegable.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| **Slice 1:** round the position in `reviewParams.ts` and its tests | **Opus** | The only job is to prove no unrounded position can reach an address. A missed path is a silent privacy failure with a green suite. The change is ten lines, so Opus's cost is small. | Tests that read the serialised string (P1); **mutation probes 1-5**; adversarial review by an Opus agent in its own worktree; browser check of `location.href` and `history.state` at ~390 px and desktop |
| **Slice 1:** browser check | Sonnet (browser tools) | Standard probe | Screenshot plus the two JS reads pasted into the PR |
| **Slice 2:** `photoClock.ts`, `pickedAsset.ts`, `recentPhotos.ts`, Spot wiring, server tests | Sonnet | Clear spec, standard pure code, heavy tests; the extractor is a narrow, value-tested privacy line (P2) rather than a design problem | Test-first from the named list; **mutation probes 1-11**; typecheck; adversarial review by a Sonnet agent in its own worktree **told to try to get a GPS value out of the extractor and to break the clock order**; iOS simulator walk; real-device check (C3, C4) |
| **Slice 2:** the five i18n keys (en, el, fr) | Haiku | Copying spec §8 verbatim into three dictionaries | A throwaway script compares each string byte-for-byte with the spec's §8 table; `i18n.test.ts` (same keys, same placeholders, French in "tu"); diff spot-review by the session model |
| **Slice 2/2W:** fixture photos (exiftool-made JPEGs with chosen tags, the DST-night times, the same-second pair, the XMP-with-position input) and a README of expected results | Haiku | Mechanical, well specified | `exiftool -j` output of each fixture compared with the README by script; the tests that consume them go red if a fixture is wrong |
| **Slice 2W:** `jpegTimeTags.ts` | Sonnet | A binary parser with strict never-throw rules is fiddly but fully specified and fuzzable | The 2,000-case seeded fuzz test, the large-file speed test, the source check that no location tag id appears, mutation probes 1-5; adversarial review by a Sonnet agent in its own worktree; real files in the browser |
| **Slice 3:** `sightingMessage.ts`, the two small route edits, tests | Sonnet | Small, clear, server-side | Tests including the byte-identical round-up check; mutation probes 1-4; `curl` probe against a local API; adversarial review (Sonnet, own worktree) |
| **Slice 4:** `island.ts`, `mapStart.ts`, Spot wiring | Sonnet | Pure logic and small wiring, no new data leaves the phone | Test-first; mutation probes 1-5; browser check with the location override; simulator location presets; adversarial review (Sonnet, own worktree) |
| **Slice 5:** `photoPosition.ts`, `mapStart.ts` branch, the off-island card, the lines | **Opus** | The one slice where the photo's exact position lives in app state. A leak into a route, a queue field, a log line or the request body is silent and would be a real privacy failure for a charity's cat-guardian users. | Privacy tests P3-P5, P8 by value; **mutation probes 1-7**; **adversarial review by an Opus agent in its own worktree whose brief is the P1-P14 table**; simulator walk with position fixtures; real iPhone and Android (C1, C2, C5, C7) |
| **Slice 5:** website widening of the reader to read position (only if C5/C7 pass) | Sonnet, inside the Opus slice's PR | Extension of 2W's parser with the same fuzz harness | Same fuzz and speed tests, plus fixtures lifted from the device check |
| **Spec edits** (§1 and §4 turned from expectation to fact; §4.2 table filled in) | The session model (Sonnet) | Straight transcription of the device-check results | Samuel reads the diff; no code consumes it |
| **Adversarial review of this plan** | Sonnet, own worktree | Standing rule: an independent pass before Samuel reads it | Findings folded in before the plan is presented |
| **Integration, final synthesis, `/ship` runs** | The session model (Sonnet) | Judgment and sequencing | n/a |

**Where a less capable model's output is trusted, the check is deterministic and names the way it could fail.** For the three silent-failure guards (the 21-day limit, the clock order, the same-second dedupe) and the two privacy guards (rounding, never-leaking position), "tests pass" is not the assurance: it is the mutation probes listed in each slice, run in the delegate's own worktree with the red results pasted in the PR. The probes only prove the tests protect the sites we thought of. For "where else must this hold?", the plan enumerates the consumers instead: the privacy table P1 to P14 for position, and for time the full list of readers of the capture time (the streak, last seen, the team's food-and-water order, the death rule, the stale-queue rule, the round-up window) in spec §6, each of which is tested or deliberately unchanged in the slice that touches it.

---

## Spec vs code (where the approved spec and `main` disagree, or the spec is silent)

None of these reopens a decision Samuel made. Each says what the plan does.

1. **SYC-258's call sites.** The ticket and the spec's §5.1 describe the review route as carrying the pin from several callers. On `7089870` only one passes a position: the "sent" path (`spot.tsx:487-495`). `reviewPending` (`:531-537`) and `ReviewReadyBanner.tsx:37-44` pass none; queued items read their position from the queue in memory (`app/review.tsx:122-125`). The plan rounds in the builder anyway, because it is the choke point (slice 1).
2. **The picker version and the website.** The spec cites `expo-image-picker` 17.0.9; `package.json:48` says `~17.0.9` and the lockfile resolves 17.0.11 (`pnpm-lock.yaml:3936`). Its website code reads no tags (`ExponentImagePicker.web.js:111`) and its `exif` option exists for iOS and Android only. Consistent with the spec's reasoning; the plan simply pins the real version in the PR descriptions.
3. **Where the 30-day queue rule lives.** The brief pointed at `reportQueue.ts` / `queueStore.ts`; the sighting queue's staleness is `lib/offlineQueue.ts:14,56-64` (as the spec says). The report queue is SYC-44's, and no slice touches it.
4. **Twelve keys, not eleven.** Spec §8's table lists twelve keys (`mapStartedAtPhoto`, `mapStartedApprox`, `mapStartedAtYou`, `mapStartedInTown`, `photoTakenAt`, `photoNoTime`, `photoTooOld`, `photoOffIsland`, `photoOffIslandChoose`, `photoOffIslandOverride`, `photoAlreadyLogged`, `photoAlreadyLoggedOpen`); its prose and test 10 say eleven. The plan builds and tests twelve (5 in slice 2, 1 in slice 4, 6 in slice 5), plus one more if Decision H is approved.
5. **"Greek time" on first use only, or always.** Spec §3.4 says the line carries "Greek time" on first use if the phone's zone differs; §8's `photoTakenAt` string always ends "(Greek time)", and test 13 asserts it for a Berlin phone. The plan always shows it (simplest, and a spotter never has to wonder which clock).
6. **"Nothing new is stored" (spec §5.8) versus Decision 2 B.** B keeps a list of recent capture times and photo fingerprints on the device. That is new on-device data, so Delete my data must clear it. The plan does (`wipePhone`, slice 2) and tests it. It contains no position.
7. **"Time only on web" shows "doesn't say where" (spec §4.3).** With a time-only reader we have not read the photo's position, so the line could be untrue for a laptop-exported JPEG. See Decision H.
8. **Slice order.** The brief's slice 4 combined the off-island stop screen and the Ermoupoli start. The off-island screen needs a photo position, which nothing reads until slice 5. So the Ermoupoli start is slice 4, and the off-island screen is in slice 5.
9. **"Not stuck on location permission" (spec §3.1, §3.2).** Today a refused or slow location leaves no map and a disabled button, with a red message (`spot.tsx:854-860`, `:885`). Slice 4 fixes this for library photos without a photo position; slice 5 for those with one. A **camera** photo with location refused stays stuck, because the spec says the camera paths are unaffected (Decision F).
10. **"Still searching" has no number.** The phone's position can take 15 seconds before the app gives up (`hooks/useLocation.ts`, native `Promise.race`), 10 seconds on the website (`timeout: 10000`, `hooks/useLocation.ts:28-30`). Slice 4 uses 4 seconds (Decision E).
11. **"A small margin" around the island has no number, and the island rectangle is a tile box,** not a coastline (`lib/offlineTiles.ts:19`). Slice 4 uses 0.02 degrees (Decision E).
12. **"Seen on {weekday}" is ambiguous beyond a week.** Photos can be up to 21 days old, so "Tuesday" can mean three Tuesdays ago (Decision D).
13. **The GPS-clock rule's weak spot.** Spec §3.4's rule 2 (round to 15 minutes) cannot tell a stale GPS fix from a real zone. This matters most for Android, where the GPS clock may be the only help. Decision B.
14. **Last seen.** Confirmed as the spec says (`sightings.ts:868` uses this sighting's own time; the cat list uses the newest, `catHelpers.ts:431`). Slice 3 makes them agree.
15. **The server enforces nothing at 21 days.** The 21-day rule is the app's. A modified app can still send up to 30 days (`captureTime.ts:20`), as the spec accepts (§5.9, §12).
16. **`replaceRejectedPhoto`** (`spot.tsx:398-412`) swaps a rejected queued photo and keeps the item's old time on purpose. The spec is silent. Left unchanged; a library photo used as the replacement is not read for its time.
17. **The "Open that sighting" button (`photoAlreadyLoggedOpen`)** names a destination the spec does not define. Decision C.

---

## Decisions for Samuel

The spec's seven decisions are settled. These are the questions the plan itself needs answered. None blocks slice 1. A and B shape slice 2 and 2W; the rest can wait until their slice is next.

### Decision A · The website's date and time: build it now, or wait for the device check?

The website can only read a photo's date by looking inside the file itself. Whether phone browsers hand over the date at all is exactly what the device check (C6, C8) will tell us.

| | **A1. Build it straight after the phone apps (recommended)** | **A2. Wait until the device check has run** | **A3. Leave the website dating photos to the moment they are picked** |
|---|---|---|---|
| **What a spotter sees** | Laptop photos and any phone-browser photo that keeps its date are dated correctly; if the browser removed it, a line says so | Nothing changes on the website until the check is done, then the same as A1 | Today's behaviour on the website, permanently |
| **Benefits** | Honours "date and time first, works whatever the check finds"; the same reader is needed by every outcome except "neither arrives"; a small piece of code | No code written on a guess | Nothing to build or maintain |
| **Risks** | If phone browsers remove the date, the reader helps laptop users only | The website's date fix slips by however long the check takes | Website users, including the laptop-at-the-hotel tourists who benefit most, keep the wrong day |
| **Effort** | One small PR | Same, later | None |

**Recommendation: A1, as a departure from the approved Decision 4 wording that needs Samuel's explicit yes.** It costs little, it degrades to today's behaviour if browsers strip the date, and it avoids the website being the one place the headline fix is missing.

### Decision B · Working out the time zone when the photo doesn't say (mostly Android)

An iPhone photo carries its own time zone. An Android photo may not, so the spec lets the app work it out from the satellite clock stored with the photo. The weak point: a phone that reuses an old position fix writes a satellite time that is hours or minutes old, which would make the photo's time wrong by that amount.

| | **B1. Exactly as the spec says** | **B2. As the spec says, plus a plausibility check (recommended)** | **B3. Never work it out: always read the time as Greek time** |
|---|---|---|---|
| **What a spotter sees** | A tourist's photo from another zone is placed right; a stale fix can put a photo's time off by an odd amount of minutes | The same, except an off-grid result (a stale fix) is ignored and the photo is read as Greek time | Every no-zone photo is read as Greek time; a tourist logging a photo taken in another zone is out by that zone's difference |
| **Benefits** | Follows the approved text | Catches the commonest stale-fix error at no cost | Simplest, always predictable; right for every photo taken on Syros, which is nearly all of them |
| **Risks** | The odd-minute errors | A stale fix that happens to be a clean multiple of 15 minutes still passes (about two in five stale fixes) | Wrong by hours for photos taken in another zone |
| **Effort** | Spec | A few lines, two tests | Fewer lines than the spec |

**Recommendation: B2.** It stays within what Samuel approved and removes the likeliest silly result. B3 is a fair simplification if you'd rather have no clever step; say so and the plan drops the GPS-clock rule.

### Decision C · What "Open that sighting" does when you pick a photo you already logged

The spec says the message appears with an "Open that sighting" button, but not where it goes.

| | **C1. No button, just the message** | **C2. A button that goes to the right place (recommended)** | **C3. Always the cat's page** |
|---|---|---|---|
| **What a spotter sees** | "You've already logged this photo." and nothing to tap | Waiting in the saved-for-later list: opens that card. Already sent: opens that cat's page | The cat's page, or nothing if the cat isn't known yet |
| **Benefits** | Simplest; no extra code in the review screen | The honest answer to "where did it go?" | One destination |
| **Risks** | A dead end; the spec's twelfth key goes unused | Needs the cat's number remembered once the sighting is matched, which is one small call added in the review screen | A sighting still waiting to be matched has no cat page |
| **Effort** | Least | Slice 2 also touches `app/review.tsx` by one call | Medium |

**Recommendation: C2.**

### Decision D · The owner's push for a photo more than a week old

The spec says "seen on Tuesday". Photos can be up to 21 days old, so "Tuesday" can mean three Tuesdays ago.

| | **D1. Weekday for up to 6 days, the date after that (recommended)** | **D2. Always the weekday (the spec's text)** | **D3. Always the date ("seen on 3 October")** |
|---|---|---|---|
| **What the owner sees** | "seen on Tuesday", or "seen on 3 October" if older than a week | "seen on Tuesday" always | "seen on 3 October" always |
| **Benefits** | Never ambiguous; reads naturally | As approved | Never ambiguous |
| **Risks** | Two forms to test | Misleading beyond a week | Slightly less natural for yesterday |

**Recommendation: D1.**

### Decision E · Two numbers the spec leaves open

How long to wait for the phone's position before starting in Ermoupoli, and how far outside Syros' outline still counts as Syros.

| | **E1. Wait 4 seconds; 2 km margin (recommended)** | **E2. Wait until the phone gives up (10-15 seconds); 2 km margin** | **E3. Wait 4 seconds; no margin** |
|---|---|---|---|
| **What a spotter sees** | A map within 4 seconds; a photo from the edge of the coast still counts | A long wait with no map | A photo taken on the very edge of the island might be called "away from Syros" |
| **Risks** | A spotter with slow GPS gets Ermoupoli, though the map doesn't jump if their position arrives later | The "stuck" feeling this slice exists to remove | A wrong "away from Syros" stop screen, which has an "It was on Syros" way out but is irritating |

**Recommendation: E1.**

### Decision F · A camera photo when location is switched off

The spec leaves the camera alone. Today a spotter who photographs a cat with phone location refused cannot send it: no map appears and the button is disabled.

| | **F1. Leave it (the spec)** | **F2. Also start the map in Ermoupoli (recommended, as a separate small ticket)** |
|---|---|---|
| **What a spotter sees** | Still stuck with the red message | A map in Ermoupoli to drag to the right street |
| **Risks** | A dead end that is plainly the same bug | The cat was photographed *here*; Ermoupoli is a guess the spotter must correct (the line says so) |

**Recommendation: F2, filed as its own ticket so this feature's camera test ("camera path unchanged") stays true.**

### Decision G · If the device check shows every phone gives the time only

Spec §4.3 asks this directly: is the "map starts where the photo was taken" work still worth building?

| | **G1. Build it anyway** | **G2. Build only the honest lines and close the rest (recommended in that case)** | **G3. Stop at the time fix** |
|---|---|---|---|
| **What a spotter sees** | Nothing new (no position ever arrives) | A line saying the photo doesn't say where, on platforms known to remove it | Nothing |
| **Risks** | Dead code | Very little | The spotter wonders why the map starts near them |

**Recommendation:** decide when the results are in. If anything delivers a position, build it for that platform only; if nothing does, G2.

### Decision H · What the website says about location when it can read the time but not the place

Only matters if the device check says phone browsers remove location but keep time (so the website gets the time-only reader).

| | **H1. The spec's line ("This photo doesn't say where it was taken...")** | **H2. A neutral line: "The website can't read where a photo was taken, so the map starts near where you are now..." (recommended)** | **H3. No line** |
|---|---|---|---|
| **What a spotter sees** | A claim that may be untrue for a photo exported from a laptop | An honest statement about the website | The old hint "It starts near where you are." |
| **Risks** | Untrue sometimes | One more key in three languages for native review (SYC-4) | None |

**Recommendation: H2.**

---

## Follow-up tickets this plan implies (to file; the orchestrator numbers them)

Not already covered by SYC-249, 250, 258, 259, 260, 280, 87 or 167.

1. **Camera photo with location refused: start the map in Ermoupoli too** (Decision F2). Small; `spot.tsx` and `mapStart.ts`.
2. **A guard test that Delete my data clears every on-device store.** The recent-photos list adds a key; a test that lists every key the app writes and checks each is cleared (or deliberately kept) stops the next one being missed.
3. **iPhone: a hint if photo location arrives only with the chooser's "Location" switch on** and that switch is off by default (conditional on SYC-280's C1; file only if so).
4. **Use a library photo's own time when it replaces a rejected photo** (`replaceRejectedPhoto`, `spot.tsx:398-412`): decide whether the replacement should keep the old time or take the new photo's, and apply the 21-day rule.
5. **Android: read the time from the file when the picker gives no tags** (conditional on SYC-280's C2/C4 showing empty tags on a JPEG).
6. **Add the SYC-166 entries to `DECISIONS.md`** (spec §11 leaves that for Samuel on approval; five bullets, including the age limit, the off-island rule, Ermoupoli and the owner's push).
7. **Native review of the twelve (or thirteen) new strings** as an addition to SYC-4's list.
8. **Share the Syros rectangle between the app and the server** for SYC-249's check: a comment on SYC-249 pointing at `lib/island.ts`, rather than a new ticket.

---

## Order of work, and what "done" means

1. Samuel approves this plan (and answers A and B at least; the rest can wait).
2. Slice 1 (SYC-258) -> `/ship`.
3. Slice 2, and in parallel slice 3 (they touch different files; neither touches the other's). SYC-280's device check can use slice 2's build.
4. Slice 2W (Decision A), slice 4.
5. SYC-280's results go into spec §4.2; Samuel answers G. Slice 5, per the outcome table.
6. After each merge: flip the slice's Linear ticket and SYC-166's progress note, file anything deferred, remove the worktree and branch, pull `main` (the standing `/ship` ritual).

SYC-166 is done when: the photo's date is right on every platform that gives it, the honest lines are only ever true, no position outside the confirmed pin can be found in an address, a queue item, a request, a log or a payload (table P1 to P14, each with a passing test), and the real-device claims marked **[confirm]** in the spec have been replaced by results.
