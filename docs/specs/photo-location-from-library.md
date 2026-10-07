# Starting the map where (and when) a library photo was taken

**Status:** **Revised after adversarial review; awaiting the device check and Samuel's approval.** Draft of 7 October 2026, reviewed the same day ([review](./reviews/photo-location-from-library-review.md)).
**Owner:** Samuel
**Covers:** SYC-166, from Linda's email of 30 September (a cat seen earlier near a friend's house in Talaras; the app started the map where she was *now* and dated the sighting to the moment she picked the photo).
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §6 and §10.6 (blurring and where it is applied), §10.8 test 13 (photos carry no GPS) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4 (the 1.5 km rule) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) §3.6 (repeat protection) · [`add-details-later.md`](./add-details-later.md) (the 30-day answer window) · [`DECISIONS.md`](./DECISIONS.md) Part 2h (the 500 m rule) · SYC-87 (dedupe by client reference, independent), SYC-164 (the draggable web map), SYC-167 (the website's map without signal), SYC-249 (a server check that a sighting is on Syros)
**Must ship first:** **SYC-258**, rounding the position that goes into the review screen's address (§5.1). SYC-166 must not ship before it.
**Follow-ups filed from this review:** SYC-259 (Android: revisit when Google adds a location choice to its photo picker, Decision 5) · SYC-260 (an XMP check in the server's photo test, and the "needs help" link carrying the photo's time, §12).

**What this document owns.** What the app does with the location and time stored inside a photo the spotter picks from their library. It does **not** own blurring, the matching distances or the answer window; it points at the specs that do.

---

## 1. The short version

When a spotter picks a photo from their library, the app looks inside the photo for **where** and **when** it was taken. Those are two separate pieces of information, and the app uses whichever it gets. Phones, and especially phone *browsers*, often remove one or both before the app sees the photo (§4), so the feature is built to work in every combination.

| What the photo tells us | What the spotter sees |
|---|---|
| **Where and when** | The "Where did you see it?" map starts at the photo's position, with a line saying so. The sighting is dated to when the photo was taken ("Photo taken 3 October, 18:42"). |
| **When only** (location removed) | The map starts near the spotter, with a line saying the photo doesn't say where. The sighting is still dated to when the photo was taken. |
| **Where only** (rare) | The map starts at the photo's position; the sighting is recorded as now, and the screen says the photo didn't say when. |
| **Neither** | The map starts near the spotter, and the screen says honestly that the photo doesn't say where or when. |

In all cases the spotter checks the pin and can move it. What is saved is the pin they confirm.

**Who benefits.** Which of these rows a spotter lands in depends on their phone and on whether they use the app or the website. The device check (§4) settles this with real phones. Until it has run, treat the platform claims in §4 as expectations, not facts. On the evidence from the code and the picker's source, the likeliest picture is: iPhone app users get both; Android app users get the time only; website users on phones mostly get little or nothing, while people uploading exported photos from a laptop get both.

The photo's exact position is read on the phone, used to place the map, and never stored as its own field, never logged, and never sent anywhere new (§5). The photo file itself keeps its tags on the phone until it is sent; the server removes them before storing it (§5.4).

The camera paths are unaffected: a photo taken now was taken here, now.

---

## 2. Why this matters

Logging a cat after the fact from the library is common, especially for tourists at the end of the day. Without this feature, picking a photo does two wrong things (`spot.tsx`, `pickPhoto`):

1. **The map starts at the phone's current position.** Linda was across the island from the cat, so she had to find Talaras by hand. Before SYC-164 (merged 1 October) the web map couldn't even be dragged, so her sighting was saved where she was standing.
2. **The sighting's time is the moment the photo was picked.** A photo from Tuesday logged on Thursday counts as Thursday: for the streak, for "last seen", for the team's food-and-water timeline.

It is worse for tourists than for locals: a tourist back home in Germany, logging the cat from the plane, gets a map that starts in Germany.

| | Tourists | Cat guardians and residents |
|---|---|---|
| **How they log from the library** | That evening at the hotel, or days later from home | After a walk, or a cat a neighbour photographed |
| **What goes wrong** | The map starts at the hotel (or in another country) and the day is wrong | The map starts across town, and the pin has to be dragged each time |
| **What they gain** | The pin is already on the right street and the day is right | The same, with fewer drags |

---

## 3. What a spotter sees

### 3.1 When the photo has a location

On the "New spot" screen after choosing from the library, the map is already centred on the photo's position and the line under the map reads:

> *We've started the map where this photo was taken. Drag it if that's not quite right.*

The pin works as it does for any sighting. "Check for matches" saves the pin's position. A spotter who has location permission switched off can still continue: the photo supplies the starting point, so the screen is not stuck on "Location permission is needed".

If the photo records that its own position is rough (an accuracy worse than 150 m, which happens indoors and in Ermoupoli's narrow streets), the map still starts there but the line is firmer: *"This photo's location is only approximate. Please drag the map to where you saw the cat."* (§6.)

### 3.2 When it doesn't

The map starts where the phone is, and the line says so (en: *"This photo doesn't say where it was taken, so the map starts near where you are now. Drag it to where you saw the cat."*). Typical cases: a screenshot, a photo forwarded on WhatsApp, a phone with photo location switched off, Android's photo picker (§4), and most photos picked on the website from a phone.

**When the phone has no usable position either** (location refused, still searching, or the phone is not on Syros), the map starts in **Ermoupoli** with *"We've started the map in Ermoupoli. Drag it to where you saw the cat."* Either way "Check for matches" is available as soon as the map has a start; the spotter is never stuck on a disabled button (Decision 6).

### 3.3 When the photo was taken away from Syros

The tourist case. If the photo's position is **not on Syros** (outside the island's rectangle, with a small margin), the photo is probably not of a Syros cat: the position is information, not noise. The app stops and says:

> *This photo was taken away from Syros. Cat Spotter only records cats on Syros.*

with two buttons: **Choose another photo**, and a quiet **It was on Syros** for the spotter whose photo has a wrong or edited position. "It was on Syros" continues as if the photo had no position: the map starts near the spotter if they are on Syros, otherwise in Ermoupoli. The photo's time is still used. (Decision 7.)

### 3.4 The time, and how old is too old

The photo's taken-at time becomes the sighting time, sent as `capturedAt`. Three rules:

1. **Which clock.** The photo's own time is the capture instant, so it always sets the time. In order of trust:
   1. the photo's time together with its own UTC offset, if it has one (iPhones record both);
   2. the photo's time, with the offset worked out from the GPS clock when the photo has one and the two are within a day of each other (the difference rounded to the nearest 15 minutes);
   3. the photo's time read as **Greek local time** (Europe/Athens), which is also how streak days are counted.

   The GPS clock **never sets the time on its own.** It records when the phone last fixed its position, and a phone that reuses an earlier fix can write a GPS time minutes or hours before the shot. *(Platform claims to confirm: that iPhones write the offset with the photo's time, and that Android's picker passes the GPS clock but no offset; checks C3 and C4 in §4.)*
2. **Nonsense is ignored.** A time in the future, or one that can't be read, falls back to "now", and the screen says the photo doesn't say when (§8, `photoNoTime`).
3. **Too old.** A photo older than the limit in Decision 1 isn't accepted for a sighting. The screen says *"This photo was taken on 12 September, more than 21 days ago. We can only record sightings from the last 21 days. Please choose a newer photo."* and offers the library again. Why a limit at all: the server moves any date older than 30 days to "30 days ago" without telling anyone (`captureTime.ts`), and a saved-for-later item is flagged stale 30 days after its photo date (`offlineQueue.ts`), so a 29-day-old photo would have one day left to be sent.

When the time is the photo's, the screen shows it ("Photo taken 3 October, 18:42"), **always in Greek time**, whatever time zone the phone is set to, so it matches how the day is counted. A tourist whose phone is on German time sees 18:42 for a photo that German time calls 17:42, and the line carries "Greek time" on first use if the phone's zone differs.

---

## 4. What each kind of phone gives us, and the device check

The table below is built from the picker's published source (`expo-image-picker` 17.0.9), the server code and the app's photo handling. **It has not been tried on real phones.** Everything marked **[confirm: Cn]** is an expectation that the device check below must confirm or correct before the plan is written. Nothing in this table should be read as established fact until its results table (§4.2) is filled in.

| | **iPhone app** | **Android app** | **Website** |
|---|---|---|---|
| **Does the picker give the photo's information?** | Expected yes, with `exif: true`: the picker reads it from the original library photo, including GPS, the photo's time, the UTC offset and the GPS clock. The app asks for the original (HEIC) untouched. **[confirm: C1, C3]** | Expected the time yes, via Android's own reader; the position and the offset no. **[confirm: C2, C4]** | The picker's website code does not read it (its own source says "not written yet"); we would read it ourselves from the file the browser hands over (§4.1). |
| **What may be missing** | Photos shared with location switched off. Whether the iOS 17+ picker's own location option is on or off by default for apps is **not settled**; if off, the iPhone app also gets no position. **[confirm: C1]** | Android's system photo picker (the one the picker uses, and the one behind Chrome on Android) removes a photo's location whatever the app asks for, by design since Android 13. The photo's time is expected to arrive. **[confirm: C2]** | Expected on phones: Safari on iPhone converts photos to JPEG and usually removes location (iOS 17 added an "Options → Location" switch in its picker that people rarely touch), and may remove the time too; Chrome on Android uses the system photo picker and removes location. **[confirm: C5, C6, C7, C8]** Photos exported to a laptop (AirDrop, cable, Photos export) often keep everything. |
| **HEIC** | Read natively. | Read natively. | iPhone Safari converts HEIC to JPEG on upload. A true HEIC file on a desktop browser gives no information. |

**Does it survive the app's compression?** It does not need to. Two steps re-encode a picture and discard its information: `shrink` (in `spot.tsx`, for very large photos) and `optimizePhotoForUpload` (on a weak connection). So **the photo's location and time are read straight from the picker's answer, before either step**, and held in memory beside the photo. Nothing downstream reads them from the picture again.

The server strips everything from the stored picture (`validatePhotoBase64` re-encodes through `sharp` without metadata; `imageValidation.exif.test.ts` asserts it).

### 4.1 Reading the website's file

The website holds the chosen file's bytes in memory (the picker returns them as base64). A small reader looks only at the start of a JPEG for the tags. It must never throw: anything it can't read means "no information", and the flow continues as in §3.2. **If the device check shows phone browsers remove the location, the reader is cut down to the time tags only** (including `OffsetTimeOriginal`); see Decision 4 and the branches in §4.3.

### 4.2 Device check

**Purpose.** To replace the expectations above with what real phones do, before the plan is written. It takes about half an hour with one iPhone and one Android phone, and is run against a throwaway check page on the website and a throwaway test build of the app. Neither ships; they exist only to show, in plain words, "location arrived / didn't" and "time arrived / didn't".

**Preparation (both phones).** Make sure the Camera is allowed to record location (iPhone: Settings → Privacy & Security → Location Services → Camera → While Using; Android: Camera settings → Location tags on). Take one fresh photo outdoors of anything. Also have one old photo (at least a week old) and one screenshot as controls.

**The checks.** For each environment pick the fresh photo through the app's or the page's photo chooser and record the answer. Where the iPhone chooser shows an "Options" button, record whether Location is on or off before tapping, then run it once more with it switched on.

| Check | Environment | Question it answers |
|---|---|---|
| C1 | iPhone app | Does the location arrive? With the chooser's location option left alone? Switched on? |
| C2 | Android app | Does the time arrive? Does the location (expected: no)? |
| C3 | iPhone app | Does the time arrive, and does it come with its time-zone offset? |
| C4 | Android app | Does the time arrive, with or without a GPS clock and an offset? |
| C5 | iPhone Safari (website) | Does the location arrive? With the chooser's location option left alone? Switched on? |
| C6 | iPhone Safari (website) | Does the time arrive? |
| C7 | Android Chrome (website) | Does the location arrive? |
| C8 | Android Chrome (website) | Does the time arrive? |
| C9 | Any | With the old photo and the screenshot: a screenshot says neither; the old photo's time is correct. |

**Results (to be filled in by whoever runs the check):**

| Environment | Location arrived? | Time arrived? | Offset with the time? | GPS clock? | Notes (picker options, what the chooser looked like) |
|---|---|---|---|---|---|
| iPhone app | | | | | |
| iPhone Safari | | | | | |
| Android app | | | | | |
| Android Chrome | | | | | |

### 4.3 How the spec holds whatever the result

The feature is three independent parts, each used only if it arrives: **the map start** (needs a location), **the sighting time** (needs a time), and **the honest lines** (always). So every result maps to a defined behaviour and no result breaks the feature:

| Result | What the spec does |
|---|---|
| Location and time arrive | Full feature (§3.1, §3.4). |
| Location stripped, time arrives (expected for the Android app, and possibly the website on phones) | **Time only.** The map starts near the spotter or in Ermoupoli, with the "doesn't say where" line; the sighting is still dated by the photo. |
| Time arrives, location stripped, on the website | **"Time only on web."** The website reader reads only the time tags (Decision 4 becomes "time only"); the website shows "Photo taken …" and the "doesn't say where" line; there are no location tests for the website reader. |
| Neither arrives on the website | The website part shrinks to the honest line and the sighting is recorded as now, as before. No reader is built (Decision 4, option C becomes the choice). The "when did you see it?" question in §12 becomes more worthwhile for web users. The apps are unaffected. |
| iPhone app gets no location by default | The iPhone app falls into the "time only" row. The spec's summary (§1) is rewritten to say the feature is mainly a time fix on phones. |
| Locations all arrive everywhere | Nothing to change; §4's table becomes fact. |

The plan is written after the results are known. If every phone path turns out to be "time only", Samuel should decide whether the map-start work is still worth building (the time fix and the honest lines stand either way).

---

## 5. Privacy

The exact position of a photo is the most sensitive location in the system: a friend's house, a hotel room, a feeding spot. The ticket's promise is that it is "only used to start the map". This section says exactly what that does and doesn't cover, so it is checkable.

1. **The position never travels in a route address, once SYC-258 has shipped.** After a sighting is sent, the confirmed pin is passed to the review screen as `lat`/`lng` in full precision (`buildReviewParams`), and on the website the route's parameters appear in the address bar and browser history. An unmoved pin that started at a photo equals that photo's position, so without a fix the exact spot where a friend took a photo (her garden, a hotel room) would sit in the browser history of whoever is logging it. **SYC-258** rounds `lat`/`lng` in `buildReviewParams` to 3 decimal places (about 110 m). They only shape the "Cats known around here" list against the 1.5 km rule, and the server checks the real pick against its stored location, so nothing that matters loses accuracy. SYC-258 is its own ticket because the same exposure exists for the phone's own position. **SYC-166 must not ship before SYC-258.**
2. **Read once, on the phone, held in memory.** The parsed position is never put in a route parameter, a log line, an error report or a new field of the queue. The queue and the upload carry the same fields as before: the confirmed pin and the time.
3. **What is saved is the confirmed pin, nothing else.** Whether the pin started at the photo, at the phone or in Ermoupoli, the saved sighting is the same shape, and the app does not record which. An unmoved pin that started at the photo equals the photo's position; that is the spotter's own choice to confirm and is no more exact than a pin they dragged there.
4. **The photo file keeps its tags on the phone until it is sent.** "Read once and forgotten" applies to the *parsed* position. The picture file itself still carries its location tags wherever the app keeps it: in the save-for-later queue (the website's browser storage or the phone's storage), in the review screen's photo store, and in the upload. That is on the spotter's own device and unchanged. The server removes the tags before storing the photo or showing it to the AI matcher (`validatePhotoBase64` → `normalizeToJpeg`, which is also what `matching.ts` receives, and the welfare-report route uses the same function).
5. **No new public surface.** Blurring, who sees what, and the rule that no public payload carries a sighting coordinate belong to `cat-record-data-spine.md` §6 (method §6.2, other channels §6.4) and §10.6 (the one serialiser). This feature adds no emitter. A photo's own GPS reaching the public through the picture file is the data spine's §6.4.5 and test 13 in §10.8, already tested for spotter uploads. This spec relies on those tests staying green. The one server test it adds is an XMP check beside the existing EXIF one (SYC-260, §9 test 8), because photos edited in Apple Photos (including "Adjust Location") can carry position in an XMP block, and this feature invites more library photos.
6. **The map's own requests.** On the website the map loads tiles from OpenStreetMap's servers, so starting the map at the photo tells OpenStreetMap, along with the visitor's internet address, which few hundred metres they are looking at. Without this feature the same servers learn the area around the phone instead. This is the same kind of exposure as before, not a new one. A tile cache (SYC-167) would reduce it. The phone apps use the downloaded Syros map where it is installed.
7. **The time becomes more truthful in the public view, not more exact.** Public pages show a date only (§6.4.4). A backdated sighting shows its true date.
8. **Deleting yourself (SYC-63)** already removes a person's queued items; nothing new is stored that it would miss.
9. **A photo's date can be edited by its owner.** iPhone Photos has "Adjust Date & Time", so any spotter can fill a missed streak day up to the age limit without a modified app. This was already possible by changing the phone's clock, and the streak is a vanity prize (`captureTime.ts`). We accept it.

---

## 6. Matching, and the rules that use the saved location

Both distance rules measure from the **saved pin**, never from the phone: suggested matches only within **500 m** (`DECISIONS.md` Part 2h), and the "Cats known around here" list and server check at **1.5 km** of a cat's published square (`choose-a-different-cat.md` §4). Nothing in those rules changes.

What changes is how often the pin is right the first time. For Linda, the photo's position is within metres of the cat, so the matcher looks at the right cats; with the phone's position it looked at the cats near her friend's house across town. A photo's GPS is usually accurate to tens of metres, well inside both rules, and a pin dragged somewhere else wins. It is not always that good: iPhones record each fix's own error (`GPSHPositioningError`), and indoors or in narrow streets it can be hundreds of metres, which matters against a 500 m matching edge. When the photo records an error over 150 m, the map still starts there but the line is the firmer "only approximate" version (§3.1).

The sighting's time now matters to four other things. The streak day (counted in Greek time), the team's food-and-water order (add-details-later Decision 4) and the cat list's "last seen" (a date) already use the stored capture time. The fourth needs a small fix: **the reward screen's "last seen" line.** The resolve response builds the returned cat with this sighting's date, so a spotter who logs a 10-day-old photo of a cat another spotter saw yesterday is told the cat was last seen 10 days ago. The response must use the **newest** of this sighting's date and the cat's stored last-seen date (§9 test 12). The reward-screen questions stay open until 30 days after the photo, which is why Decision 1 stops short of 30.

A true date also helps the death rule: the data spine (§3.2) clears a `deceased` record only with a sighting dated *after* it. A 10-day-old library photo logged now should not revive a cat recorded as dead last week; with the photo's real date it correctly doesn't.

---

## 7. What works offline

Split by platform, because the two differ.

**Phone apps (no signal).** Picking a photo, reading its position and time, the map **once the Syros map has been downloaded**, and saving the sighting for later all work. Without the downloaded map the pin can still be placed, but the map shows no streets.

**Website (no signal).** Picking a photo, reading its tags and saving the sighting for later work. **The website has no offline map:** it loads tiles live, and without signal it shows grey squares (SYC-167). The pin still starts at the photo's position and can be saved there, but it can't be checked against streets until signal returns.

**Everywhere.** Matching, the cat catalogue beyond what is saved, and sending need a connection. A saved-for-later sighting dated from an older photo has the shorter life described in §3.4.

---

## 8. Words (en, el, fr; need native review, SYC-4)

| Key | English | Greek | French |
|---|---|---|---|
| `mapStartedAtPhoto` | We've started the map where this photo was taken. Drag it if that's not quite right. | Ξεκινήσαμε τον χάρτη από το σημείο όπου τραβήχτηκε η φωτογραφία. Σύρε τον αν δεν είναι ακριβώς εκεί. | On a démarré la carte là où la photo a été prise. Fais-la glisser si ce n’est pas tout à fait ça. |
| `mapStartedApprox` | This photo's location is only approximate. Please drag the map to where you saw the cat. | Η τοποθεσία της φωτογραφίας είναι μόνο κατά προσέγγιση. Σύρε τον χάρτη εκεί όπου είδες τη γάτα. | La position de cette photo n’est qu’approximative. Fais glisser la carte là où tu as vu le chat. |
| `mapStartedAtYou` | This photo doesn't say where it was taken, so the map starts near where you are now. Drag it to where you saw the cat. | Η φωτογραφία δεν δείχνει πού τραβήχτηκε, οπότε ο χάρτης ξεκινά κοντά στο σημείο που βρίσκεσαι τώρα. Σύρε τον εκεί όπου είδες τη γάτα. | Cette photo n’indique pas où elle a été prise, alors la carte part près de l’endroit où tu es maintenant. Fais-la glisser là où tu as vu le chat. |
| `mapStartedInTown` | We've started the map in Ermoupoli. Drag it to where you saw the cat. | Ξεκινήσαμε τον χάρτη στην Ερμούπολη. Σύρε τον εκεί όπου είδες τη γάτα. | On a démarré la carte à Ermoupoli. Fais-la glisser là où tu as vu le chat. |
| `photoTakenAt` | Photo taken {when} (Greek time) | Η φωτογραφία τραβήχτηκε {when} (ώρα Ελλάδας) | Photo prise {when} (heure grecque) |
| `photoNoTime` | This photo doesn't say when it was taken, so the sighting will be recorded as now. | Η φωτογραφία δεν δείχνει πότε τραβήχτηκε, οπότε η θέαση θα καταγραφεί ως τώρα. | Cette photo n’indique pas quand elle a été prise, alors l’observation sera enregistrée à l’instant présent. |
| `photoTooOld` | This photo was taken on {date}, more than {days} days ago. We can only record sightings from the last {days} days. Please choose a newer photo. | Η φωτογραφία τραβήχτηκε στις {date}, πριν από περισσότερες από {days} ημέρες. Μπορούμε να καταγράψουμε μόνο θεάσεις των τελευταίων {days} ημερών. Διάλεξε μια πιο πρόσφατη φωτογραφία. | Cette photo a été prise le {date}, il y a plus de {days} jours. On ne peut enregistrer que les observations des {days} derniers jours. Choisis une photo plus récente. |
| `photoOffIsland` | This photo was taken away from Syros. Cat Spotter only records cats on Syros. | Η φωτογραφία τραβήχτηκε μακριά από τη Σύρο. Το Cat Spotter καταγράφει μόνο γάτες στη Σύρο. | Cette photo a été prise loin de Syros. Cat Spotter n’enregistre que les chats de Syros. |
| `photoOffIslandChoose` | Choose another photo | Διάλεξε άλλη φωτογραφία | Choisir une autre photo |
| `photoOffIslandOverride` | It was on Syros | Ήταν στη Σύρο | C’était à Syros |
| `photoAlreadyLogged` | You've already logged this photo. | Έχεις ήδη καταγράψει αυτή τη φωτογραφία. | Tu as déjà enregistré cette photo. |
| `photoAlreadyLoggedOpen` | Open that sighting | Άνοιγμα της θέασης | Ouvrir cette observation |

Server text (English only, as all server notification text is): the owner's push for a photo more than 24 hours old reads `"{cat} was seen on {weekday}"` (Decision 3).

The existing `confirmLocationHint` ("It starts near where you are.") stops being shown for library photos and stays for the camera. Eleven new keys in `lib/i18n.ts`.

---

## 9. Tests that must exist

1. **Reading the tags, every shape.** Pure function with fixtures: iPhone (unsigned latitude plus N/S letter), Android (signed plus letter, which must not double-negate), website degrees-minutes-seconds. Southern and western hemispheres. A position of exactly 0, 0 is "missing", not a point in the sea. Out-of-range and non-numeric values are "missing". `OffsetTimeOriginal` and `GPSHPositioningError` are read when present.
2. **The clock.** Photo time plus its offset wins; with no offset, the offset is worked out from the GPS clock (rounded to 15 minutes) when the two are within a day; otherwise the photo time is read as Greek time. **Fixture: GPS time and photo time differ by 30 minutes, and the photo time wins.** A photo from 25 October 2026 around 03:00 (clocks go back) resolves to one defined instant. A future time and an unreadable time fall back to now, with the `photoNoTime` line.
3. **The age limit** (21 days) at the edge: one minute inside accepted, one minute outside refused, with the screen text and the library re-offered.
4. **Website reader.** A JPEG with GPS, one without, big- and little-endian, truncated, corrupt, and a very large file: never throws, never hangs, returns "no information" when unsure. A HEIC file returns "no information". If the device check selects "time only on web" (§4.3), the location cases are dropped and the same never-throws cases run against the time-only reader.
5. **The map start.** Library photo with position: pin starts there, even if the phone's own position arrives *afterwards*. Without a photo position: starts at the phone. No photo position and the phone off-island, or location refused, or timed out: Ermoupoli, and "Check for matches" is enabled. Retake and re-pick reset it. Camera path unchanged. (The map only repositions on its first coordinates, so the screen must be given a fresh start when the start changes.)
6. **Submission and privacy, by value rather than by field name.** (a) The request carries the confirmed pin and the photo's time; (b) the queued item's keys equal the existing key set exactly; (c) a review route built from a pin equal to a fixture photo position does **not** contain the fixture's full-precision coordinates in its serialised parameters (this is SYC-258's behaviour, asserted here so it cannot regress); (d) a source check that the module reading the tags is imported only by the spot screen's photo handling.
7. **Compression doesn't matter.** Run the pick through the `shrink` and weak-connection paths with a mocked picker; the start position and time are the same.
8. **Privacy, existing and new.** `imageValidation.exif.test.ts` and data spine test 8 (no exact coordinate in any public payload) stay green and are named in this PR's description. New: a sighting backdated by a photo time still serialises with a date only. New server test (SYC-260): `expect(outputMeta.xmp).toBeUndefined()` in both cases of the existing EXIF test.
9. **Repeat protection** (Decision 2). Two **different** photos with the same second made on one device make two sightings (the second gets a time one millisecond later). The **same** photo picked twice is caught on the phone with `photoAlreadyLogged`. A real **retry** of one send is still deduplicated by the server.
10. **Words.** All eleven keys exist in en, el and fr. Checked in the browser at ~390 px and desktop width, with `cat-spotter/language` set to `el` and `fr`.
11. **Off-island photo.** A photo position off Syros shows the stop screen; "Choose another photo" re-offers the library; "It was on Syros" continues with the photo's time and the map starting at the phone (if on Syros) or Ermoupoli. A photo position on Syros never triggers it.
12. **Last seen.** Logging a 10-day-old photo of a cat last seen yesterday returns the cat with yesterday as its last-seen date, not the 10-day-old date.
13. **Time display.** With the device time zone set to Europe/Berlin, a photo taken at 18:42 Greek time shows "18:42 (Greek time)".
14. **Owner push.** A sighting dated within 24 hours sends the existing text; one older sends "seen on {weekday}". The evening round-up is unchanged for both.
15. **Offline.** On the website with the network off, a library photo with a position still starts the pin there and saves for later; no test claims the map shows streets.

---

## 10. Decisions for Samuel

### Decision 1 · How old can a library photo be?

| | **A. 30 days (the server's own limit)** | **B. 14 days** | **C. 21 days (recommended)** | **D. 7 days** | **E. No limit** |
|---|---|---|---|---|---|
| **What the spotter sees** | Any photo from the last month works | A fortnight of photos works | Three weeks of photos work | A week | Anything works |
| **Benefits** | Matches the server's limit; nothing new to explain | Easy to explain; leaves two weeks to send and answer | Covers "the evening", "the weekend", "home from a two-week holiday" and a few days of delay on top; leaves 9 days of saved-for-later life before the 30-day mark, and 9 days for the reward questions, which are almost always answered at once | Tightest, freshest data | Nothing is refused |
| **What people notice** | A confusing dead end: a 29-day-old photo saved offline goes stale a day later | A tourist back from a two-week holiday finds their first week's photos turned away | A tourist logging a month-old photo is turned away | A weekly logger loses most of their week | Needs a server change, otherwise old photos carry the wrong date |
| **Risks** | The saved item can never send; the reward questions have a day left. Also makes streak-filling easier | The holiday case above | Slightly less fresh data than 14; still lets an owner who edits a photo's date fill streak days within the limit | Turns away the weekly tourist | The server quietly moves dates older than 30 days to "30 days ago" (wrong date); "last seen" and the streak are easier to inflate |
| **Effort** | One constant | One constant | One constant (`MAX_PHOTO_AGE_DAYS`) | One constant | Server and queue changes |

**Recommendation: C, 21 days.** *Changed after review: 14 days would already turn away a two-week Syros holiday logged at home a few days after returning; 21 days covers that and still leaves nine days of queue life.* The streak caveat (§5.9) applies to every option and is accepted.

### Decision 2 · Two photos taken in the same second, and the same photo twice

Photo times are accurate to the second. The server treats a second sighting from the same phone with the same time as a repeat and returns the first, and **never stores the second photo**. With a photo time that can collide, the result is worse than a wrong match: the second photo is thrown away, its saved-for-later card points at the first sighting, and resolving it gets an error ("Sighting already resolved") on a card that can't be cleared. It also happens when the **same photo is picked twice** (a second attempt after an apparent failure, or two cats in one photo).

| | **A. Do nothing** | **B. Fix it on the phone (recommended)** | **C. Build SYC-87 first** | **D. Add sub-seconds and hope** |
|---|---|---|---|---|
| **What the spotter sees** | A discarded photo and a dead card on bursts | Nothing for different photos; "You've already logged this photo" for a repeat | Each sighting is its own, but logging the same photo twice now gives two sightings and twice the points | Fewer collisions, not none |
| **Benefits** | No work | No database change; the server's real-retry protection keeps working; stops double points for the same photo | Fixes the collision at the root | No schema change |
| **Risks** | A silent loss on the one flow this feature encourages | A small list of recent capture times kept on the device; a cheap photo fingerprint (file size plus the first 64 KB) | A new column and unique index that must queue behind migration 0012 (SYC-63) and SYC-3's, parking this feature behind two other teams; removes the accidental same-photo protection | Phones don't all record sub-seconds |

How B works: when a library photo's time equals the time of a sighting this device has queued or sent in the last 30 days and it is a **different** photo, add one millisecond until it is unique (a retry still sends the stored value). When it is the **same** photo, say so and offer to open that sighting.

**Recommendation: B.** *Changed after review: the earlier recommendation was to build SYC-87 first, but the harm is bigger than described and has a phone-only fix, whereas SYC-87 needs a database migration and would open double points for re-logging one photo.* SYC-87 stays Low and independent.

### Decision 3 · Telling people about a sighting from a photo taken days ago

Resolving a sighting reaches **only the cat's owner** straight away ("Agatha was spotted again!", `lib/notificationFanout.ts`). Everyone else who follows the cat gets an evening round-up (`lib/sightingRoundUp.ts`) that never says a time, a clock reading or even "today". The round-up is keyed to when the update was *written*, not to the sighting's date, so a backdated sighting appears in that evening's round-up as "Agatha was spotted again.", which is true and timeless.

| | **A. Owner's push says the day when the photo is over 24 hours old; round-up unchanged (recommended)** | **B. Suppress the push for photos over 48 hours old** | **C. Send everything unchanged** |
|---|---|---|---|
| **What the owner sees** | "Agatha was seen on Tuesday" | Nothing | "Agatha was spotted again!" about a days-old photo |
| **What other followers see** | The usual evening round-up | The usual evening round-up, minus the late one | The usual evening round-up |
| **Benefits** | The owner of a cat who has gone missing wants "seen on Tuesday" most; honest; one English string | Trivial to build | No change |
| **Risks** | One new server text to maintain (English only, like all server text) | Hides news from the person who cares most; suppresses a round-up line that makes no "now" claim anyway | A false "now" feel in the owner's push |

**Recommendation: A.** *Changed after review: the earlier draft argued against telling "followers" immediately, but only owners are told immediately now, and they should never be silenced. The round-up is left alone.*

### Decision 4 · Reading the website's file

| | **A. A small reader of our own, JPEG only (recommended, conditional on the device check)** | **B. A library (for example `exifr`)** | **C. Don't support the website** |
|---|---|---|---|
| **What the spotter sees** | Photos from a laptop start the map and set the time; phone browsers give whatever they keep | The same, plus rare files ours can't read | The website behaves as if the photo said nothing |
| **Benefits** | Tiny, no new dependency; covers what Safari and Chrome actually send | Handles HEIC and odd files | Nothing to build |
| **Risks** | We own the parsing bugs (hence the test list); HEIC on a desktop browser gives nothing | A dependency of some tens of kilobytes on every web load | Laptop-at-the-hotel tourists, the people who benefit most on the website, get nothing |

**Recommendation: A**, built after the device check: the full reader if phone browsers pass the location, **time tags only** if they remove it (§4.3), and option C if they remove both. It reads `OffsetTimeOriginal` too (§3.4). *Agreed in review, now explicitly conditional.*

### Decision 5 · Android and the location permission

On Android, the photo chooser the app uses is the system photo picker, which removes a photo's location before the app sees it, whatever the app asks for. The time arrives.

| | **A. Accept that Android gives the time only (recommended)** | **B. Switch Android to the older file-style chooser and ask for the "access media location" permission** | **C. Revisit when Google ships a location choice inside its picker (SYC-259)** |
|---|---|---|---|
| **What the spotter sees** | The time works; the map starts near them with the "doesn't say where" line | A different, clunkier photo chooser, plus a permission prompt about their photos' locations, for every Android user | Same as A now; later, a choice appears inside Android's own picker |
| **Benefits** | No new prompt for a charity app; simple privacy line: we never ask to read where your photos were taken beyond what you hand us | Android photos could start the map | No app permission needed when it arrives; the right fix |
| **Risks** | Android users get half the feature for now | A worse picker and a worrying prompt, both affecting every Android user | Depends on Google; expected no earlier than late 2026 |

**Recommendation: A now, with C filed as SYC-259 (revisit dated December 2026).** *Changed after review: asking for the permission would not work with the system picker, so the real alternative to A is the older chooser, which costs every Android user.* The device check (C2) confirms or corrects this.

### Decision 6 · Starting the map in Ermoupoli

| | **A. Ermoupoli's centre whenever there is no photo position and no usable phone position (recommended)** | **B. Keep starting at the phone, and leave "Check for matches" disabled when there isn't one** |
|---|---|---|
| **What the spotter sees** | A tourist at home sees Syros, not their street; a spotter with location switched off isn't stuck | A map of Munich with a cat pin to drag 2,000 km, or a disabled button |
| **Benefits** | Always usable; covers location refused and still searching, as well as off-island | No change |
| **Risks** | The town isn't where every cat is; the line tells them to drag | The dead end that exists for Android photos and most website photos |

**Recommendation: A.** *Widened after review: also used when location is refused or unavailable, since most website and all Android photos carry no position. It does not cover an off-island photo position, which has its own screen (Decision 7).*

### Decision 7 · A photo taken away from Syros (new, from review)

Island-hopping is how most Cyclades tourists travel. A tourist back in Munich may pick a photo of a Mykonos cat with a correct position. That position is information: this is not a Syros cat. If it is ignored, the map starts in Ermoupoli, she taps "Check for matches" without remembering a street, and the matcher may suggest one of up to ten Ermoupoli cats, recorded as evidence that a real Syros cat is alive; or she adds a cat that doesn't exist on Syros. A server check that a sighting is on Syros (SYC-249) wouldn't catch it, because the pin *is* on Syros.

| | **A. Stop, say so, and offer "It was on Syros" (recommended)** | **B. Ignore the position and start in Ermoupoli** | **C. Warn but let her continue with the map at the off-island position** |
|---|---|---|---|
| **What the spotter sees** | "This photo was taken away from Syros…" with two buttons | A map in Ermoupoli and no hint that anything is off | A map somewhere in the sea or on another island that can't be saved sensibly |
| **Benefits** | No wrong Syros cats from other islands; an easy way out when the photo's position is wrong or edited | Never refuses anyone | Never refuses anyone |
| **Risks** | One more screen; a spotter whose photo is edited has to tap the override | Wrong matches and imaginary cats; the exact failure above | Pins that can't be saved, and confusion |

**Recommendation: A.** The Ermoupoli start remains for the case where there is *no* photo position (Decision 6).

---

## 11. Proposed `DECISIONS.md` entries

*(To be added by Samuel on approval; this spec doesn't edit that file.)*

- **Library photos set the map's start and the sighting time (SYC-166).** Where the photo has a position on Syros, the map starts there; the saved location is still only the pin the spotter confirms. The photo's taken-at time is the sighting time, within the age limit chosen in Decision 1 (21 days recommended). The exact position is never saved as its own field, logged or sent anywhere new, and the route address carries only a rounded position (SYC-258, shipped first).
- **A photo's date can be edited by its owner. We accept that this lets a spotter fill streak days within the age limit.**
- **A photo taken away from Syros is not accepted as a Syros sighting** (Decision 7), if A is approved.
- **No usable position starts the map in Ermoupoli** (Decision 6).
- **The owner's immediate push says the day for photos over 24 hours old; the evening round-up is unchanged** (Decision 3).
- **Different photos with the same second are told apart on the phone; the same photo twice is caught there** (Decision 2).
- Decisions 1–7 as chosen by Samuel.

---

## 12. Not in this spec (to be ticketed)

- **A server check that a sighting is on Syros** (SYC-249). A sighting dated and placed in Athens would create a cat there. This feature makes it slightly more likely only through a modified app, since the app itself refuses off-island photo positions.
- **The "needs help" link and the photo's time (SYC-260).** `NeedsHelpLink` hands the photo and the pin to a welfare report. With a library photo, the report reaches the team as "now" while the sighting says "3 October". SYC-260 decides whether the handoff should carry the photo's time.
- **The XMP check in the server's photo test (SYC-260).** One line in an existing test (§9 test 8).
- **Asking "when did you see it?"** when a library photo has no time (a screenshot, a WhatsApp forward, and possibly every website photo on phones) and the spotter is logging days later. The sighting is recorded as now, and the screen says so (`photoNoTime`). Add the question if testers hit it; more worthwhile if the device check shows the website strips the time.
- **Android's in-picker location choice (SYC-259).**
- **The website's map without signal (SYC-167).**
- **Correcting sightings already saved in the wrong place** is SYC-165 (not touched here).

---

## 13. Review outcome

How each finding in the [adversarial review](./reviews/photo-location-from-library-review.md) was handled.

| Finding | Handling |
|---|---|
| **B1** device check before approval | Added §4.2 (exact checks and a blank results table) and §4.3 (every result maps to a defined behaviour, including "time only" and "time only on web"). §1 and §4 rewritten as expectations marked **[confirm: Cn]**; no platform behaviour is stated as fact. The check is still to be run. |
| **M1** exact position in the route address | Now SYC-258, which must ship first. §5.1 describes the rounding honestly; test 6 asserts the value, not a field name. |
| **M2** off-island photo position thrown away | New §3.3, Decision 7, words and test 11. Ermoupoli start kept for "no photo position" only. |
| **M3** GPS clock ordering | §3.4 rule 1 rewritten (photo time plus offset, offset inferred from the GPS clock, then Greek time; the GPS clock never sets the time alone). Test 2 gains the 30-minute fixture. |
| **M4** same-second collisions | Decision 2 rewritten with the phone-side fix; SYC-87 left independent. Test 9 rewritten. |
| **M5** Android permission | Decision 5 rewritten (A / older chooser / revisit); §4 no longer says the permission is the issue. Follow-up SYC-259. |
| **M6** "spotted again" premise out of date | Decision 3 rewritten from current behaviour: owner's push says the day for photos over 24 hours old; round-up unchanged; one English string. |
| **M7** offline map on the website | §7 split by platform; test 15. |
| **m1** last seen on the reward screen | §6 and test 12. |
| **m2** backdating is easy | §5.9, Decision 1 risks, and the `DECISIONS.md` entry. |
| **m3** no position at all is a dead end | Decision 6 widened; §3.2; test 5. |
| **m4** "forgotten" too strong | §1 and §5.2–5.4 reworded precisely. |
| **m5** map tiles | §5.6 (SYC-167 pointer). |
| **m6** time zone of the displayed time | §3.4 and §8 (`photoTakenAt` says Greek time); test 13. |
| **m7** test 6 unwritable | Rewritten as value-based tests (§9 test 6). |
| **m8** XMP in the server test | §5.5 and test 8; SYC-260. |
| **m9** accuracy | §3.1, §6 and `mapStartedApprox`. |
| **m10** "needs help" time | §12; SYC-260. |
| **m11** wording | "Today" and "built versus proposed" framing and the internal jargon removed; the spec describes the whole product as one vision. |
| **Decisions 1, 2, 3, 5, 6** | Recommendations updated, each with a "Changed after review" note (Decisions 1 → 21 days, 2 → phone-side fix, 3 → owner push with the day, 5 reworded, 6 widened). Decision 4 agreed, made conditional on the device check. Decision 7 added. |
| **What held up** | Kept: no new public emitter, server stripping, no new spoofing power, true dates helping the death rule, reading tags before compression. |

Canonical facts respected: "spotter" and "cat guardian", the whole product described as one vision, the audiences complementary, and offline stated precisely per platform (§7).
