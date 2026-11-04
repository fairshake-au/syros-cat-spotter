# Today's look, tidied (SYC-811, Option 3)

Status: draft for Samuel's approval, 4 Nov 2026.

Samuel chose Option 3 on 4 Nov 2026 ("for now, let's go with option 3"). The blue header, rounded cards and Inter stay. Port Register and Façades are parked. This spec covers the spotter app only.

## What people will notice

1. Spotting always looks the same: one pink, one label, and a Spot button in the tab bar that stands out from Help.
2. Text on pink and on the blue headers becomes readable.
3. The app uses plain words. The tab says Cats, or Γάτες, and a Greek speaker no longer has to decode a pun.
4. Emoji leave words, tabs, titles and buttons.

## Does this depend on how Syros Cats work?

No. It changes colour, wording and one control, and touches nothing about trapping, vet visits, funding, records or feeding. So the spec doesn't wait for Jacky or Susan. The place-name questions are parked with Façades. Place names on Home are out of scope.

## Decisions for Samuel

Each has a recommendation. Nothing in the plan is final until these are answered.

### D1. How far does the darker pink go?

White on today's pink (#e8558a) is 3.36:1, and text needs 4.5:1. On 23 Oct Samuel chose to leave the pink as it is (SYC-142). Option 3 reverses that at least for Spot, so this needs saying out loud.

| Option | Benefit | Risk |
|---|---|---|
| **A. Every pink that carries text (recommended).** Add `accentFill` #b02f66 (5.95:1) for buttons, banners and number badges. Today's pink stays for decoration: confetti, unread dots, progress bars. | One pink for text everywhere. Clears the whole gap in one change, including Donate and "Get started". | The app looks a little deeper and less bright. |
| B. Spot buttons only. | Smallest change, closest to the 23 Oct decision. | Two pinks side by side. Banners, badges and Donate still fail WCAG AA. |
| C. Leave the pink. | No change. | Spot still fails. SYC-781 and the 1 Nov AA commitment aren't met. |

### D2. Does the Map tab come in now?

SYC-781 also replaces Help with Map, and the Option 3 mock-up showed that. It's a change to how people find things, and Help moves under Profile.

**Recommended: leave it out.** Raise the Spot button now, keep Home, Cats, Spot, Help, Profile, and keep the swap open on SYC-781 as its own change. Benefit: a small, safe PR, and Help stays one tap away. Risk: Map stays a button inside Cats for now.

### D3. Do any puns survive?

**Recommended: none, in any language.** All three languages then say the same thing, and "A new cat!" is warm enough. The alternative is keeping "A new furriend!" in English only as a celebration. It's more playful, but the languages stop matching and English gets a joke Greek and French don't.

### D4. Which emoji stay?

**Recommended:** badges stay, because SYC-791 owns badge art. "Made with ❤️ in Ερμούπολη" stays as the one exception, because it's the app's signature. The cat page's tab icons, the streak flame, the wave and the paw in empty states go, and a Feather icon replaces any that carries meaning. The alternative is removing every emoji, which is tidier but makes badges look empty before SYC-791 lands.

## What changes

### 1. Colours (PR 1)

- Add `accentFill` #b02f66 in `constants/colors.ts`, in both light and dark. `accentForeground` is unchanged.
- Use it wherever text or an icon sits on pink: `Button` and `IconButton` accent variants, `OfflineBanner`, `ReviewReadyBanner`, `SignInRequiredBanner`, `ReportReminderBanner`, `HomeScreenNudgeBanner`, the bell's badge, the tab badge, the success tick in `app/review.tsx:609`, and the name shuffle pill in `NameStep.tsx:424`.
- The "new cat" header (`app/review.tsx:1108`) moves to bougain700 → terra800, so its white text passes.
- `colors.accent` stays for decoration only: confetti, unread dots, progress bars.
- Map pins stay out of this spec (SYC-828). They need a colour that stands out on the map, and that's a separate question.
- Faded text on blue (SYC-827): solid paper-white text, and a dark pill in place of translucent white, on Welcome, Profile and Home.

### 2. One Spot action (PR 1)

The Spot action means a button that starts a spot or sends one to be checked.

| Where | Today | After |
|---|---|---|
| Home | Pink, "Spot your first cat" | Pink, "Spot a cat" |
| Profile | Pink, "Spot a cat" | No change, apart from the darker pink |
| Cat page | Blue, "I've spotted {name}" | Pink, same words |
| Spot screen, "Check for matches" | Blue | Pink |

Blue stays for navigation and every other action. The cat page keeps the cat's name because it's more useful there.

On Home the button sits on the blue header at 1.30:1 against it, about the same as today's 1.36:1. Its white label is what identifies it. Check it looks right in the sun-glare test below.

### 3. Tab bar (PR 2)

- The Spot tab becomes a raised round camera button in `accentFill`, in the centre, with its label beneath.
- Tabs stay in today's order. Spot is already third of five.
- Targets stay at 44 pt or more, and the review-ready badge stays on it.
- In dark mode the pink is only 2.15:1 against the tab bar, so the button gets a 2 px paper-white ring there.
- It respects reduced motion: no bounce.
- Check that all three languages fit, including "Εντόπισε".

### 4. Words and emoji (PR 3)

Needs a named owner for `lib/i18n.ts` first. Greek and French below are drafts for Johnny's review.

| Key | English | Greek | French |
|---|---|---|---|
| `tabCatalog`, `catalogTitle` | Cats | Γάτες | Chats |
| `spotSubtitle` | Take a photo of a cat. We'll check if we already know it. | Τράβηξε μια φωτογραφία μιας γάτας. Θα ελέγξουμε αν την ξέρουμε ήδη. | Prends une photo d'un chat. On vérifiera si on le connaît déjà. |
| `welcomeSubtitle` | Spot, name and help the street cats of Syros. | unchanged | unchanged |
| `aNewFurriend` | A new cat! | Νέα γάτα! | Un nouveau chat ! |
| `newFurriendSubtitle` | You're the first to spot this cat. Give them a name. | Είσαι ο πρώτος που τη βρήκε. Δώσε της όνομα. | Tu es le premier à repérer ce chat. Donne-lui un nom. |
| `nameYourFurriend` | Name this cat | Δώσε όνομα στη γάτα | Nomme ce chat |
| `addToCatalogButton` | Add this cat | Πρόσθεσε τη γάτα | Ajouter ce chat |
| `howStepCatalog` | Add it to the app | Πρόσθεσέ τη στην εφαρμογή | Ajoute-le à l'appli |
| `couldntCheckBody` | We couldn't tell whether we already know this cat. | Δεν μπορέσαμε να δούμε αν ξέρουμε ήδη αυτή τη γάτα. | On n'a pas pu savoir si on connaît déjà ce chat. |
| `couldntCheckFind` | Find this cat in the list | Βρες τη γάτα στη λίστα | Retrouve ce chat dans la liste |
| `homeFirstSpotCta` | Spot a cat | Εντόπισε μια γάτα | Repère un chat |

The male wording in the Greek and French first-to-spot line stays as it is here; that's SYC-533.

Emoji come out of the other strings, about 50 lines across the three languages, and out of the screens that add their own: `app/(tabs)/index.tsx:131, 163, 171`, `app/(tabs)/cats.tsx:279, 345`, `app/notifications.tsx:244`, the location chip in `spot.tsx:1182-1186`, `app/cat/[id].tsx:242-256`, and `ReportIssueLink.tsx:25`.

Team dashboard wording isn't touched.

## Out of scope

- The team dashboard. Its gaps are on SYC-831, SYC-832 and SYC-833.
- The Map tab swap (see D2), place names on Home, and new colours beyond `accentFill`.
- Other audit tickets (SYC-820 to SYC-830), though SYC-825 matters here: shorter labels help, but cut-off buttons need their own fix.

## When it goes live

Launch week is the baseline for the success measures, and a more prominent Spot button could change how many spots people make. So PRs can merge during the hold, but Samuel should publish after the launch-week numbers have been read, and SYC-760's measures should note the date this went live.

## How we'll know it's right

- Every text and icon on pink measures at least 4.5:1, or 3:1 for large text and icons, light and dark.
- A search finds no "Cat-alogue", "furriend", "γατά-λογο", "miaou-ami" or "γατοπαρέα" in `lib/i18n.ts`, apart from the keys' own names.
- Checked at 390 px and desktop in English, Greek and French, in light and dark, including the tab bar and all four Spot places.
- Checked on a real phone outdoors in the sun: Spot button, banners, Welcome.
- Existing tests pass. Tests are added for the new token's contrast and for the raised tab's label and role.

## Shared areas

PR 1 and PR 2 touch neither translations, `layout.ts` nor migrations. PR 3 edits `lib/i18n.ts` and can't start until an owner is named.
