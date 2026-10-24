# "Couldn't load — Try again"

**Ticket:** SYC-508 (epic SYC-605). **Also covers** two SYC-578 items: the empty Notifications "Spot a cat" button, and Home's one friendly line before the first spot.
**Status:** draft for Samuel's approval, 24 Oct 2026.
**Not covered:** the Profile tab and its new Settings screen (SYC-628 adds Profile's own Try again, `profile-tab-redesign.md` mapping table); the team dashboard; the public cat page (owned by the cat-pages redesign session).

All file:line references checked against `origin/main` at 356a32b5.

## 1. The problem

When something fails to load, several screens in the app look exactly like they would if there were genuinely nothing there. A spotter on bad signal is told "No cats in the catalogue yet. Be the first to spot one!" on an island with dozens of known cats, or "No notifications yet" when their notifications simply didn't arrive. None of these screens offers a way to try again, so the only fix is to leave and come back.

| Screen | What it shows today when the load fails | Where |
|---|---|---|
| Cat-alogue | "No cats in the catalogue yet. Be the first to spot one!" | `hooks/useCatsWithCache.ts` returns no error; `app/(tabs)/cats.tsx:233` |
| Home, cats strip | The same "No cats…" line | `app/(tabs)/index.tsx:260` |
| Home, stats | One small grey line, "Couldn't load your stats just now.", no way to retry | `app/(tabs)/index.tsx:202` |
| Notifications | "No notifications yet. Spot a cat to follow its updates!" | `app/notifications.tsx:175`; the error isn't passed out of `context/NotificationContext.tsx` |
| Review, with nothing to show | "Something went wrong. Please try again." alone on a blank screen, with no header, no back button and no tab bar | `app/review.tsx:264` |
| "No cat found" | A **Try again** button that only closes the screen. The spotter isn't told what happens to the photo | `app/review.tsx:569` |

## 2. One shared "Couldn't load" state

A new component, `components/LoadFailed.tsx`, used wherever a load can fail. It is never used for a real empty state, and real empty states never use its words.

### 2.1 Two sizes

**Full (fills the empty area of a screen):**

> ☁ *(cloud-off icon, muted)*
> **Couldn't load this just now**
> Check your signal, then try again.
> **[ Try again ]** — main button

**Line (sits inside a section, e.g. on Home):**

> Couldn't load this just now. **Try again**

The line size can take its own message instead of the standard one; Home's stats keep their existing, more specific "Couldn't load your stats just now."

### 2.2 Behaviour

- **Try again** reloads only what failed on that screen. It always tries, even when the phone thinks it's offline, because that flag can be wrong on weak signal.
- While it's trying, the button shows a small spinner and can't be pressed twice.
- If it fails again, the same state stays on screen. Nothing else changes, and nothing is lost.
- If it works, the state is replaced by the real content, or by the real empty message if there's genuinely nothing.
- The title is announced to screen readers when the state appears (polite, not interrupting). The button is at least 44 px tall.

### 2.3 Words

New keys. **Try again** reuses the existing `tryAgain` key, already translated.

| Key | English | Greek | French |
|---|---|---|---|
| `loadFailedTitle` | Couldn't load this just now | Δεν φορτώθηκε αυτή τη στιγμή | Impossible de charger pour le moment |
| `loadFailedBody` | Check your signal, then try again. | Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά. | Vérifie ta connexion, puis réessaie. |

Greek and French are drafts for Johnny's review pack (commented on SYC-346).

### 2.4 Mock at 390 px

See the artifact rendered from this spec for the 390 px mock of both sizes, in light and dark.

## 3. Where it goes, and how each screen tells "failed" from "empty"

The rule everywhere: **show what we last had if we have it; show "Couldn't load" only when we have nothing and the load failed; show the real empty message only when the load worked and there really is nothing.** This is the same rule Home already uses for the profile ("recently true beats unknown").

### 3.1 Cat-alogue and Home's cats strip

`useCatsWithCache` gains one more answer, `loadFailed`:

- **true** when there are no cats from the server, the phone's saved copy has been checked and is missing, and either the request failed or the phone is offline;
- **false** in every other case, including while the saved copy is still being read (so it never flashes up for a moment on a slow phone).

When the server fails but a saved copy exists, the saved cats show as now, with no failed state. The offline banner already explains when the phone has no signal.

| What happened | Cat-alogue | Home strip |
|---|---|---|
| Still loading | Spinner (as now) | Spinner (as now) |
| Loaded, cats exist | The cats (as now) | The cats (as now) |
| Loaded, no cats at all | "No cats in the catalogue yet…" (as now) | Same (as now) |
| Failed or offline, saved copy exists | The saved cats (as now) | Same |
| Failed or offline, nothing saved | **Full** "Couldn't load" | **Line** "Couldn't load" |

**Try again** calls the hook's existing `refetch`.

On the map view, when nothing loaded, the full state shows instead of an empty map.

### 3.2 Home's stats

The existing line, "Couldn't load your stats just now.", gets a **Try again** (the line size, with its own message). It reloads the profile. When it shows is unchanged (`index.tsx:118`: online, profile failed, and none loaded before).

### 3.3 Notifications

`NotificationContext` passes out one more answer, `loadFailed`: the request failed and no notifications have ever loaded. If some loaded earlier, they stay on screen.

| What happened | Shows |
|---|---|
| Still loading | Spinner (as now) |
| Failed, nothing loaded before | **Full** "Couldn't load". **Try again** reloads notifications |
| Loaded, none yet | The empty message in §4.1 |

### 3.4 Review screen with nothing to show

This isn't a load that can be retried: the screen opened without the details of a spot (an old link, or a page reloaded after the spot was finished). So it gets its own words, not the shared ones, but the same full layout, with a way out:

> **Couldn't open this spot**
> If you saved it to send later, it's still on the Spot tab.
> **[ Go to the Spot tab ]**

The screen also gets a back arrow in the top corner, like the other review steps. **Go to the Spot tab** opens the Spot tab. The back arrow goes back, or to Home if there's nowhere to go back to.

| Key | English | Greek | French |
|---|---|---|---|
| `reviewOpenFailedTitle` | Couldn't open this spot | Δεν άνοιξε αυτή η παρατήρηση | Impossible d'ouvrir cette observation |
| `reviewOpenFailedBody` | If you saved it to send later, it's still on the Spot tab. | Αν την αποθήκευσες για αργότερα, είναι ακόμα στην καρτέλα «Εντόπισε». | Si tu l'as gardée pour plus tard, elle est toujours dans l'onglet « Repérer ». |
| `reviewOpenFailedCta` | Go to the Spot tab | Πήγαινε στην καρτέλα «Εντόπισε» | Aller à l'onglet « Repérer » |

### 3.5 Help tab: no change

The ticket says "no campaign" and "couldn't load" look the same on Help, with no retry. That's deliberate (`help-and-info.md` §3.6): whenever the in-app campaign can't be shown, for any reason, the page shows the plain donations link instead, which still works. Nothing on the page is empty or a dead end, so there's nothing to retry. Leave it as it is.

## 4. The two SYC-578 items

### 4.1 Empty Notifications

Today everyone with no notifications sees "No notifications yet. Spot a cat to follow its updates!", with no button, even people who've already spotted cats.

The message now depends on what we know about the spotter (from the profile Home already loads):

| Spotter | Message | Button |
|---|---|---|
| Hasn't spotted a cat yet | "No notifications yet. Spot a cat to follow its updates!" (unchanged, already translated) | **Spot a cat** |
| Has spotted cats | "No notifications yet. News about the cats you've spotted will show here." | **Spot a cat** |
| Not known (profile not loaded) | "No notifications yet." | **Spot a cat** |

**Spot a cat** opens the Spot tab, as Home's button does.

| Key | English | Greek | French |
|---|---|---|---|
| `noNotificationsHasSpots` | No notifications yet. News about the cats you've spotted will show here. | Καμία ειδοποίηση ακόμα. Τα νέα για τις γάτες που έχεις εντοπίσει θα εμφανίζονται εδώ. | Aucune notification pour le moment. Les nouvelles des chats que tu as repérés s'afficheront ici. |
| `noNotificationsYet` | No notifications yet. | Καμία ειδοποίηση ακόμα. | Aucune notification pour le moment. |
| `notificationsSpotCta` | Spot a cat | Εντόπισε μια γάτα | Repère un chat |

### 4.2 Home before the first spot

Before the first spot, Home's top section already says "{n} cats live on Syros. Can you spot one?" with a **Spot your first cat** button. Under it, three tiles still show 0, 0 and 0.

Before the first spot (`homeHeroState(profile) === 'firstSpot'`), the three tiles are hidden. The top section's existing line is the one friendly line. No new words. When the profile is unknown, the tiles still show dashes, as now; they never show a made-up zero.

## 5. "No cat found → Try again"

Today the **Try again** button on "No cat found" just closes the screen. The spotter isn't told what happened to the photo, and doesn't land anywhere useful.

What actually happens to that photo: the spot is kept on our side as "no cat in the photo" and is never added to any cat. A spot that was saved to send later stays in the "ready to review" list, so the same "No cat found" screen keeps coming back.

### Decision D1: what should "Try again" do?

**Option A: say what happens, and go straight to the camera (recommended).**
The screen adds one line, "This photo won't be added to any cat.", and the button becomes **Take another photo**, which opens the Spot tab ready for a new photo. A spot that was saved for later is taken off the "ready to review" list at the same time, so it doesn't come back.
- *Good:* honest; one tap to the obvious next step; ends the loop of the same screen coming back.
- *Risk:* if the check was wrong and it really was a cat, the spotter has to take another photo. That's what today's screen and photo tips already ask them to do.

**Option B: as A, plus an "It is a cat" link.**
Under the button, a small link lets the spotter overrule the check and carry on to the look-alikes or naming screen.
- *Good:* rescues a real cat the check missed (a dark cat at night, a cat half-hidden).
- *Risk:* lets photos with no cat in them (a blurry wall, a dog) become new cats in the cat-alogue, which the team then has to clean up. It needs its own design and rules (points, how the team sees it), which is too much before launch.

**Option C: leave the button as it is, just reword it to "Close".**
- *Good:* the smallest change.
- *Risk:* still a dead end, and still loops for spots saved for later.

**Recommendation: A for launch.** File B as a follow-up ticket so the team can decide it after launch, once they've seen how often the check is wrong.

| Key | English | Greek | French |
|---|---|---|---|
| `notACatNotAdded` | This photo won't be added to any cat. | Αυτή η φωτογραφία δεν θα προστεθεί σε καμία γάτα. | Cette photo ne sera ajoutée à aucun chat. |
| `notACatRetake` | Take another photo | Τράβα άλλη φωτογραφία | Prendre une autre photo |

## 6. Out of scope (filed as tickets)

- Pull-to-refresh on the Cat-alogue and other lists.
- The "Find the cat" picker on the review screen, when the cat-alogue couldn't load and nothing was saved, says "No cats are known around here yet."
- The public cat page's own "Something went wrong" (`app/cat/[id].tsx:158`), for the cat-pages redesign.
- Option B of D1, if Samuel picks A.

## 7. Tests

- `useCatsWithCache`: `loadFailed` is false while the saved copy is being read; true when nothing is saved and the request failed or the phone is offline; false when a saved copy exists.
- `NotificationContext`: `loadFailed` true only when the request failed and nothing has loaded.
- `LoadFailed`: Try again calls the retry once while busy; both sizes render the right words.
- The notifications empty message picks the right line for no spots, some spots and unknown.
- Home hides the tiles only when `homeHeroState` is `'firstSpot'`.
- "No cat found": **Take another photo** removes a spot saved for later and opens the Spot tab.
- Checked in the browser at 390 px and desktop, light and dark, in English, Greek and French, with the API stopped and with the phone set offline.
