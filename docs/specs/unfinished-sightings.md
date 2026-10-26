# Finding a spot again when you leave before choosing

**Ticket:** SYC-186 (epic SYC-607). Found in the adversarial review of PR #52 (SYC-119 Slice A), 2 October 2026.
**Status:** **Draft for Samuel's approval**, 26 October 2026. Adversarial review: [`reviews/unfinished-sightings-review.md`](./reviews/unfinished-sightings-review.md) (findings folded in, §11).
**Owner:** Samuel
**Builds on:** [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.5 and §6 (whose "Your sighting is saved. Finish this when you're back online" this spec makes true for everyone) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) (the phone's own list) · [`restore-with-a-code.md`](./restore-with-a-code.md) and `email-capture.md` §8 (keep-safe) · [`couldnt-load-try-again.md`](./couldnt-load-try-again.md) (the shared "Couldn't load" row) · SYC-153 (cancelled: sending a *choice* without signal; this spec is about finding the *sighting* again) · SYC-196 / SYC-93 (the queue's retry rules).

All file and line references were checked against `origin/main` at `caa4b1ab`.

---

## 1. The short version

Every photo a spotter sends is kept safe until they finish it, and the app always shows them the way back. **Any spot that has been sent but not yet matched to a cat appears under "Spots to finish" on the Spot tab, whether it was sent the moment they took it or saved on the phone and sent later.** Tap it and "Have we met?" opens again, exactly as it was.

The list comes from **two places that the spotter never has to think about**:

- spots still waiting on the phone to be sent (no change from today), and
- spots that reached Syros Cats but weren't finished, which the app asks the server for.

The server's list is what makes this work on a new phone after "Get your spots back", after the browser clears its data, and when two tabs are open. A list kept only on the phone would lose all three.

A spot stays in the list for **30 days** from when the photo was taken, then quietly drops out. The spotter can also throw one away themselves. Nothing new is shown to the Syros Cats team.

---

## 2. The problem, as a spotter meets it

Reproduced on `origin/main` at 390 px in the website against a local server, 26 October 2026 (screenshots in [`docs/screenshots/syc-186/`](../screenshots/syc-186/)):

1. The spotter takes a photo and presses **Check for matches**. With signal, the photo is sent at once and the app opens "Have we met?" (`app/(tabs)/spot.tsx:1013-1042`).
2. They press the **X**, or Back, or the app closes, or the signal drops and they give up.
3. The Spot tab shows the camera and nothing else (`390-02-spot-after-leaving-nothing-listed.jpg`). The photo is on Syros Cats' server, saved as an unfinished sighting (checked in the database: one row, status `pending`). Nothing in the app lists it. No points were earned, and the cat may never be recorded.

The same spot, had it been saved on the phone first (no signal at the time, or "Save and send later"), would show under **"Spots on your phone"** with the badge "Check if we know this cat" and a tap to finish it. The two paths treat the same spotter differently, only because of how good their signal was at that moment. (The saved-on-phone path was read from the code, `spot.tsx:1150-1200`, not screenshotted; the 29 September call and PR #52 both describe it.)

Three things make this worse than it sounds:

- **The promise is only half true.** `choose-a-different-cat.md` §4.5 and §6 tell the spotter "Your sighting is saved. Finish this when you're back online." PR #52 made the app say that only for phone-saved spots. A spot sent straight away gets "No signal. Keep this screen open and try again when you're back online" (`pickerNoSignalStay`, `lib/catPicker.ts:83`), which asks the spotter to stand still holding a phone with no signal.
- **It's the best-signal spotters who lose out.** Someone with good signal is sent straight to "Have we met?"; someone with poor signal gets a saved copy and a list entry. A tourist on the ferry or at a café with Wi-Fi, who sends a photo then gets a phone call, loses it.
- **"Take another photo" quietly leaves the first behind.** From "No cat found", `retake` removes only the phone's copy (`review.tsx:503-512`); the server's row stays unfinished for ever.

---

## 3. What the spotter experiences

### 3.1 Leaving "Have we met?" without choosing

Nothing changes on the way out: back, X and closing the app all work as they do now. What changes is that the spot is never gone.

- **Pressing the X or Back** shows a short line at the bottom of the Spot tab: **"Saved. Find it under Spots to finish."** (§9). It shows once per spot, so a spotter who deliberately looks at a few spots isn't nagged.
- **Closing the app, or losing signal and giving up,** shows nothing at the time (the app can't), but the spot is waiting under "Spots to finish" the next time the Spot tab opens.

### 3.2 The "Spots to finish" list

On the Spot tab, under the camera card, **one list**:

> **Spots to finish**
>
> `[photo]`  Check if we know this cat · Taken today, 14:32  `›`
> `[photo]`  Check if we know this cat · Taken yesterday  `›`
> `[photo]`  Queued · Waiting to send

- A spot the server has is shown with the badge **"Check if we know this cat"** (the words the phone-saved ones already use), the photo, and when it was taken. Tap and "Have we met?" opens with the suggestions the server already found. **No new photo check is run**, so opening a spot is free and fast.
- A spot still waiting on the phone to be sent keeps today's badges (**Queued**, and the failed and rejected states). Once it is sent, it becomes the same card as above. The spotter never sees two cards for one photo.
- Each card has a small **Discard** action (§3.4).
- The list is newest first. It shows the 20 most recent. If there are more, the last row says **"And {n} more"** and opens the full list. In practice almost nobody has more than a handful.
- The old section title "Spots on your phone" becomes **"Spots to finish"**, because the list now also holds spots that aren't on the phone.

### 3.3 When the list can't be fetched

The phone asks the server whenever the Spot tab opens and whenever the app comes back to the front (at most once a minute). If the answer doesn't arrive:

- **With no signal:** the list shows what the phone last heard, with a small grey line, **"Showing what we saw last time you were online."** Opening a spot still works (the suggestions were saved with the list). Sending a choice says **"No signal. Your sighting is saved. Finish this when you're back online."**, which is now true for every spot. The photo may show as a plain tile if the phone hasn't loaded it before.
- **With signal but the server doesn't answer:** a grey row, **"Couldn't check for unfinished spots. Try again,"** using the shared `LoadFailed` row from `couldnt-load-try-again.md`. It never says "no spots" when it simply failed to ask, and it appears **above** the list, so a spotter who has phone-saved spots still sees them.
- **First ever visit, no signal, nothing cached:** the list shows only phone-saved spots, and nothing else. There's nothing to say, because there's nothing the phone could know.

### 3.4 Throwing a spot away

**Discard** on a card asks the question the app already asks (SYC-512, #340): *"Discard this spot? The photo and details won't be sent, and you can't get them back."* If they confirm:

- a phone-saved spot is removed as today;
- a spot the server has is removed from every list, on every phone, for good. The server keeps the row (sightings are never deleted, only "Delete my data" unlinks them, `0013_deletion_unlinks_people.sql`), but marks it **dropped by the spotter**, and it never comes back.

From "No cat found", **"Take another photo"** discards that spot the same way. Without this, the first photo would reappear in the list the next time the Spot tab opened, which would be a new kind of the same bug.

### 3.5 What finishes a spot

Everything that finishes a spot today finishes it here, with no change to points: **"That's the one"** (15 points), **"New cat"** (25 points, discoverer), a **hand pick** (15 points), and **"Ask Syros Cats to match it."** The spot leaves the list at once and the answer is the same one the spotter would have had straight after sending. A spot finished on another phone or in another tab is gone from this list the next time it refreshes; if the spotter opens a stale card first, the app says **"This one's already been finished"** and removes the card.

---

## 4. Options considered

| | **A. The phone keeps every unfinished spot** (the ticket's option 1) | **B. The server lists them, the phone shows the list** (option 2) | **C. B, plus phone-saved spots merged into the same list** |
|---|---|---|---|
| **What the spotter sees** | One list. | One list. | One list. |
| **After "Get your spots back" on a new phone** | **Lost.** The new phone has no copy. | Spots reach the new phone. | Spots reach the new phone. Spots still waiting to *send* stay on the old phone (as today). |
| **After the browser clears its data, or the phone is reset** | **Lost.** | Kept. | Kept (sent spots); unsent ones are lost with the phone, as today. |
| **Two tabs, or a tab and an installed icon** | Each has its own copy; they can disagree. | One truth. | One truth for sent spots. |
| **Needs signal to see the list** | No | Yes (a saved copy fills in) | Phone-saved spots: no. The rest: a saved copy fills in. |
| **Server change** | None. | A new "my unfinished spots" route, a "dropped by the spotter" mark, a stale-card answer. | Same as B. |
| **Phone change** | Writes a second copy of every sent spot into the offline queue, which is exactly the code SYC-196 and SYC-392 are changing. | A new read-only list; the queue is untouched. | B, plus one merge step. |
| **Risk** | Two copies to keep in step: a spot resolved elsewhere would need to be spotted and removed. Storage on a phone can be cleared silently. | A server hiccup hides the list (handled by §3.3). | Same as B. |
| **Fixes the promise in `choose-a-different-cat.md` §4.5** | Only on this phone. | For sent spots, on every phone. | For every spot, on every phone that can reach the server. |

**Recommendation: C.** It is B, with today's phone-saved spots shown in the same list. The decisive point is the **new phone**: "Get your spots back" moves the spotter's whole identity to the new phone (the same device id, `lib/keepSafe/move.ts`), so a list asked of the server follows the spotter automatically, while a list kept on the phone can't. It also leaves the offline queue completely alone, which is where the other live work is (§10).

---

## 5. How a spot stops being listed

| What happens | What the spotter sees |
|---|---|
| They finish it ("That's the one", "New cat", a hand pick) | Gone, with the usual celebration. |
| They ask Syros Cats to match it | Gone ("Sent to Syros Cats…" as today). |
| They discard it | Gone, and doesn't come back on any phone. |
| **30 days pass** from when the photo was taken | Gone, quietly, with no message. The server keeps the row; the app stops asking about it. (The phone's own 30-day rule for saved spots, `MAX_QUEUE_AGE_MS`, is the same number, so both kinds of spot behave alike.) |
| The server found **no cat in any photo** | **Not listed.** The spotter was told on screen ("No cat found") and chose to leave; a card for it would only be clutter. |
| They press "Delete my data" | Gone with everything else. |
| They press "Start again" on the phone | The new spotter has none of the old one's spots. |

Spots dropped by age are not deleted. If Samuel later wants "come back to a spot after a month," only the number in the query changes.

---

## 6. The second phone (keep-safe and restore)

After "Get your spots back", the new phone *is* the spotter: same device id, a new secret. The new phone's first look at the Spot tab asks the server, which answers for that spotter. Result: every spot the spotter sent but didn't finish is there, with its photo and the same suggestions.

- **Not on the new phone:** spots still *waiting to send* on the old phone. They never reached the server, so there is nothing to bring over. This is how it works today. Whether the restore screens say so is **unchecked**; if they don't, the build adds one line to the move confirmation: "Spots still waiting to send stay on the old phone."
- **The old phone** is told `device_moved` on its next try (`lib/deviceMoved.ts`) and stops asking. Its cached list is wiped with the rest of its local state when it takes "Start again", and is never shown to a new spotter (the list is stored under the spotter's device id).
- **Two people, one phone** (a family tablet): the list is only ever the spotter currently signed in on that phone.
- Before the move finishes, nothing is listed on the new phone because it has no spotter yet. That is correct.

---

## 7. Offline, said precisely

Offline support is partial, so this spec is careful about it:

| Without signal | Works? |
|---|---|
| Seeing the list | **From the last time the phone was online**, with the grey line in §3.3. A spot finished elsewhere since may still appear. |
| Opening a spot to look at the suggestions | **Yes**, from the copy saved with the list. |
| Seeing a spot's photo | **Only if the phone loaded it before.** Otherwise a plain tile. |
| Sending a choice | **No.** The line is "No signal. Your sighting is saved. Finish this when you're back online." and it is true. |
| Spots saved on the phone and still waiting to send | Unchanged. |

Sending a choice without signal (SYC-153) stays cancelled.

---

## 8. What the team sees

**Nothing new.** Today an unfinished spot doesn't reach the dashboard, the matching-accuracy figures (SYC-56, which count only finished spots) or the map. That stays. The photo hasn't been confirmed as a cat, or as anything the spotter wants shared, so showing the team an unconfirmed pile would be new exposure. If the team ever asks "how many photos are people dropping?", a query on the sightings table answers it without a screen.

The one thing that quietly changes: spots the spotter drops on purpose are marked as such, so they stop being counted as "unfinished" in any later report.

---

## 9. Words on screen (English, Greek, French)

All three languages ship together. Greek and French follow the register of the existing strings (informal "you"). `lib/__tests__` already checks that every key exists in all three.

| Key | English | Greek | French |
|---|---|---|---|
| `pendingSightings` (retitled) | Spots to finish | Παρατηρήσεις προς ολοκλήρωση | Observations à terminer |
| `unfinishedSavedToast` | Saved. Find it under Spots to finish. | Αποθηκεύτηκε. Θα τη βρεις στις Παρατηρήσεις προς ολοκλήρωση. | Enregistrée. Retrouve-la dans Observations à terminer. |
| `unfinishedTaken` | Taken {when} | Τραβήχτηκε {when} | Prise {when} |
| `unfinishedOfflineNote` | Showing what we saw last time you were online. | Βλέπεις ό,τι ξέραμε την τελευταία φορά που ήσουν συνδεδεμένος/η. | Voici ce qu'on a vu à ta dernière connexion. |
| `unfinishedLoadFailed` | Couldn't check for unfinished spots. | Δεν μπορέσαμε να ελέγξουμε αν έχεις παρατηρήσεις προς ολοκλήρωση. | Impossible de vérifier tes observations à terminer. |
| `unfinishedMore` | And {n} more | Και άλλες {n} | Et {n} de plus |
| `unfinishedAlreadyDone` | This one's already been finished. | Αυτή έχει ήδη ολοκληρωθεί. | Celle-ci est déjà terminée. |
| `pickerNoSignal` (unchanged, now true for all) | No signal. Your sighting is saved. Finish this when you're back online. | Δεν υπάρχει σήμα. Η καταγραφή σου αποθηκεύτηκε. Ολοκλήρωσέ την όταν έχεις ξανά σύνδεση. | Pas de réseau. Ton observation est enregistrée. Termine-la quand tu seras de nouveau connecté·e. |
| `pickerNoSignalStay` | **removed** | **removed** | **removed** |
| Existing, reused | Check if we know this cat · Discard · Discard this spot? · Try again | (as today) | (as today) |

"Try again" is the existing key from `couldnt-load-try-again.md`. The Greek and French in the toast and title follow `plain-words-part-2-copy-table.md`; a native check of the new Greek and French lines is part of the draft-PR review.

---

## 10. How this is built (for the plan, after approval)

**Server**

- `GET /api/profiles/:deviceId/unfinished-sightings`, answered only for the caller's own device id (`requireDeviceAuth`, like `open-sightings`, `routes/sightings.ts:1448`). Returns up to 20, newest first, each with: `sightingId`, `takenAt`, `photoUrl` (the public photo address, not the raw id), `lat` and `lng` (the spotter's own spot, needed for "Find the cat"), and the same answer a "Check again" gives for a check that worked: `isCatPhoto`, `candidates`, `matchCheck`, `canRecheck`. It reuses `storedAnswer` (`sightings.ts:~734`) so **no matcher call and no model cost** is possible from this route. `status = 'pending'`, not dropped, `createdAt` within 30 days, and `sighting_matches.no_cat_in_any_photo` not true. Plus a `total` so the app can say "And {n} more".
- `POST /api/sightings/:sightingId/discard` (own device only, same 404, 403, secret order as `resolve`): records the drop. Sightings are append-only (a trigger, `0013`), so the drop is a new tiny table, `sighting_drops (sighting_id primary key, dropped_at)`, never an edit to a sighting. The table holds no device id, so deleting a person needs nothing extra there.
- `resolve` and "Ask Syros Cats to match it" already move the status out of `pending`; they need no change, and the stale-card answer already exists (`409 Sighting already resolved`).

**Phone**

- A small read-only module (`lib/unfinished.ts`) fetches the list, merges it with the queue by `sightingId` (a queued item that has reached the server is one card, not two), saves the last answer under the spotter's device id, and exposes the merged list to the Spot tab. **It writes nothing to the offline queue**: a spot is never copied there, which keeps this clear of SYC-196 and SYC-392.
- The review route learns to open from a listed spot (it already opens from `sightingId` plus candidates). Back, X and "Take another photo" call discard or leave as §3.1 and §3.4 say. `noSignalMessage` and `pickerNoSignalStay` go.
- The toast, the section title and the cards are on the Spot tab only. Map code is not touched (PR #359).

**Tests**

- *Server:* only the caller's own spots; pending only; resolved, awaiting-team, dropped, "no cat" and older-than-30-days all excluded; 401 and 403; a second phone after a keep-safe move (new secret, same id) sees the list while the old phone gets `device_moved`; a deleted spotter's spots never appear; no matcher call (the route fails if one is made); `discard` of someone else's spot is refused; both new routes refuse a request without the device secret, as `open-sightings` does.
- *Phone (pure logic, vitest):* merging (one card when a queued item and the server list name the same spot); newest first with the "and {n} more" cut; the cached list is keyed by device id and never shown to another spotter; offline shows the cache with the note; a failed fetch shows the row and keeps phone-saved spots; discard removes both kinds; a stale card opens "already finished" and removes itself.
- *Copy:* the new keys exist in en, el and fr, and `pickerNoSignalStay` is gone.
- *In the browser:* the reproduction from §2 repeated after the build, at 390 px and desktop, showing the spot under "Spots to finish"; and again with the signal faked off (using `navigator.connection` and `onLine`).

**Order with other work.** The offline queue and its retry rules are being changed by `syc-196-392-fixes`; the device id and restore by `syc-137-phone-keepsafe`; server matching by SYC-532 (#347); and website maps by #359. This spec touches none of their files, apart from the Spot tab's list component and `review.tsx`. Before merging, each of those sessions is told, and the order is agreed with them.

**Model delegation (build).** The server route and table: Sonnet, since it's a contained read-and-write-one-table route modelled on `open-sightings`, checked by route tests and a diff review. The phone merge module and Spot tab list: Sonnet, with the pure tests above. The review-route changes (leaving, discarding, stale card): the session model, because they touch the screen that earns the points. Strings: Haiku, then the i18n parity test. The adversarial review of the finished PR: a Sonnet agent in its own worktree told to refute, since no step above is more than Sonnet-grade.

---

## 11. Decisions for Samuel

1. **Which approach?** (§4) A phone-only list, B server list only, or **C, B plus phone-saved spots in one list (recommended)**.
2. **How long does an unfinished spot stay in the list?** **30 days** (recommended, matching the phone's rule), 14 days, or until finished.
3. **Should a "No cat found" photo be listed?** **No** (recommended), or yes.
4. **Does the team ever see old unfinished spots?** **No** (recommended, §8), or a team-only "photos left unfinished" list.

## 12. Adversarial review

See [`reviews/unfinished-sightings-review.md`](./reviews/unfinished-sightings-review.md). Findings and how each was handled are in the table at the end of that file.
