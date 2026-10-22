# Offline queue on the web build — spec

**Tickets:** SYC-76 (crash at "check for matches") · SYC-72 (camera hardening) · PR #9
**Owns:** how queued sightings are saved on every build; where the **web build** keeps their photos; how a photo reaches the review screen; the one-off move of sightings already queued on testers' phones; duplicate-upload protection on `POST /api/sightings`.
**Supersedes:** [hosting-and-photo-storage.md](./hosting-and-photo-storage.md) §8 **for the web build only**. Native storage in §8 stands.
**Relates to:** [DECISIONS.md](./DECISIONS.md) · SYC-71 (web capture resolution, accepted) · [PR #9 review](https://github.com/fairshake-au/syros-cat-spotter/pull/9#issuecomment-5862678118)
**Status:** **Approved by Samuel, 28 September 2026** (v2), with R1, R3 and R4 accepted and R2 and R5 approved for this PR — recorded in `DECISIONS.md` Part 2f. v1 was broken by [the adversarial review](./reviews/offline-queue-on-web-review.md): its central promise, that nothing could be lost, was false as designed. v2 is rebuilt around the review's findings.

---

## 1. The short version

**The problem.** On the web version, which is what every tester uses, queued sightings and their photos are kept in a corner of browser storage that holds about 5 MB. One full-size phone photo fills it. When it is full, the app does not say so: it shows the sighting as queued, keeps the photo on screen, and every save after that fails too. Sightings can be lost, or sent twice.

Underneath that is a problem on **every** version, the phone apps included. Several parts of the app save the queue independently, each from its own copy of the list, so they overwrite one another. If you finish reviewing a sighting while another is still uploading, the finished one comes back. If you discard one during an upload, it comes back.

Separately, the app hands each photo to the results screen by writing it into the page address — in three places, not the two PR #9 fixed. That is the likely cause of the Chrome crash.

**The fix.**

1. **One orderly way to save.** Every change to the queue goes through a single path, one change at a time, starting from the latest saved list rather than a stale copy. On the web it also stops two open tabs overwriting each other. This alone fixes the "sightings come back" bugs, on every version.
2. **Photos move to the browser's large storage** (IndexedDB), which holds hundreds of megabytes. The list itself stays where it is and becomes tiny.
3. **Before anything moves, the app keeps a complete backup** of every tester's queued sightings, photos included, for 30 days. Then it moves each photo, reads it back to check it arrived intact, and only then removes the old copy. A photo that fails to move stays exactly where it was. If the backup itself cannot be written, nothing moves.
4. **Saving becomes honest.** If a sighting cannot be saved, the app says so and keeps your photo on screen.
5. **The results screen gets the photo from the phone's own store,** by a short name — never through the page address, in any of the three places.
6. **The server ignores a sighting it has already received.** Today, if the browser is closed mid-upload, the same sighting is sent again on reopening. That is likely, not rare: opening the phone's camera on a low-memory Android phone can close the browser behind it.

**What does not change.** The server's upload and matching, the phone apps' photo storage, and what works without signal.

**Be precise about offline.** On the web, the app queues a sighting only when the phone reports it has *no* connection. With one bar of signal it tries to send, fails, and today shows an error without saving. §5 R5 asks whether to add "Save and send later" for that case.

**What we cannot promise.** Browsers may clear a website's storage — Chrome when a phone is nearly full, Safari on an iPhone if the site has not been opened for seven days. If a browser clears a photo but keeps the list, the app now says so plainly instead of calling the sighting "too old". A sighting that under the old bug only ever existed in memory never reached storage and cannot be recovered.

---

## 2. What is wrong today

Checked against the code at `09de47f` (this branch, which carries `main` at `a577e70` plus PR #9).

- **The web storage is tiny.** AsyncStorage on web is `window.localStorage` (async-storage 2.2.0, `src/AsyncStorage.ts`); Chromium accepted at most **5,242,240 characters** (measured). `supportsPhotoFiles` is `Platform.OS !== 'web'` (`lib/pendingPhotos.ts:19`), so on web every photo sits inline as base64 in the one queue record (`context/OfflineContext.tsx:251-271`). A 12 MP JPEG is about 4–6.7 million characters: one photo is at or over the cap.
- **Several writers, each with its own copy.** `persist()` rewrites the whole list from whatever it was given and updates memory first (`OfflineContext.tsx:143-147`). `syncNow` copies the list once (`:157`) and saves that copy after every item (`:170, 200, 212, 220`), reverting anything done meanwhile. Writers read `pendingRef`, which is `[]` until the load finishes (`:114`). Every open tab does the same. **This is on every platform, today.**
- **The load drops the queue on any error.** Its catch is `// corrupted queue — drop it` (`:137-139`); memory stays empty while storage stays full, and the next save overwrites storage.
- **Failures are silent.** The offline branch of `submit()` awaits `enqueue` outside any `try` (`app/(tabs)/spot.tsx:331-343`), and `Alert.alert` is an empty function on react-native-web.
- **Photos travel through the route, in three places:** `submit()` (`spot.tsx:364-375`), `reviewPending()` (`:389-401`) and `ReviewReadyBanner` (`components/ReviewReadyBanner.tsx:32-43`). Items queued by the pre-PR-#9 camera carry the whole image there (SYC-76).
- **The server stores a sighting before matching it** (`artifacts/api-server/src/routes/sightings.ts:48` inserts, `:101` matches), and the client keeps the item "queued" until the response arrives. A page closed in that window re-uploads it.
- **"Offline" on web means `navigator.onLine`** (`netinfo/src/internal/nativeModule.web.ts:111`), true on a weak connection.
- **The design calls web a preview** (`lib/pendingPhotos.ts:13-14`; `hosting-and-photo-storage.md` §8). For the test round it is the primary channel.

---

## 3. Design

### 3.1 One write path — the foundation, on every platform

All queue changes go through one function, **`mutate(change)`**, which:

1. runs on a **single promise chain**, so changes happen one at a time in this tab;
2. on web, runs inside **`navigator.locks.request('cat-spotter-queue', …)`** so two tabs take turns (Chrome 69+, Safari 15.4+, Firefox 96+; elsewhere the in-tab chain alone);
3. **re-reads the latest saved list** from storage, applies `change` to it, writes it, and **only then** updates memory.

`enqueue`, `remove`, `retry`, `replacePhoto` and every step of `syncNow` go through it. Nothing else writes the queue.

- **A load gate.** Loading the queue is the first job on the chain and resolves a `ready` promise. Every writer and `syncNow` wait for it, and the app calls `syncNow()` itself once loading finishes if it is online. While not ready, the Spot screen says "Loading your saved sightings" instead of showing none.
- **Loading never empties the queue.** If anything fails after the list has been parsed, the parsed list still goes into memory. If the list cannot be parsed, the raw text is copied into the backup store (§3.3) and the queue becomes read-only for the session: saves fail with a clear message rather than overwriting it.
- **`syncNow` changes only the item it just finished,** via `mutate(list => list.map(…))`, and skips any item no longer in the list. Each item has its own `try`, so one failure does not stop the others.
- **After a successful upload, the new state always reaches memory.** If saving it fails, the queue is marked "unsaved" and the write is retried on the next change — so the sighting is never uploaded twice in one session.
- **On web, only one tab uploads at a time,** via a second lock taken with `ifAvailable: true`. Each tab refreshes its list on the `storage` event.
- **User-initiated changes fail honestly.** If `enqueue`, `remove` or `replacePhoto` cannot save, memory is left as it was and a `QueueWriteError` is thrown for the screen to report (§3.5).

This fixes the pre-existing lost-update bugs on the phone apps as well as the web, and it is the first commit, before any storage change.

### 3.2 A web photo store, behind the seam that already exists

`lib/pendingPhotos.ts` already abstracts photo storage: native writes files, web does nothing. It gets a web implementation over IndexedDB.

- **Database** `cat-spotter`, version 1. Store `photos`, keyed by photo id, value `{ type, bytes: ArrayBuffer, savedAt }`. Store `backups` (§3.3).
- **Why `ArrayBuffer`.** Base64 is a third larger, and stored Blobs have a history of failures in Safari and in-app browsers; an `ArrayBuffer` round-tripped intact at 5 MiB in Chromium (measured).
- **Reference format** `idb:<id>`, kept in `photoUri` exactly where a native file path goes today.
- **Save reports why it failed.** `savePendingPhoto` returns `{ ok: true, ref }` or `{ ok: false, reason: 'unavailable' | 'failed' }` on every platform. Callers decide what a failure means.
- **Durable, then verified.** Writes use `{ durability: 'strict' }` and resolve on the transaction's `complete`, then the photo is **read back and its length checked**. Only a verified write counts as saved.
- **Availability is tested, not assumed.** `durablePhotos(): Promise<boolean>` opens the database, writes, reads and deletes a probe record, and also checks that `localStorage` works. A browser that fails either keeps today's inline behaviour (R3).
- **Replacements get a new key** (`<localId>-r<n>`), and the old photo is deleted only after the list has been saved, so a failed replace never loses the original.
- **Photos for review** are stored as `review-<sightingId>` (§3.4).
- **Display.** A hook, `useStoredPhotoUri(ref)`, returns native file paths unchanged and on web creates an object URL from the stored bytes, revoking it on unmount or when the reference changes. `SightingPhoto` and the review screen use it; `SightingPhoto` keeps its base64 fallback for inline items.
- **Upload.** On mobile data `syncNow` shrinks photos first. For an `idb:` item it makes an object URL from the stored bytes, passes that to `optimizePhotoForUpload`, and revokes it afterwards — otherwise the shrink silently fails and the full photo is sent.
- **A photo the browser has cleared** gets its own status and wording — "Your phone deleted this photo before it could be sent" (SYC-572) — never "too old to send".
- **Persistent storage** is requested once, from a tap on the queue screen, never in the middle of a save. Chrome refuses it for a new site (measured), so it helps only regular users; nothing relies on it.
- **No new dependency.** The raw IndexedDB API behind a small adapter. The lockfile is not touched.

### 3.3 Moving sightings already queued on testers' phones

Runs inside the load (§3.1), before `ready` resolves, and only when some item still has its photo inline.

1. **Backup first.** The raw saved list, exactly as stored, is written to the `backups` store with strict durability and kept for **30 days** (the queue's own stale limit). If the backup cannot be written, **nothing is moved on this load**; the queue stays as it is and works as it does today.
2. **Each photo in turn.** Strip any data-URL prefix, save, read back. A photo that cannot be decoded or saved — including a `data:,` left by the old camera — **stays inline** and is retried next load; it is never allowed to throw out of the move.
3. **Strip only what was verified,** through `mutate`: the change re-reads the latest list and swaps inline photos for references **only for the items verified in step 2**, so anything added meanwhile survives.
4. **Where strict durability is not supported,** a photo is stripped only on the *next* load, after a second read-back succeeds.

**Legacy camera captures** (a data URL in both fields) are normalised in step 2, and their `photoUri` becomes the reference — which closes the route crash for old queued items.

**Recovery.** Backups older than 30 days are deleted. Restoring from a backup is a developer action, not a screen: if a tester reports lost sightings, their backup can be read from the browser's storage.

### 3.4 Photos never travel through the route

- **Every review route is built by `buildReviewParams()`,** in all three places: `submit()`, `reviewPending()` and `ReviewReadyBanner`. A unit test fails if any `router.push` to `/review` bypasses it.
- **Queued items** carry only `localId`. The review screen finds the photo through the queue: an `idb:` reference through the hook, or, for an inline item, an object URL made from its base64.
- **Online submissions** save the photo as `review-<sightingId>` and carry `photoRef`. If that save fails, no `photoRef` is sent and the review screen shows a placeholder.
- **The builder never throws.** It runs after the sighting already exists, so a throw would leave a sighting that cannot be reviewed. Instead it trims each candidate's `reasoning` to 280 characters (model text, otherwise unbounded) and drops any value that is a data URL or photo-sized. Tests assert its output never contains `data:`; a mutation probe removes that check.
- **Retention.** On web, a `review-*` photo is deleted when its review is resolved, or after seven days. On native, the orphan sweep is changed to keep `review-*` files for seven days too. Queued photos follow the queue. The sweep checks `savedAt` in the same transaction as the delete, and never deletes anything saved in the last 24 hours.
- **Spot screen.** Nothing downstream reads the live camera's object URL any more, so it is revoked in `clearPhoto()` and when a new photo replaces it.

### 3.5 Honest saves, on screen

- **Offline submit.** A busy flag covers both the online and offline branches, so a double tap cannot queue twice. A `QueueWriteError` shows "Couldn't save this sighting on your phone" through the notify helper; the photo stays on screen and nothing says "queued".
- **Replacing a rejected photo** catches failures and reports them the same way.
- **Read-only queue** (a list that could not be parsed): "Your saved sightings couldn't be loaded, so new ones can't be saved offline right now." Sending online still works.

### 3.6 The server ignores a repeat of the same sighting

Before inserting, `POST /api/sightings` looks up **this device's sighting with the same capture time**. If one exists it returns that sighting, re-running the match, instead of creating a second. The client already sends the capture time, stored with millisecond precision. **No schema change; the request and response shapes are unchanged.** One known gap: capture times the server clamps (backdated items) are not stable, so those are not covered. A dedicated client reference column would close it but is a schema change, which `hosting-and-photo-storage.md` §5.1 requires before the Play clock starts. Subject to R2.

### 3.7 The rest of the ratified scope

Decided on 27 September; implementation only:

- **A notify helper** replaces every `Alert.alert`, following the pattern in `app/(tabs)/help.tsx:30`. The three-choice replace-photo menu becomes **buttons on the rejected sighting's card**, because a browser alert cannot offer choices.
- **Camera:** a known permission grant always wins over a failed lookup, and overlapping lookups are sequenced (Bugbot). A failed or not-ready live capture falls back to the system camera. On web, once "Show live view" is declined, the session stays on the system camera and the pill is hidden. `data:,` is rejected. The native "permanently denied" panel uses `cameraDeniedHint`.
- **Copy:** "Show live view" in all three languages; French camera copy uses "tu" throughout; when the camera fails, only the centre message shows.
- **Text:** correct the comments, test comments, PR body and SYC-76 that overstate the crash mechanism and the quota fix.

---

## 4. What does not change

- **The phone apps' photo storage.** Native keeps its files. The phone apps do get §3.1 (the single write path, which fixes their lost updates), §3.4 (no photos in the route) and §3.6 (server dedupe).
- **The server's upload contract,** validation, EXIF stripping and matching. §3.6 changes only whether a repeat creates a second row.
- **The offline boundary.** Capture and queueing work when the phone reports no connection; matching, the catalogue beyond what is cached, the leaderboard and notifications wait for a connection.
- **The 30-day stale rule** in `offlineQueue.ts`.

---

## 5. Decisions for Samuel — answered 28 September 2026

R1 accepted · **R2 approved, in this PR** · R3 accepted · R4 accepted · **R5 approved**.

| | Question | What a tester would see | Recommendation |
|---|---|---|---|
| **R1** | Accept that browsers may clear a site's storage (Chrome when nearly full, Safari after seven unused days)? | Queued sightings, or just their photos, disappear. Now reported honestly | **Accept for the test round.** Tell testers to open the app once they have signal |
| **R2** | Stop duplicate sightings on the server now (§3.6), rather than ticketing it? | Without it, a sighting can appear twice after the browser closes mid-upload — likely on low-memory Android | **Yes, in this PR.** Small, no schema change |
| **R3** | Accept that some in-app browsers can't save photos offline? | "Couldn't save — open this link in Chrome" | **Accept** |
| **R4** | Keep review photos on the phone for up to seven days? | Nothing visible; photos never leave the phone twice | **Accept** |
| **R5** | Add "Save and send later" when sending fails on a weak signal? | Today: an error and the sighting is not saved. With it: one tap queues it | **Yes.** It makes offline match what testers expect, and R2 covers a send that half-arrived |

---

## 6. Verification

**Unit tests**, against an in-repo fake of the store adapter (no new dependency). Each of the review's reproduced sequences becomes a test:

- a bad photo during the move leaves the queue intact and the next save loses nothing (F1);
- a save during the move survives (F2);
- resolving, discarding or queueing during a sync survives (F3);
- a failed write after a successful upload does not re-upload in the same session (F6);
- every `/review` push goes through the builder, and its output never contains `data:` (F7);
- a constrained-network `idb:` item is shrunk through a `blob:` URL (F9).

**Mutation probes**, each turning a named test red, then restored:

- remove the per-item catch in the move;
- remove the load gate;
- make `syncNow` save its snapshot again;
- strip an inline photo before its read-back;
- let a `/review` push bypass the builder.

**Real browser.** Playwright Chromium against the web export:

- seed a legacy queue in `localStorage`, load it, and confirm the backup exists, the photos are in IndexedDB and the list is stripped;
- reload and confirm they are still there;
- take an offline sighting, reload, and confirm the review screen shows its photo;
- open two pages on one origin and confirm neither overwrites the other.

**Server.** A route test: the same device posting the same capture time twice gets one sighting.

**A real Android phone.** Jacky or Susan retests "check for matches" and one offline sighting. The crash mechanism is inferred, not observed.

---

## 7. Delivery

Ten commits on PR #9, each green and committed before the next:

1. The single write path and load gate (§3.1), on every platform, with no storage change.
2. The web photo store (§3.2), not yet switched on.
3. The backup and the move (§3.3), which switches the store on.
4. Honest saves on screen (§3.5).
5. Photos off the route, in all three places (§3.4).
6. Server dedupe (§3.6), if R2 is approved.
7. The notify helper and replace-photo buttons.
8. Camera fixes.
9. Copy.
10. Documents: correct the overclaims, point §8 here, and record the decisions.

Then an adversarial review in its own worktree, the Android retest, merge, and republish from `main`. **About four working days to a reviewed PR** — twice the v1 estimate, because v1 skipped the part that makes it safe.

## 8. Model delegation

| Work | Model | Why | Assurance |
|---|---|---|---|
| Commits 1–5: write path, store, move, route | Opus | Data-loss risk, ordering and concurrency; where a mistake loses a tester's sightings | Every reproduced sequence as a test, all five mutation probes, the real-browser probe |
| Commit 6: server dedupe | Sonnet | Contained query change with a clear spec | Route test, diff review by the session model |
| Commits 7–8: notify helper, camera fixes | Sonnet | Clear spec, contained | Tests, typecheck, diff review |
| Commits 9–10: copy, documents | Haiku | Mechanical and fully specified | i18n parity test, diff review |
| Adversarial review of the finished PR | Opus | Must be at least the tier that wrote commits 1–5 | Separate worktree, told to refute |
| Real-browser probe | Sonnet | Scripted and observable | Results re-run by the session model before they are reported |

## 9. On approval

- `hosting-and-photo-storage.md` §8 gains one line: *superseded for the web build by `offline-queue-on-web.md`*.
- The "web is a dev-preview surface only" comment in `lib/pendingPhotos.ts` is removed.
- `DECISIONS.md` records the approval and the answers to R1–R5.
