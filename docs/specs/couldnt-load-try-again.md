# "Couldn't load — Try again"

**Ticket:** SYC-508 (epic SYC-605). **Also covers** two SYC-578 items: the empty Notifications "Spot a cat" button, and Home's one friendly line before the first spot.
**Status:** draft for Samuel's approval, 24 Oct 2026. Revised after the adversarial review ([`reviews/couldnt-load-try-again-review.md`](./reviews/couldnt-load-try-again-review.md), all 15 findings accepted).
**Not covered:** the Profile tab and its new Settings screen (SYC-628 adds Profile's own Try again, per `profile-tab-redesign.md`'s mapping table), the team dashboard, and the public cat page (the cat-pages redesign session owns it).

All file:line references were checked against `origin/main` at 356a32b5.

## 1. The problem

When something fails to load, several screens look exactly as they would if there were genuinely nothing there:

- A spotter on bad signal is told "No cats in the catalogue yet. Be the first to spot one!" on an island with dozens of known cats.
- Or they're told "No notifications yet" when their notifications simply didn't arrive.

None of these screens offers a way to try again. The only fix is to leave the screen and come back. On truly bad signal it's worse: nothing ever times out, so the spinner can spin for ever.

| Screen | What it shows when the load fails | Where |
|---|---|---|
| Cat-alogue | "No cats in the catalogue yet. Be the first to spot one!", or "No matches" when a search or filter is on, or an empty map | `hooks/useCatsWithCache.ts` returns no error; `app/(tabs)/cats.tsx:315-322` |
| Home, cats strip | The same "No cats…" line | `app/(tabs)/index.tsx:264-266` |
| Home, stats | One small grey line, "Couldn't load your stats just now.", with no way to retry | `app/(tabs)/index.tsx:202-206` |
| Notifications | "No notifications yet. Spot a cat to follow its updates!" | `app/notifications.tsx:179-185`; the error never leaves `context/NotificationContext.tsx` |
| Review, with nothing to show | "Something went wrong. Please try again." alone on a blank screen, with no header, no back button and no tab bar | `app/review.tsx:264-268` |
| "No cat found" | A **Try again** button that only closes the screen. The spotter isn't told what happens to the photo. A spot saved to send later keeps coming back to this screen | `app/review.tsx:569-600` |

## 2. One shared "Couldn't load" state

A new component, `components/LoadFailed.tsx`, goes wherever a load can fail. It is never used for a real empty state, and real empty states never use its words.

### 2.1 Two sizes

**Full size** fills the empty area of a screen:

> ☁ *(cloud-off icon, muted)*
> **Couldn't load this just now**
> Check your signal, or try again in a moment.
> **[ Try again ]** — main button

**Line size** sits inside a section, for example on Home:

> Couldn't load this just now. **Try again**

The line size can use its own message instead. Home's stats keep their existing, more specific "Couldn't load your stats just now."

### 2.2 Behaviour

- **Try again** reloads only what failed on that screen.
- It always tries, even when the phone thinks it's offline, because that flag can be wrong on weak signal (§2.4).
- While it's trying, the button shows a small spinner and is marked busy, so it can't be pressed twice. The spinner stops when the attempt ends, whether it worked or not.
- If it fails again, the same state stays on screen. Nothing else changes, and nothing is lost.
- If it works, the state is replaced by the real content, or by the real empty message if there's genuinely nothing.
- **Accessibility:**
  - The title is announced to screen readers when the state appears, politely, without interrupting. This uses both the native and the web live-region settings, as `CatPicker.tsx:430-431` does.
  - The icon is hidden from screen readers.
  - The button is at least 44 px tall and has the button role.
  - The layout still works at 200% text size.

### 2.3 Words

There are two new keys. **Try again** reuses the existing `tryAgain` key, which is already translated.

| Key | English | Greek | French |
|---|---|---|---|
| `loadFailedTitle` | Couldn't load this just now | Δεν φορτώθηκε αυτή τη στιγμή | Impossible de charger pour le moment |
| `loadFailedBody` | Check your signal, or try again in a moment. | Έλεγξε το σήμα σου ή δοκίμασε ξανά σε λίγο. | Vérifie ta connexion ou réessaie dans un instant. |

The Greek and French are drafts for Johnny's review pack (commented on SYC-346).

**For Johnny: Greek register.** The app mixes formal and informal Greek. `tryAgain` ("Δοκιμάστε ξανά") and `noNotifications` are formal. Home's newer lines (`statsUnavailable`, `homeFirstSpotLine`) are informal. The new lines follow Home's informal "σου". Johnny picks one, and the keys on these screens follow it.

### 2.4 Timing: never spin for ever

The three loads this spec touches are the cat-alogue, notifications and the profile. Each of them:

- **stops waiting after 20 seconds per request**, using the API client's existing per-request `timeoutMs`. Today these requests have no time limit at all (`custom-fetch.ts:32-36`).
- **retries once, not three times.** A failure then shows within about 40 seconds at worst, not never. It's usually much sooner, because a phone with no signal fails at once.
- **runs even when the phone reports it's offline.** In technical terms, react-query's `networkMode: 'always'`. Otherwise, on web, Try again would wait silently until the browser said it was back online.

## 3. Where it goes, and how each screen tells "failed" from "empty"

The same rule applies everywhere:

- **Show what we last had,** if we have it.
- **Show "Couldn't load"** only when we have nothing and the load failed.
- **Show the real empty message** only when the load worked and there really is nothing.

Home already uses this rule for the profile ("recently true beats unknown").

### 3.1 Cat-alogue and Home's cats strip

`useCatsWithCache` changes in four ways:

- **It records when the phone's saved copy has been read**, whether that read found a list, found nothing, or failed. Until then nothing is decided, so "Couldn't load" never flashes up for a moment on a slow phone.
- **A saved empty list counts as nothing saved.** An empty list is also never saved in the first place.
- **It gains one more answer, `loadFailed`.** This is true when all three hold: there are no cats from the server, the saved copy has been read and had no cats, and the request failed or the phone is offline.
- **Try again waits for the attempt to finish,** so the button knows when to stop spinning. It refreshes the cat-alogue for every screen that shows it (Home, Cat-alogue and the review picker), not just the one where it was pressed.

When the server fails but a saved copy exists, the saved cats show as they do now, with no failed state. The offline banner already explains when the phone has no signal.

| What happened | Cat-alogue (list or map) | Home strip |
|---|---|---|
| Still loading | Spinner (as now) | Spinner (as now) |
| Loaded, cats exist | The cats (as now) | The cats (as now) |
| Loaded, no cats at all | "No cats in the catalogue yet…" (as now) | Same (as now) |
| Failed or offline, saved copy exists | The saved cats (as now) | Same |
| Failed or offline, nothing saved | **Full** "Couldn't load", in place of the list or the map, whatever search or filter is on | **Line** "Couldn't load" |

"Couldn't load" comes before every one of the Cat-alogue's empty messages ("No matches", "Turn on location…", "You've spotted them all"). None of those messages is true when nothing loaded.

### 3.2 Home's stats

The existing line, "Couldn't load your stats just now.", gets a **Try again**. It uses the line size with its own message, and it reloads the profile. When the line shows doesn't change (`index.tsx:118`: online, the profile failed, and none has loaded before).

### 3.3 Notifications

`NotificationContext` passes out one more answer, `loadFailed`. It's true when the request failed and no notifications have ever loaded. A later failed check, which happens every 30 seconds, never hides notifications that already loaded, and never turns a real empty inbox into "Couldn't load". A reply that isn't a list (a hotel Wi-Fi sign-in page, for example) counts as failed, not as "no notifications". Its `refetch` returns a promise that Try again can wait on.

| What happened | Shows |
|---|---|
| Still loading, or the phone has no spotter ID yet | Spinner |
| Failed, nothing loaded before | **Full** "Couldn't load". **Try again** reloads notifications |
| Loaded, none yet | The empty message in §4.1 |
| Loaded, some | The list (as now) |

### 3.4 Review screen with nothing to show

This happens only when the screen is opened from a link that's broken, typed in or out of date (`parseReviewParams`, `reviewParams.ts:186-206`). Trying again can't fix that. So this screen gets its own words, not the shared ones, in the same full-size layout, with a way out:

> **Couldn't open this spot**
> Spots you've saved to send later are on the Spot tab.
> **[ Go to the Spot tab ]**

The screen also gets a back arrow in the top corner, like the other review steps. **Go to the Spot tab** opens the Spot tab. The back arrow goes back, or to Home if there's nowhere to go back to.

| Key | English | Greek | French |
|---|---|---|---|
| `reviewOpenFailedTitle` | Couldn't open this spot | Δεν άνοιξε αυτή η παρατήρηση | Impossible d'ouvrir cette observation |
| `reviewOpenFailedBody` | Spots you've saved to send later are on the Spot tab. | Οι παρατηρήσεις που αποθήκευσες για αργότερα είναι στην καρτέλα «Εντόπισε». | Les observations gardées pour plus tard sont dans l'onglet « Repérer ». |
| `reviewOpenFailedCta` | Go to the Spot tab | Πήγαινε στην καρτέλα «Εντόπισε» | Aller à l'onglet « Repérer » |

### 3.5 Help tab: no change

The ticket says Help shows the same thing for "no campaign" and "couldn't load", with no retry. That's deliberate, per `help-and-info.md` §3.6 (lines 143-160). Checked in `help.tsx:43-49`: whenever the in-app campaign can't be shown, for any reason, the page shows the plain donations link instead, and that link still works. Nothing on the page is empty or a dead end, so there's nothing to retry. Help stays as it is.

## 4. The two SYC-578 items

### 4.1 Empty Notifications

Today, everyone with no notifications sees "No notifications yet. Spot a cat to follow its updates!". There's no button, and the same words show even to people who've already spotted cats.

The message now depends on what we know about the spotter, from the profile Home already loads. Here, "has spotted cats" means the profile's `catsSpotted` is more than 0.

| Spotter | Message | Button |
|---|---|---|
| Hasn't spotted a cat yet | "No notifications yet. Spot a cat to follow its updates!" (unchanged, already translated) | **Spot a cat** |
| Has spotted cats | "No notifications yet. News about the cats you've spotted will show here." | **Spot a cat** |
| Not known (profile not loaded) | "No notifications yet." | **Spot a cat** |

**Spot a cat** opens the Spot tab, as Home's button does. It reuses the existing `spotTitle` key ("Spot a cat" / "Εντόπισε μια γάτα" / "Repérer un chat").

| Key | English | Greek | French |
|---|---|---|---|
| `noNotificationsHasSpots` | No notifications yet. News about the cats you've spotted will show here. | Καμία ειδοποίηση ακόμα. Τα νέα για τις γάτες που έχεις εντοπίσει θα εμφανίζονται εδώ. | Aucune notification pour le moment. Les nouvelles des chats que tu as repérés s'afficheront ici. |
| `noNotificationsYet` | No notifications yet. | Καμία ειδοποίηση ακόμα. | Aucune notification pour le moment. |

### 4.2 Home before the first spot

Before the first spot, Home's top section already says "{n} cats live on Syros. Can you spot one?" with a **Spot your first cat** button. Under it, three tiles still show 0, 0 and 0.

Before the first spot (`homeHeroState(profile) === 'firstSpot'`), the three tiles are hidden, and the top section's existing line is the one friendly line. No new words are needed. When the profile is unknown, the tiles still show dashes, as now, and never a made-up zero.

The gap under the top section is checked at 390 px and 320 px, so the "To collect" heading doesn't sit too close to or too far from it.

## 5. "No cat found → Try again"

Today the **Try again** button on "No cat found" just closes the screen. The spotter isn't told what happened to the photo, and doesn't land anywhere useful.

What actually happens to that photo:

- **In the app:** the photo can't be added to any cat, because no screen offers a way to do it.
- **On the server:** the spot stays unfinished, marked "no cat found" in its team-only match record. The server itself doesn't stop it being finished later (the finish route doesn't check that mark). That's a gap, filed as its own ticket (§6).
- **A spot saved to send later** stays in the "ready to review" list. The "ready to review" banner keeps bringing the spotter back to this same screen.
- **A spot sent straight away** keeps its photo on the phone for 7 days.

### Decision D1: what should "Try again" do?

**Option A (recommended): say what happens, and go straight back to the Spot tab.**

The screen adds one line, "This photo won't be added to any cat." The button becomes **Take another photo**. Pressing it:

- takes a spot saved for later off the "ready to review" list, and deletes its saved photos from the phone;
- deletes a sent spot's 7-day photo from the phone;
- goes back to the Spot tab, without leaving a second copy of the tabs behind, so Back still works normally. The camera doesn't open by itself.

No points are lost, because points are only given when a spot is finished. The same photo can be picked again later.

- *Good:* it's honest, the obvious next step is one tap away, and the screen stops coming back.
- *Risk:* the saved photo is deleted without asking. If the check was wrong and it really was a cat, the spotter needs another photo, which is what today's screen and photo tips already ask them to do.

**Option B: as A, plus an "It is a cat" link.**

Under the button, a small link lets the spotter overrule the check and carry on to the look-alikes or the naming screen.

- *Good:* it rescues a real cat the check missed, such as a dark cat at night or a half-hidden one.
- *Risk:* photos with no cat in them (a blurry wall, a dog) could become new cats in the cat-alogue, and the team would have to clean them up. It also needs its own design and rules (points, and how the team sees it), which is too much before launch.

**Option C: keep today's behaviour, and only rename the button to "Close".**

- *Good:* it's the smallest change.
- *Risk:* it's still a dead end, and spots saved for later still keep coming back.

**Recommendation: A for launch.** File B as a follow-up ticket, so it can be decided after launch once there's evidence of how often the check is wrong.

| Key | English | Greek | French |
|---|---|---|---|
| `notACatNotAdded` | This photo won't be added to any cat. | Αυτή η φωτογραφία δεν θα προστεθεί σε καμία γάτα. | Cette photo ne sera ajoutée à aucun chat. |
| `notACatRetake` | Take another photo | Τράβα άλλη φωτογραφία | Prendre une autre photo |

## 6. Out of scope (filed as tickets)

- Pull-to-refresh on the Cat-alogue and the other lists.
- The "Find the cat" picker on the review screen. When the cat-alogue couldn't load and nothing was saved, it says "No cats are known around here yet." The hook fix (§3.1) already stops an empty saved list counting; the picker's own message is a follow-up.
- On the Cat-alogue, when the profile fails, the "Not spotted yet" chip and the stamps quietly disappear, with no retry (`cats.tsx:68`).
- The public cat page's own "Something went wrong" (`app/cat/[id].tsx:158`), for the cat-pages redesign.
- The server should refuse to finish a spot marked "no cat found" (`sightings.ts` finish route).
- Option B of D1, if Samuel picks A.

## 7. Tests

**`useCatsWithCache`**
- `loadFailed` is false while the saved copy is being read.
- It's true when nothing is saved, or the saved list is empty, and the request failed or the phone is offline.
- It's false when a saved list with cats exists.
- A read that throws counts as "nothing saved".
- An empty list is never saved.
- Try again waits for the attempt to finish.

**`NotificationContext`**
- `loadFailed` is true only when the request failed and nothing has ever loaded.
- A failed check after a good load leaves the list, or the real empty message, as it was.
- A reply that isn't a list counts as failed.
- No spotter ID shows the spinner.

**Timing**
- A request that never answers ends after 20 seconds and shows "Couldn't load".
- On web with `navigator.onLine` false, Try again still sends the request and the spinner stops.

**`LoadFailed`**
- A second press while busy does nothing.
- Both sizes show the right words.
- Screen readers get the title announced and don't read the icon.

**Screens**
- Cat-alogue: "Couldn't load" replaces every empty message and the map when nothing loaded.
- The notifications empty message picks the right line for no spots, some spots and unknown.
- Home hides the tiles only when `homeHeroState` is `'firstSpot'`.
- "No cat found": **Take another photo** removes a spot saved for later, deletes a sent spot's photo by its sighting ID, and lands on the Spot tab. Back afterwards behaves normally on web.

**In the browser**
- Checked at 320 px, 390 px and desktop, in light and dark, in English, Greek and French, at 200% text size on the full card.
- Checked both with the API stopped and with the phone set offline.

## 8. Coordination

- **SYC-509 accessibility chip:** it touches Notifications, Home and review too. It lands first, and this work rebases onto it.
- **SYC-628 Profile redesign (PR #296):** agreed with that session on 24 Oct. It doesn't touch Home or `statsUnavailable`, and its new keys are all prefixed `profile*` or `settings*`. It likely merges first. A follow-up, SYC-635, then switches Profile's inline Try again and the Spotters tab's error line to `LoadFailed`'s line size.
- **`lib/i18n.ts`:** whoever merges second rebases.
