# Adversarial review — `docs/specs/offline-queue-on-web.md`

**Reviewed:** 28 September 2026 · against commit `09de47f` (branch `worktree-camera-fallback-hardening`)
**Method:** every factual claim checked against the code at `09de47f`, and at `a577e70` where §2 cites it. Library sources read: async-storage 2.2.0, netinfo 11.4.1, expo-camera 17.0.10, expo-image-picker 17.0.9, expo-image-manipulator 14.0.8. Three failure sequences (F1, F2, F3) reproduced as vitest probes built from `context/__tests__/OfflineContext.photoFiles.test.tsx`, with `@/lib/pendingPhotos` replaced by a keyed store that behaves as §3.1 and §3.3 specify. IndexedDB behaviour (default durability hint, a 5 MiB `ArrayBuffer` round trip, `navigator.storage.persist()`) measured in Playwright headless Chromium 149.
**Verdict in one line:** the direction is right, but §3.2's central promise that "nothing can be lost" is false as designed — the reused load path turns any error during the move into a lost queue, saves can race the load, and rewriting the whole list loses work during syncs and across tabs. One serialised write path, a load gate, per-item error handling and a backup taken before the move fix all of it, and must land in the commit that switches the move on.

Findings are ordered most severe first. **CONFIRMED** means verified against code or reproduced. **PLAUSIBLE** means not fully verified. Findings F7, F10, F12 and the ordering behind F5 were independently re-checked by the session model at `ReviewReadyBanner.tsx:32-43`, `netinfo/src/internal/nativeModule.web.ts:111`, `matching.ts:12,65` / `sightings.ts:107`, and `sightings.ts:48` vs `:101`.

---

## F1 — CRITICAL · CONFIRMED · One failed photo write during the move hides the whole queue, and the next sighting saved erases it

**What is wrong.** §3.2 says an item whose photo write fails "keeps its inline copy", and reuses `migratePhotosToFiles` "unchanged in shape". That per-item behaviour exists today only because the native `savePendingPhoto` catches every error and returns `null` (`lib/pendingPhotos.ts:43-61`). §3.3 requires the web save to *throw* when IndexedDB is available but the write fails — the two sections need opposite behaviour from one function. `migratePhotosToFiles` has no `try` around the save (`context/OfflineContext.tsx:88-92`), so the throw reaches the load effect's catch-all, `// corrupted queue — drop it` (`:137-139`). `setPending` never runs: memory stays `[]` while storage still holds every item. The Spot screen shows nothing queued, `syncNow` finds nothing (`:151-152`), and the next `enqueue` writes `[...[], new]` (`:268`) over the stored list — every old item, and the only copy of its photo, is gone.

**The trigger already exists.** On `main`, web live captures pass through unchanged, and a 0×0 canvas's `toDataURL()` returns `"data:,"`. §3.5 rejects `data:,` only for new captures, so one may already sit in a tester's queue. `splitDataUrl("data:,")` returns it unchanged and `atob` throws `InvalidCharacterError`. `QuotaExceededError` on a nearly full phone, `InvalidStateError`/`UnknownError` from a lost connection, and the availability probe rejecting all take the same path.

**Sequence (reproduced).** Stored queue `[A: valid data URL, B: "data:,"]` → load writes A, B throws → `pending` is `[]`, storage still `[A, B]` → tester queues C offline → storage is `[C]`. A and B are unrecoverable.

**Fix.** (1) `savePendingPhoto` returns `{ ok: true, ref } | { ok: false, reason: 'unavailable' | 'failed' }`; `enqueue` throws on `failed`, the move catches per item and leaves that item inline. (2) A failure after parsing still puts the parsed, unmoved list into memory; a parse failure copies the raw string somewhere safe and leaves the queue read-only, so saves fail honestly rather than empty it. (3) Before the first move touches anything, write the raw old list into IndexedDB as a backup kept 30 days; if that write fails, skip the move this load. (4) Tests for this exact sequence plus a mutation probe removing the per-item catch. (5) All of it lands in the switch-on commit.

## F2 — HIGH · CONFIRMED · A save made while the move is running overwrites the old list

**What is wrong.** The load effect (`OfflineContext.tsx:117-141`) and every writer share `pendingRef`, which is `[]` until the load finishes (`:114`), and nothing makes a writer wait. Today the gap is one microtask on web. The spec makes it as long as opening the database and committing every photo; throughout, any `persist` writes a list built from `[]`.

**Sequence (reproduced).** Storage `[A (inline)]`, load writing A's photo → tester queues C → `persist([C])`, storage `[C]` (A gone from storage) → A's write commits → `setPending([A'])`, `setItem([A'])` — C gone from storage and memory, its photo orphaned and swept after 24 hours. Had A's write failed, storage keeps `[C]` and A is lost outright. The window opens once per tester, on the first load after release — exactly for the testers who have something to lose.

**Smaller symptom, same cause.** NetInfo replays its state on subscribe (`netinfo src/internal/state.ts:110-120`), calling `syncNow()` (`:245`) before the move finishes; it returns on the empty list, so a moved queue often won't send until "Sync now" is tapped.

**Fix.** A `ready` promise resolved at the end of the load; every writer and `syncNow` await it (the load is the first job on F3's write chain); `syncNow()` after the load if online; the Spot screen says "loading saved sightings" while not ready. Test with the move's write held open.

## F3 — HIGH · CONFIRMED · `syncNow` writes back its own stale copy of the list, undoing anything done during a sync

**What is wrong.** `syncNow` copies the list once (`:157`) and every later write saves that copy (`:170, 200, 212, 220`), reverting any concurrent change. **This is pre-existing on `main`, on every platform.**

**Sequences.** *Resolving a review during a sync (reproduced):* A uploads and becomes "Needs review"; while B is still uploading (several MB plus the AI match), the tester resolves A — `remove` drops it and deletes its photo; B finishes and the stale copy is saved: A is back, pointing at a deleted photo; resolving again gets `409` (swallowed by `review.tsx:115-117`); review cards have no discard button — the item stays for good. *Discarding during a sync:* the discarded item returns (and today on web is uploaded anyway). *Replacing a photo during a sync:* reverted to rejected after its bytes were overwritten. *Queueing during a sync:* X is dropped and its photo swept 24 hours later.

**Fix.** One primitive, `mutate(fn)`, on a single promise chain: read the latest saved list (on web, re-read from storage — F4), apply `fn`, write, then update memory. `syncNow` updates only the item it finished, via `mutate(list => list.map(…))`, skipping items no longer present. `enqueue`, `remove`, `retry`, `replacePhoto` all go through it. Tests for the reproduced sequence plus a mutation probe making `syncNow` save its snapshot again.

## F4 — HIGH · PLAUSIBLE · Two open tabs overwrite each other's lists

**What is wrong.** §3.2's guards protect only the sweep. Each tab keeps its own list and every save rewrites the whole stored list from it (`:143-147`, plus `syncNow`'s copy); both tabs subscribe to NetInfo (`:237-249`) and sync the same items.

**Sequence.** Tabs 1 and 2 load `[A]` → tab 2, offline, queues X (storage `[A, X]`) → tab 1 resumes from freeze, uploads A, saves `[A: review]` — X gone → tab 2 also uploads A (duplicate) → X survives only as an unreferenced photo, or tab 2 restores X but puts A back to queued (third upload). Plausible because a tester can open the app in Chrome, from the email (Gmail Custom Tabs share Chrome's storage), and from a home-screen shortcut; Chrome freezes rather than reloads background pages.

**Fix.** Inside `mutate`, re-read from storage and wrap read-change-write in `navigator.locks.request('cat-spotter-queue', …)` (Chrome 69+, Safari 15.4+, Firefox 96+; fall back to the in-tab chain). Give `syncNow` a second lock with `ifAvailable: true` so one tab uploads at a time. Refresh memory on the `storage` event. Add a two-page Playwright probe.

## F5 — MEDIUM · CONFIRMED · Duplicate uploads don't need a failed write; the page dying during an upload is enough

**What is wrong.** An item stays "queued" in storage until the response arrives (`OfflineContext.tsx:179-200`). The server stores the photo and sighting (`sightings.ts:46-63`) before running the AI match (`:65-117`), which takes seconds. If the page dies in that window, the next sync sends it again — no write has to fail.

**Sequence.** A uploading and being matched → tester opens the system camera for another cat (the fallback §3.5 sends more testers to) → on a low-memory Android phone the backgrounded browser is killed → the tab reloads, A is still queued, and uploads again: two sightings, double points.

**Fix.** Re-rate R2 as likely and bring dedupe into this PR. No schema change is needed: the client already sends capture time, stored as `created_at` (millisecond precision). Before inserting, look up this device's sighting with the same `created_at` and return it (re-running the match). Request and response shapes are unchanged. A `client_ref` column is cleaner but is a schema change that would have to precede the Play clock. Gap: capture times clamped by `clampCaptureTime` are not stable.

## F6 — MEDIUM · CONFIRMED · §3.3 contradicts itself on a failed save after an upload

**What is wrong.** §3.3 says `persist` leaves memory unchanged on a failed write, and that `syncNow` keeps the review state in memory — nothing connects them, and §6's mutation probe locks in the first. Built so, `await persist(items)` (`:200`) throws right after a successful upload: the loop ends, `syncedAny` stays false (`:231-233`), the un-awaited NetInfo call (`:245`) becomes an unhandled rejection, and memory still says "queued", so the next sync uploads again in the same session. The write can still fail after the move in browsers without IndexedDB (R3), where adding candidates can tip a near-cap list over.

**Fix.** The post-upload update is a `mutate` that always applies to memory and marks the queue "unsaved" if the write fails, retried on the next `mutate`. Wrap each item in `syncNow` in its own `try`. Unit test: the write fails after a successful upload and a second `syncNow` does not call `createSighting`.

## F7 — MEDIUM · CONFIRMED · The route change misses the review banner, and has no answer for photos still stored inline

**What is wrong.** `components/ReviewReadyBanner.tsx:32-43` is a third review-route builder, pushing `photoUri: first.photoUri`. Items still inline (every item in an R3 browser, every item whose move failed) have a `photoUri` that is either a dead-after-reload `blob:` URL or, for pre-PR-#9 camera captures, the entire photo as a data URL. §3.4's `photoRef: item.photoUri` then trips the guard (the item can never be opened); a banner not rebuilt through the guard reproduces the SYC-76 crash for exactly the testers whose move failed; and dropping the review screen's inline fallback (`review.tsx:425-431`) shows a placeholder though the bytes are in memory.

**Fix.** Queued items carry only `localId`; the review screen finds the photo through the queue (`idb:` ref → hook, inline → object URL from `photoBase64`). Online submissions carry `photoRef: review-<id>`. The banner goes through `buildReviewParams()`. A test fails if any `router.push` to `/review` bypasses the builder.

## F8 — MEDIUM · PLAUSIBLE · "Wait for `complete`" is not "safely stored", and the move deletes the only other copy on that basis

**What is wrong.** `complete` means committed, not flushed; the durability hint defaults to `"default"` (measured in Chromium 149), which browsers may treat as relaxed. The move then rewrites localStorage, also batched to disk; a power loss can keep the stripped list and lose the photo. "Confirmed" never includes a read-back. Also: `supportsPhotoFiles` is a synchronous constant but the probe is asynchronous (a constant starting `false` skips the first move); a probe that only opens a database passes where writes fail; an Android WebView with DOM storage disabled has IndexedDB but a null `localStorage`, so every save writes the photo, fails on the list and deletes the photo ("holds none", not "about one"); `navigator.storage.persist()` returned `false` for a fresh origin (measured) and Firefox would prompt mid-save; and if Chrome's eviction clears IndexedDB but not localStorage, items would be mislabelled "too old to send" (`OfflineContext.tsx:163-171`).

**Fix.** Write moved photos and the F1 backup with `{ durability: 'strict' }`. Read each photo back and compare length before stripping; where strict is unsupported, strip on the next load after a second read-back. Make availability `durablePhotos(): Promise<boolean>` — open, write, read, delete — and check localStorage too. Give an `idb:` item whose photo is missing its own status and wording ("the browser cleared this photo"). Ask for persistence once, from a tap on the queue screen, never during a save.

## F9 — LOW–MEDIUM · CONFIRMED · Queued web uploads lose the mobile-data shrink step

**What is wrong.** On mobile data `syncNow` passes `item.photoUri` to `optimizePhotoForUpload` (`OfflineContext.tsx:175-178`). On web the manipulator loads it into an `<img>` and rejects on error (`expo-image-manipulator/src/web/utils.web.ts:23-36`); `optimizePhotoForUpload` returns `null` (`lib/photoUpload.ts:56-60`) and the full photo is sent. An `idb:` reference always fails this way, and Chrome on Android reports `cellular`, so this is the normal case on the island.

**Fix.** In `syncNow`, turn an `idb:` reference into an object URL from the stored bytes, pass that, then revoke it. Test that a constrained-network `idb:` item gives the manipulator a `blob:` URL.

## F10 — LOW–MEDIUM · PLAUSIBLE · On web, "queue with no signal" only happens when the browser reports offline

**What is wrong.** `submit()` queues only when `isOnline` is false (`spot.tsx:331`); on web `isConnected` is `navigator.onLine` (`netinfo/src/internal/nativeModule.web.ts:111`), true on one bar of signal. `createSighting` then fails, an error shows (`spot.tsx:376-382`), and nothing is queued. The project rules require precision about offline support.

**Fix.** At minimum, word it exactly: "queues when the phone reports no connection". Better: on a network failure (`classifySyncFailure` → `network`, `lib/offlineQueue.ts:78-79`) offer "Save and send later" and queue it; F5's dedupe covers the case where the request already reached the server.

## F11 — LOW · CONFIRMED · Honest saves stop at `enqueue`

`replacePhoto` (`OfflineContext.tsx:292-323`) calls the same save and would throw into `replaceRejectedPhoto` (`spot.tsx:296-307`), which has no `catch`. It also saves under the *same* key as the photo it replaces, so applying `enqueue`'s delete-on-failure rule would delete the original, and the `idb:<localId>` reference is identical before and after (the delete at `:317` is skipped; a hook keyed on the ref keeps showing the rejected photo) — save replacements under a new key and delete the old one after the list write. The offline branch has no busy guard (`setSubmitting` is set only on the online path, `spot.tsx:344`), and a slower IndexedDB save makes a double-tap duplicate likelier. §3.3 also changes shared `OfflineContext` code, so it does reach native, where write-first `persist` opens a lost-update window; F3's single write chain closes it.

## F12 — LOW · CONFIRMED · Review-photo retention is specified twice, differently; the size guard throws after the sighting exists

§3.2's sweep (keep-set or last 24 hours) and §3.4 (seven days) disagree, and on native the existing sweep (`lib/pendingPhotos.ts:85-103`) deletes every file not in the queue at next launch, so `review-*` files never last seven days there — say which rule applies where. `buildReviewParams()` runs after `createSighting`, so a throw leaves an unreviewable sighting. Candidates are at most three (`sightings.ts:107`) with `photoUrl` of `/api/photos/<id>`, but `reasoning` is unbounded model text (`matching.ts:65`): trim it in the builder and reject only `data:` or photo-sized values, not total size.

## F13 — LOW · CONFIRMED · §2's evidence line and line numbers disagree

§2 says claims were checked at `a577e70`, but its `spot.tsx` references (`331-343`, `364-375`, `389-401`) are this branch's; at `a577e70` they are 267–279, 301 and 326. Cite `09de47f`, and add `ReviewReadyBanner.tsx:32-43`.

---

## A — simpler ways to the same safety

**One write path under a lock (recommended).** F2, F3, F4 and §3.3's ordering all come from several writers rewriting one list from their own memory. A single `mutate()` that re-reads storage under a Web Lock, writes, then updates memory fixes all four in a few dozen lines with no dependency. **Queue records in IndexedDB on web** — one record per item, one transaction per edit — is stronger but gives web a second list store alongside native's AsyncStorage; not needed if the first lands. **Back up before moving** (F1 fix 3) is the cheapest insurance for a one-off migration on phones you cannot reach. "Web online-only" was rejected by the product owner and not revisited.

## S — sound

- **`ArrayBuffer` storage.** A 5 MiB buffer round-tripped intact in Chromium; plain bytes avoid WebKit's Blob-storage failures.
- **Keying by `localId`.** Re-runs overwrite rather than duplicate; `review-<sightingId>` cannot collide with `<timestamp>-<random>`.
- **§2's diagnosis**, apart from F7 and F13.
- **The sweep on its own.** Given a correct list, keep-set plus the 24-hour rule deletes nothing referenced — provided `savedAt` is checked in the same read-write transaction as the delete. The losses found come from the list being overwritten (F1–F4), not the sweep.
- **Native effects of §3.4.** Only `SightingPhoto`, the review screen, the banner (F7) and `optimizePhotoForUpload` (F9) use `photoUri`/`photoBase64`; on native, saving `review-<id>` is a file copy and the hook passes the path through.
- **The 16 KB guard in practice** — real candidate lists are well under 2 KB; only `reasoning` could approach it.
- **Private browsing** — where IndexedDB is allowed it lasts as long as localStorage; where it isn't, the fallback is today's behaviour.
- **`retry → syncNow` and `replacePhoto → syncNow`** survive write-first `persist` on web (async-storage's web `setItem` settles in the same microtask checkpoint); native is covered in F11.
- **Revoking the live camera's object URL in `clearPhoto()`** is safe once the route stops carrying it — provided `SightingPhoto` keeps its base64 fallback for inline (R3) items.
