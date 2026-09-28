# Offline queue on the web build — spec

**Tickets:** SYC-76 (crash at "check for matches") · SYC-72 (camera hardening) · PR #9
**Owns:** where the **web build** keeps queued sightings and their photos; how a photo reaches the review screen on every build; the one-off move of sightings already queued on testers' phones.
**Supersedes:** [hosting-and-photo-storage.md](./hosting-and-photo-storage.md) §8 **for the web build only**. Native behaviour in §8 stands.
**Relates to:** [DECISIONS.md](./DECISIONS.md) · SYC-71 (web capture resolution, accepted) · [the PR #9 review](https://github.com/fairshake-au/syros-cat-spotter/pull/9#issuecomment-5862678118)
**Status:** Draft for Samuel's approval, 28 September 2026.

---

## 1. The short version

**The problem.** On the web version, which is what every tester uses, the app keeps queued sightings — photos included — in a small corner of browser storage that holds about 5 MB. One full-size phone photo fills it. When it is full the app does not say so: it shows the sighting as queued, keeps the photo on screen, and every save after that fails too. Sightings can be lost, or sent twice. The design assumed the web version was only a preview, which was true when it was written and is not true now.

Separately, the app hands each photo to the results screen by writing it into the page address. That is the likely cause of the Chrome crash two testers hit.

**The fix, in four parts.**

1. **Photos move to the browser's large storage** (called IndexedDB), which holds hundreds of megabytes rather than five. The list of queued sightings stays where it is, and becomes tiny.
2. **Sightings already queued on testers' phones are moved across by code the app already has.** It copies each photo to the new place first, and removes the old copy only once the new one is confirmed. If the phone dies half way, it carries on next time the app opens. Nothing is thrown away before it is safely stored.
3. **Saving becomes honest.** If a sighting cannot be saved, the app says so and keeps your photo on screen. It never again pretends.
4. **The results screen gets the photo from the phone's own store**, by a short name, never through the page address.

**What does not change.** The phone apps (which already work this way), the upload to the server, and what works without signal. Offline support stays partial: you can capture and queue sightings with no signal, but matching and everything else that needs the server waits for a connection.

**What we cannot promise.** Browsers are allowed to clear a website's storage — Chrome when a phone is nearly full, Safari on an iPhone if the site has not been opened for seven days. That is equally true today. We ask the browser to keep our data, and the app keeps showing how many sightings are waiting to send.

**What is already gone.** A sighting that only ever existed in memory under the old bug never reached storage, so it cannot be recovered.

---

## 2. What is wrong today

Every claim here was checked against the code on `origin/main` at `a577e70`.

- **The storage is tiny.** On web, AsyncStorage is `window.localStorage` (async-storage 2.2.0, `src/AsyncStorage.ts`). Chromium accepted at most **5,242,240 characters** before throwing `QuotaExceededError` (measured).
- **Photos live inside it.** `supportsPhotoFiles` is `Platform.OS !== 'web'` (`lib/pendingPhotos.ts:19`), so on web `savePendingPhoto` returns `null` and `enqueue` keeps the photo inline as base64 in the single queue record (`context/OfflineContext.tsx:251-271`). A 12 MP phone JPEG is roughly **4–6.7 million characters** as base64: one photo is at or over the cap.
- **Failures corrupt state silently.** `persist()` updates memory *before* writing (`OfflineContext.tsx:143-147`), and the offline branch of `submit()` awaits `enqueue` outside any `try` (`app/(tabs)/spot.tsx:331-343`). A failed write leaves a queued item that exists only in memory, leaves the photo on screen (a second tap duplicates it), and makes every later write fail. A sighting that syncs but cannot be re-saved as "review" uploads again after a reload.
- **Nobody is told.** `Alert.alert` is an empty function on react-native-web, so even the existing "queued offline" and error messages never appear.
- **The move-to-files step skips web.** `migratePhotosToFiles` returns early when `supportsPhotoFiles` is false (`OfflineContext.tsx:80`).
- **Photos travel through the route.** `submit()` and `reviewPending()` pass `photoUri` into `router.push` (`spot.tsx:364-375`, `389-401`), and expo-router carries params in the browser URL. Camera captures from before PR #9 carry the whole image there (SYC-76).
- **The design says web is a preview.** `lib/pendingPhotos.ts:13-14` and `hosting-and-photo-storage.md` §8 both describe inline base64 as a web-preview fallback. For the test round, web is the primary channel.

---

## 3. Design

### 3.1 A web photo store, behind the seam that already exists

`lib/pendingPhotos.ts` already abstracts photo storage: native writes files, web does nothing. This spec gives it a **web implementation backed by IndexedDB** and changes nothing about its callers' contract.

- **Database** `cat-spotter`, version 1, object store `photos`. Key: the photo id (the queue item's `localId`, or `review-<sightingId>`, see §3.4). Value: `{ type, bytes, savedAt }`, where `bytes` is an `ArrayBuffer`.
- **Why `ArrayBuffer` rather than `Blob` or base64.** Base64 is a third larger. Blobs in IndexedDB have a history of quirks in Safari and in-app browsers; an `ArrayBuffer` is a plain structured-clone type that every engine stores reliably, at the same size as a Blob.
- **Reference format** `idb:<id>`, stored in `photoUri` exactly where a native file path goes today.
- `supportsPhotoFiles` is renamed `supportsDurablePhotos` and becomes true on web when an IndexedDB database can actually be opened (probed once, cached). In-app browsers that block IndexedDB keep today's inline behaviour (§3.3 makes its failures honest).
- `savePendingPhoto` strips any data-URL prefix (`splitDataUrl`, already in `lib/cameraMode.ts`), decodes, and writes **in one transaction, resolving only on `complete`** — not on the request's `success`, which fires before the data is durable.
- `readPendingPhotoBase64`, `deletePendingPhoto` and `cleanupOrphanPhotos` get web implementations.
- New hook **`useStoredPhotoUri(ref)`**: returns `ref` unchanged on native, and on web creates an object URL from the stored bytes and **revokes it on unmount or when `ref` changes**. `SightingPhoto` and the review screen use it; nothing else creates object URLs from the store.
- `navigator.storage.persist()` is requested once, on the first save. The browser may say no; nothing relies on it.
- **No new dependency.** The raw IndexedDB API behind a small adapter interface, about a hundred lines. The lockfile is not touched.

IndexedDB was chosen over the Origin Private File System and the Cache Storage API because it has the widest support, including in the in-app browsers testers arrive through from email.

### 3.2 Moving sightings already queued on testers' phones

This reuses **`migratePhotosToFiles`, unchanged in shape**. It already runs on every app load and does nothing when no item carries an inline photo. Once §3.1 makes durable storage available on web, it starts working there.

**Order of operations, per load:**

1. For each item carrying inline base64, write the photo to the store and **wait for the transaction to commit**.
2. Replace that item in the new list with its `idb:` reference, and drop its inline copy **from the new list only**.
3. When every item has been attempted, write the new list to storage in one call.

**Why nothing can be lost.** The old list — the one with every inline photo — stays in storage untouched until step 3 replaces it, and step 3 only runs after every photo write has committed. An interruption at any earlier point leaves the old list exactly as it was, and the next load starts again. Photo writes are keyed by `localId`, so a re-run overwrites rather than duplicates.

**Partial failure.** An item whose photo write fails keeps its inline copy and carries on working exactly as it does today. It is retried on the next load.

**Legacy camera captures.** Items queued by the pre-PR-#9 camera carry a data URL in both `photoBase64` and `photoUri`. The prefix is stripped before storing, and `photoUri` becomes the reference, which **closes the route crash for old queued items** (review finding 10).

**Orphan clean-up is the only step that deletes anything, so it gets two guards on web.** The keep-set is the union of the list just re-read from storage, the in-memory list, and any live review reference; and **no photo saved in the last 24 hours is ever deleted**. Both guard against a second browser tab holding a newer queue than this one.

**Not recoverable:** a sighting that under the old bug only ever existed in memory never reached storage. There is nothing to move.

### 3.3 Honest saves

- **`persist(items)` writes first and updates memory second.** If the write throws, memory is left as it was and a `QueueWriteError` is thrown.
- **`enqueue`** saves the photo, then persists the list. If persisting fails, it deletes the photo it just saved (best effort) and re-throws. If the photo save itself fails **while IndexedDB is available** — a full device — it throws; it does **not** fall back to inline storage, which would only hit the 5 MB cap instead. Inline storage remains solely for browsers with no IndexedDB at all.
- **`submit()`'s offline branch** catches the failure, shows "Couldn't save this sighting on your phone" through the new notify helper, and **leaves the photo on screen**. There is no "queued" message and no `clearPhoto()`.
- **`syncNow`**, when an upload succeeds but saving the "review" state fails, keeps the review state in memory for this session and retries the save on the next change. If the page reloads before that retry, the item uploads again and a duplicate sighting is created. That now needs a write of a few kilobytes to fail rather than a multi-megabyte one. The proper fix is for the server to ignore a repeat of the same `localId`, which is an API change and is **ticketed, not in this PR**.

### 3.4 Photos never travel through the route

- **Online submit.** After `createSighting` succeeds, the photo is saved to the store as `review-<sightingId>`, and the route carries only `{ sightingId, isCatPhoto, candidates, photoRef }`. If that save fails, the route carries no `photoRef` and the review screen shows a placeholder. **The photo itself never goes in.**
- **Reviewing a queued item.** The route carries `{ …, localId, photoRef: item.photoUri }`, the stored reference.
- **Review screen.** It shows `useStoredPhotoUri(photoRef)` and drops its current fallback to inline base64. Because the photo is on the phone, it survives a reload or an Android tab being restored — something the current design cannot do.
- **Clean-up.** A `review-*` photo is deleted when its review is resolved; the orphan clean-up removes any older than seven days.
- **A guard that fails loudly.** Every review route is built by one function, `buildReviewParams()`, which throws if any value starts with `data:` or the total exceeds 16 KB. It has its own unit test and a mutation probe.
- **Consequence for the Spot screen.** The live camera's object URL is no longer read by any other screen, so it is revoked safely in `clearPhoto()` and whenever a new photo replaces it — which closes the leak the review found, without the trap it warned about.

### 3.5 The rest of the ratified scope — no design needed

These were decided on 27 September and are implementation only:

- A cross-platform **notify helper** replacing every `Alert.alert` (the pattern in `app/(tabs)/help.tsx:30`). The replace-photo menu, which needs three choices, becomes **buttons on the rejected sighting's card**, because a browser alert cannot offer choices.
- **Camera:** a known permission grant always wins over a failed lookup, and overlapping lookups are sequenced so a stale result is ignored (Bugbot). A failed or not-ready live capture falls back to the system camera. On web, once "Show live view" is declined the session stays on the system camera and the pill is hidden. `data:,` is rejected. The native "permanently denied" panel uses `cameraDeniedHint`.
- **Copy:** the pill reads **"Show live view"** in all three languages; French camera copy uses **"tu"** throughout; when the camera has failed, only the centre message shows.
- **Text:** correct the comments, test comments, PR body and SYC-76 that overstate the crash mechanism and the quota fix.

---

## 4. What does not change

- **The phone apps.** Native builds already store photos as files. Only §3.4, the route change, applies to them.
- **The server.** The upload contract, validation, EXIF stripping and matching are untouched.
- **The offline boundary.** Capture and queueing work without signal; matching, the catalogue beyond what is cached, the leaderboard and notifications wait for a connection.
- **The 30-day stale rule** in `offlineQueue.ts`.

---

## 5. Risks, with a recommendation on each

| | Risk | What a tester would see | Recommendation |
|---|---|---|---|
| **R1** | The browser clears the site's storage: Chrome when the phone is nearly full, Safari after seven days without the site being opened | Queued sightings disappear | **Accept for the test round.** It is equally true today. Ask for persistent storage, keep the "waiting to send" count visible, and tell testers to open the app once they have signal |
| **R2** | An upload succeeds but saving its "review" state fails, then the page reloads | One sighting appears twice | **Accept, and ticket server-side dedupe by `localId`.** Now needs a tiny write to fail |
| **R3** | An in-app browser blocks IndexedDB | Offline saving holds about one photo, and says so when it cannot | **Accept.** The failure message suggests opening the link in Chrome |
| **R4** | Review photos stay on the phone for up to seven days | Nothing — on-device only, never uploaded twice | **Accept** |

---

## 6. Verification

- **Unit tests against an in-repo fake** of the store adapter — no new dependency:
  - migration: an inline item becomes a reference; a legacy data-URL item is normalised; a second run changes nothing; a failure on item 2 leaves item 2 inline and item 1 moved, with nothing lost;
  - honest saves: a failed write leaves memory unchanged, `enqueue` throws, and the orphaned photo is removed;
  - the route guard.
- **Mutation probes** — each must turn a named test red and then be restored:
  - drop the inline copy *before* the photo write commits;
  - remove the route guard;
  - move `persist()`'s memory update back before the write.
- **Real browser.** Playwright Chromium against the web export: seed a legacy queue in `localStorage`, load, and confirm the photos are in IndexedDB and the list is stripped; reload and confirm they are still there; take an offline sighting, reload, and confirm the review screen shows the photo.
- **A real Android phone.** Jacky or Susan retests "check for matches" and one offline sighting. The crash mechanism is inferred, not observed, and only a real handset settles it.

---

## 7. Delivery

Eight commits on PR #9, in order, each one green and committed before the next:

1. Web photo store and adapter, not yet switched on.
2. Switch it on — the migration starts running on web.
3. Honest saves.
4. Photos off the route, plus the guard, the review screen, and revoking object URLs.
5. Notify helper, and buttons for replacing a photo.
6. Camera fixes.
7. Copy.
8. Documents: correct the overclaims, point `hosting-and-photo-storage.md` §8 here, and add a `DECISIONS.md` entry.

Then an adversarial review in its own worktree, the Android retest, merge, and republish from `main`. **About two working days to a reviewed PR.**

## 8. Model delegation

| Work | Model | Why | Assurance |
|---|---|---|---|
| Photo store, migration, honest saves, route change (commits 1–4) | Opus | Data-loss risk and subtle ordering; this is where a mistake loses a tester's sightings | Unit tests, all three mutation probes, the real-browser probe |
| Notify helper, replace-photo buttons, camera fixes (5–6) | Sonnet | Clear spec, contained changes | Tests, typecheck, diff review by the session model |
| Copy in three languages, doc corrections (7–8) | Haiku | Mechanical, fully specified | i18n parity test, diff review |
| Adversarial review of the finished PR | Opus | The critic must be at least the tier that wrote commits 1–4 | Separate worktree, told to refute |
| Real-browser probe | Sonnet | Scripted, observable | Numbers re-run by the session model before being reported |

## 9. On approval

- `hosting-and-photo-storage.md` §8 gains one line: *superseded for the web build by `offline-queue-on-web.md`*.
- The "web is a dev-preview surface only" comment in `lib/pendingPhotos.ts` is removed.
- `DECISIONS.md` records the approval and the answers to R1–R4.
