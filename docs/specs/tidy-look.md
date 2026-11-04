# Today's look, tidied (SYC-811, Option 3)

Status: all decisions recorded 4 Nov 2026.

Samuel chose Option 3 on 4 Nov 2026: "for now, let's go with option 3". The blue header, rounded cards and font stay. Port Register and Façades are parked. This spec covers the spotter app only.

## What people will notice

1. Spotting always looks the same: one colour, on every button that starts or finishes a spot, and a Spot tab that no longer looks like Help.
2. Words on pink and on the blue headers become readable.

## Does this depend on how Syros Cats work?

No. It changes colour, wording and one control, and touches nothing about trapping, vet visits, funding, records or feeding. So it doesn't wait for Jacky or Susan. The place-name questions are parked with Façades.

## Decisions

Samuel, 4 Nov 2026: "1A, 2A, 3 puns survive ... 5 it can go live immediately".

- **Pink:** deeper everywhere (1A). This replaces the 23 Oct decision on SYC-142.
- **Spot tab:** raised round camera button (2A). iPhones on iOS 26 keep Apple's own tab bar. Swapping Help for Map stays out and stays open on SYC-781.
- **Puns:** they stay, in all three languages. The wording doesn't change.
- **Timing:** goes live as soon as it's merged and published. Samuel's words above cover this work under the 1-14 Nov hold. SYC-760's measures note the date it went live, because a more prominent Spot button could change the number of spots.
- **Emoji:** all stay (Samuel, 4 Nov 2026: "Keep them all"). No screens or translation strings change for this.

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
| Finishing a spot: "Add to the cat-alogue", confirming a match | Blue | Pink |

## Out of scope

The team dashboard (SYC-831 to SYC-833), the Map tab swap, place names on Home, and other audit tickets. Cut-off button labels are SYC-825; shorter words help but don't fix them.

## How we'll know it's right

- All words and icons on pink pass the standard, in light and dark, and the donation bar and map pin stand out enough.
- Checked at 390 px and desktop in all three languages, light and dark, on every screen in the Spot table.
- Checked on a real phone outdoors in the sun.
- Existing tests are updated and pass, with new ones for the pink's contrast and the raised tab.

## Build notes

One PR, a draft until checked, with colours and Spot buttons, then the raised tab, as separate commits so either can be reverted alone.

**Colours and Spot buttons.**

- Set `accent` to bougain700 #b02f66 in light and dark (5.95:1 with `accentForeground`). This also lifts the donation progress bar to 5.18:1 on its track (today 2.93:1) and the map pins above 3:1. Confetti uses `palette.bougain500` directly and stays bright.
- In dark mode, unread dots keep bougain500 so they stay visible (`app/notifications.tsx:211`).
- `NameStep.tsx:424` moves off `palette.bougain500`.
- The gradient at `app/review.tsx:1108` moves to bougain700 → terra800.
- SYC-827: solid paper-white text and a dark pill on Welcome, Profile and Home.
- Spot buttons move to `variant="accent"`: `AboutTab.tsx:207`, `app/notifications.tsx:274`, `app/review.tsx:334, 756, 1259`, the confirm-match button, and `spot.tsx` "Check for matches".
- `lib/colorContrast.test.ts` header says pink is left out on purpose (SYC-142). Remove that exclusion.

**Raised tab.**

- In `ClassicTabLayout` only: `_layout.tsx:196-201` uses system `NativeTabs` when Liquid Glass is available, which allows only an icon and label. Needs a real-device check on iOS 26 before the store build.
- A custom tab button redraws the review badge (today `:116`).
- Web ignores `hitSlop`, so the 44 px target comes from real padding.
- The bar is absolute with web height 84 (`_layout.tsx:71`), and tab screens hard-code bottom padding (`index.tsx:148`). Recheck every tab screen so nothing hides behind the raised button.
- In dark mode the button is 2.78:1 against the bar, so it gets a 2 px paper-white ring.
- Respect reduced motion. Check "Εντόπισε" and "Repérer" fit.
