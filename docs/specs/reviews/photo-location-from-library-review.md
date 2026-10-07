# Adversarial review — `docs/specs/photo-location-from-library.md` (SYC-166)

**Reviewed:** 7 October 2026, by an independent adversarial reviewer (Opus, in its own worktree), against `origin/claude/syc-166-photo-location` at `43a23ff` (draft PR #101).
**Checked against:** `cat-record-data-spine.md` (§3.2, §6.4, §10.6, §10.8), `DECISIONS.md` (Part 2h), `offline-queue-on-web.md` §3.6, `choose-a-different-cat.md` §4; live code on `origin/main` at `c5ee36c` (`app/(tabs)/spot.tsx`, `lib/reviewParams.ts`, `lib/offlineQueue.ts`, `hooks/useLocation.ts`, `components/LocationPicker.web.tsx`, `lib/offlineTiles.ts`; server `routes/sightings.ts`, `lib/captureTime.ts`, `lib/imageValidation.ts` and its EXIF test, `lib/matching.ts`, `lib/notificationFanout.ts`, `lib/sightingRoundUp.ts`, `lib/catHelpers.ts`, `lib/logger.ts`); the published source of `expo-image-picker` 17.0.9 (web, iOS and Android); Linear SYC-166, SYC-87, SYC-164, SYC-167, SYC-249, SYC-250, SYC-41.
**Method:** every factual claim checked against code or package source. Platform claims that can't be settled without a device are marked **PLAUSIBLE** and say what would settle them. **CONFIRMED** means checked against code, package source or a primary source.

**Verdict in one line:** the privacy design mostly holds (no new public emitter, and the server strips location before storing or sending to the AI), but the spec over-promises what the photo will tell us. On the website, which every tester uses (SYC-164), and on the Android app, the position will almost never arrive. Two of its six decisions rest on code facts that are out of date, and the "repeat protection" problem is worse than described but has a cheaper fix than SYC-87.

**Ranking used:** **Blocker** = fix before Samuel approves. **Major** = fix in the spec before the plan. **Minor** = fix in passing.

---

## Blockers

### B1 · The device check has to come before approval, not after (§4, §13)

**What is wrong.** The spec says (§4) that nothing has been tried on a real phone and that "the first build task" is a half-hour device check. But that check decides whether half the feature is worth building at all, and it changes Decisions 4 and 5. What the code and primary sources already show:

- **Website (every tester, per SYC-164).** `expo-image-picker`'s web code hands over the file's bytes untouched (`readAsDataURL`, no canvas re-encode; "TODO: add exif support"). So the bytes we read are whatever the browser gave us. iPhone Safari converts library photos to JPEG and strips location by default; since iOS 17 there is an "Options → Location" switch in the picker, which people rarely touch (WebKit bugs 207088 and 263192). Whether Safari also strips the *time* is not settled: older reports say all EXIF is removed. **PLAUSIBLE.** On Android, Chrome uses the system photo picker, which removes location (see M5).
- **Android app.** Location is removed by the system photo picker (M5). The time does arrive (the tags list includes `DateTimeOriginal`).
- **iPhone app.** The picker reads GPS from the original file (`ImageUtils.readExifFrom` copies the `{GPS}` dictionary to `GPS…` keys). Whether the iOS 17+ picker's own location option is on or off by default for apps is **not settled.** If it is off, the iPhone app also gets no position.

**Failure scenario.** Samuel approves; the plan builds a JPEG reader, the map-start logic, three new strings and the Ermoupoli fallback. The device check then shows that Linda's own case (the website on her phone) gets neither a position nor a time. The work is done and the motivating user sees no change.

**Fix.** Run the device check now, on the live site and the Expo build: one iPhone (Safari and app, location option left at its default) and one Android (Chrome and app). Record what arrives for position and time, then rewrite §4's table and the §1 summary from the results. Add an explicit branch to the spec: *if the website gets no position on phones, the website part shrinks to "time only, plus the honest line", and Decision 4 becomes "read the time only"*. Say plainly in §1 who benefits: on today's evidence, mainly iPhone-app users and laptop users with exported photos.

---

## Major

### M1 · The exact photo position does go into a route parameter, and so into the browser address bar and history (§5.1, §9.6) — CONFIRMED

**What is wrong.** §5.1 promises the photo's position is "never put in a route parameter", and test 6 checks that no *photo-position field* appears in one. But after a sighting is sent, `spot.tsx` passes the confirmed pin to `buildReviewParams` as `lat`/`lng` at full precision (SYC-119). `buildReviewParams` keeps them unrounded, and on the website expo-router puts route params in the address bar and browser history (its own header comment says so). §5.2 admits that an unmoved pin *equals* the photo's position. So the exact spot where the photo was taken (the friend's house, the hotel room) sits in the browser history, and test 6 passes anyway, because the value travels under the name `lat`, not as a "photo position".

The phone's own exact GPS goes there today, so the kind of leak already exists. The change is *whose* location it is: before, the spotter's own; now, possibly a third party's home. That matters for a spec whose own §5 calls this "the most sensitive location in the system".

**Failure scenario.** A spotter on a shared family laptop logs a cat from a photo a friend took in her garden. The friend's garden position, to the centimetre, sits in the browser history in `/review?data={…"lat":37.44591234,"lng":24.94312877…}`.

**Fix.** In `buildReviewParams`, round `lat`/`lng` to 3 decimal places (about 110 m). They only shape the phone's "Cats known around here" list against the 1.5 km rule, and the server checks the real pick against its own stored location, so nothing loses accuracy that matters. Change §5.1 to describe the rounding honestly. Rewrite test 6 to assert the *value*: build a review route from a pin equal to a fixture photo position and assert that the full-precision value isn't in the serialised params.

### M2 · An off-island photo position is thrown away, so a Mykonos cat gets logged as a Syros cat in Ermoupoli (§3.3, Decision 6)

**What is wrong.** §3.3 treats a photo position off Syros as noise: "the app ignores it", and the map starts at the phone or in Ermoupoli. But an off-island position is *information*: this photo is not of a Syros cat. Island-hopping is how most Cyclades tourists travel. The tourist logging "all the cats from my trip" at the end of the holiday is exactly the user §2 describes.

**Failure scenario.** A tourist home in Munich picks a photo of a cat from Mykonos (correct GPS, 9 days old). The app ignores the position, starts the map in Ermoupoli and says "Drag it to where you saw the cat". She doesn't remember the exact street, so she taps "Check for matches". The matcher compares the Mykonos cat with up to ten Ermoupoli cats within 500 m and may suggest one: a wrong match, recorded as evidence that a real Syros cat is alive (data spine §3.2). Or she adds a new cat that doesn't exist on Syros. SYC-249's server check wouldn't catch it, because the pin *is* on Syros.

**Fix.** When the photo has a position and it is off-island, stop and say so: *"This photo was taken away from Syros. Cat Spotter only records cats on Syros."* Offer the library again, with a quiet "It was on Syros" override that falls back to Ermoupoli. Add it to §8's words and §9's tests. The Ermoupoli start (Decision 6) stays for the case where there is *no* photo position.

### M3 · The clock order is the wrong way round: the GPS clock is when the location was fixed, not when the photo was taken (§3.4 rule 1, §9.2) — PLAUSIBLE, needs a fixture check

**What is wrong.** Rule 1 prefers the GPS time stamp over the photo's own time plus its UTC offset. The GPS time stamp records when the *location fix* was taken. A phone that reuses a cached fix can write a GPS time minutes or hours older than the shot, and some Android cameras are known to. iPhones write `OffsetTimeOriginal` alongside `DateTimeOriginal`, and together those *are* the capture instant. Android's picker passes no offset (CONFIRMED: no `OFFSET_TIME*` tag in `ImagePickerConstants.EXIF_TAGS`), but it does pass `GPSDateStamp`/`GPSTimeStamp`.

**Failure scenario.** A photo taken at 00:20 Greek time on 4 October carries a cached GPS fix from 23:50 on 3 October. Rule 1 dates the sighting 3 October. The spotter's streak day is wrong, and "Photo taken 3 October, 23:50" disagrees with what the phone's own Photos app shows.

**Fix.** The order should be: (1) `DateTimeOriginal` + `OffsetTimeOriginal`; (2) `DateTimeOriginal`, with the offset worked out from the GPS clock (the difference rounded to the nearest 15 minutes) when the two are within a day of each other; (3) `DateTimeOriginal` read as Athens time. The GPS clock never sets the time on its own. Add a fixture to §9.2 where GPS time and photo time differ by 30 minutes and the photo time wins.

### M4 · "Two photos in the same second" is worse than described, but SYC-87 doesn't have to come first (Decision 2, §9.9) — CONFIRMED

**What is wrong.** Today's repeat protection (`routes/sightings.ts`, the lookup on device + `createdAt`) returns the *existing* sighting and **never stores the second photo**. So the effect isn't just "the second shows the first photo's match". The second photo is discarded on the server, the second queue item becomes a review card pointing at the *first* sighting's id, and resolving the second card after the first gets `409 Sighting already resolved`: a dead card. It also bites a case the spec doesn't mention: **picking the same library photo twice** (the second attempt after an apparent failure, or two cats in one photo).

At the same time, building SYC-87 (a client reference per sighting) *removes* the one accidental protection the time-based lookup gives: the same photo logged twice becomes two sightings and twice the points (25 + 15 under SYC-38's new values).

SYC-87 also needs a new column and a unique index. That puts it in the migration queue behind 0012 (SYC-63) and SYC-3's migration. Making it a prerequisite parks this feature behind two other teams' work for a problem that has a client-only fix.

**Failure scenario (today's code, photo times added).** A spotter picks two burst frames of Agatha (same second), offline. Both are queued with the same `createdAt`. On sync, the first creates sighting 812. The second gets 812 back, and its photo is dropped. She resolves card 1 as Agatha (+15). Card 2 shows Agatha's match, she taps it and gets an error. The card can't be cleared.

**Fix (replaces recommendation B).** Do it on the phone, with no schema change:
1. When a library photo's resolved time equals the time of a sighting this device has queued or sent in the last 30 days (kept as a small list of recent capture times), and it's a **different** photo, add 1 ms until it's unique. A retry still sends the stored value, so the server's real-retry protection keeps working.
2. When it's the **same** photo (same capture time *and* same file size or a cheap hash of the first 64 KB), say *"You've already logged this photo"* and offer to open that sighting rather than send it again.
3. Leave SYC-87 as it is (Low, independent). Rewrite test 9: two different photos with the same second make two sightings; the same photo twice is caught on the phone; a real retry is still deduped on the server.

### M5 · Decision 5 is about a permission that doesn't apply: Android's photo picker removes location whatever the app asks for (§4, Decision 5) — CONFIRMED for redaction, PLAUSIBLE for the permission

**What is wrong.** `expo-image-picker` 17 on Android uses the system photo picker (`PickVisualMedia`, with the Google Play services back-port declared in its manifest), not the old gallery intent, unless `legacy: true` is set. The system photo picker has removed location from shared photos since Android 13, by design (press coverage through July 2026; developers have asked Google to change it since 2022, issue tracker 243294058). An "Include location info?" consent inside the picker is in development, not yet shipped, and is expected no earlier than Android 17 QPR2 (December 2026). `ACCESS_MEDIA_LOCATION` with `setRequireOriginal` works on MediaStore links, not on the photo picker's links. So Decision 5's option B ("Ask for it → Android photos could start the map") would most likely do nothing, and the spec's own risk cell half-says so ("may still return nothing through Android's system photo picker").

The same picker sits behind Chrome on Android, so §4's website column ("Chrome on Android usually remove location") is right, but the reason is the picker.

**Fix.** Rewrite Decision 5's options honestly: **A. Accept that Android gives the time only (recommended)**; **B. Switch Android to the old document picker (`legacy: true`) and ask for `ACCESS_MEDIA_LOCATION`**: a worse, file-manager-style picker plus a permission prompt, for every Android user; **C. Revisit when Google ships the in-picker "Include location" choice**, which needs no app permission. Recommend A now, and file C as a dated follow-up ticket. Drop the "special access media location permission" wording from §4.

### M6 · Decision 3 argues against a notification that the code no longer sends to most followers (Decision 3, §11) — CONFIRMED

**What is wrong.** Decision 3 says resolving a sighting tells "the cat's followers" "Agatha was spotted again!" straight away. Since data spine PR 9 (`lib/notificationFanout.ts`), a sighting reaches **only the cat's owner** straight away. Every other follower gets an evening round-up (`lib/sightingRoundUp.ts`) that never carries a time, a clock reading or even "today". The round-up's window is keyed on when the update row was *written* (`cat_updates.created_at`, defaulting to now), not on the sighting's date. A backdated sighting therefore appears in that evening's round-up as "Agatha was spotted again.", which is true and timeless.

So option A ("no notification if older than 48 hours") would mostly suppress (a) a round-up line that already makes no "now" claim, and (b) the push to the **owner**, who is the person who most wants it. A homed cat's owner whose cat has gone missing wants "seen on Tuesday" more than anything.

The effort claim is also wrong: option C says "new notification wording in three languages", but the server's notification text is English-only today (`` `${cat.name} was spotted again!` ``).

**Fix.** Rewrite Decision 3 from the current code. Recommended: leave the round-up unchanged. For the owner's immediate push only, when the photo is more than 24 hours old, word it with the day, *"Agatha was seen on Tuesday"* (one English string, matching the existing server text). Never suppress it.

### M7 · The offline section promises a map the website doesn't have (§7) — CONFIRMED

**What is wrong.** §7 lists "showing the map (from the offline Syros tiles where downloaded)" among what works without signal. The downloaded Syros map exists only in the phone apps (`lib/offlineTiles.ts` returns early on web). The website's map loads OpenStreetMap tiles live, and with no signal it shows grey squares (SYC-167, Backlog). The website is what every tester uses. The project's standing rule is to be precise about what works offline.

**Fix.** Split §7 by platform. **Phone apps:** reading the photo, the map (once the Syros map is downloaded) and saving for later all work without signal. **Website:** reading the photo and saving for later work. The map shows grey squares, the pin still starts at the photo's position and can be saved there, but it can't be checked against streets until signal returns (SYC-167). Matching and sending need a connection everywhere.

