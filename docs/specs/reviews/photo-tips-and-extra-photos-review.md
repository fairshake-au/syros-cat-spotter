# Adversarial review: docs/specs/photo-tips-and-extra-photos.md (SYC-415)

## Verdict
Not ready to approve. The photo-tips half (section 3) is sound and cheap. The extra-photos half (sections 4 to 6) rests on two claims the code contradicts. First, "the lead photo is chosen from what the matcher says, and kept in sightings.photo_id": the sightings table has a database trigger that forbids updating photo_id, and the matcher runs after the rows are saved. Second, "every existing reader keeps working unchanged": hide/restore and report-an-issue authorisation, the offline queue's cleanup sweep, and the review screen all key on one photo per sighting. Several other promises (per-photo no-cat answers, "saved together or not at all", the 2-hour rule, "already logged" for extras, the 1600px shrink) are either not what the code does or not possible without changes the spec does not list. Two plain-English/house-rule nits at the end. Fixable, but the spec needs a rewrite of 5.2, 5.3, 6.1 to 6.3 before approval.

## Findings

### 1. [Blocker] Lead photo cannot be chosen after the matcher answers: sightings is append-only
Spec: 5.2, 5.3, 6.2 ("sighting's existing single-photo field keeps pointing at the lead photo").
Evidence: lib/db/migrations/0013_deletion_unlinks_people.sql:21-77 -- trigger `sightings_append_only` allows only a pending->resolved/awaiting_team status move and redaction; any other UPDATE raises. `photo_id` therefore cannot be changed after insert. In routes/sightings.ts:568-599 the photo and sighting are inserted first and the matcher runs afterwards (computeMatchCandidates, line 591). The lead rule in 5.3 ("face photo if it shows a cat, otherwise first photo...") needs the matcher's per-photo answer, which does not exist at insert time. The spec never says whether the lead is chosen before or after the matcher.
Fix: pick one and write it down. (a) Lead is fixed at insert by a simple rule that does not need the matcher (face if present, else first, else body) and the matcher's per-photo "no cat" result only affects whether a photo is shown/kept, via the new per-photo table (which can be mutable or have its own state column). Then say what happens when the lead itself turns out not to be a cat. (b) Run the matcher before inserting anything. That changes failure handling (recordMatch needs a sighting id; a matcher timeout must not block saving) and the dedupe path. Do not leave "pointing at the lead" and "chosen after the matcher" both in the document.

### 2. [Blocker] "Not kept" extras and "saved together or not at all" contradict each other and the current insert code
Spec: 5.2, 6.1, 6.2, 8 (Server tests).
Evidence: sightings.ts:575-589 inserts photo then sighting as two separate statements, no transaction. 6.1 promises "saved together or not at all"; 5.2 promises no-cat extras "are not kept". To drop an extra after matching you must delete a photos row (or never write it) after the sighting exists. Deleting is not currently done anywhere in this path; photo_visibility_events has a FK to photos(lib/db/src/schema/photoVisibility.ts:38) and observations/welfare reports hold photo ids. Nothing says if "not kept" means hard delete, or flag-hidden-forever, or never written.
Fix: specify the exact order: validate all photos -> (match) -> one transaction writing sighting + kept photo rows. If matching must follow the insert, say extras are written as rows with a `kept` flag the matcher result flips, and public readers filter on it (and add that filter to the list in finding 3).

### 3. [Blocker] Extra photos have no link a sighting-based reader can find: hide, report, capability checks, stand-in rule
Spec: 5.5 ("hide / restore work on each photo separately, because they already work per photo"), 6.2 ("everything that already reads one photo per sighting keeps working").
Evidence: lib/capabilityTargets.ts:50-84 `catsOfPhoto` finds the cats a photo belongs to through cats.primary_photo_id, sightings.photo_id and observations.photo_id only. An extra photo is none of those, so it returns [] and `photoTargets` falls back to `[{colonyId: null}]` (line 81-83): a colony-scoped guardian or team member cannot hide or restore an extra, and a report about it resolves to no cat (routes/teamReports.ts:128). lib/photoVisibility.ts:149 (stand-in when the main photo is hidden) and lib/coatReading/due.ts:196-215 also join on sightings.photo_id only. lib/teamCatView.ts:670-850 builds the team gallery from sightings.photoId. routes/cats.ts:246-336 returns one photoUrl per sighting. The claim "already work per photo" is true only for photos reachable from those three links.
Fix: list every reader that joins sightings.photo_id (the files above plus resolve observations at sightings.ts:1066, the "recent" query at 1116) and state, per reader, what it does with extras. At minimum catsOfPhoto must also look in the new per-photo table, with a test that a colony guardian can hide an extra but not another colony's. Add the public cat payload (new `photos[]` per sighting, OpenAPI + generated zod, cats cache key bump at lib/catalogue.ts:17) to the work list.

### 4. [Major] Matcher cannot give a per-photo answer today, and failure semantics are undefined
Spec: 5.1, 5.2, 8 (Matching).
Evidence: lib/matching.ts:21-62 returns a single `isCatPhoto` for "the first image". The prompt and output schema must change to N flags; the response schema CreateSightingResponse (lib/api-spec/openapi.yaml ~1195, generated zod api.ts:384) has one boolean. On a matcher failure computeMatchCandidates (sightings.ts:243-342) leaves isCatPhoto = true and returns no candidates. For a three-photo spot a failed matcher gives no per-photo answer: spec does not say extras are then kept unchecked (likely), nor which is the lead (should be rule-based, see finding 1). An LLM asked for 3 yes/no answers will sometimes call a face close-up or a cat in a carrier "not a cat"; with 5.2 that silently deletes a spotter's deliberately taken face photo, and it can drop the FIRST photo.
Fix: define the new response field (e.g. `photosKept: [{role, kept}]` plus `droppedCount`), define behaviour on matcher failure (keep all, flag unchecked, lead by rule), and decide what happens when the first photo is dropped but extras stay (the phone's review photo, key 4 below, is then a photo the server discarded). Consider keeping every extra and only using the matcher's flag to refuse the whole spot when NO photo is a cat, as today; that avoids deleting photos on a model's say-so.

### 5. [Major] Dedupe path with extras: the retry re-matches only the lead and ignores the body
Spec: 6.1 ("a repeat of the same spot returns the sighting already saved, with its photos").
Evidence: sightings.ts:520-565: dedupe key is (deviceId, createdAt) and the hit path loads only `existing.photoId` and re-runs the matcher on that one photo (line 545-553). With a face lead, a retry would match the face alone, overwrite sighting_matches (recordMatch, "latest response" rule) and give different candidates than the first answer. The dedupe check runs before any body validation, so a retry that carries a different set of photos (spotter removed one after a timeout) silently returns the old sighting. A retry of a spot whose extras were dropped as no-cat has no way to say which were dropped.
Fix: on a hit, match against all kept photo rows in the same order; or better, return the stored response from the first run. State the response includes the kept/dropped list.

### 6. [Major] Offline queue cleanup will delete queued extras after 24 hours
Spec: 6.3 ("clearing a spot removes all of that spot's photo files").
Evidence: context/OfflineContext.tsx:259-262 builds the keep list from `p.photoUri` (one ref per item) and calls cleanupOrphanPhotos (lib/pendingPhotos.ts, deletes any unreferenced photo older than 24h). Extras not referenced by the queue item shape are orphans and are deleted. `remove` (OfflineContext.tsx:574-586) and `replacePhoto` delete only `photoUri`. deleteAllSightingPhotos wipes by listing the store, so that part is fine. PendingSighting (lib/offlineQueue.ts:15-52) and queueStore parse/validate have one photo and no versioning.
Fix: add `extraPhotos: {role, photoUri}[]` to PendingSighting, update keepRefs, remove, replacePhoto, markStale and the queue parser; say how an old one-photo queue item is read; add a test that a queued 3-photo spot survives the orphan sweep after 25 hours.

### 7. [Major] Queued spot with a missing or rejected extra: whole spot is lost or unfixable
Spec: 6.2 ("whole spot is refused ... The spotter can remove that photo and send again"), 6.3.
Evidence: OfflineContext.tsx:354-373: a missing stored photo marks the entire item error "cleared"/"stale" and it can never upload; with extras, a purged EXTRA would kill a good first photo. The server's 400 text (imageValidation.ts messages) never says which photo failed, and photoRejectionKey (lib/photoRejection.ts) maps only the message. The rejected-card UI (spot.tsx replaceRejectedPhoto, ~line 480) replaces only the first photo (replacePhoto swaps photoUri). "Remove that photo and send again" is therefore possible online but not for a queued spot.
Fix: server 400 includes which role failed (`{error, photo: "face"}`); queue UI offers per-photo replace/remove; a missing extra is dropped with a note rather than failing the item; specify it.

### 8. [Major] Request size: "the first photo is sent as now" plus HEIC and shrink-failure paths exceed the 25 MB body
Spec: 6.1 ("well inside the server's size limit").
Evidence: express.json limit 25mb (artifacts/api-server/src/app.ts:79). spot.tsx:111 accepts a first photo up to 15 MB raw (about 20 MB base64). Extras at 1600px are about 0.3-0.6 MB so the happy path is about 21 MB: margin 4 MB, not "well inside". But the shrink helper returns null on any failure and the caller falls back to the original (lib/photoUpload.ts:57-61: "callers can explicitly fall back"); the web image manipulator cannot decode HEIC (lib/pendingPhotos.ts openPhotoForUpload comment, F9). A HEIC library photo for a tile would go raw at up to 15 MB each, giving 45 MB and a 413. A 413 is a 4xx so classifySyncFailure (lib/offlineQueue.ts:119-123) marks the item permanently failed with the generic "server" error and Retry can never work (photoRejectionKey only recognises 400). The existing resize helper is 1280px width at quality 0.72 and only runs on constrained networks (spot.tsx:574, OfflineContext.tsx:378); spec says 1600px, always, with no quality given, and a face photo that becomes the cat's main photo is then stored at at most 1600px instead of today's 2048px (imageValidation.ts MAX_DIMENSION), double-compressed.
Fix: specify the shrink as mandatory, with a size budget enforced on the phone (reject/skip rather than send if the total will exceed about 18 MB), a defined result when shrink fails, 413 handling in the queue, and a per-photo and total cap on the server (with a clear 400 naming the photo). Decide whether the face photo gets the same 2048px/quality as a first photo when it is the lead.

### 9. [Major] The 2-hour rule has holes, and conflicts with the 21-day rule and retake
Spec: 4.1 (retake keeps tiles), 4.3, 4.4.
Evidence: spot.tsx:424-431: a camera photo has photoTime {kind:'unread'} and capturedAt = now; 4.4 says "if either time is missing the app accepts". So a first camera photo + a library extra from 20 days ago passes (21-day rule only), and a library first photo from 3 days ago + a camera extra taken now passes: the exact two-visits case 4.4 says it stops. The spec also says "the spotter has already seen the first photo's time on screen"; for a camera photo nothing is shown (spot.tsx photo-taken-at renders only for kind 'ok'). clearPhoto (spot.tsx:278-285) resets capturedAt and pickedCoords, so after a retake the new first photo can be days away from kept extras and nothing re-checks them. Extra photos are never checked against the pin.
Fix: treat the camera photo's capture time as `now` for the rule; re-validate tiles when the first photo changes (drop or warn); also require extras taken from the camera to be within a short window of the first photo if it was a library photo; state what time the extras show. Decide if extras from a different place (library photos carry a position the app deliberately never reads) are acceptable.

### 10. [Major] "Already logged" does not cover extra photos; extras can be reused as a later first photo
Spec: 4.3.
Evidence: lib/recentPhotos.ts entryForOutcome (line ~172) records one fingerprint per submit, and spot.tsx:381 keeps a single `photoFingerprintRef`. Extras' fingerprints are never computed or stored, so (a) picking an extra twice, or an extra that was used in an earlier spot, is not caught, and (b) a photo used as a face extra can later be submitted as a first photo of another spot, creating a second sighting (points, streak, "last seen") from the same image: the double-points problem photo-location-from-library.md says must stay closed (see its section on same photo picked twice, ~line 258 and SYC-87). Also "a photo already used in this spot can't be picked again" needs the fingerprint of the first photo, which for a camera photo is deliberately undefined (spot.tsx:429).
Fix: store a fingerprint per photo in the recent-photos entry (array), check all photos in a spot against each other and against the list; for camera photos compare by the base64 hash computed at pick time.

### 11. [Major] Face-photo-as-main-photo may make later matching worse, and the spec's own premise is untested
Spec: 2, 5.4, 7.
Evidence: matching.ts compares only each nearby cat's main photo (sightings.ts:271-281). Tourists mostly take whole-cat photos; today's main photo is typically what future tourists will reproduce. A face close-up as the single reference for every later spot (and for colour reading, 5.4 admits) trades one reference problem for another. Spec 2 asserts the face is "what the matcher recognises best" with no evidence. The body photo, which the spec says tells look-alikes apart, is kept but never used by the matcher (comparing against extras is deferred, 5.1).
Fix: either send both the face and the body/first photo as the new cat's two references now (cost: roughly 2 images per nearby cat, which should be priced), or run a small A/B (face vs first photo as main) and decide later. At least mark Decision 4 as a bet, with a measure that can show it hurt.

### 12. [Major] Metrics in section 7 are not all recorded
Spec: 7.
Evidence: "photos rejected as no cat": the not-a-cat result is never stored. sighting_matches (lib/db/src/schema/sightingMatches.ts) has comparedCatIds, suggested, matcherFailed, choice; no isCatPhoto, and a not-a-cat sighting just stays pending. "Before and after the tips card" cannot be computed. The extra-photos comparison (one photo vs two or three) is confounded: spotters who add photos are the careful ones, so a better pick rate says nothing about whether extras helped. The spec relies on the team view of match records (SYC-151) comparing "before and after" but does not add any column.
Fix: add `catPhotoFlags` or a `notCat` boolean to sighting_matches (or a counter), a `tipsShown` source if wanted, and drop or reword the causal claim; say the comparison is observational.

### 13. [Major] Review screen and the "lead photo shown everywhere" claim
Spec: 5.3, 6.2.
Evidence: spot.tsx:662-669 saves the review photo from the FIRST photo only (`reviewPhotoKey(sightingId)`, single key; pendingPhotos deleteReviewPhoto and the 7-day review-photo sweep know one key). review.tsx:251,696 shows that one photo as "yours". Spec 5.3 says the review screen shows the lead photo; the phone does not know the lead (finding 1/4) and the response does not include it. Also the queued-item response saved in the queue (isCatPhoto, candidates only, offlineQueue.ts:49-51) has no place for "one photo was left out" (5.2), so a spot that synced offline never shows that line.
Fix: either the review screen shows the first photo (simplest, say so) or the response returns the lead role and the phone keeps the matching local copy; add a new field to the queue item for the left-out line.

### 14. [Major] Tile "Take a photo" is not "the same two ways as the first photo"; web behaviour unspecified
Spec: 4.1, 3.2.
Evidence: the first photo is normally taken with the in-page live viewfinder (CameraView, spot.tsx captureLivePhoto, ~line 385) shown only while there is no photo; once a photo exists the viewfinder is not on screen. A tile can only use the system picker (ImagePicker.launchCameraAsync, choosePhoto line 160), which on web is a file input with capture (and spot.tsx notes browsers only open it from a direct tap). Tips card "Got it opens the camera" has the same user-activation constraint when it is a modal over a picker-only shutter. In-app web views (the testers' email-link route, per spot.tsx comments) often have no camera at all.
Fix: say what a tile's camera does on each of native, web with live camera, web picker-only; keep Got it from opening a picker programmatically (it should only reveal the viewfinder or the shutter).

### 15. [Major] Two cats in one spot: nothing stops mixed-cat spots, and the matcher is told they are the same cat
Spec: 4.4, 5.1.
Evidence: the matcher prompt (matching.ts:24-31 today) would be rewritten to say "same cat from different angles". Within two hours at one spot (a feeding station) it is normal for two cats to be photographed. A face of cat A and a body of cat B gets matched as one cat; the face leads, B's body is attached to A's page; the team can only hide it photo by photo and "choose a different cat" cannot move a single photo (cat-record-data-spine.md:376). No "this isn't the same cat" outcome.
Fix: give the spotter a way out (Add a separate spot), tell the matcher to answer "photos disagree" and reject/split, and say what the team does with a mixed spot.

### 16. [Minor] Storage and cost not stated
Spec: 4.3 ("keeps storage in check"), 5.1.
Evidence: photos live as base64 text in Postgres (lib/db/src/schema/photos.ts:36); hosting-and-photo-storage.md estimates ~60,000 photos per season, ~47 GB as text, ~16 USD a month at MLP, and says SYC-46 and a one-year shrink rule (6.7) must cover every photo. Up to 3x photos per spot triples that line if even half of spots add extras. The spec gives no number and does not add the new table to the retention job or to the SYC-46 migration.
Fix: add a short cost line (extra photos per spot expected, GB, euros per month), and name the retention/SYC-46 follow-ups. Also note validatePhotoBase64 for 3 photos in one request (HEIC WASM decode is slow, 3 times) plus the matcher call with 13 images may exceed proxy/request timeouts; say the request budget.

### 17. [Minor] Rollout and compatibility
Spec: 6.1, 6.3.
Evidence: CreateSightingBody is zod.object (lib/api-zod/src/generated/api.ts:376), which strips unknown keys. A new phone talking to a not-yet-deployed server (web is deployed through Replit publish, native/Play builds lag) would send extras that are silently dropped and the queue item is then cleared as success. Old native builds sending one photo must still work (they will).
Fix: server ships first; client checks a capability flag (e.g. `/api/healthz` version or response field `photosAccepted`) before showing tiles; add to the plan.

### 18. [Minor] Public photo address and caching of hidden extras
Spec: 5.5.
Evidence: routes/photos.ts:64 serves photos `private, max-age=31536000, immutable` (SYC-279). A hidden photo 404s only when re-requested; a browser that already cached an extra keeps showing it for a year. More public photos per sighting widens the "hidden but still visible in cache" case for privacy-driven hides (a person in a body shot). Also extras get a public id the moment they are written (before the sighting is resolved), unreachable only because nothing links to them: say they are never listed before resolve.
Fix: state the existing limit applies; no change needed beyond a sentence.

### 19. [Minor] Privacy: people and hidden data in extras
Spec: 6.2, 6.4.
Evidence: imageValidation.ts strips all metadata (sharp without withMetadata), so GPS is gone for extras (good). But the library picker is used for extras (4.3), so a spotter can attach any recent library photo (a person, a house number) and the spec's only guard is the matcher's no-cat flag (which, per finding 4, is unreliable and the no-cat rule only drops photos with NO cat). The "Delete my data" paragraph (6.4) is correct in effect (sighting redaction clears device only, photos stay), but should say plainly that extra photos stay on the cat page after deletion, as the lead does; and the new per-photo table must be listed as having no spotter column.
Fix: add one sentence to 6.4 and an extra line on the tile for library photos ("Only photos of the cat, please").

### 20. [Minor] Accessibility and layout not specified
Spec: 3.1, 4.1.
Evidence: SVG sources have aria-labels (docs/specs/assets/photo-tips/*.svg) but the spec does not say how the labels reach the app (react-native-svg is present, package.json:68), and the tile is a tappable control that needs its own label ("Add the face. Optional.") and state ("face photo added, remove"), a 44px minimum hit area for the small remove cross, and keyboard/focus order on web. The ✓ and ✗ glyphs and ＋/✕ are emoji-like characters, not described for screen readers. Layout: the New spot screen today is one 88px thumb with title, hint and Retake beside it (components/NewSpotIntro.tsx:33-60); "one row, first photo, two tiles, Retake under the photo" at 390px does not fit without redesign, and the existing hint ("Where did you see it") moves.
Fix: add an accessibility paragraph and a 390px layout sketch before approval.

### 21. [Minor] "Delete my data" and the tips flag
Spec: 3.2.
Evidence: context/DeleteMyDataContext.tsx:94-98 wipes an explicit list of keys; the tips flag is not on it, so the sentence "Delete my data clears it with the rest" is true only if the build adds it. Also tips-seen is not personal data, so clearing it is a choice (a tester who deletes data sees the card again).
Fix: say it is deliberate and name the step in the plan.

### 22. [Minor] House rules
- The spec is aspirational: it should not say what changes relative to today. Phrases that do: 6.3 "Spots queued before this change, with one photo, send exactly as before"; 5.5 "as now"; 6.1 "the first photo as now"; 4.1 "(SYC-118)... as now"; 10 follow-up wording; section 4.2 "exactly as it is today". Rewrite as compatibility statements about old queued items only if truly needed, or move to the plan.
- 3.4 "work with no signal": accurate for the bundled cartoons, but the claim "on the website once it has loaded" should be conditional on the web build's actual offline behaviour (unchecked here: whether the web build has a service worker; if not, a reload with no signal fails).
- Plain English: 5.3 "lead photo", 6.1 "single shared photo-saving step", "photo rows", "matching limit" and 6.2's database paragraph are developer language in a document Samuel approves. The decision table (section 9) also lacks the options and risks of the alternatives (no benefits/risks per option, no UX per option), against Samuel's decision-format rule.
- Terminology check: "spotter" and "cat guardians" used correctly; no "snapper", no "colony carer"; no sterilisation figure mentioned. OK.
- Unresolved first-time card wording "(Samuel, 15 October) ... all as recommended" cannot be verified from the document.

REVIEW COMPLETE

---

## How each finding was handled (15 October 2026)

Claude checked the blockers against the code before acting: the append-only trigger (`0013_deletion_unlinks_people.sql`), `catsOfPhoto` (`capabilityTargets.ts:50-84`), the orphan sweep keep list (`OfflineContext.tsx:257-262`) and the insert-then-match order (`sightings.ts:568-599`) are as described. One claim was wrong: `react-native-svg` *is* installed (`artifacts/cat-spotter/package.json:68`), so the cartoons can ship as SVG. No service worker was found in the web build, so the "no signal on the website" claim was narrowed.

| # | Outcome | Where |
|---|---|---|
| 1 | Fixed. The cover photo is chosen by a fixed rule at save time (face, else first), not from the matcher's answer. `photo_id` is written once. | §5.1, §6.2 |
| 2 | Fixed. Order is: check every photo → save all in one go → match. No photo is ever dropped after saving. | §5.3, §6.2 |
| 3 | Fixed. Every reader that joins on a sighting's photo is listed with what it does with extras; hide/restore/report authorisation must find extras' cats; tests added. | §5.5, §6.3, §9 |
| 4 | Fixed by design change: no per-photo verdicts. The matcher answers "any cat?" and "more than one cat?" for the spot; matcher failure keeps all photos. | §5.2, §5.3 |
| 5 | Fixed. A repeat send matches all the spot's photos in the same order. | §6.1 |
| 6 | Fixed. Tidy-up keeps every photo of a waiting spot; remove/replace cover all; test after >24 h. | §6.4, §9 |
| 7 | Fixed. Missing extra → spot sends without it, with a note; refusal names the photo; per-photo replace. | §6.2, §6.4 |
| 8 | Fixed. Extras prepared to 2048px at server quality; unpreparable photos refused at pick time; whole-spot size check on the phone; a too-large refusal is fixable. | §4.3, §6.1, §6.4 |
| 9 | Fixed. Camera photos' time is when taken; rule applies whenever both times are known; retake re-checks extras. | §4.3 |
| 10 | Fixed. Every photo in a spot is remembered for "already logged"; a photo can be used once. | §4.3 |
| 11 | Addressed. Decision 4 stands (Samuel's call) but is marked as a bet with a measure and a one-line switch. | §5.4, §8 |
| 12 | Fixed. The match record stores "no cat" and "more than one cat"; the one-vs-three comparison is labelled as a pattern, not a cause. | §6.2, §8 |
| 13 | Fixed. Cover rule is fixed, so the phone knows it and the result screen shows it, including for queued spots. The "left out" line is gone with the drop rule. | §5.1 |
| 14 | Fixed. Boxes use the phone's own camera or the browser's chooser; "Got it" never opens a picker. | §3.1, §4.1 |
| 15 | Addressed. "Same cat only" on screen; matcher flags "more than one cat" for the team; moving a stray photo filed as a follow-up. | §4.5, §11 |
| 16 | Fixed. Cost line added (~+35 GB, ~US$12/month at the season estimate); SYC-46/SYC-81 cover extras. | §6.3, §6.6 |
| 17 | Fixed. Server ships first; app shows boxes only once the server confirms. | §6.7 |
| 18 | Fixed. Existing cache limit stated; extras never listed before resolve. | §5.5, §7 |
| 19 | Fixed. Privacy section added; extras stay on the cat page after deletion. | §6.5, §7 |
| 20 | Fixed. Accessibility and 390px layout described. | §3.4, §4.1 |
| 21 | Fixed. Clearing the tips mark on "Delete my data" is stated as deliberate. | §3.2 |
| 22 | Fixed. "As now / today" phrasing removed; "lead photo" renamed "cover photo"; decision table lists options with their risks. | throughout, §10 |
