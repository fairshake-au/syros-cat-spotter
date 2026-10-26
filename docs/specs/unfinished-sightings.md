# Finding a spot again when you leave before choosing

**Ticket:** SYC-186 (epic SYC-607). Found in the adversarial review of PR #52 (SYC-119 Slice A), 2 October 2026.
**Status:** **Decisions made by Samuel, 26 October 2026** (§11); awaiting final approval of this revision. The first draft recommended a server-side list (option C); Samuel chose **option A, the phone keeps every unfinished spot**, with **no expiry**. This revision is written to that choice. Adversarial reviews: [`reviews/unfinished-sightings-review.md`](./reviews/unfinished-sightings-review.md) (review 1 of the first draft; review 2 of this revision, §12).
**Owner:** Samuel
**Builds on:** [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.5 and §6 (whose "Your sighting is saved. Finish this when you're back online" this spec makes true for everyone) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) (the phone's own list and its single write path) · [`restore-with-a-code.md`](./restore-with-a-code.md) and `email-capture.md` §8 (keep-safe) · [`couldnt-load-try-again.md`](./couldnt-load-try-again.md) · SYC-153 (cancelled: sending a *choice* without signal; this spec is about finding the *spot* again) · SYC-196 / SYC-93 (the queue's retry rules).

File and line references were checked against `origin/main` at `caa4b1ab`; `origin/main` has since moved (#347, #361, #362), so line numbers may be slightly out.

---

## 1. The short version

Every spot a spotter sends is kept on their phone until they finish it or remove it. **Any spot that has been sent but not yet matched to a cat appears in the same "Spots on your phone" list on the Spot tab, whether it was sent the moment they took it or saved and sent later.** Tap it and "Have we met?" opens again, with the suggestions the app found when it was sent.

It works like this: the moment a photo is sent with signal, the phone also keeps its own copy in the list it already has for saved spots, marked "Check if we know this cat". From then on the two kinds of spot are the same thing. The server needs one line.

A spot stays in the list **until the spotter finishes it or removes it**. It never expires on its own.

The honest limit of this choice, said once here and again where it matters: **the list lives on the phone.** If the spotter moves to a new phone with "Get your spots back", or the browser clears its data, spots they hadn't finished are not there. Spots they finished are safe on the server as always.

---

## 2. The problem, as a spotter meets it

Reproduced on `origin/main` at 390 px in the website against a local server, 26 October 2026 (screenshots in [`docs/screenshots/syc-186/`](../screenshots/syc-186/)):

1. The spotter takes a photo and presses **Check for matches**. With signal, the photo is sent at once and the app opens "Have we met?" (`app/(tabs)/spot.tsx:1013-1042`).
2. They press the **X**, or Back, or the app closes, or the signal drops and they give up.
3. The Spot tab shows the camera and nothing else (`390-02-spot-after-leaving-nothing-listed.jpg`). The photo is on Syros Cats' server, saved as an unfinished sighting (checked in the database: one row, status `pending`). Nothing in the app lists it. No points were earned, and the cat may never be recorded.

The same spot, had it been saved on the phone first (no signal at the time, or "Save and send later"), would show under **"Spots on your phone"** with the badge "Check if we know this cat" and a tap to finish it. The two paths treat the same spotter differently, only because of how good their signal was at that moment. (The saved-on-phone path was read from the code, `spot.tsx:1150-1200`, not screenshotted.)

Three things make this worse than it sounds:

- **The promise is only half true.** `choose-a-different-cat.md` §4.5 and §6 tell the spotter "Your sighting is saved. Finish this when you're back online." PR #52 made the app say that only for phone-saved spots. A spot sent straight away gets "No signal. Keep this screen open and try again when you're back online" (`pickerNoSignalStay`, `lib/catPicker.ts:83`), which asks the spotter to stand still holding a phone with no signal.
- **It's the best-signal spotters who lose out.** A tourist at a café with Wi-Fi sends a photo, gets a phone call, and loses it.
- **"Take another photo" must leave nothing behind.** From "No cat found", `retake` removes the phone's copy (`review.tsx:503-512`). With this spec there is a copy to remove, and it is removed.

---

## 3. What the spotter experiences

### 3.1 Sending a photo

With signal, nothing looks different: the photo is sent and "Have we met?" opens. Behind the scenes the phone has already saved the spot in its list (§7). If saving it on the phone fails (storage full or unreadable), the spot still opens "Have we met?" as today, and the old line, "No signal. Keep this screen open and try again when you're back online," is used for that one spot only, because it is then the only honest thing to say.

### 3.2 Leaving without choosing

Back, X and closing the app all work as they do now. The spot is in the list.

- **Pressing the X or Back** shows a short line at the bottom of the Spot tab: **"Saved. Find it under Spots on your phone."** (§9). It shows once per spot, and only when the spot is actually kept: not after "No cat found" (§5) or a discard.
- **Closing the app, or losing signal and giving up,** shows nothing at the time (the app can't), but the spot is waiting in the list the next time the Spot tab opens.

### 3.3 The list

The existing "Spots on your phone" section on the Spot tab, unchanged in look:

> **Spots on your phone**
>
> `[photo]`  Check if we know this cat · Taken today, 14:32  `›`
> `[photo]`  Queued · Waiting to send

- A spot that has been sent shows the badge **"Check if we know this cat"** and opens "Have we met?" when tapped. A spot not yet sent keeps today's badges (**Queued**, failed, rejected). The same spot never shows twice.
- Tap and "Have we met?" opens with the suggestions found when the spot was sent. **Opening a spot never runs a new photo check.** Two limits, said plainly: (a) the suggestions are a snapshot, so a cat added or named after the spot was sent won't be among them ("Find the cat yourself" always uses today's cat-alogue); (b) a spot whose check **failed** opens the same "We couldn't check this photo right now" screen, with **Check again**, exactly as a spot saved on the phone does today.
- **Every card can be removed.** A card for a spot that has been sent has no Discard button today (only a chevron, `spot.tsx:1404`); it gets the same **Discard** as a queued spot, with the existing question. Without it, a spot the server will never accept would sit in the list for ever.
- **A spot that can't be finished** is a real case now that nothing expires: the spotter pressed "Start again" and the server says "not your sighting" (403), the sighting is gone (404), or a suggested cat has since been removed (422). In each, the review screen says **"This one can't be finished any more"** and offers **Discard**, instead of a generic error (§9).
- The card's date is the existing one: `createdAt` in the phone's own date format, which is the capture time as the phone recorded it, as for queued spots.
- A sent, unfinished spot never expires, which is Samuel's choice (§11). The cost is that a card can go stale: its suggestions are a snapshot, and a cat in them may have been merged or removed. The spotter can always open it, use "Find the cat yourself", or discard it. (The 30-day rule for spots *waiting to send* is unchanged: it protects a spot that can no longer be sent.)
- The "Is this {name}?" prompt a spotter gets after starting a spot from a cat's page (SYC-574) is kept for a spot the phone saved, as it already is for queued spots.
- Picking the same photo again from the library (SYC-166's "already logged") offers **Open that spot** for a kept spot (§7 says what makes that work), and after a discard the same photo can be sent again.

### 3.4 Offline

Because the list is on the phone, **seeing the list, its photos and each spot's suggestions works without signal.** Sending a choice needs signal, so there the app says **"No signal. Your sighting is saved. Finish this when you're back online."**, which is now true for every spot. Offline support is otherwise partial, as before: the cat-alogue's photos and map only show if the phone loaded them earlier.

### 3.5 What finishes a spot

Everything that finishes a spot today finishes it here, with no change to points: **"That's the one"** (15 points), **"New cat"** (25 points, discoverer) and a **hand pick** (15 points). The spot leaves the list at once. ("Ask Syros Cats to match it" is hidden in the app until the team can act on it, `review.tsx:~462`, so it is not part of this spec; when it ships it removes the card the same way.)

A spot finished on another tab or phone while this phone still lists it shows **"This one's already been handled"** when opened, and is removed from the list. Without a server list this is the only way the phone learns of it; the server already refuses a second finish with a `409`. That answer carries no code today and a name clash is also a `409`, so **the build adds `code: "RESOLVED"` to it** (one line in `routes/sightings.ts`), which makes "No server change" become "one line". If the app dies after a successful finish but before the card is removed, the spotter's own finished spot says "already handled"; that is accurate enough to leave.

---

## 4. Options considered (Samuel chose A)

| | **A. The phone keeps every unfinished spot** (the ticket's first option, **chosen**) | **B. The server lists them, the phone shows the list** | **C. B plus phone-saved spots merged into one list** (first recommendation) |
|---|---|---|---|
| **What the spotter sees** | One list. | One list. | One list. |
| **After "Get your spots back" on a new phone** | **Unfinished spots are not there.** | They arrive. | They arrive (unsent ones stay on the old phone). |
| **After the browser clears its data, or the phone is reset** | **Unfinished spots are lost.** | Kept. | Kept (sent spots). |
| **Two tabs on one phone** | They share the phone's one stored list (the queue's cross-tab lock already does this). | One truth. | One truth. |
| **Needs signal to see the list** | No. | Yes (a saved copy fills in). | Partly. |
| **Server change** | **One line** (a code on one answer). | A list route and a "removed" table. | The same. |
| **Phone change** | One new step at send time, through the queue's existing single write path. | A new read-only list. | B plus a merge. |
| **Overlap with the offline-queue fixes (SYC-196/392)** | Real but small: one new write next to `enqueue` in `OfflineContext.tsx` (§10). | None. | One merge step. |
| **Risk** | Two copies (phone and server) can disagree; only the server's refusal tells the phone a spot is done. | A server hiccup hides the list. | The same. |

**The choice of A is Samuel's and is recorded as his.** What it costs is the new-phone and cleared-data case, which C would have covered. If that matters after launch, B or C can be added without undoing A: the server side is additive, and the phone's list would gain a second source.

---

## 5. How a spot stops being listed

| What happens | What the spotter sees |
|---|---|
| They finish it ("That's the one", "New cat", a hand pick) | Gone, with the usual celebration. |
| They discard it (every card has Discard, §3.3) | Gone from the phone. The server's row stays (sightings are never deleted) but is never listed anywhere. |
| **Time passes** | **Nothing.** A sent, unfinished spot never expires. |
| The server found **no cat in any photo** | **Not kept.** The spotter is told on screen ("No cat found") and the spot is not added to the list; "Take another photo" and the X both just leave. A check that *failed* is different: it is kept (§3.3). |
| They press "Delete my data" | Gone with everything else. |
| They press "Start again" on the phone | The phone's list is kept and goes under the new spotter, as `DeviceContext` already does for spots waiting to send. A spot already sent under the *old* spotter gets "already handled" or "not yours" if opened, which §3.3 covers: it can't be finished, and offers Discard. |

---

## 6. The second phone (keep-safe and restore)

"Get your spots back" moves the spotter's identity (the same device id) to the new phone, but **not the phone's own list**. So on the new phone:

- Spots the spotter finished are all there, as before (points, cats, history).
- **Spots they sent but hadn't finished are not.** They stay on the old phone and on the server, where nobody can finish them.

The restore screens say this where the move is confirmed, in one line: **"Spots you hadn't finished stay on your old phone."** (§9). Whether the restore screens say anything about waiting spots today is **unchecked**; the line is added either way. The old phone, told `device_moved`, keeps its list but cannot send (the queue already stops on that answer).

---

## 7. How the phone keeps the copy (for the plan, after approval)

**One new step at send time.** In `spot.tsx`, in the `'sent'` branch, before opening "Have we met?", the phone writes a list item for the spot through the queue's one write path (`store.mutate`, `OfflineContext.tsx`). The item has status `review` and carries the server's answer: `sightingId`, `isCatPhoto`, `candidates`, `matchCheck`, `canRecheck`, plus the photo (and the face and body photos), stored the way a queued spot's photos already are (`savePendingPhoto`, so no inline copy of a large image in the list), and the `hintCatId` (SYC-574). That is the shape `markReview` already writes (`OfflineContext.tsx:~346`), so the list, the badge, the tap, `reviewPending`, `finishAndInvalidate` and `retake` all work unchanged.

**"Have we met?" opens from the list item.** The review route finds its photo from the item, as for queued spots. **But `localId` on the route currently means "a saved spot" in two places that must stay right for a spot sent live**: the feeding nudge and visitor line after a finished spot (`lib/waitingCard.ts:272` shows none when `localId` is set, a charity-income path), and the hint prompt. So the item carries a separate marker, `keptAtSend: true`, and those two places read it as "sent live", not "queued". The separate seven-day `review-<id>` photo is written **only when no list item could be written** (no-cat, or a failed write); `retake` and the sweep keep serving those.

**The banner and the tab badge.** "Your photo's been checked. Tap to see…" (`ReviewReadyBanner`) and the number badge on the Spot tab count `review` items (`OfflineContext.tsx:983`). A spot the spotter chose to leave is not news, and with no expiry it would nag for ever. So **items with `keptAtSend` are left out of both**; the banner opens the item that just synced, not the oldest; and the section list itself shows them. (Samuel can reverse this: if he wants the tab badge to count unfinished spots, it is one line.)

**Photos are never kept inline for these copies.** A copy written inline would use the browser's small storage (about 5 MB, `offline-queue-on-web.md`) and could block the spotter's real offline saves. If the photo can't be stored outside the list, **no copy is made** and the old line is used for that spot (§3.1). If the browser later clears the stored photo, the card shows a plain tile and still opens.

**"Delete my data" wins.** The write is refused while the wipe has syncing paused (the same check `enqueue` makes, SYC-63), so a spot sent during a wipe doesn't survive it.

**"Open that spot" for a photo picked again.** The recent-photos record for a sent spot holds only `sightingId`, so "already logged" currently finds nothing to open (`lib/recentPhotos.ts:~287`). The sent record also stores the item's `localId`, so the button works; a discarded spot's record is cleared so the photo can be sent again.

**Two gaps, said honestly.** (1) The phone is killed *while the request is in flight* (the upload and photo check can take about 35 seconds, `sightings.ts:~835`): the server has the spot and the phone has nothing, which is today's bug in full for that window, and A does not close it. After the answer comes back, the phone writes the item straight after `submitSighting` returns, before the waiting-card and recent-photos steps that follow it today (`spot.tsx:~950-975`), so the window after the answer is a few milliseconds. (2) A spot sent while another is open gets its own item (`localId`), as the queue already allows.

**Server:** one line, `code: "RESOLVED"` on the already-resolved `409`. No new route, no table, no migration.

**What is deliberately not done.** The phone does not ask the server for a list (option B or C, not chosen). Nor is "Ask Syros Cats to match it" built here (hidden until the team can act on it).

**Order with other work.** Live: `syc-196-392-fixes` (the offline queue's retry and sync, `local_24b37aff-6db0-4cce-a11f-a4bdb49d2f2c`, which changes the same file as the new write); `syc-137-phone-keepsafe` (done, #362); SYC-532 (#347, merged); #359 (website maps; the Spot tab's map is not touched). The build starts only after that session's PR has landed or its owner agrees the order, and each is told before merging.

**Tests**

- *Phone logic (vitest, as for `markReview`):* a sent spot is written once, with status `review` and the server's answer; a failed write leaves the screen working and uses the old line; two sends give two items, each with its own `localId`; a double tap is stopped by the existing single-flight guard; a spot with `isCatPhoto: false` is **not** written; a failed check **is** written, with `matchCheck: failed` and `canRecheck`; a write is refused while a wipe is pending; a photo that can't be stored outside the list makes no copy; the item opens through `reviewPending` with its suggestions; finishing and discarding each remove it (a review card has a Discard); `409` with `RESOLVED`, 403 and 404 each offer removal and a name clash `409` does not; `markStaleItems` never flags a `review` item; sync never re-sends one; the feeding nudge still shows after a finished spot sent live; the banner and tab badge ignore `keptAtSend` items and the banner opens the item that just synced; the recent-photos record carries `localId`; two kept spots list newest first; "Start again" with cards present keeps them; a card removed in another tab while its review screen is open fails cleanly.
- *Photos:* the cover, face and body photos are stored by `localId`, are removed with the item, and survive the orphan sweep while the item exists (`cleanupOrphanPhotos` keeps what the list names).
- *Copy:* the new keys exist in en, el and fr, and `pickerNoSignalStay` is used only for the failed-save case.
- *In the browser:* the reproduction from §2 repeated after the build, at 390 px and desktop, with the spot now under "Spots on your phone"; again with the signal faked off; and after a reload of the page.

**Model delegation (build).** The write step and its tests: Sonnet, since it reuses `markReview` and `enqueue`'s shape and is checked by tests and a diff review. The review-route changes (leaving, "already handled"): the session model, because they touch the screen that earns the points. Strings: Haiku, then the i18n parity test, then a native check of the Greek and French. Test cat names are letters only (the SYC-709 rule). The adversarial review of the finished PR: a Sonnet agent in its own worktree told to refute.

---

## 8. What the team sees

**Nothing new.** Unfinished spots don't reach the matching-accuracy figures (SYC-56 counts only finished spots) or the map, and nothing changes that. Whether any dashboard page lists pending sightings is **unchecked** (one search of `lib/dashboard/home.ts` found nothing; the build re-checks). The photo has not been confirmed as a cat or as something the spotter wants shared, so there is no reason to show it to the team.

---

## 9. Words on screen (English, Greek, French)

All three languages ship together. Greek and French follow the register of the existing strings (informal "you").

| Key | English | Greek | French |
|---|---|---|---|
| `unfinishedSavedToast` (new) | Saved. Find it under Spots on your phone. | Αποθηκεύτηκε. Θα τη βρεις στις Παρατηρήσεις στο κινητό σου. | Enregistrée. Retrouve-la dans Observations sur ton téléphone. |
| `restoreUnfinishedNote` (new) | Spots you hadn't finished stay on your old phone. | Οι παρατηρήσεις που δεν είχες ολοκληρώσει μένουν στο παλιό σου κινητό. | Les observations que tu n'avais pas terminées restent sur ton ancien téléphone. |
| `unfinishedAlreadyDone` (new) | This one's already been handled. | Αυτή έχει ήδη τακτοποιηθεί. | Celle-ci a déjà été traitée. |
| `unfinishedCantFinish` (new) | This one can't be finished any more. You can discard it. | Αυτή δεν μπορεί πια να ολοκληρωθεί. Μπορείς να την απορρίψεις. | Celle-ci ne peut plus être terminée. Tu peux la supprimer. |
| `pickerNoSignal` (unchanged, now true for all) | No signal. Your sighting is saved. Finish this when you're back online. | Δεν υπάρχει σήμα. Η καταγραφή σου αποθηκεύτηκε. Ολοκλήρωσέ την όταν έχεις ξανά σύνδεση. | Pas de réseau. Ton observation est enregistrée. Termine-la quand tu seras de nouveau connecté·e. |
| `pickerNoSignalStay` | kept only for a spot with no list item (no-cat, or the phone couldn't save it) | (as today) | (as today) |
| Existing, reused | Spots on your phone · Check if we know this cat · Discard · Discard this spot? | (as today) | (as today) |

The section title, badge and discard words are the existing ones, so a spotter sees one familiar list. A native check of the new Greek and French lines is part of the draft-PR review.

---

## 10. What changes where

| File | Change |
|---|---|
| `artifacts/cat-spotter/app/(tabs)/spot.tsx` | The `'sent'` branch writes the list item before opening review; opens review with `localId`. |
| `artifacts/cat-spotter/context/OfflineContext.tsx` | A new write beside `enqueue` for an already-sent spot (status `review`), through `store.mutate`. **This is the overlap with `syc-196-392-fixes`.** |
| `artifacts/cat-spotter/app/review.tsx` | Leaving shows the toast; a `409` removes the item and says "already handled". |
| `artifacts/cat-spotter/lib/catPicker.ts` | `noSignalMessage` says "saved" for every listed spot; `classifyResolveError` tells "can't be finished" (403, 404, 422 gone, `RESOLVED`) from a name clash. |
| `artifacts/cat-spotter/app/(tabs)/spot.tsx` (list) | A Discard on a sent card. |
| `artifacts/cat-spotter/lib/recentPhotos.ts` | The sent record also holds `localId`; cleared on discard. |
| `artifacts/cat-spotter/components/ReviewReadyBanner.tsx`, `app/(tabs)/_layout.tsx` | Ignore `keptAtSend` items; the banner opens the item that just synced. |
| `artifacts/cat-spotter/lib/waitingCard.ts`, `hooks/useResultNudge.ts` | Read `keptAtSend` as "sent live". |
| `artifacts/cat-spotter/lib/i18n.ts` | The strings in §9, in en, el and fr. |
| restore screens (`restore.tsx` / `get-spots-back.tsx`) | One line where the move is confirmed. |
| `artifacts/api-server/src/routes/sightings.ts` | `code: "RESOLVED"` on the already-resolved `409`. |

---

## 11. Decisions (Samuel, 26 October 2026)

1. **Which approach?** **A: the phone keeps every unfinished spot.** (C was recommended; A chosen.)
2. **How long does an unfinished spot stay?** **Until finished or removed by the spotter.** No expiry.
3. **A "No cat found" photo?** **Not kept in the list.**
4. **Does the team see old unfinished spots?** Not asked, since under A the server holds nothing new to show. Recorded as **no**, matching the first draft's recommendation. Say so if you want otherwise.

## 12. Adversarial review

- **Review 1** (first draft, option C): [`reviews/unfinished-sightings-review.md`](./reviews/unfinished-sightings-review.md). Most of its server findings no longer apply to A; the ones that still do are carried into §3.3, §3.5, §5 and §6.
- **Review 2** (this revision, a second Sonnet reviewer): in the same file, "Review 2". Two blockers (no Discard on a sent card; "Ask Syros Cats to match it" is not built) and nine should-fix findings, all folded in.
