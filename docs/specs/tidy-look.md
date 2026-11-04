# Today's look, tidied (SYC-811, Option 3)

Status: reviewed draft for Samuel's approval, 4 Nov 2026.

Samuel chose Option 3 on 4 Nov 2026: "for now, let's go with option 3". The blue header, rounded cards and font stay. Port Register and Façades are parked. This spec covers the spotter app only.

## What people will notice

1. Spotting always looks the same: one colour, on every button that starts or finishes a spot, and a Spot tab that no longer looks like Help.
2. Words on pink and on the blue headers become readable.
3. The app uses plain words. The tab says Cats, or Γάτες, so a Greek speaker doesn't have to decode a pun.
4. Emoji leave words, tabs, titles and buttons.

## Does this depend on how Syros Cats work?

No. It changes colour, wording and one control, and touches nothing about trapping, vet visits, funding, records or feeding. So it doesn't wait for Jacky or Susan. The place-name questions are parked with Façades.

## Decisions for Samuel

### D1. What happens to the pink?

White words on today's pink are too faint for the standard you committed to on 1 Nov. On 23 Oct you chose to leave the pink as it is (SYC-142), so every option but the last changes that decision.

| Option | Benefit | Risk |
|---|---|---|
| **A. Make the pink deeper everywhere (recommended)** | One pink across the app. Fixes every button, banner and badge, the donation bar and the map pin in one change. | The app loses some brightness. |
| B. Keep the bright pink, with dark navy words on it | Keeps your brand pink, and is also a single small change. | Dark words on pink look heavier. The donation bar and map pin still fall short. |
| C. Deeper pink on Spot buttons only | Smallest change to the brand. | Two pinks side by side. Banners, badges and Donate still fail the standard. |
| D. Leave it | No change. | Spot still fails. The 1 Nov commitment isn't met. |

### D2. How does the Spot tab stand out?

SYC-781 asks for a raised button, and the Option 3 mock-up showed one.

| Option | Benefit | Risk |
|---|---|---|
| **A. Raised round camera button (recommended)** | Makes spotting the obvious main action. It's the critique's fix. | Needs care: each tab screen's bottom space changes, and the badge has to be redrawn. iPhones on iOS 26 would keep Apple's own tab bar, so the store app there wouldn't get it. Nobody sees that until the store app ships. |
| B. Same flat tab, in pink | Small and safe, the same on every phone. | Less of a main action. |

Either way, swapping Help for Map stays out of this work. It changes how people find things, and stays open on SYC-781.

### D3. Do any puns survive?

**Recommended: none, in any language.** All three languages then say the same thing, and "A new cat!" is warm enough. The alternative is keeping "A new furriend!" in English. It's more playful, but English gets a joke Greek and French don't.

### D4. Which emoji stay?

**Recommended:** badges stay, because SYC-791 owns badge art, and "Made with ❤️ in Ερμούπολη" stays as the app's one signature. The rest go. Where an emoji acts as a picture, such as the Welcome steps and the cat page's tabs, a simple line icon replaces it. The alternative is removing only those in words and buttons. That's quicker, but the Welcome screen and cat page keep the emoji look the critique called generic.

### D5. When does it go live?

The hold runs to 14 Nov, and launch week is the baseline for your measures. A more prominent Spot button could change how many spots people make.

**Recommended:** build and merge during the hold, and publish after the launch-week numbers have been read. This needs your say-so, because it's more than small polish. The alternative is starting on 15 Nov, which is stricter but gains nothing, since merged work only goes live when you publish.

## What changes

### The Spot action

Pink means "this starts or finishes a spot". Blue stays for navigation and everything else.

| Where | Today | After |
|---|---|---|
| Home, for someone with no spots yet | Pink, "Spot your first cat" | Same words, new pink |
| Profile | Pink, "Spot a cat" | Same words, new pink |
| Cat page | Blue, "I've spotted {name}" | Pink, same words |
| Spot screen, "Check for matches" | Blue | Pink |
| Empty notifications | Blue, "Spot a cat" | Pink |
| Try-again buttons in review that restart a spot | Blue | Pink |
| Finishing a spot: "Add this cat", confirming a match | Blue | Pink |

### Words

Greek and French are drafts for Johnny's review.

| Today | English | Greek | French |
|---|---|---|---|
| Cat-alogue (tab and title) | Cats | Γάτες | Chats |
| "…already in the Cat-alogue." | Take a photo of a cat. We'll check if we already know it. | Τράβηξε μια φωτογραφία μιας γάτας. Θα ελέγξουμε αν την ξέρουμε ήδη. | Prends une photo d'un chat. On vérifiera si on le connaît déjà. |
| "…one furriend at a time." | Spot, name and help the street cats of Syros. | unchanged | unchanged |
| A new furriend! | A new cat! | Νέα γάτα! | Un nouveau chat ! |
| "…a name for the cat-alogue." | You're the first to spot this cat. Give them a name. | Είσαι ο πρώτος που τη βρήκε. Δώσε της όνομα. | Tu es le premier à repérer ce chat. Donne-lui un nom. |
| Name your furriend | Name this cat | Δώσε όνομα στη γάτα | Nomme ce chat |
| Add to the cat-alogue | Add this cat | Πρόσθεσε αυτή τη γάτα | Ajouter ce chat |
| Add it to the cat-alogue | Add it to the app | Πρόσθεσέ τη στην εφαρμογή | Ajoute-le à l'appli |
| "…already in the Cat-alogue." (check failed) | We couldn't check whether we already know this cat. | Δεν μπορέσαμε να ελέγξουμε αν ξέρουμε ήδη αυτή τη γάτα. | On n'a pas pu vérifier si on connaît déjà ce chat. |
| Find this cat in the cat-alogue | Find this cat in the list | Βρες τη γάτα στη λίστα | Retrouve ce chat dans la liste |

The plain word "catalogue" can stay where it already appears. The male wording in the first-to-spot line is SYC-533, not this work.

## Out of scope

The team dashboard (SYC-831 to SYC-833), the Map tab swap, place names on Home, and other audit tickets. Cut-off button labels are SYC-825; shorter words help but don't fix them.

## How we'll know it's right

- All words and icons on pink pass the standard, in light and dark, and the donation bar and map pin stand out enough.
- None of the puns remain in the app's wording.
- Checked at 390 px and desktop in all three languages, light and dark, on every screen in the Spot table.
- Checked on a real phone outdoors in the sun.
- Existing tests are updated and pass, with new ones for the pink's contrast and the raised tab.

## Build notes

Assumes the recommendations. Three PRs, each a draft until checked.

**PR 1, colours and Spot buttons.**

- Set `accent` to bougain700 #b02f66 in light and dark (5.95:1 with `accentForeground`). This also lifts the donation progress bar to 5.18:1 on its track (today 2.93:1) and the map pins above 3:1. Confetti uses `palette.bougain500` directly and stays bright.
- In dark mode, unread dots keep bougain500 so they stay visible (`app/notifications.tsx:211`).
- `NameStep.tsx:424` moves off `palette.bougain500`.
- The gradient at `app/review.tsx:1108` moves to bougain700 → terra800.
- SYC-827: solid paper-white text and a dark pill on Welcome, Profile and Home.
- Spot buttons move to `variant="accent"`: `AboutTab.tsx:207`, `app/notifications.tsx:274`, `app/review.tsx:334, 558, 756, 1259`, the confirm-match button, and `spot.tsx` "Check for matches".
- `lib/colorContrast.test.ts` header says pink is left out on purpose (SYC-142). Remove that exclusion.

**PR 2, raised tab.**

- In `ClassicTabLayout` only: `_layout.tsx:196-201` uses system `NativeTabs` when Liquid Glass is available, which allows only an icon and label. Needs a real-device check on iOS 26 before the store build.
- A custom tab button redraws the review badge (today `:116`).
- Web ignores `hitSlop`, so the 44 px target comes from real padding.
- The bar is absolute with web height 84 (`_layout.tsx:71`), and tab screens hard-code bottom padding (`index.tsx:148`). Recheck every tab screen so nothing hides behind the raised button.
- In dark mode the button is 2.78:1 against the bar, so it gets a 2 px paper-white ring.
- Respect reduced motion. Check "Εντόπισε" and "Repérer" fit.

**PR 3, words and emoji.** Needs a named owner for `lib/i18n.ts` first.

- Emoji in strings: about 50 lines across three languages.
- Emoji in screens: `app/(tabs)/index.tsx:131, 163, 171`, `app/(tabs)/cats.tsx:279, 345`, `app/notifications.tsx:244`, `spot.tsx:1182-1186, 1736`, `app/cat/[id].tsx:242-256`, `app/review.tsx:1140, 1460`, `ReportIssueLink.tsx:25`, `WelcomeStep.tsx:14-16, 31-37, 73`, `SafetyStep.tsx:47, 66`, `KeepSafeScreen.tsx:88`, `MovedScreen.tsx:37`, `QuestionCards.tsx:74, 81`, `StoryTab.tsx:13-16`, `NameStep.tsx:229, 427, 468, 515`, `CatPicker.tsx:286`.
- `CatTabBar.tsx:11` requires an `emoji` string, so it changes to take an icon.
- Tests to update: `CatPageTabs.test.tsx:294`, `CatTabBar.test`, `ReviewScreen.pendingCandidate.test.tsx:96, 100`, `HomeScreen.spotted.test`.
- Pun search, case-insensitive: "cat-alogue", "furriend", "γατά-λογο", "miaou-ami", "γατοπαρέα". Key names stay as they are.
