# Starting the map where (and when) a library photo was taken

**Status:** **Draft for Samuel's approval, 7 October 2026.** Not yet adversarially reviewed. Nothing is built.
**Owner:** Samuel
**Covers:** SYC-166, from Linda's email of 30 September (a cat seen earlier near a friend's house in Talaras; the app started the map where she was *now* and dated the sighting to the moment she picked the photo).
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §6 and §10.6 (blurring and where it is applied), §10.8 test 13 (photos carry no GPS) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4 (the 1.5 km rule) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) §3.6 (repeat protection) · [`add-details-later.md`](./add-details-later.md) (the 30-day answer window) · [`DECISIONS.md`](./DECISIONS.md) Part 2h (the 500 m rule) · SYC-87 (dedupe by client reference), SYC-164 (the draggable web map, done)

**What this document owns.** What the app does with the location and time stored inside a photo the spotter picks from their library. It does **not** own blurring, the matching distances or the answer window; it points at the specs that do.

---

## 1. The short version

When a spotter picks a photo from their library, the app looks inside the photo for **where** and **when** it was taken.

- If the photo says where, the "Where did you see it?" map **starts there**, with a line saying so. The spotter still checks the pin and can move it. What is saved is the pin they confirm, exactly as today.
- If the photo says when, **that is the sighting's time** (shown on screen as "Photo taken 3 October, 18:42"), as long as it is recent enough (§3.4).
- If the photo says neither, nothing changes from today, except that the screen is honest about it: *"This photo doesn't say where it was taken, so the map starts near where you are now."*

The photo's exact position is used on the phone to place the map, once, and is then forgotten. It is never saved as a separate field, never sent anywhere new, and never reaches a public payload (§5).

The camera paths are untouched: a photo taken now was taken here, now.

---

## 2. The problem

Logging a cat after the fact from the library will be common, especially for tourists at the end of the day. Today, picking a photo does two wrong things (`spot.tsx`, `pickPhoto`):

1. **The map starts at the phone's current position.** Linda was across the island from the cat, so she had to find Talaras by hand. Until SYC-164 (merged 1 October) the web map couldn't even be dragged, so her sighting was saved where she was standing.
2. **The sighting's time is "now".** A photo from Tuesday logged on Thursday counts as Thursday: for the streak, for "last seen", for the team's food-and-water timeline.

It is also worse for tourists than locals: a tourist back home in Germany, logging the cat from the plane, has a map that starts in Germany.

| | Tourists | Cat guardians and residents |
|---|---|---|
| **How they log from the library** | That evening at the hotel, or days later from home | After a walk, or a cat a neighbour photographed |
| **What goes wrong today** | The map starts at the hotel (or in another country) and the day is wrong | The map starts across town, and the pin has to be dragged each time |
| **What they gain** | The pin is already on the right street | The same, with fewer drags |

---

## 3. What a spotter sees

### 3.1 When the photo has a location

On the "New spot" screen after choosing from the library, the map is already centred on the photo's position and the line under the map reads:

> *We've started the map where this photo was taken. Drag it if that's not quite right.*

The pin works exactly as now. "Check for matches" saves the pin's position. A spotter who has location permission switched off can now continue too: the photo supplies the starting point, so the screen is no longer stuck on "Location permission is needed".

### 3.2 When it doesn't

The map starts where the phone is, as today, and the line says so (en: *"This photo doesn't say where it was taken, so the map starts near where you are now. Drag it to where you saw the cat."*). Typical cases: a screenshot, a photo forwarded on WhatsApp, a phone with photo location switched off, and most photos picked on the website (§4).

### 3.3 When the photo, or the phone, isn't on Syros

The tourist case. If the photo's position is **not on Syros** (outside the island's rectangle, with a small margin), the app ignores it. If the phone itself isn't on Syros either, the map starts in **Ermoupoli** instead of in another country:

> *We've started the map in Ermoupoli. Drag it to where you saw the cat.*

This also applies when there is no photo position at all and the phone is away from the island. The phone's own position is used only when it is on Syros.

### 3.4 The time, and how old is too old

The photo's taken-at time becomes the sighting time, sent as `capturedAt` as it is today. Three rules:

1. **Which clock.** The most trustworthy time wins: the GPS clock if present (it is in UTC, so no guesswork), else the photo's own time with its UTC offset if it has one, else the photo's time read as **Greek local time** (Europe/Athens), which is also how streak days are counted.
2. **Nonsense is ignored.** A time in the future, or that can't be read, falls back to "now" without comment.
3. **Too old.** A photo older than the limit in Decision 1 isn't accepted for a sighting. The screen says *"This photo was taken on 12 September, more than 14 days ago. We can only record sightings from the last 14 days. Please choose a newer photo."* and offers the library again. Why a limit at all: the server moves any date older than 30 days to "30 days ago" without telling anyone (`captureTime.ts`), and a saved-for-later item is flagged stale 30 days after its photo date (`offlineQueue.ts`), so a 29-day-old photo would have one day left to be sent.

When the time is the photo's, the screen shows it ("Photo taken 3 October, 18:42"), so the spotter can see what date will be recorded.

---

## 4. What each kind of phone actually gives us

Checked against `expo-image-picker` 17.0.9's own source, the server code, and the app's photo handling. **Not yet tried on real phones.** The first build task is a half-hour check on one iPhone, one Android and the live site, and the numbers in this section are corrected from it before anything else is written.

| | **iPhone app** | **Android app** | **Website** |
|---|---|---|---|
| **Does the picker give the photo's information?** | Yes, with `exif: true`. It reads it from the original library photo, including GPS (`GPSLatitude` with its N/S `GPSLatitudeRef`, likewise for longitude), `DateTimeOriginal`, the UTC offset and the GPS clock. The app already asks for the original (HEIC) untouched, so nothing is lost | Yes, with `exif: true`, via Android's own reader. Latitude and longitude come back as signed numbers, **and** with N/S/E/W letters; time zone offsets are not passed through | **No.** The picker's website code says EXIF support is not written yet. We read it ourselves from the file the browser hands over (§4.1) |
| **What may still be missing** | Photos the owner shared with location switched off; some limited-photo-access cases. The picker returns nothing rather than failing | Android 10 and later hide a library photo's GPS from apps unless a special "access media location" permission is granted. The app doesn't ask for it (Decision 5). The photo's time is not hidden | **Most photos.** Safari on iPhone and Chrome on Android usually remove location from photos chosen on a web page (the ticket's own warning). Photos exported to a laptop (AirDrop, cable, Photos export) often keep it |
| **HEIC** | Fine: read natively | Fine | iPhone Safari converts HEIC to JPEG on upload. A true HEIC file on a desktop browser gives no information (Decision 4) |

**Does it survive the app's compression?** It doesn't need to. Two steps re-encode a picture and discard its information: `shrink` (in `spot.tsx`, for very large photos) and `optimizePhotoForUpload` (on a weak connection). So **the photo's location and time are read straight from the picker's answer, before either step**, and the result is held in memory beside the photo. Nothing downstream reads them from the picture again.

The server strips everything from the stored picture anyway (`validatePhotoBase64` re-encodes through `sharp` without metadata; `imageValidation.exif.test.ts` asserts it). That is unchanged.

### 4.1 Reading the website's file

The website already holds the chosen file's bytes in memory (the picker returns them as base64). A small reader looks only at the start of a JPEG for the location and time tags. It must never throw: anything it can't read means "no information", and the flow continues as in §3.2. See Decision 4 for the build-or-borrow choice.

---

## 5. Privacy

The exact position of a photo is the most sensitive location in the system: a friend's house, a hotel room, a feeding spot. The ticket's promise is that it is "only used to start the map", and this spec makes that checkable.

1. **Read once, on the phone, held in memory.** The photo's position is never put in a route parameter, a log line, an error report or a new field of the queue. The queue and the upload carry the same fields as today: the confirmed pin and the time.
2. **What is saved is the confirmed pin, nothing else.** Whether the pin started at the photo, at the phone or in Ermoupoli, the saved sighting is the same shape, and the app does not record which. (An unmoved pin that started at the photo equals the photo's position; that is the spotter's own choice to confirm and is no more exact than a pin they dragged there.)
3. **No new public surface.** Blurring, who sees what, and the rule that no public payload carries a sighting coordinate belong to `cat-record-data-spine.md` §6 (method §6.2, other channels §6.4) and §10.6 (the one serialiser). This feature adds no emitter, so none of that changes. A photo's own GPS reaching the public through the picture file is the data spine's §6.4.5 and test 13 in §10.8, already tested for spotter uploads. This spec **relies on those tests staying green and adds none to the server**.
4. **The time becomes more truthful in the public view, not more exact.** Public pages show a date only (§6.4.4). A backdated sighting simply shows its true date.
5. **Deleting yourself (SYC-63)** already removes a person's queued items; nothing new is stored that it would miss.

---

## 6. Matching, and the rules that use the saved location

Both distance rules measure from the **saved pin**, never from the phone: suggested matches only within **500 m** (`DECISIONS.md` Part 2h), and the "Cats known around here" list and server check at **1.5 km** of a cat's published square (`choose-a-different-cat.md` §4). Nothing in those rules changes.

What changes is how often the pin is right the first time. For Linda, the photo's position is within metres of the cat, so the matcher looks at the right cats; with the phone's position it was looking at the cats near her friend's house across town. Accuracy of a photo's own GPS is tens of metres, well inside both rules, and a pin dragged somewhere else wins.

The sighting's time now matters to three other things: the streak day (counted in Greek time), "last seen" (a date), and the team's food-and-water order (add-details-later Decision 4). All already use the stored capture time, so they get the true date with no change. The reward-screen questions stay open until 30 days after the photo, which is why Decision 1 stops short of 30.

---

## 7. What works offline

Picking a photo, reading its position and time, showing the map (from the offline Syros tiles where downloaded) and saving the sighting for later all work without signal: the work is done on the phone, and the queue already stores the pin and the photo's time. **Matching, the catalogue beyond what is saved, and sending need a connection**, as now. A saved-for-later sighting dated from an older photo has the shorter life described in §3.4.

---

## 8. Words (en, el, fr; need native review, SYC-4)

| Key | English | Greek | French |
|---|---|---|---|
| `mapStartedAtPhoto` | We've started the map where this photo was taken. Drag it if that's not quite right. | Ξεκινήσαμε τον χάρτη από το σημείο όπου τραβήχτηκε η φωτογραφία. Σύρε τον αν δεν είναι ακριβώς εκεί. | On a démarré la carte là où la photo a été prise. Fais-la glisser si ce n’est pas tout à fait ça. |
| `mapStartedAtYou` | This photo doesn't say where it was taken, so the map starts near where you are now. Drag it to where you saw the cat. | Η φωτογραφία δεν δείχνει πού τραβήχτηκε, οπότε ο χάρτης ξεκινά κοντά στο σημείο που βρίσκεσαι τώρα. Σύρε τον εκεί όπου είδες τη γάτα. | Cette photo n’indique pas où elle a été prise, alors la carte part près de l’endroit où tu es maintenant. Fais-la glisser là où tu as vu le chat. |
| `mapStartedInTown` | We've started the map in Ermoupoli. Drag it to where you saw the cat. | Ξεκινήσαμε τον χάρτη στην Ερμούπολη. Σύρε τον εκεί όπου είδες τη γάτα. | On a démarré la carte à Ermoupoli. Fais-la glisser là où tu as vu le chat. |
| `photoTakenAt` | Photo taken {when} | Η φωτογραφία τραβήχτηκε {when} | Photo prise {when} |
| `photoTooOld` | This photo was taken on {date}, more than {days} days ago. We can only record sightings from the last {days} days. Please choose a newer photo. | Η φωτογραφία τραβήχτηκε στις {date}, πριν από περισσότερες από {days} ημέρες. Μπορούμε να καταγράψουμε μόνο θεάσεις των τελευταίων {days} ημερών. Διάλεξε μια πιο πρόσφατη φωτογραφία. | Cette photo a été prise le {date}, il y a plus de {days} jours. On ne peut enregistrer que les observations des {days} derniers jours. Choisis une photo plus récente. |

The existing `confirmLocationHint` ("It starts near where you are.") stops being shown for library photos and stays for the camera.

---

## 9. Tests that must exist

1. **Reading the tags, every shape.** Pure function with fixtures: iPhone (unsigned latitude plus N/S letter), Android (signed plus letter, which must not double-negate), website degrees-minutes-seconds. Southern and western hemispheres. A position of exactly 0, 0 is "missing", not a point in the sea. Out-of-range and non-numeric values are "missing".
2. **The clock.** GPS time beats photo time plus offset, which beats photo time read as Greek time. A photo from 25 October 2026 around 03:00 (clocks go back) resolves to one defined instant. A future time and an unreadable time fall back to now.
3. **The age limit** at the edge: one minute inside accepted, one minute outside refused, with the screen text and the library re-offered.
4. **Website reader.** A JPEG with GPS, one without, big- and little-endian, truncated, corrupt, and a very large file: never throws, never hangs, returns "no information" when unsure. A HEIC file returns "no information".
5. **The map start.** Library photo with position: pin starts there, even if the phone's own position arrives *afterwards*. Without: starts at the phone. Phone and photo both off-island: Ermoupoli. Retake and re-pick reset it. Camera path unchanged. (The map only repositions on its first coordinates, so the screen must be given a fresh start when the start changes.)
6. **Submission.** The request carries the confirmed pin and the photo's time, and the saved-for-later item has exactly today's fields. A snapshot test fails if a photo-position field appears in the queue item, a route parameter or a log call.
7. **Compression doesn't matter.** Run the pick through the `shrink` and weak-connection paths with a mocked picker; the start position and time are the same.
8. **Privacy, existing and one new.** `imageValidation.exif.test.ts` and data spine test 8 (no exact coordinate in any public payload) stay green and are named in this PR's description. New: a sighting backdated by a photo time still serialises with a date only.
9. **Repeat protection** (Decision 2): two photos with the same second on one device make two sightings.
10. **Words.** All five keys exist in en, el and fr. Checked in the browser at ~390 px and desktop width, with `cat-spotter/language` set to `el` and `fr`.

---

## 10. Decisions for Samuel

### Decision 1 · How old can a library photo be?

| | **A. 30 days (today's server limit)** | **B. 14 days (recommended)** | **C. 7 days** | **D. No limit** |
|---|---|---|---|---|
| **What the spotter sees** | Any photo from the last month works | A fortnight of photos works | A week | Anything works |
| **Benefits** | Matches the existing limit; nothing new to explain | Covers "the evening", "the weekend" and "home from holiday". Leaves two weeks to send it (saved-for-later) and two weeks to answer the questions | Tightest, freshest data | Nothing is refused |
| **Risks** | A 29-day-old photo saved offline goes stale a day later and can never send; the reward questions have a day left. A confusing dead end | A tourist logging a three-week-old photo is turned away | Turns away the tourist who logs once a week | Needs a server change: today it quietly moves older dates to "30 days ago", so the sighting would carry the wrong date. Old data also makes "last seen" and the streak easier to inflate |
| **Effort** | One constant | One constant | One constant | Server and queue changes |

**Recommendation: B.** Two to four weeks of unfinished life is the problem with A. One constant (`MAX_PHOTO_AGE_DAYS`), easy to change after the first real month.

### Decision 2 · Two photos taken in the same second

Photo times are accurate to the second. The server treats a second sighting from the same phone with the same time as a repeat and returns the first (`offline-queue-on-web.md` §3.6). With "now" this never happened; with photo times, two shots in a burst of the same cat, or two cats photographed in a second, can collide. The second would then show the *first* photo's match, silently.

| | **A. Do nothing, accept the risk** | **B. Build SYC-87 (a client reference per sighting) first (recommended)** | **C. Add sub-seconds to the time and hope** |
|---|---|---|---|
| **What the spotter sees** | Rare wrong match on a burst | Nothing: each sighting is its own | Fewer collisions, not none |
| **Benefits** | No work | Fixes it properly, and closes SYC-87's two known gaps | No schema change |
| **Risks** | Silent wrong answer on the one flow this feature encourages | A small database change (a new column and unique index); it must queue behind migration 0012 (SYC-63) and SYC-3's | Phones don't all record sub-seconds; bursts can still collide |

**Recommendation: B**, as a prerequisite PR for this feature. If Samuel wants no database change, C is the fallback, with A's risk noted.

### Decision 3 · "Spotted again!" for a photo taken days ago

Resolving a sighting tells the cat's followers *"Agatha was spotted again!"* straight away (`routes/sightings.ts`). With backdated photos that could go out about a cat last seen on Tuesday.

| | **A. No notification if the photo is more than 48 hours old (recommended)** | **B. Send always** | **C. Send, but word it as earlier** |
|---|---|---|---|
| **What followers see** | Nothing for old photos; the cat page still shows the new photo and date | A fresh-sounding alert about a stale sighting | "Agatha was spotted on Tuesday" |
| **Benefits** | Notifications stay true; trivial to build | No change | Followers still hear |
| **Risks** | A follower misses an update from a late logger | Followers learn to ignore them; a false "now" feel (data spine §6.4.4 already wants coarse alerts) | New notification wording in three languages |

**Recommendation: A.** The page is the record; the alert is for "now".

### Decision 4 · Reading the website's file

| | **A. A small reader of our own, JPEG only (recommended)** | **B. A library (for example `exifr`)** | **C. Don't support the website** |
|---|---|---|---|
| **Benefits** | Tiny, no new dependency; covers what Safari and Chrome actually send | Handles HEIC and odd files | Nothing to build |
| **Risks** | We own the parsing bugs (hence the test list); HEIC on a desktop browser gives nothing | A dependency of some tens of kilobytes on every web load | Laptop-at-the-hotel tourists, the people who benefit most on the website, get nothing |

**Recommendation: A.** The website will rarely benefit (§4), so it should cost little.

### Decision 5 · Android and the "access media location" permission

| | **A. Don't ask (recommended)** | **B. Ask for it** |
|---|---|---|
| **What the spotter sees** | On Android, the time works but the position usually doesn't (Android hides it); they see the "doesn't say where" line | An extra permission request about their photos' locations |
| **Benefits** | No new permission prompt for a charity app; no change to the store listing | Android photos could start the map |
| **Risks** | Android users get half the feature | A scary prompt; may still return nothing through Android's system photo picker. Needs the first-build check to know |

**Recommendation: A**, then revisit with what the first-build check shows. The privacy line to Syros Cats stays simple: we never ask to read where your photos were taken beyond what you hand us.

### Decision 6 · Starting the map in Ermoupoli when nothing else works

| | **A. Ermoupoli's centre when the phone isn't on Syros (recommended)** | **B. Keep starting at the phone** |
|---|---|---|
| **What the spotter sees** | A tourist at home sees Syros, not their street | A map of Munich with a cat pin to drag 2,000 km |
| **Benefits** | Always usable | No change |
| **Risks** | Town isn't where every cat is; the line tells them to drag | The current dead end |

**Recommendation: A.** There is no server check that a sighting is on the island (none found in `sightings.ts`); filed separately (§12).

---

## 11. Proposed `DECISIONS.md` entries

*(To be added by Samuel on approval; this chip does not edit that file.)*

- **Library photos set the map's start and the sighting time (SYC-166).** Where the photo has a position on Syros, the map starts there; the saved location is still only the pin the spotter confirms. The photo's taken-at time is the sighting time, within the age limit chosen in Decision 1. The exact position is never saved as its own field, logged or sent anywhere new.
- **Off-island phones start the map in Ermoupoli** (Decision 6).
- **Followers aren't told "spotted again" about photos older than 48 hours** (Decision 3), if A is approved.
- Decisions 1–6 as chosen by Samuel.

---

## 12. Not in this spec (to be ticketed)

- **A server check that a sighting is on Syros.** A sighting dated and placed in Athens would create a cat there. Pre-existing; this feature makes it slightly more likely (photo positions off-island are ignored by the app, but a modified app could still send one).
- **Asking "when did you see it?"** when a library photo has no time (a screenshot or a WhatsApp forward) and the spotter is logging days later. Today it is "now". Add if testers hit it.
- **Correcting sightings already saved in the wrong place** is SYC-165 (not touched here).

---

## 13. Self-review against the code and `DECISIONS.md`

Checked while writing; each is reflected above.

- The ticket's and brief's reference to "§10.8" for blurring: the blurring method is §6 and §10.6; §10.8 is the test list, which holds the EXIF test (13) and the no-public-coordinate test (8). Cited accordingly.
- "It's never stored beyond what we store today": true as designed. The app uploads the original file with its tags (as today); the server strips them before storing; the queue stores only the pin and time.
- The reward-screen answers use `sighting.createdAt` (the capture time) for their 30-day window (`routes/sightings.ts`), and the offline queue flags items 30 days after `createdAt`. Both make a very old photo a trap, hence Decision 1.
- Repeat protection is keyed on device plus exact capture time, so photo times create a new collision case (Decision 2). SYC-87 is Backlog/Low today; this promotes it to a dependency if B is chosen.
- Nothing here edits the offline queue's shape, the OpenAPI spec or generated clients, so it should not conflict with SYC-63 (queue store, i18n) or SYC-3 beyond a possible i18n merge: five new keys in `lib/i18n.ts`.
- Not yet verified on a device: whether iOS honours a photo owner's "location off" choice at the picker, and exactly what Android hides (§4). The first build task settles both before anything else is written.
- Canonical facts respected: "spotter", no "built today versus proposed" split, no claim that the app works without signal (§7 lists what does and doesn't).
